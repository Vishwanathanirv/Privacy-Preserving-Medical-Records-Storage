import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { Db } from "./db";
import { COOKIE, hashPassword, loadKey, readSession, signSession, verifyPassword } from "./security";
import { DEMO_PASSWORD, seedDemo } from "./seed";
import { Service, type Session } from "./service";
import { TransparencyLog } from "./translog";
import { Vault } from "./vault";

/** Verified against when an email is unknown, so a miss costs the same time as a wrong password. */
const DUMMY_HASH = "scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);

const here = dirname(fileURLToPath(import.meta.url));

export type AppOptions = { dbFile?: string; keyDir?: string; logger?: boolean; seed?: boolean; now?: () => number };

declare module "fastify" {
  interface FastifyRequest {
    session: Session | null;
  }
}

class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export async function buildApp(opts: AppOptions = {}): Promise<{ app: FastifyInstance; db: Db }> {
  const db = new Db(opts.dbFile);
  const keyDir = opts.keyDir ?? process.env.KEY_DIR ?? "./data";
  const memory = opts.dbFile === ":memory:";
  const kek = loadKey("MASTER_KEY", memory ? ":memory:" : join(keyDir, "master.key"));
  const sessionKey = loadKey("SESSION_SECRET", memory ? ":memory:" : join(keyDir, "session.key"));
  const vault = new Vault(db, kek);
  const logKey = loadKey("LOG_SIGNING_KEY", memory ? ":memory:" : join(keyDir, "log.key"));
  const tlog = new TransparencyLog(() => db.auditAll(), logKey);
  if ((opts.seed ?? process.env.DEMO_SEED !== "off") && db.countUsers() === 0) seedDemo(db, vault, await hashPassword(DEMO_PASSWORD));

  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 256 * 1024 });
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:", "blob:"], connectSrc: ["'self'"] } } });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10, fieldSize: 16 * 1024 } });

  app.decorateRequest("session", null);
  app.addHook("onRequest", async (req) => {
    req.session = await readSession(sessionKey, req.cookies[COOKIE]);
    // CSRF defence: state-changing requests must carry a custom header, which browsers
    // only send cross-origin after a CORS preflight this server never approves.
    if (req.method !== "GET" && req.method !== "HEAD" && req.url.startsWith("/api/") && req.headers["x-medvault"] !== "1") {
      throw new HttpError(403, "Missing CSRF header");
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: status >= 500 ? "Internal error" : (err as Error).message });
  });

  const service = new Service(db, vault, tlog, { hash: hashPassword, verify: (pw, stored) => verifyPassword(pw, stored ?? DUMMY_HASH) }, opts.now);

  /** Hands every API call to the shared service and translates its result into HTTP. */
  const handle = async (req: FastifyRequest, reply: FastifyReply) => {
    const url = new URL(req.url, "http://localhost");
    let body: unknown = req.body;
    let file: Uint8Array | undefined;
    if (req.isMultipart()) {
      const fields: Record<string, string> = {};
      for await (const part of req.parts()) {
        if (part.type === "file") {
          const buf = await part.toBuffer();
          if (buf.length) file = new Uint8Array(buf);
        } else fields[part.fieldname] = String(part.value);
      }
      body = fields;
    }
    const r = await service.handle({ method: req.method, path: url.pathname, query: url.searchParams, session: req.session, body, file });
    if (r.session) reply.setCookie(COOKIE, await signSession(sessionKey, r.session), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 8 * 3600 });
    else if (r.session === null) reply.clearCookie(COOKIE, { path: "/" });
    reply.status(r.status);
    if (r.file) {
      reply.header("content-type", r.file.type).header("cache-control", "private, no-store");
      if (r.file.filename) reply.header("content-disposition", `attachment; filename="${r.file.filename}"`);
      return Buffer.from(r.file.bytes);
    }
    return r.data;
  };

  const upload = { bodyLimit: 30 * 1024 * 1024 };
  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, handle);
  app.post("/api/patients/:id/records", { ...upload, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, handle);
  app.post("/api/verify", { ...upload, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, handle);
  app.route({ method: ["GET", "POST", "PUT", "DELETE"], url: "/api/*", handler: handle });

  const webDist = [resolve(process.cwd(), "apps/web/dist"), resolve(here, "../../web/dist")].find((p) => existsSync(join(p, "index.html")));
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api/") ? reply.status(404).send({ error: "Not found" }) : reply.sendFile("index.html")));
  }
  app.addHook("onClose", async () => db.close());
  return { app, db };
}
