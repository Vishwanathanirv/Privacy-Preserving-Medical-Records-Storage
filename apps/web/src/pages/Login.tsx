import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import xrayUrl from "../../../../samples/chest-xray-pa-2.png?url";
import { DEMO, useAuth } from "../lib";
import { Avatar, Mark } from "../ui";

const PEOPLE = [
  { email: "anitha@medvault.dev", name: "Anitha Kumar", role: "Patient", hint: "Holds the wallet. Lends cards, carries an emergency card." },
  { email: "meera@medvault.dev", name: "Dr. Meera Iyer", role: "Doctor", hint: "On two patients' care teams." },
  { email: "arjun@medvault.dev", name: "Dr. Arjun Rao", role: "Doctor", hint: "Has one of Anitha's cards on loan." },
  { email: "admin@medvault.dev", name: "Asha Admin", role: "Admin", hint: "Runs the vault. Cannot read a single record." },
];
const PASSWORD = "medvault-demo";

const TRY = [
  { k: "lend", t: "Lend a record", d: "Give a doctor one card for 15 minutes. Watch it come back by itself.", who: "anitha@medvault.dev", to: "/lend/first", tone: "amber" },
  { k: "proof", t: "Prove it's bit-exact", d: "Your browser restores a real X-ray and matches it to the signed log.", who: "anitha@medvault.dev", to: "/proof", tone: "accent" },
  { k: "sos", t: "Break the glass", d: "Be the paramedic: open Anitha's emergency card with no account.", who: null, to: "sos", tone: "coral" },
] as const;

const TONE = { amber: "hover:border-amber/50 [--t:var(--amber)]", accent: "hover:border-accent/50 [--t:var(--accent)]", coral: "hover:border-coral/50 [--t:var(--coral)]" };

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [own, setOwn] = useState(false);

  async function go(e: string, p: string, to = "/") {
    setBusy(true);
    setError(null);
    try {
      await login(e, p);
      nav(to, { viewTransition: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function tryIt(t: (typeof TRY)[number]) {
    if (t.k === "sos") {
      const link = DEMO ? await import("../demo/server").then(({ demo }) => demo.sosLink()) : null;
      nav(link ?? "/sos");
    } else await go(t.who, PASSWORD, t.to);
  }

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[88rem] items-center gap-2.5 px-4 pt-5 sm:px-6">
        <Mark size={32} />
        <span className="text-[1.15rem] font-bold tracking-tight [font-variation-settings:'wdth'_90]">MedVault</span>
        <span className="ml-auto text-xs text-faint">
          <span className="kbd">⌘K</span> commands
        </span>
      </header>

      {/* On phones: headline, then the X-ray, then the rest. On wide screens: text left, X-ray and sign-in right. */}
      <main className="mx-auto grid max-w-[88rem] gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] lg:gap-x-14 lg:gap-y-8 lg:pt-14">
        <section aria-labelledby="pitch" className="lg:col-start-1 lg:row-start-1">
          <p className="eyebrow text-accent">A health wallet you hold and lend</p>
          <h1 id="pitch" className="display mt-4 text-[clamp(2.9rem,7.4vw,5.6rem)]">
            Your scan is
            <br />
            the envelope.
          </h1>
          <p className="mt-6 max-w-xl text-[1.08rem] leading-relaxed text-muted">MedVault encrypts each medical record and hides it inside its own scan, reversibly. The patient holds the keys and lends them out, a card at a time.</p>
        </section>
        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Lens />
        </div>
        <section aria-label="Start with" className="lg:col-start-1 lg:row-span-2 lg:row-start-2">
          <h2 className="eyebrow">Start with</h2>
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {TRY.map((t) => (
              <li key={t.k}>
                <button disabled={busy} onClick={() => void tryIt(t)} className={`group flex h-full w-full flex-col rounded-[18px] border border-line bg-panel p-4 text-left transition-[transform,border-color] duration-500 [transition-timing-function:var(--spring)] hover:-translate-y-1 ${TONE[t.tone]}`}>
                  <span className="flex items-center gap-2 font-semibold">
                    <span className="h-2 w-2 rounded-full bg-[var(--t)]" aria-hidden />
                    {t.t}
                    <span className="ml-auto text-faint transition-transform duration-500 [transition-timing-function:var(--spring)] group-hover:translate-x-1" aria-hidden>
                      →
                    </span>
                  </span>
                  <span className="mt-1.5 text-[13px] leading-snug text-muted">{t.d}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <div className="lg:col-start-2 lg:row-start-3">
          <section className="rounded-[24px] border border-line bg-panel p-5 sm:p-6" aria-labelledby="h-signin">
            <h2 id="h-signin" className="text-[1.3rem] font-bold tracking-tight">
              Open a wallet as
            </h2>
            <p className="mt-1 text-sm text-muted">One click, no password. Everyone here is fictional; the scans are real.</p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {PEOPLE.map((d) => (
                <li key={d.email}>
                  <button disabled={busy} onClick={() => void go(d.email, PASSWORD)} className="flex h-full w-full items-start gap-3 rounded-[16px] border border-line-2 bg-bg-2 p-3 text-left transition-[transform,border-color] duration-500 [transition-timing-function:var(--spring)] hover:-translate-y-0.5 hover:border-accent/40 disabled:opacity-50">
                    <Avatar name={d.name} size={40} />
                    <span className="min-w-0">
                      <span className="block font-semibold leading-tight">{d.name}</span>
                      <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[0.1em] text-accent">{d.role}</span>
                      <span className="mt-1 block text-[12.5px] leading-snug text-muted">{d.hint}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!own ? (
              <button className="mt-4 text-sm text-faint underline-offset-4 hover:text-ink hover:underline" onClick={() => setOwn(true)}>
                Use an email and password instead
              </button>
            ) : (
              <form
                className="fade mt-4 grid gap-2.5 sm:grid-cols-[1fr_1fr_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  void go(email, password);
                }}
              >
                <input className="field" type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Email" />
                <input className="field" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-label="Password" />
                <button className="btn btn-accent h-[2.8rem]" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </button>
                <p className="text-xs text-faint sm:col-span-3">
                  Demo password: <code className="font-mono">{PASSWORD}</code>
                </p>
              </form>
            )}
            {error && <p className="mt-3 text-sm text-coral">{error}</p>}
          </section>
        </div>
      </main>
      <footer className="mx-auto max-w-[88rem] px-4 pb-8 text-xs text-faint sm:px-6">
        Fictional people, real openly licensed scans (chest X-rays CC BY 3.0, brain MRI CC0). Not for real patient data without a security review.
        {DEMO && " This demo runs entirely in your browser; nothing you do here leaves this device."}
      </footer>
    </div>
  );
}

/**
 * The idea, visible before reading a word: a real chest X-ray with an encrypted record hidden in
 * it. A lens shows which pixels carry the record. Computed here, after the page has painted.
 */
function Lens() {
  const baseCanvas = useRef<HTMLCanvasElement>(null);
  const lensCanvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<{ mark: HTMLCanvasElement; w: number; h: number; changed: number; bytes: number; total: number } | null>(null);
  const pos = useRef({ x: 0.62, y: 0.44, user: false });

  useEffect(() => {
    // The sealing runs in a worker; the page stays responsive while it does.
    const worker = new Worker(new URL("../lens.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ width: number; height: number; base: Uint8ClampedArray<ArrayBuffer>; mark: Uint8ClampedArray<ArrayBuffer>; changed: number; bytes: number; total: number }>) => {
      const { width: w, height: h, base, mark, changed, bytes, total } = e.data;
      const b = baseCanvas.current;
      if (!b) return;
      b.width = w;
      b.height = h;
      b.getContext("2d")!.putImageData(new ImageData(base, w, h), 0, 0);
      const m = document.createElement("canvas");
      m.width = w;
      m.height = h;
      m.getContext("2d")!.putImageData(new ImageData(mark, w, h), 0, 0);
      setState({ mark: m, w, h, changed, bytes, total });
      worker.terminate();
    };
    worker.postMessage(new URL(xrayUrl, location.href).href);
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    const c = lensCanvas.current;
    if (!state || !c) return;
    const ctx = c.getContext("2d")!;
    c.width = state.w;
    c.height = state.h;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const draw = (t: number) => {
      if (!pos.current.user && !reduce) {
        pos.current.x = 0.55 + Math.sin(t / 2600) * 0.17;
        pos.current.y = 0.5 + Math.cos(t / 3400) * 0.16;
      }
      const W = c.width;
      const x = pos.current.x * W;
      const y = pos.current.y * c.height;
      const r = W * 0.17;
      const zoom = 2.4;
      // Only the lens is redrawn each frame; the X-ray underneath is a separate, static canvas.
      ctx.clearRect(0, 0, W, c.height);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(state.mark, x - r / zoom, y - r / zoom, (2 * r) / zoom, (2 * r) / zoom, x - r, y - r, 2 * r, 2 * r);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.lineWidth = W / 220;
      ctx.strokeStyle = "rgba(125,240,194,0.9)";
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    pos.current = { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height, user: true };
  };

  return (
    <figure className="film rise overflow-hidden border border-white/[0.06]">
      <div className="relative aspect-square w-full">
        {!state && <img src={xrayUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" fetchPriority="low" decoding="async" />}
        <canvas ref={baseCanvas} className="absolute inset-0 h-full w-full" aria-hidden />
        <canvas ref={lensCanvas} onPointerMove={move} onPointerLeave={() => (pos.current.user = false)} className="absolute inset-0 h-full w-full cursor-crosshair touch-none" role="img" aria-label="A real chest X-ray with an encrypted record hidden in it. A lens shows the pixels moved to hide the record." />
        <div className="overlay left-4 top-3">
          MEDVAULT · CHEST PA
          <br />
          REAL SCAN, CC BY 3.0
        </div>
        <div className="overlay right-4 top-3 text-right">
          {state ? `${state.bytes} B SEALED` : "SEALING…"}
          <br />
          AES-256-GCM
        </div>
      </div>
      <figcaption className="border-t border-white/[0.06] px-4 py-3 text-[13px] leading-relaxed text-white/75">
        {state ? <>Move the lens. An encrypted record ({state.bytes} bytes) is hidden in this X-ray. The lens shows the pixels moved to make room for it: {state.changed.toLocaleString()} of {state.total.toLocaleString()}, each by one grey level, invisible to the eye. Take the record out and every pixel comes back exactly.</> : "Sealing a record into this X-ray, in your browser…"}
        <span className="mt-2 block text-[11.5px] text-white/50">
          Scan: Hannover Medical School, COVID-19 image repository (Winther et al., figshare, doi:10.6084/m9.figshare.12275009), <a className="underline underline-offset-2 hover:text-white" href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a>. Converted to grayscale and downscaled.
        </span>
      </figcaption>
    </figure>
  );
}
