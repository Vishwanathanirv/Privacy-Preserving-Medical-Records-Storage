import { ctPhantom, issueCard, writeDicom } from "@medvault/core";
import { lend, sealDetail } from "./service";
import type { SeedStore } from "./types";
import type { Vault } from "./vault";

/** Demo password for development and the in-browser demo. Production seeds only with DEMO_SEED=on. */
export const DEMO_PASSWORD = "medvault-demo";

/** The real, openly licensed sample scans (samples/README.md), as PNG bytes. Missing ones fall back to a synthetic phantom. */
export type SeedScans = { mri?: Uint8Array; xray1?: Uint8Array; xray2?: Uint8Array };
export const SAMPLE_FILES = { mri: "brain-mri-t1.png", xray1: "chest-xray-pa-1.png", xray2: "chest-xray-pa-2.png" } as const;

/**
 * Creates the demo people and records. The people and their notes are fictional; the scans are
 * real, published, openly licensed research images. Returns the link to Anitha's emergency card
 * (its code is shown only once).
 */
export function seedDemo(db: SeedStore, vault: Vault, passwordHash: string, scans: SeedScans = {}): { sosLink: string } {
  const pw = passwordHash;
  const mk = (name: string, email: string, role: "admin" | "doctor" | "patient") => db.createUser({ id: globalThis.crypto.randomUUID(), name, email, role }, pw);
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

  const r4 = vault.create(
    anitha.id,
    meera,
    {
      title: "Chest X-ray: fever and breathlessness",
      diagnosis: "Patchy bilateral peripheral opacities, consistent with viral pneumonia.",
      notes: "Five days of fever and dry cough, breathless on stairs. Oxygen saturation stable on room air. Supportive care, fluids and rest; repeat film in 6 weeks. Return at once if breathing gets worse.",
      medications: ["Paracetamol 500 mg up to four times a day"],
      vitals: { bp: "116/74", pulse: 96, temperature: 38.1, spo2: 95 },
    },
    scans.xray2,
  );
  db.audit(meera.id, "record.create", `record:${r4.id}`, sealDetail(r4));
  const r1 = vault.create(
    anitha.id,
    meera,
    {
      title: "Brain MRI: follow-up after mild concussion",
      diagnosis: "No acute intracranial abnormality. Post-concussive symptoms improving.",
      notes: "Patient reports occasional headaches in the evening, no vomiting or vision changes. Neurological examination normal. Advised graded return to work and screen breaks. Review in 4 weeks or earlier if symptoms worsen.",
      medications: ["Paracetamol 500 mg as needed (max 3 g/day)"],
      vitals: { bp: "118/76", pulse: 72, temperature: 36.8, spo2: 99 },
    },
    scans.mri,
  );
  db.audit(meera.id, "record.create", `record:${r1.id}`, sealDetail(r1));
  const r2 = vault.create(
    karthik.id,
    arjun,
    {
      title: "Chest X-ray: persistent cough",
      diagnosis: "Bilateral patchy opacities, more in the lower zones; viral pneumonia most likely.",
      notes: "Cough for two weeks with low-grade fever. Mild breathlessness on exertion. Rest, fluids and paracetamol; pulse oximeter at home. Review in one week or sooner if saturation drops below 94%.",
      medications: ["Paracetamol 500 mg as needed", "Saline nasal irrigation twice daily"],
      vitals: { bp: "126/82", pulse: 88, temperature: 37.6, spo2: 96 },
    },
    scans.xray1,
  );
  db.audit(arjun.id, "record.create", `record:${r2.id}`, sealDetail(r2));
  // A synthetic 12-bit DICOM CT slice, as a scanner would send it. Its header names the patient; the vault
  // strips that from the stored file and keeps it only inside the encrypted record.
  const ct = writeDicom({ pixels: ctPhantom(384, 7), width: 384, height: 384, patientName: "Subramanian^Karthik", patientId: "KS-20260412", birthDate: "19910317", study: "CT HEAD WITHOUT CONTRAST" });
  const r3 = vault.create(
    karthik.id,
    meera,
    {
      title: "CT head (DICOM, synthetic): headache review",
      diagnosis: "No intracranial haemorrhage, mass effect or midline shift.",
      notes: "Uploaded straight from the scanner as 12-bit DICOM. Ventricles normal for age. Paranasal sinus findings as previously reported. No further imaging needed.",
      medications: [],
      vitals: { bp: "124/80", pulse: 74, temperature: 36.9, spo2: 99 },
    },
    ct,
  );
  db.audit(meera.id, "record.create", `record:${r3.id}`, sealDetail(r3));
  // Anitha lends her brain MRI to Dr. Rao, who is not on her care team, for a second opinion.
  lend(db, vault, { recordId: r1.id, patientId: anitha.id, doctorId: arjun.id, minutes: 120, now: Date.now() });
  // Anitha's emergency card. A real card is made in the patient's own browser; the code below is
  // shown only here, for the demo's "break the glass" button.
  const card = issueCard({
    name: "Anitha Kumar",
    bloodType: "B+",
    allergies: ["Penicillin (rash, swelling)"],
    conditions: ["Mild concussion, recovering (2026)"],
    medications: ["Paracetamol 500 mg as needed"],
    contact: { name: "Ravi Kumar (brother)", phone: "+91 98450 00000" },
    notes: "No known heart conditions. Wears contact lenses.",
  });
  db.insertCard({ id: card.id, patientId: anitha.id, createdAt: Date.now(), salt: card.salt, authHash: card.authHash, sealed: card.sealed, revokedAt: null });
  db.audit(anitha.id, "sos.issue", `patient:${anitha.id}`, `card:${card.id}`);
  void admin;
  return { sosLink: `/sos#${card.id}.${card.code}` };
}
