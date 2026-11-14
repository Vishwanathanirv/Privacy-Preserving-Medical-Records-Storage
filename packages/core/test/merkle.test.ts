import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { MerkleTree, leafHash, nodeHash, signTreeHead, logPublicKey, verifyConsistency, verifyInclusion, verifyTreeHead } from "../src/merkle";

const leaf = (i: number) => new TextEncoder().encode(`entry ${i}`);
const tree = (n: number) => {
  const t = new MerkleTree();
  for (let i = 0; i < n; i++) t.append(leaf(i));
  return t;
};

/** The RFC 9162 definition, written as plainly as possible, to check the cached version against. */
function referenceRoot(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array(0));
  if (leaves.length === 1) return leafHash(leaves[0]);
  let k = 1;
  while (k * 2 < leaves.length) k *= 2;
  return nodeHash(referenceRoot(leaves.slice(0, k)), referenceRoot(leaves.slice(k)));
}

describe("Merkle transparency log", () => {
  it("matches the RFC 9162 tree hash for every size up to 70", () => {
    const t = new MerkleTree();
    const raw: Uint8Array[] = [];
    for (let n = 0; n <= 70; n++) {
      expect(bytesToHex(t.root())).toBe(bytesToHex(referenceRoot(raw)));
      raw.push(leaf(n));
      t.append(leaf(n));
    }
  });

  it("proves inclusion of every leaf in every tree size, and rejects wrong leaves", () => {
    const t = tree(37);
    for (let n = 1; n <= 37; n++) {
      const root = t.root(n);
      for (let m = 0; m < n; m++) {
        const p = t.inclusionProof(m, n);
        expect(verifyInclusion(leaf(m), m, n, p, root)).toBe(true);
        expect(verifyInclusion(leaf(m + 1), m, n, p, root)).toBe(false);
      }
    }
  });

  it("proves consistency between any two sizes, and catches a rewritten past", () => {
    const t = tree(40);
    for (let a = 1; a <= 40; a++)
      for (let b = a; b <= 40; b++) expect(verifyConsistency(a, b, t.consistencyProof(a, b), t.root(a), t.root(b))).toBe(true);
    // Rewrite entry 3 and append: the old head no longer fits inside the new log.
    const forged = new MerkleTree();
    for (let i = 0; i < 45; i++) forged.append(i === 3 ? new TextEncoder().encode("entry 3 (edited)") : leaf(i));
    expect(verifyConsistency(20, 45, forged.consistencyProof(20, 45), t.root(20), forged.root(45))).toBe(false);
  });

  it("signs tree heads that only the log's key can produce", () => {
    const sk = sha256(new TextEncoder().encode("test log key"));
    const h = signTreeHead(sk, 5, tree(5).root(), 1_700_000_000_000);
    const pk = logPublicKey(sk);
    expect(verifyTreeHead(pk, h)).toBe(true);
    expect(verifyTreeHead(pk, { ...h, size: 6 })).toBe(false);
    expect(verifyTreeHead(pk, { ...h, root: bytesToHex(tree(6).root()) })).toBe(false);
    expect(verifyTreeHead(logPublicKey(sha256(new Uint8Array([1]))), h)).toBe(false);
  });
});
