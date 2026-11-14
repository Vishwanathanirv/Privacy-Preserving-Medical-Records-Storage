import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib";

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
    <div className="mx-auto grid min-h-dvh max-w-5xl items-center gap-10 px-4 py-10 md:grid-cols-[1fr_1.05fr]">
      <div>
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <span className="text-xl font-semibold tracking-tight">MedVault</span>
        </div>
        <h1 className="mt-8 text-[2.4rem] font-semibold leading-[1.08] tracking-tight">Medical records that travel inside the scan, encrypted.</h1>
        <p className="mt-4 max-w-md leading-relaxed text-muted">
          Each record is encrypted with AES-256-GCM and hidden inside its scan with reversible watermarking. Only doctors the patient approves can open it, the original scan comes back bit for bit, and every access is written to a tamper-evident log.
        </p>
        <ul className="mt-6 space-y-2 text-sm text-muted">
          <li>• No plaintext medical data in the database</li>
          <li>• Patient-controlled consent, revocable at any time</li>
          <li>• Any change to the image or the log is detected</li>
        </ul>
      </div>
      <div className="panel p-6 sm:p-8">
        <h2 className="text-lg font-semibold">Sign in</h2>
        <p className="mt-1 text-sm text-muted">Pick a demo account. All people and records are fictional.</p>
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          {DEMO.map((d) => (
            <button key={d.email} disabled={busy} onClick={() => go(d.email, PASSWORD)} className="rounded-xl border border-line p-3.5 text-left transition hover:border-accent hover:bg-panel-2">
              <div className="text-xs font-medium uppercase tracking-wider text-accent">{d.role}</div>
              <div className="mt-1 font-medium">{d.name}</div>
              <div className="mt-0.5 text-xs text-muted">{d.hint}</div>
            </button>
          ))}
        </div>
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
