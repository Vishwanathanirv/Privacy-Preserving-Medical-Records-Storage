import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./db";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const OPTS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 64, OPTS);
  return `scrypt$${OPTS.N}$${salt.toString("base64url")}$${h.toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [algo, n, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(pw, Buffer.from(salt, "base64url"), expected.length, { ...OPTS, N: Number(n) });
  return timingSafeEqual(actual, expected);
}

/**
 * Loads a 32-byte secret from an environment variable (base64), or in development creates one
 * in the data directory. Production refuses to start without explicit keys.
 */
export function loadKey(envName: string, file: string): Uint8Array {
  const env = process.env[envName];
  if (env) {
    const k = Buffer.from(env, "base64");
    if (k.length !== 32) throw new Error(`${envName} must be 32 bytes, base64-encoded (openssl rand -base64 32)`);
    return new Uint8Array(k);
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_GENERATED_KEYS !== "true") {
    throw new Error(`${envName} is required in production (openssl rand -base64 32)`);
  }
  if (file === ":memory:") return new Uint8Array(randomBytes(32));
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  mkdirSync(dirname(file), { recursive: true });
  const k = randomBytes(32);
  writeFileSync(file, k, { mode: 0o600 });
  return new Uint8Array(k);
}

export type Session = { sub: string; role: Role; name: string };
export const COOKIE = "mv_session";

export const signSession = (secret: Uint8Array, s: Session) =>
  new SignJWT({ role: s.role, name: s.name }).setProtectedHeader({ alg: "HS256" }).setSubject(s.sub).setIssuedAt().setExpirationTime("8h").sign(secret);

export async function readSession(secret: Uint8Array, token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return { sub: String(payload.sub), role: payload.role as Role, name: String(payload.name) };
  } catch {
    return null;
  }
}
