import { sha256 as sha256Bytes } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { convertIndexedToRgb, decode, encode, type DecodedPng } from "fast-png";
import { maxOf, type Gray } from "./rdh";

/** Decodes a PNG to 8-bit grayscale. Colour images are converted with Rec. 601 luma. */
/**
 * Decodes a PNG to grayscale. 16-bit grayscale stays 16-bit (so reversibility holds for medical
 * exports); colour and palette images are converted to 8-bit with Rec. 601 luma.
 */
export function decodePng(buf: Uint8Array): { image: Gray; wasGray: boolean } {
  let png: DecodedPng;
  try {
    png = decode(buf);
  } catch {
    throw new Error("That file is not a valid PNG image.");
  }
  const { width, height } = png;
  let channels = png.channels;
  let data: ArrayLike<number> = png.data;
  let max = (1 << png.depth) - 1;
  if (png.palette) {
    data = convertIndexedToRgb(png);
    channels = png.transparency ? 4 : 3;
    max = 255;
  }
  if (png.depth === 16 && channels <= 2 && !png.palette) {
    const out = new Uint16Array(width * height);
    for (let i = 0; i < out.length; i++) out[i] = data[i * channels];
    return { image: { width, height, data: out, maxValue: 65535 }, wasGray: true };
  }
  const scale = 255 / max;
  const out = new Uint8Array(width * height);
  let wasGray = true;
  for (let i = 0; i < width * height; i++) {
    const k = i * channels;
    if (channels < 3) {
      out[i] = Math.round(data[k] * scale);
      continue;
    }
    const r = Math.round(data[k] * scale);
    const g = Math.round(data[k + 1] * scale);
    const b = Math.round(data[k + 2] * scale);
    if (r !== g || g !== b) wasGray = false;
    out[i] = r === g && g === b ? r : Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return { image: { width, height, data: out }, wasGray };
}

/** Encodes grayscale losslessly: 8-bit stays 8-bit, anything deeper is written as 16-bit. */
export function encodePng(g: Gray): Uint8Array {
  if (g.data instanceof Uint16Array) return encode({ width: g.width, height: g.height, data: g.data, depth: 16, channels: 1 });
  return encode({ width: g.width, height: g.height, data: g.data, depth: 8, channels: 1 });
}

/**
 * Maps a high-bit-depth image to 8 bits for display. `center` and `width` are a window on the
 * stored values (as radiologists set them); without them the full range in use is shown.
 */
export function toDisplay(g: Gray, window?: { center: number; width: number }): Gray {
  if (!(g.data instanceof Uint16Array) && !window) return g;
  let lo: number;
  let hi: number;
  if (window && window.width > 0) {
    lo = window.center - window.width / 2;
    hi = window.center + window.width / 2;
  } else {
    lo = Infinity;
    hi = -Infinity;
    for (const v of g.data) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const out = new Uint8Array(g.data.length);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(((g.data[i] - lo) / span) * 255)));
  return { width: g.width, height: g.height, data: out };
}

export const sha256 = (b: Uint8Array) => bytesToHex(sha256Bytes(b));
/** SHA-256 over dimensions and pixels. 8-bit images keep the original format so older records still verify. */
export const pixelHash = (g: Gray) => {
  const dims = new Uint32Array(g.data instanceof Uint16Array ? [g.width, g.height, 16] : [g.width, g.height]);
  const px = new Uint8Array(g.data.buffer, g.data.byteOffset, g.data.byteLength);
  const all = new Uint8Array(dims.byteLength + px.length);
  all.set(new Uint8Array(dims.buffer), 0);
  all.set(px, dims.byteLength);
  return sha256(all);
};

/** Visualises where pixels changed: unchanged black, changed white. */
export function differenceMap(a: Gray, b: Gray): Gray {
  const out = new Uint8Array(a.data.length);
  for (let i = 0; i < out.length; i++) out[i] = a.data[i] === b.data[i] ? 0 : 255;
  return { width: a.width, height: a.height, data: out };
}

/** Peak signal-to-noise ratio, relative to the image's own peak value (255, 4095, 65535...). */
export function psnr(a: Gray, b: Gray): number {
  let mse = 0;
  for (let i = 0; i < a.data.length; i++) mse += (a.data[i] - b.data[i]) ** 2;
  mse /= a.data.length;
  const peak = maxOf(a);
  return mse === 0 ? Infinity : 10 * Math.log10((peak * peak) / mse);
}

/** Mean SSIM over 8x8 windows (Wang et al., 2004). */
export function ssim(a: Gray, b: Gray, win = 8): number {
  const L = maxOf(a);
  const C1 = (0.01 * L) ** 2;
  const C2 = (0.03 * L) ** 2;
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
