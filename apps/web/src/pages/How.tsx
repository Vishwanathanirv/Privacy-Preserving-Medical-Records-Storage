import { useEffect, useMemo, useRef, useState } from "react";
import { randomBytes } from "@noble/hashes/utils.js";
import { CryptoError, decodePng, decryptRecord, deriveLoanKey, embed, encryptRecord, extract, pixelHash, psnr, rewrapKey, toHex, type Gray } from "@medvault/core";
import xrayUrl from "../../../../samples/chest-xray-pa-2.png?url";
import { Mosaic, paint } from "../proof";

/**
 * "How it works": one real record followed from key to recovery. Everything on this page is
 * computed here, in the browser, with the same code the vault runs: a real (openly licensed)
 * chest X-ray, a fictional note, real AES-256-GCM, real reversible hiding, a real HKDF loan key.
 */

const RECORD = {
  title: "Chest X-ray: fever and breathlessness",
  diagnosis: "Patchy bilateral peripheral opacities, consistent with viral pneumonia.",
  notes: "Five days of fever and dry cough. Supportive care; repeat film in 6 weeks.",
  medications: ["Paracetamol 500 mg up to four times a day"],
  author: "Dr. Meera Iyer",
};

type Pipeline = {
  kek: Uint8Array;
  recordId: string;
  patientId: string;
  doctorId: string;
  ciphertext: Uint8Array;
  wrappedKey: Uint8Array;
  plainBytes: number;
  cover: Gray;
  stego: Gray;
  changed: number;
  maxChange: number;
  psnr: number;
  embedMs: number;
  pixel: { x: number; y: number; n: number; s: number; w: number; e: number; value: number; bit: number } | null;
};

async function build(): Promise<Pipeline> {
  const png = new Uint8Array(await (await fetch(xrayUrl)).arrayBuffer());
  const cover = decodePng(png).image;
  const kek = randomBytes(32);
  const recordId = crypto.randomUUID();
  const patientId = crypto.randomUUID();
  const sealed = encryptRecord(kek, recordId, patientId, RECORD);
  await new Promise((r) => setTimeout(r, 0));
  const t0 = performance.now();
  const { image: stego, stats } = embed(cover, sealed.ciphertext);
  const embedMs = performance.now() - t0;
  let changed = 0;
  for (let i = 0; i < cover.data.length; i++) if (cover.data[i] !== stego.data[i]) changed++;
  // One pixel near the middle whose prediction error is 0 or -1: the kind that carries a bit.
  const w = cover.width;
  const d = cover.data;
  let pixel: Pipeline["pixel"] = null;
  for (let y = Math.floor(cover.height * 0.45); y < cover.height - 1 && !pixel; y++)
    for (let x = Math.floor(w * 0.3); x < w - 1; x++) {
      const i = y * w + x;
      const p = (d[i - w] + d[i + w] + d[i - 1] + d[i + 1]) >> 2;
      if (d[i] - p === 0 && stego.data[i] !== d[i]) {
        pixel = { x, y, n: d[i - w], s: d[i + w], w: d[i - 1], e: d[i + 1], value: d[i], bit: stego.data[i] - d[i] };
        break;
      }
    }
  return { kek, recordId, patientId, doctorId: crypto.randomUUID(), ciphertext: sealed.ciphertext, wrappedKey: sealed.wrappedKey, plainBytes: new TextEncoder().encode(JSON.stringify(RECORD)).length, cover, stego, changed, maxChange: stats.maxPixelChange, psnr: psnr(cover, stego), embedMs, pixel };
}

const STEPS = [
  { k: "keys", t: "Keys", h: "A fresh key for this one record" },
  { k: "encrypt", t: "Encrypt", h: "The record becomes noise" },
  { k: "hide", t: "Hide", h: "The noise goes into the scan" },
  { k: "lend", t: "Lend", h: "A key that dies on time" },
  { k: "recover", t: "Recover", h: "Take it out, get the original back" },
] as const;

const hexGroups = (b: Uint8Array, n = 32) =>
  toHex(b.subarray(0, n))
    .match(/.{1,8}/g)!
    .join(" ");

export function How() {
  const [p, setP] = useState<Pipeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    build().then(setP, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  return (
    <div className="pt-3">
      <p className="eyebrow text-accent">How it works</p>
      <h1 className="display mt-2 max-w-4xl pr-12 text-[clamp(2.2rem,5.4vw,4rem)]">One record, from key to recovery.</h1>
      <div className="mt-5 max-w-3xl rounded-[20px] border border-accent/25 bg-accent-soft p-4 text-[0.98rem] leading-relaxed">
        <b>The key idea, simply:</b> hide the record inside its own scan, reversibly. The scan then carries its record wherever it goes, only the right key can read it, and taking the record out gives back the original scan to the last bit.
      </div>
      <p className="mt-3 max-w-3xl text-sm text-muted">Everything below runs in your browser right now, on a real chest X-ray (CC BY 3.0, see samples/README.md) and a fictional note, with the same code the vault uses.</p>

      <nav aria-label="Steps" className="mt-8">
        <ol className="grid grid-cols-5 gap-1.5">
          {STEPS.map((s, i) => (
            <li key={s.k}>
              <button onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined} className="group w-full text-left">
                <span className={`block h-1 rounded-full transition-colors duration-500 ${i <= step ? "bg-accent" : "bg-line-2"}`} />
                <span className={`mt-2 block font-mono text-[10.5px] uppercase tracking-[0.12em] ${i === step ? "text-accent" : "text-faint group-hover:text-muted"}`}>
                  {i + 1} · {s.t}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-6 min-h-[30rem]" aria-live="polite">
        {error && <p className="text-coral">{error}</p>}
        {!p && !error && (
          <div className="grid gap-5 lg:grid-cols-2" aria-busy="true" aria-label="Preparing the sample record">
            <div className="skeleton aspect-[4/3]" />
            <div className="space-y-3">
              <div className="skeleton h-9 w-2/3" />
              <div className="skeleton h-28" />
              <div className="skeleton h-20" />
            </div>
          </div>
        )}
        {p && (
          <div key={step} className="rise">
            <h2 className="text-[1.6rem] font-bold tracking-tight">{STEPS[step].h}</h2>
            <div className="mt-5">
              {step === 0 && <Keys p={p} />}
              {step === 1 && <Encrypt p={p} />}
              {step === 2 && <Hide p={p} />}
              {step === 3 && <Lend p={p} />}
              {step === 4 && <Recover p={p} />}
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5">
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
          ← Back
        </button>
        <span className="hidden text-xs text-faint sm:block">
          <span className="kbd">←</span> <span className="kbd">→</span> to move
        </span>
        {step < STEPS.length - 1 ? (
          <button className="btn btn-accent" onClick={() => setStep(step + 1)}>
            Next: {STEPS[step + 1].t} →
          </button>
        ) : (
          <a className="btn btn-accent" href="/">
            Try it for real
          </a>
        )}
      </div>
    </div>
  );
}

function Split({ visual, children }: { visual: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="min-w-0">{visual}</div>
      <div className="min-w-0 space-y-4 text-[0.97rem] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

function KeyChip({ label, sub, bytes, tone = "accent" }: { label: string; sub: string; bytes: Uint8Array; tone?: "accent" | "amber" | "coral" }) {
  const c = { accent: "text-accent border-accent/30", amber: "text-amber border-amber/30", coral: "text-coral border-coral/30" }[tone];
  return (
    <div className={`rounded-[18px] border bg-panel p-4 ${c}`}>
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
          <circle cx="8" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 12h9m-3 0v3m-3-3v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="font-semibold text-ink">{label}</span>
      </div>
      <div className="mt-1 text-[13px] text-faint">{sub}</div>
      <div className="mt-2.5 break-all font-mono text-[11.5px] leading-relaxed">{hexGroups(bytes)}…</div>
    </div>
  );
}

function Keys({ p }: { p: Pipeline }) {
  return (
    <Split
      visual={
        <div className="space-y-3">
          <KeyChip label="Master key" sub="Held by the vault, never stored next to a record. Here: 32 random bytes, made in this tab." bytes={p.kek} />
          <div className="pl-6 font-mono text-[11px] text-faint">│ wraps (AES-256-GCM, bound to the record id)</div>
          <KeyChip label="Record key, wrapped" sub={`A fresh 256-bit key made for this record only. Stored only like this: ${p.wrappedKey.length} sealed bytes.`} bytes={p.wrappedKey} />
          <div className="pl-6 font-mono text-[11px] text-faint">│ later: HKDF derives a key per loan · scrypt derives the emergency card's</div>
        </div>
      }
    >
      <p>
        Every record gets its <b className="text-ink">own</b> random key. That key is then locked with the vault's master key and kept as a sealed blob, so the master key can be changed without touching a single scan, and one leaked record key opens one record.
      </p>
      <p>Nothing is ever reused: each loan derives its own key from the master key and the loan's terms, and the emergency card's keys are stretched out of a code only the patient holds.</p>
    </Split>
  );
}

function Encrypt({ p }: { p: Pipeline }) {
  const [tampered, setTampered] = useState<string | null>(null);
  function tamper() {
    const c = p.ciphertext.slice();
    c[40] ^= 1;
    try {
      decryptRecord(p.kek, p.recordId, p.patientId, { ciphertext: c, wrappedKey: p.wrappedKey });
      setTampered("Opened (this should never happen)");
    } catch (e) {
      setTampered(e instanceof CryptoError ? e.message : "Rejected");
    }
  }
  return (
    <Split
      visual={
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <pre className="overflow-hidden whitespace-pre-wrap rounded-[16px] border border-line bg-panel p-3.5 font-mono text-[11px] leading-relaxed text-ink">{JSON.stringify({ title: RECORD.title, diagnosis: RECORD.diagnosis, medications: RECORD.medications }, null, 1)}</pre>
          <span className="text-center font-mono text-xs text-accent">deflate → AES-GCM →</span>
          <div className="grid grid-cols-12 gap-[2px] rounded-[16px] border border-line bg-panel p-3" role="img" aria-label="The ciphertext bytes, as noise">
            {Array.from(p.ciphertext.subarray(0, 144)).map((b, i) => (
              <span key={i} className="pop aspect-square rounded-[2px]" style={{ background: `rgba(125,240,194,${0.06 + b / 300})`, animationDelay: `${i * 4}ms` }} />
            ))}
          </div>
        </div>
      }
    >
      <p>
        The note ({p.plainBytes} bytes) is compressed and sealed with <b className="text-ink">AES-256-GCM</b> under the record key: {p.ciphertext.length} bytes that look like noise, including a 12-byte nonce used once and a 16-byte tag that proves nothing was changed.
      </p>
      <p>The ciphertext is also bound to this record and this patient, so it cannot be pasted into someone else's scan.</p>
      <div>
        <button className="btn" onClick={tamper}>
          Change one bit of the ciphertext
        </button>
        {tampered && (
          <p className="pop mt-2 text-sm text-coral" role="status">
            {tampered}
          </p>
        )}
      </div>
    </Split>
  );
}

function Hide({ p }: { p: Pipeline }) {
  const [view, setView] = useState<"stored" | "original" | "changed">("stored");
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (view === "changed") paint(canvas.current, p.cover, { dim: 0.25, mark: (i) => p.cover.data[i] !== p.stego.data[i] });
    else paint(canvas.current, view === "stored" ? p.stego : p.cover);
  }, [view, p]);
  const px = p.pixel;
  return (
    <Split
      visual={
        <div>
          <div className="mb-2 flex gap-1 rounded-full border border-line bg-panel p-1" role="tablist" aria-label="Image view">
            {(["stored", "original", "changed"] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-semibold capitalize transition-colors ${view === v ? "bg-panel-3 text-ink" : "text-faint hover:text-ink"}`}>
                {v === "changed" ? "Changed pixels" : v}
              </button>
            ))}
          </div>
          <div className="film overflow-hidden">
            <canvas ref={canvas} className="aspect-square w-full" aria-label={`Chest X-ray, ${view}`} />
          </div>
        </div>
      }
    >
      <p>
        The ciphertext is written into the X-ray with <b className="text-ink">reversible data hiding</b>. Each pixel is guessed from its four neighbours. Where the guess is right (or just one too high), that tiny error is doubled and one bit of the record is added to it. Every other pixel is nudged by one so nothing collides, and extraction can undo all of it.
      </p>
      {px && (
        <div className="rounded-[16px] border border-line bg-panel p-4 font-mono text-[12px] text-ink">
          <div className="text-faint">pixel ({px.x}, {px.y}) of the real X-ray</div>
          <div className="mt-2 grid w-fit grid-cols-3 gap-1 text-center">
            <span />
            <span className="rounded bg-panel-3 px-2 py-1">{px.n}</span>
            <span />
            <span className="rounded bg-panel-3 px-2 py-1">{px.w}</span>
            <span className="rounded bg-accent px-2 py-1 text-accent-ink">{px.value}</span>
            <span className="rounded bg-panel-3 px-2 py-1">{px.e}</span>
            <span />
            <span className="rounded bg-panel-3 px-2 py-1">{px.s}</span>
            <span />
          </div>
          <div className="mt-2 leading-relaxed">
            guess ⌊({px.n}+{px.s}+{px.w}+{px.e})/4⌋ = {px.value} · error 0 · carries bit {px.bit} → {px.value + px.bit}
          </div>
        </div>
      )}
      <p className="text-sm">
        Here: {p.ciphertext.length} bytes hidden by changing {p.changed.toLocaleString()} of {(p.cover.width * p.cover.height).toLocaleString()} pixels by at most ±{p.maxChange} grey level, PSNR {p.psnr.toFixed(1)} dB (above 40 dB is invisible), in {p.embedMs.toFixed(0)} ms.
      </p>
    </Split>
  );
}

const LOAN = [
  { m: 15, t: "15 min" },
  { m: 60, t: "1 hour" },
  { m: 1440, t: "1 day" },
];

function Lend({ p }: { p: Pipeline }) {
  const [minutes, setMinutes] = useState(60);
  const [forged, setForged] = useState<string | null>(null);
  const [start] = useState(() => Date.now());
  const terms = useMemo(() => ({ id: "loan-demo", recordId: p.recordId, patientId: p.patientId, doctorId: p.doctorId, expiresAt: start + minutes * 60_000 }), [p, minutes, start]);
  const loanKey = useMemo(() => deriveLoanKey(p.kek, terms), [p, terms]);
  const wrapped = useMemo(() => rewrapKey(p.kek, loanKey, p.recordId, p.wrappedKey), [p, loanKey]);

  function forge() {
    const k = deriveLoanKey(p.kek, { ...terms, expiresAt: terms.expiresAt + 1 });
    try {
      decryptRecord(k, p.recordId, p.patientId, { ciphertext: p.ciphertext, wrappedKey: wrapped });
      setForged("Opened (this should never happen)");
    } catch {
      setForged(`Won't open. The key for an expiry 1 ms later is ${toHex(k).slice(0, 16)}…, a completely different key.`);
    }
  }

  return (
    <Split
      visual={
        <div className="space-y-3">
          <div className="flex gap-2" role="radiogroup" aria-label="Loan length">
            {LOAN.map((d) => (
              <button key={d.m} role="radio" aria-checked={minutes === d.m} onClick={() => (setMinutes(d.m), setForged(null))} className={`h-9 rounded-full border px-4 text-sm font-semibold ${minutes === d.m ? "border-amber bg-amber text-amber-ink" : "border-line-2 text-muted"}`}>
                {d.t}
              </button>
            ))}
          </div>
          <div className="rounded-[18px] border border-amber/30 bg-panel p-4 font-mono text-[11.5px] leading-relaxed">
            <div className="text-faint">HKDF-SHA256(master key, salt = loan id,</div>
            <div className="text-faint pl-4">info = record | patient | doctor | expires {new Date(terms.expiresAt).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })})</div>
            <div className="mt-2 break-all text-amber">= {hexGroups(loanKey)}</div>
          </div>
          <KeyChip label="Record key, wrapped for the loan" sub="What the doctor's access opens. Destroyed when the time is up." bytes={wrapped} tone="amber" />
        </div>
      }
    >
      <p>
        The patient lends this one record to a doctor. MedVault <b className="text-ink">derives a key for the loan</b> from the master key and the loan's exact terms (who, what, until when) and wraps the record key under it. The doctor reads through that copy only.
      </p>
      <p>When the time runs out, or the patient takes it back, the wrapped copy is destroyed and the record is gone from the doctor's view. Every look in between lands in the patient's signed access trail.</p>
      <div>
        <button className="btn" onClick={forge}>
          Push the expiry back by 1 ms
        </button>
        {forged && (
          <p className="pop mt-2 text-sm text-coral" role="status">
            {forged}
          </p>
        )}
      </div>
    </Split>
  );
}

function Recover({ p }: { p: Pipeline }) {
  const [r, setR] = useState<{ diff: number; a: string; b: string; record: typeof RECORD; ms: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t0 = performance.now();
    const out = extract(p.stego);
    const ms = performance.now() - t0;
    let diff = 0;
    for (let i = 0; i < p.cover.data.length; i++) if (out.image.data[i] !== p.cover.data[i]) diff++;
    const record = decryptRecord<typeof RECORD>(p.kek, p.recordId, p.patientId, { ciphertext: out.payload, wrappedKey: p.wrappedKey });
    setR({ diff, a: pixelHash(p.cover), b: pixelHash(out.image), record, ms });
    // The difference between the original and the restored image, drawn: all black when nothing differs.
    paint(canvas.current, { ...out.image, data: out.image.data.map((v, i) => (v === p.cover.data[i] ? 0 : 255)) as Uint8Array });
  }, [p]);
  return (
    <Split
      visual={
        <div>
          <div className="film overflow-hidden">
            <canvas ref={canvas} className="aspect-square w-full" aria-label="Original minus restored: an all-black image" />
            <div className="overlay left-4 top-3">ORIGINAL − RESTORED</div>
            {r && <div className="overlay bottom-3 left-4 text-accent">{r.diff === 0 ? "ALL BLACK: 0 PIXELS DIFFER" : `${r.diff} PIXELS DIFFER`}</div>}
          </div>
          {r && (
            <div className="mt-3 grid max-w-[22rem] grid-cols-2 gap-3">
              <figure>
                <Mosaic hash={r.a} label="Fingerprint of the original X-ray" />
                <figcaption className="mt-1.5 text-[12px] text-faint">Original</figcaption>
              </figure>
              <figure>
                <Mosaic hash={r.b} compare={r.a} label="Fingerprint of the restored X-ray" />
                <figcaption className="mt-1.5 text-[12px] text-faint">Restored</figcaption>
              </figure>
            </div>
          )}
        </div>
      }
    >
      {r && (
        <>
          <p>
            Extraction reads the bits back out and undoes every change, in {r.ms.toFixed(0)} ms. Subtract the restored X-ray from the original and you get a black image: <b className="text-accent">{r.diff === 0 ? `0 of ${(p.cover.width * p.cover.height).toLocaleString()} pixels differ` : `${r.diff} pixels differ`}</b>, and the two SHA-256 fingerprints are identical.
          </p>
          <p>Then the record key opens the ciphertext, and the tag confirms nothing was changed:</p>
          <div className="rounded-[16px] border border-line bg-panel p-4 text-ink">
            <div className="font-semibold">{r.record.title}</div>
            <div className="mt-1 text-sm text-muted">{r.record.diagnosis}</div>
            <div className="mt-1 text-xs text-faint">{r.record.author}</div>
          </div>
          <p className="text-sm">In the app, a doctor's or patient's browser runs this same check on a stored record and matches the fingerprint against the one sealed in the signed log: the “Prove it's bit-exact” button.</p>
        </>
      )}
    </Split>
  );
}
