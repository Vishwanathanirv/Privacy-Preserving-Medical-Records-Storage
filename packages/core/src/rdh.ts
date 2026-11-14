import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Reversible data hiding (RDH) for 8-bit grayscale images.
 *
 * Prediction-error expansion with a rhombus predictor on a checkerboard (after Sachnev et al., 2009):
 * each interior pixel is predicted from its four neighbours, and the prediction errors 0 and -1
 * are expanded to carry one bit each, while every other error is shifted by one. No pixel changes
 * by more than 1 during embedding (2 counting overflow handling), and extraction restores the
 * original image bit for bit. Several layers are stacked when one is not enough.
 *
 * Overflow: interior pixels of value 0/255 are moved to 1/254 before embedding; a compressed
 * location map, embedded in the same stream, records which 1/254 pixels were originally 0/255.
 */

export type Gray = { width: number; height: number; data: Uint8Array };

const MAGIC = 0x4d56; // "MV"
const HEADER_BITS = 96; // magic 16 | flags 8 | reserved 8 | mapBytes 32 | chunkBytes 32
const FLAG_INNERMOST = 1;

export class RdhError extends Error {}

const clone = (g: Gray): Gray => ({ width: g.width, height: g.height, data: Uint8Array.from(g.data) });

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

function header(innermost: boolean, mapBytes: number, chunkBytes: number): Uint8Array {
  const h = new Uint8Array(12);
  const v = new DataView(h.buffer);
  v.setUint16(0, MAGIC);
  v.setUint8(2, innermost ? FLAG_INNERMOST : 0);
  v.setUint32(4, mapBytes);
  v.setUint32(8, chunkBytes);
  return h;
}

/** Interior pixels in scan order for one checkerboard parity. */
function* positions(w: number, h: number, parity: 0 | 1) {
  for (let y = 1; y < h - 1; y++) for (let x = 1 + ((y + 1 + parity) & 1); x < w - 1; x += 2) yield y * w + x;
}

const predict = (d: Uint8Array, i: number, w: number) => (d[i - w] + d[i + w] + d[i - 1] + d[i + 1]) >> 2;

/**
 * Moves the given interior 0/255 pixels to 1/254 and returns the compressed location map.
 * The map has one bit per interior pixel whose value is 1 or 254 afterwards: 1 = was moved.
 */
function preprocess(g: Gray, moved: Set<number>): Uint8Array {
  const { width: w, height: h, data: d } = g;
  const bits: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = d[i];
      if (moved.has(i) && (v === 0 || v === 255)) {
        d[i] = v === 0 ? 1 : 254;
        bits.push(1);
      } else if (v === 1 || v === 254) bits.push(0);
    }
  }
  const packed = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, k) => (packed[k >> 3] |= b << (7 - (k & 7))));
  return new Uint8Array(deflateRawSync(packed, { level: 9 }));
}

function undoPreprocess(g: Gray, map: Uint8Array): void {
  const { width: w, height: h, data: d } = g;
  const bits = new Uint8Array(inflateRawSync(map));
  let k = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = d[i];
      if (v === 1 || v === 254) {
        const bit = (bits[k >> 3] >> (7 - (k & 7))) & 1;
        k++;
        if (bit) d[i] = v === 1 ? 0 : 255;
      }
    }
  }
}

/**
 * Embeds bits into one checkerboard set. Returns how many bits were consumed (the rest is zero padding).
 * Pixels that would leave 0..255 are left untouched and reported in `overflow`.
 */
function embedSet(g: Gray, parity: 0 | 1, stream: Uint8Array, offset: number, overflow: number[]): number {
  const { width: w, height: h, data: d } = g;
  let k = offset;
  for (const i of positions(w, h, parity)) {
    const p = predict(d, i, w);
    const e = d[i] - p;
    let delta: number;
    if (e >= 1) delta = 1;
    else if (e <= -2) delta = -1;
    else {
      const b = k < stream.length ? stream[k] : 0;
      k++;
      delta = e === 0 ? b : -b;
    }
    const v = d[i] + delta;
    if (v < 0 || v > 255) overflow.push(i);
    else d[i] = v;
  }
  return k - offset;
}

function extractSet(g: Gray, parity: 0 | 1, out: number[]): void {
  const { width: w, height: h, data: d } = g;
  for (const i of positions(w, h, parity)) {
    const p = predict(d, i, w);
    const e = d[i] - p;
    if (e >= 2) d[i] -= 1;
    else if (e <= -3) d[i] += 1;
    else if (e === 0 || e === 1) {
      out.push(e);
      d[i] -= e;
    } else {
      out.push(-1 - e); // e is -1 or -2
      d[i] += -1 - e;
    }
  }
}

function embedLayer(input: Gray, chunk: Uint8Array, innermost: boolean): { image: Gray; fits: boolean; capacityBits: number } {
  // Only pixels that would actually overflow are moved (and mapped), which keeps flat black
  // backgrounds, common in CT and MRI, untouched. Repeat until no pixel overflows.
  const moved = new Set<number>();
  for (let round = 0; round < 12; round++) {
    const g = clone(input);
    const map = preprocess(g, moved);
    const stream = toBits(new Uint8Array([...header(innermost, map.length, chunk.length), ...map, ...chunk]));
    const overflow: number[] = [];
    const usedA = embedSet(g, 0, stream, 0, overflow);
    const usedB = embedSet(g, 1, stream, usedA, overflow);
    if (!overflow.length) return { image: g, fits: usedA + usedB >= stream.length, capacityBits: usedA + usedB - HEADER_BITS - map.length * 8 };
    for (const i of overflow) moved.add(i);
  }
  // Fallback: move every interior 0/255 pixel, which can never overflow.
  const all = new Set<number>();
  for (let i = 0; i < input.data.length; i++) if (input.data[i] === 0 || input.data[i] === 255) all.add(i);
  const g = clone(input);
  const map = preprocess(g, all);
  const stream = toBits(new Uint8Array([...header(innermost, map.length, chunk.length), ...map, ...chunk]));
  const overflow: number[] = [];
  const usedA = embedSet(g, 0, stream, 0, overflow);
  const usedB = embedSet(g, 1, stream, usedA, overflow);
  if (overflow.length) throw new RdhError("Internal error: overflow after full preprocessing");
  return { image: g, fits: usedA + usedB >= stream.length, capacityBits: usedA + usedB - HEADER_BITS - map.length * 8 };
}

export type EmbedStats = { layers: number; payloadBytes: number; bitsPerPixel: number; maxPixelChange: number };

/**
 * Hides `payload` inside the image. Throws when the image cannot carry it within `maxLayers`.
 */
export function embed(cover: Gray, payload: Uint8Array, maxLayers = 6): { image: Gray; stats: EmbedStats } {
  if (cover.width < 8 || cover.height < 8) throw new RdhError("Image is too small");
  let img = clone(cover);
  let offset = 0;
  let layers = 0;
  while (true) {
    if (layers >= maxLayers) throw new RdhError(`The record is too large for this image: about ${offset} of ${payload.length} bytes fit. Use a larger scan or a shorter record.`);
    const remaining = payload.length - offset;
    // Probe capacity, then size this layer's chunk to fit (capacity depends slightly on the bits).
    let take = remaining;
    let result = embedLayer(img, payload.subarray(offset, offset + take), layers === 0);
    for (let tries = 0; !result.fits && tries < 8; tries++) {
      const cap = Math.max(0, Math.floor(result.capacityBits / 8) - 16 - tries * 64);
      take = Math.min(take - 1, cap);
      if (take <= 0) break;
      result = embedLayer(img, payload.subarray(offset, offset + take), layers === 0);
    }
    if (!result.fits || take <= 0) throw new RdhError(`The record is too large for this image: about ${offset} of ${payload.length} bytes fit. Use a larger scan or a shorter record.`);
    // Only the innermost layer is flagged; later layers are marked as outer when written.
    img = result.image;
    offset += take;
    layers++;
    if (offset >= payload.length) break;
  }
  let maxChange = 0;
  for (let i = 0; i < cover.data.length; i++) maxChange = Math.max(maxChange, Math.abs(cover.data[i] - img.data[i]));
  return { image: img, stats: { layers, payloadBytes: payload.length, bitsPerPixel: +((payload.length * 8) / (cover.width * cover.height)).toFixed(4), maxPixelChange: maxChange } };
}

/** Recovers the payload and the exact original image. Throws if no payload is present or it is damaged. */
export function extract(stego: Gray, maxLayers = 16): { payload: Uint8Array; image: Gray; layers: number } {
  const g = clone(stego);
  const chunks: Uint8Array[] = [];
  for (let layer = 0; layer < maxLayers; layer++) {
    const bitsB: number[] = [];
    const bitsA: number[] = [];
    extractSet(g, 1, bitsB);
    extractSet(g, 0, bitsA);
    const bits = Uint8Array.from([...bitsA, ...bitsB]);
    if (bits.length < HEADER_BITS) throw new RdhError("No embedded record found");
    const h = new DataView(fromBits(bits, 0, 12).buffer);
    if (h.getUint16(0) !== MAGIC) throw new RdhError(layer === 0 ? "No embedded record found" : "Embedded data is damaged");
    const mapBytes = h.getUint32(4);
    const chunkBytes = h.getUint32(8);
    if ((mapBytes + chunkBytes) * 8 + HEADER_BITS > bits.length) throw new RdhError("Embedded data is damaged");
    const map = fromBits(bits, HEADER_BITS, mapBytes);
    chunks.unshift(fromBits(bits, HEADER_BITS + mapBytes * 8, chunkBytes));
    try {
      undoPreprocess(g, map);
    } catch {
      throw new RdhError("Embedded data is damaged");
    }
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
  const r = embedLayer(cover, new Uint8Array(0), true);
  return Math.max(0, Math.floor(r.capacityBits / 8));
}
