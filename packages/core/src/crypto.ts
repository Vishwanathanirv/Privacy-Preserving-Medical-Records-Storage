import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { deflateSync, inflateSync } from "fflate";

/**
 * Envelope encryption. Every record gets its own random 256-bit data key (DEK).
 * The record is compressed and sealed with AES-256-GCM; the DEK is itself sealed with the
 * master key (KEK). The sealed record travels inside the image; the sealed DEK stays in the
 * database. Neither half alone reveals anything.
 */

const VERSION = 1;

export class CryptoError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();

// Layout: version (1) | IV (12) | GCM tag (16) | ciphertext. Runs the same in Node and the browser.
function seal(key: Uint8Array, plain: Uint8Array, aad: string): Uint8Array {
  const iv = randomBytes(12);
  const out = gcm(key, iv, enc.encode(aad)).encrypt(plain);
  const body = out.subarray(0, out.length - 16);
  const sealed = new Uint8Array(29 + body.length);
  sealed[0] = VERSION;
  sealed.set(iv, 1);
  sealed.set(out.subarray(out.length - 16), 13);
  sealed.set(body, 29);
  return sealed;
}

function open(key: Uint8Array, sealed: Uint8Array, aad: string): Uint8Array {
  if (sealed.length < 29 || sealed[0] !== VERSION) throw new CryptoError("Unsupported or corrupted ciphertext");
  const iv = sealed.subarray(1, 13);
  const joined = new Uint8Array(sealed.length - 13);
  joined.set(sealed.subarray(29), 0);
  joined.set(sealed.subarray(13, 29), sealed.length - 29);
  try {
    return gcm(key, iv, enc.encode(aad)).decrypt(joined);
  } catch {
    throw new CryptoError("Integrity check failed: the data was modified or the key is wrong");
  }
}

export type SealedRecord = { ciphertext: Uint8Array; wrappedKey: Uint8Array };

export function encryptRecord(kek: Uint8Array, recordId: string, patientId: string, record: unknown): SealedRecord {
  if (kek.length !== 32) throw new CryptoError("Master key must be 32 bytes");
  const dek = randomBytes(32);
  const plain = deflateSync(enc.encode(JSON.stringify(record)), { level: 9 });
  const ciphertext = seal(dek, plain, `record:${recordId}:${patientId}`);
  const wrappedKey = seal(kek, dek, `dek:${recordId}`);
  dek.fill(0);
  return { ciphertext, wrappedKey };
}

export function decryptRecord<T = unknown>(kek: Uint8Array, recordId: string, patientId: string, s: SealedRecord): T {
  const dek = open(kek, s.wrappedKey, `dek:${recordId}`);
  try {
    return JSON.parse(dec.decode(inflateSync(open(dek, s.ciphertext, `record:${recordId}:${patientId}`)))) as T;
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

/**
 * Seals a short text field (such as a record title, which lists need without opening the record)
 * under the master key, bound to `context` so it cannot be swapped onto another row.
 */
export function encryptField(kek: Uint8Array, context: string, text: string): string {
  return `enc1:${toBase64(seal(kek, enc.encode(text), `field:${context}`))}`;
}

export function decryptField(kek: Uint8Array, context: string, sealed: string): string {
  if (!sealed.startsWith("enc1:")) throw new CryptoError("Field is not encrypted");
  return dec.decode(open(kek, fromBase64(sealed.slice(5)), `field:${context}`));
}

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---------- tamper-evident audit chain ----------

export type AuditEntry = { seq: number; ts: number; actor: string; action: string; target: string; detail: string; prevHash: string; hash: string };

export const GENESIS = "0".repeat(64);

export function auditHash(e: Omit<AuditEntry, "hash">): string {
  return bytesToHex(sha256(enc.encode([e.seq, e.ts, e.actor, e.action, e.target, e.detail, e.prevHash].join("\u001f"))));
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
