import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, date, useApi, type AuditEntry, type RecordMeta } from "./lib";
import { fetchHead, verifyEntry } from "./translog";
import { Avatar, Notice } from "./ui";

export type LoanView = {
  id: string;
  recordId: string;
  patientId: string;
  doctorId: string;
  createdAt: number;
  expiresAt: number;
  endedAt: number | null;
  endReason: "expired" | "revoked" | null;
  keyHeld: boolean;
  title: string;
  doctorName: string;
  patientName: string;
  record: RecordMeta | null;
};

/** The current time, ticking once a second (for countdowns). */
export function useNow(every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

export function left(ms: number) {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

/** An amber ring that empties as a loan runs out. */
export function Ring({ start, end, now, size = 52, children }: { start: number; end: number; now: number; size?: number; children?: React.ReactNode }) {
  const frac = Math.max(0, Math.min(1, (end - now) / (end - start)));
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid flex-none place-items-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-2)" strokeWidth="3" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={frac > 0 ? "var(--amber)" : "var(--line-2)"} strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: "stroke-dashoffset 1s linear" }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center">{children}</span>
    </span>
  );
}

const DURATIONS = [
  { m: 15, t: "15 min" },
  { m: 60, t: "1 hour" },
  { m: 8 * 60, t: "8 hours" },
  { m: 24 * 60, t: "1 day" },
  { m: 7 * 24 * 60, t: "1 week" },
];

/** The lending form: whom to lend to, and for how long. */
export function LendForm({ record, careTeam, onLent, onCancel }: { record: RecordMeta; careTeam: string[]; onLent: (l: LoanView) => void; onCancel: () => void }) {
  const doctors = useApi<{ doctors: { id: string; name: string; email: string }[] }>("/api/doctors");
  const [doctor, setDoctor] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = (doctors.data?.doctors ?? []).sort((a, b) => Number(careTeam.includes(a.id)) - Number(careTeam.includes(b.id)));
  const chosen = list.find((d) => d.id === doctor);
  const idx = DURATIONS.findIndex((d) => d.m === minutes);

  async function lend() {
    if (!doctor) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ loan: LoanView }>(`/api/records/${record.id}/loans`, { method: "POST", json: { doctorId: doctor, minutes } });
      onLent(r.loan);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="pt-3">
      <p className="eyebrow text-amber">Lend a card</p>
      <h2 className="display mt-2 pr-12 text-[clamp(1.8rem,4vw,2.6rem)]">{record.title}</h2>
      <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-muted">
        The doctor can open this one record, nothing else in your wallet, until the time runs out. Then the key made for the loan is destroyed and it returns to you by itself. Every look is written to your access trail.
      </p>

      <fieldset className="mt-7">
        <legend className="label">Lend to</legend>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {list.map((d) => {
            const team = careTeam.includes(d.id);
            return (
              <label key={d.id} className={`flex cursor-pointer items-center gap-3 rounded-[16px] border p-3 transition-colors ${doctor === d.id ? "border-amber bg-amber-soft" : "border-line-2 bg-panel hover:border-line-2 hover:bg-panel-2"}`}>
                <input type="radio" name="doctor" className="sr-only" checked={doctor === d.id} onChange={() => setDoctor(d.id)} />
                <Avatar name={d.name} size={38} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{d.name}</span>
                  <span className="block text-[12.5px] text-faint">{team ? "Already on your care team" : "Not on your care team"}</span>
                </span>
              </label>
            );
          })}
          {!doctors.data && [0, 1].map((i) => <div key={i} className="skeleton h-[66px]" />)}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="label">For</legend>
        <div className="mt-2.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Loan length">
          {DURATIONS.map((d) => (
            <button key={d.m} type="button" role="radio" aria-checked={minutes === d.m} onClick={() => setMinutes(d.m)} className={`h-10 rounded-full border px-4 text-sm font-semibold transition-[transform,background] duration-300 [transition-timing-function:var(--spring)] active:scale-95 ${minutes === d.m ? "border-amber bg-amber text-amber-ink" : "border-line-2 bg-panel text-muted hover:text-ink"}`}>
              {d.t}
            </button>
          ))}
        </div>
        {/* A timeline of the loan: now, then the moment the key is destroyed. */}
        <div className="mt-5 rounded-[16px] border border-line bg-panel p-4" aria-hidden>
          <div className="relative h-2 rounded-full bg-panel-3">
            <div className="absolute inset-y-0 left-0 rounded-full bg-amber transition-[width] duration-500 [transition-timing-function:var(--spring)]" style={{ width: `${((idx + 1) / DURATIONS.length) * 100}%` }} />
          </div>
          <div className="mt-2.5 flex justify-between font-mono text-[11px] text-faint">
            <span>now: key derived</span>
            <span>{date(Date.now() + minutes * 60_000)}: key destroyed</span>
          </div>
        </div>
      </fieldset>

      {error && (
        <div className="mt-5">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      <div className="mt-7 flex flex-wrap gap-2">
        <button className="btn btn-amber" disabled={!doctor || busy} onClick={() => void lend()}>
          {busy ? "Deriving the loan key…" : chosen ? `Lend to ${chosen.name.replace(/^Dr\.\s*/, "Dr. ")} for ${DURATIONS[idx].t}` : "Choose a doctor"}
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const TRAIL: Record<string, string> = {
  "loan.create": "Lent",
  "record.view": "Opened the record",
  "image.original": "Viewed the restored scan",
  "image.diff": "Viewed the change map",
  "file.original": "Downloaded the original file",
  "record.verify": "Verified a file",
  "loan.revoke": "Taken back, key destroyed",
  "loan.expire": "Time ran out, key destroyed",
};

/** A loan as a ticket: who, what, the time left, and its own access trail, checkable in the browser. */
export function LoanTicket({ loan, entries, onChange, perspective }: { loan: LoanView; entries: AuditEntry[]; onChange?: () => void; perspective: "patient" | "doctor" }) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<Record<number, boolean | "…">>({});
  const active = !loan.endedAt && loan.expiresAt > now;
  const trail = entries.filter((e) => e.detail.includes(`loan:${loan.id}`)).sort((a, b) => a.seq - b.seq);
  const looks = trail.filter((e) => e.action !== "loan.create" && !e.action.startsWith("loan.")).length;

  async function takeBack() {
    setBusy(true);
    try {
      await api(`/api/loans/${loan.id}`, { method: "DELETE" });
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    const head = await fetchHead();
    for (const e of trail) {
      setProof((p) => ({ ...p, [e.seq]: "…" }));
      const ok = await verifyEntry(e, head).catch(() => false);
      setProof((p) => ({ ...p, [e.seq]: ok }));
    }
  }

  return (
    <li className={`rise relative overflow-hidden rounded-[20px] border ${active ? "border-amber/35 bg-[linear-gradient(135deg,rgba(255,196,107,0.08),transparent_60%)]" : "border-line bg-panel"}`}>
      <div className="flex items-center gap-3.5 p-3.5">
        <Ring start={loan.createdAt} end={loan.expiresAt} now={active ? now : loan.expiresAt}>
          <Avatar name={perspective === "patient" ? loan.doctorName : loan.patientName} size={34} />
        </Ring>
        <div className="min-w-0 flex-1">
          {perspective === "doctor" && active ? (
            <Link to={`/lent/${loan.recordId}`} viewTransition className="block truncate font-semibold after:absolute after:inset-0 hover:text-amber">
              {loan.title}
            </Link>
          ) : (
            <div className="truncate font-semibold">{loan.title}</div>
          )}
          <div className="text-[13px] text-muted">
            {perspective === "patient" ? `With ${loan.doctorName}` : `From ${loan.patientName}`}
            {" · "}
            {active ? (
              <span className="tnum text-amber" aria-live="off">
                {left(loan.expiresAt - now)} left
              </span>
            ) : (
              <span className="text-faint">{loan.endReason === "revoked" ? "taken back" : "returned"}, key destroyed</span>
            )}
          </div>
        </div>
        {perspective === "patient" && active && (
          <button className="btn h-9 px-3.5 text-[13px]" disabled={busy} onClick={() => void takeBack()}>
            Take back
          </button>
        )}
        {perspective === "patient" && (
          <button className="btn btn-ghost h-9 w-9 px-0" aria-expanded={open} aria-label={`Access trail for ${loan.title}`} onClick={() => setOpen(!open)}>
            <svg viewBox="0 0 16 16" className={`h-4 w-4 transition-transform duration-300 [transition-timing-function:var(--spring)] ${open ? "rotate-180" : ""}`} aria-hidden>
              <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <div className="fade border-t border-line px-4 pb-4 pt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-muted">
              {looks} look{looks === 1 ? "" : "s"} through this loan
            </p>
            <button className="btn h-8 px-3 text-[12.5px]" onClick={() => void verify()}>
              Prove it in my browser
            </button>
          </div>
          <ol className="relative mt-3 space-y-0 border-l border-line-2 pl-5">
            {trail.map((e) => (
              <li key={e.seq} className="relative pb-3 last:pb-0">
                <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-[var(--panel)] ${e.action.startsWith("loan.") ? "bg-amber" : "bg-accent"}`} aria-hidden />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span>{TRAIL[e.action] ?? e.action}</span>
                  <span className="font-mono text-[11px] text-faint">
                    {proof[e.seq] === true && <span className="mr-2 text-accent">✓ in signed log</span>}
                    {proof[e.seq] === false && <span className="mr-2 text-coral">✗ not in log</span>}
                    {proof[e.seq] === "…" && <span className="mr-2">checking…</span>}
                    {date(e.ts)}
                  </span>
                </div>
                <div className="font-mono text-[10.5px] text-faint">#{e.seq} · {e.hash.slice(0, 16)}</div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}
