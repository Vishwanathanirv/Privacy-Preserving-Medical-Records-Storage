import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { demoSessionHint } from "./demo/keys";

export type Role = "admin" | "doctor" | "patient";
export type User = { id: string; name: string; email: string; role: Role };
export type Stats = { layers: number; payloadBytes: number; bitsPerPixel: number; psnr: number; ssim: number; maxPixelChange: number; embedMs: number };
export type ScanInfo = { format: "png" | "dicom"; bitDepth: number; modality?: string; window?: { center: number; width: number }; rescale?: { slope: number; intercept: number }; removedFields?: string[] };
export type RecordMeta = { id: string; patientId: string; authorName: string; title: string; createdAt: number; width: number; height: number; stegoSha256: string; originalSha256: string; stats: Stats & { thresholds?: number[] }; scan?: ScanInfo };
export type Clinical = { title: string; diagnosis: string; notes: string; medications: string[]; vitals?: { bp?: string; pulse?: number; temperature?: number; spo2?: number }; author: string; createdAt: string };
export type AuditEntry = { seq: number; ts: number; actor: string; action: string; target: string; detail: string; prevHash: string; hash: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** True in the hosted demo build, where the server runs inside the browser instead of on a host. */
export const DEMO = import.meta.env.VITE_DEMO === "1";

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  if (DEMO) {
    const { demo } = await import("./demo/server");
    const r = await demo.handle(init.method ?? "GET", path, init.json !== undefined ? init.json : init.body);
    if (r.status >= 400) throw new ApiError(r.status, (r.data as { error?: string }).error ?? `Request failed (${r.status})`);
    return r.data as T;
  }
  const headers: Record<string, string> = { "x-medvault": "1", ...(init.headers as Record<string, string>) };
  if (init.json !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Tells every mounted view to reload its data. */
export const refresh = () => window.dispatchEvent(new Event("medvault:refresh"));

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
    // Anything that changes data elsewhere on the screen calls refresh(), and every view reloads.
    const again = () => void load();
    window.addEventListener("medvault:refresh", again);
    return () => window.removeEventListener("medvault:refresh", again);
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

type AuthState = { user: User | null; ready: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void> };
const AuthCtx = createContext<AuthState>({ user: null, ready: false, login: async () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // In the browser demo, a first-time visitor is not signed in: skip starting the sandbox (and
    // seeding its records) until they pick someone, so the first screen stays fast.
    if (DEMO && !demoSessionHint()) {
      setReady(true);
      return;
    }
    api<{ user: User }>("/api/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);
  const login = async (email: string, password: string) => setUser((await api<{ user: User }>("/api/auth/login", { method: "POST", json: { email, password } })).user);
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
  };
  return <AuthCtx.Provider value={{ user, ready, login, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export const date = (ts: number | string) => new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export const ACTIONS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.failed": "Failed sign-in attempt",
  "consent.grant": "Granted a doctor access",
  "consent.revoke": "Revoked a doctor's access",
  "record.create": "Created a record",
  "record.view": "Opened a record",
  "record.denied": "Was denied access to a record",
  "record.verify": "Verified an image",
  "image.original": "Viewed the restored scan",
  "image.diff": "Viewed the change map",
  "file.original": "Downloaded the original scan",
  "user.create": "Created a user",
  "sos.issue": "Issued an emergency card",
  "sos.revoke": "Revoked an emergency card",
  "sos.open": "Broke the glass: opened your emergency card",
  "sos.failed": "Tried a wrong code on your emergency card",
  "loan.create": "Lent a record",
  "loan.revoke": "Took back a loan",
  "loan.expire": "Ended a loan when its time ran out",
  "system.seed": "Demo data created",
};

export type ImageVariant = "stego" | "original" | "diff";

/** URL for a record image: the API path on a server, or a local blob in the browser demo. */
export function useRecordImage(recordId: string, variant: ImageVariant) {
  const path = `/api/records/${recordId}/image/${variant}`;
  const [url, setUrl] = useState<string | null>(DEMO ? null : path);
  useEffect(() => {
    if (!DEMO) {
      setUrl(path);
      return;
    }
    let made: string | null = null;
    let live = true;
    void import("./demo/server")
      .then(({ demo }) => demo.bytes(path))
      .then(({ bytes: png }) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }));
        setUrl(made);
      })
      .catch(() => live && setUrl(null));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [recordId, variant, path]);
  return url;
}

/** Raw bytes of a binary endpoint (an image or a record file), from the server or the in-browser demo. */
export async function fetchBytes(path: string): Promise<{ bytes: Uint8Array; type: string; filename?: string }> {
  if (DEMO) {
    const { demo } = await import("./demo/server");
    return demo.bytes(path);
  }
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${res.status})`);
  const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1];
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "application/octet-stream", filename: name };
}

/** Saves bytes as a file on the visitor's device. */
export function saveFile(bytes: Uint8Array, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves a record's file: the stored (stego, de-identified) one, or the restored original. */
export async function downloadRecordFile(recordId: string, kind: "stored" | "original") {
  const f = await fetchBytes(`/api/records/${recordId}/file/${kind}`);
  saveFile(f.bytes, f.type, f.filename ?? `medvault-${recordId.slice(0, 8)}-${kind}`);
}

/** Navigates inside a view transition where the browser supports it. */
export function useGo() {
  const nav = useNavigate();
  return useCallback((to: string) => void nav(to, { viewTransition: true }), [nav]);
}
