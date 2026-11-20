import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GENESIS, auditHash, type AuditEntry } from "@medvault/core";

export type { RecordMeta, Role, User } from "./types";
import type { EmergencyCardRow, Loan, RecordMeta, Role, User } from "./types";

type Row = Record<string, unknown>;

export class Db {
  readonly db: DatabaseSync;
  constructor(file = process.env.DB_FILE ?? "./data/medvault.db") {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA secure_delete = ON; -- deleted data, such as an ended loan's key, is zeroed on disk
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
        wrapped_key BLOB NOT NULL, stats TEXT NOT NULL, scan TEXT
      );
      CREATE INDEX IF NOT EXISTS records_patient ON records (patient_id, created_at);
      CREATE TABLE IF NOT EXISTS grants (
        patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        doctor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        granted_at INTEGER NOT NULL, PRIMARY KEY (patient_id, doctor_id)
      );
      CREATE TABLE IF NOT EXISTS loans (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
        patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        doctor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        wrapped_key BLOB, ended_at INTEGER, end_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS loans_doctor ON loans (doctor_id, ended_at);
      CREATE INDEX IF NOT EXISTS loans_patient ON loans (patient_id, created_at);
      CREATE TABLE IF NOT EXISTS sos_cards (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, salt TEXT NOT NULL, auth_hash TEXT NOT NULL,
        sealed TEXT NOT NULL, revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS audit (
        seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
        target TEXT NOT NULL, detail TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
      );
    `);
    // Databases created before DICOM support lack the scan column.
    const cols = this.db.prepare("PRAGMA table_info(records)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "scan")) this.db.exec("ALTER TABLE records ADD COLUMN scan TEXT");
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
    ...(r.scan ? { scan: JSON.parse(r.scan as string) } : {}),
  });

  insertRecord(m: Omit<RecordMeta, "authorName">, stegoPng: Uint8Array, wrappedKey: Uint8Array) {
    this.db
      .prepare("INSERT INTO records (id, patient_id, author_id, title, created_at, width, height, stego_png, stego_sha256, original_sha256, wrapped_key, stats, scan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(m.id, m.patientId, m.authorId, m.title, m.createdAt, m.width, m.height, stegoPng, m.stegoSha256, m.originalSha256, wrappedKey, JSON.stringify(m.stats), m.scan ? JSON.stringify(m.scan) : null);
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

  // ---------- loans ----------
  private loan = (r: Row): Loan => ({
    id: r.id as string,
    recordId: r.record_id as string,
    patientId: r.patient_id as string,
    doctorId: r.doctor_id as string,
    createdAt: r.created_at as number,
    expiresAt: r.expires_at as number,
    wrappedKey: r.wrapped_key ? new Uint8Array(r.wrapped_key as Uint8Array) : null,
    endedAt: (r.ended_at as number | null) ?? null,
    endReason: (r.end_reason as Loan["endReason"]) ?? null,
  });
  insertLoan(l: Loan) {
    this.db.prepare("INSERT INTO loans (id, record_id, patient_id, doctor_id, created_at, expires_at, wrapped_key, ended_at, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(l.id, l.recordId, l.patientId, l.doctorId, l.createdAt, l.expiresAt, l.wrappedKey, l.endedAt, l.endReason);
  }
  getLoan(id: string) {
    const r = this.db.prepare("SELECT * FROM loans WHERE id = ?").get(id) as Row | undefined;
    return r ? this.loan(r) : null;
  }
  listLoans(by: { patientId?: string; doctorId?: string }) {
    const rows = by.patientId ? this.db.prepare("SELECT * FROM loans WHERE patient_id = ? ORDER BY created_at DESC").all(by.patientId) : this.db.prepare("SELECT * FROM loans WHERE doctor_id = ? ORDER BY created_at DESC").all(by.doctorId ?? "");
    return (rows as Row[]).map(this.loan);
  }
  dueLoans(now: number) {
    return (this.db.prepare("SELECT * FROM loans WHERE ended_at IS NULL AND expires_at <= ?").all(now) as Row[]).map(this.loan);
  }
  /** Ends a loan. Its wrapped key is removed (and zeroed on disk, see secure_delete), so the loan can never open the record again. */
  endLoan(id: string, reason: "expired" | "revoked", at: number) {
    this.db.prepare("UPDATE loans SET wrapped_key = NULL, ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL").run(at, reason, id);
  }

  // ---------- emergency cards ----------
  private card = (r: Row): EmergencyCardRow => ({ id: r.id as string, patientId: r.patient_id as string, createdAt: r.created_at as number, salt: r.salt as string, authHash: r.auth_hash as string, sealed: r.sealed as string, revokedAt: (r.revoked_at as number | null) ?? null });
  insertCard(c: EmergencyCardRow) {
    this.db.prepare("INSERT INTO sos_cards (id, patient_id, created_at, salt, auth_hash, sealed, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(c.id, c.patientId, c.createdAt, c.salt, c.authHash, c.sealed, c.revokedAt);
  }
  getCard(id: string) {
    const r = this.db.prepare("SELECT * FROM sos_cards WHERE id = ?").get(id) as Row | undefined;
    return r ? this.card(r) : null;
  }
  activeCard(patientId: string) {
    const r = this.db.prepare("SELECT * FROM sos_cards WHERE patient_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1").get(patientId) as Row | undefined;
    return r ? this.card(r) : null;
  }
  revokeCard(id: string, at: number) {
    this.db.prepare("UPDATE sos_cards SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(at, id);
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
