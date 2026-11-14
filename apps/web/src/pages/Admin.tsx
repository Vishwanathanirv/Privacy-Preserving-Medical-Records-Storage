import { checkGrowth, fetchHead, type GrowthCheck, type HeadCheck } from "../translog";
import { useEffect, useState } from "react";
import { ACTIONS, api, date, short, useApi, type AuditEntry, type User } from "../lib";
import { Notice, PageHeader, Panel } from "../ui";

export function Users() {
  const { data, reload } = useApi<{ users: User[]; counts: Record<string, number> }>("/api/admin/users");
  const [f, setF] = useState({ name: "", email: "", role: "doctor", password: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/admin/users", { method: "POST", json: f });
      setMsg({ ok: true, text: `${f.name} can now sign in.` });
      setF({ name: "", email: "", role: "doctor", password: "" });
      void reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  return (
    <>
      <PageHeader title="Users" sub="Administrators manage accounts but cannot open medical records. That needs a patient's consent." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries(data?.counts ?? {}).map(([k, v]) => (
          <div key={k} className="panel p-4">
            <div className="label">{k.replace(/([A-Z])/g, " $1")}</div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Accounts">
          <table className="w-full text-sm">
            <tbody>
              {(data?.users ?? []).map((u) => (
                <tr key={u.id} className="border-t border-line first:border-0">
                  <td className="px-5 py-3 font-medium">{u.name}</td>
                  <td className="hidden px-2 py-3 text-muted sm:table-cell">{u.email}</td>
                  <td className="px-5 py-3 text-right">
                    <span className="rounded-full bg-panel-2 px-2.5 py-1 text-xs capitalize">{u.role}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Add a user">
          <form onSubmit={create} className="space-y-3 p-5">
            <input className="field" placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required aria-label="Full name" />
            <input className="field" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required aria-label="Email" />
            <select className="field" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} aria-label="Role">
              <option value="doctor">Doctor</option>
              <option value="patient">Patient</option>
              <option value="admin">Admin</option>
            </select>
            <input className="field" type="password" placeholder="Temporary password (10+ characters)" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required aria-label="Password" />
            <button className="btn btn-accent w-full">Create user</button>
            {msg && <Notice tone={msg.ok ? "ok" : "bad"}>{msg.text}</Notice>}
          </form>
        </Panel>
      </div>
    </>
  );
}

function TransparencyPanel() {
  const [state, setState] = useState<{ check: HeadCheck; growth: GrowthCheck } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const check = await fetchHead();
      setState({ check, growth: await checkGrowth(check) });
    })().catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!state) return null;
  const { check, growth } = state;
  const h = check.info.head;
  const ok = check.signatureOk && check.keyPinned !== "changed" && growth.consistent !== false;
  return (
    <Panel className="mb-5">
      <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto]">
        <div>
          <div className="label">Signed tree head · checked in this browser</div>
          <p className="mt-2 text-sm">
            {ok ? "✓ " : "✗ "}
            {!check.signatureOk
              ? "The signature on the log head does not verify."
              : check.keyPinned === "changed"
                ? "The signing key changed since this browser last looked."
                : growth.consistent === false
                  ? `The log seen on ${date(growth.previous!.timestamp)} (${growth.previous!.size} entries) is not a prefix of today's log. Past entries were rewritten or removed.`
                  : growth.consistent
                    ? `Since this browser's last check (${growth.previous!.size} entries, ${date(growth.previous!.timestamp)}), the log only grew: a consistency proof shows nothing earlier was changed.`
                    : "First check from this browser. The head is saved here, so the next visit can prove the log only grew."}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-faint">
            Entries are leaves of a Merkle tree (as in Certificate Transparency, RFC 9162). The log signs its size and root with Ed25519; patients can prove their own entries are included, and any two heads can be checked for append-only growth.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:text-right">
          <dt className="text-faint">Entries</dt>
          <dd className="font-mono">{h.size}</dd>
          <dt className="text-faint">Root</dt>
          <dd className="font-mono text-xs">{short(h.root)}</dd>
          <dt className="text-faint">Key</dt>
          <dd className="font-mono text-xs">{check.info.keyId}</dd>
        </dl>
      </div>
    </Panel>
  );
}

export function AuditLog() {
  const { data } = useApi<{ entries: AuditEntry[] }>("/api/audit");
  const v = useApi<{ ok: boolean; brokenAt: number | null; entries: number; head: string | null; transparency?: { headsChecked: number; firstBrokenHead: { size: number } | null } }>("/api/audit/verify");
  return (
    <>
      <PageHeader
        title="Audit log"
        sub="Each entry includes the SHA-256 hash of the one before it and is a leaf of a signed Merkle log, so editing or deleting any past entry is detected."
        action={
          <button className="btn" onClick={() => void v.reload()}>
            Verify chain
          </button>
        }
      />
      <TransparencyPanel />
      {v.data && (
        <div className="mb-5">
          <Notice tone={v.data.ok && !v.data.transparency?.firstBrokenHead ? "ok" : "bad"}>
            {v.data.ok ? `Chain intact: ${v.data.entries} entries verified. Head ${short(v.data.head ?? "")}.` : `Chain broken at entry #${v.data.brokenAt}. The log has been altered.`}
            {v.data.transparency && (v.data.transparency.firstBrokenHead ? ` The signed head for ${v.data.transparency.firstBrokenHead.size} entries no longer matches storage.` : ` All ${v.data.transparency.headsChecked} signed heads still match storage.`)}
          </Notice>
        </div>
      )}
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="label text-left">
                <th className="px-5 py-2.5 font-medium">#</th>
                <th className="px-2 py-2.5 font-medium">When</th>
                <th className="px-2 py-2.5 font-medium">Event</th>
                <th className="hidden px-2 py-2.5 font-medium md:table-cell">Target</th>
                <th className="px-5 py-2.5 font-medium">Hash</th>
              </tr>
            </thead>
            <tbody>
              {(data?.entries ?? []).map((e) => (
                <tr key={e.seq} className="border-t border-line">
                  <td className="px-5 py-2.5 font-mono text-xs text-faint">{e.seq}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-muted">{date(e.ts)}</td>
                  <td className="px-2 py-2.5">{ACTIONS[e.action] ?? e.action}</td>
                  <td className="hidden max-w-56 truncate px-2 py-2.5 font-mono text-xs text-muted md:table-cell">{e.target}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-faint">{e.hash.slice(0, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
