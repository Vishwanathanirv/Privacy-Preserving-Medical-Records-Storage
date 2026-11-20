import { useState } from "react";
import { fetchHead, verifyEntry, type HeadCheck } from "../translog";
import { ACTIONS, api, date, refresh, useApi, useAuth, useGo, type AuditEntry, type RecordMeta } from "../lib";
import { LoanTicket, useNow, type LoanView } from "../loans";
import { Avatar, Notice, Switch, Wallet } from "../ui";

type Doctor = { id: string; name: string; email: string };
type Grant = Doctor & { grantedAt: number };

/** A patient's home: the wallet itself, what is out on loan, who holds a key, and the trail of every access. */
export function PatientHome() {
  const { user } = useAuth();
  const go = useGo();
  const { data } = useApi<{ records: RecordMeta[] }>(user ? `/api/patients/${user.id}` : null);
  const grants = useApi<{ grants: Grant[] }>("/api/consent");
  const loans = useApi<{ loans: LoanView[] }>("/api/loans");
  const audit = useApi<{ entries: AuditEntry[] }>("/api/audit");
  const now = useNow(5000);
  const n = data?.records.length ?? 0;
  const out = (loans.data?.loans ?? []).filter((l) => !l.endedAt && l.expiresAt > now);
  const team = grants.data?.grants ?? [];

  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,27rem)_minmax(0,1fr)_minmax(0,23rem)]">
      <section aria-labelledby="h-wallet" className="min-w-0">
        <p className="eyebrow">Your wallet</p>
        <h1 id="h-wallet" className="display mt-2 text-[clamp(2.4rem,6vw,3.6rem)]">
          {user?.name.split(" ")[0]}&rsquo;s cards
        </h1>
        <p className="mt-3 text-[0.98rem] leading-relaxed text-muted">
          {data ? (
            <>
              {n} record{n === 1 ? "" : "s"}, each sealed inside its own scan. {out.length ? <span className="text-amber">{out.length} out on loan.</span> : "Nothing out on loan."} {team.length ? `${team.length} doctor${team.length === 1 ? "" : "s"} on your care team.` : "No care team yet."}
            </>
          ) : (
            <span className="skeleton inline-block h-4 w-64 align-middle" />
          )}
        </p>
        <div className="mt-7">
          {data ? (
            <Wallet records={data.records} empty="No records yet. They appear here when a doctor on your care team adds one." onLend={(r) => go(`/lend/${r.id}`)} lent={new Set(out.map((l) => l.recordId))} />
          ) : (
            <div className="space-y-[-7rem]">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-[11rem] rounded-[18px] border border-line" />)}</div>
          )}
        </div>
      </section>

      <div className="min-w-0 space-y-10">
        <section aria-labelledby="h-loans">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="eyebrow text-amber">Time-limited consent</p>
              <h2 id="h-loans" className="mt-1.5 text-[1.45rem] font-bold tracking-tight">
                Out on loan
              </h2>
            </div>
            {data && data.records.length > 0 && (
              <button className="btn btn-amber h-9 px-4 text-[13px]" onClick={() => go(`/lend/${data.records[0].id}`)}>
                Lend a card
              </button>
            )}
          </div>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">Lend one record to any doctor for minutes or days. It comes back by itself: when time is up, the key made for the loan is destroyed.</p>
          <ul className="mt-4 space-y-2.5">
            {(loans.data?.loans ?? []).slice(0, 6).map((l) => (
              <LoanTicket key={l.id} loan={l} entries={audit.data?.entries ?? []} perspective="patient" onChange={refresh} />
            ))}
            {loans.data && !loans.data.loans.length && <li className="rounded-[20px] border border-dashed border-line-2 p-5 text-center text-sm text-faint">Nothing lent yet.</li>}
            {!loans.data && <li className="skeleton h-[80px]" />}
          </ul>
        </section>
        <CareTeam grants={grants} />
      </div>

      <div className="min-w-0 lg:col-span-2 xl:col-span-1">
        <Trail entries={audit.data?.entries} />
      </div>
    </div>
  );
}

function CareTeam({ grants }: { grants: ReturnType<typeof useApi<{ grants: Grant[] }>> }) {
  const doctors = useApi<{ doctors: Doctor[] }>("/api/doctors");
  const [error, setError] = useState<string | null>(null);
  const granted = new Map((grants.data?.grants ?? []).map((g) => [g.id, g]));

  async function toggle(d: Doctor) {
    setError(null);
    try {
      grants.setData(await api<{ grants: Grant[] }>(`/api/consent/${d.id}`, { method: granted.has(d.id) ? "DELETE" : "PUT" }));
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section aria-labelledby="h-team">
      <p className="eyebrow">Standing consent</p>
      <h2 id="h-team" className="mt-1.5 text-[1.45rem] font-bold tracking-tight">
        Care team
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">Doctors who can open every card and add new ones. Switch one off and they lose access at once.</p>
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      <ul className="mt-3 divide-y divide-line rounded-[20px] border border-line bg-panel">
        {(doctors.data?.doctors ?? []).map((d) => {
          const g = granted.get(d.id);
          return (
            <li key={d.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={d.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{d.name}</div>
                <div className="text-[13px] text-faint">{g ? `Since ${date(g.grantedAt)}` : "No standing access"}</div>
              </div>
              <Switch on={Boolean(g)} onChange={() => toggle(d)} label={`Let ${d.name} open my records`} />
            </li>
          );
        })}
        {!doctors.data && <li className="skeleton m-3 h-12" />}
      </ul>
    </section>
  );
}

/** Every access to the patient's records, as a chain they can check against the signed log. */
function Trail({ entries }: { entries?: AuditEntry[] }) {
  const people = useApi<{ doctors: Doctor[] }>("/api/doctors");
  const { user } = useAuth();
  const [check, setCheck] = useState<HeadCheck | null>(null);
  const [proofs, setProofs] = useState<Record<number, "checking" | "ok" | "bad">>({});
  const name = (id: string) => (id === user?.id ? "You" : id === "system" ? "MedVault" : id === "responder" ? "A responder" : (people.data?.doctors.find((d) => d.id === id)?.name ?? id.slice(0, 8)));
  const doctorIn = (detail: string) => detail.match(/doctor:([0-9a-f-]{36})/)?.[1];

  async function verifyAll() {
    const c = await fetchHead();
    setCheck(c);
    for (const e of entries ?? []) {
      if (e.seq > c.info.head.size) continue;
      setProofs((p) => ({ ...p, [e.seq]: "checking" }));
      const ok = await verifyEntry(e, c).catch(() => false);
      setProofs((p) => ({ ...p, [e.seq]: ok ? "ok" : "bad" }));
    }
  }

  const verified = Object.values(proofs).filter((v) => v === "ok").length;
  const failed = Object.values(proofs).filter((v) => v === "bad").length;
  return (
    <section aria-labelledby="h-trail">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Tamper-evident</p>
          <h2 id="h-trail" className="mt-1.5 text-[1.45rem] font-bold tracking-tight">
            Access trail
          </h2>
        </div>
        <button className="btn h-9 px-3.5 text-[13px]" onClick={() => void verifyAll()}>
          Verify in my browser
        </button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">Each line is hashed into a signed Merkle log. Your browser checks the proofs itself; the server is not trusted to say “verified”.</p>
      {check && (
        <div className="mt-3">
          <Notice tone={check.signatureOk && !failed && check.keyPinned !== "changed" ? "ok" : "bad"}>
            {check.keyPinned === "changed"
              ? "The log's signing key is different from the one this browser saw before. Do not trust this log until the change is explained."
              : !check.signatureOk
                ? "The log's signature does not verify."
                : failed
                  ? `${failed} entr${failed === 1 ? "y is" : "ies are"} not in the signed log: what you are shown differs from what the log committed to.`
                  : `${verified} entries proven to be in the signed log of ${check.info.head.size} (key ${check.info.keyId}). Entries cannot be hidden from you or changed later.`}
          </Notice>
        </div>
      )}
      <ol className="mt-4 max-h-[40rem] overflow-y-auto rounded-[20px] border border-line bg-panel p-2" aria-label="Access trail entries">
        {(entries ?? []).map((e) => {
          const d = doctorIn(e.detail);
          const sos = e.action.startsWith("sos.");
          return (
            <li key={e.seq} className={`flex gap-3 rounded-[14px] px-3 py-2.5 text-sm ${sos ? "bg-coral-soft" : ""}`}>
              <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${sos ? "bg-coral" : e.action.startsWith("loan.") ? "bg-amber" : e.action === "record.denied" || e.action === "auth.failed" ? "bg-coral" : "bg-accent"}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{name(e.actor)}</span> <span className="text-muted">{(ACTIONS[e.action] ?? e.action).toLowerCase()}</span>
                {d && <span className="text-muted"> ({name(d)})</span>}
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-[10.5px] text-faint">
                  {date(e.ts)}
                  <span>#{e.seq}</span>
                  {proofs[e.seq] === "ok" && <span className="text-accent">✓ in log</span>}
                  {proofs[e.seq] === "bad" && <span className="text-coral">✗ not in log</span>}
                  {proofs[e.seq] === "checking" && <span>checking…</span>}
                </span>
              </span>
            </li>
          );
        })}
        {!entries && [0, 1, 2, 3].map((i) => <li key={i} className="skeleton m-2 h-10" />)}
      </ol>
    </section>
  );
}
