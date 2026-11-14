import { MerkleTree, auditLeaf, logKeyId, logPublicKey, signTreeHead, toHex, type AuditEntry, type TreeHead } from "@medvault/core";

/**
 * The signed transparency log over the audit trail. It follows the audit table: every entry is
 * appended to a Merkle tree in sequence order, and tree heads are signed with the log's Ed25519
 * key on request. Heads it has issued are remembered, so an integrity check can prove that each
 * of them is still a prefix of the log rebuilt from storage, i.e. that history was not rewritten.
 * Shared by the API server and the in-browser demo.
 */
export class TransparencyLog {
  private tree = new MerkleTree();
  readonly issued: TreeHead[] = [];
  readonly publicKey: string;
  readonly keyId: string;

  constructor(
    private entries: () => AuditEntry[],
    private secretKey: Uint8Array,
  ) {
    this.publicKey = logPublicKey(secretKey);
    this.keyId = logKeyId(new Uint8Array(this.publicKey.match(/../g)!.map((h) => parseInt(h, 16))));
  }

  /** Appends audit entries the tree has not seen yet. Sequence numbers must be 1, 2, 3, ... */
  private sync() {
    const all = this.entries();
    for (let i = this.tree.size; i < all.length; i++) {
      if (all[i].seq !== i + 1) throw new Error(`Audit sequence gap at ${i + 1}`);
      this.tree.append(auditLeaf(all[i]));
    }
  }

  get size() {
    this.sync();
    return this.tree.size;
  }

  /** A freshly signed head for the current log. */
  head(): TreeHead {
    this.sync();
    const h = signTreeHead(this.secretKey, this.tree.size, this.tree.root());
    const last = this.issued.at(-1);
    if (!last || last.size !== h.size) this.issued.push(h);
    if (this.issued.length > 500) this.issued.splice(0, this.issued.length - 500);
    return h;
  }

  inclusion(seq: number, size: number) {
    this.sync();
    if (size < 1 || size > this.tree.size) throw new RangeError("Tree size out of range");
    if (seq < 1 || seq > size) throw new RangeError("Entry is not in a tree of that size");
    return { index: seq - 1, size, proof: this.tree.inclusionProof(seq - 1, size).map(toHex) };
  }

  consistency(from: number, to: number) {
    this.sync();
    if (from < 1 || from > to || to > this.tree.size) throw new RangeError("Tree sizes out of range");
    return { from, to, proof: this.tree.consistencyProof(from, to).map(toHex) };
  }

  /**
   * Rebuilds the tree from storage and checks every head this log ever signed against it.
   * An edited, deleted or reordered past entry changes the root of every head after it.
   */
  audit(): { headsChecked: number; firstBrokenHead: TreeHead | null } {
    const fresh = new MerkleTree();
    for (const e of this.entries()) fresh.append(auditLeaf(e));
    for (const h of this.issued) {
      if (h.size > fresh.size || toHex(fresh.root(h.size)) !== h.root) return { headsChecked: this.issued.length, firstBrokenHead: h };
    }
    return { headsChecked: this.issued.length, firstBrokenHead: null };
  }
}
