import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { Gray } from "@medvault/core";
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
  { k: "how", t: "How it works", d: "One record, from key to recovery, computed live.", who: null, to: "/how", tone: "accent" },
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
    } else if (t.who) await go(t.who, PASSWORD, t.to);
    else nav(t.to, { viewTransition: true });
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
        <section aria-label="The idea and what to try" className="lg:col-start-1 lg:row-span-2 lg:row-start-2">
          <dl className="grid max-w-2xl gap-x-6 gap-y-4 sm:grid-cols-3">
            {[
              ["The problem", "Records and scans live in different systems. Copies drift apart and leak, and patients never see who looked."],
              ["The idea", "Seal the record into the scan's own pixels. Take it out and the scan comes back bit for bit."],
              ["Why it's different", "Portals and PACS keep the keys. Here the patient lends access that expires, and anyone can verify the log."],
            ].map(([k, v]) => (
              <div key={k} className="border-t border-line-2 pt-3">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">{k}</dt>
                <dd className="mt-1.5 text-[0.92rem] leading-relaxed">{v}</dd>
              </div>
            ))}
          </dl>

          <h2 className="eyebrow mt-12">Try it</h2>
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
              Sign in
            </h2>
            <p className="mt-1 text-sm text-muted">Pick someone to be. Everyone here is fictional; the scans are real, openly licensed images.</p>
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
  const view = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<{ base: HTMLCanvasElement; mark: HTMLCanvasElement; changed: number; bytes: number; total: number } | null>(null);
  const pos = useRef({ x: 0.62, y: 0.44, user: false });

  useEffect(() => {
    let live = true;
    const start = () =>
      void (async () => {
        // The crypto and imaging code loads after the page has painted.
        const [{ decodePng, embed, encryptRecord }, png] = await Promise.all([import("@medvault/core"), fetch(xrayUrl).then((r) => r.arrayBuffer())]);
        const g = decodePng(new Uint8Array(png)).image;
        const sealed = encryptRecord(crypto.getRandomValues(new Uint8Array(32)), crypto.randomUUID(), crypto.randomUUID(), { title: "Chest X-ray: persistent cough", diagnosis: "Bilateral patchy opacities; viral pneumonia most likely.", medications: ["Paracetamol 500 mg as needed"] });
        const { image } = embed(g, sealed.ciphertext);
        if (!live) return;
        const toCanvas = (img: Gray, f: (i: number) => [number, number, number]) => {
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext("2d")!;
          const out = ctx.createImageData(img.width, img.height);
          for (let i = 0; i < img.data.length; i++) {
            const [r, gg, b] = f(i);
            out.data.set([r, gg, b, 255], i * 4);
          }
          ctx.putImageData(out, 0, 0);
          return c;
        };
        let changed = 0;
        const base = toCanvas(image, (i) => [image.data[i], image.data[i], image.data[i]]);
        const mark = toCanvas(image, (i) => {
          if (image.data[i] !== g.data[i]) {
            changed++;
            return [125, 240, 194];
          }
          const v = image.data[i] * 0.22;
          return [v, v, v];
        });
        setState({ base, mark, changed, bytes: sealed.ciphertext.length, total: g.width * g.height });
      })();
    const idle = (window as Window & { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
    if (idle) idle(start);
    else setTimeout(start, 200);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!state || !view.current) return;
    const c = view.current;
    const ctx = c.getContext("2d")!;
    c.width = state.base.width;
    c.height = state.base.height;
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
      ctx.drawImage(state.base, 0, 0);
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
      if (!reduce || !pos.current.user) raf = requestAnimationFrame(draw);
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
        <canvas ref={view} onPointerMove={move} onPointerLeave={() => (pos.current.user = false)} className="absolute inset-0 h-full w-full cursor-crosshair touch-none" role="img" aria-label="A real chest X-ray with an encrypted record hidden in it. A lens shows the pixels that carry the record." />
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
      <figcaption className="border-t border-white/[0.06] px-4 py-3 text-[13px] leading-relaxed text-white/70">{state ? <>Move the lens. An encrypted record ({state.bytes} bytes) is hidden in this X-ray. The lens shows the pixels moved to make room for it: {state.changed.toLocaleString()} of {state.total.toLocaleString()}, each by one grey level, invisible to the eye. Take the record out and every pixel comes back exactly.</> : "Sealing a record into this X-ray, in your browser…"}</figcaption>
    </figure>
  );
}
