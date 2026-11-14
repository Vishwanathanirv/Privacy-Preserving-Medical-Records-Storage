import { deflateSync, inflateSync } from "fflate";

/**
 * Reversible data hiding (RDH) for grayscale images of any bit depth: 8-bit PNG, and 12 or 16-bit
 * medical images such as CT.
 *
 * Prediction-error expansion with a rhombus predictor on a checkerboard (after Sachnev et al., 2009):
 * each interior pixel is predicted from its four neighbours, and the prediction errors 0 and -1
 * are expanded to carry one bit each, while every other error is shifted by one. No pixel changes
 * by more than 1 during embedding (2 counting overflow handling), and extraction restores the
 * original image bit for bit. Several layers are stacked when one is not enough.
 *
 * Overflow: interior pixels at 0 or the maximum (255 for 8-bit) that would leave the legal range are
 * moved one step inwards before embedding; a compressed location map, embedded in the same stream,
 * records which of them were moved.
 */

/** A grayscale image. `maxValue` is the largest legal pixel value (255 for 8-bit, 4095 for 12-bit CT). */
export type Gray = { width: number; height: number; data: Uint8Array | Uint16Array; maxValue?: number };

export const maxOf = (g: Gray) => g.maxValue ?? 255;

const MAGIC = 0x4d56; // "MV"
const HEADER_BITS = 96; // magic 16 | flags 8 | threshold 8 | mapBytes 32 | chunkBytes 32
const FLAG_INNERMOST = 1;

export class RdhError extends Error {}

const clone = (g: Gray): Gray => ({ width: g.width, height: g.height, data: g.data.slice(), ...(g.maxValue !== undefined ? { maxValue: g.maxValue } : {}) });

function toBits(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) for (let b = 0; b < 8; b++) out[i * 8 + b] = (bytes[i] >> (7 - b)) & 1;
  return out;
}

function fromBits(bits: Uint8Array, start: number, byteLen: number): Uint8Array {
  if (start + byteLen * 8 > bits.length) throw new RdhError("Embedded stream is truncated");
  const out = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[start + i * 8 + b];
    out[i] = v;
  }
  return out;
}

function header(innermost: boolean, mapBytes: number, chunkBytes: number, T: number): Uint8Array {
  const h = new Uint8Array(12);
  const v = new DataView(h.buffer);
  v.setUint16(0, MAGIC);
  v.setUint8(2, innermost ? FLAG_INNERMOST : 0);
  v.setUint8(3, T === 1 ? 0 : T); // 0 means 1, so images embedded before thresholds existed still read
  v.setUint32(4, mapBytes);
  v.setUint32(8, chunkBytes);
  return h;
}

/** Interior pixels in scan order for one checkerboard parity. */
function* positions(w: number, h: number, parity: 0 | 1) {
  for (let y = 1; y < h - 1; y++) for (let x = 1 + ((y + 1 + parity) & 1); x < w - 1; x += 2) yield y * w + x;
}

type Pixels = Uint8Array | Uint16Array;
const predict = (d: Pixels, i: number, w: number) => (d[i - w] + d[i + w] + d[i - 1] + d[i + 1]) >> 2;

/**
 * Moves the given interior pixels that would overflow inwards by T (those within T of 0 or max) and
 * returns the compressed location map: one bit per interior pixel whose value afterwards lies in
 * the band a moved pixel could land in (1 = was moved).
 */
function preprocess(g: Gray, moved: Set<number>, T: number): Uint8Array {
  const { width: w, height: h, data: d } = g;
  const max = maxOf(g);
  const bits: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = d[i];
      if (moved.has(i) && v < T) {
        d[i] = v + T;
        bits.push(1);
      } else if (moved.has(i) && v > max - T) {
        d[i] = v - T;
        bits.push(1);
      } else if ((v >= T && v < 2 * T) || (v > max - 2 * T && v <= max - T)) bits.push(0);
    }
  }
  const packed = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, k) => (packed[k >> 3] |= b << (7 - (k & 7))));
  return deflateSync(packed, { level: 9 });
}

function undoPreprocess(g: Gray, map: Uint8Array, T: number): void {
  const { width: w, height: h, data: d } = g;
  const max = maxOf(g);
  const bits = inflateSync(map);
  let k = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = d[i];
      const low = v >= T && v < 2 * T;
      const high = v > max - 2 * T && v <= max - T;
      if (low || high) {
        if (k >> 3 >= bits.length) throw new RdhError("Location map is damaged");
        const bit = (bits[k >> 3] >> (7 - (k & 7))) & 1;
        k++;
        if (bit) d[i] = low ? v - T : v + T;
      }
    }
  }
}

/**
 * Embeds bits into one checkerboard set with threshold T: prediction errors in [-T, T-1] are
 * expanded to carry one bit (e' = 2e + b, mirrored for negative errors), larger errors are shifted
 * by T. T = 1 is classic prediction-error expansion; larger T trades a little more distortion for
 * capacity on noisy high-bit-depth images. Returns how many bits were consumed.
 * Pixels that would leave 0..max are left untouched and reported in `overflow`.
 */
function embedSet(g: Gray, parity: 0 | 1, stream: Uint8Array, offset: number, overflow: number[], T: number): number {
  const { width: w, height: h, data: d } = g;
  const max = maxOf(g);
  let k = offset;
  for (const i of positions(w, h, parity)) {
    const p = predict(d, i, w);
    const e = d[i] - p;
    let e2: number;
    if (e >= T) e2 = e + T;
    else if (e < -T) e2 = e - T;
    else {
      const b = k < stream.length ? stream[k] : 0;
      k++;
      e2 = e >= 0 ? 2 * e + b : 2 * e + 1 - b;
    }
    const v = p + e2;
    if (v < 0 || v > max) overflow.push(i);
    else d[i] = v;
  }
  return k - offset;
}

function extractSet(g: Gray, parity: 0 | 1, out: number[], T: number): void {
  const { width: w, height: h, data: d } = g;
  for (const i of positions(w, h, parity)) {
    const p = predict(d, i, w);
    const e2 = d[i] - p;
    let e: number;
    if (e2 >= 2 * T) e = e2 - T;
    else if (e2 < -2 * T) e = e2 + T;
    else if (e2 >= 0) {
      e = e2 >> 1;
      out.push(e2 & 1);
    } else {
      e = Math.floor(e2 / 2);
      out.push(e2 - 2 * e === 1 ? 0 : 1);
    }
    d[i] = p + e;
  }
}

function embedLayer(input: Gray, chunk: Uint8Array, innermost: boolean, T: number): { image: Gray; fits: boolean; capacityBits: number } {
  // Only pixels that would actually overflow are moved (and mapped), which keeps flat black
  // backgrounds, common in CT and MRI, untouched. Repeat until no pixel overflows.
  const max = maxOf(input);
  const run = (moved: Set<number>) => {
    const g = clone(input);
    const map = preprocess(g, moved, T);
    const stream = toBits(new Uint8Array([...header(innermost, map.length, chunk.length, T), ...map, ...chunk]));
    const overflow: number[] = [];
    const usedA = embedSet(g, 0, stream, 0, overflow, T);
    const usedB = embedSet(g, 1, stream, usedA, overflow, T);
    return { g, overflow, used: usedA + usedB, need: stream.length, mapLen: map.length };
  };
  const moved = new Set<number>();
  for (let round = 0; round < 12; round++) {
    const r = run(moved);
    if (!r.overflow.length) return { image: r.g, fits: r.used >= r.need, capacityBits: r.used - HEADER_BITS - r.mapLen * 8 };
    for (const i of r.overflow) moved.add(i);
  }
  // Fallback: move every interior pixel within T of either end, which can never overflow.
  const all = new Set<number>();
  for (let i = 0; i < input.data.length; i++) if (input.data[i] < T || input.data[i] > max - T) all.add(i);
  const r = run(all);
  if (r.overflow.length) throw new RdhError("Internal error: overflow after full preprocessing");
  return { image: r.g, fits: r.used >= r.need, capacityBits: r.used - HEADER_BITS - r.mapLen * 8 };
}

/** Thresholds tried per layer, smallest first. 8-bit images stay at T = 1 (changes of at most ±1–2 grey levels). */
function thresholds(g: Gray): number[] {
  const max = maxOf(g);
  if (max <= 255) return [1];
  return [1, 2, 3, 4, 6, 8, 12, 16].filter((T) => 4 * T < max);
}

export type EmbedStats = { layers: number; payloadBytes: number; bitsPerPixel: number; maxPixelChange: number; thresholds?: number[] };

/**
 * Hides `payload` inside the image. Throws when the image cannot carry it within `maxLayers`.
 */
export function embed(cover: Gray, payload: Uint8Array, maxLayers = 6): { image: Gray; stats: EmbedStats } {
  if (cover.width < 8 || cover.height < 8) throw new RdhError("Image is too small");
  const max = maxOf(cover);
  if (max < 3 || max > 65535) throw new RdhError("Unsupported bit depth");
  for (let i = 0; i < cover.data.length; i++) if (cover.data[i] > max) throw new RdhError(`Pixel value ${cover.data[i]} is above the image's bit depth`);
  let img = clone(cover);
  let offset = 0;
  let layers = 0;
  const thresholdsUsed: number[] = [];
  while (true) {
    if (layers >= maxLayers) throw new RdhError(`The record is too large for this image: about ${offset} of ${payload.length} bytes fit. Use a larger scan or a shorter record.`);
    const remaining = payload.length - offset;
    // Use the smallest threshold that fits the rest of the payload in this layer; otherwise the
    // largest one, and continue in another layer.
    const Ts = thresholds(img);
    let take = remaining;
    let T = Ts[0];
    let result = embedLayer(img, payload.subarray(offset, offset + take), layers === 0, T);
    for (let j = 1; j < Ts.length && !result.fits; j++) {
      T = Ts[j];
      result = embedLayer(img, payload.subarray(offset, offset + take), layers === 0, T);
    }
    // Then size this layer's chunk to fit (capacity depends slightly on the bits).
    for (let tries = 0; !result.fits && tries < 8; tries++) {
      const cap = Math.max(0, Math.floor(result.capacityBits / 8) - 16 - tries * 64);
      take = Math.min(take - 1, cap);
      if (take <= 0) break;
      result = embedLayer(img, payload.subarray(offset, offset + take), layers === 0, T);
    }
    thresholdsUsed.push(T);
    if (!result.fits || take <= 0) throw new RdhError(`The record is too large for this image: about ${offset} of ${payload.length} bytes fit. Use a larger scan or a shorter record.`);
    // Only the innermost layer is flagged; later layers are marked as outer when written.
    img = result.image;
    offset += take;
    layers++;
    if (offset >= payload.length) break;
  }
  let maxChange = 0;
  for (let i = 0; i < cover.data.length; i++) maxChange = Math.max(maxChange, Math.abs(cover.data[i] - img.data[i]));
  return { image: img, stats: { layers, payloadBytes: payload.length, bitsPerPixel: +((payload.length * 8) / (cover.width * cover.height)).toFixed(4), maxPixelChange: maxChange, thresholds: thresholdsUsed } };
}

/** Recovers the payload and the exact original image. Throws if no payload is present or it is damaged. */
export function extract(stego: Gray, maxLayers = 16): { payload: Uint8Array; image: Gray; layers: number } {
  let g = clone(stego);
  const chunks: Uint8Array[] = [];
  for (let layer = 0; layer < maxLayers; layer++) {
    // The threshold is stored in each layer's header, which can only be read after extracting
    // with the right threshold; try each candidate and keep the one whose header checks out.
    let found: { img: Gray; bits: Uint8Array; T: number; h: DataView } | null = null;
    for (const T of thresholds(stego)) {
      const img = clone(g);
      const bitsB: number[] = [];
      const bitsA: number[] = [];
      extractSet(img, 1, bitsB, T);
      extractSet(img, 0, bitsA, T);
      const bits = Uint8Array.from([...bitsA, ...bitsB]);
      if (bits.length < HEADER_BITS) continue;
      const h = new DataView(fromBits(bits, 0, 12).buffer);
      if (h.getUint16(0) === MAGIC && (h.getUint8(3) || 1) === T) {
        found = { img, bits, T, h };
        break;
      }
    }
    if (!found) throw new RdhError(layer === 0 ? "No embedded record found" : "Embedded data is damaged");
    const { img, bits, T, h } = found;
    const mapBytes = h.getUint32(4);
    const chunkBytes = h.getUint32(8);
    if ((mapBytes + chunkBytes) * 8 + HEADER_BITS > bits.length) throw new RdhError("Embedded data is damaged");
    const map = fromBits(bits, HEADER_BITS, mapBytes);
    chunks.unshift(fromBits(bits, HEADER_BITS + mapBytes * 8, chunkBytes));
    try {
      undoPreprocess(img, map, T);
    } catch {
      throw new RdhError("Embedded data is damaged");
    }
    g = img;
    if (h.getUint8(2) & FLAG_INNERMOST) {
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const payload = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) {
        payload.set(c, o);
        o += c.length;
      }
      return { payload, image: g, layers: layer + 1 };
    }
  }
  throw new RdhError("Embedded data is damaged");
}

/** Bits that one layer can carry in this image (an estimate for UI display). */
export function estimateCapacity(cover: Gray): number {
  const Ts = thresholds(cover);
  const r = embedLayer(cover, new Uint8Array(0), true, Ts[Ts.length - 1]);
  return Math.max(0, Math.floor(r.capacityBits / 8));
}
