/**
 * Seals a record into the landing page's X-ray off the main thread, so the first screen never
 * stutters. Returns two RGBA bitmaps: the stored X-ray, and a map of the pixels that moved.
 */
import { decodePng, embed, encryptRecord } from "@medvault/core";

type Out = { width: number; height: number; base: Uint8ClampedArray; mark: Uint8ClampedArray; changed: number; bytes: number; total: number };
const ctx = self as unknown as { onmessage: ((e: MessageEvent<string>) => void) | null; postMessage: (m: Out, t: Transferable[]) => void };

ctx.onmessage = async (e) => {
  const g = decodePng(new Uint8Array(await (await fetch(e.data)).arrayBuffer())).image;
  const sealed = encryptRecord(crypto.getRandomValues(new Uint8Array(32)), crypto.randomUUID(), crypto.randomUUID(), {
    title: "Chest X-ray: persistent cough",
    diagnosis: "Bilateral patchy opacities; viral pneumonia most likely.",
    medications: ["Paracetamol 500 mg as needed"],
  });
  const { image } = embed(g, sealed.ciphertext);
  const n = g.width * g.height;
  const base = new Uint8ClampedArray(n * 4);
  const mark = new Uint8ClampedArray(n * 4);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const v = image.data[i];
    const k = i * 4;
    base[k] = base[k + 1] = base[k + 2] = v;
    base[k + 3] = 255;
    if (v !== g.data[i]) {
      changed++;
      mark[k] = 125;
      mark[k + 1] = 240;
      mark[k + 2] = 194;
    } else mark[k] = mark[k + 1] = mark[k + 2] = v * 0.22;
    mark[k + 3] = 255;
  }
  ctx.postMessage({ width: g.width, height: g.height, base, mark, changed, bytes: sealed.ciphertext.length, total: n }, [base.buffer, mark.buffer]);
};
