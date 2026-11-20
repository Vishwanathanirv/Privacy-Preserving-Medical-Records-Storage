import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import { AuthProvider, DEMO, refresh, useApi, useAuth, useGo, type RecordMeta } from "./lib";
import { LendForm } from "./loans";
import { Login } from "./pages/Login";
import { DoctorHome } from "./pages/Doctor";
import { RecordView } from "./pages/Record";
import { PatientHome } from "./pages/Patient";
import { AdminHome } from "./pages/Admin";
import { How } from "./pages/How";
import { Palette, openPalette, type Command } from "./palette";
import { Avatar, Mark, Sheet } from "./ui";

const ROLE_NAME = { doctor: "Doctor", patient: "Patient", admin: "Administrator" } as const;

/** Everything that isn't the home screen lives behind your avatar or the command palette. */
function AccountMenu() {
  const { user, logout } = useAuth();
  const go = useGo();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  if (!user) return null;
  const item = "flex w-full items-center justify-between rounded-[12px] px-3 py-2.5 text-left text-[0.92rem] font-medium hover:bg-panel-3";
  return (
    <div ref={ref} className="relative">
      <button className="flex items-center gap-2.5 rounded-full border border-line-2 bg-panel py-1 pl-1 pr-3 transition-colors hover:border-accent/40" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`Account: ${user.name}`}>
        <Avatar name={user.name} size={30} />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-semibold">{user.name}</span>
          <span className="block text-[11px] text-faint">{ROLE_NAME[user.role]}</span>
        </span>
      </button>
      {open && (
        <div className="rise absolute right-0 top-full z-30 mt-2 w-64 rounded-[18px] border border-line-2 bg-panel p-1.5 shadow-[var(--shadow)]" role="menu">
          <div className="px-3 pb-2 pt-1.5 text-xs text-faint">{user.email}</div>
          <button role="menuitem" className={item} onClick={() => (setOpen(false), go("/how"))}>
            How it works <span className="kbd">h</span>
          </button>
          <button role="menuitem" className={item} onClick={() => (setOpen(false), openPalette())}>
            All commands <span className="kbd">⌘K</span>
          </button>
          {DEMO && (
            <button role="menuitem" className={item} onClick={() => void import("./demo/server").then(({ demo }) => demo.reset())}>
              Reset demo data
            </button>
          )}
          <button role="menuitem" className={`${item} text-coral`} onClick={() => (setOpen(false), void logout())}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Opens a record as a sheet over whichever home screen is underneath. */
function RecordSheet() {
  const { rid, id } = useParams();
  const go = useGo();
  return (
    <Sheet label="Record" onClose={() => go(id ? `/patients/${id}` : "/")}>
      <RecordView key={rid} id={rid!} />
    </Sheet>
  );
}

/** The lending form as a sheet, for one of the patient's records. */
function LendSheet() {
  const { rid } = useParams();
  const { user } = useAuth();
  const go = useGo();
  const mine = useApi<{ records: RecordMeta[] }>(user ? `/api/patients/${user.id}` : null);
  const team = useApi<{ grants: { id: string }[] }>("/api/consent");
  const records = mine.data?.records ?? [];
  const record = rid === "first" ? records[0] : records.find((r) => r.id === rid);
  return (
    <Sheet label="Lend a record" onClose={() => go("/")} wide={false}>
      {mine.data && !record && <p className="pt-6 text-muted">That record is not in your wallet.</p>}
      {records.length > 1 && record && (
        <div className="flex gap-2 overflow-x-auto pb-1 pr-12 pt-3" role="radiogroup" aria-label="Which card">
          {records.map((r) => (
            <button key={r.id} role="radio" aria-checked={r.id === record.id} onClick={() => go(`/lend/${r.id}`)} className={`flex-none rounded-full border px-3.5 py-1.5 text-[13px] font-medium ${r.id === record.id ? "border-amber text-amber" : "border-line-2 text-muted hover:text-ink"}`}>
              {r.title.length > 30 ? `${r.title.slice(0, 29)}…` : r.title}
            </button>
          ))}
        </div>
      )}
      {record && team.data && (
        <LendForm
          key={record.id}
          record={record}
          careTeam={team.data.grants.map((g) => g.id)}
          onCancel={() => go("/")}
          onLent={() => {
            refresh();
            go("/");
          }}
        />
      )}
      {!mine.data && <div className="skeleton mt-6 h-40" />}
    </Sheet>
  );
}

function HowSheet() {
  const go = useGo();
  return (
    <Sheet label="How MedVault works" onClose={() => go("/")}>
      <How />
    </Sheet>
  );
}

function useCommands(): Command[] {
  const { user, logout } = useAuth();
  const go = useGo();
  return useMemo(() => {
    const c: Command[] = [
      { id: "home", group: "Go to", label: user ? "My wallet" : "Start", hint: "The home screen", keys: "g", run: () => go("/") },
      { id: "how", group: "Go to", label: "How it works", hint: "Follow one real record from key to recovery", keys: "h", run: () => go("/how") },
    ];
    if (user?.role === "patient") c.push({ id: "lend", group: "Do", label: "Lend a record to a doctor", hint: "Time-limited: it comes back by itself", keys: "l", run: () => go("/lend/first") });
    if (user) {
      c.push({ id: "signout", group: "Account", label: "Sign out", run: () => void logout() });
      if (DEMO) c.push({ id: "reset", group: "Account", label: "Reset demo data", hint: "Start this browser's sandbox again", run: () => void import("./demo/server").then(({ demo }) => demo.reset()) });
    }
    return c;
  }, [user, go, logout]);
}

function Shell() {
  const { user, ready } = useAuth();
  const loc = useLocation();
  const commands = useCommands();
  if (!ready) return <div className="min-h-dvh" aria-busy="true" />;
  if (!user)
    return (
      <>
        <Routes>
          <Route path="/how" element={<HowSheet />} />
          <Route path="*" element={null} />
        </Routes>
        <Login />
        <Palette commands={commands} />
      </>
    );
  const how = loc.pathname === "/how";

  let home: ReactNode;
  if (user.role === "doctor")
    home = (
      <Routes>
        <Route path="/patients/:id/*" element={<DoctorHome />} />
        <Route path="*" element={<DoctorHome />} />
      </Routes>
    );
  else if (user.role === "patient") home = <PatientHome />;
  else home = <AdminHome />;

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[88rem] items-center gap-3 px-4 pb-2 pt-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5" aria-label="MedVault home">
          <Mark size={32} />
          <span className="text-[1.15rem] font-bold tracking-tight [font-variation-settings:'wdth'_90]">MedVault</span>
        </a>
        <span className="flex-1" />
        <button className="btn h-9 gap-3 px-3 text-[13px] text-faint" onClick={openPalette} aria-label="Open command palette">
          <span className="hidden sm:inline">Search or jump to…</span>
          <span className="kbd">⌘K</span>
        </button>
        <AccountMenu />
      </header>
      <main className="mx-auto max-w-[88rem] px-4 pb-14 pt-4 sm:px-6">{home}</main>
      <footer className="mx-auto max-w-[88rem] px-4 pb-8 text-xs text-faint sm:px-6">
        Fictional people, real openly licensed scans. Not for real patient data without a security review.
        {DEMO && " This sandbox runs entirely in your browser and is saved only on this device."}
      </footer>

      <Routes>
        {user.role === "patient" && <Route path="/records/:rid" element={<RecordSheet />} />}
        {user.role === "patient" && <Route path="/lend/:rid" element={<LendSheet />} />}
        {user.role === "doctor" && <Route path="/patients/:id/records/:rid" element={<RecordSheet />} />}
        {user.role === "doctor" && <Route path="/lent/:rid" element={<RecordSheet />} />}
        <Route path="/how" element={<HowSheet />} />
        <Route path="/" element={null} />
        {user.role === "doctor" && <Route path="/patients/:id" element={null} />}
        <Route path="*" element={how ? null : <Navigate to="/" replace />} />
      </Routes>
      <Palette commands={commands} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
