import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import type { Gray } from "./rdh";

/** Decodes a PNG to 8-bit grayscale. Colour images are converted with Rec. 601 luma. */
export function decodePng(buf: Uint8Array): { image: Gray; wasGray: boolean } {
  let png: PNG;
  try {
    png = PNG.sync.read(Buffer.from(buf));
  } catch {
    throw new Error("That file is not a valid PNG image.");
  }
  const { width, height, data } = png;
  const out = new Uint8Array(width * height);
  let wasGray = true;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    if (r !== g || g !== b) wasGray = false;
    out[i] = r === g && g === b ? r : Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return { image: { width, height, data: out }, wasGray };
}

/** Encodes grayscale as a lossless 8-bit grayscale PNG. */
export function encodePng(g: Gray): Uint8Array {
  const png = new PNG({ width: g.width, height: g.height, colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false });
  png.data = Buffer.from(g.data);
  return new Uint8Array(PNG.sync.write(png, { colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false }));
}

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export const pixelHash = (g: Gray) => sha256(new Uint8Array([...new Uint8Array(new Uint32Array([g.width, g.height]).buffer), ...g.data]));

/** Visualises where pixels changed: unchanged black, changed white. */
export function differenceMap(a: Gray, b: Gray): Gray {
  const out = new Uint8Array(a.data.length);
  for (let i = 0; i < out.length; i++) out[i] = a.data[i] === b.data[i] ? 0 : 255;
  return { width: a.width, height: a.height, data: out };
}

export function psnr(a: Gray, b: Gray): number {
  let mse = 0;
  for (let i = 0; i < a.data.length; i++) mse += (a.data[i] - b.data[i]) ** 2;
  mse /= a.data.length;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/** Mean SSIM over 8x8 windows (Wang et al., 2004). */
export function ssim(a: Gray, b: Gray, win = 8): number {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  let total = 0;
  let n = 0;
  for (let y = 0; y + win <= a.height; y += win) {
    for (let x = 0; x + win <= a.width; x += win) {
      let ma = 0;
      let mb = 0;
      for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) {
        const k = (y + j) * a.width + x + i;
        ma += a.data[k];
        mb += b.data[k];
      }
      const N = win * win;
      ma /= N;
      mb /= N;
      let va = 0;
      let vb = 0;
      let cov = 0;
      for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) {
        const k = (y + j) * a.width + x + i;
        va += (a.data[k] - ma) ** 2;
        vb += (b.data[k] - mb) ** 2;
        cov += (a.data[k] - ma) * (b.data[k] - mb);
      }
      va /= N - 1;
      vb /= N - 1;
      cov /= N - 1;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  }
  return n ? total / n : 1;
}

/**
 * Synthetic CT slice based on the Shepp-Logan head phantom, with acquisition noise.
 * Used for demos and tests so no real patient imaging is ever needed.
 */
export function phantom(size = 512, seed = 1): Gray {
  // [intensity, a, b, x0, y0, angle°] from Shepp & Logan (1974), modified contrast (Toft).
  const E: [number, number, number, number, number, number][] = [
    [1, 0.69, 0.92, 0, 0, 0],
    [-0.8, 0.6624, 0.874, 0, -0.0184, 0],
    [-0.2, 0.11, 0.31, 0.22, 0, -18],
    [-0.2, 0.16, 0.41, -0.22, 0, 18],
    [0.1, 0.21, 0.25, 0, 0.35, 0],
    [0.1, 0.046, 0.046, 0, 0.1, 0],
    [0.1, 0.046, 0.046, 0, -0.1, 0],
    [0.1, 0.046, 0.023, -0.08, -0.605, 0],
    [0.1, 0.023, 0.023, 0, -0.606, 0],
    [0.1, 0.023, 0.046, 0.06, -0.605, 0],
  ];
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
  const data = new Uint8Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (2 * px) / (size - 1) - 1;
      const y = 1 - (2 * py) / (size - 1);
      let v = 0;
      for (const [I, a, b, x0, y0, deg] of E) {
        const t = (deg * Math.PI) / 180;
        const dx = x - x0;
        const dy = y - y0;
        const xr = dx * Math.cos(t) + dy * Math.sin(t);
        const yr = -dx * Math.sin(t) + dy * Math.cos(t);
        if ((xr * xr) / (a * a) + (yr * yr) / (b * b) <= 1) v += I;
      }
      // Soft-tissue noise only inside the body; the air around the head stays black, as in real CT.
      const noise = v > 0 ? (rnd() + rnd() + rnd() - 1.5) * 6 : 0;
      data[py * size + px] = Math.max(0, Math.min(255, Math.round(v * 220 + (v > 0 ? 18 : 0) + noise)));
    }
  }
  return { width: size, height: size, data };
}
