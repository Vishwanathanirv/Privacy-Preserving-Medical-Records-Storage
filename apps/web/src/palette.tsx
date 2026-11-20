import { useEffect, useMemo, useRef, useState } from "react";

export type Command = { id: string; label: string; hint?: string; keys?: string; group: string; run: () => void };

/**
 * The command palette: ⌘K / Ctrl K (or "/") opens it, arrows move, Enter runs. Single-key
 * shortcuts listed next to commands work anywhere outside a text field.
 */
export function Palette({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? commands.filter((c) => `${c.label} ${c.hint ?? ""} ${c.group}`.toLowerCase().includes(t)) : commands;
  }, [q, commands]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [contenteditable]") !== null);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/" || e.key === "?") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (open || document.querySelector('[aria-modal="true"]')) return;
      const c = commands.find((x) => x.keys && x.keys.toLowerCase() === e.key.toLowerCase());
      if (c) {
        e.preventDefault();
        c.run();
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("medvault:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("medvault:palette", onOpen);
    };
  }, [commands, open]);

  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setQ("");
      setSel(0);
      requestAnimationFrame(() => input.current?.focus());
    } else returnFocus.current?.focus?.();
  }, [open]);

  if (!open) return null;
  const run = (c: Command) => {
    setOpen(false);
    c.run();
  };
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] grid place-items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button className="fade absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label="Close command palette" onClick={() => setOpen(false)} />
      <div className="rise relative w-full max-w-xl overflow-hidden rounded-[22px] border border-line-2 bg-panel shadow-[var(--shadow)]">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <svg viewBox="0 0 20 20" className="h-4 w-4 flex-none text-faint" aria-hidden>
            <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="m13.5 13.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter" && shown[sel]) run(shown[sel]);
              else if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Type a command or search…"
            className="h-14 flex-1 bg-transparent text-[1.02rem] outline-none placeholder:text-faint"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={shown[sel] ? `cmd-${shown[sel].id}` : undefined}
            aria-label="Command"
          />
          <span className="kbd">esc</span>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-faint">Nothing matches “{q}”.</li>}
          {shown.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && <div className="eyebrow px-3 pb-1 pt-3">{header}</div>}
                <div
                  id={`cmd-${c.id}`}
                  role="option"
                  aria-selected={i === sel}
                  onMouseMove={() => setSel(i)}
                  onClick={() => run(c)}
                  className={`flex cursor-pointer items-center gap-3 rounded-[14px] px-3 py-2.5 ${i === sel ? "bg-panel-3" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{c.label}</span>
                    {c.hint && <span className="block truncate text-[13px] text-faint">{c.hint}</span>}
                  </span>
                  {c.keys && <span className="kbd">{c.keys}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[12px] text-faint">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> move
          </span>
          <span>
            <span className="kbd">↵</span> run
          </span>
          <span className="ml-auto">
            <span className="kbd">⌘</span> <span className="kbd">K</span> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}

export const openPalette = () => window.dispatchEvent(new Event("medvault:palette"));
