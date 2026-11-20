import { isDicom, parseDicom, readPixels } from "./dicom";
import { decodePng, pixelHash } from "./imaging";
import { extract, type Gray } from "./rdh";

export type Recovery = {
  stored: Gray;
  restored: Gray;
  /** Bytes extracted from the pixels: the record, still encrypted. */
  payloadBytes: number;
  layers: number;
  /** SHA-256 of the restored pixels, computed here. */
  fingerprint: string;
  /** Pixels that differ between the stored and the restored image (where the bits were hidden). */
  changedPixels: number;
  ms: { decode: number; extract: number; hash: number };
  /** The DICOM display window, in stored values, if the file has one. */
  window?: { center: number; width: number };
};

/**
 * Recovers the original pixels from a stored MedVault file without any key and fingerprints
 * them. Runs the same in the browser, so a viewer can check bit-exact recovery themselves
 * instead of trusting the server: compare `fingerprint` with the one sealed into the signed log.
 */
export function recover(file: Uint8Array): Recovery {
  const t0 = performance.now();
  const stored = isDicom(file) ? readPixels(file, parseDicom(file)) : decodePng(file).image;
  const t1 = performance.now();
  const out = extract(stored);
  const t2 = performance.now();
  const fingerprint = pixelHash(out.image);
  const t3 = performance.now();
  let changed = 0;
  for (let i = 0; i < stored.data.length; i++) if (stored.data[i] !== out.image.data[i]) changed++;
  return { stored, restored: out.image, payloadBytes: out.payload.length, layers: out.layers, fingerprint, changedPixels: changed, ms: { decode: t1 - t0, extract: t2 - t1, hash: t3 - t2 } };
}
