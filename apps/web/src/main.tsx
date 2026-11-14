import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "./index.css";
import { AuthProvider, useAuth, type Role } from "./lib";
import { Login } from "./pages/Login";
import { PatientDetail, Patients } from "./pages/Doctor";
import { RecordView } from "./pages/Record";
import { Activity, Consent, MyRecords } from "./pages/Patient";
import { AuditLog, Users } from "./pages/Admin";
import { How } from "./pages/How";

const NAV: Record<Role, { to: string; t: string }[]> = {
  doctor: [
    { to: "/", t: "Patients" },
    { to: "/how", t: "How it works" },
  ],
  patient: [
    { to: "/", t: "My records" },
    { to: "/consent", t: "Access" },
    { to: "/activity", t: "Activity" },
    { to: "/how", t: "How it works" },
  ],
  admin: [
    { to: "/", t: "Users" },
    { to: "/audit", t: "Audit log" },
    { to: "/how", t: "How it works" },
  ],
};

function Shell() {
  const { user, ready, logout } = useAuth();
  if (!ready) return null;
  if (!user) return <Login />;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-panel/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-5 px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="hidden sm:inline">MedVault</span>
          </a>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm" aria-label="Main">
            {NAV[user.role].map((n) => (
              <NavLink key={n.to} to={n.to} end className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-1.5 ${isActive ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-ink"}`}>
                {n.t}
              </NavLink>
            ))}
          </nav>
          <span className="hidden text-right text-sm md:block">
            <span className="block leading-tight">{user.name}</span>
            <span className="text-xs capitalize text-faint">{user.role}</span>
          </span>
          <button className="text-sm text-muted hover:text-ink" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Routes>
          {user.role === "doctor" && (
            <>
              <Route path="/" element={<Patients />} />
              <Route path="/patients/:id" element={<PatientDetail />} />
            </>
          )}
          {user.role === "patient" && (
            <>
              <Route path="/" element={<MyRecords />} />
              <Route path="/consent" element={<Consent />} />
              <Route path="/activity" element={<Activity />} />
            </>
          )}
          {user.role === "admin" && (
            <>
              <Route path="/" element={<Users />} />
              <Route path="/audit" element={<AuditLog />} />
            </>
          )}
          {user.role !== "admin" && <Route path="/records/:id" element={<RecordView />} />}
          <Route path="/how" element={<How />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-faint sm:px-6">
        Built by{" "}
        <a href="https://vishwanathan.dev" className="text-muted underline underline-offset-4">
          Vishwanathan R
        </a>{" "}
        · Demo with fictional people and synthetic scans. Not for real patient data without a security review.
      </footer>
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
