import { api, isAbort } from "../api/client";
import type { Rules, TileResponse } from "../api/contract";

export interface Tile {
  tileRow: number;
  tileCol: number;
  originRow: number;
  originCol: number;
  rows: number;
  cols: number;
  values: string;
  tremor: Uint8Array;
  bins: string[];
  version: number;
}

export interface Cell {
  v: number;
  t: number;
  b: string; // "." o W/F/D/M
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const key = (tr: number, tc: number) => `${tr}:${tc}`;
const MAX_CONCURRENT = 4;

interface Job {
  tr: number;
  tc: number;
  pinned: boolean;
  ctrl: AbortController;
  promise: Promise<Tile>;
  resolve: (t: Tile) => void;
  reject: (e: unknown) => void;
  started: boolean;
}

/**
 * Caché de bloques: nunca dos requests en vuelo para el mismo bloque,
 * cancela los que salieron de la vista, límite de concurrencia.
 * El 429 / Retry-After y el backoff de 503 los maneja el cliente HTTP.
 */
export class TileStore {
  private cache = new Map<string, Tile>();
  private jobs = new Map<string, Job>();
  private queue: string[] = [];
  private running = 0;
  private listeners = new Set<() => void>();
  version = 0;
  lastError: string | null = null;

  constructor(
    private fileId: string,
    public tileSize: number,
    public rows: number,
    public cols: number,
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;
  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  tileOf(r: number, c: number): [number, number] {
    return [Math.floor(r / this.tileSize), Math.floor(c / this.tileSize)];
  }

  has(tr: number, tc: number): boolean {
    return this.cache.has(key(tr, tc));
  }

  cell(r: number, c: number): Cell | null {
    if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return null;
    const [tr, tc] = this.tileOf(r, c);
    const t = this.cache.get(key(tr, tc));
    if (!t) return null;
    const i = (r - t.originRow) * t.cols + (c - t.originCol);
    return { v: t.values.charCodeAt(i) - 48, t: t.tremor[i] ?? 0, b: t.bins[i] ?? "." };
  }

  /** Pide un bloque; `pinned` = lo necesita la selección de grupo y no se cancela por scroll. */
  ensure(tr: number, tc: number, pinned = false): Promise<Tile> {
    const k = key(tr, tc);
    const cached = this.cache.get(k);
    if (cached) return Promise.resolve(cached);
    const existing = this.jobs.get(k);
    if (existing) {
      if (pinned) existing.pinned = true;
      return existing.promise;
    }
    let resolve!: (t: Tile) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<Tile>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => undefined);
    const job: Job = { tr, tc, pinned, ctrl: new AbortController(), promise, resolve, reject, started: false };
    this.jobs.set(k, job);
    if (pinned) this.queue.unshift(k);
    else this.queue.push(k);
    this.pump();
    return promise;
  }

  /** Mantiene solo los bloques visibles: cancela el resto (salvo los fijados). */
  want(keys: Array<[number, number]>) {
    const wanted = new Set(keys.map(([a, b]) => key(a, b)));
    for (const [k, job] of this.jobs) {
      if (!wanted.has(k) && !job.pinned) {
        job.ctrl.abort();
        this.jobs.delete(k);
        this.queue = this.queue.filter((q) => q !== k);
        job.reject(new DOMException("Aborted", "AbortError"));
      }
    }
    for (const [a, b] of keys) void this.ensure(a, b).catch(() => undefined);
  }

  private pump() {
    while (this.running < MAX_CONCURRENT && this.queue.length) {
      const k = this.queue.shift()!;
      const job = this.jobs.get(k);
      if (!job || job.started) continue;
      job.started = true;
      this.running++;
      api<TileResponse>(`/files/${this.fileId}/tiles/${job.tr}/${job.tc}`, { signal: job.ctrl.signal, maxRetries: 6 })
        .then((t) => {
          const tile: Tile = { ...t, tremor: decodeBase64(t.tremor), bins: t.bins.split("") };
          this.cache.set(k, tile);
          this.lastError = null;
          job.resolve(tile);
          this.emit();
        })
        .catch((e: unknown) => {
          if (!isAbort(e)) {
            this.lastError = "No se pudo cargar un bloque; se reintentará al moverse.";
            this.emit();
          }
          job.reject(e);
        })
        .finally(() => {
          if (this.jobs.get(k) === job) this.jobs.delete(k);
          this.running--;
          this.pump();
        });
    }
  }

  setBins(cells: Array<{ r: number; c: number }>, letter: string) {
    for (const { r, c } of cells) {
      const [tr, tc] = this.tileOf(r, c);
      const t = this.cache.get(key(tr, tc));
      if (!t) continue;
      t.bins[(r - t.originRow) * t.cols + (c - t.originCol)] = letter;
    }
    this.emit();
  }

  invalidate(cells: Array<{ r: number; c: number }>) {
    const ks = new Set(cells.map(({ r, c }) => key(...this.tileOf(r, c))));
    for (const k of ks) this.cache.delete(k);
    this.emit();
    for (const k of ks) {
      const [a, b] = k.split(":").map(Number);
      void this.ensure(a, b, true).catch(() => undefined);
    }
  }

  dispose() {
    for (const job of this.jobs.values()) job.ctrl.abort();
    this.jobs.clear();
    this.queue = [];
  }
}

export interface Group {
  cells: Array<{ r: number; c: number }>;
  size: number;
  noise: boolean;
  bin: string | null;
  sig: string;
}

export function isScary(cell: Cell | null, rules: Rules): boolean {
  return !!cell && cell.b === "." && cell.t >= rules.tremorThreshold;
}

/** BFS del componente conexo máximo; pide los bloques que falten. */
export async function findGroup(store: TileStore, rules: Rules, r0: number, c0: number): Promise<Group | null> {
  const load = async (r: number, c: number) => {
    const [tr, tc] = store.tileOf(r, c);
    if (!store.has(tr, tc)) await store.ensure(tr, tc, true);
    return store.cell(r, c);
  };
  const first = await load(r0, c0);
  if (!isScary(first, rules)) return null;
  const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const dirs = rules.connectivity === 8 ? [...dirs4, [1, 1], [1, -1], [-1, 1], [-1, -1]] : dirs4;
  const seen = new Set<number>([r0 * store.cols + c0]);
  const queue: Array<[number, number]> = [[r0, c0]];
  const cells: Array<{ r: number; c: number }> = [];
  const limit = rules.maxGroupSize + 1;
  while (queue.length && cells.length < limit) {
    const [r, c] = queue.shift()!;
    cells.push({ r, c });
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= store.rows || nc >= store.cols) continue;
      const id = nr * store.cols + nc;
      if (seen.has(id)) continue;
      seen.add(id);
      const cell = await load(nr, nc);
      if (isScary(cell, rules)) queue.push([nr, nc]);
    }
  }
  const size = cells.length;
  const noise = size < rules.minGroupSize || size > rules.maxGroupSize || queue.length > 0;
  let bin: string | null = null;
  if (!noise) {
    const digits = cells.map(({ r, c }) => store.cell(r, c)?.v ?? 0);
    const idx =
      rules.binning.strategy === "MAX_DIGIT_MOD"
        ? Math.max(...digits) % 4
        : digits.reduce((a, b) => a + b, 0) % 4;
    bin = rules.binning.order[idx] ?? null;
  }
  const sig = cells
    .map(({ r, c }) => r * store.cols + c)
    .sort((a, b) => a - b)
    .join(",");
  return { cells, size: noise && queue.length > 0 ? size : size, noise, bin, sig };
}
