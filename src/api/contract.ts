/**
 * Tipos y valores que dependen de Swagger (https://lumon-api.vercel.app/docs).
 * Confirmen aquí nombres de campos y query params; el resto de la app los toma de este archivo.
 */
export type Bin = "WO" | "FC" | "DR" | "MA";
export const BINS: readonly Bin[] = ["WO", "FC", "DR", "MA"];
export const BIN_LETTER: Record<Bin, string> = { WO: "W", FC: "F", DR: "D", MA: "M" };
export const LETTER_BIN: Record<string, Bin> = { W: "WO", F: "FC", D: "DR", M: "MA" };

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user?: { id: number; email: string; displayName?: string };
}

export interface Me {
  user?: { id: number; email: string; displayName?: string };
  id?: number;
  email?: string;
  displayName?: string;
  team?: { code: string; name: string };
  role?: { code: string; name: string };
  permissions: string[];
  clearance?: { granted: boolean; grantedAt: string | null };
}

export interface Rules {
  tremorThreshold: number;
  connectivity: 4 | 8;
  minGroupSize: number;
  maxGroupSize: number;
  binning: { strategy: "DIGIT_SUM_MOD" | "MAX_DIGIT_MOD"; order: Bin[] };
}

export interface FileDetail {
  id: number;
  name?: string;
  title?: string;
  rows: number;
  cols: number;
  tileSize: number;
  status?: string;
  progress?: unknown;
  mistakes?: number;
}

export interface TileResponse {
  tileRow: number;
  tileCol: number;
  originRow: number;
  originCol: number;
  rows: number;
  cols: number;
  values: string;
  tremor: string;
  bins: string;
  version: number;
}

/** Query params del listado de archivos (ajustar a Swagger si difieren). */
export const FILES_QUERY = { page: "page", size: "size", status: "status", search: "q", sort: "sort" } as const;
export const FILE_STATUSES = ["", "PENDING", "IN_PROGRESS", "COMPLETED"] as const;
export const FILE_SORTS = ["", "name", "-name", "createdAt", "-createdAt", "progress", "-progress"] as const;
export const PAGE_SIZES = [10, 20, 50] as const;

/** Paginado: acepta las formas más comunes. */
export interface Paged<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}
export function toPaged<T>(raw: unknown, fallbackPage: number): Paged<T> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const items = (o.items ?? o.content ?? o.data ?? o.results ?? (Array.isArray(raw) ? raw : [])) as T[];
  const meta = (o.meta ?? o.pagination ?? o) as Record<string, unknown>;
  const total = Number(meta.total ?? meta.totalItems ?? meta.totalElements ?? items.length);
  const size = Number(meta.size ?? meta.pageSize ?? meta.limit ?? (items.length || 1));
  const totalPages = Number(meta.totalPages ?? Math.max(1, Math.ceil(total / size)));
  return { items, page: Number(meta.page ?? fallbackPage), totalPages, total };
}

export interface BinProgress {
  percent: number | null;
  perBin: Partial<Record<Bin, number>>;
  mistakes: number | null;
}
/** Extrae el progreso de las respuestas de /files/{id} y /refinements. */
export function toProgress(raw: unknown): BinProgress {
  const root = (raw ?? {}) as Record<string, unknown>;
  const p = (root.progress && typeof root.progress === "object" ? root.progress : root) as Record<string, unknown>;
  const binsSrc = (p.bins ?? p.byBin ?? p.perBin ?? p) as Record<string, unknown>;
  const perBin: Partial<Record<Bin, number>> = {};
  for (const b of BINS) {
    const v = binsSrc[b];
    if (typeof v === "number") perBin[b] = v;
    else if (v && typeof v === "object") {
      const vo = v as Record<string, unknown>;
      const n = vo.percent ?? vo.percentage ?? vo.ratio ?? vo.count;
      if (typeof n === "number") perBin[b] = n;
    }
  }
  const pct = p.percent ?? p.percentage ?? p.overall ?? (typeof root.progress === "number" ? root.progress : undefined);
  const mistakes = p.mistakes ?? root.mistakes;
  return {
    percent: typeof pct === "number" ? (pct <= 1 && pct > 0 && !Number.isInteger(pct) ? pct * 100 : pct) : null,
    perBin,
    mistakes: typeof mistakes === "number" ? mistakes : null,
  };
}
