import { useState } from "react";
import { useParams } from "react-router";
import { api, date, short, useApi, useAuth, type Clinical, type RecordMeta } from "../lib";
import { Check, Notice, PageHeader, Panel } from "../ui";

type Opened = { meta: RecordMeta; record: Clinical; verification: { fileIntact: boolean; restoredExact: boolean; layers: number } };
type Tamper = { detected: boolean; changedPixel: { x: number; y: number }; stage?: string; message: string };

const VIEWS = [
  { v: "stego", t: "Stored image", d: "What is saved and shared. The encrypted record is inside these pixels." },
  { v: "original", t: "Restored scan", d: "Recovered exactly from the stored image after the record is extracted." },
  { v: "diff", t: "Changed pixels", d: "White = pixels that differ by 1 or 2 levels out of 255. Invisible to the eye." },
] as const;

export function RecordView() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error } = useApi<Opened>(`/api/records/${id}`);
  const [view, setView] = useState<(typeof VIEWS)[number]["v"]>("stego");
  const [tamper, setTamper] = useState<Tamper | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; text: string } | null>(null);

  async function runTamper() {
    setTamper(await api<Tamper>(`/api/records/${id}/tamper-test`, { method: "POST" }));
  }

  async function runVerify(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api<{ recordId: string; title: string; verification: Opened["verification"] }>("/api/verify", { method: "POST", body: fd });
      const ok = r.verification.fileIntact && r.verification.restoredExact;
      setVerify({ ok, text: ok ? `Authentic: this image carries "${r.title}" and is unmodified.` : `This image carries "${r.title}", but it has been modified since it was saved.` });
    } catch (e) {
      setVerify({ ok: false, text: (e as Error).message });
    }
  }

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <p className="text-muted">Decrypting…</p>;
  const { meta, record, verification } = data;
  const s = meta.stats;

  return (
    <>
      <PageHeader back={user?.role === "doctor" ? { to: `/patients/${meta.patientId}`, label: "Patient" } : { to: "/", label: "My records" }} title={record.title} sub={`${record.author} · ${date(record.createdAt)}`} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <Panel className="self-start lg:sticky lg:top-20">
          <div className="flex gap-1 border-b border-line p-2" role="tablist">
            {VIEWS.map((x) => (
              <button key={x.v} role="tab" aria-selected={view === x.v} onClick={() => setView(x.v)} className={`flex-1 rounded-lg px-3 py-2 text-sm ${view === x.v ? "bg-panel-2 font-medium" : "text-muted hover:text-ink"}`}>
                {x.t}
              </button>
            ))}
          </div>
          <div className="p-4">
            <img key={view} src={`/api/records/${meta.id}/image/${view}`} alt={VIEWS.find((x) => x.v === view)!.t} className="aspect-square w-full rounded-xl bg-black object-contain" style={{ imageRendering: view === "diff" ? "pixelated" : undefined }} />
            <p className="mt-3 text-sm text-muted">{VIEWS.find((x) => x.v === view)!.d}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a className="btn" href={`/api/records/${meta.id}/image/stego?download=1`}>
                Download stored image
              </a>
              <label className="btn cursor-pointer">
                Verify an image…
                <input type="file" accept="image/png" className="hidden" onChange={(e) => e.target.files?.[0] && runVerify(e.target.files[0])} />
              </label>
            </div>
            {verify && (
              <div className="mt-3">
                <Notice tone={verify.ok ? "ok" : "bad"}>{verify.text}</Notice>
              </div>
            )}
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel title="Clinical record">
            <dl className="space-y-4 p-5 text-sm">
              <div>
                <dt className="label">Diagnosis</dt>
                <dd className="mt-1 text-base">{record.diagnosis}</dd>
              </div>
              {record.notes && (
                <div>
                  <dt className="label">Notes</dt>
                  <dd className="mt-1 leading-relaxed text-muted">{record.notes}</dd>
                </div>
              )}
              {record.medications.length > 0 && (
                <div>
                  <dt className="label">Medications</dt>
                  <dd className="mt-1">
                    <ul className="list-disc space-y-0.5 pl-5">
                      {record.medications.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {record.vitals && Object.keys(record.vitals).length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {[
                    ["BP", record.vitals.bp],
                    ["Pulse", record.vitals.pulse && `${record.vitals.pulse}`],
                    ["Temp", record.vitals.temperature && `${record.vitals.temperature}°C`],
                    ["SpO₂", record.vitals.spo2 && `${record.vitals.spo2}%`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-panel-2 p-2.5 text-center">
                      <div className="text-xs text-faint">{k}</div>
                      <div className="mt-0.5 font-medium tabular-nums">{v || "–"}</div>
                    </div>
                  ))}
                </div>
              )}
            </dl>
          </Panel>

          <Panel title="Security checks">
            <ul className="space-y-2.5 p-5">
              <Check ok>Decrypted with AES-256-GCM using this record's own key (authenticity verified)</Check>
              <Check ok={verification.fileIntact}>Stored image matches its SHA-256 fingerprint</Check>
              <Check ok={verification.restoredExact}>Restored scan is bit-for-bit identical to the original</Check>
              <Check ok>Access allowed by the patient's consent, and logged</Check>
            </ul>
            <div className="border-t border-line p-5">
              <button className="btn" onClick={runTamper}>
                Run tamper test
              </button>
              <p className="mt-2 text-xs text-faint">Changes one pixel in a copy of the stored image and tries to open it.</p>
              {tamper && (
                <div className="mt-3">
                  <Notice tone={tamper.detected ? "ok" : "bad"}>
                    {tamper.detected ? "Caught. " : ""}
                    {tamper.message} (pixel {tamper.changedPixel.x}, {tamper.changedPixel.y}{tamper.stage ? `, detected at the ${tamper.stage} stage` : ""}).
                  </Notice>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Watermark quality">
            <dl className="grid grid-cols-3 gap-3 p-5 text-sm">
              {[
                ["PSNR", `${s.psnr} dB`, "above 40 dB is invisible"],
                ["SSIM", s.ssim.toFixed(4), "1.0 = identical"],
                ["Max change", `±${s.maxPixelChange}`, "grey levels"],
                ["Payload", `${(s.payloadBytes / 1024).toFixed(1)} KB`, "encrypted record"],
                ["Density", `${s.bitsPerPixel} bpp`, `${s.layers} layer${s.layers > 1 ? "s" : ""}`],
                ["Embed time", `${s.embedMs} ms`, `${meta.width}×${meta.height}`],
              ].map(([k, v, h]) => (
                <div key={k} className="rounded-lg bg-panel-2 p-3">
                  <dt className="text-xs text-faint">{k}</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{v}</dd>
                  <dd className="text-[11px] text-faint">{h}</dd>
                </div>
              ))}
            </dl>
            <p className="px-5 pb-5 font-mono text-[11px] leading-relaxed text-faint">
              original sha256 {short(meta.originalSha256)}
              <br />
              stored sha256 {short(meta.stegoSha256)}
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
