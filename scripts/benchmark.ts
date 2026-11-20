/**
 * Measures reversible hiding on the real, openly licensed samples in samples/ (see
 * samples/README.md for sources and licences) and writes docs/measurements.md.
 *
 *   npm run benchmark
 *
 * For each image: single-layer and maximum capacity, then for three payloads (a real sealed
 * record, 8 KB, and a full first layer) image quality, the largest pixel change, speed (median of
 * 5 runs) and whether extraction gives back the exact payload and the exact original pixels.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { decodePng, embed, encryptRecord, estimateCapacity, extract, pixelHash, ssim, type Gray } from "../packages/core/src/index";

const SAMPLES = [
  { file: "chest-xray-pa-1.png", label: "Chest X-ray PA #1" },
  { file: "chest-xray-pa-2.png", label: "Chest X-ray PA #2" },
  { file: "brain-mri-t1.png", label: "Brain MRI T1 slice" },
];
const RUNS = 5;

/** PSNR against the image's actual peak value, so 16-bit scans that use 10–12 bits are not flattered. */
function psnrPeak(a: Gray, b: Gray, peak: number) {
  let se = 0;
  for (let i = 0; i < a.data.length; i++) se += (a.data[i] - b.data[i]) ** 2;
  return se === 0 ? Infinity : 10 * Math.log10((peak * peak) / (se / a.data.length));
}
const peakOf = (g: Gray) => g.data.reduce((m, v) => Math.max(m, v), 0);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fits = (g: Gray, n: number) => {
  try {
    embed(g, new Uint8Array(n));
    return true;
  } catch {
    return false;
  }
};

/** The largest payload that fits within the default 6 layers, by binary search. */
function maxCapacity(g: Gray) {
  let lo = 0;
  let hi = Math.ceil((g.width * g.height * 6) / 8);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(g, mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// A typical clinical record sealed exactly as the vault does it, so its size is the real one.
const sealed = encryptRecord(new Uint8Array(randomBytes(32)), crypto.randomUUID(), crypto.randomUUID(), {
  title: "Chest X-ray: persistent cough",
  diagnosis: "No focal consolidation. Mild peribronchial thickening, consistent with bronchitis.",
  notes: "Cough for three weeks, no fever. Lungs clear on auscultation apart from scattered wheeze. Advised fluids and rest; review in two weeks or sooner if breathless.",
  medications: ["Salbutamol inhaler 100 mcg, 2 puffs as needed", "Paracetamol 500 mg as needed"],
  vitals: { bp: "122/78", pulse: 76, temperature: 37.2, spo2: 98 },
  author: "Dr. Example",
  createdAt: new Date().toISOString(),
}).ciphertext;

type Row = { image: string; size: string; depth: string; payload: string; bytes: number; psnr: number; ssim: number; maxChange: number; layers: number; embedMs: number; extractMs: number; mpps: number; exact: boolean };
const rows: Row[] = [];
const caps: { image: string; layer1: number; max: number; bpp: number }[] = [];

// Warm up the JIT so the first image's timings are not inflated.
for (let i = 0; i < 3; i++) extract(embed(decodePng(readFileSync(`samples/${SAMPLES[0].file}`)).image, sealed).image);

for (const s of SAMPLES) {
  const img = decodePng(readFileSync(`samples/${s.file}`)).image;
  const peak = peakOf(img);
  const depth = img.data instanceof Uint16Array ? `16 (${Math.ceil(Math.log2(peak + 1))} used)` : "8";
  const layer1 = estimateCapacity(img);
  const max = maxCapacity(img);
  caps.push({ image: s.label, layer1, max, bpp: +((max * 8) / (img.width * img.height)).toFixed(3) });
  const payloads: [string, Uint8Array][] = [
    ["sealed record", sealed],
    ["8 KB", new Uint8Array(randomBytes(8192))],
    ["full first layer", new Uint8Array(randomBytes(Math.floor(layer1 * 0.95)))],
  ];
  for (const [label, payload] of payloads) {
    if (!fits(img, payload.length)) {
      console.log(`${s.label}: ${label} (${payload.length} B) does not fit, skipped`);
      continue;
    }
    const tEmbed: number[] = [];
    const tExtract: number[] = [];
    let exact = true;
    let last!: ReturnType<typeof embed>;
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      last = embed(img, payload);
      const t1 = performance.now();
      const out = extract(last.image);
      tEmbed.push(t1 - t0);
      tExtract.push(performance.now() - t1);
      exact &&= pixelHash(out.image) === pixelHash(img) && Buffer.from(out.payload).equals(Buffer.from(payload));
    }
    const px = img.width * img.height;
    rows.push({
      image: s.label,
      size: `${img.width}×${img.height}`,
      depth,
      payload: label,
      bytes: payload.length,
      psnr: +psnrPeak(img, last.image, peak).toFixed(2),
      ssim: +ssim(img, last.image).toFixed(4),
      maxChange: last.stats.maxPixelChange,
      layers: last.stats.layers,
      embedMs: Math.round(median(tEmbed)),
      extractMs: Math.round(median(tExtract)),
      mpps: +(px / 1e6 / (median(tEmbed) / 1000)).toFixed(2),
      exact,
    });
    console.log(rows.at(-1));
  }
}

const md = `# Measurements

Generated by \`npm run benchmark\` on ${new Date().toISOString().slice(0, 10)} (Node ${process.version}, ${cpus()[0]?.model.trim() ?? "unknown CPU"}, ${RUNS} runs per row, median times).
Images are real, openly licensed scans; sources, licences and checksums are in [samples/README.md](../samples/README.md).

## Quality, speed and exact recovery

| Image | Size | Bits | Payload | Bytes | PSNR (dB) | SSIM | Max change | Layers | Embed (ms) | Extract (ms) | Embed speed (Mpx/s) | Bit-exact |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${rows.map((r) => `| ${r.image} | ${r.size} | ${r.depth} | ${r.payload} | ${r.bytes} | ${r.psnr} | ${r.ssim} | ±${r.maxChange} | ${r.layers} | ${r.embedMs} | ${r.extractMs} | ${r.mpps} | ${r.exact ? "✓ pixels and payload" : "✗"} |`).join("\n")}

PSNR is measured against each image's actual peak value (not the 65535 of a 16-bit container). Higher bit-depth scans use a wider expansion band per layer, so their largest change is bigger in grey levels but small relative to their range.
"Bit-exact" means the SHA-256 of the recovered pixels equals the original's and the recovered payload equals the one hidden, in every run.

## Capacity

| Image | One layer (bytes) | Maximum, 6 layers (bytes) | Maximum (bits per pixel) |
| --- | ---: | ---: | ---: |
${caps.map((c) => `| ${c.image} | ${c.layer1} | ${c.max} | ${c.bpp} |`).join("\n")}

A sealed record (the clinical text, compressed and encrypted with AES-256-GCM) is ${sealed.length} bytes here.
`;
writeFileSync("docs/measurements.md", md);
console.log("\nWrote docs/measurements.md");
