import {
  RdhError,
  CryptoError,
  DicomError,
  deidentify,
  isDicom,
  parseDicom,
  readPixels,
  reidentify,
  removedNames,
  toDisplay,
  writePixels,
  type RemovedValue,
  decodePng,
  decryptField,
  decryptRecord,
  deriveLoanKey,
  differenceMap,
  encryptField,
  embed,
  encodePng,
  encryptRecord,
  extract,
  phantom,
  rewrapKey,
  pixelHash,
  psnr,
  sha256,
  ssim,
  type Gray,
} from "@medvault/core";
import type { Loan, RecordMeta, RecordStore, ScanInfo, StoredRecord } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ClinicalRecord = {
  title: string;
  diagnosis: string;
  notes: string;
  medications: string[];
  vitals?: { bp?: string; pulse?: number; temperature?: number; spo2?: number };
  author: string;
  createdAt: string;
  /** For DICOM scans: the identifying header values removed from the stored file. */
  source?: { format: "dicom"; removed: RemovedValue[] };
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
  const recordId = new TextDecoder().decode(payload.subarray(5, 5 + n));
  if (!UUID.test(recordId)) throw new RdhError("Embedded data is not a MedVault record");
  return { recordId, ciphertext: payload.subarray(5 + n) };
}

export class VaultError extends Error {
  constructor(public status: number, message: string, public stage?: string) {
    super(message);
  }
}

export class Vault {
  constructor(private db: RecordStore, private kek: Uint8Array) {}

  /** Titles are stored sealed under the master key, so the database holds no readable clinical text. */
  private reveal<T extends RecordMeta>(r: T): T {
    return { ...r, title: r.title.startsWith("enc1:") ? decryptField(this.kek, `title:${r.id}`, r.title) : r.title };
  }

  /** A record's metadata (title decrypted), without its file or key. */
  meta(recordId: string): RecordMeta | null {
    const r = this.db.getRecord(recordId);
    if (!r) return null;
    const { stegoPng: _s, wrappedKey: _w, ...meta } = this.reveal(r);
    return meta;
  }

  /** A patient's records, newest first, titles decrypted. */
  list(patientId: string): RecordMeta[] {
    return this.db.listRecords(patientId).map((r) => this.reveal(r));
  }

  private stored(recordId: string): StoredRecord {
    const r = this.db.getRecord(recordId);
    if (!r) throw new VaultError(404, "Record not found");
    return this.reveal(r);
  }

  /**
   * Encrypts the record, hides it inside the scan and stores only the stego file and wrapped key.
   * Accepts a PNG or an uncompressed DICOM file; without a scan, a synthetic CT slice is used.
   * For DICOM, identifying header values are blanked in the stored file and travel, encrypted,
   * inside the pixels, so the stored file reveals nothing and the original can be rebuilt exactly.
   */
  create(patientId: string, author: { id: string; name: string }, rec: Omit<ClinicalRecord, "author" | "createdAt" | "source">, scan?: Uint8Array): RecordMeta {
    const id = globalThis.crypto.randomUUID();
    const full: ClinicalRecord = { ...rec, author: author.name, createdAt: new Date().toISOString() };
    let cover: Gray;
    let scanInfo: ScanInfo;
    let toStored: (stego: Gray) => Uint8Array;
    let originalSha256: string;
    if (scan && isDicom(scan)) {
      let info;
      try {
        info = parseDicom(scan);
      } catch (e) {
        throw new VaultError(422, (e as DicomError).message);
      }
      if (info.rows * info.columns > 4096 * 4096) throw new VaultError(413, "Scans larger than 4096×4096 are not supported.");
      cover = readPixels(scan, info);
      const { file: anon, removed } = deidentify(scan, info);
      full.source = { format: "dicom", removed };
      scanInfo = { format: "dicom", bitDepth: info.bitsStored, modality: info.modality, rescale: info.rescale, removedFields: removedNames(removed), ...(info.window ? { window: storedWindow(info) } : {}) };
      toStored = (stego) => writePixels(anon, info, stego);
      originalSha256 = sha256(scan);
    } else {
      if (scan) {
        const { image } = decodePng(scan);
        if (image.width * image.height > 4096 * 4096) throw new VaultError(413, "Scans larger than 4096×4096 are not supported.");
        cover = image;
      } else cover = phantom(512, Math.floor(Math.random() * 1e6));
      scanInfo = { format: "png", bitDepth: cover.data instanceof Uint16Array ? 16 : 8 };
      toStored = (stego) => encodePng(stego);
      originalSha256 = pixelHash(cover);
    }

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
    const stored = toStored(result.image);
    const meta: Omit<RecordMeta, "authorName"> = {
      id,
      patientId,
      authorId: author.id,
      title: rec.title,
      createdAt: Date.now(),
      width: cover.width,
      height: cover.height,
      stegoSha256: sha256(stored),
      originalSha256,
      pixelSha256: pixelHash(cover),
      stats: { ...result.stats, psnr: +psnr(cover, result.image).toFixed(2), ssim: +ssim(cover, result.image).toFixed(4), embedMs },
      scan: scanInfo,
    };
    this.db.insertRecord({ ...meta, title: encryptField(this.kek, `title:${id}`, rec.title) }, stored, sealed.wrappedKey);
    return { ...meta, authorName: author.name };
  }

  /** The record's data key, re-wrapped under a new loan's key (see deriveLoanKey). */
  wrapForLoan(terms: Omit<Loan, "wrappedKey" | "endedAt" | "endReason" | "createdAt">): Uint8Array {
    const r = this.stored(terms.recordId);
    const lk = deriveLoanKey(this.kek, terms);
    try {
      return rewrapKey(this.kek, lk, terms.recordId, r.wrappedKey);
    } finally {
      lk.fill(0);
    }
  }

  private loanKey(loan: Loan) {
    if (!loan.wrappedKey) throw new VaultError(404, "This loan has ended and its key was destroyed");
    return { kek: deriveLoanKey(this.kek, loan), wrappedKey: loan.wrappedKey };
  }

  /** Pixels of a stored file, whatever its format. */
  private pixels(r: StoredRecord, file: Uint8Array): Gray {
    if (r.scan?.format === "dicom") {
      if (!isDicom(file)) throw new RdhError("This file is not the DICOM scan this record was stored in");
      return readPixels(file, parseDicom(file));
    }
    return decodePng(file).image;
  }

  /**
   * Opens a record from its stored file: verifies the file hash, extracts the payload, decrypts it
   * and checks the restored scan (for DICOM, the whole rebuilt file) matches the original's hash.
   */
  open(recordId: string, opts: { file?: Uint8Array; loan?: Loan } = {}) {
    const r = this.stored(recordId);
    const stored = opts.file ?? r.stegoPng;
    const fileIntact = sha256(stored) === r.stegoSha256;
    let extracted;
    try {
      extracted = extract(this.pixels(r, stored));
    } catch (e) {
      throw new VaultError(409, `Tampering detected: ${(e as Error).message}`, "watermark");
    }
    const { recordId: embeddedId, ciphertext } = unpack(extracted.payload);
    if (embeddedId !== recordId) throw new VaultError(409, "Tampering detected: this image carries a different record", "binding");
    let record: ClinicalRecord;
    try {
      // A doctor reading through a loan opens the data key with the loan's key, not the master key.
      const key = opts.loan ? this.loanKey(opts.loan) : { kek: this.kek, wrappedKey: r.wrappedKey };
      record = decryptRecord<ClinicalRecord>(key.kek, recordId, r.patientId, { ciphertext, wrappedKey: key.wrappedKey });
    } catch (e) {
      if (e instanceof CryptoError) throw new VaultError(409, opts.loan ? "This loan's key does not open the record: its terms were changed after it was made" : `Tampering detected: ${e.message}`, "decrypt");
      throw e;
    }
    let originalFile: Uint8Array | null = null;
    let restoredExact: boolean;
    if (r.scan?.format === "dicom" && record.source) {
      originalFile = reidentify(writePixels(stored, parseDicom(stored), extracted.image), record.source.removed);
      restoredExact = sha256(originalFile) === r.originalSha256;
    } else restoredExact = pixelHash(extracted.image) === r.originalSha256;
    const { source: _s, ...clinical } = record;
    return { meta: r, record: clinical as ClinicalRecord, original: extracted.image, originalFile, verification: { fileIntact, restoredExact, layers: extracted.layers } };
  }

  /** Identifies an uploaded stego file (PNG or DICOM) without trusting anything but its pixels. */
  identify(file: Uint8Array): string {
    try {
      const g = isDicom(file) ? readPixels(file, parseDicom(file)) : decodePng(file).image;
      return unpack(extract(g).payload).recordId;
    } catch (e) {
      throw new VaultError(422, e instanceof RdhError || e instanceof DicomError ? e.message : "This file does not carry a MedVault record");
    }
  }

  /** An 8-bit PNG for viewing: the stored scan, the restored scan, or a map of changed pixels. */
  image(recordId: string, variant: "stego" | "original" | "diff", loan?: Loan): Uint8Array {
    const r = this.stored(recordId);
    const stego = this.pixels(r, r.stegoPng);
    const view = (g: Gray) => encodePng(toDisplay(g, r.scan?.window));
    if (variant === "stego") return r.scan?.format === "dicom" || stego.data instanceof Uint16Array ? view(stego) : r.stegoPng;
    const { original } = this.open(recordId, { loan });
    if (variant === "original") return original.data instanceof Uint16Array || r.scan?.window ? view(original) : encodePng(original);
    return encodePng(differenceMap(original, stego));
  }

  /** Files to download: the stored (stego, de-identified) file, or the restored original. */
  file(recordId: string, kind: "stored" | "original", loan?: Loan): { bytes: Uint8Array; filename: string; type: string } {
    const r = this.stored(recordId);
    const dicom = r.scan?.format === "dicom";
    const ext = dicom ? "dcm" : "png";
    const type = dicom ? "application/dicom" : "image/png";
    if (kind === "stored") return { bytes: r.stegoPng, filename: `medvault-${recordId.slice(0, 8)}-stored.${ext}`, type };
    const opened = this.open(recordId, { loan });
    return { bytes: opened.originalFile ?? encodePng(opened.original), filename: `medvault-${recordId.slice(0, 8)}-original.${ext}`, type };
  }

  /** Demonstrates integrity protection: changes one pixel of a copy and tries to open it. */
  tamperTest(recordId: string) {
    const r = this.stored(recordId);
    const img = this.pixels(r, r.stegoPng);
    const y = Math.floor(img.height / 2);
    const x = Math.floor(img.width / 2);
    const i = y * img.width + x;
    const mid = (img.maxValue ?? 255) / 2;
    img.data[i] = img.data[i] > mid ? img.data[i] - 3 : img.data[i] + 3;
    const tampered = r.scan?.format === "dicom" ? writePixels(r.stegoPng, parseDicom(r.stegoPng), img) : encodePng(img);
    try {
      const r2 = this.open(recordId, { file: tampered });
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

/** The DICOM display window expressed in stored pixel values (the image is kept in that domain). */
function storedWindow(info: { window?: { center: number; width: number }; rescale: { slope: number; intercept: number }; signed: boolean; bitsStored: number }) {
  const w = info.window!;
  const slope = info.rescale.slope || 1;
  const offset = info.signed ? 1 << (info.bitsStored - 1) : 0;
  return { center: (w.center - info.rescale.intercept) / slope + offset, width: w.width / slope };
}
