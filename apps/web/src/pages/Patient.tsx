import { fetchHead, verifyEntry, type HeadCheck } from "../translog";
import { useState } from "react";
import { ACTIONS, api, date, useApi, useAuth, type AuditEntry, type RecordMeta } from "../lib";
import { Avatar, Notice, Panel, Switch, Wallet } from "../ui";

type Doctor = { id: string; name: string; email: string };
type Grant = Doctor & { grantedAt: number };

/** A patient's home: their records, who can open them, and everything that happened. */
export function PatientHome() {
  const { user } = useAuth();
  const { data } = useApi<{ records: RecordMeta[] }>(user ? `/api/patients/${user.id}` : null);
  const grants = useApi<{ grants: Grant[] }>("/api/consent");
  const n = data?.records.length ?? 0;
  const g = grants.data?.grants.length ?? 0;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)_minmax(0,22rem)]">
      <section aria-labelledby="h-records">
        <h1 id="h-records" className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
          Hello, {user?.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-[0.95rem] text-muted">
          {data ? `${n} record${n === 1 ? "" : "s"} sealed inside ${n === 1 ? "its scan" : "their scans"}. ${g ? `${g} doctor${g === 1 ? "" : "s"} can open them.` : "No doctor can open them right now."}` : "Opening your wallet…"}
        </p>
        <div className="mt-5">{data && <Wallet records={data.records} empty="You don't have any records yet. They appear here when a doctor you trust adds one." />}</div>
      </section>
      <Consent grants={grants} />
      <div className="lg:col-span-2 xl:col-span-1">
        {/* Remounts when consent changes, so the new entry shows up straight away. */}
        <Activity key={(grants.data?.grants ?? []).map((x) => x.id).join(",")} />
      </div>
    </div>
  );
}

export function Consent({ grants }: { grants: ReturnType<typeof useApi<{ grants: Grant[] }>> }) {
  const doctors = useApi<{ doctors: Doctor[] }>("/api/doctors");
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
    <Panel title="Who can open my records" className="self-start">
      <p className="px-5 text-sm text-muted">Switch a doctor off and they lose access at once. Every change is logged.</p>
      {error && (
        <div className="px-5 pt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      <ul className="mt-2 px-2 pb-3">
        {(doctors.data?.doctors ?? []).map((d) => {
          const g = granted.get(d.id);
          return (
            <li key={d.id} className="flex items-center gap-3 rounded-[18px] px-3 py-3 hover:bg-panel-2">
              <Avatar name={d.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{d.name}</div>
                <div className="text-[13px] text-muted">{g ? `Can open them since ${date(g.grantedAt)}` : "Can't open them"}</div>
              </div>
              <Switch on={Boolean(g)} onChange={() => toggle(d)} label={`Let ${d.name} open my records`} />
            </li>
          );
        })}
      </ul>
    </Panel>
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
    <Panel
      title="Activity"
      action={
        <button className="btn h-8 px-3 text-[13px]" onClick={() => void verifyAll()}>
          Verify in my browser
        </button>
      }
    >
      <p className="px-5 text-sm text-muted">Every time someone opens your records, is refused, or your consent changes.</p>
      {check && (
        <div className="px-5 pt-3">
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
      <ul className="mt-2 max-h-[34rem] overflow-y-auto px-2 pb-3">
          {(data?.entries ?? []).map((e) => (
            <li key={e.seq} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 rounded-[14px] px-3 py-2.5 text-sm hover:bg-panel-2">
              <span className="min-w-0">
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
  );
}
