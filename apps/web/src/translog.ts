import { auditLeaf, fromHex, verifyConsistency, verifyInclusion, verifyTreeHead, type TreeHead } from "@medvault/core";
import { api, type AuditEntry } from "./lib";

/**
 * Checks done here, in the browser, with the log's public key: the server is not trusted to say
 * "verified". The first key seen is pinned in this browser (trust on first use), and the last
 * tree head seen is kept, so the next visit can prove the log only grew in between.
 */

export type HeadInfo = { head: TreeHead; publicKey: string; keyId: string };

const KEY_PIN = "medvault-log-key";
const LAST_HEAD = "medvault-log-head";

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // Private mode: checks still run, nothing is remembered.
  }
};

export type HeadCheck = { info: HeadInfo; signatureOk: boolean; keyPinned: "new" | "same" | "changed" };

export async function fetchHead(): Promise<HeadCheck> {
  const info = await api<HeadInfo>("/api/log/head");
  const pinned = read(KEY_PIN);
  const keyPinned = !pinned ? "new" : pinned === info.publicKey ? "same" : "changed";
  if (!pinned) write(KEY_PIN, info.publicKey);
  return { info, signatureOk: verifyTreeHead(pinned ?? info.publicKey, info.head), keyPinned };
}

/** Proves that `e` (exactly as shown) is in the log the server signed. */
export async function verifyEntry(e: AuditEntry, check: HeadCheck): Promise<boolean> {
  if (!check.signatureOk || e.seq > check.info.head.size) return false;
  const p = await api<{ index: number; size: number; proof: string[] }>(`/api/log/inclusion/${e.seq}?size=${check.info.head.size}`);
  return verifyInclusion(auditLeaf(e), p.index, p.size, p.proof.map(fromHex), fromHex(check.info.head.root));
}

export type GrowthCheck = { previous: TreeHead | null; consistent: boolean | null };

/** Proves the log seen on the last visit is an unchanged prefix of today's, then remembers today's. */
export async function checkGrowth(check: HeadCheck): Promise<GrowthCheck> {
  let previous: TreeHead | null = null;
  try {
    previous = JSON.parse(read(LAST_HEAD) ?? "null");
  } catch {
    previous = null;
  }
  const now = check.info.head;
  let consistent: boolean | null = null;
  if (previous && check.signatureOk && verifyTreeHead(check.info.publicKey, previous)) {
    if (previous.size > now.size) consistent = false;
    else if (previous.size === now.size) consistent = previous.root === now.root;
    else {
      const c = await api<{ proof: string[] }>(`/api/log/consistency?from=${previous.size}&to=${now.size}`);
      consistent = verifyConsistency(previous.size, now.size, c.proof.map(fromHex), fromHex(previous.root), fromHex(now.root));
    }
  }
  if (check.signatureOk && consistent !== false) write(LAST_HEAD, JSON.stringify(now));
  return { previous, consistent };
}
