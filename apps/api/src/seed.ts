import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { hashPassword } from "./security";
import type { Vault } from "./vault";

/** Demo password shown on the sign-in page. Set DEMO_SEED=off in production. */
export const DEMO_PASSWORD = "medvault-demo";

/** Fictional people and records only; no real patient data is ever used. */
export async function seedDemo(db: Db, vault: Vault) {
  const pw = await hashPassword(DEMO_PASSWORD);
  const mk = (name: string, email: string, role: "admin" | "doctor" | "patient") => db.createUser({ id: randomUUID(), name, email, role }, pw);
  const admin = mk("Asha Admin", "admin@medvault.dev", "admin");
  const meera = mk("Dr. Meera Iyer", "meera@medvault.dev", "doctor");
  const arjun = mk("Dr. Arjun Rao", "arjun@medvault.dev", "doctor");
  const anitha = mk("Anitha Kumar", "anitha@medvault.dev", "patient");
  const karthik = mk("Karthik Subramanian", "karthik@medvault.dev", "patient");
  db.audit("system", "system.seed", "demo", "created demo users");
  db.grant(anitha.id, meera.id);
  db.audit(anitha.id, "consent.grant", `patient:${anitha.id}`, `doctor:${meera.id}`);
  db.grant(karthik.id, meera.id);
  db.grant(karthik.id, arjun.id);
  db.audit(karthik.id, "consent.grant", `patient:${karthik.id}`, `doctor:${meera.id}`);
  db.audit(karthik.id, "consent.grant", `patient:${karthik.id}`, `doctor:${arjun.id}`);

  const r1 = vault.create(anitha.id, meera, {
    title: "Head CT: follow-up after mild concussion",
    diagnosis: "No acute intracranial abnormality. Post-concussive symptoms improving.",
    notes: "Patient reports occasional headaches in the evening, no vomiting or vision changes. Neurological examination normal. Advised graded return to work and screen breaks. Review in 4 weeks or earlier if symptoms worsen.",
    medications: ["Paracetamol 500 mg as needed (max 3 g/day)"],
    vitals: { bp: "118/76", pulse: 72, temperature: 36.8, spo2: 99 },
  });
  db.audit(meera.id, "record.create", `record:${r1.id}`, `patient:${anitha.id}`);
  const r2 = vault.create(karthik.id, arjun, {
    title: "Head CT: chronic sinusitis assessment",
    diagnosis: "Mucosal thickening of the maxillary sinuses consistent with chronic sinusitis.",
    notes: "Symptoms for 14 weeks with nasal congestion and facial pressure. Started saline irrigation and an intranasal steroid. ENT referral if no improvement in 8 weeks.",
    medications: ["Fluticasone nasal spray 50 mcg, 2 sprays each nostril daily", "Saline nasal irrigation twice daily"],
    vitals: { bp: "126/82", pulse: 78, temperature: 37.1, spo2: 98 },
  });
  db.audit(arjun.id, "record.create", `record:${r2.id}`, `patient:${karthik.id}`);
  void admin;
}
