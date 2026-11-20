import { scryptAsync } from "@noble/hashes/scrypt.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { GENESIS, auditHash, fromBase64, toBase64, type AuditEntry } from "@medvault/core";
import type { EmergencyCardRow, Loan, RecordMeta, Role, User } from "../../../api/src/types";
import { DEMO_PASSWORD, seedDemo } from "../../../api/src/seed";
import { Service, type Result, type Session, type Store } from "../../../api/src/service";
import { TransparencyLog } from "../../../api/src/translog";
import { Vault } from "../../../api/src/vault";
import mriUrl from "../../../../samples/brain-mri-t1.png?url";
import xray1Url from "../../../../samples/chest-xray-pa-1.png?url";
import xray2Url from "../../../../samples/chest-xray-pa-2.png?url";

/** The real, openly licensed scans used for the demo records (see samples/README.md). */
async function sampleScans() {
  const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  try {
    const [mri, xray1, xray2] = await Promise.all([get(mriUrl), get(xray1Url), get(xray2Url)]);
    return { mri, xray1, xray2 };
  } catch {
    return {}; // offline: synthetic phantoms instead
  }
}

/**
 * In-browser version of the MedVault server, used for the hosted demo. Every API call goes
 * through the same Service the Node server runs (access control, consent, auditing, the Vault
 * and the transparency log are shared code). Only storage is different: an in-memory database
 * saved to this browser's localStorage, so each visitor gets a private sandbox and nothing
 * leaves the machine. Its master key lives in that same storage, which is fine for a sandbox and
 * is exactly why a real deployment keeps keys on the server.
 */

type StoredRecord = Omit<RecordMeta, "authorName"> & { stegoPng: Uint8Array; wrappedKey: Uint8Array };
type StoredUser = User & { passwordHash: string };
type Grant = { patientId: string; doctorId: string; grantedAt: number };
type State = { kek: string; logKey: string; users: StoredUser[]; records: StoredRecord[]; grants: Grant[]; loans: Loan[]; cards: EmergencyCardRow[]; sosLink: string | null; audit: AuditEntry[]; session: string | null };

const STORAGE_KEY = "medvault-demo-v5";
const SCRYPT = { N: 32768, r: 8, p: 1 };
const DUMMY_HASH = `scrypt$${SCRYPT.N}$${"00".repeat(16)}$${"00".repeat(32)}`;

async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const h = await scryptAsync(pw, salt, { ...SCRYPT, dkLen: 32 });
  return `scrypt$${SCRYPT.N}$${bytesToHex(salt)}$${bytesToHex(h)}`;
}

async function verifyPassword(pw: string, stored: string) {
  const [algo, n, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const salted = Uint8Array.from(salt.match(/../g)!.map((h) => parseInt(h, 16)));
  const h = bytesToHex(await scryptAsync(pw, salted, { N: Number(n), r: 8, p: 1, dkLen: 32 }));
  let diff = h.length ^ hash.length;
  for (let i = 0; i < Math.min(h.length, hash.length); i++) diff |= h.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

/** Implements the same methods as the server's SQLite Db class, over plain arrays. */
class MemoryDb implements Store {
  constructor(public s: State, private save: () => void) {}

  createUser(u: Omit<User, "createdAt">, passwordHash: string): User {
    const user = { ...u, email: u.email.toLowerCase(), createdAt: Date.now(), passwordHash };
    this.s.users.push(user);
    this.save();
    return this.getUser(u.id)!;
  }
  getUser(id: string): User | null {
    const u = this.s.users.find((x) => x.id === id);
    if (!u) return null;
    const { passwordHash: _p, ...rest } = u;
    return rest;
  }
  findByEmail(email: string) {
    return this.s.users.find((u) => u.email === email.toLowerCase()) ?? null;
  }
  listUsers(role?: Role): User[] {
    const order = { admin: 0, doctor: 1, patient: 2 };
    return this.s.users
      .filter((u) => !role || u.role === role)
      .sort((a, b) => (role ? 0 : order[a.role] - order[b.role]) || a.name.localeCompare(b.name))
      .map((u) => this.getUser(u.id)!);
  }
  hasGrant(patientId: string, doctorId: string) {
    return this.s.grants.some((g) => g.patientId === patientId && g.doctorId === doctorId);
  }
  grant(patientId: string, doctorId: string) {
    if (!this.hasGrant(patientId, doctorId)) this.s.grants.push({ patientId, doctorId, grantedAt: Date.now() });
    this.save();
  }
  revoke(patientId: string, doctorId: string) {
    const n = this.s.grants.length;
    this.s.grants = this.s.grants.filter((g) => !(g.patientId === patientId && g.doctorId === doctorId));
    this.save();
    return this.s.grants.length < n;
  }
  grantsForPatient(patientId: string) {
    return this.s.grants
      .filter((g) => g.patientId === patientId)
      .map((g) => {
        const u = this.getUser(g.doctorId)!;
        return { id: u.id, name: u.name, email: u.email, grantedAt: g.grantedAt };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  patientsForDoctor(doctorId: string) {
    return this.s.grants
      .filter((g) => g.doctorId === doctorId)
      .map((g) => {
        const u = this.getUser(g.patientId)!;
        return { id: u.id, name: u.name, email: u.email, grantedAt: g.grantedAt, records: this.s.records.filter((r) => r.patientId === u.id).length };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  insertRecord(m: Omit<RecordMeta, "authorName">, stegoPng: Uint8Array, wrappedKey: Uint8Array) {
    this.s.records.push({ ...m, stegoPng, wrappedKey });
    this.save();
  }
  private withAuthor = (r: StoredRecord) => ({ ...r, authorName: this.getUser(r.authorId)?.name ?? "" });
  listRecords(patientId: string): RecordMeta[] {
    return this.s.records
      .filter((r) => r.patientId === patientId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => {
        const { stegoPng: _s, wrappedKey: _w, ...meta } = this.withAuthor(r);
        return meta;
      });
  }
  getRecord(id: string) {
    const r = this.s.records.find((x) => x.id === id);
    return r ? this.withAuthor(r) : null;
  }
  counts() {
    return { users: this.s.users.length, records: this.s.records.length, grants: this.s.grants.length, auditEntries: this.s.audit.length };
  }
  insertLoan(l: Loan) {
    this.s.loans.push(l);
    this.save();
  }
  getLoan(id: string) {
    return this.s.loans.find((l) => l.id === id) ?? null;
  }
  listLoans(by: { patientId?: string; doctorId?: string }) {
    return this.s.loans.filter((l) => (by.patientId ? l.patientId === by.patientId : l.doctorId === by.doctorId)).sort((a, b) => b.createdAt - a.createdAt);
  }
  dueLoans(now: number) {
    return this.s.loans.filter((l) => !l.endedAt && l.expiresAt <= now);
  }
  endLoan(id: string, reason: "expired" | "revoked", at: number) {
    const l = this.getLoan(id);
    if (!l || l.endedAt) return;
    l.wrappedKey?.fill(0);
    Object.assign(l, { wrappedKey: null, endedAt: at, endReason: reason });
    this.save();
  }
  insertCard(c: EmergencyCardRow) {
    this.s.cards.push(c);
    this.save();
  }
  getCard(id: string) {
    return this.s.cards.find((c) => c.id === id) ?? null;
  }
  activeCard(patientId: string) {
    return this.s.cards.filter((c) => c.patientId === patientId && !c.revokedAt).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }
  revokeCard(id: string, at: number) {
    const c = this.getCard(id);
    if (c && !c.revokedAt) c.revokedAt = at;
    this.save();
  }
  audit(actor: string, action: string, target: string, detail = ""): AuditEntry {
    const last = this.s.audit.at(-1);
    const base = { seq: (last?.seq ?? 0) + 1, ts: Date.now(), actor, action, target, detail, prevHash: last?.hash ?? GENESIS };
    const e = { ...base, hash: auditHash(base) };
    this.s.audit.push(e);
    this.save();
    return e;
  }
  auditAll() {
    return [...this.s.audit];
  }
  auditRecent(limit = 200, targets?: string[]): AuditEntry[] {
    const all = [...this.s.audit].reverse();
    if (targets) return all.filter((e) => targets.some((t) => e.target.includes(t))).slice(0, limit);
    return all.slice(0, limit);
  }
}

type Reply = { status: number; data: unknown };

class DemoServer {
  private db!: MemoryDb;
  private service!: Service;
  readonly ready: Promise<void>;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private flushOnExit = false;

  constructor() {
    this.ready = this.boot();
  }

  private async boot() {
    const saved = this.load();
    const state: State = saved ?? { kek: toBase64(randomBytes(32)), logKey: toBase64(randomBytes(32)), users: [], records: [], grants: [], loans: [], cards: [], sosLink: null, audit: [], session: null };
    this.db = new MemoryDb(state, () => this.scheduleSave());
    const vault = new Vault(this.db, fromBase64(state.kek));
    const tlog = new TransparencyLog(() => this.db.auditAll(), fromBase64(state.logKey));
    this.service = new Service(this.db, vault, tlog, { hash: hashPassword, verify: (pw, stored) => verifyPassword(pw, stored ?? DUMMY_HASH) });
    if (!saved) {
      await new Promise((r) => setTimeout(r, 0));
      const [hash, scans] = await Promise.all([hashPassword(DEMO_PASSWORD), sampleScans()]);
      state.sosLink = seedDemo(this.db, vault, hash, scans).sosLink;
      this.persist();
    }
  }

  private load(): State | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      s.records = s.records.map((r: StoredRecord & { stegoPng: string; wrappedKey: string }) => ({ ...r, stegoPng: fromBase64(r.stegoPng), wrappedKey: fromBase64(r.wrappedKey) }));
      s.loans = (s.loans ?? []).map((l: Loan & { wrappedKey: string | null }) => ({ ...l, wrappedKey: l.wrappedKey ? fromBase64(l.wrappedKey) : null }));
      return s as State;
    } catch {
      return null;
    }
  }

  /** Writes pending changes immediately, cancelling any scheduled save. */
  private saveNow() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.persist();
  }

  private scheduleSave() {
    if (!this.flushOnExit && typeof window !== "undefined") {
      // Never lose a scheduled save to a tab being closed or reloaded.
      this.flushOnExit = true;
      window.addEventListener("pagehide", () => this.saveTimer && this.saveNow());
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 50);
  }

  private persist() {
    try {
      const s = this.db.s;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, records: s.records.map((r) => ({ ...r, stegoPng: toBase64(r.stegoPng), wrappedKey: toBase64(r.wrappedKey) })), loans: s.loans.map((l) => ({ ...l, wrappedKey: l.wrappedKey ? toBase64(l.wrappedKey) : null })) }));
    } catch {
      // Storage full or unavailable (private window): the sandbox keeps working in memory.
    }
  }

  /** The seeded emergency card's link, so the demo can offer "break the glass" without a printed card. */
  async sosLink() {
    await this.ready;
    return this.db.s.sosLink;
  }

  /** Wipes this browser's sandbox and starts again from the demo data. */
  reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    location.assign("/");
  }

  private get session(): Session | null {
    const u = this.db.s.session ? this.db.getUser(this.db.s.session) : null;
    return u ? { sub: u.id, role: u.role, name: u.name } : null;
  }

  /** Runs one API call through the shared service, as the signed-in demo user. */
  async call(method: string, url: string, body: unknown): Promise<Result> {
    await this.ready;
    const u = new URL(url, "http://demo.local");
    let file: Uint8Array | undefined;
    if (body instanceof FormData) {
      const fields: Record<string, string> = {};
      for (const [k, v] of body.entries()) {
        if (typeof v === "string") fields[k] = v;
        else if (v.size) file = new Uint8Array(await v.arrayBuffer());
      }
      body = fields;
    }
    // Let the UI paint before long cryptographic work blocks the thread.
    if (file) await new Promise((r) => setTimeout(r, 0));
    let r: Result;
    try {
      r = await this.service.handle({ method, path: u.pathname, query: u.searchParams, session: this.session, body, file });
    } catch (e) {
      console.error(e);
      return { status: 500, data: { error: "Internal error" } };
    }
    if (r.session !== undefined) {
      this.db.s.session = r.session?.sub ?? null;
      // Who is signed in must never lag behind: a reload right after sign-out must not bring it back.
      this.saveNow();
    }
    return r;
  }

  async handle(method: string, url: string, body: unknown): Promise<Reply> {
    const r = await this.call(method, url, body);
    return { status: r.status, data: r.data };
  }

  /** Bytes of an image or file endpoint, with the same access checks and audit entries as the server. */
  async bytes(url: string): Promise<{ bytes: Uint8Array; type: string; filename?: string }> {
    const r = await this.call("GET", url, undefined);
    if (!r.file) throw new Error((r.data as { error?: string } | undefined)?.error ?? `Request failed (${r.status})`);
    return r.file;
  }
}

export const demo = new DemoServer();
