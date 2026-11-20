import { useState } from "react";
import { api, date, downloadRecordFile, short, useApi, useAuth, useGo, useRecordImage, type Clinical, type ImageVariant, type RecordMeta } from "../lib";
import { left, useNow } from "../loans";
import { Check, Notice, PageHeader, Panel } from "../ui";

type Opened = { meta: RecordMeta; record: Clinical; verification: { fileIntact: boolean; restoredExact: boolean; layers: number }; loan: { id: string; expiresAt: number } | null };
type Tamper = { detected: boolean; changedPixel: { x: number; y: number }; stage?: string; message: string };

const VIEWS = [
  { v: "stego", t: "Stored image", d: "What is saved and shared. The encrypted record is inside these pixels." },
  { v: "original", t: "Restored scan", d: "Recovered exactly from the stored image after the record is extracted." },
  { v: "diff", t: "Changed pixels", d: "White = pixels the embedding changed, each by only a few levels. Invisible to the eye." },
] as const;

export function RecordView({ id }: { id: string }) {
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

  if (error)
    return (
      <div className="pt-6">
        <Notice tone="bad">{error}</Notice>
      </div>
    );
  if (!data)
    return (
      <div className="grid gap-5 pt-6 lg:grid-cols-2" aria-busy="true" aria-label="Decrypting">
        <div className="skeleton aspect-square" />
        <div className="space-y-4">
          <div className="skeleton h-10 w-3/4" />
          <div className="skeleton h-40" />
          <div className="skeleton h-32" />
        </div>
      </div>
    );
  const { meta, record, verification } = data;
  const s = meta.stats;
  const dicom = meta.scan?.format === "dicom";
  const depth = meta.scan?.bitDepth ?? 8;

  return (
    <>
      <div className="pr-12 pt-3">
        <PageHeader title={record.title} sub={`${record.author}, ${date(record.createdAt)}`} action={<PatientLend id={meta.id} />} />
      </div>
      {data.loan && <LoanBanner expiresAt={data.loan.expiresAt} />}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <Panel className="self-start overflow-hidden lg:sticky lg:top-4">
          <div className="m-3 mb-0 flex gap-1 rounded-full bg-panel-2 p-1" role="tablist">
            {VIEWS.map((x) => (
              <button key={x.v} role="tab" aria-selected={view === x.v} onClick={() => setView(x.v)} className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-semibold ${view === x.v ? "bg-panel text-ink shadow-[var(--shadow)]" : "text-muted hover:text-ink"}`}>
                {x.t}
              </button>
            ))}
          </div>
          <div className="p-4">
            <RecordImage key={view} meta={meta} variant={view} />
            <p className="mt-3 text-sm text-muted">{VIEWS.find((x) => x.v === view)!.d}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn" onClick={() => void downloadRecordFile(meta.id, "stored")}>
                Download stored {dicom ? "DICOM" : "image"}
              </button>
              {dicom && (
                <button className="btn" onClick={() => void downloadRecordFile(meta.id, "original")} title="Rebuilt from the stored file and the encrypted record; logged">
                  Download original DICOM
                </button>
              )}
              <label className="btn cursor-pointer">
                Verify a file…
                <input type="file" accept="image/png,.dcm,application/dicom" className="hidden" onChange={(e) => e.target.files?.[0] && runVerify(e.target.files[0])} />
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
            <dl className="space-y-4 px-5 pb-5 pt-3 text-sm">
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
                    <div key={k} className="rounded-[14px] bg-panel-2 p-2.5 text-center">
                      <div className="text-xs text-faint">{k}</div>
                      <div className="mt-0.5 font-medium tabular-nums">{v || "–"}</div>
                    </div>
                  ))}
                </div>
              )}
            </dl>
          </Panel>

          <Panel title="Security checks">
            <ul className="space-y-2.5 px-5 pb-5 pt-3">
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
            <dl className="grid grid-cols-2 gap-3 px-5 pb-5 pt-3 text-sm sm:grid-cols-3">
              {[
                ["PSNR", `${s.psnr} dB`, "above 40 dB is invisible"],
                ["SSIM", s.ssim.toFixed(4), "1.0 = identical"],
                ["Max change", `±${s.maxPixelChange}`, dicom && meta.scan?.rescale?.slope === 1 ? "HU (stored values)" : `of ${2 ** depth - 1} levels`],
                ["Payload", `${(s.payloadBytes / 1024).toFixed(1)} KB`, "encrypted record"],
                ["Density", `${s.bitsPerPixel} bpp`, `${s.layers} layer${s.layers > 1 ? "s" : ""}${s.thresholds && Math.max(...s.thresholds) > 1 ? `, T=${s.thresholds.join("/")}` : ""}`],
                ["Embed time", `${s.embedMs} ms`, `${meta.width}×${meta.height}`],
              ].map(([k, v, h]) => (
                <div key={k} className="rounded-[14px] bg-panel-2 p-3">
                  <dt className="text-xs text-faint">{k}</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{v}</dd>
                  <dd className="text-[11px] text-faint">{h}</dd>
                </div>
              ))}
            </dl>
            {meta.scan && (
              <div className="mx-5 mb-4 rounded-[14px] border border-line p-3 text-sm">
                <div className="font-medium">
                  {dicom ? `DICOM ${meta.scan.modality ?? ""}` : "PNG"}, {depth}-bit, {meta.width}×{meta.height}
                </div>
                {dicom && meta.scan.removedFields?.length ? (
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Removed from the stored file and kept only inside the encrypted record: {meta.scan.removedFields.join(", ")}. The original file, header included, is rebuilt byte for byte on download.
                  </p>
                ) : null}
              </div>
            )}
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

const VARIANT_TAG: Record<ImageVariant, string> = { stego: "STORED  watermarked", original: "RESTORED  bit-exact", diff: "DIFFERENCE  x255" };

/** The scan on film, with scanner-style text in its corners, the way a radiologist sees it. */
function RecordImage({ meta, variant }: { meta: RecordMeta; variant: ImageVariant }) {
  const src = useRecordImage(meta.id, variant);
  const alt = VIEWS.find((x) => x.v === variant)!.t;
  const s = meta.stats;
  const modality = meta.scan?.format === "dicom" ? `DICOM ${meta.scan.bitDepth ?? 16}-bit` : "PNG 8-bit";
  return (
    <div className="film aspect-square w-full overflow-hidden">
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-contain" style={{ imageRendering: variant === "diff" ? "pixelated" : undefined }} />
      ) : (
        <div className="h-full w-full animate-pulse" aria-label={`Loading ${alt.toLowerCase()}`} />
      )}
      {src && variant === "original" && <div className="scanline" aria-hidden />}
      <div className="overlay left-4 top-3">
        MEDVAULT
        <br />
        {meta.title.length > 24 ? `${meta.title.slice(0, 23)}…` : meta.title}
        <br />
        ID {meta.id.slice(0, 8)}
      </div>
      <div className="overlay right-3 top-3 text-right">
        {new Date(meta.createdAt).toLocaleDateString("en-CA")}
        <br />
        {modality}
        <br />
        {meta.width}x{meta.height}
      </div>
      <div className="overlay bottom-3 left-4">{VARIANT_TAG[variant]}</div>
      <div className="overlay bottom-3 right-3 text-right">
        AES-256-GCM {(s.payloadBytes / 1024).toFixed(1)} KB
        <br />
        PSNR {s.psnr.toFixed(1)} dB
      </div>
    </div>
  );
}

/** For the patient who owns the record: lend it from here. */
function PatientLend({ id }: { id: string }) {
  const { user } = useAuth();
  const go = useGo();
  if (user?.role !== "patient") return null;
  return (
    <button className="btn btn-amber" onClick={() => go(`/lend/${id}`)}>
      Lend this card
    </button>
  );
}

/** For a doctor reading through a loan: how long is left. When it ends, the record is gone. */
function LoanBanner({ expiresAt }: { expiresAt: number }) {
  const now = useNow();
  const ms = expiresAt - now;
  return (
    <div role="status" className={`mb-5 flex items-center gap-3 rounded-[18px] border px-4 py-3 text-sm ${ms > 0 ? "border-amber/40 bg-amber-soft text-amber" : "border-coral/40 bg-coral-soft text-coral"}`}>
      <span className="h-2 w-2 flex-none rounded-full bg-current" aria-hidden />
      {ms > 0 ? (
        <span>
          Lent to you. Access ends in <b className="tnum">{left(ms)}</b>, then the loan's key is destroyed and this record closes.
        </span>
      ) : (
        <span>The loan has ended and its key was destroyed. Close this record: it can no longer be opened.</span>
      )}
    </div>
  );
}
