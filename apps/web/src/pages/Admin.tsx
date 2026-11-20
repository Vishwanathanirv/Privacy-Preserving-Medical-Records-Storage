import { checkGrowth, fetchHead, type GrowthCheck, type HeadCheck } from "../translog";
import { useEffect, useState } from "react";
import { ACTIONS, api, date, short, useApi, type AuditEntry, type User } from "../lib";
import { Avatar, Notice } from "../ui";

type Verify = { ok: boolean; brokenAt: number | null; entries: number; head: string | null; transparency?: { headsChecked: number; firstBrokenHead: { size: number } | null } };

/**
 * The administrator's one screen, a ledger: the people on the left, and the audit log as what it
 * is, a chain of blocks each holding the hash of the one before. Admins can check every link and
 * the signed head, and cannot open a single record.
 */
export function AdminHome() {
  const users = useApi<{ users: User[]; counts: Record<string, number> }>("/api/admin/users");
  const c = users.data?.counts;
  return (
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="eyebrow">Run the vault</p>
        <h1 className="display mt-2 text-[clamp(2.4rem,6vw,3.6rem)]">The ledger</h1>
        <p className="mt-3 leading-relaxed text-muted">{c ? `${c.users} people, ${c.records} sealed records, ${c.auditEntries} entries in the signed log.` : <span className="skeleton inline-block h-4 w-56 align-middle" />}</p>
        <p className="mt-4 rounded-[16px] border border-line bg-panel p-3.5 text-sm leading-relaxed text-muted">
          Separation of duties: you manage people and can check every entry, but <b className="text-ink">cannot open a single record</b>. That takes a patient's consent.
        </p>
        <People data={users.data?.users} reload={users.reload} />
      </div>
      <Chain />
    </div>
  );
}

function People({ data, reload }: { data?: User[]; reload: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", email: "", role: "doctor", password: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/admin/users", { method: "POST", json: f });
      setMsg({ ok: true, text: `${f.name} can now sign in.` });
      setF({ name: "", email: "", role: "doctor", password: "" });
      setAdding(false);
      void reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  return (
    <section className="mt-8" aria-labelledby="h-people">
      <div className="flex items-center justify-between">
        <h2 id="h-people" className="text-[1.2rem] font-bold tracking-tight">
          People
        </h2>
        <button className="btn h-8 px-3 text-[13px]" onClick={() => setAdding(!adding)} aria-expanded={adding}>
          {adding ? "Cancel" : "Add a person"}
        </button>
      </div>
      {adding && (
        <form onSubmit={create} className="fade mt-3 space-y-2.5 rounded-[18px] border border-line bg-panel p-3.5">
          <input className="field" placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required aria-label="Full name" />
          <input className="field" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required aria-label="Email" />
          <div className="flex gap-1.5" role="radiogroup" aria-label="Role">
            {["doctor", "patient", "admin"].map((r) => (
              <button key={r} type="button" role="radio" aria-checked={f.role === r} onClick={() => setF({ ...f, role: r })} className={`h-9 flex-1 rounded-full border text-[13px] font-semibold capitalize ${f.role === r ? "border-accent bg-accent-soft text-accent" : "border-line-2 text-muted"}`}>
                {r}
              </button>
            ))}
          </div>
          <input className="field" type="password" placeholder="Temporary password (10+ characters)" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required aria-label="Password" />
          <button className="btn btn-accent w-full">Create</button>
        </form>
      )}
      {msg && (
        <div className="mt-3">
          <Notice tone={msg.ok ? "ok" : "bad"}>{msg.text}</Notice>
        </div>
      )}
      {(["doctor", "patient", "admin"] as const).map((role) => (
        <div key={role} className="mt-5">
          <div className="eyebrow">{role}s</div>
          <ul className="mt-2 space-y-1">
            {(data ?? []).filter((u) => u.role === role).map((u) => (
              <li key={u.id} className="flex items-center gap-3 rounded-[14px] px-2 py-1.5 hover:bg-panel">
                <Avatar name={u.name} size={30} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{u.name}</span>
                  <span className="block truncate text-[12px] text-faint">{u.email}</span>
                </span>
              </li>
            ))}
            {!data && <li className="skeleton h-10" />}
          </ul>
        </div>
      ))}
    </section>
  );
}

function SignedHead() {
  const [state, setState] = useState<{ check: HeadCheck; growth: GrowthCheck } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const check = await fetchHead();
      setState({ check, growth: await checkGrowth(check) });
    })().catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!state) return <div className="skeleton h-28" />;
  const { check, growth } = state;
  const h = check.info.head;
  const ok = check.signatureOk && check.keyPinned !== "changed" && growth.consistent !== false;
  return (
    <div className={`rounded-[20px] border p-4 ${ok ? "border-accent/25 bg-accent-soft" : "border-coral/40 bg-coral-soft"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="eyebrow">Signed tree head · checked in this browser</div>
        <div className="font-mono text-[11px] text-faint">
          size {h.size} · root {short(h.root)} · key {check.info.keyId}
        </div>
      </div>
      <p className={`mt-2 text-sm ${ok ? "text-ink" : "text-coral"}`}>
        {ok ? "✓ " : "✗ "}
        {!check.signatureOk
          ? "The signature on the log head does not verify."
          : check.keyPinned === "changed"
            ? "The signing key changed since this browser last looked."
            : growth.consistent === false
              ? `The log seen on ${date(growth.previous!.timestamp)} (${growth.previous!.size} entries) is not a prefix of today's. Past entries were rewritten or removed.`
              : growth.consistent
                ? `Since this browser's last check (${growth.previous!.size} entries), the log only grew: a consistency proof shows nothing earlier changed.`
                : "First check from this browser. The head is kept here, so the next visit can prove the log only grew."}
      </p>
    </div>
  );
}

/** The audit log drawn as a chain: each block names the previous block's hash. */
function Chain() {
  const { data } = useApi<{ entries: AuditEntry[] }>("/api/audit");
  const people = useApi<{ users: User[] }>("/api/admin/users");
  const [v, setV] = useState<Verify | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const names = new Map((people.data?.users ?? []).map((u) => [u.id, u.name]));
  const who = (id: string) => names.get(id) ?? (id === "system" ? "MedVault" : id === "responder" ? "A responder" : id.includes("@") ? id : id.slice(0, 8));
  const about = (target: string) => {
    const [kind, id] = target.split(":");
    if ((kind === "user" || kind === "patient") && id && names.has(id)) return names.get(id)!;
    if (kind === "record" && id) return `record ${id.slice(0, 8)}`;
    return target;
  };
  const broken = v && !v.ok ? v.brokenAt : null;

  async function verify() {
    setBusy(true);
    try {
      setV(await api<Verify>("/api/audit/verify"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="h-chain" className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Hash chain + RFC 9162 Merkle log</p>
          <h2 id="h-chain" className="mt-1.5 text-[1.45rem] font-bold tracking-tight">
            Audit log
          </h2>
        </div>
        <button className="btn btn-accent" disabled={busy} onClick={() => void verify()}>
          {busy ? "Verifying…" : "Verify chain"}
        </button>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Each block holds the SHA-256 of the one before it and is a leaf of a Merkle tree whose head is signed with Ed25519. Edit or delete any past block and every link after it breaks.</p>
      <div className="mt-4">
        <SignedHead />
      </div>
      {v && (
        <div className="mt-3" role="status">
          <Notice tone={v.ok && !v.transparency?.firstBrokenHead ? "ok" : "bad"}>
            {v.ok ? `Chain intact: ${v.entries} entries verified. Head ${short(v.head ?? "")}.` : `Chain broken at entry #${v.brokenAt}. The log has been altered.`}
            {v.transparency && (v.transparency.firstBrokenHead ? ` The signed head for ${v.transparency.firstBrokenHead.size} entries no longer matches storage.` : ` All ${v.transparency.headsChecked} signed heads still match storage.`)}
          </Notice>
        </div>
      )}
      <ol className="mt-6" aria-label="Audit log blocks, newest first">
        {(data?.entries ?? []).map((e, i) => {
          const bad = broken !== null && e.seq >= broken;
          const tone = e.action.startsWith("sos.open") || e.action.endsWith("failed") || e.action.endsWith("denied") ? "bg-coral" : e.action.startsWith("loan.") ? "bg-amber" : "bg-accent";
          return (
            <li key={e.seq} className="relative pl-10">
              {/* The link to the previous block. */}
              {i < (data?.entries.length ?? 0) - 1 && <span className={`absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px ${bad ? "bg-coral" : "bg-line-2"}`} aria-hidden />}
              <span className={`absolute left-0 top-1.5 grid h-8 w-8 place-items-center rounded-[10px] border font-mono text-[10.5px] ${bad ? "border-coral text-coral" : "border-line-2 bg-panel text-muted"}`}>{e.seq}</span>
              <button onClick={() => setOpen(open === e.seq ? null : e.seq)} aria-expanded={open === e.seq} className="mb-2 w-full rounded-[16px] border border-transparent px-3 py-2 text-left transition-colors hover:border-line hover:bg-panel">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${tone}`} aria-hidden />
                  <span className="font-medium">{ACTIONS[e.action] ?? e.action}</span>
                  <span className="text-sm text-muted">
                    {who(e.actor)}
                    {about(e.target) !== who(e.actor) && ` → ${about(e.target)}`}
                  </span>
                  <span className="ml-auto font-mono text-[10.5px] text-faint">{date(e.ts)}</span>
                </span>
                <span className="mt-1 block font-mono text-[10.5px] text-faint">
                  prev {e.prevHash.slice(0, 10)} · hash <span className={bad ? "text-coral" : "text-accent"}>{e.hash.slice(0, 10)}</span>
                </span>
                {open === e.seq && (
                  <span className="fade mt-2 block break-all rounded-[10px] bg-bg p-2.5 font-mono text-[10.5px] leading-relaxed text-muted">
                    actor {e.actor}
                    <br />
                    target {e.target}
                    {e.detail && (
                      <>
                        <br />
                        detail {e.detail}
                      </>
                    )}
                    <br />
                    prev {e.prevHash}
                    <br />
                    hash {e.hash}
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {!data && [0, 1, 2, 3].map((i) => <li key={i} className="skeleton mb-2 ml-10 h-14" />)}
      </ol>
    </section>
  );
}
