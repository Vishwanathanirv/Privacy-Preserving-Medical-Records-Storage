import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib";
import { Avatar } from "../ui";

const DEMO = [
  { email: "meera@medvault.dev", name: "Dr. Meera Iyer", role: "Doctor", hint: "Sees two consenting patients" },
  { email: "arjun@medvault.dev", name: "Dr. Arjun Rao", role: "Doctor", hint: "Sees only Karthik" },
  { email: "anitha@medvault.dev", name: "Anitha Kumar", role: "Patient", hint: "Controls who sees her records" },
  { email: "admin@medvault.dev", name: "Asha Admin", role: "Admin", hint: "Manages users, cannot read records" },
];
const PASSWORD = "medvault-demo";

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(e: string, p: string) {
    setBusy(true);
    setError(null);
    try {
      await login(e, p);
      nav("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-dvh max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
      <div>
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <span className="text-xl font-extrabold tracking-tight">MedVault</span>
        </div>
        <h1 className="mt-7 max-w-[16ch] text-[clamp(2.2rem,4.6vw,3.3rem)] font-extrabold leading-[1.02] tracking-[-0.035em]">Your records travel inside your scans, encrypted.</h1>
        <p className="mt-4 max-w-lg text-[1.02rem] leading-relaxed text-muted">
          Each record is encrypted with AES-256-GCM and hidden in its scan by reversible watermarking. Only doctors the patient switches on can open it, the original scan comes back bit for bit, and every access is written to a log anyone can verify.
        </p>
        <Hero />
      </div>
      <div className="panel p-6 sm:p-8">
        <h2 className="text-xl font-extrabold">Sign in</h2>
        <p className="mt-1 text-sm text-muted">Pick someone to be. All people and records are fictional.</p>
        <ul className="mt-5 grid grid-cols-2 gap-3">
          {DEMO.map((d) => (
            <li key={d.email}>
              <button disabled={busy} onClick={() => go(d.email, PASSWORD)} className="group flex h-full w-full flex-col items-start gap-3 rounded-[20px] border border-line bg-panel-2 p-4 text-left transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[var(--shadow)] disabled:opacity-50">
                <Avatar name={d.name} size={44} />
                <span>
                  <span className="block font-bold leading-tight">{d.name}</span>
                  <span className="mt-0.5 block text-[12px] font-semibold text-accent">{d.role}</span>
                  <span className="mt-1 block text-[12.5px] leading-snug text-muted">{d.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="my-6 flex items-center gap-3 text-xs text-faint">
          <span className="h-px flex-1 bg-line" />
          or use your account
          <span className="h-px flex-1 bg-line" />
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void go(email, password);
          }}
        >
          <input className="field" type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Email" />
          <input className="field" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-label="Password" />
          {error && <p className="text-sm text-bad">{error}</p>}
          <button className="btn btn-accent w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-xs text-faint">
          Demo password: <code className="font-mono">{PASSWORD}</code>
        </p>
      </div>
    </div>
  );
}

/**
 * A scan on film with its record sealed inside, drawn here so the idea is visible before signing
 * in: the picture looks like any CT, and the corners say what it is carrying.
 */
function Hero() {
  return (
    <div className="film mt-7 hidden aspect-[16/10] max-w-xl overflow-hidden sm:block" role="img" aria-label="A head CT on film. Its corner labels show it carries an encrypted record and is bit-exact restorable.">
      <svg viewBox="0 0 320 200" className="h-full w-full">
        <defs>
          <radialGradient id="mv-skull" cx="50%" cy="48%" r="55%">
            <stop offset="0" stopColor="#5d666b" />
            <stop offset="1" stopColor="#3a4246" />
          </radialGradient>
        </defs>
        <ellipse cx="160" cy="100" rx="66" ry="84" fill="#e9eef0" />
        <ellipse cx="160" cy="101" rx="61" ry="79" fill="url(#mv-skull)" />
        <ellipse cx="140" cy="104" rx="13" ry="30" transform="rotate(-18 140 104)" fill="#151a1d" />
        <ellipse cx="181" cy="104" rx="11" ry="26" transform="rotate(18 181 104)" fill="#151a1d" />
        <ellipse cx="160" cy="68" rx="19" ry="16" fill="#7a8388" />
        <circle cx="160" cy="92" r="4" fill="#8b9499" />
        <circle cx="153" cy="148" r="2.5" fill="#8b9499" />
        <circle cx="160" cy="148" r="2.5" fill="#8b9499" />
        <circle cx="167" cy="148" r="2.5" fill="#8b9499" />
      </svg>
      <div className="scanline" aria-hidden />
      <div className="overlay text-[8.5px] sm:text-[11px] left-5 top-3">
        MEDVAULT
        <br />
        HEAD CT, FOLLOW-UP
      </div>
      <div className="overlay text-[8.5px] sm:text-[11px] right-3 top-3 text-right">
        512x512
        <br />
        PNG 8-bit
      </div>
      <div className="overlay text-[8.5px] sm:text-[11px] bottom-3 left-5">
        RECORD SEALED IN PIXELS
        <br />
        max change ±1 level
      </div>
      <div className="overlay text-[8.5px] sm:text-[11px] bottom-3 right-3 text-right">
        AES-256-GCM
        <br />
        restores bit-exact
      </div>
    </div>
  );
}
