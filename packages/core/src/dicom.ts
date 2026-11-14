import type { Gray } from "./rdh";

/**
 * DICOM (Part 10) support for single-frame grayscale images such as CT, MR and X-ray:
 * reads uncompressed little-endian files (explicit or implicit VR), exposes the pixels at their
 * real bit depth, de-identifies the header in place, and writes pixels back without moving a
 * single byte of anything else. Because nothing is re-encoded, restoring the removed header
 * values and the original pixels gives back a file identical to the upload, byte for byte.
 */

export class DicomError extends Error {}

const TS_IMPLICIT = "1.2.840.10008.1.2";
const TS_EXPLICIT = "1.2.840.10008.1.2.1";
const LONG_VRS = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "SV", "UC", "UN", "UR", "UT", "UV"]);

/** Identifying attributes removed before storage (a subset of the DICOM PS3.15 Basic Profile). */
export const PHI_TAGS: Record<string, string> = {
  "00100010": "Patient's Name",
  "00100020": "Patient ID",
  "00100030": "Patient's Birth Date",
  "00100032": "Patient's Birth Time",
  "00101000": "Other Patient IDs",
  "00101001": "Other Patient Names",
  "00101040": "Patient's Address",
  "00102154": "Patient's Telephone Numbers",
  "00080050": "Accession Number",
  "00080080": "Institution Name",
  "00080081": "Institution Address",
  "00080090": "Referring Physician's Name",
  "00081048": "Physician(s) of Record",
  "00081050": "Performing Physician's Name",
  "00081070": "Operators' Name",
  "00200010": "Study ID",
};

export type DicomElement = { tag: string; vr: string; offset: number; length: number };

export type DicomInfo = {
  transferSyntax: string;
  rows: number;
  columns: number;
  bitsAllocated: number;
  bitsStored: number;
  signed: boolean;
  modality: string;
  photometric: string;
  window?: { center: number; width: number };
  rescale: { slope: number; intercept: number };
  pixel: { offset: number; length: number };
  phi: DicomElement[];
  /** Selected non-identifying header values, for display. */
  meta: Record<string, string>;
};

const tagHex = (g: number, e: number) => g.toString(16).padStart(4, "0") + e.toString(16).padStart(4, "0");
const ascii = (b: Uint8Array) => new TextDecoder("latin1").decode(b).replace(/[\0 ]+$/, "").trim();

export const isDicom = (b: Uint8Array) => b.length > 132 && b[128] === 0x44 && b[129] === 0x49 && b[130] === 0x43 && b[131] === 0x4d;

const WANTED: Record<string, string> = {
  "00080060": "modality",
  "00081030": "studyDescription",
  "0008103e": "seriesDescription",
  "00180050": "sliceThickness",
  "00280004": "photometric",
  "00280030": "pixelSpacing",
  "00281050": "windowCenter",
  "00281051": "windowWidth",
  "00281052": "rescaleIntercept",
  "00281053": "rescaleSlope",
};

export function parseDicom(b: Uint8Array): DicomInfo {
  if (!isDicom(b)) throw new DicomError("Not a DICOM Part 10 file (no DICM marker).");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const strings: Record<string, string> = {};
  const us: Record<string, number> = {};
  const phi: DicomElement[] = [];
  let pixel: DicomInfo["pixel"] | null = null;
  let ts = "";

  const need = (o: number, n: number) => {
    if (o + n > b.length) throw new DicomError("The file is truncated.");
  };

  /** Skips the items of a sequence (or encapsulated pixel data) with undefined length. */
  const skipUndefined = (o: number, explicit: boolean): number => {
    for (let guard = 0; guard < 1_000_000; guard++) {
      need(o, 8);
      const g = v.getUint16(o, true);
      const e = v.getUint16(o + 2, true);
      const len = v.getUint32(o + 4, true);
      o += 8;
      if (g === 0xfffe && e === 0xe0dd) return o; // sequence delimitation
      if (g === 0xfffe && e === 0xe000) {
        if (len === 0xffffffff) o = walk(o, explicit, true);
        else o += len;
        continue;
      }
      throw new DicomError("Malformed sequence.");
    }
    throw new DicomError("Malformed sequence.");
  };

  /** Walks elements from `o`; inside an undefined-length item, stops at the item delimiter. */
  const walk = (o: number, explicit: boolean, inItem: boolean, end = b.length, topLevel = false): number => {
    while (o < end) {
      need(o, 8);
      const g = v.getUint16(o, true);
      const e = v.getUint16(o + 2, true);
      if (inItem && g === 0xfffe && e === 0xe00d) return o + 8;
      const tag = tagHex(g, e);
      let vr = "";
      let len: number;
      let valueAt: number;
      const isExplicit = explicit || g === 0x0002;
      if (isExplicit && g !== 0xfffe) {
        vr = String.fromCharCode(b[o + 4], b[o + 5]);
        if (LONG_VRS.has(vr)) {
          need(o, 12);
          len = v.getUint32(o + 8, true);
          valueAt = o + 12;
        } else {
          len = v.getUint16(o + 6, true);
          valueAt = o + 8;
        }
      } else {
        len = v.getUint32(o + 4, true);
        valueAt = o + 8;
      }
      if (len === 0xffffffff) {
        if (topLevel && tag === "7fe00010") throw new DicomError("Compressed (encapsulated) pixel data is not supported. Decompress first, e.g. with gdcmconv --raw.");
        o = skipUndefined(valueAt, explicit);
        continue;
      }
      need(valueAt, len);
      if (topLevel) {
        if (tag === "00020010") ts = ascii(b.subarray(valueAt, valueAt + len));
        if (tag in WANTED) strings[WANTED[tag]] = ascii(b.subarray(valueAt, valueAt + len));
        if (tag in PHI_TAGS && len > 0) phi.push({ tag, vr, offset: valueAt, length: len });
        if (["00280010", "00280011", "00280100", "00280101", "00280103", "00280002"].includes(tag) && len >= 2) us[tag] = v.getUint16(valueAt, true);
        if (tag === "00280008") strings.frames = ascii(b.subarray(valueAt, valueAt + len));
        if (tag === "7fe00010") pixel = { offset: valueAt, length: len };
      }
      o = valueAt + len;
      if (topLevel && g === 0x0002 && o < end && v.getUint16(o, true) !== 0x0002) {
        // End of the file meta group: the rest follows the transfer syntax.
        if (ts !== TS_IMPLICIT && ts !== TS_EXPLICIT) throw new DicomError(`Transfer syntax ${ts || "(missing)"} is not supported. Use uncompressed little-endian DICOM.`);
        explicit = ts === TS_EXPLICIT;
      }
    }
    return o;
  };

  walk(132, true, false, b.length, true);
  if (!pixel) throw new DicomError("The file has no pixel data.");
  const px = pixel as DicomInfo["pixel"];
  const rows = us["00280010"];
  const columns = us["00280011"];
  const bitsAllocated = us["00280100"];
  const bitsStored = us["00280101"] ?? bitsAllocated;
  if (!rows || !columns) throw new DicomError("Rows and Columns are missing.");
  if ((us["00280002"] ?? 1) !== 1) throw new DicomError("Only grayscale images are supported (Samples per Pixel must be 1).");
  if (Number(strings.frames ?? 1) > 1) throw new DicomError("Multi-frame DICOM is not supported yet; export a single slice.");
  if (bitsAllocated !== 8 && bitsAllocated !== 16) throw new DicomError(`Bits Allocated ${bitsAllocated} is not supported (8 or 16).`);
  if (bitsStored > bitsAllocated || bitsStored < 2) throw new DicomError("Bits Stored is invalid.");
  if (px.length < rows * columns * (bitsAllocated / 8)) throw new DicomError("Pixel data is shorter than Rows × Columns.");
  const num = (s: string | undefined, d: number) => {
    const n = Number((s ?? "").split("\\")[0]);
    return Number.isFinite(n) && s !== undefined && s !== "" ? n : d;
  };
  const meta: Record<string, string> = {};
  for (const k of ["modality", "studyDescription", "seriesDescription", "sliceThickness", "pixelSpacing"]) if (strings[k]) meta[k] = strings[k];
  const wc = strings.windowCenter;
  const ww = strings.windowWidth;
  return {
    transferSyntax: ts,
    rows,
    columns,
    bitsAllocated,
    bitsStored,
    signed: us["00280103"] === 1,
    modality: strings.modality ?? "OT",
    photometric: strings.photometric ?? "MONOCHROME2",
    rescale: { slope: num(strings.rescaleSlope, 1), intercept: num(strings.rescaleIntercept, 0) },
    ...(wc && ww ? { window: { center: num(wc, 0), width: num(ww, 0) } } : {}),
    pixel: px,
    phi,
    meta,
  };
}

/**
 * Pixels in an unsigned domain with `maxValue` = 2^BitsStored - 1. Signed images are shifted by
 * 2^(BitsStored-1). Bits above Bits Stored (sometimes used for overlays) are left as they are.
 */
export function readPixels(b: Uint8Array, info: DicomInfo): Gray {
  const n = info.rows * info.columns;
  const mask = (1 << info.bitsStored) - 1;
  const offset = info.signed ? 1 << (info.bitsStored - 1) : 0;
  const signBit = 1 << (info.bitsStored - 1);
  const data = new Uint16Array(n);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < n; i++) {
    const raw = info.bitsAllocated === 16 ? v.getUint16(info.pixel.offset + i * 2, true) : b[info.pixel.offset + i];
    let s = raw & mask;
    if (info.signed && s & signBit) s -= 1 << info.bitsStored;
    data[i] = s + offset;
  }
  return { width: info.columns, height: info.rows, data, maxValue: mask };
}

/** Writes pixels back in place, keeping every other bit of the file unchanged. Returns a new buffer. */
export function writePixels(b: Uint8Array, info: DicomInfo, g: Gray): Uint8Array {
  const out = b.slice();
  const n = info.rows * info.columns;
  const mask = (1 << info.bitsStored) - 1;
  const offset = info.signed ? 1 << (info.bitsStored - 1) : 0;
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < n; i++) {
    const stored = (g.data[i] - offset) & mask;
    if (info.bitsAllocated === 16) {
      const at = info.pixel.offset + i * 2;
      v.setUint16(at, (v.getUint16(at, true) & ~mask & 0xffff) | stored, true);
    } else out[info.pixel.offset + i] = (out[info.pixel.offset + i] & ~mask & 0xff) | stored;
  }
  return out;
}

export type RemovedValue = { tag: string; offset: number; value: string };

/** Blanks identifying header values in place (same length, so nothing moves) and returns what was removed. */
export function deidentify(b: Uint8Array, info: DicomInfo): { file: Uint8Array; removed: RemovedValue[] } {
  const out = b.slice();
  const removed: RemovedValue[] = [];
  for (const el of info.phi) {
    const original = out.subarray(el.offset, el.offset + el.length);
    let s = "";
    for (const c of original) s += String.fromCharCode(c);
    removed.push({ tag: el.tag, offset: el.offset, value: btoa(s) });
    out.fill(0x20, el.offset, el.offset + el.length);
  }
  return { file: out, removed };
}

/** Puts removed header values back, exactly where they were. */
export function reidentify(b: Uint8Array, removed: RemovedValue[]): Uint8Array {
  const out = b.slice();
  for (const r of removed) {
    const bytes = Uint8Array.from(atob(r.value), (c) => c.charCodeAt(0));
    if (r.offset + bytes.length > out.length) throw new DicomError("Header restore points outside the file.");
    out.set(bytes, r.offset);
  }
  return out;
}

/** Readable names of the removed attributes, for the UI (never the values). */
export const removedNames = (removed: { tag: string }[]) => removed.map((r) => PHI_TAGS[r.tag] ?? r.tag);

// ---------- writer for synthetic scans (demo data and tests) ----------

type El = { g: number; e: number; vr: string; value: Uint8Array };

const pad = (s: string, vr: string) => {
  const even = s.length % 2 ? s + (vr === "UI" ? "\0" : " ") : s;
  return new TextEncoder().encode(even);
};
const u16 = (n: number) => new Uint8Array([n & 0xff, n >> 8]);

function encodeEl(el: El): Uint8Array {
  const long = LONG_VRS.has(el.vr);
  const head = new Uint8Array(long ? 12 : 8);
  const dv = new DataView(head.buffer);
  dv.setUint16(0, el.g, true);
  dv.setUint16(2, el.e, true);
  head[4] = el.vr.charCodeAt(0);
  head[5] = el.vr.charCodeAt(1);
  if (long) dv.setUint32(8, el.value.length, true);
  else dv.setUint16(6, el.value.length, true);
  const out = new Uint8Array(head.length + el.value.length);
  out.set(head);
  out.set(el.value, head.length);
  return out;
}

export type SyntheticDicom = {
  pixels: Uint16Array;
  width: number;
  height: number;
  bitsStored?: number;
  signed?: boolean;
  modality?: string;
  patientName?: string;
  patientId?: string;
  birthDate?: string;
  institution?: string;
  study?: string;
  window?: { center: number; width: number };
  rescale?: { slope: number; intercept: number };
  uid?: string;
};

/** Writes an explicit-VR little-endian DICOM file (CT Image Storage). */
export function writeDicom(s: SyntheticDicom): Uint8Array {
  const uid = s.uid ?? `2.25.${Array.from({ length: 30 }, (_, i) => ((i * 7 + s.width) % 10).toString()).join("")}`;
  const str = (g: number, e: number, vr: string, value: string): El => ({ g, e, vr, value: pad(value, vr) });
  const meta: El[] = [
    { g: 2, e: 1, vr: "OB", value: new Uint8Array([0, 1]) },
    str(2, 2, "UI", "1.2.840.10008.5.1.4.1.1.2"),
    str(2, 3, "UI", uid),
    str(2, 0x10, "UI", TS_EXPLICIT),
    str(2, 0x12, "UI", "1.2.826.0.1.3680043.10.1078"),
    str(2, 0x13, "SH", "MEDVAULT_1"),
  ];
  const metaBytes = meta.map(encodeEl);
  const metaLen = metaBytes.reduce((a, x) => a + x.length, 0);
  const groupLen = encodeEl({ g: 2, e: 0, vr: "UL", value: new Uint8Array(new Uint32Array([metaLen]).buffer) });
  const bits = s.bitsStored ?? 12;
  const pixelBytes = new Uint8Array(s.pixels.buffer, s.pixels.byteOffset, s.pixels.byteLength);
  const ds: El[] = [
    str(8, 0x16, "UI", "1.2.840.10008.5.1.4.1.1.2"),
    str(8, 0x18, "UI", uid),
    str(8, 0x50, "SH", "ACC0001"),
    str(8, 0x60, "CS", s.modality ?? "CT"),
    str(8, 0x80, "LO", s.institution ?? "MedVault Demo Hospital"),
    str(8, 0x90, "PN", "Demo^Referrer"),
    str(8, 0x1030, "LO", s.study ?? "HEAD CT"),
    str(0x10, 0x10, "PN", s.patientName ?? "Doe^Jane"),
    str(0x10, 0x20, "LO", s.patientId ?? "MV-000001"),
    str(0x10, 0x30, "DA", s.birthDate ?? "19800101"),
    str(0x18, 0x50, "DS", "2.5"),
    str(0x20, 0x10, "SH", "1"),
    { g: 0x28, e: 0x02, vr: "US", value: u16(1) },
    str(0x28, 0x04, "CS", "MONOCHROME2"),
    { g: 0x28, e: 0x10, vr: "US", value: u16(s.height) },
    { g: 0x28, e: 0x11, vr: "US", value: u16(s.width) },
    str(0x28, 0x30, "DS", "0.5\\0.5"),
    { g: 0x28, e: 0x100, vr: "US", value: u16(16) },
    { g: 0x28, e: 0x101, vr: "US", value: u16(bits) },
    { g: 0x28, e: 0x102, vr: "US", value: u16(bits - 1) },
    { g: 0x28, e: 0x103, vr: "US", value: u16(s.signed ? 1 : 0) },
    str(0x28, 0x1050, "DS", String(s.window?.center ?? 40)),
    str(0x28, 0x1051, "DS", String(s.window?.width ?? 400)),
    str(0x28, 0x1052, "DS", String(s.rescale?.intercept ?? -1024)),
    str(0x28, 0x1053, "DS", String(s.rescale?.slope ?? 1)),
    { g: 0x7fe0, e: 0x10, vr: "OW", value: pixelBytes },
  ];
  const parts = [new Uint8Array(128), new TextEncoder().encode("DICM"), groupLen, ...metaBytes, ...ds.map(encodeEl)];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A synthetic 12-bit head CT in stored values (HU + 1024), from the Shepp–Logan phantom. */
export function ctPhantom(size = 256, seed = 1): Uint16Array {
  const E: [number, number, number, number, number, number][] = [
    [2000, 0.69, 0.92, 0, 0, 0],
    [-980, 0.6624, 0.874, 0, -0.0184, 0],
    [-20, 0.11, 0.31, 0.22, 0, -18],
    [-20, 0.16, 0.41, -0.22, 0, 18],
    [30, 0.21, 0.25, 0, 0.35, 0],
    [15, 0.046, 0.046, 0, 0.1, 0],
    [15, 0.046, 0.046, 0, -0.1, 0],
    [25, 0.046, 0.023, -0.08, -0.605, 0],
    [25, 0.023, 0.023, 0, -0.606, 0],
    [25, 0.023, 0.046, 0.06, -0.605, 0],
  ];
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
  const out = new Uint16Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (2 * px) / (size - 1) - 1;
      const y = 1 - (2 * py) / (size - 1);
      let hu = -1000;
      for (const [I, a, b, x0, y0, deg] of E) {
        const t = (deg * Math.PI) / 180;
        const dx = x - x0;
        const dy = y - y0;
        const xr = dx * Math.cos(t) + dy * Math.sin(t);
        const yr = -dx * Math.sin(t) + dy * Math.cos(t);
        if ((xr * xr) / (a * a) + (yr * yr) / (b * b) <= 1) hu += I;
      }
      const noise = (rnd() + rnd() + rnd() - 1.5) * (hu > -900 ? 8 : 2);
      out[py * size + px] = Math.max(0, Math.min(4095, Math.round(hu + 1024 + noise)));
    }
  }
  return out;
}
