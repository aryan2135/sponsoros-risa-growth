"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Dashboard } from "./views";

export async function api<T = unknown>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ? `${j.error}${j.issues ? ": " + j.issues.join("; ") : ""}` : `HTTP ${r.status}`);
  return j as T;
}

interface Ctx { data: Dashboard | null; error: string | null; loading: boolean; refresh: () => Promise<void>; toast: (msg: string, kind?: "ok" | "err") => void }
const DashCtx = createContext<Ctx>({ data: null, error: null, loading: true, refresh: async () => {}, toast: () => {} });

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const refresh = useCallback(async () => {
    try { setLoading(true); setData(await api<Dashboard>("GET", "dashboard")); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 7000 : 3500);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <DashCtx.Provider value={{ data, error, loading, refresh, toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-lg px-4 py-2 text-[13px] font-medium shadow-lg ${t.kind === "err" ? "bg-rose-600 text-white" : "bg-navy-900 text-white"}`}>{t.msg}</div>
        ))}
      </div>
    </DashCtx.Provider>
  );
}
export const useDash = () => useContext(DashCtx);

/** Wrap a mutation: call API, toast, refresh analytics so every view reflects the persisted change. */
export function useMutate() {
  const { refresh, toast } = useDash();
  return useCallback(async <T,>(method: "POST" | "PATCH", path: string, body: unknown, ok = "Saved") => {
    try { const r = await api<T>(method, path, body); toast(ok); await refresh(); return r; } catch (e) { toast((e as Error).message, "err"); return null; }
  }, [refresh, toast]);
}
