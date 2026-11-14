import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Envelope encryption. Every record gets its own random 256-bit data key (DEK).
 * The record is compressed and sealed with AES-256-GCM; the DEK is itself sealed with the
 * master key (KEK). The sealed record travels inside the image; the sealed DEK stays in the
 * database. Neither half alone reveals anything.
 */

const VERSION = 1;

export class CryptoError extends Error {}

function seal(key: Uint8Array, plain: Uint8Array, aad: string): Uint8Array {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return new Uint8Array(Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), body]));
}

function open(key: Uint8Array, sealed: Uint8Array, aad: string): Uint8Array {
  if (sealed.length < 29 || sealed[0] !== VERSION) throw new CryptoError("Unsupported or corrupted ciphertext");
  const iv = sealed.subarray(1, 13);
  const tag = sealed.subarray(13, 29);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  try {
    return new Uint8Array(Buffer.concat([d.update(sealed.subarray(29)), d.final()]));
  } catch {
    throw new CryptoError("Integrity check failed: the data was modified or the key is wrong");
  }
}

export type SealedRecord = { ciphertext: Uint8Array; wrappedKey: Uint8Array };

export function encryptRecord(kek: Uint8Array, recordId: string, patientId: string, record: unknown): SealedRecord {
  if (kek.length !== 32) throw new CryptoError("Master key must be 32 bytes");
  const dek = randomBytes(32);
  const plain = deflateRawSync(Buffer.from(JSON.stringify(record)), { level: 9 });
  const ciphertext = seal(dek, plain, `record:${recordId}:${patientId}`);
  const wrappedKey = seal(kek, dek, `dek:${recordId}`);
  dek.fill(0);
  return { ciphertext, wrappedKey };
}

export function decryptRecord<T = unknown>(kek: Uint8Array, recordId: string, patientId: string, s: SealedRecord): T {
  const dek = open(kek, s.wrappedKey, `dek:${recordId}`);
  try {
    return JSON.parse(inflateRawSync(open(dek, s.ciphertext, `record:${recordId}:${patientId}`)).toString("utf8")) as T;
  } finally {
    dek.fill(0);
  }
}

/** Re-wraps a data key under a new master key without touching the record or image (key rotation). */
export function rewrapKey(oldKek: Uint8Array, newKek: Uint8Array, recordId: string, wrappedKey: Uint8Array): Uint8Array {
  const dek = open(oldKek, wrappedKey, `dek:${recordId}`);
  try {
    return seal(newKek, dek, `dek:${recordId}`);
  } finally {
    dek.fill(0);
  }
}

// ---------- tamper-evident audit chain ----------

export type AuditEntry = { seq: number; ts: number; actor: string; action: string; target: string; detail: string; prevHash: string; hash: string };

export const GENESIS = "0".repeat(64);

export function auditHash(e: Omit<AuditEntry, "hash">): string {
  return createHash("sha256").update([e.seq, e.ts, e.actor, e.action, e.target, e.detail, e.prevHash].join("\u001f")).digest("hex");
}

/** Checks that every entry links to the previous one and that no field was edited. */
export function verifyChain(entries: AuditEntry[]): { ok: boolean; brokenAt: number | null } {
  let prev = GENESIS;
  for (const e of entries) {
    const { hash, ...rest } = e;
    if (e.prevHash !== prev || auditHash(rest) !== hash) return { ok: false, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true, brokenAt: null };
}
