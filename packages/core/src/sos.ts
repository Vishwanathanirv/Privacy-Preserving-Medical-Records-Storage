import { randomBytes } from "@noble/ciphers/utils.js";
import { scrypt, scryptAsync } from "@noble/hashes/scrypt.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { CryptoError, fromBase64, open, seal, toBase64 } from "./crypto";

/**
 * The emergency (break-glass) card. The patient's device makes a random 100-bit card code and
 * stretches it with scrypt into two keys: one encrypts the emergency summary (AES-256-GCM), the
 * other proves to the server that the opener holds the card. The server keeps only the sealed
 * summary and a SHA-256 of the access key, so it can log every opening but can never read the
 * summary, and a stolen database gives an attacker nothing to brute-force in practice (2^100 codes,
 * each guess costing a full scrypt).
 */

export type EmergencySummary = {
  name: string;
  bloodType: string;
  allergies: string[];
  conditions: string[];
  medications: string[];
  contact: { name: string; phone: string };
  notes?: string;
};

export type IssuedCard = { id: string; code: string; salt: string; authHash: string; sealed: string };

/** scrypt cost: about a quarter of a second in a browser, for every guess. */
export const CARD_KDF = { N: 2 ** 15, r: 8, p: 1, dkLen: 64 };

const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ0123456789"; // Crockford-style: no I, L, O, U
const enc = new TextEncoder();
const dec = new TextDecoder();

/** 20 characters from a 32-symbol alphabet: 100 bits, written as four groups of five. */
export function newCardCode(): string {
  const bytes = randomBytes(20);
  let s = "";
  for (const b of bytes) s += ALPHABET[b & 31];
  return s.match(/.{5}/g)!.join("-");
}

/** Upper-cases and drops separators, and maps easily confused characters, so a typed code still works. */
export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
}

function split(k: Uint8Array) {
  return { encKey: k.slice(0, 32), authKey: k.slice(32, 64) };
}

export const cardAuthHash = (authKey: Uint8Array) => bytesToHex(sha256(authKey));

/** Issues a card (synchronously, for seeding; the browser can call it directly too). */
export function issueCard(summary: EmergencySummary, id: string = globalThis.crypto.randomUUID()): IssuedCard {
  const code = newCardCode();
  const salt = randomBytes(16);
  const { encKey, authKey } = split(scrypt(normaliseCode(code), salt, CARD_KDF));
  const sealed = seal(encKey, enc.encode(JSON.stringify(summary)), `sos:${id}`);
  return { id, code, salt: bytesToHex(salt), authHash: cardAuthHash(authKey), sealed: toBase64(sealed) };
}

/** The opener's side: derive both keys from the code and the card's salt. */
export async function deriveCardKeys(code: string, saltHex: string) {
  return split(await scryptAsync(normaliseCode(code), hexToBytes(saltHex), CARD_KDF));
}

export function openCard(encKey: Uint8Array, id: string, sealedB64: string): EmergencySummary {
  try {
    return JSON.parse(dec.decode(open(encKey, fromBase64(sealedB64), `sos:${id}`))) as EmergencySummary;
  } catch {
    throw new CryptoError("This code does not open this card");
  }
}

/** Compares two hex strings in constant time. */
export function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Hex to bytes, returning an empty array instead of throwing on bad input. */
export function hexToBytesSafe(h: string): Uint8Array {
  try {
    return hexToBytes(h);
  } catch {
    return new Uint8Array(0);
  }
}
