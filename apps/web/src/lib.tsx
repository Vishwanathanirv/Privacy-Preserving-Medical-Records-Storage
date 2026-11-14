import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Role = "admin" | "doctor" | "patient";
export type User = { id: string; name: string; email: string; role: Role };
export type Stats = { layers: number; payloadBytes: number; bitsPerPixel: number; psnr: number; ssim: number; maxPixelChange: number; embedMs: number };
export type RecordMeta = { id: string; patientId: string; authorName: string; title: string; createdAt: number; width: number; height: number; stegoSha256: string; originalSha256: string; stats: Stats };
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
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

type AuthState = { user: User | null; ready: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void> };
const AuthCtx = createContext<AuthState>({ user: null, ready: false, login: async () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
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
  "user.create": "Created a user",
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
      .then(({ demo }) => demo.image(recordId, variant))
      .then((png) => {
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

/** Saves the stored stego image to disk. */
export async function downloadRecordImage(recordId: string) {
  if (!DEMO) {
    location.assign(`/api/records/${recordId}/image/stego?download=1`);
    return;
  }
  const { demo } = await import("./demo/server");
  const url = URL.createObjectURL(new Blob([(await demo.image(recordId, "stego")) as Uint8Array<ArrayBuffer>], { type: "image/png" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `medvault-${recordId.slice(0, 8)}-stego.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
