/**
 * Downloads the real, openly licensed medical images used for measurements and the live demo,
 * checks each source against a pinned SHA-256, and converts it to a grayscale PNG in samples/.
 *
 *   npm run samples
 *
 * The PNGs are committed, so this only needs to run to reproduce them. Licences: samples/README.md.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "fflate";
import jpeg from "jpeg-js";
import { encodePng, type Gray } from "../packages/core/src/index";

type Source = { file: string; url: string; sha256: string; convert: (b: Uint8Array) => Gray };

const XRAY = "https://raw.githubusercontent.com/ieee8023/covid-chestxray-dataset/master/images";

const sources: Source[] = [
  { file: "chest-xray-pa-1.png", url: `${XRAY}/2168a917.jpg`, sha256: "a3f57a6cafe8be6da7b234db9205bace6a4158154bd4e228544b4a8e5cd008b3", convert: (b) => fit(jpegGray(b), 1024) },
  { file: "chest-xray-pa-2.png", url: `${XRAY}/5f619d7e.jpg`, sha256: "13870f4897c7542d0deac2e8f447a230023a2970b5998cc9f70a73ded6cf2311", convert: (b) => fit(jpegGray(b), 1024) },
  { file: "brain-mri-t1.png", url: "https://s3.amazonaws.com/openneuro.org/ds000001/sub-01/anat/sub-01_T1w.nii.gz", sha256: "bdb7022ae229c5b8edd16425928c9243c562f84082b9b8e6f97cdba8b9354a98", convert: (b) => niftiSlice(gunzipSync(b)) },
];

const hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** JPEG to 8-bit grayscale (Rec. 601 luma for colour files). */
function jpegGray(b: Uint8Array): Gray {
  const img = jpeg.decode(b, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]);
  return { width: img.width, height: img.height, data: out };
}

/** Box-filter downscale so the longer side is at most `max` pixels (keeps the repo and the demo small). */
function fit(g: Gray, max: number): Gray {
  const k = Math.ceil(Math.max(g.width, g.height) / max);
  if (k <= 1) return g;
  const w = Math.floor(g.width / k);
  const h = Math.floor(g.height / k);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += g.data[(y * k + dy) * g.width + x * k + dx];
      out[y * w + x] = Math.round(s / (k * k));
    }
  return { width: w, height: h, data: out };
}

/** The middle slice of a NIfTI-1 volume, kept at full 16-bit precision. */
function niftiSlice(b: Uint8Array): Gray {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getInt32(0, true) !== 348) throw new Error("Not a little-endian NIfTI-1 file");
  const [nx, ny, nz] = [v.getInt16(42, true), v.getInt16(44, true), v.getInt16(46, true)];
  const type = v.getInt16(70, true);
  const offset = Math.round(v.getFloat32(108, true));
  const read: Record<number, (i: number) => number> = {
    2: (i) => v.getUint8(offset + i),
    4: (i) => v.getInt16(offset + i * 2, true),
    512: (i) => v.getUint16(offset + i * 2, true),
  };
  if (!read[type]) throw new Error(`Unsupported NIfTI datatype ${type}`);
  const z = Math.floor(nz / 2);
  // Rows are flipped so the head is upright (NIfTI's y axis points up).
  const out = new Uint16Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) out[(ny - 1 - y) * nx + x] = Math.max(0, read[type](z * nx * ny + y * nx + x));
  return { width: nx, height: ny, data: out, maxValue: 65535 };
}

mkdirSync("samples", { recursive: true });
for (const s of sources) {
  const res = await fetch(s.url);
  if (!res.ok) throw new Error(`${s.url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = hex(bytes);
  if (s.sha256 && got !== s.sha256) throw new Error(`${s.url}: SHA-256 ${got} does not match the pinned ${s.sha256}`);
  const g = s.convert(bytes);
  const png = encodePng(g);
  writeFileSync(`samples/${s.file}`, png);
  console.log(`${s.file}  ${g.width}×${g.height} ${g.data instanceof Uint16Array ? 16 : 8}-bit  source sha256 ${got}  png sha256 ${hex(png)}`);
}
