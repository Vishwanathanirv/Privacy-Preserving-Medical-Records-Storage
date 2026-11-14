import { PageHeader, Panel } from "../ui";

const STEPS = [
  { n: "1", t: "Encrypt", d: "The record is compressed and sealed with AES-256-GCM using a fresh 256-bit key made only for that record. That key is then sealed with the master key and kept in the database." },
  { n: "2", t: "Hide", d: "The ciphertext is hidden inside the scan with prediction-error expansion: each pixel is predicted from its four neighbours and the small prediction errors carry the bits. Works on 8-bit PNG and on 12–16-bit DICOM straight from the scanner, changing pixels by a level or two." },
  { n: "3", t: "Store", d: "Only the watermarked scan and the sealed key are stored. For DICOM, the patient's name, ID, birth date and other identifiers are removed from the file header and travel only inside the encrypted record." },
  { n: "4", t: "Open", d: "When an approved doctor opens it, the bits are extracted, the scan (for DICOM, the whole file) is restored exactly and the record is decrypted. Every access goes into a signed Merkle log the patient can verify." },
];

export function How() {
  return (
    <>
      <PageHeader title="How MedVault protects records" sub="Defence in depth: encryption, reversible watermarking, DICOM de-identification, patient consent and a signed transparency log." />
      <div className="grid gap-4 md:grid-cols-4">
        {STEPS.map((s) => (
          <div key={s.n} className="panel p-5">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-ink">{s.n}</div>
            <h2 className="mt-3 font-semibold">{s.t}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.d}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Why reversible watermarking?">
          <p className="p-5 text-sm leading-relaxed text-muted">
            Ordinary watermarking permanently changes the image, which is not acceptable for diagnosis. Reversible data hiding lets the record travel with the scan (when a file is copied, emailed or archived) and then gives back the exact original pixels. The same design is studied for DICOM integrity and telemedicine.
          </p>
        </Panel>
        <Panel title="Who can do what">
          <table className="w-full text-sm">
            <tbody>
              {[
                ["Patient", "Read own records, grant and revoke doctors, see every access"],
                ["Doctor", "Read and create records only for consenting patients"],
                ["Admin", "Manage accounts and verify the audit log. Cannot read records"],
              ].map(([r, d]) => (
                <tr key={r} className="border-t border-line first:border-0">
                  <td className="px-5 py-3 font-medium">{r}</td>
                  <td className="px-5 py-3 text-muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
