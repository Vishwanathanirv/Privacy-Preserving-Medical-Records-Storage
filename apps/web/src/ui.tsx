import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { date, useRecordImage, type RecordMeta } from "./lib";

/** The MedVault mark: a wallet card whose pixels carry a few hidden bits. */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden className="flex-none">
      <rect width="32" height="32" rx="8" fill="#0b0d10" />
      <rect x="4.5" y="7.5" width="23" height="17" rx="4" fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      <g fill="#3a4148">
        <rect x="8.5" y="11.5" width="3" height="3" rx=".6" />
        <rect x="14.5" y="11.5" width="3" height="3" rx=".6" />
        <rect x="8.5" y="17.5" width="3" height="3" rx=".6" />
        <rect x="20.5" y="17.5" width="3" height="3" rx=".6" />
      </g>
      <g fill="var(--accent)">
        <rect x="20.5" y="11.5" width="3" height="3" rx=".6" />
        <rect x="14.5" y="17.5" width="3" height="3" rx=".6" />
      </g>
    </svg>
  );
}

export function Panel({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
          <h2 className="text-[1.02rem] font-bold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-[0.95rem] text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-bold ${ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{ok ? "✓" : "!"}</span>
      <span>{children}</span>
    </li>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "bad" | "warn"; children: ReactNode }) {
  const c = { info: "bg-accent-soft text-ink", ok: "bg-ok-soft text-ok", bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn" }[tone];
  return <div className={`rounded-[16px] px-4 py-3 text-sm ${c}`}>{children}</div>;
}

/** Initials in a coloured circle; the colour comes from the name so it's stable. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const initials = name
    .replace(/^Dr\.\s*/, "")
    .split(/\s+/)
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
  return (
    <span className="grid flex-none place-items-center rounded-full font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + 40) % 360} 65% 48%))` }} aria-hidden>
      {initials}
    </span>
  );
}

/**
 * Records as a stack of cards, like a phone wallet: each card's art is the scan the record is
 * sealed in. Cards overlap so many fit; the one you point at lifts out of the stack.
 */
export function Wallet({ records, empty, base = "/records", onLend, lent }: { records: RecordMeta[]; empty: string; base?: string; onLend?: (r: RecordMeta) => void; lent?: Set<string> }) {
  if (!records.length)
    return (
      <div className="grid h-48 place-items-center rounded-[22px] border border-dashed border-line-2 p-6 text-center text-sm text-faint">
        <p>{empty}</p>
      </div>
    );
  return (
    <ol className="relative" aria-label={`${records.length} record${records.length === 1 ? "" : "s"}`}>
      {records.map((r, i) => (
        <li key={r.id} className={`group/card relative ${i ? "-mt-[7.6rem]" : ""}`} style={{ zIndex: i }}>
          <WalletCard r={r} to={`${base}/${r.id}`} lent={lent?.has(r.id)} index={i} />
          {onLend && (
            <button onClick={() => onLend(r)} className="btn btn-amber absolute right-3.5 top-3.5 z-10 h-8 px-3 text-[12.5px] opacity-100 transition-opacity sm:opacity-0 sm:group-hover/card:opacity-100 sm:focus-visible:opacity-100" aria-label={`Lend ${r.title}`}>
              Lend
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function WalletCard({ r, to, lent, index }: { r: RecordMeta; to: string; lent?: boolean; index: number }) {
  const src = useRecordImage(r.id, "stego");
  return (
    <Link
      to={to}
      viewTransition
      className="film rise group block h-[11.5rem] overflow-hidden border border-white/[0.07] shadow-[0_-10px_30px_-14px_rgba(0,0,0,0.9)] transition-transform duration-500 [transition-timing-function:var(--spring)] hover:-translate-y-4 focus-visible:-translate-y-4"
      style={{ animationDelay: `${index * 70}ms` }}
      aria-label={`${r.title}, by ${r.authorName}, ${date(r.createdAt)}${lent ? ", on loan" : ""}`}
    >
      {src ? <img src={src} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 transition-[opacity,transform] duration-700 group-hover:scale-100 group-hover:opacity-85" loading="lazy" /> : <div className="skeleton absolute inset-0 rounded-none" />}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.82),rgba(0,0,0,0.15)_45%,rgba(0,0,0,0.85))]" />
      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-start gap-3 pr-16">
          <Chip />
          <div className="min-w-0">
            <div className="truncate text-[1.05rem] font-semibold leading-tight">{r.title}</div>
            <div className="mt-0.5 text-xs text-white/65">
              {r.authorName} · {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </div>
          </div>
        </div>
        <div className="flex items-end justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-white/70">
          <span>
            {r.scan?.format === "dicom" ? `DICOM ${r.scan.modality ?? ""} ${r.scan.bitDepth}-bit` : `PNG ${r.scan?.bitDepth ?? 8}-bit`}
            <br />
            {(r.stats.payloadBytes / 1024).toFixed(1)} KB sealed in {r.width}×{r.height}
          </span>
          {lent ? <span className="rounded-full bg-amber px-2 py-0.5 font-sans text-[11px] font-semibold normal-case tracking-normal text-amber-ink">On loan</span> : <span className="text-accent">● sealed</span>}
        </div>
      </div>
    </Link>
  );
}

/** The card's "chip": a little grid of pixels, two of them carrying bits. */
function Chip() {
  return (
    <svg viewBox="0 0 24 18" className="mt-0.5 h-[18px] w-6 flex-none" aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="17" rx="4" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" />
      {[0, 1, 2].map((x) => [0, 1].map((y) => <rect key={`${x}${y}`} x={4 + x * 6} y={4 + y * 6} width="4" height="4" rx="1" fill={(x + y) % 3 === 1 ? "var(--accent)" : "rgba(255,255,255,0.28)"} />))}
    </svg>
  );
}

/** A panel that slides up over the home screen; Esc or the close button goes back. */
export function Sheet({ label, onClose, children, wide = true }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[aria-label="Command palette"]') && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={label}>
      <button className="fade absolute inset-0 bg-black/70 backdrop-blur-[3px]" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div ref={panel} tabIndex={-1} className={`rise absolute inset-x-0 bottom-0 top-3 mx-auto overflow-y-auto rounded-t-[28px] border border-line-2 bg-bg-2 shadow-[var(--shadow)] outline-none sm:inset-x-4 sm:top-6 ${wide ? "max-w-6xl" : "max-w-2xl"}`}>
        <div className="sticky top-0 z-10 flex justify-center bg-gradient-to-b from-[var(--bg-2)] to-transparent pb-2 pt-2.5">
          <span className="h-1.5 w-12 rounded-full bg-line-2" aria-hidden />
        </div>
        <button className="btn absolute right-4 top-4 z-20 h-9 w-9 px-0" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
            <path d="M3.5 3.5l9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <div className="px-4 pb-10 sm:px-8">{children}</div>
      </div>
    </div>
  );
}

/** A toggle switch, for consent. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: () => unknown; label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onChange();
        } finally {
          setBusy(false);
        }
      }}
      className={`relative h-7 w-12 flex-none rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`}
    >
      <span className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}
