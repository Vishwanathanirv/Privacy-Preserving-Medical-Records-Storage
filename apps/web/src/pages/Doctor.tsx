import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, date, useApi, type RecordMeta } from "../lib";
import { Notice, PageHeader, Panel, RecordList } from "../ui";

type Patient = { id: string; name: string; email: string; grantedAt: number; records: number };

export function Patients() {
  const { data, error } = useApi<{ patients: Patient[] }>("/api/patients");
  return (
    <>
      <PageHeader title="My patients" sub="Only patients who have granted you access appear here. If a patient revokes consent, they disappear immediately." />
      {error && <Notice tone="bad">{error}</Notice>}
      <Panel>
        {data?.patients.length ? (
          <ul className="divide-y divide-line">
            {data.patients.map((p) => (
              <li key={p.id}>
                <Link to={`/patients/${p.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-panel-2">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{p.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-sm text-muted">
                      {p.records} record{p.records === 1 ? "" : "s"} · access since {date(p.grantedAt)}
                    </div>
                  </div>
                  <span className="text-sm text-muted">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted">No patients have shared their records with you yet.</p>
        )}
      </Panel>
    </>
  );
}

export function PatientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, error } = useApi<{ patient: { id: string; name: string; email: string }; records: RecordMeta[] }>(`/api/patients/${id}`);
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader back={{ to: "/", label: "Patients" }} title={data?.patient.name ?? "Patient"} sub={data?.patient.email} action={<button className="btn btn-accent" onClick={() => setOpen(true)}>New record</button>} />
      {error && <Notice tone="bad">{error}</Notice>}
      {open && id && <NewRecord patientId={id} onCancel={() => setOpen(false)} onCreated={(r) => nav(`/records/${r.id}`)} />}
      <Panel title="Records">{data && <RecordList records={data.records} empty="No records yet." />}</Panel>
    </>
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
    <Panel title="New record" className="mb-6" action={<button className="text-sm text-muted hover:text-ink" onClick={onCancel}>Cancel</button>}>
      <form onSubmit={submit} className="grid gap-4 p-5 md:grid-cols-2">
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
          <span className="label">Scan (8-bit PNG)</span>
          <input type="file" accept="image/png" className="field mt-1.5 py-1.5" onChange={(e) => setScan(e.target.files?.[0] ?? null)} />
          <span className="mt-1 block text-xs text-faint">Leave empty to use a synthetic CT phantom. The record is encrypted and hidden inside this image; nothing else is stored.</span>
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
        </div>
      </form>
    </Panel>
  );
}
