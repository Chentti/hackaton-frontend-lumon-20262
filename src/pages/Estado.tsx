import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { API_BASE, BUILD } from "../config";
import { useAuth } from "../auth/AuthContext";

interface Check { name?: string; key?: string; id?: string; passed: boolean; reason?: string; message?: string }

function Json({ value }: { value: unknown }) {
  return <pre className="overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-200">{JSON.stringify(value, null, 2)}</pre>;
}

function extractChecks(v: unknown): Check[] {
  const o = (v ?? {}) as Record<string, unknown>;
  const c = o.checks ?? o.results;
  if (Array.isArray(c)) return c as Check[];
  if (c && typeof c === "object") return Object.entries(c as Record<string, Check>).map(([k, x]) => ({ ...x, name: k }));
  return [];
}

export default function Estado() {
  const { me, reloadMe } = useAuth();
  const [health, setHealth] = useState<string>("comprobando…");
  const [integrations, setIntegrations] = useState<unknown>(null);
  const [clearance, setClearance] = useState<unknown>(null);
  const [checkRes, setCheckRes] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<unknown>(null);

  const load = useCallback(async () => {
    fetch(`${API_BASE}/meta/health`, { headers: { "X-Lumon-Build": BUILD } })
      .then((r) => setHealth(r.ok ? "responde" : `HTTP ${r.status}`))
      .catch(() => setHealth("sin respuesta"));
    api("/integrations/status").then(setIntegrations).catch((e: unknown) => setIntegrations(String(e)));
    api("/clearance").then(setClearance).catch((e: unknown) => setClearance(String(e)));
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function run(label: string, fn: () => Promise<unknown>, onOk?: (v: unknown) => void) {
    if (busy) return;
    setBusy(label);
    setMsg(null);
    try {
      const v = await fn();
      onOk?.(v);
      setMsg(`${label}: OK`);
    } catch (e) {
      setMsg(`${label}: ${e instanceof ApiError ? `${e.code} — ${e.message}` : "error"}`);
      if (e instanceof ApiError && e.details) onOk?.(e.details);
    } finally {
      setBusy(null);
      void load();
    }
  }

  const [origin, setOrigin] = useState(
    window.location.hostname === "localhost" ? "https://" : window.location.origin,
  );
  const checks = extractChecks(checkRes);

  return (
    <section className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Estado</h1>
      <dl className="grid grid-cols-2 gap-2 rounded bg-slate-900 p-4 text-sm">
        <dt className="text-slate-400">Build desplegado</dt><dd><code>{BUILD}</code></dd>
        <dt className="text-slate-400">API</dt><dd>{health}</dd>
        <dt className="text-slate-400">Equipo</dt><dd>{me?.team?.code} — {me?.team?.name}</dd>
        <dt className="text-slate-400">Clearance</dt><dd>{me?.clearance?.granted ? "Piso de Pruebas abierto" : "cerrado"}</dd>
      </dl>
      {msg && <p role="status" className="rounded bg-slate-800 p-2">{msg}</p>}

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Revisión automática</h2>
        <button disabled={!!busy} className="rounded bg-teal-700 px-4 py-2 font-semibold hover:bg-teal-600 disabled:opacity-60"
          onClick={() => void run("Abrir el Piso de Pruebas", () => api("/clearance/check", { method: "POST", maxRetries: 1 }), (v) => { setCheckRes(v); void reloadMe(); })}>
          {busy === "Abrir el Piso de Pruebas" ? "Revisando…" : "Abrir el Piso de Pruebas"}
        </button>
        {checks.length > 0 && (
          <ul className="space-y-1">
            {checks.map((c, i) => (
              <li key={c.name ?? c.key ?? c.id ?? i} className={c.passed ? "text-emerald-300" : "text-red-300"}>
                {c.passed ? "✔" : "✘"} {c.name ?? c.key ?? c.id} {c.reason ?? c.message ? `— ${c.reason ?? c.message}` : ""}
              </li>
            ))}
          </ul>
        )}
        {checkRes !== null && checks.length === 0 && <Json value={checkRes} />}
        <h3 className="font-semibold">Clearance</h3>
        <Json value={clearance} />
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Dominio desplegado</h2>
        <label htmlFor="origin" className="block text-sm text-slate-300">URL de producción (Vercel), sin barra final</label>
        <input id="origin" value={origin} onChange={(e) => setOrigin(e.target.value.trim().replace(/\/+$/, ""))}
          className="w-full rounded bg-slate-800 px-3 py-2 text-white" placeholder="https://su-app.vercel.app" />
        <div className="flex flex-wrap gap-2">
          <button disabled={!!busy} className="rounded bg-slate-700 px-3 py-2"
            onClick={() => void run("Challenge", () => api("/integrations/deploy/challenge", { method: "POST", body: { origin }, maxRetries: 1 }), setChallenge)}>
            1. Pedir challenge
          </button>
          <button disabled={!!busy} className="rounded bg-slate-700 px-3 py-2"
            onClick={() => void run("Verify", () => api("/integrations/deploy/verify", { method: "POST", body: { origin }, maxRetries: 1 }))}>
            3. Verificar
          </button>
        </div>
        {challenge !== null && <Json value={challenge} />}
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Modo caos</h2>
        <div className="flex gap-2">
          {[0, 1, 2].map((l) => (
            <button key={l} disabled={!!busy} className="rounded bg-slate-700 px-3 py-2"
              onClick={() => void run(`Caos ${l}`, () => api("/workspace/chaos", { method: "PUT", body: { level: l }, maxRetries: 1 }))}>
              Nivel {l}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Integraciones</h2>
        <Json value={integrations} />
      </div>
    </section>
  );
}
