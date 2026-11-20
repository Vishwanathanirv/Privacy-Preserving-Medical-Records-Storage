import type { AuditEntry } from "@medvault/core";

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
  /** SHA-256 of the original pixels (for PNG the same as originalSha256). Also written into the signed audit log when the record is sealed. */
  pixelSha256?: string;
  stats: { layers: number; payloadBytes: number; bitsPerPixel: number; psnr: number; ssim: number; maxPixelChange: number; embedMs: number; thresholds?: number[] };
  /** What kind of file is stored. Absent on records made before DICOM support (8-bit PNG). */
  scan?: ScanInfo;
};

export type ScanInfo = {
  format: "png" | "dicom";
  bitDepth: number;
  modality?: string;
  window?: { center: number; width: number };
  rescale?: { slope: number; intercept: number };
  /** Names (never values) of the header attributes removed before storage. */
  removedFields?: string[];
};

export type StoredRecord = RecordMeta & { stegoPng: Uint8Array; wrappedKey: Uint8Array };

/** Storage the vault needs: SQLite on the server, memory in the browser demo. */
export interface RecordStore {
  getRecord(id: string): StoredRecord | null;
  insertRecord(m: Omit<RecordMeta, "authorName">, stegoPng: Uint8Array, wrappedKey: Uint8Array): void;
  listRecords(patientId: string): RecordMeta[];
}

/** Storage the demo seeder needs. */
export interface SeedStore {
  createUser(u: Omit<User, "createdAt">, passwordHash: string): User;
  insertLoan(l: Loan): void;
  insertCard(c: EmergencyCardRow): void;
  grant(patientId: string, doctorId: string): void;
  audit(actor: string, action: string, target: string, detail?: string): AuditEntry;
}

/** A record lent to a doctor until `expiresAt`. `wrappedKey` is the record's data key sealed under the loan's own key; it is destroyed when the loan ends. */
export type Loan = {
  id: string;
  recordId: string;
  patientId: string;
  doctorId: string;
  createdAt: number;
  expiresAt: number;
  wrappedKey: Uint8Array | null;
  endedAt: number | null;
  endReason: "expired" | "revoked" | null;
};

/** A patient's emergency card. The server holds only the sealed summary and a hash of the card's access key. */
export type EmergencyCardRow = { id: string; patientId: string; createdAt: number; salt: string; authHash: string; sealed: string; revokedAt: number | null };
