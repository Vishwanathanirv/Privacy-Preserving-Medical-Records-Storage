import { useEffect, useRef, useState } from "react";
import { auditLeaf, fromHex, pixelHash, recover, toDisplay, verifyInclusion, type Gray, type Recovery } from "@medvault/core";
import { api, fetchBytes, type AuditEntry, type RecordMeta } from "./lib";
import { fetchHead } from "./translog";

/** Draws a grayscale image (any bit depth) into a canvas, optionally tinting chosen pixels. */
export function paint(canvas: HTMLCanvasElement | null, g: Gray, opts: { window?: { center: number; width: number }; mark?: (i: number) => boolean; dim?: number } = {}) {
  if (!canvas) return;
  const d = g.data instanceof Uint16Array || g.maxValue ? toDisplay(g, opts.window) : g;
  canvas.width = g.width;
  canvas.height = g.height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(g.width, g.height);
  const dim = opts.dim ?? 1;
  for (let i = 0; i < d.data.length; i++) {
    const v = d.data[i] * dim;
    const k = i * 4;
    if (opts.mark?.(i)) {
      img.data[k] = 125;
      img.data[k + 1] = 240;
      img.data[k + 2] = 194;
    } else img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
    img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * A SHA-256 as an 8×8 mosaic: each hex digit picks a tile's shade. Two equal hashes look
 * identical; change one input bit and roughly every tile changes, which the eye sees at once.
 */
export function Mosaic({ hash, compare, label }: { hash: string; compare?: string; label: string }) {
  return (
    <div className="grid grid-cols-8 gap-[3px] rounded-[12px] bg-bg p-2" role="img" aria-label={label}>
      {hash
        .slice(0, 64)
        .split("")
        .map((c, i) => {
          const v = parseInt(c, 16);
          const off = compare && compare[i] !== c;
          return <span key={i} className="pop aspect-square rounded-[3px]" style={{ animationDelay: `${i * 6}ms`, background: off ? `rgba(255,111,97,${0.25 + v / 22})` : `rgba(125,240,194,${0.08 + v / 17})` }} />;
        })}
    </div>
  );
}

type Seal = { entry: AuditEntry; index: number; size: number; proof: string[] };
type Run = { file: number; rec: Recovery; sealed: string | null; inLog: boolean; seq: number | null; logSize: number; keyId: string; at: number };

/** In-browser proof that recovery is bit-exact, for one record. Nothing here trusts the server's word. */
export function BitExactProof({ meta, autorun = false }: { meta: RecordMeta; autorun?: boolean }) {
  const [run, setRun] = useState<Run | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flipped, setFlipped] = useState<string | null>(null);
  const storedCanvas = useRef<HTMLCanvasElement>(null);
  const restoredCanvas = useRef<HTMLCanvasElement>(null);
  const diffCanvas = useRef<HTMLCanvasElement>(null);

  async function prove() {
    setBusy(true);
    setError(null);
    setFlipped(null);
    setStep(0);
    try {
      const f = await fetchBytes(`/api/records/${meta.id}/file/stored`);
      await new Promise((r) => setTimeout(r, 30));
      const rec = recover(f.bytes);
      const head = await fetchHead();
      const seal = await api<Seal>(`/api/records/${meta.id}/seal?size=${head.info.head.size}`);
      const inLog = head.signatureOk && verifyInclusion(auditLeaf(seal.entry), seal.index, seal.size, seal.proof.map(fromHex), fromHex(head.info.head.root));
      const sealed = seal.entry.detail.match(/pixels:([0-9a-f]{64})/)?.[1] ?? null;
      setRun({ file: f.bytes.length, rec, sealed, inLog, seq: seal.entry.seq, logSize: head.info.head.size, keyId: head.info.keyId, at: Date.now() });
      // Reveal one step at a time, so the order of the checks can be followed.
      for (let s = 1; s <= 4; s++) {
        setStep(s);
        await new Promise((r) => setTimeout(r, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autorun) void prove();
  }, [autorun, meta.id]); // runs once per record when asked to; prove() itself is stable enough

  useEffect(() => {
    if (!run) return;
    const w = meta.scan?.window;
    paint(storedCanvas.current, run.rec.stored, { window: w });
    paint(restoredCanvas.current, run.rec.restored, { window: w });
    const a = run.rec.stored.data;
    const b = run.rec.restored.data;
    paint(diffCanvas.current, run.rec.restored, { window: w, dim: 0.28, mark: (i) => a[i] !== b[i] });
  }, [run, step, meta.scan?.window]);

  function flipOne() {
    if (!run) return;
    const g = { ...run.rec.restored, data: run.rec.restored.data.slice() };
    const i = Math.floor(g.data.length / 2 + g.width / 2);
    g.data[i] = g.data[i] ^ 1;
    setFlipped(pixelHash(g));
  }

  const px = meta.width * meta.height;
  const match = run && run.sealed === run.rec.fingerprint;
  const stepCls = (n: number) => `relative pb-7 pl-9 transition-opacity duration-300 last:pb-0 ${step >= n ? "opacity-100" : "opacity-25"}`;
  const dot = (n: number, ok = true) => <span className={`absolute left-0 top-0.5 grid h-6 w-6 place-items-center rounded-full font-mono text-[11px] font-bold ${step >= n ? (ok ? "bg-accent text-accent-ink" : "bg-coral text-coral-ink") : "bg-panel-3 text-faint"}`}>{step >= n ? (ok ? "✓" : "!") : n}</span>;

  return (
    <section aria-labelledby={`proof-${meta.id}`} className="rounded-[22px] border border-line bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow text-accent">Bit-exact proof</p>
          <h3 id={`proof-${meta.id}`} className="mt-1.5 text-[1.3rem] font-bold tracking-tight">
            Is the restored scan the original, to the last bit?
          </h3>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">Your browser downloads the stored file, pulls the hidden record out of its pixels, restores the scan and fingerprints it, then checks that fingerprint against the one sealed into the signed log when the record was made.</p>
        </div>
        <button className="btn btn-accent" disabled={busy} onClick={() => void prove()}>
          {busy ? "Proving…" : run ? "Run again" : "Prove it's bit-exact"}
        </button>
      </div>
      {error && <p className="mt-4 text-sm text-coral">{error}</p>}
      {run && (
        <ol className="mt-6 border-l border-line-2 pl-0 [&>li]:-ml-3">
          <li className={stepCls(1)}>
            {dot(1)}
            <div className="font-semibold">Downloaded the stored file</div>
            <div className="text-sm text-muted">
              {(run.file / 1024).toFixed(1)} KB, decoded to {meta.width}×{meta.height} pixels in {run.rec.ms.decode.toFixed(0)} ms. This is what anyone holding the file has.
            </div>
          </li>
          <li className={stepCls(2)}>
            {dot(2)}
            <div className="font-semibold">Pulled the hidden record out of the pixels</div>
            <div className="text-sm text-muted">
              {run.rec.payloadBytes} bytes of ciphertext in {run.rec.layers} layer{run.rec.layers > 1 ? "s" : ""}, extracted in {run.rec.ms.extract.toFixed(0)} ms. It stays encrypted: no key was used.
            </div>
            <div className="mt-3 grid max-w-2xl grid-cols-3 gap-2">
              {[
                [storedCanvas, "Stored", "with the record inside"],
                [restoredCanvas, "Restored", "computed in this browser"],
                [diffCanvas, `${run.rec.changedPixels.toLocaleString()} px`, `of ${px.toLocaleString()} moved by the hiding`],
              ].map(([ref, t, d]) => (
                <figure key={t as string}>
                  <div className="film overflow-hidden">
                    <canvas ref={ref as React.RefObject<HTMLCanvasElement>} className="aspect-square w-full object-contain [image-rendering:pixelated]" aria-label={`${t}: ${d}`} />
                  </div>
                  <figcaption className="mt-1.5 text-[12px] leading-tight">
                    <span className="font-semibold">{t as string}</span> <span className="text-faint">{d as string}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </li>
          <li className={stepCls(3)}>
            {dot(3)}
            <div className="font-semibold">Fingerprinted the restored pixels</div>
            <div className="text-sm text-muted">SHA-256 over every pixel value, in {run.rec.ms.hash.toFixed(0)} ms.</div>
          </li>
          <li className={stepCls(4)}>
            {dot(4, Boolean(match && run.inLog))}
            <div className="font-semibold">{match && run.inLog ? "Identical to the fingerprint sealed in the signed log" : match ? "Matches, but the log entry could not be proven" : "Does not match the sealed fingerprint"}</div>
            <div className="text-sm text-muted">
              Log entry #{run.seq}, {run.inLog ? `proven to be in the signed log of ${run.logSize} entries (key ${run.keyId})` : "not proven to be in the signed log"}. Same mosaic, same scan.
            </div>
            <div className="mt-3 grid max-w-[22rem] grid-cols-2 gap-3">
              <figure>
                <Mosaic hash={run.sealed ?? "0".repeat(64)} label="Fingerprint sealed in the log" />
                <figcaption className="mt-1.5 text-[12px] text-faint">Sealed when the record was made</figcaption>
              </figure>
              <figure>
                <Mosaic hash={flipped ?? run.rec.fingerprint} compare={run.sealed ?? undefined} label="Fingerprint of the restored pixels" />
                <figcaption className="mt-1.5 text-[12px] text-faint">{flipped ? "After flipping one bit of one pixel" : "Restored here, just now"}</figcaption>
              </figure>
            </div>
            <p className="mt-2 break-all font-mono text-[10.5px] leading-relaxed text-faint">{flipped ?? run.rec.fingerprint}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button className="btn h-9 px-3.5 text-[13px]" onClick={flipped ? () => setFlipped(null) : flipOne}>
                {flipped ? "Undo the flip" : "Flip one pixel and look again"}
              </button>
              {flipped && (
                <span className="text-sm text-coral" role="status">
                  {[...flipped].filter((c, i) => c !== run.sealed?.[i]).length} of 64 digits changed. One bit is enough to break the match.
                </span>
              )}
              {!flipped && match && run.inLog && (
                <span className="text-sm text-accent" role="status">
                  Bit-exact: all {px.toLocaleString()} pixels match the original.
                </span>
              )}
            </div>
          </li>
        </ol>
      )}
    </section>
  );
}
