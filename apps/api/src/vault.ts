import { randomUUID } from "node:crypto";
import {
  RdhError,
  CryptoError,
  decodePng,
  decryptRecord,
  differenceMap,
  embed,
  encodePng,
  encryptRecord,
  extract,
  phantom,
  pixelHash,
  psnr,
  sha256,
  ssim,
  type Gray,
} from "@medvault/core";
import type { Db, RecordMeta } from "./db";

export type ClinicalRecord = {
  title: string;
  diagnosis: string;
  notes: string;
  medications: string[];
  vitals?: { bp?: string; pulse?: number; temperature?: number; spo2?: number };
  author: string;
  createdAt: string;
};

/**
 * The embedded payload is self-describing so a stego image can be verified on its own:
 * [ "MVR1" | recordId length (1 byte) | recordId | AES-GCM ciphertext ].
 */
function pack(recordId: string, ciphertext: Uint8Array): Uint8Array {
  const id = new TextEncoder().encode(recordId);
  return new Uint8Array([0x4d, 0x56, 0x52, 0x31, id.length, ...id, ...ciphertext]);
}

function unpack(payload: Uint8Array): { recordId: string; ciphertext: Uint8Array } {
  if (payload.length < 6 || String.fromCharCode(...payload.subarray(0, 4)) !== "MVR1") throw new RdhError("Embedded data is not a MedVault record");
  const n = payload[4];
  return { recordId: new TextDecoder().decode(payload.subarray(5, 5 + n)), ciphertext: payload.subarray(5 + n) };
}

export class VaultError extends Error {
  constructor(public status: number, message: string, public stage?: string) {
    super(message);
  }
}

export class Vault {
  constructor(private db: Db, private kek: Uint8Array) {}

  /** Encrypts the record, hides it inside the scan and stores only the stego image and wrapped key. */
  create(patientId: string, author: { id: string; name: string }, rec: Omit<ClinicalRecord, "author" | "createdAt">, scanPng?: Uint8Array): RecordMeta {
    let cover: Gray;
    if (scanPng) {
      const { image } = decodePng(scanPng);
      if (image.width * image.height > 4096 * 4096) throw new VaultError(413, "Scans larger than 4096×4096 are not supported.");
      cover = image;
    } else cover = phantom(512, Math.floor(Math.random() * 1e6));

    const id = randomUUID();
    const full: ClinicalRecord = { ...rec, author: author.name, createdAt: new Date().toISOString() };
    const sealed = encryptRecord(this.kek, id, patientId, full);
    const t0 = performance.now();
    let result;
    try {
      result = embed(cover, pack(id, sealed.ciphertext));
    } catch (e) {
      if (e instanceof RdhError) throw new VaultError(422, e.message);
      throw e;
    }
    const embedMs = Math.round(performance.now() - t0);
    const stegoPng = encodePng(result.image);
    const meta: Omit<RecordMeta, "authorName"> = {
      id,
      patientId,
      authorId: author.id,
      title: rec.title,
      createdAt: Date.now(),
      width: cover.width,
      height: cover.height,
      stegoSha256: sha256(stegoPng),
      originalSha256: pixelHash(cover),
      stats: { ...result.stats, psnr: +psnr(cover, result.image).toFixed(2), ssim: +ssim(cover, result.image).toFixed(4), embedMs },
    };
    this.db.insertRecord(meta, stegoPng, sealed.wrappedKey);
    return { ...meta, authorName: author.name };
  }

  /**
   * Opens a record from its stored stego image: verifies the file hash, extracts the payload,
   * decrypts it and checks the restored scan matches the original's hash.
   */
  open(recordId: string, stegoOverride?: Uint8Array) {
    const r = this.db.getRecord(recordId);
    if (!r) throw new VaultError(404, "Record not found");
    const stegoPng = stegoOverride ?? r.stegoPng;
    const fileIntact = sha256(stegoPng) === r.stegoSha256;
    let extracted;
    try {
      extracted = extract(decodePng(stegoPng).image);
    } catch (e) {
      throw new VaultError(409, `Tampering detected: ${(e as Error).message}`, "watermark");
    }
    const { recordId: embeddedId, ciphertext } = unpack(extracted.payload);
    if (embeddedId !== recordId) throw new VaultError(409, "Tampering detected: this image carries a different record", "binding");
    let record: ClinicalRecord;
    try {
      record = decryptRecord<ClinicalRecord>(this.kek, recordId, r.patientId, { ciphertext, wrappedKey: r.wrappedKey });
    } catch (e) {
      if (e instanceof CryptoError) throw new VaultError(409, `Tampering detected: ${e.message}`, "decrypt");
      throw e;
    }
    const restoredExact = pixelHash(extracted.image) === r.originalSha256;
    return { meta: r, record, original: extracted.image, verification: { fileIntact, restoredExact, layers: extracted.layers } };
  }

  /** Identifies and opens an uploaded stego PNG without trusting anything but its pixels. */
  identify(png: Uint8Array): string {
    try {
      return unpack(extract(decodePng(png).image).payload).recordId;
    } catch (e) {
      throw new VaultError(422, e instanceof RdhError ? e.message : "This image does not carry a MedVault record");
    }
  }

  image(recordId: string, variant: "stego" | "original" | "diff"): Uint8Array {
    const r = this.db.getRecord(recordId);
    if (!r) throw new VaultError(404, "Record not found");
    if (variant === "stego") return r.stegoPng;
    const { original } = this.open(recordId);
    if (variant === "original") return encodePng(original);
    return encodePng(differenceMap(original, decodePng(r.stegoPng).image));
  }

  /** Demonstrates integrity protection: changes one pixel of a copy and tries to open it. */
  tamperTest(recordId: string) {
    const r = this.db.getRecord(recordId);
    if (!r) throw new VaultError(404, "Record not found");
    const img = decodePng(r.stegoPng).image;
    const y = Math.floor(img.height / 2);
    const x = Math.floor(img.width / 2);
    const i = y * img.width + x;
    img.data[i] = img.data[i] > 128 ? img.data[i] - 3 : img.data[i] + 3;
    try {
      const r2 = this.open(recordId, encodePng(img));
      // The record may still decrypt if the changed pixel carried no payload bit, but the hashes catch it.
      if (!r2.verification.fileIntact || !r2.verification.restoredExact) {
        return { detected: true, changedPixel: { x, y }, stage: "hash", message: "Tampering detected: the image no longer matches its SHA-256 fingerprint" };
      }
      return { detected: false, changedPixel: { x, y }, message: "Not detected" };
    } catch (e) {
      const err = e as VaultError;
      return { detected: true, changedPixel: { x, y }, stage: err.stage, message: err.message };
    }
  }
}
