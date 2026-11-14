import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { decodePng, encodePng, phantom, pixelHash, embed } from "@medvault/core";
import { buildApp } from "../src/app";
import type { Db } from "../src/db";
import { DEMO_PASSWORD } from "../src/seed";

let app: FastifyInstance;
let db: Db;
const H = { "x-medvault": "1" };

beforeAll(async () => {
  ({ app, db } = await buildApp({ dbFile: ":memory:", seed: true }));
});
afterAll(() => app.close());

const sessions = new Map<string, { cookie: string; user: { id: string } }>();
async function login(email: string) {
  if (sessions.has(email)) return sessions.get(email)!;
  const r = await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { email, password: DEMO_PASSWORD } });
  expect(r.statusCode).toBe(200);
  const c = r.cookies.find((x) => x.name === "mv_session")!;
  expect(c.httpOnly).toBe(true);
  const s = { cookie: `mv_session=${c.value}`, user: r.json().user };
  sessions.set(email, s);
  return s;
}

const as = (cookie: string) => ({ ...H, cookie });
const json = (r: LightMyRequestResponse) => r.json();

function multipart(fields: Record<string, string>, file?: { name: string; data: Uint8Array }) {
  const b = "----mv" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from(file.data), Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${b}` } };
}

describe("authentication", () => {
  it("rejects wrong passwords and requires the CSRF header", async () => {
    expect((await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { email: "meera@medvault.dev", password: "nope" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "meera@medvault.dev", password: DEMO_PASSWORD } })).statusCode).toBe(403);
    expect((await app.inject("/api/me")).statusCode).toBe(401);
  });
});

describe("consent and access control", () => {
  it("lets a granted doctor read a record, with exact image restoration", async () => {
    const { cookie } = await login("meera@medvault.dev");
    const patients = json(await app.inject({ url: "/api/patients", headers: as(cookie) })).patients;
    const anitha = patients.find((p: { name: string }) => p.name.startsWith("Anitha"));
    const { records } = json(await app.inject({ url: `/api/patients/${anitha.id}`, headers: as(cookie) }));
    const r = json(await app.inject({ url: `/api/records/${records[0].id}`, headers: as(cookie) }));
    expect(r.record.diagnosis).toMatch(/intracranial/);
    expect(r.verification).toMatchObject({ fileIntact: true, restoredExact: true });
    expect(r.meta.stats.psnr).toBeGreaterThan(45);
  });

  it("hides patients from doctors without consent and keeps admins out of clinical data", async () => {
    const arjun = await login("arjun@medvault.dev");
    const anithaId = db.findByEmail("anitha@medvault.dev")!.id;
    const anithaRecord = db.listRecords(anithaId)[0].id;
    expect((await app.inject({ url: `/api/patients/${anithaId}`, headers: as(arjun.cookie) })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/records/${anithaRecord}`, headers: as(arjun.cookie) })).statusCode).toBe(404);
    const admin = await login("admin@medvault.dev");
    expect((await app.inject({ url: `/api/records/${anithaRecord}`, headers: as(admin.cookie) })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/records/${anithaRecord}/image/original`, headers: as(admin.cookie) })).statusCode).toBe(403);
  });

  it("applies a patient's grant and revoke immediately", async () => {
    const anitha = await login("anitha@medvault.dev");
    const arjun = await login("arjun@medvault.dev");
    const rec = db.listRecords(anitha.user.id)[0].id;
    expect((await app.inject({ method: "PUT", url: `/api/consent/${arjun.user.id}`, headers: as(anitha.cookie) })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/records/${rec}`, headers: as(arjun.cookie) })).statusCode).toBe(200);
    await app.inject({ method: "DELETE", url: `/api/consent/${arjun.user.id}`, headers: as(anitha.cookie) });
    expect((await app.inject({ url: `/api/records/${rec}`, headers: as(arjun.cookie) })).statusCode).toBe(404);
    const log = json(await app.inject({ url: "/api/audit", headers: as(anitha.cookie) })).entries.map((e: { action: string }) => e.action);
    expect(log).toEqual(expect.arrayContaining(["consent.grant", "consent.revoke", "record.view", "record.denied"]));
  });
});

describe("records", () => {
  it("creates a record from an uploaded scan and never stores plaintext", async () => {
    const meera = await login("meera@medvault.dev");
    const pid = db.findByEmail("anitha@medvault.dev")!.id;
    const scan = phantom(256, 77);
    const secret = "Hypertension, stage 1; unique-marker-8812";
    const mp = multipart({ record: JSON.stringify({ title: "Clinic visit", diagnosis: secret, medications: ["Amlodipine 5 mg"] }) }, { name: "scan.png", data: encodePng(scan) });
    const r = await app.inject({ method: "POST", url: `/api/patients/${pid}/records`, payload: mp.payload, headers: { ...mp.headers, ...as(meera.cookie) } });
    expect(r.statusCode).toBe(200);
    const id = r.json().record.id;
    const raw = JSON.stringify(db.db.prepare("SELECT * FROM records WHERE id = ?").get(id), (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString("latin1") : v));
    expect(raw).not.toContain("unique-marker-8812");
    const original = await app.inject({ url: `/api/records/${id}/image/original`, headers: as(meera.cookie) });
    expect(pixelHash(decodePng(original.rawPayload).image)).toBe(pixelHash(scan));
    expect(json(await app.inject({ url: `/api/records/${id}`, headers: as(meera.cookie) })).record.diagnosis).toBe(secret);
  });

  it("validates input and rejects patients it may not write to", async () => {
    const meera = await login("meera@medvault.dev");
    const pid = db.findByEmail("anitha@medvault.dev")!.id;
    const bad = await app.inject({ method: "POST", url: `/api/patients/${pid}/records`, headers: as(meera.cookie), payload: { title: "x", diagnosis: "" } });
    expect(bad.statusCode).toBe(400);
    const patient = await login("anitha@medvault.dev");
    expect((await app.inject({ method: "POST", url: `/api/patients/${pid}/records`, headers: as(patient.cookie), payload: { title: "Self note", diagnosis: "fine" } })).statusCode).toBe(403);
  });

  it("detects tampering with the stored image", async () => {
    const meera = await login("meera@medvault.dev");
    const pid = db.findByEmail("karthik@medvault.dev")!.id;
    const id = db.listRecords(pid)[0].id;
    const t = json(await app.inject({ method: "POST", url: `/api/records/${id}/tamper-test`, headers: as(meera.cookie) }));
    expect(t.detected).toBe(true);
  });

  it("verifies an uploaded stego image and rejects one carrying nothing", async () => {
    const meera = await login("meera@medvault.dev");
    const pid = db.findByEmail("karthik@medvault.dev")!.id;
    const id = db.listRecords(pid)[0].id;
    const stego = (await app.inject({ url: `/api/records/${id}/image/stego`, headers: as(meera.cookie) })).rawPayload;
    const m1 = multipart({}, { name: "s.png", data: stego });
    const ok = await app.inject({ method: "POST", url: "/api/verify", payload: m1.payload, headers: { ...m1.headers, ...as(meera.cookie) } });
    expect(ok.json()).toMatchObject({ recordId: id, verification: { fileIntact: true, restoredExact: true } });
    const m2 = multipart({}, { name: "p.png", data: encodePng(phantom(128)) });
    const plain = await app.inject({ method: "POST", url: "/api/verify", payload: m2.payload, headers: { ...m2.headers, ...as(meera.cookie) } });
    expect(plain.statusCode).toBe(422);
    void embed;
  });
});

describe("audit chain", () => {
  it("verifies, and an edited row is detected", async () => {
    const admin = await login("admin@medvault.dev");
    expect(json(await app.inject({ url: "/api/audit/verify", headers: as(admin.cookie) })).ok).toBe(true);
    db.db.prepare("UPDATE audit SET actor = 'mallory' WHERE seq = 3").run();
    const v = json(await app.inject({ url: "/api/audit/verify", headers: as(admin.cookie) }));
    expect(v).toMatchObject({ ok: false, brokenAt: 3 });
  });
});
