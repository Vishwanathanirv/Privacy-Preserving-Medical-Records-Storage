import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RdhError, embed, estimateCapacity, extract, type Gray } from "../src/rdh";
import { decodePng, encodePng, phantom, pixelHash, psnr, ssim } from "../src/imaging";

const img = phantom(256, 5);
const bytes = (n: number) => new Uint8Array(randomBytes(n));

function noise(w: number, h: number, seed: number): Gray {
  let s = seed;
  const data = new Uint8Array(w * h).map(() => ((s = (s * 1103515245 + 12345) >>> 0) >>> 24) & 0xff);
  return { width: w, height: h, data };
}

describe("reversible data hiding", () => {
  it.each([1, 100, 1500, 4000])("round-trips a %i-byte payload and restores the original bit for bit", (n) => {
    const payload = bytes(n);
    const { image, stats } = embed(img, payload);
    const out = extract(image);
    expect(Buffer.from(out.payload).equals(Buffer.from(payload))).toBe(true);
    expect(pixelHash(out.image)).toBe(pixelHash(img));
    expect(stats.maxPixelChange).toBeLessThanOrEqual(2);
  });

  it("keeps the stego image visually identical for a typical record", () => {
    const { image } = embed(img, bytes(1500));
    expect(psnr(img, image)).toBeGreaterThan(45);
    expect(ssim(img, image)).toBeGreaterThan(0.97);
  });

  it("stacks layers for payloads larger than one layer", () => {
    const cap = estimateCapacity(img);
    const payload = bytes(Math.round(cap * 1.4));
    const { image, stats } = embed(img, payload);
    expect(stats.layers).toBeGreaterThan(1);
    const out = extract(image);
    expect(out.layers).toBe(stats.layers);
    expect(Buffer.from(out.payload).equals(Buffer.from(payload))).toBe(true);
    expect(pixelHash(out.image)).toBe(pixelHash(img));
  });

  it("handles saturated pixels (0 and 255) without overflow", () => {
    // A scan with black air, a fully white implant and soft tissue around it.
    const g = phantom(128, 2);
    for (let y = 50; y < 70; y++) for (let x = 50; x < 80; x++) g.data[y * 128 + x] = 255;
    const payload = bytes(300);
    const { image } = embed(g, payload);
    const out = extract(image);
    expect(pixelHash(out.image)).toBe(pixelHash(g));
    expect(Buffer.from(out.payload).equals(Buffer.from(payload))).toBe(true);
  });

  it("refuses cleanly when an image has no capacity (pure noise)", () => {
    expect(() => embed(noise(128, 128, 9), bytes(200))).toThrow(RdhError);
  });

  it("reports images without a payload and refuses oversize payloads", () => {
    expect(() => extract(img)).toThrow(RdhError);
    expect(() => embed(phantom(64), bytes(50_000))).toThrow(/too large/);
  });

  it("survives a lossless PNG round trip", () => {
    const payload = bytes(800);
    const stego = embed(img, payload).image;
    const { image: back, wasGray } = decodePng(encodePng(stego));
    expect(wasGray).toBe(true);
    expect(Buffer.from(extract(back).payload).equals(Buffer.from(payload))).toBe(true);
  });
});
