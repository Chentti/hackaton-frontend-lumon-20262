import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

type Field = "teamName" | "email" | "password";
const LABELS: Record<Field, string> = { teamName: "Nombre de la cuadrilla", email: "Email", password: "Contraseña" };

/** Asigna los errores del servidor al campo que corresponde. */
function fieldErrors(err: ApiError): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  const d = err.details;
  const put = (f: string, m: string) => {
    const key = (f === "name" || f === "team" || f === "teamName") ? "teamName" : f;
    if (key === "teamName" || key === "email" || key === "password") out[key] = m;
  };
  if (Array.isArray(d)) {
    for (const it of d as Array<Record<string, unknown>>) {
      const f = it.field ?? it.path;
      if (typeof f === "string") put(f, String(it.message ?? err.message));
    }
  } else if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    if (typeof o.field === "string") put(o.field, err.message);
    const fields = (o.fields ?? o.errors) as Record<string, unknown> | undefined;
    if (fields && typeof fields === "object") for (const [k, v] of Object.entries(fields)) put(k, String(v));
  }
  if (Object.keys(out).length === 0) {
    if (/EMAIL/.test(err.code)) out.email = err.message;
    else if (/TEAM|NAME/.test(err.code)) out.teamName = err.message;
  }
  return out;
}

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState<Record<Field, string>>({ teamName: "", email: "", password: "" });
  const [errs, setErrs] = useState<Partial<Record<Field, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrs({});
    setGeneral(null);
    try {
      await register(form);
      nav("/estado", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = fieldErrors(err);
        setErrs(fe);
        if (Object.keys(fe).length === 0) setGeneral(err.message);
      } else setGeneral("No se pudo registrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg bg-slate-900 p-6" noValidate>
        <h1 className="text-2xl font-semibold">Registrar cuadrilla</h1>
        {(Object.keys(LABELS) as Field[]).map((f) => (
          <div key={f} className="space-y-1">
            <label htmlFor={f} className="block text-sm">{LABELS[f]}</label>
            <input id={f} type={f === "password" ? "password" : f === "email" ? "email" : "text"}
              autoComplete={f === "password" ? "new-password" : f === "email" ? "email" : "organization"}
              value={form[f]} aria-invalid={!!errs[f]} aria-describedby={errs[f] ? `${f}-err` : undefined}
              onChange={(e) => setForm({ ...form, [f]: e.target.value })}
              className="w-full rounded bg-slate-800 px-3 py-2 text-white" />
            {errs[f] && <p id={`${f}-err`} className="text-sm text-red-300">{errs[f]}</p>}
          </div>
        ))}
        {general && <p role="alert" className="text-red-300">{general}</p>}
        <button disabled={busy} className="w-full rounded bg-teal-700 py-2 font-semibold hover:bg-teal-600 disabled:opacity-60">
          {busy ? "Registrando…" : "Registrar"}
        </button>
        <p className="text-sm text-slate-300"><Link className="text-teal-300 underline" to="/login">Ya tengo cuenta</Link></p>
      </form>
    </main>
  );
}
