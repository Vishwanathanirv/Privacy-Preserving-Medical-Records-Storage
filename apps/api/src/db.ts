import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GENESIS, auditHash, type AuditEntry } from "@medvault/core";

export type Role = "admin" | "doctor" | "patient";
export type User = { id: string; email: string; name: string; role: Role; createdAt: number };
export type RecordMeta = {
  id: string;
  patientId: string;
  authorId: string;
  authorName: string;
  title: string;
  createdAt: number;
  width: number;
  height: number;
  stegoSha256: string;
  originalSha256: string;
  stats: { layers: number; payloadBytes: number; bitsPerPixel: number; psnr: number; ssim: number; maxPixelChange: number; embedMs: number };
};

type Row = Record<string, unknown>;

export class Db {
  readonly db: DatabaseSync;
  constructor(file = process.env.DB_FILE ?? "./data/medvault.db") {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','doctor','patient')),
        password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id),
        title TEXT NOT NULL, created_at INTEGER NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL,
        stego_png BLOB NOT NULL, stego_sha256 TEXT NOT NULL, original_sha256 TEXT NOT NULL,
        wrapped_key BLOB NOT NULL, stats TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS records_patient ON records (patient_id, created_at);
      CREATE TABLE IF NOT EXISTS grants (
        patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        doctor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        granted_at INTEGER NOT NULL, PRIMARY KEY (patient_id, doctor_id)
      );
      CREATE TABLE IF NOT EXISTS audit (
        seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
        target TEXT NOT NULL, detail TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
      );
    `);
  }

  // ---------- users ----------
  private user = (r: Row | undefined): User | null => (r ? { id: r.id as string, email: r.email as string, name: r.name as string, role: r.role as Role, createdAt: r.created_at as number } : null);

  createUser(u: Omit<User, "createdAt">, passwordHash: string): User {
    this.db.prepare("INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(u.id, u.email.toLowerCase(), u.name, u.role, passwordHash, Date.now());
    return this.getUser(u.id)!;
  }
  getUser(id: string) {
    return this.user(this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined);
  }
  findByEmail(email: string): (User & { passwordHash: string }) | null {
    const r = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as Row | undefined;
    return r ? { ...this.user(r)!, passwordHash: r.password_hash as string } : null;
  }
  listUsers(role?: Role): User[] {
    const rows = (role ? this.db.prepare("SELECT * FROM users WHERE role = ? ORDER BY name").all(role) : this.db.prepare("SELECT * FROM users ORDER BY role, name").all()) as Row[];
    return rows.map((r) => this.user(r)!);
  }
  countUsers() {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  }

  // ---------- consent ----------
  hasGrant(patientId: string, doctorId: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM grants WHERE patient_id = ? AND doctor_id = ?").get(patientId, doctorId));
  }
  grant(patientId: string, doctorId: string) {
    this.db.prepare("INSERT OR IGNORE INTO grants (patient_id, doctor_id, granted_at) VALUES (?, ?, ?)").run(patientId, doctorId, Date.now());
  }
  revoke(patientId: string, doctorId: string) {
    return Number(this.db.prepare("DELETE FROM grants WHERE patient_id = ? AND doctor_id = ?").run(patientId, doctorId).changes) > 0;
  }
  grantsForPatient(patientId: string) {
    return (this.db.prepare("SELECT u.id, u.name, u.email, g.granted_at FROM grants g JOIN users u ON u.id = g.doctor_id WHERE g.patient_id = ? ORDER BY u.name").all(patientId) as Row[]).map((r) => ({ id: r.id as string, name: r.name as string, email: r.email as string, grantedAt: r.granted_at as number }));
  }
  patientsForDoctor(doctorId: string) {
    return (this.db
      .prepare(`SELECT u.id, u.name, u.email, g.granted_at, (SELECT COUNT(*) FROM records r WHERE r.patient_id = u.id) AS records
        FROM grants g JOIN users u ON u.id = g.patient_id WHERE g.doctor_id = ? ORDER BY u.name`)
      .all(doctorId) as Row[]).map((r) => ({ id: r.id as string, name: r.name as string, email: r.email as string, grantedAt: r.granted_at as number, records: r.records as number }));
  }

  // ---------- records ----------
  private meta = (r: Row): RecordMeta => ({
    id: r.id as string,
    patientId: r.patient_id as string,
    authorId: r.author_id as string,
    authorName: (r.author_name as string) ?? "",
    title: r.title as string,
    createdAt: r.created_at as number,
    width: r.width as number,
    height: r.height as number,
    stegoSha256: r.stego_sha256 as string,
    originalSha256: r.original_sha256 as string,
    stats: JSON.parse(r.stats as string),
  });

  insertRecord(m: Omit<RecordMeta, "authorName">, stegoPng: Uint8Array, wrappedKey: Uint8Array) {
    this.db
      .prepare("INSERT INTO records (id, patient_id, author_id, title, created_at, width, height, stego_png, stego_sha256, original_sha256, wrapped_key, stats) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(m.id, m.patientId, m.authorId, m.title, m.createdAt, m.width, m.height, stegoPng, m.stegoSha256, m.originalSha256, wrappedKey, JSON.stringify(m.stats));
  }
  listRecords(patientId: string): RecordMeta[] {
    return (this.db.prepare("SELECT r.*, u.name AS author_name FROM records r JOIN users u ON u.id = r.author_id WHERE patient_id = ? ORDER BY created_at DESC").all(patientId) as Row[]).map(this.meta);
  }
  getRecord(id: string): (RecordMeta & { stegoPng: Uint8Array; wrappedKey: Uint8Array }) | null {
    const r = this.db.prepare("SELECT r.*, u.name AS author_name FROM records r JOIN users u ON u.id = r.author_id WHERE r.id = ?").get(id) as Row | undefined;
    return r ? { ...this.meta(r), stegoPng: new Uint8Array(r.stego_png as Uint8Array), wrappedKey: new Uint8Array(r.wrapped_key as Uint8Array) } : null;
  }
  counts() {
    const c = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return { users: c("SELECT COUNT(*) AS n FROM users"), records: c("SELECT COUNT(*) AS n FROM records"), grants: c("SELECT COUNT(*) AS n FROM grants"), auditEntries: c("SELECT COUNT(*) AS n FROM audit") };
  }

  // ---------- audit chain ----------
  private auditRow = (r: Row): AuditEntry => ({ seq: r.seq as number, ts: r.ts as number, actor: r.actor as string, action: r.action as string, target: r.target as string, detail: r.detail as string, prevHash: r.prev_hash as string, hash: r.hash as string });

  /** Appends an entry linked to the previous one's hash. Runs in a transaction so the chain cannot fork. */
  audit(actor: string, action: string, target: string, detail = ""): AuditEntry {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const last = this.db.prepare("SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1").get() as { seq: number; hash: string } | undefined;
      const base = { seq: (last?.seq ?? 0) + 1, ts: Date.now(), actor, action, target, detail, prevHash: last?.hash ?? GENESIS };
      const e = { ...base, hash: auditHash(base) };
      this.db.prepare("INSERT INTO audit (seq, ts, actor, action, target, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(e.seq, e.ts, e.actor, e.action, e.target, e.detail, e.prevHash, e.hash);
      this.db.exec("COMMIT");
      return e;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
  auditAll(): AuditEntry[] {
    return (this.db.prepare("SELECT * FROM audit ORDER BY seq").all() as Row[]).map(this.auditRow);
  }
  auditRecent(limit = 200, targets?: string[]): AuditEntry[] {
    if (targets) {
      if (!targets.length) return [];
      const q = `SELECT * FROM audit WHERE ${targets.map(() => "target LIKE ?").join(" OR ")} ORDER BY seq DESC LIMIT ?`;
      return (this.db.prepare(q).all(...targets.map((t) => `%${t}%`), limit) as Row[]).map(this.auditRow);
    }
    return (this.db.prepare("SELECT * FROM audit ORDER BY seq DESC LIMIT ?").all(limit) as Row[]).map(this.auditRow);
  }

  close() {
    this.db.close();
  }
}
