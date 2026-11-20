import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, date, useApi, useAuth, type AuditEntry, type RecordMeta } from "../lib";
import { LoanTicket, useNow, type LoanView } from "../loans";
import { Avatar, Notice, Sheet, Wallet } from "../ui";

type Patient = { id: string; name: string; email: string; grantedAt: number; records: number };

/**
 * A doctor's home: the patients who have shared their records, as a contact list, and the
 * selected patient's records as a wallet. Adding a record slides a form up as a sheet.
 */
export function DoctorHome() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const list = useApi<{ patients: Patient[] }>("/api/patients");
  const patients = list.data?.patients ?? [];
  const current = id ?? patients[0]?.id;
  const detail = useApi<{ patient: { id: string; name: string; email: string }; records: RecordMeta[] }>(current ? `/api/patients/${current}` : null);
  const loans = useApi<{ loans: LoanView[] }>("/api/loans");
  const now = useNow(5000);
  const lentToMe = (loans.data?.loans ?? []).filter((l) => l.expiresAt > now);
  const noEntries: AuditEntry[] = [];
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const shown = patients.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
      <section aria-labelledby="h-patients">
        <p className="eyebrow">{user?.name}</p>
        <h1 id="h-patients" className="display mt-2 text-[clamp(2.2rem,5vw,3.2rem)]">
          Your patients
        </h1>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-muted">Patients who put you on their care team. If they switch you off, they disappear from here at once.</p>
        {lentToMe.length > 0 && (
          <div className="mt-6">
            <p className="eyebrow text-amber">Lent to you</p>
            <ul className="mt-2.5 space-y-2" aria-label="Records lent to you">
              {lentToMe.map((l) => (
                <LoanTicket key={l.id} loan={l} entries={noEntries} perspective="doctor" />
              ))}
            </ul>
          </div>
        )}
        {patients.length > 3 && <input className="field mt-4" placeholder="Find a patient" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a patient" />}
        {list.error && (
          <div className="mt-4">
            <Notice tone="bad">{list.error}</Notice>
          </div>
        )}
        <ul className="mt-4 space-y-1.5">
          {shown.map((p) => (
            <li key={p.id}>
              <Link to={`/patients/${p.id}`} aria-current={p.id === current ? "page" : undefined} viewTransition className={`flex items-center gap-3 rounded-[18px] border p-3 transition-colors ${p.id === current ? "border-line-2 bg-panel" : "border-transparent hover:bg-panel/60"}`}>
                <Avatar name={p.name} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{p.name}</span>
                  <span className="block text-[13px] text-muted">
                    {p.records} record{p.records === 1 ? "" : "s"}, shared {date(p.grantedAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {list.data && !patients.length && <li className="rounded-[20px] border-2 border-dashed border-line p-6 text-center text-sm text-muted">No patients have shared their records with you yet.</li>}
        </ul>
      </section>

      <section aria-label="Records" className="min-w-0">
        {detail.data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar name={detail.data.patient.name} size={52} />
                <div>
                  <h2 className="text-[1.45rem] font-bold leading-tight tracking-tight">{detail.data.patient.name}</h2>
                  <p className="text-sm text-muted">{detail.data.patient.email}</p>
                </div>
              </div>
              <button className="btn btn-accent" onClick={() => setAdding(true)}>
                New record
              </button>
            </div>
            <div className="mt-6 max-w-xl">
              <Wallet records={detail.data.records} empty="No records yet. Add the first one." base={`/patients/${detail.data.patient.id}/records`} />
            </div>
          </>
        )}
        {detail.error && <Notice tone="bad">{detail.error}</Notice>}
      </section>

      {adding && current && (
        <Sheet label="New record" onClose={() => setAdding(false)} wide={false}>
          <NewRecord patientId={current} onCancel={() => setAdding(false)} onCreated={(r) => {
              setAdding(false);
              void detail.reload();
              void list.reload();
              nav(`/patients/${current}/records/${r.id}`);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

function NewRecord({ patientId, onCancel, onCreated }: { patientId: string; onCancel: () => void; onCreated: (r: RecordMeta) => void }) {
  const [f, setF] = useState({ title: "", diagnosis: "", notes: "", medications: "", bp: "", pulse: "", temperature: "", spo2: "" });
  const [scan, setScan] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const vitals = Object.fromEntries(
      Object.entries({ bp: f.bp || undefined, pulse: f.pulse ? Number(f.pulse) : undefined, temperature: f.temperature ? Number(f.temperature) : undefined, spo2: f.spo2 ? Number(f.spo2) : undefined }).filter(([, v]) => v !== undefined),
    );
    const record = { title: f.title, diagnosis: f.diagnosis, notes: f.notes, medications: f.medications.split("\n").map((m) => m.trim()).filter(Boolean), vitals };
    const fd = new FormData();
    fd.append("record", JSON.stringify(record));
    if (scan) fd.append("file", scan);
    try {
      const r = await api<{ record: RecordMeta }>(`/api/patients/${patientId}/records`, { method: "POST", body: fd });
      onCreated(r.record);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="pt-4">
      <p className="eyebrow">Seal a new card</p>
      <h2 className="display mt-2 pr-12 text-[2.2rem]">New record</h2>
      <p className="mt-1 text-sm text-muted">When you save, it is encrypted and sealed inside the scan's pixels. Only this patient's approved doctors can open it.</p>
      <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="md:col-span-2">
          <span className="label">Title</span>
          <input className="field mt-1.5" value={f.title} onChange={set("title")} placeholder="Chest X-ray: persistent cough" required minLength={2} maxLength={120} />
        </label>
        <label className="md:col-span-2">
          <span className="label">Diagnosis</span>
          <input className="field mt-1.5" value={f.diagnosis} onChange={set("diagnosis")} required minLength={2} maxLength={300} />
        </label>
        <label>
          <span className="label">Clinical notes</span>
          <textarea className="field mt-1.5 h-32" value={f.notes} onChange={set("notes")} maxLength={4000} />
        </label>
        <label>
          <span className="label">Medications (one per line)</span>
          <textarea className="field mt-1.5 h-32" value={f.medications} onChange={set("medications")} />
        </label>
        <div className="grid grid-cols-4 gap-3 md:col-span-2">
          {(
            [
              ["bp", "BP", "120/80"],
              ["pulse", "Pulse", "72"],
              ["temperature", "Temp °C", "36.8"],
              ["spo2", "SpO₂ %", "98"],
            ] as const
          ).map(([k, l, p]) => (
            <label key={k}>
              <span className="label">{l}</span>
              <input className="field mt-1.5" value={f[k]} onChange={set(k)} placeholder={p} inputMode={k === "bp" ? "text" : "decimal"} />
            </label>
          ))}
        </div>
        <label className="md:col-span-2">
          <span className="label">Scan (DICOM or PNG)</span>
          <input type="file" accept="image/png,.dcm,application/dicom" className="field mt-1.5 py-1.5" onChange={(e) => setScan(e.target.files?.[0] ?? null)} />
          <span className="mt-1 block text-xs text-faint">
            Uncompressed DICOM straight from the scanner (8 to 16-bit), or a PNG. Leave empty to use a synthetic CT phantom. The record is encrypted and hidden inside the pixels; for DICOM the patient&apos;s identifying details are moved out of the header and into the encrypted record.
          </span>
        </label>
        {error && (
          <div className="md:col-span-2">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
        <div className="md:col-span-2">
          <button className="btn btn-accent" disabled={busy}>
            {busy ? "Encrypting and embedding…" : "Encrypt and save"}
          </button>
          <button type="button" className="btn ml-2" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
