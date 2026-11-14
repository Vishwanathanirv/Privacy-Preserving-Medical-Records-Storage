import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CryptoError, GENESIS, auditHash, decryptRecord, encryptRecord, rewrapKey, verifyChain, type AuditEntry } from "../src/crypto";

const kek = new Uint8Array(randomBytes(32));
const record = { diagnosis: "Community-acquired pneumonia", medications: ["Amoxicillin 500 mg"], notes: "Review in 7 days" };

describe("envelope encryption", () => {
  it("round-trips a record and uses a fresh key and IV every time", () => {
    const a = encryptRecord(kek, "r1", "p1", record);
    const b = encryptRecord(kek, "r1", "p1", record);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
    expect(decryptRecord(kek, "r1", "p1", a)).toEqual(record);
  });

  it("detects any modification and binds the ciphertext to its record and patient", () => {
    const s = encryptRecord(kek, "r1", "p1", record);
    const bad = Uint8Array.from(s.ciphertext);
    bad[bad.length - 1] ^= 1;
    expect(() => decryptRecord(kek, "r1", "p1", { ...s, ciphertext: bad })).toThrow(CryptoError);
    expect(() => decryptRecord(kek, "r1", "p2", s)).toThrow(CryptoError);
    expect(() => decryptRecord(kek, "r2", "p1", s)).toThrow(CryptoError);
    expect(() => decryptRecord(new Uint8Array(randomBytes(32)), "r1", "p1", s)).toThrow(CryptoError);
  });

  it("rotates the master key without touching the record", () => {
    const s = encryptRecord(kek, "r1", "p1", record);
    const next = new Uint8Array(randomBytes(32));
    const wrappedKey = rewrapKey(kek, next, "r1", s.wrappedKey);
    expect(decryptRecord(next, "r1", "p1", { ...s, wrappedKey })).toEqual(record);
  });
});

describe("audit chain", () => {
  const chain: AuditEntry[] = [];
  for (let i = 0; i < 5; i++) {
    const base = { seq: i + 1, ts: 1000 + i, actor: "dr.meera", action: "record.view", target: `r${i}`, detail: "", prevHash: chain.at(-1)?.hash ?? GENESIS };
    chain.push({ ...base, hash: auditHash(base) });
  }
  it("verifies an untouched chain", () => expect(verifyChain(chain)).toEqual({ ok: true, brokenAt: null }));
  it("pinpoints an edited entry", () => {
    const edited = chain.map((e) => ({ ...e }));
    edited[2].actor = "someone-else";
    expect(verifyChain(edited)).toEqual({ ok: false, brokenAt: 3 });
  });
  it("detects a deleted entry", () => expect(verifyChain([chain[0], ...chain.slice(2)]).ok).toBe(false));
});
