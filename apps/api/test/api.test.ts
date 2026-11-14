import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { auditLeaf, ctPhantom, decodePng, encodePng, embed, fromHex, parseDicom, phantom, pixelHash, verifyConsistency, verifyInclusion, verifyTreeHead, writeDicom, type AuditEntry } from "@medvault/core";
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
    const stego = (await app.inject({ url: `/api/records/${id}/file/stored`, headers: as(meera.cookie) })).rawPayload;
    const m1 = multipart({}, { name: "s.dcm", data: stego });
    const ok = await app.inject({ method: "POST", url: "/api/verify", payload: m1.payload, headers: { ...m1.headers, ...as(meera.cookie) } });
    expect(ok.json()).toMatchObject({ recordId: id, verification: { fileIntact: true, restoredExact: true } });
    const m2 = multipart({}, { name: "p.png", data: encodePng(phantom(128)) });
    const plain = await app.inject({ method: "POST", url: "/api/verify", payload: m2.payload, headers: { ...m2.headers, ...as(meera.cookie) } });
    expect(plain.statusCode).toBe(422);
    void embed;
  });
});

describe("DICOM scans", () => {
  it("stores a de-identified file and rebuilds the original byte for byte", async () => {
    const meera = await login("meera@medvault.dev");
    const pid = db.findByEmail("anitha@medvault.dev")!.id;
    const original = writeDicom({ pixels: ctPhantom(256, 9), width: 256, height: 256, patientName: "Kumar^Anitha", patientId: "AK-1", birthDate: "19880212" });
    const m = multipart({ record: JSON.stringify({ title: "CT head (DICOM)", diagnosis: "Normal study" }) }, { name: "ct.dcm", data: original });
    const created = await app.inject({ method: "POST", url: `/api/patients/${pid}/records`, payload: m.payload, headers: { ...m.headers, ...as(meera.cookie) } });
    expect(created.statusCode).toBe(200);
    const rec = created.json().record;
    expect(rec.scan).toMatchObject({ format: "dicom", bitDepth: 12, modality: "CT" });
    expect(rec.scan.removedFields).toEqual(expect.arrayContaining(["Patient's Name", "Patient ID", "Patient's Birth Date"]));

    const stored = new Uint8Array((await app.inject({ url: `/api/records/${rec.id}/file/stored`, headers: as(meera.cookie) })).rawPayload);
    const text = new TextDecoder("latin1").decode(stored);
    expect(text).not.toContain("Kumar^Anitha");
    expect(text).not.toContain("AK-1");
    expect(parseDicom(stored).rows).toBe(256);

    const opened = (await app.inject({ url: `/api/records/${rec.id}`, headers: as(meera.cookie) })).json();
    expect(opened.verification).toMatchObject({ fileIntact: true, restoredExact: true });
    expect(opened.record.source).toBeUndefined();

    const back = new Uint8Array((await app.inject({ url: `/api/records/${rec.id}/file/original`, headers: as(meera.cookie) })).rawPayload);
    expect(back).toEqual(original);
    const audit = db.auditRecent(5).map((e) => e.action);
    expect(audit).toContain("file.original");

    const png = (await app.inject({ url: `/api/records/${rec.id}/image/original`, headers: as(meera.cookie) })).rawPayload;
    expect(decodePng(new Uint8Array(png)).image.width).toBe(256);
  });

  it("rejects compressed or broken DICOM with a clear message", async () => {
    const meera = await login("meera@medvault.dev");
    const pid = db.findByEmail("anitha@medvault.dev")!.id;
    const bad = writeDicom({ pixels: ctPhantom(64, 1), width: 64, height: 64 }).slice(0, 400);
    const m = multipart({ record: JSON.stringify({ title: "Broken", diagnosis: "n/a" }) }, { name: "x.dcm", data: bad });
    const r = await app.inject({ method: "POST", url: `/api/patients/${pid}/records`, payload: m.payload, headers: { ...m.headers, ...as(meera.cookie) } });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatch(/truncated|pixel data/i);
  });
});

describe("transparency log", () => {
  it("signs heads, proves a patient's entries are in the log, and keeps other patients' entries private", async () => {
    const anitha = await login("anitha@medvault.dev");
    const { head, publicKey } = json(await app.inject({ url: "/api/log/head", headers: as(anitha.cookie) }));
    expect(verifyTreeHead(publicKey, head)).toBe(true);
    const mine = json(await app.inject({ url: "/api/audit", headers: as(anitha.cookie) })).entries as AuditEntry[];
    const e = mine.find((x) => x.seq <= head.size)!;
    const p = json(await app.inject({ url: `/api/log/inclusion/${e.seq}?size=${head.size}`, headers: as(anitha.cookie) }));
    expect(verifyInclusion(auditLeaf(e), p.index, p.size, p.proof.map(fromHex), fromHex(head.root))).toBe(true);
    // A tampered copy of the entry does not verify against the signed root.
    expect(verifyInclusion(auditLeaf({ ...e, actor: "someone-else" }), p.index, p.size, p.proof.map(fromHex), fromHex(head.root))).toBe(false);
    const karthikId = db.findByEmail("karthik@medvault.dev")!.id;
    const other = db.auditAll().find((x) => x.target === `patient:${karthikId}`)!;
    expect((await app.inject({ url: `/api/log/inclusion/${other.seq}?size=${head.size}`, headers: as(anitha.cookie) })).statusCode).toBe(404);
  });

  it("proves the log only grew between two heads", async () => {
    const admin = await login("admin@medvault.dev");
    const first = json(await app.inject({ url: "/api/log/head", headers: as(admin.cookie) })).head;
    const anitha = await login("anitha@medvault.dev");
    const arjun = db.findByEmail("arjun@medvault.dev")!.id;
    await app.inject({ method: "PUT", url: `/api/consent/${arjun}`, headers: as(anitha.cookie) });
    await app.inject({ method: "DELETE", url: `/api/consent/${arjun}`, headers: as(anitha.cookie) });
    const second = json(await app.inject({ url: "/api/log/head", headers: as(admin.cookie) })).head;
    expect(second.size).toBeGreaterThan(first.size);
    const c = json(await app.inject({ url: `/api/log/consistency?from=${first.size}&to=${second.size}`, headers: as(admin.cookie) }));
    expect(verifyConsistency(first.size, second.size, c.proof.map(fromHex), fromHex(first.root), fromHex(second.root))).toBe(true);
  });
});

describe("audit chain", () => {
  it("verifies, and an edited row is detected", async () => {
    const admin = await login("admin@medvault.dev");
    const before = json(await app.inject({ url: "/api/audit/verify", headers: as(admin.cookie) }));
    expect(before.ok).toBe(true);
    expect(before.transparency.firstBrokenHead).toBeNull();
    db.db.prepare("UPDATE audit SET actor = 'mallory' WHERE seq = 3").run();
    const v = json(await app.inject({ url: "/api/audit/verify", headers: as(admin.cookie) }));
    expect(v).toMatchObject({ ok: false, brokenAt: 3 });
    // Every signed head covering entry 3 no longer matches the log rebuilt from storage.
    expect(v.transparency.firstBrokenHead).not.toBeNull();
    expect(v.transparency.firstBrokenHead.size).toBeGreaterThanOrEqual(3);
  });
});
