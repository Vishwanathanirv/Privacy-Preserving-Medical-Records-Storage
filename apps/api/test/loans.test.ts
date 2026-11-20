import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { Db } from "../src/db";
import { DEMO_PASSWORD } from "../src/seed";

/** Lending a record to a doctor for a limited time, with a clock the test controls. */
let app: FastifyInstance;
let db: Db;
let clock = Date.now();
const H = { "x-medvault": "1" };
const MIN = 60_000;

beforeAll(async () => {
  ({ app, db } = await buildApp({ dbFile: ":memory:", seed: true, now: () => clock }));
});
afterAll(() => app.close());

const sessions = new Map<string, { headers: Record<string, string>; id: string }>();
async function login(email: string) {
  if (sessions.has(email)) return sessions.get(email)!;
  const r = await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { email, password: DEMO_PASSWORD } });
  const s = { headers: { ...H, cookie: `mv_session=${r.cookies.find((c) => c.name === "mv_session")!.value}` }, id: r.json().user.id as string };
  sessions.set(email, s);
  return s;
}

describe("lending a record", () => {
  it("gives a doctor outside the care team access to one record until the loan expires, then destroys the loan key", async () => {
    const anitha = await login("anitha@medvault.dev");
    const arjun = await login("arjun@medvault.dev");
    // Dr. Rao is not on Anitha's care team: only the seeded loan lets him in. End it first.
    const seeded = (await app.inject({ url: "/api/loans", headers: anitha.headers })).json().loans[0];
    await app.inject({ method: "DELETE", url: `/api/loans/${seeded.id}`, headers: anitha.headers });
    const rec = db.listRecords(anitha.id)[0].id;
    expect((await app.inject({ url: `/api/records/${rec}`, headers: arjun.headers })).statusCode).toBe(404);

    const made = await app.inject({ method: "POST", url: `/api/records/${rec}/loans`, headers: anitha.headers, payload: { doctorId: arjun.id, minutes: 30 } });
    expect(made.statusCode).toBe(200);
    const loan = made.json().loan;
    expect(loan).toMatchObject({ recordId: rec, doctorId: arjun.id, keyHeld: true, endedAt: null });
    expect(loan.expiresAt - clock).toBe(30 * MIN);
    expect(loan.wrappedKey).toBeUndefined(); // never sent to anyone

    const opened = await app.inject({ url: `/api/records/${rec}`, headers: arjun.headers });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().loan.id).toBe(loan.id);
    expect(opened.json().verification).toMatchObject({ restoredExact: true });
    expect((await app.inject({ url: `/api/records/${rec}/image/original`, headers: arjun.headers })).statusCode).toBe(200);
    // A loan is for one record, not the patient's whole wallet.
    expect((await app.inject({ url: `/api/patients/${anitha.id}`, headers: arjun.headers })).statusCode).toBe(404);
    const held = (await app.inject({ url: "/api/loans", headers: arjun.headers })).json().loans;
    expect(held.map((l: { id: string }) => l.id)).toEqual([loan.id]);

    clock += 31 * MIN;
    expect((await app.inject({ url: `/api/records/${rec}`, headers: arjun.headers })).statusCode).toBe(404);
    const after = db.getLoan(loan.id)!;
    expect(after).toMatchObject({ endReason: "expired", wrappedKey: null, endedAt: loan.expiresAt });
    expect((await app.inject({ url: "/api/loans", headers: arjun.headers })).json().loans).toEqual([]);

    // The patient's trail shows the loan, the doctor's access through it and the expiry, in order.
    const trail = (await app.inject({ url: "/api/audit", headers: anitha.headers })).json().entries.filter((e: { detail: string }) => e.detail.includes(`loan:${loan.id}`));
    expect(trail.map((e: { action: string }) => e.action).reverse()).toEqual(["loan.create", "record.view", "image.original", "loan.expire"]);
  });

  it("ends a loan the moment the patient revokes it", async () => {
    const anitha = await login("anitha@medvault.dev");
    const arjun = await login("arjun@medvault.dev");
    const rec = db.listRecords(anitha.id)[0].id;
    const loan = (await app.inject({ method: "POST", url: `/api/records/${rec}/loans`, headers: anitha.headers, payload: { doctorId: arjun.id, minutes: 60 } })).json().loan;
    expect((await app.inject({ url: `/api/records/${rec}`, headers: arjun.headers })).statusCode).toBe(200);
    const r = await app.inject({ method: "DELETE", url: `/api/loans/${loan.id}`, headers: anitha.headers });
    expect(r.json().loan).toMatchObject({ endReason: "revoked", keyHeld: false });
    expect((await app.inject({ url: `/api/records/${rec}`, headers: arjun.headers })).statusCode).toBe(404);
    expect(db.auditRecent(5).map((e) => e.action)).toContain("loan.revoke");
  });

  it("cannot be extended by editing the database: the loan key is bound to its expiry", async () => {
    const anitha = await login("anitha@medvault.dev");
    const arjun = await login("arjun@medvault.dev");
    const rec = db.listRecords(anitha.id)[0].id;
    const loan = (await app.inject({ method: "POST", url: `/api/records/${rec}/loans`, headers: anitha.headers, payload: { doctorId: arjun.id, minutes: 10 } })).json().loan;
    db.db.prepare("UPDATE loans SET expires_at = expires_at + 86400000 WHERE id = ?").run(loan.id);
    clock += 20 * MIN; // past the real expiry, inside the forged one
    const r = await app.inject({ url: `/api/records/${rec}`, headers: arjun.headers });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/terms were changed/);
  });

  it("only lets the record's own patient lend it, to a real doctor, for a sane time", async () => {
    const anitha = await login("anitha@medvault.dev");
    const karthik = await login("karthik@medvault.dev");
    const meera = await login("meera@medvault.dev");
    const arjun = await login("arjun@medvault.dev");
    const rec = db.listRecords(anitha.id)[0].id;
    const post = (headers: Record<string, string>, payload: unknown) => app.inject({ method: "POST", url: `/api/records/${rec}/loans`, headers, payload: payload as object });
    expect((await post(meera.headers, { doctorId: arjun.id, minutes: 5 })).statusCode).toBe(403);
    expect((await post(karthik.headers, { doctorId: arjun.id, minutes: 5 })).statusCode).toBe(404);
    expect((await post(anitha.headers, { doctorId: karthik.id, minutes: 5 })).statusCode).toBe(404);
    expect((await post(anitha.headers, { doctorId: arjun.id, minutes: 0 })).statusCode).toBe(400);
    expect((await post(anitha.headers, { doctorId: arjun.id, minutes: 60 * 24 * 31 })).statusCode).toBe(400);
    const loans = (await app.inject({ url: "/api/loans", headers: anitha.headers })).json().loans;
    expect((await app.inject({ method: "DELETE", url: `/api/loans/${loans[0].id}`, headers: karthik.headers })).statusCode).toBe(404);
  });
});
