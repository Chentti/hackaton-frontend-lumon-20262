import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { API_BASE, BUILD } from "../config";
import { backoff } from "../api/client";

export function HealthGate({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [nextIn, setNextIn] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const check = useCallback(async (n: number) => {
    window.clearTimeout(timer.current);
    try {
      const res = await fetch(`${API_BASE}/meta/health`, { headers: { "X-Lumon-Build": BUILD } });
      if (res.ok && !(res.headers.get("content-type") ?? "").includes("text/html")) {
        setOk(true);
        return;
      }
    } catch {
      /* reintenta */
    }
    const wait = backoff(n, 1000, 30000);
    setAttempt(n + 1);
    setNextIn(Math.round(wait / 1000));
    timer.current = window.setTimeout(() => void check(n + 1), wait);
  }, []);

  useEffect(() => {
    void check(0);
    return () => window.clearTimeout(timer.current);
  }, [check]);

  if (!API_BASE)
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <p role="alert" className="max-w-md text-center text-amber-200">
          Falta configurar VITE_API_BASE_URL. Crea el archivo .env (copia de .env.example) con las URLs de la API y
          reinicia <code>npm run dev</code>. En Vercel, agrégalas en Environment Variables y vuelve a desplegar.
        </p>
      </main>
    );
  if (ok) return <>{children}</>;
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="text-center space-y-4" role="status" aria-live="polite">
        <h1 className="text-2xl font-semibold">Conectando con Lumon…</h1>
        {attempt > 0 && (
          <p className="text-slate-300">
            Intento {attempt} fallido. Reintentando en ~{nextIn}s.
          </p>
        )}
        <button
          className="rounded bg-teal-700 px-4 py-2 hover:bg-teal-600"
          onClick={() => void check(attempt)}
        >
          Reintentar ahora
        </button>
      </div>
    </main>
  );
}
