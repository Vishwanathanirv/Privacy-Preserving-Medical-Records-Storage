import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { AuditEntry } from "./crypto";

/**
 * A transparency log over the audit trail, built like Certificate Transparency (RFC 9162):
 * every audit entry is a leaf of a Merkle tree, and the log periodically signs its size and root
 * hash (a "signed tree head"). With that, anyone holding the public key can check two things
 * without trusting the server:
 *
 *  - inclusion: this entry is in the log the server signed (a proof of log2(n) hashes);
 *  - consistency: today's log contains yesterday's log unchanged, only with entries appended.
 *
 * A hash chain can say "something changed"; a signed Merkle log lets a patient prove that the
 * access record they were shown is the one everyone else sees, and lets an auditor prove that no
 * past entry was rewritten or removed between two checkpoints.
 */

const enc = new TextEncoder();
const EMPTY = sha256(new Uint8Array(0));

export const leafHash = (data: Uint8Array) => {
  const b = new Uint8Array(data.length + 1);
  b.set(data, 1);
  return sha256(b);
};

export const nodeHash = (l: Uint8Array, r: Uint8Array) => {
  const b = new Uint8Array(65);
  b[0] = 1;
  b.set(l, 1);
  b.set(r, 33);
  return sha256(b);
};

/** The bytes of an audit entry as a log leaf. Anyone shown the entry can recompute it. */
export const auditLeaf = (e: Pick<AuditEntry, "seq" | "ts" | "actor" | "action" | "target" | "detail">) => enc.encode(["medvault-audit-v1", e.seq, e.ts, e.actor, e.action, e.target, e.detail].join("\u001f"));

const largestPowerOfTwoBelow = (n: number) => {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
};

/** Merkle tree over leaf hashes, with complete subtrees cached (they never change in an append-only log). */
export class MerkleTree {
  private leaves: Uint8Array[] = [];
  private cache = new Map<string, Uint8Array>();

  get size() {
    return this.leaves.length;
  }

  append(leaf: Uint8Array) {
    this.leaves.push(leafHash(leaf));
  }

  appendHash(h: Uint8Array) {
    this.leaves.push(h);
  }

  /** MTH(D[start : start + n]). */
  private mth(start: number, n: number): Uint8Array {
    if (n === 0) return EMPTY;
    if (n === 1) return this.leaves[start];
    const complete = (n & (n - 1)) === 0;
    const key = `${start}:${n}`;
    if (complete) {
      const hit = this.cache.get(key);
      if (hit) return hit;
    }
    const k = largestPowerOfTwoBelow(n);
    const h = nodeHash(this.mth(start, k), this.mth(start + k, n - k));
    if (complete) this.cache.set(key, h);
    return h;
  }

  root(size = this.size): Uint8Array {
    if (size > this.size || size < 0) throw new RangeError("tree size out of range");
    return this.mth(0, size);
  }

  /** Audit path for leaf `m` in the tree of the first `size` leaves (RFC 9162 §2.1.3.1). */
  inclusionProof(m: number, size = this.size): Uint8Array[] {
    if (m < 0 || m >= size || size > this.size) throw new RangeError("leaf or tree size out of range");
    const path = (m: number, start: number, n: number): Uint8Array[] => {
      if (n === 1) return [];
      const k = largestPowerOfTwoBelow(n);
      return m < k ? [...path(m, start, k), this.mth(start + k, n - k)] : [...path(m - k, start + k, n - k), this.mth(start, k)];
    };
    return path(m, 0, size);
  }

  /** Proof that the tree of the first `m` leaves is a prefix of the tree of the first `n` (RFC 9162 §2.1.4.1). */
  consistencyProof(m: number, n = this.size): Uint8Array[] {
    if (m < 1 || m > n || n > this.size) throw new RangeError("tree sizes out of range");
    if (m === n) return [];
    const sub = (m: number, start: number, n: number, b: boolean): Uint8Array[] => {
      if (m === n) return b ? [] : [this.mth(start, n)];
      const k = largestPowerOfTwoBelow(n);
      return m <= k ? [...sub(m, start, k, b), this.mth(start + k, n - k)] : [...sub(m - k, start + k, n - k, false), this.mth(start, k)];
    };
    return sub(m, 0, n, true);
  }
}

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Verifies an inclusion proof (RFC 9162 §2.1.3.2). */
export function verifyInclusion(leaf: Uint8Array, index: number, size: number, proof: Uint8Array[], root: Uint8Array): boolean {
  if (index >= size) return false;
  let fn = index;
  let sn = size - 1;
  let r = leafHash(leaf);
  for (const p of proof) {
    if (sn === 0) return false;
    if (fn & 1 || fn === sn) {
      r = nodeHash(p, r);
      if (!(fn & 1)) {
        while (fn !== 0 && !(fn & 1)) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else r = nodeHash(r, p);
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && eq(r, root);
}

/** Verifies a consistency proof between two tree heads (RFC 9162 §2.1.4.2). */
export function verifyConsistency(size1: number, size2: number, proof: Uint8Array[], root1: Uint8Array, root2: Uint8Array): boolean {
  if (size1 > size2 || size1 < 1) return false;
  if (size1 === size2) return proof.length === 0 && eq(root1, root2);
  let path = proof;
  if ((size1 & (size1 - 1)) === 0) path = [root1, ...proof];
  if (!path.length) return false;
  let fn = size1 - 1;
  let sn = size2 - 1;
  while (fn & 1) {
    fn >>= 1;
    sn >>= 1;
  }
  let fr = path[0];
  let sr = path[0];
  for (const c of path.slice(1)) {
    if (sn === 0) return false;
    if (fn & 1 || fn === sn) {
      fr = nodeHash(c, fr);
      sr = nodeHash(c, sr);
      if (!(fn & 1)) {
        while (fn !== 0 && !(fn & 1)) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else sr = nodeHash(sr, c);
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && eq(fr, root1) && eq(sr, root2);
}

// ---------- signed tree heads ----------

export type TreeHead = { size: number; root: string; timestamp: number; signature: string; keyId: string };

const sthMessage = (size: number, root: string, timestamp: number) => enc.encode(`medvault-sth-v1\n${size}\n${root}\n${timestamp}`);

export const logKeyId = (publicKey: Uint8Array) => bytesToHex(sha256(publicKey)).slice(0, 16);

export function signTreeHead(secretKey: Uint8Array, size: number, root: Uint8Array, timestamp = Date.now()): TreeHead {
  const rootHex = bytesToHex(root);
  const signature = bytesToHex(ed25519.sign(sthMessage(size, rootHex, timestamp), secretKey));
  return { size, root: rootHex, timestamp, signature, keyId: logKeyId(ed25519.getPublicKey(secretKey)) };
}

export function verifyTreeHead(publicKeyHex: string, h: TreeHead): boolean {
  try {
    return ed25519.verify(hexToBytes(h.signature), sthMessage(h.size, h.root, h.timestamp), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export const logPublicKey = (secretKey: Uint8Array) => bytesToHex(ed25519.getPublicKey(secretKey));
export const toHex = bytesToHex;
export const fromHex = hexToBytes;
