import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { deriveCardKeys, issueCard, openCard, toHex, type EmergencySummary } from "@medvault/core";
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

async function login(email: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { email, password: DEMO_PASSWORD } });
  return { headers: { ...H, cookie: `mv_session=${r.cookies.find((c) => c.name === "mv_session")!.value}` }, id: r.json().user.id as string };
}

const summary: EmergencySummary = { name: "Karthik Subramanian", bloodType: "O-", allergies: ["Latex marker-7731"], conditions: ["Asthma"], medications: ["Salbutamol inhaler"], contact: { name: "Priya", phone: "+91 90000 00000" } };

/** What a responder's browser does with the card's id and code, holding no account. */
async function breakGlass(id: string, code: string) {
  const salt = await app.inject({ url: `/api/sos/${id}/salt` });
  if (salt.statusCode !== 200) return { status: salt.statusCode };
  const { encKey, authKey } = await deriveCardKeys(code, salt.json().salt);
  const r = await app.inject({ method: "POST", url: `/api/sos/${id}/open`, headers: H, payload: { auth: toHex(authKey) } });
  if (r.statusCode !== 200) return { status: r.statusCode };
  return { status: 200, summary: openCard(encKey, id, r.json().sealed), logged: r.json().logged };
}

describe("emergency break-glass card", () => {
  let card: ReturnType<typeof issueCard>;
  let karthik: Awaited<ReturnType<typeof login>>;

  it("is issued from the patient's browser and stored without anything readable", async () => {
    karthik = await login("karthik@medvault.dev");
    card = issueCard(summary);
    expect(card.code).toMatch(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
    const r = await app.inject({ method: "PUT", url: "/api/sos", headers: karthik.headers, payload: { id: card.id, salt: card.salt, authHash: card.authHash, sealed: card.sealed } });
    expect(r.json().card.id).toBe(card.id);
    const raw = JSON.stringify(db.db.prepare("SELECT * FROM sos_cards WHERE id = ?").get(card.id));
    expect(raw).not.toContain("marker-7731");
    expect(raw).not.toContain(card.code.replace(/-/g, ""));
  });

  it("opens for anyone with the code, no account needed, and the patient sees it in their trail", async () => {
    const typed = card.code.toLowerCase().replace(/-/g, " "); // typed by hand, badly
    const r = await breakGlass(card.id, typed);
    expect(r.status).toBe(200);
    expect(r.summary).toEqual(summary);
    const trail = (await app.inject({ url: "/api/audit", headers: karthik.headers })).json().entries;
    expect(trail[0]).toMatchObject({ action: "sos.open", actor: "responder", seq: r.logged.seq, detail: `card:${card.id}` });
  });

  it("refuses a wrong code and logs the attempt", async () => {
    const wrong = card.code.slice(0, -1) + (card.code.endsWith("A") ? "B" : "A");
    expect((await breakGlass(card.id, wrong)).status).toBe(401);
    expect(db.auditRecent(1)[0]).toMatchObject({ action: "sos.failed", target: `patient:${karthik.id}` });
  });

  it("stops working once revoked or replaced", async () => {
    const next = issueCard(summary);
    await app.inject({ method: "PUT", url: "/api/sos", headers: karthik.headers, payload: { id: next.id, salt: next.salt, authHash: next.authHash, sealed: next.sealed } });
    expect((await breakGlass(card.id, card.code)).status).toBe(404);
    expect((await breakGlass(next.id, next.code)).status).toBe(200);
    await app.inject({ method: "DELETE", url: "/api/sos", headers: karthik.headers });
    expect((await breakGlass(next.id, next.code)).status).toBe(404);
    expect((await app.inject({ url: "/api/sos", headers: karthik.headers })).json().card).toBeNull();
  });

  it("can only be issued by a patient, with well-formed data", async () => {
    const meera = await login("meera@medvault.dev");
    const c = issueCard(summary);
    expect((await app.inject({ method: "PUT", url: "/api/sos", headers: meera.headers, payload: { id: c.id, salt: c.salt, authHash: c.authHash, sealed: c.sealed } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/sos", headers: karthik.headers, payload: { id: c.id, salt: "zz", authHash: c.authHash, sealed: c.sealed } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/sos/${c.id}/open`, headers: H, payload: { auth: "00" } })).statusCode).toBe(404);
  });
});
