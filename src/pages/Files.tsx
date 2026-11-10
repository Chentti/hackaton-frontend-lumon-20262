import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError, isAbort } from "../api/client";
import { FILE_SORTS, FILE_STATUSES, FILES_QUERY, PAGE_SIZES, toPaged, toProgress, type FileDetail, type Paged } from "../api/contract";

function readParams(sp: URLSearchParams) {
  const page = Math.max(1, Math.floor(Number(sp.get("page")) || 1));
  const sizeN = Number(sp.get("size"));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeN) ? sizeN : 20;
  const st = sp.get("status") ?? "";
  const status = (FILE_STATUSES as readonly string[]).includes(st) ? st : "";
  const so = sp.get("sort") ?? "";
  const sort = (FILE_SORTS as readonly string[]).includes(so) ? so : "";
  const q = (sp.get("q") ?? "").slice(0, 100);
  return { page, size, status, sort, q };
}

export default function Files() {
  const [sp, setSp] = useSearchParams();
  const p = readParams(sp);
  const [qInput, setQInput] = useState(p.q);
  const [data, setData] = useState<Paged<FileDetail> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const update = (patch: Partial<Record<keyof typeof p, string | number>>, resetPage = true) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === "" || v === undefined) next.delete(k);
      else next.set(k, String(v));
    }
    if (resetPage && !("page" in patch)) next.delete("page");
    setSp(next);
  };

  // Sincroniza el input si cambia la URL (atrás/adelante).
  useEffect(() => setQInput(p.q), [p.q]);

  // Búsqueda con debounce: una request cuando el usuario deja de tipear.
  useEffect(() => {
    if (qInput === p.q) return;
    const t = setTimeout(() => update({ q: qInput.trim() }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const key = `${p.page}|${p.size}|${p.status}|${p.sort}|${p.q}`;
  useEffect(() => {
    const id = ++reqId.current;
    const ctrl = new AbortController();
    const qs = new URLSearchParams();
    qs.set(FILES_QUERY.page, String(p.page));
    qs.set(FILES_QUERY.size, String(p.size));
    if (p.status) qs.set(FILES_QUERY.status, p.status);
    if (p.sort) qs.set(FILES_QUERY.sort, p.sort);
    if (p.q) qs.set(FILES_QUERY.search, p.q);
    setLoading(true);
    setError(null);
    api<unknown>(`/files?${qs}`, { signal: ctrl.signal })
      .then((raw) => {
        if (id !== reqId.current) return; // una respuesta vieja nunca pisa a una nueva
        setData(toPaged<FileDetail>(raw, p.page));
      })
      .catch((e: unknown) => {
        if (isAbort(e) || id !== reqId.current) return;
        setError(e instanceof ApiError ? `${e.code}: ${e.message}` : "Error al cargar archivos.");
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const ctl = "rounded bg-slate-800 px-2 py-1 text-white";
  return (
    <section className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Archivos de datos</h1>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="q" className="block text-sm">Buscar</label>
          <input id="q" type="search" value={qInput} onChange={(e) => setQInput(e.target.value)} className={ctl} />
        </div>
        <div>
          <label htmlFor="status" className="block text-sm">Estado</label>
          <select id="status" value={p.status} onChange={(e) => update({ status: e.target.value })} className={ctl}>
            {FILE_STATUSES.map((s) => <option key={s} value={s}>{s || "Todos"}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sort" className="block text-sm">Orden</label>
          <select id="sort" value={p.sort} onChange={(e) => update({ sort: e.target.value })} className={ctl}>
            {FILE_SORTS.map((s) => <option key={s} value={s}>{s || "Por defecto"}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="size" className="block text-sm">Por página</label>
          <select id="size" value={p.size} onChange={(e) => update({ size: e.target.value })} className={ctl}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {loading && <span role="status" className="text-slate-300">Cargando…</span>}
      </div>

      {error && (
        <p role="alert" className="rounded bg-red-950 p-3 text-red-200">
          {error} <button className="underline" onClick={() => setSp(new URLSearchParams(sp))}>Reintentar</button>
        </p>
      )}

      <table className="w-full text-left text-sm">
        <thead className="text-slate-300">
          <tr><th className="p-2">Archivo</th><th className="p-2">Tamaño</th><th className="p-2">Estado</th><th className="p-2">Progreso</th><th className="p-2"><span className="sr-only">Acción</span></th></tr>
        </thead>
        <tbody>
          {data?.items.map((f) => {
            const pr = toProgress(f);
            return (
              <tr key={f.id} className="border-t border-slate-800">
                <td className="p-2">{f.name ?? f.title ?? `Archivo ${f.id}`}</td>
                <td className="p-2">{f.rows}×{f.cols}</td>
                <td className="p-2">{f.status ?? "—"}</td>
                <td className="p-2">{pr.percent !== null ? `${Math.round(pr.percent)} %` : "—"}</td>
                <td className="p-2"><Link className="text-teal-300 underline" to={`/files/${f.id}/refine`}>Refinar</Link></td>
              </tr>
            );
          })}
          {data && data.items.length === 0 && <tr><td colSpan={5} className="p-4 text-slate-300">Sin resultados.</td></tr>}
        </tbody>
      </table>

      {data && (
        <nav aria-label="Paginación" className="flex items-center gap-3">
          <button disabled={p.page <= 1} className="rounded bg-slate-700 px-3 py-1 disabled:opacity-50" onClick={() => update({ page: p.page - 1 }, false)}>Anterior</button>
          <span>Página {p.page} de {data.totalPages}</span>
          <button disabled={p.page >= data.totalPages} className="rounded bg-slate-700 px-3 py-1 disabled:opacity-50" onClick={() => update({ page: p.page + 1 }, false)}>Siguiente</button>
        </nav>
      )}
    </section>
  );
}
