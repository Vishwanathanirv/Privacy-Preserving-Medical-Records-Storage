import { z } from "zod";
import { verifyChain, type AuditEntry } from "@medvault/core";
import type { Loan, RecordMeta, Role, User } from "./types";
import { RecordInput } from "./schema";
import type { TransparencyLog } from "./translog";
import { type Vault, VaultError } from "./vault";

/**
 * The MedVault API, independent of transport and storage. The Fastify server and the in-browser
 * demo both call `handle`, so access control, consent, auditing and validation are one piece of
 * code wherever it runs. Adapters only translate requests, sessions and binary responses.
 */

export type Session = { sub: string; role: Role; name: string };

/** Storage the service needs: SQLite on the server, memory in the browser demo. */
export interface Store {
  createUser(u: Omit<User, "createdAt">, passwordHash: string): User;
  getUser(id: string): User | null;
  findByEmail(email: string): (User & { passwordHash: string }) | null;
  listUsers(role?: Role): User[];
  hasGrant(patientId: string, doctorId: string): boolean;
  grant(patientId: string, doctorId: string): void;
  revoke(patientId: string, doctorId: string): boolean;
  grantsForPatient(patientId: string): { id: string; name: string; email: string; grantedAt: number }[];
  patientsForDoctor(doctorId: string): { id: string; name: string; email: string; grantedAt: number; records: number }[];
  listRecords(patientId: string): RecordMeta[];
  counts(): Record<string, number>;
  audit(actor: string, action: string, target: string, detail?: string): AuditEntry;
  auditAll(): AuditEntry[];
  auditRecent(limit?: number, targets?: string[]): AuditEntry[];
  insertLoan(l: Loan): void;
  getLoan(id: string): Loan | null;
  /** Loans given by a patient or held by a doctor, newest first. */
  listLoans(by: { patientId?: string; doctorId?: string }): Loan[];
  /** Loans still marked active whose time is up. */
  dueLoans(now: number): Loan[];
  /** Ends a loan and destroys its wrapped key. */
  endLoan(id: string, reason: "expired" | "revoked", at: number): void;
}

/** How long a record can be lent for, in minutes: from 1 minute up to 30 days. */
export const LOAN_MINUTES = { min: 1, max: 30 * 24 * 60 };

/** Lends a record to a doctor: a fresh loan key is derived and the record's data key re-wrapped under it. */
export function lend(db: Pick<Store, "insertLoan" | "audit">, vault: Vault, terms: { recordId: string; patientId: string; doctorId: string; minutes: number; now: number }): Loan {
  const id = globalThis.crypto.randomUUID();
  const t = { id, recordId: terms.recordId, patientId: terms.patientId, doctorId: terms.doctorId, expiresAt: terms.now + Math.round(terms.minutes * 60_000) };
  const loan: Loan = { ...t, createdAt: terms.now, wrappedKey: vault.wrapForLoan(t), endedAt: null, endReason: null };
  db.insertLoan(loan);
  db.audit(terms.patientId, "loan.create", `record:${terms.recordId}`, `doctor:${terms.doctorId}|loan:${id}|until:${t.expiresAt}`);
  return loan;
}

export type Passwords = { hash(pw: string): Promise<string>; verify(pw: string, stored: string | null): Promise<boolean> };

export type Call = {
  method: string;
  path: string;
  query?: URLSearchParams;
  session: Session | null;
  /** A JSON body, or the text fields of a multipart form. */
  body?: unknown;
  /** The file of a multipart form, if any. */
  file?: Uint8Array;
};

export type Result = {
  status: number;
  data?: unknown;
  file?: { bytes: Uint8Array; type: string; filename?: string };
  /** Set when the call signs someone in (a session) or out (null). */
  session?: Session | null;
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const Id = z.string().uuid();
const Email = z.string().trim().email().max(120);

export class Service {
  constructor(
    private db: Store,
    private vault: Vault,
    private tlog: TransparencyLog,
    private passwords: Passwords,
    private now: () => number = Date.now,
  ) {}

  /**
   * Ends every loan whose time is up: its wrapped key is destroyed and the end is logged. Runs
   * before each call, so an expired loan can never be used, even if nothing else happened since.
   */
  sweepLoans() {
    const now = this.now();
    for (const l of this.db.dueLoans(now)) {
      this.db.endLoan(l.id, "expired", l.expiresAt);
      this.db.audit("system", "loan.expire", `record:${l.recordId}`, `doctor:${l.doctorId}|loan:${l.id}`);
    }
  }

  async handle(c: Call): Promise<Result> {
    try {
      this.sweepLoans();
      return await this.route(c);
    } catch (e) {
      if (e instanceof z.ZodError) return { status: 400, data: { error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") } };
      if (e instanceof VaultError) return { status: e.status, data: { error: e.message, stage: e.stage } };
      if (e instanceof HttpError) return { status: e.status, data: { error: e.message } };
      if (e instanceof SyntaxError) return { status: 400, data: { error: "Malformed request body" } };
      throw e;
    }
  }

  private auth(c: Call, ...roles: Role[]): Session {
    if (!c.session) throw new HttpError(401, "Please sign in.");
    if (roles.length && !roles.includes(c.session.role)) throw new HttpError(403, "Your role cannot do this.");
    return c.session;
  }

  /** Patients see their own data; doctors only what a patient has consented to share. Admins never see clinical data. */
  private canAccessPatient(s: Session, patientId: string) {
    return (s.role === "patient" && s.sub === patientId) || (s.role === "doctor" && this.db.hasGrant(patientId, s.sub));
  }

  /** An active loan of this record to this doctor, if any. */
  private loanFor(recordId: string, doctorId: string): Loan | undefined {
    const now = this.now();
    return this.db.listLoans({ doctorId }).find((l) => l.recordId === recordId && !l.endedAt && l.expiresAt > now && l.wrappedKey);
  }

  /** Who may open a record, and through what: the patient, a doctor they trust, or a doctor holding a loan of it. */
  private requireRecordAccess(s: Session, recordId: string): { meta: RecordMeta; loan?: Loan } {
    const r = this.vault.meta(recordId);
    if (r && this.canAccessPatient(s, r.patientId)) return { meta: r };
    const loan = r && s.role === "doctor" ? this.loanFor(recordId, s.sub) : undefined;
    if (r && loan) return { meta: r, loan };
    this.db.audit(s.sub, "record.denied", `record:${recordId}`, s.role);
    throw new HttpError(404, "Record not found"); // 404, not 403: do not reveal that it exists
  }

  private loanView(l: Loan) {
    const meta = this.vault.meta(l.recordId);
    const doctor = this.db.getUser(l.doctorId);
    const patient = this.db.getUser(l.patientId);
    const { wrappedKey, ...rest } = l;
    return { ...rest, keyHeld: Boolean(wrappedKey), title: meta?.title ?? "Deleted record", doctorName: doctor?.name ?? "", patientName: patient?.name ?? "", record: meta };
  }

  /** Audit entries a user may see, and so request proofs for. */
  private visibleTo(s: Session): (e: AuditEntry) => boolean {
    if (s.role === "admin") return () => true;
    if (s.role === "patient") {
      const keys = this.patientKeys(s.sub);
      return (e) => keys.some((k) => e.target.includes(k));
    }
    return (e) => e.actor === s.sub;
  }

  private patientKeys(patientId: string) {
    return [`patient:${patientId}`, ...this.db.listRecords(patientId).map((r) => r.id)];
  }

  private async route(c: Call): Promise<Result> {
    const { method, path } = c;
    const q = c.query ?? new URLSearchParams();
    const db = this.db;
    const ok = (data: unknown): Result => ({ status: 200, data });
    let m: RegExpMatchArray | null;

    // ---------- auth ----------
    if (method === "POST" && path === "/api/auth/login") {
      const { email, password } = z.object({ email: Email, password: z.string().min(1).max(128) }).parse(c.body);
      const u = db.findByEmail(email);
      // Always run the KDF so response time does not reveal whether the account exists.
      const valid = await this.passwords.verify(password, u?.passwordHash ?? null);
      if (!u || !valid) {
        db.audit(email.toLowerCase(), "auth.failed", "auth");
        throw new HttpError(401, "Email or password is incorrect.");
      }
      db.audit(u.id, "auth.login", `user:${u.id}`);
      return { status: 200, data: { user: { id: u.id, name: u.name, email: u.email, role: u.role } }, session: { sub: u.id, role: u.role, name: u.name } };
    }
    if (method === "POST" && path === "/api/auth/logout") {
      if (c.session) db.audit(c.session.sub, "auth.logout", `user:${c.session.sub}`);
      return { status: 200, data: { ok: true }, session: null };
    }
    if (method === "GET" && path === "/api/me") {
      const user = db.getUser(this.auth(c).sub);
      if (!user) throw new HttpError(401, "Please sign in.");
      return ok({ user });
    }
    if (method === "GET" && path === "/api/health") return ok({ ok: true, ...db.counts() });

    // ---------- people ----------
    if (method === "GET" && path === "/api/doctors") {
      this.auth(c, "patient", "admin");
      return ok({ doctors: db.listUsers("doctor").map(({ id, name, email }) => ({ id, name, email })) });
    }
    if (method === "GET" && path === "/api/patients") {
      const s = this.auth(c, "doctor", "patient");
      return ok({ patients: s.role === "doctor" ? db.patientsForDoctor(s.sub) : [{ ...db.getUser(s.sub)!, records: db.listRecords(s.sub).length }] });
    }
    if (method === "GET" && (m = path.match(/^\/api\/patients\/([^/]+)$/))) {
      const s = this.auth(c, "doctor", "patient");
      const id = Id.parse(m[1]);
      if (!this.canAccessPatient(s, id)) throw new HttpError(404, "Patient not found");
      const p = db.getUser(id)!;
      return ok({ patient: { id: p.id, name: p.name, email: p.email }, records: this.vault.list(id) });
    }

    // ---------- consent ----------
    if (method === "GET" && path === "/api/consent") return ok({ grants: db.grantsForPatient(this.auth(c, "patient").sub) });
    if ((m = path.match(/^\/api\/consent\/([^/]+)$/)) && (method === "PUT" || method === "DELETE")) {
      const s = this.auth(c, "patient");
      const doctorId = Id.parse(m[1]);
      if (method === "PUT") {
        if (db.getUser(doctorId)?.role !== "doctor") throw new HttpError(404, "Doctor not found");
        db.grant(s.sub, doctorId);
        db.audit(s.sub, "consent.grant", `patient:${s.sub}`, `doctor:${doctorId}`);
      } else if (db.revoke(s.sub, doctorId)) db.audit(s.sub, "consent.revoke", `patient:${s.sub}`, `doctor:${doctorId}`);
      return ok({ grants: db.grantsForPatient(s.sub) });
    }

    // ---------- records ----------
    if (method === "POST" && (m = path.match(/^\/api\/patients\/([^/]+)\/records$/))) {
      const s = this.auth(c, "doctor");
      const id = Id.parse(m[1]);
      if (!db.hasGrant(id, s.sub)) throw new HttpError(404, "Patient not found");
      const fields = (c.body ?? {}) as Record<string, unknown>;
      const rec = RecordInput.parse(typeof fields.record === "string" ? JSON.parse(fields.record) : fields);
      if (c.file && c.file.length > 25 * 1024 * 1024) throw new HttpError(413, "File is larger than 25 MB.");
      const meta = this.vault.create(id, { id: s.sub, name: s.name }, rec, c.file?.length ? c.file : undefined);
      db.audit(s.sub, "record.create", `record:${meta.id}`, `patient:${id}`);
      return ok({ record: meta });
    }
    if ((m = path.match(/^\/api\/records\/([^/]+)(\/.*)?$/))) {
      const s = this.auth(c, "doctor", "patient");
      const id = Id.parse(m[1]);
      const rest = m[2] ?? "";
      if (method === "POST" && rest === "/loans") {
        // Lending is the patient's decision alone, so it is checked before general access.
        const p = this.auth(c, "patient");
        const meta = this.vault.meta(id);
        if (!meta || meta.patientId !== p.sub) throw new HttpError(404, "Record not found");
        const b = z.object({ doctorId: Id, minutes: z.number().int().min(LOAN_MINUTES.min).max(LOAN_MINUTES.max) }).parse(c.body);
        if (db.getUser(b.doctorId)?.role !== "doctor") throw new HttpError(404, "Doctor not found");
        const loan = lend(db, this.vault, { recordId: id, patientId: p.sub, doctorId: b.doctorId, minutes: b.minutes, now: this.now() });
        return ok({ loan: this.loanView(loan) });
      }
      const { loan } = this.requireRecordAccess(s, id);
      const via = loan ? `|loan:${loan.id}` : "";
      if (method === "GET" && rest === "") {
        const opened = this.vault.open(id, { loan });
        db.audit(s.sub, "record.view", `record:${id}`, `patient:${opened.meta.patientId}${via}`);
        const { stegoPng: _s, wrappedKey: _w, ...meta } = opened.meta;
        return ok({ meta, record: opened.record, verification: opened.verification, loan: loan ? { id: loan.id, expiresAt: loan.expiresAt } : null });
      }
      let v: RegExpMatchArray | null;
      if (method === "GET" && (v = rest.match(/^\/image\/(stego|original|diff)$/))) {
        const variant = v[1] as "stego" | "original" | "diff";
        const png = this.vault.image(id, variant, loan);
        if (variant !== "stego") db.audit(s.sub, `image.${variant}`, `record:${id}`, via.slice(1));
        return { status: 200, file: { bytes: png, type: "image/png", filename: q.get("download") ? `medvault-${id.slice(0, 8)}-${variant}.png` : undefined } };
      }
      if (method === "GET" && (v = rest.match(/^\/file\/(stored|original)$/))) {
        const kind = v[1] as "stored" | "original";
        const f = this.vault.file(id, kind, loan);
        if (kind === "original") db.audit(s.sub, "file.original", `record:${id}`, via.slice(1));
        return { status: 200, file: { bytes: f.bytes, type: f.type, filename: f.filename } };
      }
      if (method === "POST" && rest === "/tamper-test") return ok(this.vault.tamperTest(id));
      throw new HttpError(404, "Not found");
    }
    if (method === "POST" && path === "/api/verify") {
      const s = this.auth(c, "doctor", "patient");
      if (!c.file?.length) throw new HttpError(400, "Upload a PNG or DICOM file in the 'file' field.");
      const recordId = this.vault.identify(c.file);
      const { loan } = this.requireRecordAccess(s, recordId);
      const opened = this.vault.open(recordId, { file: c.file, loan });
      db.audit(s.sub, "record.verify", `record:${recordId}`);
      return ok({ recordId, title: opened.meta.title, verification: opened.verification });
    }

    // ---------- loans ----------
    if (method === "GET" && path === "/api/loans") {
      const s = this.auth(c, "doctor", "patient");
      const loans = db.listLoans(s.role === "patient" ? { patientId: s.sub } : { doctorId: s.sub });
      // Doctors only see loans that are still running; patients see their whole history.
      return ok({ now: this.now(), loans: loans.filter((l) => s.role === "patient" || !l.endedAt).map((l) => this.loanView(l)) });
    }
    if (method === "DELETE" && (m = path.match(/^\/api\/loans\/([^/]+)$/))) {
      const s = this.auth(c, "patient");
      const l = db.getLoan(Id.parse(m[1]));
      if (!l || l.patientId !== s.sub) throw new HttpError(404, "Loan not found");
      if (!l.endedAt) {
        db.endLoan(l.id, "revoked", this.now());
        db.audit(s.sub, "loan.revoke", `record:${l.recordId}`, `doctor:${l.doctorId}|loan:${l.id}`);
      }
      return ok({ loan: this.loanView(db.getLoan(l.id)!) });
    }

    // ---------- audit ----------
    if (method === "GET" && path === "/api/audit") {
      const s = this.auth(c);
      if (s.role === "admin") return ok({ entries: db.auditRecent(300) });
      if (s.role === "patient") return ok({ entries: db.auditRecent(200, this.patientKeys(s.sub)) });
      return ok({ entries: db.auditRecent(200).filter((e) => e.actor === s.sub) });
    }
    if (method === "GET" && path === "/api/audit/verify") {
      this.auth(c, "admin");
      const entries = db.auditAll();
      return ok({ ...verifyChain(entries), entries: entries.length, head: entries.at(-1)?.hash ?? null, transparency: this.tlog.audit() });
    }

    // ---------- transparency log (RFC 9162-style Merkle tree with signed heads) ----------
    if (method === "GET" && path === "/api/log/head") {
      this.auth(c);
      return ok({ head: this.tlog.head(), publicKey: this.tlog.publicKey, keyId: this.tlog.keyId });
    }
    if (method === "GET" && (m = path.match(/^\/api\/log\/inclusion\/([^/]+)$/))) {
      const s = this.auth(c);
      const seq = z.coerce.number().int().min(1).parse(m[1]);
      const size = z.coerce.number().int().min(1).parse(q.get("size"));
      const entry = db.auditAll()[seq - 1];
      if (!entry || !this.visibleTo(s)(entry)) throw new HttpError(404, "Entry not found");
      try {
        return ok({ entry, ...this.tlog.inclusion(seq, size) });
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    if (method === "GET" && path === "/api/log/consistency") {
      this.auth(c);
      const from = z.coerce.number().int().min(1).parse(q.get("from"));
      const to = z.coerce.number().int().min(1).parse(q.get("to"));
      try {
        return ok(this.tlog.consistency(from, to));
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }

    // ---------- admin ----------
    if (method === "GET" && path === "/api/admin/users") {
      this.auth(c, "admin");
      return ok({ users: db.listUsers(), counts: db.counts() });
    }
    if (method === "POST" && path === "/api/admin/users") {
      const s = this.auth(c, "admin");
      const b = z.object({ name: z.string().trim().min(2).max(80), email: Email, role: z.enum(["doctor", "patient", "admin"]), password: z.string().min(10).max(128) }).parse(c.body);
      if (db.findByEmail(b.email)) throw new HttpError(409, "That email is already registered.");
      const u = db.createUser({ id: globalThis.crypto.randomUUID(), email: b.email, name: b.name, role: b.role }, await this.passwords.hash(b.password));
      db.audit(s.sub, "user.create", `user:${u.id}`, b.role);
      return ok({ user: u });
    }

    throw new HttpError(404, "Not found");
  }
}
