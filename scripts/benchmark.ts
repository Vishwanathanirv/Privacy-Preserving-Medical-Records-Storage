import { randomBytes } from "node:crypto";
import { embed, estimateCapacity, extract, phantom, pixelHash, psnr, ssim } from "../packages/core/src/index";

/** Image quality and speed for a typical encrypted record (1.5 KB) and at full single-layer capacity. */
const rows: Record<string, unknown>[] = [];
for (const size of [256, 512, 1024]) {
  const img = phantom(size, 42);
  const cap = estimateCapacity(img);
  for (const [label, bytes] of [["1.5 KB record", 1536], ["full layer", Math.floor(cap * 0.95)]] as const) {
    const payload = new Uint8Array(randomBytes(bytes));
    const t0 = performance.now();
    const { image, stats } = embed(img, payload);
    const t1 = performance.now();
    const out = extract(image);
    const t2 = performance.now();
    rows.push({
      image: `${size}×${size}`,
      payload: label,
      bytes,
      "PSNR dB": +psnr(img, image).toFixed(2),
      SSIM: +ssim(img, image).toFixed(4),
      bpp: stats.bitsPerPixel,
      "embed ms": Math.round(t1 - t0),
      "extract ms": Math.round(t2 - t1),
      exact: pixelHash(out.image) === pixelHash(img) && Buffer.from(out.payload).equals(Buffer.from(payload)),
    });
  }
}
console.table(rows);
