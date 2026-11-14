import { fetchHead, verifyEntry, type HeadCheck } from "../translog";
import { useState } from "react";
import { ACTIONS, api, date, useApi, useAuth, type AuditEntry, type RecordMeta } from "../lib";
import { Notice, PageHeader, Panel, RecordList } from "../ui";

type Doctor = { id: string; name: string; email: string };
type Grant = Doctor & { grantedAt: number };

export function MyRecords() {
  const { user } = useAuth();
  const { data } = useApi<{ records: RecordMeta[] }>(user ? `/api/patients/${user.id}` : null);
  return (
    <>
      <PageHeader title="My records" sub="Your records are encrypted inside your scans. Only you and doctors you approve can open them." />
      <Panel>{data && <RecordList records={data.records} empty="You don't have any records yet." />}</Panel>
    </>
  );
}

export function Consent() {
  const doctors = useApi<{ doctors: Doctor[] }>("/api/doctors");
  const grants = useApi<{ grants: Grant[] }>("/api/consent");
  const [error, setError] = useState<string | null>(null);
  const granted = new Map((grants.data?.grants ?? []).map((g) => [g.id, g]));

  async function toggle(d: Doctor) {
    setError(null);
    try {
      const r = await api<{ grants: Grant[] }>(`/api/consent/${d.id}`, { method: granted.has(d.id) ? "DELETE" : "PUT" });
      grants.setData(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Who can see my records" sub="Grant or revoke access at any time. Changes apply immediately and are recorded in your activity log." />
      {error && <Notice tone="bad">{error}</Notice>}
      <Panel>
        <ul className="divide-y divide-line">
          {(doctors.data?.doctors ?? []).map((d) => {
            const g = granted.get(d.id);
            return (
              <li key={d.id} className="flex items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-sm text-muted">{g ? `Has access since ${date(g.grantedAt)}` : "No access"}</div>
                </div>
                <button className={`btn ${g ? "btn-danger" : "btn-accent"}`} onClick={() => toggle(d)} aria-pressed={Boolean(g)}>
                  {g ? "Revoke access" : "Grant access"}
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}

export function Activity() {
  const { data } = useApi<{ entries: AuditEntry[] }>("/api/audit");
  const people = useApi<{ doctors: Doctor[] }>("/api/doctors");
  const { user } = useAuth();
  const [check, setCheck] = useState<HeadCheck | null>(null);
  const [proofs, setProofs] = useState<Record<number, "checking" | "ok" | "bad">>({});
  const name = (id: string) => (id === user?.id ? "You" : (people.data?.doctors.find((d) => d.id === id)?.name ?? id.slice(0, 8)));

  async function verifyAll() {
    const c = await fetchHead();
    setCheck(c);
    for (const e of data?.entries ?? []) {
      if (e.seq > c.info.head.size) continue;
      setProofs((p) => ({ ...p, [e.seq]: "checking" }));
      const ok = await verifyEntry(e, c).catch(() => false);
      setProofs((p) => ({ ...p, [e.seq]: ok ? "ok" : "bad" }));
    }
  }

  const verified = Object.values(proofs).filter((v) => v === "ok").length;
  const failed = Object.values(proofs).filter((v) => v === "bad").length;
  return (
    <>
      <PageHeader
        title="Activity on my records"
        sub="Every time someone opens your records, is refused, or your consent changes."
        action={
          <button className="btn" onClick={() => void verifyAll()}>
            Verify in my browser
          </button>
        }
      />
      {check && (
        <div className="mb-5">
          <Notice tone={check.signatureOk && !failed && check.keyPinned !== "changed" ? "ok" : "bad"}>
            {check.keyPinned === "changed"
              ? "The log's signing key is different from the one this browser saw before. Do not trust this log until the change is explained."
              : !check.signatureOk
                ? "The log's signature does not verify."
                : failed
                  ? `${failed} entr${failed === 1 ? "y is" : "ies are"} not in the signed log: what you are shown differs from what the log committed to.`
                  : `${verified} entries proven to be in the signed log of ${check.info.head.size} entries (key ${check.info.keyId}). Everyone is shown the same history: entries cannot be hidden from you or changed later.`}
          </Notice>
        </div>
      )}
      <Panel>
        <ul className="divide-y divide-line">
          {(data?.entries ?? []).map((e) => (
            <li key={e.seq} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
              <span>
                <span className="font-medium">{name(e.actor)}</span> <span className="text-muted">{(ACTIONS[e.action] ?? e.action).toLowerCase()}</span>
                {e.detail.startsWith("doctor:") && <span className="text-muted"> ({name(e.detail.slice(7))})</span>}
              </span>
              <span className="flex items-center gap-3 whitespace-nowrap text-xs text-faint">
                {proofs[e.seq] === "ok" && <span className="text-ok" title="Merkle inclusion proof verified against the signed tree head">✓ in log</span>}
                {proofs[e.seq] === "bad" && <span className="text-bad">✗ not in log</span>}
                {proofs[e.seq] === "checking" && <span>checking…</span>}
                {date(e.ts)}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
