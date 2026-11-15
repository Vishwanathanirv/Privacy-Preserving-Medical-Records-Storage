import type { ReactNode } from "react";
import { Link } from "react-router";
import { date, useRecordImage, type RecordMeta } from "./lib";

export function Panel({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-[0.95rem] font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, sub, action, back }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link to={back.to} className="text-sm text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.9rem] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
          {sub && <p className="mt-1.5 max-w-2xl text-[0.95rem] text-muted">{sub}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}

export function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-[3px] font-mono text-[11px] font-bold ${ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{ok ? "✓" : "!"}</span>
      <span>{children}</span>
    </li>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "bad" | "warn"; children: ReactNode }) {
  const c = { info: "bg-accent-soft text-ink", ok: "bg-ok-soft text-ok", bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn" }[tone];
  return <div className={`rounded-[3px] border-l-[3px] border-current/40 px-4 py-3 text-sm ${c}`}>{children}</div>;
}

export function RecordList({ records, empty }: { records: RecordMeta[]; empty: string }) {
  if (!records.length) return <p className="px-5 py-10 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {records.map((r) => (
        <li key={r.id}>
          <Link to={`/records/${r.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-panel-2">
            <Thumb id={r.id} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{r.title}</div>
              <div className="mt-0.5 text-sm text-muted">
                {r.authorName}, {date(r.createdAt)}
              </div>
            </div>
            <span className="hidden font-mono text-xs text-muted sm:inline">
              sealed in {r.width}×{r.height} scan
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Thumb({ id }: { id: string }) {
  const src = useRecordImage(id, "stego");
  return src ? <img src={src} alt="" className="film h-14 w-14 flex-none object-cover [clip-path:polygon(6px_0,100%_0,100%_100%,0_100%,0_6px)]" loading="lazy" /> : <span className="film h-14 w-14 flex-none" />;
}
