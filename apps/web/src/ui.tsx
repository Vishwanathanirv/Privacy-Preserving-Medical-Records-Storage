import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { date, useRecordImage, type RecordMeta } from "./lib";

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
export function Wallet({ records, empty, base = "/records" }: { records: RecordMeta[]; empty: string; base?: string }) {
  if (!records.length)
    return (
      <div className="grid h-48 place-items-center rounded-[24px] border-2 border-dashed border-line p-6 text-center text-sm text-muted">
        <p>{empty}</p>
      </div>
    );
  return (
    <ol className="relative" aria-label={`${records.length} record${records.length === 1 ? "" : "s"}`}>
      {records.map((r, i) => (
        <li key={r.id} className={i ? "-mt-[7.25rem]" : ""} style={{ position: "relative", zIndex: i }}>
          <WalletCard r={r} to={`${base}/${r.id}`} />
        </li>
      ))}
    </ol>
  );
}

function WalletCard({ r, to }: { r: RecordMeta; to: string }) {
  const src = useRecordImage(r.id, "stego");
  return (
    <Link to={to} className="film group block h-[11rem] overflow-hidden shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.6)] transition-transform duration-200 hover:-translate-y-3 focus-visible:-translate-y-3" aria-label={`${r.title}, by ${r.authorName}, ${date(r.createdAt)}`}>
      {src && <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70 transition-opacity group-hover:opacity-90" loading="lazy" />}
      <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/20 to-black/70" />
      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[1.02rem] font-bold">{r.title}</div>
            <div className="text-xs text-white/70">
              {r.authorName}, {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </div>
          </div>
          <span className="flex-none rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">
            {r.scan?.format === "dicom" ? `DICOM ${r.scan.modality ?? ""}`.trim() : "PNG"}
          </span>
        </div>
        <div className="flex items-end justify-between gap-3 font-mono text-[10.5px] text-white/75">
          <span>
            Sealed with AES-256-GCM
            <br />
            {(r.stats.payloadBytes / 1024).toFixed(1)} KB inside {r.width}×{r.height}
          </span>
          <span className="text-right">PSNR {r.stats.psnr.toFixed(1)} dB</span>
        </div>
      </div>
    </Link>
  );
}

/** A panel that slides up over the home screen; Esc or the close button goes back. */
export function Sheet({ label, onClose, children, wide = true }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
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
      <button className="fade absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div className={`sheet-up absolute inset-x-0 bottom-0 top-3 mx-auto overflow-y-auto rounded-t-[28px] border border-line bg-bg shadow-[var(--shadow)] sm:inset-x-4 sm:top-6 ${wide ? "max-w-6xl" : "max-w-2xl"}`}>
        <div className="sticky top-0 z-10 flex justify-center bg-gradient-to-b from-[var(--bg)] to-transparent pb-2 pt-2.5">
          <span className="h-1.5 w-12 rounded-full bg-line" aria-hidden />
        </div>
        <button className="btn absolute right-4 top-4 z-20 h-9 w-9 px-0" onClick={onClose} aria-label="Close">
          ✕
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
