import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import { AuthProvider, DEMO, useAuth } from "./lib";
import { Login } from "./pages/Login";
import { DoctorHome } from "./pages/Doctor";
import { RecordView } from "./pages/Record";
import { PatientHome } from "./pages/Patient";
import { AdminHome } from "./pages/Admin";
import { How } from "./pages/How";
import { Avatar, Sheet } from "./ui";

const ROLE_NAME = { doctor: "Doctor", patient: "Patient", admin: "Administrator" } as const;

function useTheme(): [string, (t: string) => void] {
  const [t, setT] = useState(() => {
    try {
      return localStorage.getItem("medvault-theme") ?? "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("medvault-theme", t);
    } catch {
      /* private mode */
    }
  }, [t]);
  return [t, setT];
}

/** Everything that isn't the home screen lives behind your avatar. */
function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
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
  const item = "flex w-full items-center rounded-[14px] px-3 py-2.5 text-left text-[0.92rem] font-medium hover:bg-panel-2";
  return (
    <div ref={ref} className="relative">
      <button className="flex items-center gap-2.5 rounded-full border border-line bg-panel py-1 pl-1 pr-3 shadow-[var(--shadow)]" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`Account: ${user.name}`}>
        <Avatar name={user.name} size={32} />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-bold">{user.name}</span>
          <span className="block text-[11px] text-muted">{ROLE_NAME[user.role]}</span>
        </span>
      </button>
      {open && (
        <div className="fade absolute right-0 top-full z-30 mt-2 w-64 rounded-[22px] border border-line bg-panel p-2 shadow-[var(--shadow)]" role="menu">
          <div className="px-3 pb-2 pt-1.5 text-xs text-muted">{user.email}</div>
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              navigate("/how");
            }}
          >
            How MedVault works
          </button>
          <div className="flex gap-1 px-3 py-2" role="group" aria-label="Appearance">
            {["system", "light", "dark"].map((t) => (
              <button key={t} className={`flex-1 rounded-full px-2 py-1 text-xs font-semibold capitalize ${theme === t ? "bg-ink text-bg" : "bg-panel-2 text-muted"}`} onClick={() => setTheme(t)} aria-pressed={theme === t}>
                {t === "system" ? "Auto" : t}
              </button>
            ))}
          </div>
          {DEMO && (
            <button role="menuitem" className={item} onClick={() => void import("./demo/server").then(({ demo }) => demo.reset())}>
              Reset demo data
            </button>
          )}
          <button
            role="menuitem"
            className={`${item} text-bad`}
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
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
  const navigate = useNavigate();
  return (
    <Sheet label="Record" onClose={() => navigate(id ? `/patients/${id}` : "/")}>
      <RecordView key={rid} id={rid!} />
    </Sheet>
  );
}

function HowSheet() {
  const navigate = useNavigate();
  return (
    <Sheet label="How MedVault works" onClose={() => navigate("/")}>
      <div className="pr-10 pt-3">
        <How />
      </div>
    </Sheet>
  );
}

function Shell() {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return null;
  if (!user) return <Login />;
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
      <header className="mx-auto flex max-w-[86rem] items-center gap-3 px-4 pb-2 pt-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5 font-extrabold tracking-tight">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <span className="text-[1.1rem]">MedVault</span>
        </a>
        <span className="ml-1 hidden items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1 text-xs font-semibold text-ok md:inline-flex" title="Records are stored encrypted inside their scans">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
            <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v7h-9z" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
          </svg>
          Vault sealed
        </span>
        <span className="flex-1" />
        <AccountMenu />
      </header>
      <main className="mx-auto max-w-[86rem] px-4 pb-14 pt-4 sm:px-6">{home}</main>
      <footer className="mx-auto max-w-[86rem] px-4 pb-8 text-xs text-faint sm:px-6">
        Demo with fictional people and synthetic scans. Not for real patient data without a security review.
        {DEMO && " This sandbox runs entirely in your browser and is saved only on this device."}
      </footer>

      <Routes>
        {user.role === "patient" && <Route path="/records/:rid" element={<RecordSheet />} />}
        {user.role === "doctor" && <Route path="/patients/:id/records/:rid" element={<RecordSheet />} />}
        <Route path="/how" element={<HowSheet />} />
        <Route path="/" element={null} />
        {user.role === "doctor" && <Route path="/patients/:id" element={null} />}
        <Route path="*" element={how ? null : <Navigate to="/" replace />} />
      </Routes>
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
