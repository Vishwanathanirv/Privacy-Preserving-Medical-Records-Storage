import { useEffect, useState } from "react";
import { encode } from "uqr";
import { deriveCardKeys, issueCard, normaliseCode, openCard, toHex, type EmergencySummary } from "@medvault/core";
import { api, date, DEMO, refresh, useApi, useAuth, useGo } from "../lib";
import { Mark, Notice } from "../ui";

type CardMeta = { id: string; createdAt: number };

/** A QR code as crisp SVG squares. */
export function QR({ text, size = 120, label }: { text: string; size?: number; label: string }) {
  const q = encode(text, { ecc: "M", border: 1 });
  let d = "";
  q.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
  return (
    <svg viewBox={`0 0 ${q.size} ${q.size}`} width={size} height={size} role="img" aria-label={label} className="flex-none rounded-[8px] bg-white" shapeRendering="crispEdges">
      <path d={d} fill="#0b0d10" />
    </svg>
  );
}

const link = (id: string, code: string) => `${location.origin}/sos#${id}.${code}`;

/** The printable card itself: coral, wallet sized, with the QR a responder scans. */
function PrintedCard({ name, id, code }: { name: string; id: string; code: string }) {
  return (
    <div className="print-card relative aspect-[1.586] w-full max-w-[25rem] overflow-hidden rounded-[18px] bg-[radial-gradient(120%_90%_at_0%_0%,#ff8a7c,#e2483b_55%,#a92a20)] p-4 text-[#1a0503] shadow-[0_30px_60px_-30px_rgba(255,111,97,0.7)]">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em]">In case of emergency</div>
          <div className="mt-1 text-[1.35rem] font-bold leading-none tracking-tight [font-variation-settings:'wdth'_88]">{name}</div>
        </div>
        <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
          <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="#1a0503" />
        </svg>
      </div>
      <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] opacity-80">Scan, or enter at /sos</div>
          <div className="mt-1 font-mono text-[12.5px] font-bold leading-snug tracking-[0.06em]">{code}</div>
          <div className="mt-0.5 truncate font-mono text-[8.5px] opacity-70">card {id}</div>
        </div>
        <QR text={link(id, code)} size={84} label="QR code that opens this emergency card" />
      </div>
    </div>
  );
}

const DEFAULTS: EmergencySummary = {
  name: "",
  bloodType: "",
  allergies: [],
  conditions: [],
  medications: [],
  contact: { name: "", phone: "" },
  notes: "",
};

/** The patient's side: issue, print, try, replace or revoke the emergency card. */
export function EmergencyCard() {
  const { user } = useAuth();
  const go = useGo();
  const current = useApi<{ card: CardMeta | null }>("/api/sos");
  const [fresh, setFresh] = useState<{ id: string; code: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState<string | null>(null);
  const [f, setF] = useState({ ...DEFAULTS, name: user?.name ?? "", bloodType: "B+", allergies: ["Penicillin (rash, swelling)"], conditions: ["Mild concussion, recovering (2026)"], medications: ["Paracetamol 500 mg as needed"], contact: { name: "Ravi Kumar (brother)", phone: "+91 98450 00000" } });

  useEffect(() => {
    if (DEMO) void import("../demo/server").then(({ demo }) => demo.sosLink()).then(setSample);
  }, []);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30)); // paint "Sealing…" before scrypt runs
    const card = issueCard({ ...f, allergies: f.allergies.filter(Boolean), conditions: f.conditions.filter(Boolean), medications: f.medications.filter(Boolean) });
    await api("/api/sos", { method: "PUT", json: { id: card.id, salt: card.salt, authHash: card.authHash, sealed: card.sealed } });
    setFresh({ id: card.id, code: card.code });
    setEditing(false);
    setBusy(false);
    void current.reload();
    refresh();
  }

  async function revoke() {
    await api("/api/sos", { method: "DELETE" });
    setFresh(null);
    void current.reload();
    refresh();
  }

  const card = current.data?.card;
  const sampleIsCurrent = sample && card && sample.includes(card.id);
  const list = (k: "allergies" | "conditions" | "medications") => ({ value: f[k].join("\n"), onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value.split("\n") }) });

  return (
    <section aria-labelledby="h-sos" className="rounded-[22px] border border-coral/25 bg-[linear-gradient(160deg,rgba(255,111,97,0.09),transparent_55%)] p-5">
      <p className="eyebrow text-coral">Break-glass</p>
      <h2 id="h-sos" className="mt-1.5 text-[1.45rem] font-bold tracking-tight">
        Emergency card
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">A card for your real wallet. A paramedic who scans it sees your blood type, allergies and emergency contact, with no account and no call to anyone. You see every opening, at once, in your access trail.</p>

      {fresh && (
        <div className="mt-5 space-y-3">
          <PrintedCard name={f.name} id={fresh.id} code={fresh.code} />
          <Notice tone="warn">This code is shown once. MedVault keeps only a hash of a key derived from it, so it cannot show it again. Print the card now.</Notice>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-coral" onClick={() => window.print()}>
              Print card
            </button>
            <button className="btn" onClick={() => go(`/sos#${fresh.id}.${fresh.code}`)}>
              Try it as a paramedic
            </button>
          </div>
        </div>
      )}

      {!fresh && card && !editing && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-coral-soft px-3 py-1.5 text-[13px] text-coral">
            <span className="h-1.5 w-1.5 rounded-full bg-coral" aria-hidden /> Active since {date(card.createdAt)}
          </span>
          {sampleIsCurrent && (
            <button className="btn btn-coral h-9 px-3.5 text-[13px]" onClick={() => go(sample!)}>
              Break the glass as a paramedic
            </button>
          )}
          <button className="btn h-9 px-3.5 text-[13px]" onClick={() => setEditing(true)}>
            Replace
          </button>
          <button className="btn btn-ghost h-9 px-3 text-[13px] text-coral" onClick={() => void revoke()}>
            Revoke
          </button>
        </div>
      )}
      {!fresh && !card && !editing && current.data && (
        <button className="btn btn-coral mt-4" onClick={() => setEditing(true)}>
          Make my emergency card
        </button>
      )}

      {editing && (
        <form onSubmit={issue} className="fade mt-5 grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="label">Name on the card</span>
            <input className="field mt-1.5" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} />
          </label>
          <label>
            <span className="label">Blood type</span>
            <input className="field mt-1.5" value={f.bloodType} onChange={(e) => setF({ ...f, bloodType: e.target.value })} maxLength={8} />
          </label>
          <label>
            <span className="label">Emergency contact</span>
            <input className="field mt-1.5" value={f.contact.name} onChange={(e) => setF({ ...f, contact: { ...f.contact, name: e.target.value } })} maxLength={80} />
          </label>
          <label className="sm:col-span-2">
            <span className="label">Their phone</span>
            <input className="field mt-1.5" value={f.contact.phone} onChange={(e) => setF({ ...f, contact: { ...f.contact, phone: e.target.value } })} maxLength={30} inputMode="tel" />
          </label>
          {(["allergies", "conditions", "medications"] as const).map((k) => (
            <label key={k} className={k === "medications" ? "sm:col-span-2" : ""}>
              <span className="label capitalize">{k} (one per line)</span>
              <textarea className="field mt-1.5 h-20" {...list(k)} />
            </label>
          ))}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button className="btn btn-coral" disabled={busy}>
              {busy ? "Sealing with a new code…" : card ? "Issue a new card (the old one stops working)" : "Seal and issue the card"}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

type Opened = { summary: EmergencySummary; issuedAt: number; logged: { seq: number; ts: number; hash: string } };

/** The responder's side, at /sos: no account, just the card. */
export function SosPage() {
  const [hash] = useState(() => location.hash.slice(1));
  const [id, setId] = useState(() => hash.split(".")[0] ?? "");
  const [code, setCode] = useState(() => hash.split(".")[1] ?? "");
  const [stage, setStage] = useState<"ready" | "deriving" | "opening" | "open" | "error">("ready");
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);

  async function breakGlass(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    try {
      const cardId = id.trim().toLowerCase();
      setStage("deriving");
      const { salt } = await api<{ salt: string }>(`/api/sos/${cardId}/salt`);
      const { encKey, authKey } = await deriveCardKeys(normaliseCode(code), salt);
      setStage("opening");
      const r = await api<{ sealed: string; issuedAt: number; logged: Opened["logged"] }>(`/api/sos/${cardId}/open`, { method: "POST", json: { auth: toHex(authKey) } });
      setOpened({ summary: openCard(encKey, cardId, r.sealed), issuedAt: r.issuedAt, logged: r.logged });
      setStage("open");
      history.replaceState(null, "", "/sos"); // keep the code out of the address bar once used
    } catch (err) {
      setError((err as Error).message);
      setStage("error");
    }
  }

  const s = opened?.summary;
  return (
    <div className="min-h-dvh bg-[radial-gradient(60rem_40rem_at_50%_-10%,rgba(255,111,97,0.16),transparent_70%)]">
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        <a href="/" className="inline-flex items-center gap-2.5" aria-label="MedVault home">
          <Mark size={28} />
          <span className="font-bold tracking-tight">MedVault</span>
        </a>
        {!s && (
          <div className="rise mt-12">
            <p className="eyebrow text-coral">Break-glass access</p>
            <h1 className="display mt-3 text-[clamp(2.6rem,8vw,4.6rem)]">Emergency card</h1>
            <p className="mt-4 max-w-xl leading-relaxed text-muted">You are about to open someone's emergency details. This is logged with the time and shown to them immediately. Use it only to help them.</p>
            <form onSubmit={breakGlass} className="mt-8 grid max-w-xl gap-3">
              {!hash && (
                <>
                  <label>
                    <span className="label">Card id (under the QR code)</span>
                    <input className="field mt-1.5 font-mono" value={id} onChange={(e) => setId(e.target.value)} required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                  </label>
                  <label>
                    <span className="label">Code on the card</span>
                    <input className="field mt-1.5 font-mono tracking-[0.1em]" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoCapitalize="characters" />
                  </label>
                </>
              )}
              <button className="btn btn-coral pulse-ring h-14 text-[1.05rem]" disabled={stage === "deriving" || stage === "opening"}>
                {stage === "deriving" ? "Deriving the card's key (scrypt)…" : stage === "opening" ? "Opening and logging…" : "Break the glass"}
              </button>
              {error && <Notice tone="bad">{error}</Notice>}
            </form>
          </div>
        )}
        {s && opened && (
          <div className="rise mt-10">
            <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[16px] border border-coral/40 bg-coral-soft px-4 py-3 text-sm text-coral">
              <span className="h-2 w-2 rounded-full bg-coral" aria-hidden />
              Opened {date(opened.logged.ts)}. Logged as entry #{opened.logged.seq} in the signed log; {s.name.split(" ")[0]} can see it now.
            </div>
            <p className="eyebrow mt-8">Emergency details</p>
            <h1 className="display mt-2 text-[clamp(2.4rem,7vw,4rem)]">{s.name}</h1>
            <div className="mt-8 grid gap-4 sm:grid-cols-[auto_1fr]">
              <div className="grid min-w-[10rem] place-items-center rounded-[22px] bg-coral p-6 text-coral-ink">
                <div className="font-mono text-[11px] uppercase tracking-[0.2em]">Blood type</div>
                <div className="display mt-1 text-[4.5rem]">{s.bloodType || "?"}</div>
              </div>
              <div className="rounded-[22px] border border-coral/40 bg-panel p-5">
                <div className="eyebrow text-coral">Allergies</div>
                <ul className="mt-2 space-y-1 text-[1.25rem] font-semibold">{s.allergies.length ? s.allergies.map((a) => <li key={a}>{a}</li>) : <li className="text-muted">None recorded</li>}</ul>
              </div>
            </div>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {[
                ["Conditions", s.conditions],
                ["Medications", s.medications],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-[22px] border border-line bg-panel p-5">
                  <dt className="eyebrow">{k as string}</dt>
                  <dd className="mt-2 space-y-1">{(v as string[]).length ? (v as string[]).map((x) => <div key={x}>{x}</div>) : <div className="text-muted">None recorded</div>}</dd>
                </div>
              ))}
              <div className="rounded-[22px] border border-line bg-panel p-5 sm:col-span-2">
                <dt className="eyebrow">Emergency contact</dt>
                <dd className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-lg font-semibold">{s.contact.name || "None recorded"}</span>
                  {s.contact.phone && (
                    <a className="btn btn-coral" href={`tel:${s.contact.phone.replace(/\s/g, "")}`}>
                      Call {s.contact.phone}
                    </a>
                  )}
                </dd>
              </div>
              {s.notes && (
                <div className="rounded-[22px] border border-line bg-panel p-5 sm:col-span-2">
                  <dt className="eyebrow">Notes</dt>
                  <dd className="mt-2 text-muted">{s.notes}</dd>
                </div>
              )}
            </dl>
            <p className="mt-6 text-xs leading-relaxed text-faint">Decrypted in this browser with a key derived from the card's code. The server only checked a hash of a second key from the same code, recorded the opening, and sent back ciphertext. Card issued {date(opened.issuedAt)}.</p>
          </div>
        )}
      </div>
    </div>
  );
}
