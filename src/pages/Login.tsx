import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { safeNext } from "../components/Guards";

export default function Login() {
  const { login, notice, clearNotice } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    clearNotice();
    try {
      await login(email, password);
      nav(safeNext(new URLSearchParams(loc.search).get("next")), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg bg-slate-900 p-6" noValidate>
        <h1 className="text-2xl font-semibold">Ingresar al piso</h1>
        {notice && <p role="alert" className="rounded bg-amber-900/60 p-2 text-amber-100">{notice}</p>}
        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded bg-slate-800 px-3 py-2 text-white" />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm">Contraseña</label>
          <input id="password" type="password" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded bg-slate-800 px-3 py-2 text-white" />
        </div>
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <button disabled={busy} className="w-full rounded bg-teal-700 py-2 font-semibold hover:bg-teal-600 disabled:opacity-60">
          {busy ? "Ingresando…" : "Ingresar"}
        </button>
        <p className="text-sm text-slate-300">
          ¿Cuadrilla nueva? <Link className="text-teal-300 underline" to={`/register${loc.search}`}>Registrarla</Link>
        </p>
      </form>
    </main>
  );
}
