import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { verifyChain } from "@medvault/core";
import { Db, type Role } from "./db";
import { COOKIE, hashPassword, loadKey, readSession, signSession, verifyPassword, type Session } from "./security";
import { seedDemo } from "./seed";
import { Vault, VaultError } from "./vault";

const here = dirname(fileURLToPath(import.meta.url));

export type AppOptions = { dbFile?: string; keyDir?: string; logger?: boolean; seed?: boolean };

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

const RecordInput = z.object({
  title: z.string().trim().min(2).max(120),
  diagnosis: z.string().trim().min(2).max(300),
  notes: z.string().trim().max(4000).default(""),
  medications: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  vitals: z
    .object({ bp: z.string().max(12).optional(), pulse: z.number().int().min(20).max(250).optional(), temperature: z.number().min(30).max(45).optional(), spo2: z.number().int().min(50).max(100).optional() })
    .default({}),
});

export async function buildApp(opts: AppOptions = {}): Promise<{ app: FastifyInstance; db: Db }> {
  const db = new Db(opts.dbFile);
  const keyDir = opts.keyDir ?? process.env.KEY_DIR ?? "./data";
  const memory = opts.dbFile === ":memory:";
  const kek = loadKey("MASTER_KEY", memory ? ":memory:" : join(keyDir, "master.key"));
  const sessionKey = loadKey("SESSION_SECRET", memory ? ":memory:" : join(keyDir, "session.key"));
  const vault = new Vault(db, kek);
  if ((opts.seed ?? process.env.DEMO_SEED !== "off") && db.countUsers() === 0) await seedDemo(db, vault);

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
    if (err instanceof z.ZodError) return reply.status(400).send({ error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") });
    if (err instanceof VaultError) return reply.status(err.status).send({ error: err.message, stage: err.stage });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: status >= 500 ? "Internal error" : (err as Error).message });
  });

  const auth = (req: FastifyRequest, ...roles: Role[]): Session => {
    if (!req.session) throw new HttpError(401, "Please sign in.");
    if (roles.length && !roles.includes(req.session.role)) throw new HttpError(403, "Your role cannot do this.");
    return req.session;
  };

  /** Patients see their own data; doctors only what a patient has consented to share. Admins never see clinical data. */
  const canAccessPatient = (s: Session, patientId: string) => (s.role === "patient" && s.sub === patientId) || (s.role === "doctor" && db.hasGrant(patientId, s.sub));

  const requireRecordAccess = (s: Session, recordId: string) => {
    const r = db.getRecord(recordId);
    if (!r || !canAccessPatient(s, r.patientId)) {
      db.audit(s.sub, "record.denied", `record:${recordId}`, s.role);
      throw new HttpError(404, "Record not found"); // 404, not 403: do not reveal that it exists
    }
    return r;
  };

  // ---------- auth ----------
  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { email, password } = z.object({ email: z.string().email().max(120), password: z.string().min(1).max(128) }).parse(req.body);
    const u = db.findByEmail(email);
    const ok = u ? await verifyPassword(password, u.passwordHash) : await verifyPassword(password, "scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86));
    if (!u || !ok) {
      db.audit(email.toLowerCase(), "auth.failed", "auth");
      throw new HttpError(401, "Email or password is incorrect.");
    }
    reply.setCookie(COOKIE, await signSession(sessionKey, { sub: u.id, role: u.role, name: u.name }), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 8 * 3600 });
    db.audit(u.id, "auth.login", `user:${u.id}`);
    return { user: { id: u.id, name: u.name, email: u.email, role: u.role } };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.session) db.audit(req.session.sub, "auth.logout", `user:${req.session.sub}`);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (req) => {
    const s = auth(req);
    return { user: db.getUser(s.sub) };
  });

  app.get("/api/health", async () => ({ ok: true, ...db.counts() }));

  // ---------- people ----------
  app.get("/api/doctors", async (req) => {
    auth(req, "patient", "admin");
    return { doctors: db.listUsers("doctor").map(({ id, name, email }) => ({ id, name, email })) };
  });

  app.get("/api/patients", async (req) => {
    const s = auth(req, "doctor", "patient");
    return { patients: s.role === "doctor" ? db.patientsForDoctor(s.sub) : [{ ...db.getUser(s.sub)!, records: db.listRecords(s.sub).length }] };
  });

  app.get("/api/patients/:id", async (req) => {
    const s = auth(req, "doctor", "patient");
    const { id } = req.params as { id: string };
    if (!canAccessPatient(s, id)) throw new HttpError(404, "Patient not found");
    const p = db.getUser(id)!;
    return { patient: { id: p.id, name: p.name, email: p.email }, records: db.listRecords(id) };
  });

  // ---------- consent ----------
  app.get("/api/consent", async (req) => {
    const s = auth(req, "patient");
    return { grants: db.grantsForPatient(s.sub) };
  });

  app.put("/api/consent/:doctorId", async (req) => {
    const s = auth(req, "patient");
    const { doctorId } = req.params as { doctorId: string };
    if (db.getUser(doctorId)?.role !== "doctor") throw new HttpError(404, "Doctor not found");
    db.grant(s.sub, doctorId);
    db.audit(s.sub, "consent.grant", `patient:${s.sub}`, `doctor:${doctorId}`);
    return { grants: db.grantsForPatient(s.sub) };
  });

  app.delete("/api/consent/:doctorId", async (req) => {
    const s = auth(req, "patient");
    const { doctorId } = req.params as { doctorId: string };
    if (db.revoke(s.sub, doctorId)) db.audit(s.sub, "consent.revoke", `patient:${s.sub}`, `doctor:${doctorId}`);
    return { grants: db.grantsForPatient(s.sub) };
  });

  // ---------- records ----------
  app.post("/api/patients/:id/records", { bodyLimit: 30 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const s = auth(req, "doctor");
    const { id } = req.params as { id: string };
    if (!db.hasGrant(id, s.sub)) throw new HttpError(404, "Patient not found");
    let fields: Record<string, string> = {};
    let scan: Uint8Array | undefined;
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          const buf = await part.toBuffer();
          if (buf.length) scan = new Uint8Array(buf);
        } else fields[part.fieldname] = String(part.value);
      }
    } else fields = req.body as Record<string, string>;
    const data = typeof fields.record === "string" ? JSON.parse(fields.record) : fields;
    const rec = RecordInput.parse(data);
    const meta = vault.create(id, { id: s.sub, name: s.name }, rec, scan);
    db.audit(s.sub, "record.create", `record:${meta.id}`, `patient:${id}`);
    return { record: meta };
  });

  app.get("/api/records/:id", async (req) => {
    const s = auth(req, "doctor", "patient");
    const { id } = req.params as { id: string };
    requireRecordAccess(s, id);
    const opened = vault.open(id);
    db.audit(s.sub, "record.view", `record:${id}`, `patient:${opened.meta.patientId}`);
    const { stegoPng: _s, wrappedKey: _w, ...meta } = opened.meta;
    return { meta, record: opened.record, verification: opened.verification };
  });

  app.get("/api/records/:id/image/:variant", async (req, reply: FastifyReply) => {
    const s = auth(req, "doctor", "patient");
    const { id, variant } = z.object({ id: z.string(), variant: z.enum(["stego", "original", "diff"]) }).parse(req.params);
    requireRecordAccess(s, id);
    const png = vault.image(id, variant);
    if (variant !== "stego") db.audit(s.sub, `image.${variant}`, `record:${id}`);
    reply.header("content-type", "image/png").header("cache-control", "private, no-store");
    if ((req.query as { download?: string }).download) reply.header("content-disposition", `attachment; filename="medvault-${id.slice(0, 8)}-${variant}.png"`);
    return Buffer.from(png);
  });

  app.post("/api/records/:id/tamper-test", async (req) => {
    const s = auth(req, "doctor", "patient");
    const { id } = req.params as { id: string };
    requireRecordAccess(s, id);
    return vault.tamperTest(id);
  });

  /** Upload any PNG: if it carries a record the user may open, identify it and check its integrity. */
  app.post("/api/verify", { bodyLimit: 30 * 1024 * 1024, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const s = auth(req, "doctor", "patient");
    const file = await req.file();
    if (!file) throw new HttpError(400, "Upload a PNG in the 'file' field.");
    const png = new Uint8Array(await file.toBuffer());
    const recordId = vault.identify(png);
    requireRecordAccess(s, recordId);
    const opened = vault.open(recordId, png);
    db.audit(s.sub, "record.verify", `record:${recordId}`);
    return { recordId, title: opened.meta.title, verification: opened.verification };
  });

  // ---------- audit and admin ----------
  app.get("/api/audit", async (req) => {
    const s = auth(req);
    if (s.role === "admin") return { entries: db.auditRecent(300) };
    if (s.role === "patient") {
      const ids = db.listRecords(s.sub).map((r) => r.id);
      return { entries: db.auditRecent(200, [`patient:${s.sub}`, ...ids]) };
    }
    return { entries: db.auditRecent(200).filter((e) => e.actor === s.sub) };
  });

  app.get("/api/audit/verify", async (req) => {
    auth(req, "admin");
    const entries = db.auditAll();
    return { ...verifyChain(entries), entries: entries.length, head: entries.at(-1)?.hash ?? null };
  });

  app.get("/api/admin/users", async (req) => {
    auth(req, "admin");
    return { users: db.listUsers(), counts: db.counts() };
  });

  app.post("/api/admin/users", async (req) => {
    const s = auth(req, "admin");
    const b = z.object({ name: z.string().trim().min(2).max(80), email: z.string().email().max(120), role: z.enum(["doctor", "patient", "admin"]), password: z.string().min(10).max(128) }).parse(req.body);
    if (db.findByEmail(b.email)) throw new HttpError(409, "That email is already registered.");
    const u = db.createUser({ id: randomUUID(), email: b.email, name: b.name, role: b.role }, await hashPassword(b.password));
    db.audit(s.sub, "user.create", `user:${u.id}`, b.role);
    return { user: u };
  });

  const webDist = [resolve(process.cwd(), "apps/web/dist"), resolve(here, "../../web/dist")].find((p) => existsSync(join(p, "index.html")));
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api/") ? reply.status(404).send({ error: "Not found" }) : reply.sendFile("index.html")));
  }
  app.addHook("onClose", async () => db.close());
  return { app, db };
}
