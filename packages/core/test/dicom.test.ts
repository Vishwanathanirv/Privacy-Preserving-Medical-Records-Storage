import { describe, expect, it } from "vitest";
import { ctPhantom, deidentify, embed, extract, isDicom, parseDicom, readPixels, reidentify, writeDicom, writePixels, type Gray } from "../src/index";

const noisy16 = (w: number, h: number, seed: number, sd: number): Gray => {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const data = new Uint16Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data[y * w + x] = Math.max(0, Math.min(65535, Math.round(30000 + Math.sin(x / 20) * 1500 + Math.cos(y / 25) * 1500 + (rnd() + rnd() + rnd() - 1.5) * sd)));
  return { width: w, height: h, data, maxValue: 65535 };
};

describe("reversible hiding at high bit depth", () => {
  it("restores a noisy 16-bit image exactly, raising the threshold only as far as needed", () => {
    const img = noisy16(160, 160, 3, 40);
    const payload = new Uint8Array(900).map((_, i) => (i * 131) & 255);
    const { image, stats } = embed(img, payload);
    expect(stats.thresholds!.some((t) => t > 1)).toBe(true);
    const back = extract(image);
    expect(back.payload).toEqual(payload);
    expect(back.image.data).toEqual(img.data);
  });

  it("keeps 8-bit images at threshold 1 (changes of at most two grey levels)", () => {
    const data = new Uint8Array(128 * 128).map((_, i) => 100 + ((i * 7) % 40));
    const { stats } = embed({ width: 128, height: 128, data }, new Uint8Array(200).fill(7));
    expect(stats.thresholds!.every((t) => t === 1)).toBe(true);
    expect(stats.maxPixelChange).toBeLessThanOrEqual(2);
  });

  it("handles pixels at both ends of a 12-bit range", () => {
    const ct = ctPhantom(128, 2);
    ct.fill(0, 0, 128 * 20);
    ct.fill(4095, 128 * 100, 128 * 110);
    const img: Gray = { width: 128, height: 128, data: ct, maxValue: 4095 };
    const r = embed(img, new Uint8Array(300).fill(170));
    for (const v of r.image.data) expect(v).toBeLessThanOrEqual(4095);
    expect(extract(r.image).image.data).toEqual(ct);
  });
});

describe("DICOM", () => {
  const file = writeDicom({ pixels: ctPhantom(96, 4), width: 96, height: 96, patientName: "Rao^Arjun", patientId: "AR-9", birthDate: "19700101" });

  it("parses what it writes", () => {
    expect(isDicom(file)).toBe(true);
    const info = parseDicom(file);
    expect(info).toMatchObject({ rows: 96, columns: 96, bitsAllocated: 16, bitsStored: 12, signed: false, modality: "CT", transferSyntax: "1.2.840.10008.1.2.1" });
    expect(info.rescale).toEqual({ slope: 1, intercept: -1024 });
    expect(readPixels(file, info).maxValue).toBe(4095);
  });

  it("de-identifies in place and re-identifies to the identical file", () => {
    const info = parseDicom(file);
    const { file: anon, removed } = deidentify(file, info);
    expect(anon.length).toBe(file.length);
    expect(new TextDecoder("latin1").decode(anon)).not.toContain("Rao^Arjun");
    expect(removed.map((r) => r.tag)).toEqual(expect.arrayContaining(["00100010", "00100020", "00100030"]));
    expect(reidentify(anon, removed)).toEqual(file);
  });

  it("round-trips signed pixels and leaves bits above Bits Stored alone", () => {
    const px = new Uint16Array(64 * 64).map((_, i) => ((i % 300) - 150) & 0xffff);
    const signed = writeDicom({ pixels: px, width: 64, height: 64, bitsStored: 16, signed: true });
    const info = parseDicom(signed);
    const g = readPixels(signed, info);
    expect(g.data[0]).toBe(-150 + 32768);
    expect(writePixels(signed, info, g)).toEqual(signed);
  });

  it("rejects truncated and non-DICOM input", () => {
    expect(() => parseDicom(file.slice(0, 300))).toThrow(/truncated|pixel data/i);
    expect(() => parseDicom(new Uint8Array(400))).toThrow(/DICM/);
  });
});
