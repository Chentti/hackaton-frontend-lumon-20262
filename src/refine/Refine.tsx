import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, uuid } from "../api/client";
import { BIN_LETTER, BINS, LETTER_BIN, toProgress, type Bin, type BinProgress, type FileDetail, type Rules } from "../api/contract";
import { useAuth } from "../auth/AuthContext";
import { findGroup, isScary, TileStore, type Group } from "./tiles";

const CELL = 28;
const MAX_CELLS = 2400;
const BIN_STYLE: Record<string, string> = { W: "bg-emerald-800", F: "bg-sky-800", D: "bg-rose-800", M: "bg-violet-800" };

export default function Refine() {
  const { id = "" } = useParams();
  const [file, setFile] = useState<FileDetail | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    Promise.all([
      api<FileDetail>(`/files/${encodeURIComponent(id)}`, { signal: ctrl.signal }),
      api<Rules>(`/files/${encodeURIComponent(id)}/rules`, { signal: ctrl.signal }),
    ])
      .then(([f, r]) => {
        setFile(f);
        setRules(r);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof ApiError ? `${e.code}: ${e.message}` : "No se pudo abrir el archivo.");
      });
    return () => ctrl.abort();
  }, [id, reload]);

  if (error)
    return (
      <section role="alert" className="p-8 space-y-3">
        <p className="text-red-300">{error}</p>
        <button className="rounded bg-teal-700 px-3 py-2" onClick={() => setReload((n) => n + 1)}>Reintentar</button>
      </section>
    );
  if (!file || !rules) return <p role="status" className="p-8 text-slate-300">Abriendo archivo…</p>;
  return <RefineGrid key={file.id} file={file} rules={rules} />;
}

function RefineGrid({ file, rules }: { file: FileDetail; rules: Rules }) {
  const { can } = useAuth();
  const canRefine = can("files:refine");
  const store = useMemo(() => new TileStore(String(file.id), file.tileSize, file.rows, file.cols), [file]);
  useEffect(() => () => store.dispose(), [store]);
  useSyncExternalStore(store.subscribe, store.getVersion);

  const [sp, setSp] = useSearchParams();
  const clamp = (n: number, max: number) => Math.min(Math.max(0, Math.floor(n) || 0), max - 1);
  const initR = clamp(Number(sp.get("r")), file.rows);
  const initC = clamp(Number(sp.get("c")), file.cols);

  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, w: 800, h: 500 });
  const [focus, setFocus] = useState({ r: initR, c: initC });
  const focusFromKeyboard = useRef(false);
  const [group, setGroup] = useState<Group | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [progress, setProgress] = useState<BinProgress>(() => toProgress(file));
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const intents = useRef(new Map<string, string>());
  const [drag, setDrag] = useState<{ x: number; y: number; over: Bin | null } | null>(null);

  // Posición inicial desde la URL.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = Math.max(0, initR * CELL - el.clientHeight / 3);
    el.scrollLeft = Math.max(0, initC * CELL - el.clientWidth / 3);
    setView({ top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() =>
        setView({ top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight }),
      );
    };
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  // Rango visible (virtualización) con límite de celdas.
  let r0 = Math.max(0, Math.floor(view.top / CELL) - 1);
  let r1 = Math.min(file.rows - 1, Math.ceil((view.top + view.h) / CELL));
  const c0 = Math.max(0, Math.floor(view.left / CELL) - 1);
  let c1 = Math.min(file.cols - 1, Math.ceil((view.left + view.w) / CELL));
  while ((r1 - r0 + 1) * (c1 - c0 + 1) > MAX_CELLS) {
    if (c1 - c0 > r1 - r0) c1--;
    else r1--;
  }
  if (r0 > r1) r0 = r1;

  // Pedir solo los bloques visibles y cancelar los que salieron.
  const ts = file.tileSize;
  const tileKey = `${Math.floor(r0 / ts)}-${Math.floor(r1 / ts)}-${Math.floor(c0 / ts)}-${Math.floor(c1 / ts)}`;
  useEffect(() => {
    const t = setTimeout(() => {
      const keys: Array<[number, number]> = [];
      for (let tr = Math.floor(r0 / ts); tr <= Math.floor(r1 / ts); tr++)
        for (let tc = Math.floor(c0 / ts); tc <= Math.floor(c1 / ts); tc++) keys.push([tr, tc]);
      store.want(keys);
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileKey, store]);

  // Posición en la URL sin llenar el historial.
  useEffect(() => {
    const t = setTimeout(() => {
      const r = String(Math.floor(view.top / CELL));
      const c = String(Math.floor(view.left / CELL));
      if (sp.get("r") === r && sp.get("c") === c) return;
      const next = new URLSearchParams(sp);
      next.set("r", r);
      next.set("c", c);
      setSp(next, { replace: true });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.top, view.left]);

  // El foco del teclado siempre visible y en el DOM.
  useEffect(() => {
    if (!focusFromKeyboard.current) return;
    focusFromKeyboard.current = false;
    const el = scroller.current;
    if (el) {
      const y = focus.r * CELL;
      const x = focus.c * CELL;
      if (y < el.scrollTop) el.scrollTop = y;
      else if (y + CELL > el.scrollTop + el.clientHeight) el.scrollTop = y + CELL - el.clientHeight;
      if (x < el.scrollLeft) el.scrollLeft = x;
      else if (x + CELL > el.scrollLeft + el.clientWidth) el.scrollLeft = x + CELL - el.clientWidth;
    }
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-rc="${focus.r}:${focus.c}"]`)?.focus({ preventScroll: true });
    });
  }, [focus]);

  const selected = useMemo(() => new Set(group?.cells.map(({ r, c }) => r * file.cols + c)), [group, file.cols]);

  const select = useCallback(
    async (r: number, c: number) => {
      setMsg(null);
      setSelecting(true);
      try {
        const g = await findGroup(store, rules, r, c);
        setGroup(g);
      } catch {
        setMsg({ kind: "err", text: "No se pudieron cargar los bloques del grupo. Intenta de nuevo." });
      } finally {
        setSelecting(false);
      }
    },
    [store, rules],
  );

  const refine = useCallback(
    async (bin: Bin) => {
      if (!group || group.noise || pendingRef.current || !canRefine) return;
      pendingRef.current = true;
      setPending(true);
      setMsg(null);
      const intent = `${group.sig}|${bin}`;
      let key = intents.current.get(intent);
      if (!key) {
        key = uuid();
        intents.current.set(intent, key);
      }
      try {
        const res = await api<unknown>(`/files/${file.id}/refinements`, {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: { bin, cells: group.cells },
          retryNetwork: true,
          maxRetries: 5,
        });
        store.setBins(group.cells, BIN_LETTER[bin]);
        setProgress((prev) => {
          const p = toProgress(res);
          return { percent: p.percent ?? prev.percent, perBin: { ...prev.perBin, ...p.perBin }, mistakes: p.mistakes ?? prev.mistakes };
        });
        setMsg({ kind: "ok", text: `Grupo de ${group.size} celdas refinado en ${bin}.` });
        setGroup(null);
      } catch (e) {
        if (e instanceof ApiError) {
          const reason = (e.details as { reason?: string } | null)?.reason;
          if (e.status === 422 && e.code === "WRONG_BIN") {
            setMsg({ kind: "err", text: `Caja incorrecta (${bin}): se anotó un error. Revisa las reglas del archivo y elige otra caja.` });
          } else if (e.status === 422) {
            setMsg({ kind: "err", text: `El grupo no se puede refinar: ${reason ?? e.message}. Vuelve a seleccionarlo.` });
          } else if (e.status === 409 && e.code === "GROUP_CLAIMED") {
            const holder = (e.details as { holder?: { displayName?: string } } | null)?.holder?.displayName;
            setMsg({ kind: "err", text: `Otro refinador${holder ? ` (${holder})` : ""} tiene reservado este grupo. Prueba con otro.` });
          } else if (e.status === 409) {
            setMsg({ kind: "err", text: "Alguna celda ya estaba refinada. Se actualizaron los bloques; vuelve a seleccionar." });
            store.invalidate(group.cells);
            setGroup(null);
          } else {
            setMsg({ kind: "err", text: `${e.code}: ${e.message}. Puedes reintentar sin riesgo de duplicar.` });
          }
        } else {
          setMsg({ kind: "err", text: "Error inesperado. Puedes reintentar." });
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [group, canRefine, file.id, store],
  );

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const pageRows = Math.max(1, Math.floor(view.h / CELL) - 1);
    let { r, c } = focus;
    switch (e.key) {
      case "ArrowUp": r--; break;
      case "ArrowDown": r++; break;
      case "ArrowLeft": c--; break;
      case "ArrowRight": c++; break;
      case "PageUp": r -= pageRows; break;
      case "PageDown": r += pageRows; break;
      case "Home": if (e.ctrlKey) r = 0; c = 0; break;
      case "End": if (e.ctrlKey) r = file.rows - 1; c = file.cols - 1; break;
      case "Enter":
      case " ":
        e.preventDefault();
        void select(focus.r, focus.c);
        return;
      case "Escape": setGroup(null); return;
      case "1": case "2": case "3": case "4":
        if (group) { e.preventDefault(); void refine(BINS[Number(e.key) - 1]); }
        return;
      default: return;
    }
    e.preventDefault();
    focusFromKeyboard.current = true;
    setFocus({ r: Math.min(Math.max(0, r), file.rows - 1), c: Math.min(Math.max(0, c), file.cols - 1) });
  }

  // Arrastre con Pointer Events.
  const binAt = (x: number, y: number): Bin | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-bin]");
    const b = el?.dataset.bin;
    return b && (BINS as readonly string[]).includes(b) ? (b as Bin) : null;
  };
  function onDragStart(e: RPointerEvent<HTMLElement>) {
    if (!group || group.noise || !canRefine) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x: e.clientX, y: e.clientY, over: null });
  }
  function onDragMove(e: RPointerEvent<HTMLElement>) {
    if (!drag) return;
    setDrag({ x: e.clientX, y: e.clientY, over: binAt(e.clientX, e.clientY) });
  }
  function onDragEnd(e: RPointerEvent<HTMLElement>) {
    if (!drag) return;
    const b = binAt(e.clientX, e.clientY);
    setDrag(null);
    if (b) void refine(b);
  }

  // Filas y celdas visibles.
  const rowsToRender: number[] = [];
  for (let r = r0; r <= r1; r++) rowsToRender.push(r);
  if (focus.r < r0 || focus.r > r1) rowsToRender.push(focus.r);

  const renderCell = (r: number, c: number, isFocus: boolean) => {
    const cell = store.cell(r, c);
    const sel = selected.has(r * file.cols + c);
    const scary = isScary(cell, rules);
    const binCls = cell && cell.b !== "." ? BIN_STYLE[cell.b] ?? "" : "";
    const label = cell
      ? `${cell.v}${cell.b !== "." ? `, refinada en ${LETTER_BIN[cell.b] ?? cell.b}` : scary ? ", da miedo" : ""}`
      : "cargando";
    return (
      <div
        key={c}
        role="gridcell"
        aria-colindex={c + 1}
        aria-selected={sel}
        aria-label={label}
        tabIndex={isFocus ? 0 : -1}
        data-rc={`${r}:${c}`}
        onClick={() => { setFocus({ r, c }); if (cell) void select(r, c); }}
        onPointerDown={sel ? onDragStart : undefined}
        onPointerMove={sel ? onDragMove : undefined}
        onPointerUp={sel ? onDragEnd : undefined}
        className={`absolute grid place-items-center select-none text-sm font-mono ${binCls} ${sel ? "bg-amber-500 text-black" : ""} ${isFocus ? "outline-2 outline-teal-300 z-10" : ""} ${cell ? "text-slate-200" : "text-slate-600"}`}
        style={{ left: c * CELL, width: CELL, height: CELL }}
      >
        {cell ? (
          <span className={scary ? "cell-scary text-amber-200" : ""} style={scary ? { ["--amp" as string]: (cell.t / 100) * 1.5 } : undefined}>
            {cell.v}
          </span>
        ) : (
          "·"
        )}
      </div>
    );
  };

  const done = progress.percent !== null && progress.percent >= 100;
  if (done)
    return (
      <section className="grid min-h-[60vh] place-items-center p-8 text-center" role="status">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-teal-300">Archivo completado</h1>
          <p>{file.name ?? `Archivo ${file.id}`} llegó al 100 %. Kier estaría orgulloso.</p>
          <Link to="/files" className="text-teal-300 underline">Volver a archivos</Link>
        </div>
      </section>
    );

  return (
    <section className="flex h-[calc(100vh-57px)] flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-lg font-semibold">{file.name ?? `Archivo ${file.id}`} <span className="text-slate-400 text-sm">{file.rows}×{file.cols}</span></h1>
        <span className="text-sm text-slate-300">Fila {focus.r} · Col {focus.c}</span>
        <span className="text-sm text-slate-300">Progreso: {progress.percent !== null ? `${Math.round(progress.percent)} %` : "—"}</span>
        {progress.mistakes !== null && <span className="text-sm text-slate-300">Errores: {progress.mistakes}</span>}
        {store.lastError && <span className="text-sm text-amber-300">{store.lastError}</span>}
      </div>

      <div
        ref={scroller}
        role="grid"
        aria-label="Grilla de datos. Flechas para moverse, Enter para seleccionar el grupo, 1 a 4 para llevarlo a una caja."
        aria-rowcount={file.rows}
        aria-colcount={file.cols}
        aria-multiselectable="true"
        onKeyDown={onKey}
        className="relative flex-1 overflow-auto rounded border border-slate-800 bg-slate-950"
      >
        <div style={{ height: file.rows * CELL, width: file.cols * CELL, position: "relative" }}>
          {rowsToRender.map((r) => {
            const cols: number[] = [];
            const extraRow = r < r0 || r > r1;
            if (!extraRow) for (let c = c0; c <= c1; c++) cols.push(c);
            if (focus.r === r && (extraRow || focus.c < c0 || focus.c > c1)) cols.push(focus.c);
            return (
              <div key={r} role="row" aria-rowindex={r + 1} className="absolute left-0" style={{ top: r * CELL, height: CELL, width: file.cols * CELL }}>
                {cols.map((c) => renderCell(r, c, focus.r === r && focus.c === c))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
        <div className="rounded bg-slate-900 p-3 text-sm" aria-live="polite">
          {selecting && <p>Buscando el grupo completo…</p>}
          {!selecting && !group && <p className="text-slate-300">Selecciona una celda que da miedo (clic o Enter).</p>}
          {!selecting && group && (
            <div className="space-y-2">
              <p>Grupo de <strong>{group.size}{group.noise && group.size > rules.maxGroupSize ? "+" : ""}</strong> celdas.</p>
              {group.noise ? (
                <p className="text-amber-300">Es ruido (fuera de {rules.minGroupSize}–{rules.maxGroupSize}): no se puede refinar.</p>
              ) : (
                <p>Según las reglas va en <strong className="text-teal-300">{group.bin}</strong>.</p>
              )}
              {!group.noise && canRefine && (
                <button
                  className="cursor-grab touch-none rounded bg-amber-500 px-3 py-2 font-semibold text-black"
                  onPointerDown={onDragStart}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                  aria-label="Arrastra el grupo hasta una caja, o usa las teclas 1 a 4"
                >
                  ⠿ Arrastrar grupo
                </button>
              )}
              <button className="ml-2 rounded bg-slate-700 px-3 py-2" onClick={() => setGroup(null)}>Cancelar</button>
            </div>
          )}
          {msg && <p role={msg.kind === "err" ? "alert" : "status"} className={msg.kind === "err" ? "mt-2 text-red-300" : "mt-2 text-emerald-300"}>{msg.text}</p>}
          {!canRefine && <p className="mt-2 text-slate-400">Tu rol no puede refinar (falta files:refine).</p>}
        </div>

        <div className="grid grid-cols-4 gap-2">
          {BINS.map((b, i) => {
            const v = progress.perBin[b];
            const pct = v === undefined ? 0 : v <= 1 && !Number.isInteger(v) ? v * 100 : v;
            return (
              <button
                key={b}
                data-bin={b}
                disabled={!group || group.noise || pending || !canRefine}
                onClick={() => void refine(b)}
                className={`rounded p-3 text-left ${drag?.over === b ? "ring-4 ring-amber-400" : ""} ${BIN_STYLE[BIN_LETTER[b]]} disabled:opacity-70`}
              >
                <span className="block font-bold">{i + 1}. {b}</span>
                <span className="block h-2 rounded bg-slate-950" role="progressbar" aria-label={`Progreso ${b}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                  <span className="block h-2 rounded bg-white" style={{ width: `${Math.min(100, pct)}%` }} />
                </span>
                <span className="text-xs">{v === undefined ? "—" : `${Math.round(pct)} %`}</span>
              </button>
            );
          })}
        </div>
      </div>

      {drag && (
        <div className="pointer-events-none fixed z-50 rounded bg-amber-500 px-2 py-1 text-sm font-bold text-black" style={{ left: drag.x + 8, top: drag.y + 8 }}>
          {group?.size} celdas
        </div>
      )}
    </section>
  );
}
