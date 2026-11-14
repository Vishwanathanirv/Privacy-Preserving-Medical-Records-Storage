import { scryptAsync } from "@noble/hashes/scrypt.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { GENESIS, auditHash, verifyChain, type AuditEntry } from "@medvault/core";
import type { RecordMeta, Role, User } from "../../../api/src/types";
import { RecordInput } from "../../../api/src/schema";
import { DEMO_PASSWORD, seedDemo } from "../../../api/src/seed";
import { TransparencyLog } from "../../../api/src/translog";
import { Vault, VaultError } from "../../../api/src/vault";

/**
 * In-browser version of the MedVault server, used for the hosted demo. Record encryption,
 * reversible embedding, verification, consent checks and the hash-chained audit log are the
 * same code the Node server runs (the Vault class is imported from the API). Only storage is
 * different: an in-memory database saved to this browser's localStorage, so each visitor gets a
 * private sandbox and nothing leaves the machine.
 */

type StoredRecord = Omit<RecordMeta, "authorName"> & { stegoPng: Uint8Array; wrappedKey: Uint8Array };
type StoredUser = User & { passwordHash: string };
type Grant = { patientId: string; doctorId: string; grantedAt: number };
type State = { kek: string; logKey: string; users: StoredUser[]; records: StoredRecord[]; grants: Grant[]; audit: AuditEntry[]; session: string | null };

const STORAGE_KEY = "medvault-demo-v3";
const SCRYPT = { N: 16384, r: 8, p: 1 };

const b64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const h = await scryptAsync(pw, salt, { ...SCRYPT, dkLen: 32 });
  return `scrypt$${SCRYPT.N}$${bytesToHex(salt)}$${bytesToHex(h)}`;
}

async function verifyPassword(pw: string, stored: string) {
  const [, n, salt, hash] = stored.split("$");
  const salted = Uint8Array.from(salt.match(/../g)!.map((h) => parseInt(h, 16)));
  const h = bytesToHex(await scryptAsync(pw, salted, { N: Number(n), r: 8, p: 1, dkLen: 32 }));
  let diff = h.length ^ hash.length;
  for (let i = 0; i < Math.min(h.length, hash.length); i++) diff |= h.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

/** Implements the same methods as the server's SQLite Db class, over plain arrays. */
class MemoryDb {
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

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Reply = { status: number; data: unknown };

class DemoServer {
  private db!: MemoryDb;
  private vault!: Vault;
  private tlog!: TransparencyLog;
  readonly ready: Promise<void>;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.ready = this.boot();
  }

  private async boot() {
    const saved = this.load();
    const state: State = saved ?? { kek: b64(randomBytes(32)), logKey: b64(randomBytes(32)), users: [], records: [], grants: [], audit: [], session: null };
    this.db = new MemoryDb(state, () => this.scheduleSave());
    this.vault = new Vault(this.db, unb64(state.kek));
    this.tlog = new TransparencyLog(() => this.db.auditAll(), unb64(state.logKey));
    if (!saved) {
      await new Promise((r) => setTimeout(r, 0));
      seedDemo(this.db, this.vault, await hashPassword(DEMO_PASSWORD));
      this.persist();
    }
  }

  private load(): State | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      s.records = s.records.map((r: StoredRecord & { stegoPng: string; wrappedKey: string }) => ({ ...r, stegoPng: unb64(r.stegoPng), wrappedKey: unb64(r.wrappedKey) }));
      return s as State;
    } catch {
      return null;
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 50);
  }

  private persist() {
    try {
      const s = this.db.s;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, records: s.records.map((r) => ({ ...r, stegoPng: b64(r.stegoPng), wrappedKey: b64(r.wrappedKey) })) }));
    } catch {
      // Storage full or unavailable (private window): the sandbox keeps working in memory.
    }
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

  private get session(): User | null {
    return this.db.s.session ? this.db.getUser(this.db.s.session) : null;
  }

  private auth(...roles: Role[]): User {
    const s = this.session;
    if (!s) throw new HttpError(401, "Please sign in.");
    if (roles.length && !roles.includes(s.role)) throw new HttpError(403, "Your role cannot do this.");
    return s;
  }

  private canAccessPatient(s: User, patientId: string) {
    return (s.role === "patient" && s.id === patientId) || (s.role === "doctor" && this.db.hasGrant(patientId, s.id));
  }

  private requireRecordAccess(s: User, recordId: string) {
    const r = this.db.getRecord(recordId);
    if (!r || !this.canAccessPatient(s, r.patientId)) {
      this.db.audit(s.id, "record.denied", `record:${recordId}`, s.role);
      throw new HttpError(404, "Record not found");
    }
    return r;
  }

  async handle(method: string, url: string, body: unknown): Promise<Reply> {
    await this.ready;
    try {
      return { status: 200, data: await this.route(method, url, body) };
    } catch (e) {
      if ((e as Error).name === "ZodError") {
        const issues = (e as unknown as { issues: { path: (string | number)[]; message: string }[] }).issues;
        return { status: 400, data: { error: issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") } };
      }
      if (e instanceof VaultError) return { status: e.status, data: { error: e.message, stage: e.stage } };
      if (e instanceof HttpError) return { status: e.status, data: { error: e.message } };
      console.error(e);
      return { status: 500, data: { error: "Internal error" } };
    }
  }

  /** PNG bytes for an image endpoint, with the same access checks and audit entries as the server. */
  async image(recordId: string, variant: "stego" | "original" | "diff"): Promise<Uint8Array> {
    await this.ready;
    const s = this.auth("doctor", "patient");
    this.requireRecordAccess(s, recordId);
    const png = this.vault.image(recordId, variant);
    if (variant !== "stego") this.db.audit(s.id, `image.${variant}`, `record:${recordId}`);
    return png;
  }

  /** A record's file for download (stored stego file, or the rebuilt original), with the server's checks. */
  async file(recordId: string, kind: "stored" | "original") {
    await this.ready;
    const s = this.auth("doctor", "patient");
    this.requireRecordAccess(s, recordId);
    const f = this.vault.file(recordId, kind);
    if (kind === "original") this.db.audit(s.id, "file.original", `record:${recordId}`);
    return f;
  }

  private async route(method: string, url: string, body: unknown): Promise<unknown> {
    const p = new URL(url, "http://demo.local").pathname;
    const db = this.db;
    let m: RegExpMatchArray | null;

    // ---------- auth ----------
    if (method === "POST" && p === "/api/auth/login") {
      const { email = "", password = "" } = (body ?? {}) as { email?: string; password?: string };
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "email: Invalid email");
      const u = db.findByEmail(email);
      if (!u || !(await verifyPassword(password, u.passwordHash))) {
        db.audit(email.toLowerCase(), "auth.failed", "auth");
        throw new HttpError(401, "Email or password is incorrect.");
      }
      db.s.session = u.id;
      db.audit(u.id, "auth.login", `user:${u.id}`);
      return { user: { id: u.id, name: u.name, email: u.email, role: u.role } };
    }
    if (method === "POST" && p === "/api/auth/logout") {
      if (this.session) db.audit(this.session.id, "auth.logout", `user:${this.session.id}`);
      db.s.session = null;
      this.scheduleSave();
      return { ok: true };
    }
    if (method === "GET" && p === "/api/me") return { user: this.auth() };
    if (method === "GET" && p === "/api/health") return { ok: true, ...db.counts(), browser: true };

    // ---------- people ----------
    if (method === "GET" && p === "/api/doctors") {
      this.auth("patient", "admin");
      return { doctors: db.listUsers("doctor").map(({ id, name, email }) => ({ id, name, email })) };
    }
    if (method === "GET" && p === "/api/patients") {
      const s = this.auth("doctor", "patient");
      return { patients: s.role === "doctor" ? db.patientsForDoctor(s.id) : [{ ...db.getUser(s.id)!, records: db.listRecords(s.id).length }] };
    }
    if ((m = p.match(/^\/api\/patients\/([^/]+)$/)) && method === "GET") {
      const s = this.auth("doctor", "patient");
      if (!this.canAccessPatient(s, m[1])) throw new HttpError(404, "Patient not found");
      const u = db.getUser(m[1])!;
      return { patient: { id: u.id, name: u.name, email: u.email }, records: db.listRecords(m[1]) };
    }

    // ---------- consent ----------
    if (method === "GET" && p === "/api/consent") return { grants: db.grantsForPatient(this.auth("patient").id) };
    if ((m = p.match(/^\/api\/consent\/([^/]+)$/))) {
      const s = this.auth("patient");
      if (method === "PUT") {
        if (db.getUser(m[1])?.role !== "doctor") throw new HttpError(404, "Doctor not found");
        db.grant(s.id, m[1]);
        db.audit(s.id, "consent.grant", `patient:${s.id}`, `doctor:${m[1]}`);
      } else if (method === "DELETE") {
        if (db.revoke(s.id, m[1])) db.audit(s.id, "consent.revoke", `patient:${s.id}`, `doctor:${m[1]}`);
      }
      return { grants: db.grantsForPatient(s.id) };
    }

    // ---------- records ----------
    if ((m = p.match(/^\/api\/patients\/([^/]+)\/records$/)) && method === "POST") {
      const s = this.auth("doctor");
      if (!db.hasGrant(m[1], s.id)) throw new HttpError(404, "Patient not found");
      let fields: Record<string, unknown> = (body ?? {}) as Record<string, unknown>;
      let scan: Uint8Array | undefined;
      if (body instanceof FormData) {
        fields = {};
        for (const [k, v] of body.entries()) {
          if (typeof v === "string") fields[k] = v;
          else if (v.size) {
            if (v.size > 25 * 1024 * 1024) throw new HttpError(413, "File is larger than 25 MB.");
            scan = new Uint8Array(await v.arrayBuffer());
          }
        }
      }
      const data = typeof fields.record === "string" ? JSON.parse(fields.record) : fields;
      const rec = RecordInput.parse(data);
      await new Promise((r) => setTimeout(r, 0));
      const meta = this.vault.create(m[1], { id: s.id, name: s.name }, rec, scan);
      db.audit(s.id, "record.create", `record:${meta.id}`, `patient:${m[1]}`);
      return { record: meta };
    }
    if ((m = p.match(/^\/api\/records\/([^/]+)$/)) && method === "GET") {
      const s = this.auth("doctor", "patient");
      this.requireRecordAccess(s, m[1]);
      const opened = this.vault.open(m[1]);
      db.audit(s.id, "record.view", `record:${m[1]}`, `patient:${opened.meta.patientId}`);
      const { stegoPng: _s, wrappedKey: _w, ...meta } = opened.meta;
      return { meta, record: opened.record, verification: opened.verification };
    }
    if ((m = p.match(/^\/api\/records\/([^/]+)\/tamper-test$/)) && method === "POST") {
      const s = this.auth("doctor", "patient");
      this.requireRecordAccess(s, m[1]);
      return this.vault.tamperTest(m[1]);
    }
    if (method === "POST" && p === "/api/verify") {
      const s = this.auth("doctor", "patient");
      const file = body instanceof FormData ? body.get("file") : null;
      if (!(file instanceof Blob)) throw new HttpError(400, "Upload a PNG in the 'file' field.");
      const png = new Uint8Array(await file.arrayBuffer());
      const recordId = this.vault.identify(png);
      this.requireRecordAccess(s, recordId);
      const opened = this.vault.open(recordId, png);
      db.audit(s.id, "record.verify", `record:${recordId}`);
      return { recordId, title: opened.meta.title, verification: opened.verification };
    }

    // ---------- audit and admin ----------
    if (method === "GET" && p === "/api/audit") {
      const s = this.auth();
      if (s.role === "admin") return { entries: db.auditRecent(300) };
      if (s.role === "patient") return { entries: db.auditRecent(200, [`patient:${s.id}`, ...db.listRecords(s.id).map((r) => r.id)]) };
      return { entries: db.auditRecent(200).filter((e) => e.actor === s.id) };
    }
    if (method === "GET" && p === "/api/audit/verify") {
      this.auth("admin");
      const entries = db.auditAll();
      return { ...verifyChain(entries), entries: entries.length, head: entries.at(-1)?.hash ?? null, transparency: this.tlog.audit() };
    }
    if (method === "GET" && p === "/api/log/head") {
      this.auth();
      return { head: this.tlog.head(), publicKey: this.tlog.publicKey, keyId: this.tlog.keyId };
    }
    if ((m = p.match(/^\/api\/log\/inclusion\/(\d+)$/)) && method === "GET") {
      const s = this.auth();
      const seq = Number(m[1]);
      const size = Number(new URL(url, "http://demo.local").searchParams.get("size"));
      const entry = db.auditAll()[seq - 1];
      const visible =
        s.role === "admin" ||
        (s.role === "patient" && entry && [`patient:${s.id}`, ...db.listRecords(s.id).map((r) => r.id)].some((k) => entry.target.includes(k))) ||
        (s.role === "doctor" && entry?.actor === s.id);
      if (!entry || !visible) throw new HttpError(404, "Entry not found");
      try {
        return { entry, ...this.tlog.inclusion(seq, size) };
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    if (method === "GET" && p === "/api/log/consistency") {
      this.auth();
      const q = new URL(url, "http://demo.local").searchParams;
      try {
        return this.tlog.consistency(Number(q.get("from")), Number(q.get("to")));
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    if (method === "GET" && p === "/api/admin/users") {
      this.auth("admin");
      return { users: db.listUsers(), counts: db.counts() };
    }
    if (method === "POST" && p === "/api/admin/users") {
      const s = this.auth("admin");
      const b = (body ?? {}) as { name?: string; email?: string; role?: Role; password?: string };
      const name = (b.name ?? "").trim();
      if (name.length < 2 || name.length > 80) throw new HttpError(400, "name: must be 2 to 80 characters");
      if (!/^\S+@\S+\.\S+$/.test(b.email ?? "")) throw new HttpError(400, "email: Invalid email");
      if (!["doctor", "patient", "admin"].includes(b.role ?? "")) throw new HttpError(400, "role: invalid role");
      if ((b.password ?? "").length < 10) throw new HttpError(400, "password: at least 10 characters");
      if (db.findByEmail(b.email!)) throw new HttpError(409, "That email is already registered.");
      const u = db.createUser({ id: crypto.randomUUID(), email: b.email!, name, role: b.role! }, await hashPassword(b.password!));
      db.audit(s.id, "user.create", `user:${u.id}`, b.role!);
      return { user: u };
    }
    throw new HttpError(404, "Not found");
  }
}

export const demo = new DemoServer();
