import { API_BASE, BUILD } from "../config";
import type { TokenResponse } from "./contract";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = null,
    public headers: Headers | null = null,
  ) {
    super(message);
  }
}

const RT_KEY = "lumon.rt";
export const authChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("lumon-auth") : null;

// El access token vive SOLO en memoria.
let accessToken: string | null = null;
let refreshPromise: Promise<string> | null = null;
let blockedUntil = 0;
let sessionLostHandler: (code: string) => void = () => {};

export function onSessionLost(fn: (code: string) => void): void {
  sessionLostHandler = fn;
}
export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(RT_KEY);
  } catch {
    return null;
  }
}
function setRefreshToken(rt: string | null): void {
  try {
    if (rt) localStorage.setItem(RT_KEY, rt);
    else localStorage.removeItem(RT_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}
export function setSession(t: TokenResponse): void {
  accessToken = t.accessToken;
  setRefreshToken(t.refreshToken);
}
export function clearLocalSession(): void {
  accessToken = null;
  setRefreshToken(null);
}
export function getAccessToken(): string | null {
  return accessToken;
}

export function sessionLost(code: string): void {
  clearLocalSession();
  authChannel?.postMessage({ type: "revoked", code });
  sessionLostHandler(code);
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

export function backoff(attempt: number, base = 500, max = 15000): number {
  const exp = Math.min(max, base * 2 ** attempt);
  return exp / 2 + Math.random() * (exp / 2);
}

export function retryAfterMs(h: Headers | null, fallback: number): number {
  const v = h?.get("Retry-After");
  if (!v) return fallback;
  const s = Number(v);
  if (!Number.isNaN(s)) return Math.max(0, s * 1000);
  const d = Date.parse(v);
  return Number.isNaN(d) ? fallback : Math.max(0, d - Date.now());
}

function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Lumon-Build", BUILD);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

async function toError(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* sin cuerpo */
  }
  return new ApiError(
    res.status,
    typeof body.error === "string" ? body.error : `HTTP_${res.status}`,
    typeof body.message === "string" ? body.message : res.statusText || "Error",
    body.details ?? null,
    res.headers,
  );
}

/**
 * Refresh coordinado:
 * - en la pestaña: una sola promesa compartida;
 * - entre pestañas: Web Lock + se lee el refresh token más reciente DENTRO del lock,
 *   así nunca se presenta uno ya usado.
 */
async function doRefresh(): Promise<string> {
  const run = async (): Promise<string> => {
    const rt = getRefreshToken();
    if (!rt) throw new ApiError(401, "NO_SESSION", "No hay sesión.");
    const res = await rawFetch("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) {
      const err = await toError(res);
      if (res.status === 401 || res.status === 403) sessionLost(err.code);
      throw err;
    }
    const data = (await res.json()) as TokenResponse;
    setSession(data);
    return data.accessToken;
  };
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("lumon-refresh", run);
  }
  return run();
}

export function refreshAccess(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  auth?: boolean;
  /** Reintentar errores de red (solo para requests idempotentes o con Idempotency-Key). */
  retryNetwork?: boolean;
  maxRetries?: number;
}

export interface ApiResult<T> {
  data: T;
  status: number;
  headers: Headers;
}

export async function apiFull<T>(path: string, opts: ApiOptions = {}): Promise<ApiResult<T>> {
  const method = opts.method ?? "GET";
  const auth = opts.auth ?? true;
  const maxRetries = opts.maxRetries ?? 4;
  const retryNetwork = opts.retryNetwork ?? method === "GET";
  let refreshed = false;
  let attempt = 0;

  for (;;) {
    // Respeta Retry-After global: nada sale hasta que pase.
    const gate = blockedUntil - Date.now();
    if (gate > 0) await sleep(gate, opts.signal);
    const headers = new Headers(opts.headers);
    if (opts.body !== undefined) headers.set("Content-Type", "application/json");
    const tokenUsed = accessToken;
    if (auth && tokenUsed) headers.set("Authorization", `Bearer ${tokenUsed}`);

    let res: Response;
    try {
      res = await rawFetch(path, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (retryNetwork && attempt < maxRetries) {
        await sleep(backoff(attempt++), opts.signal);
        continue;
      }
      throw new ApiError(0, "NETWORK_ERROR", "No se pudo conectar con Lumon.");
    }

    if (res.status === 401 && auth) {
      const err = await toError(res);
      if (err.code === "TOKEN_EXPIRED" && !refreshed) {
        refreshed = true;
        // Si otra request ya renovó el token mientras tanto, reintenta sin refrescar.
        if (accessToken === tokenUsed || !accessToken) await refreshAccess();
        continue;
      }
      if (err.code === "SESSION_REVOKED" || err.code === "REFRESH_REUSED" || err.code === "TOKEN_INVALID") {
        sessionLost(err.code);
      }
      throw err;
    }

    if ((res.status === 503 || res.status === 502 || res.status === 504) && attempt < maxRetries) {
      const wait = retryAfterMs(res.headers, backoff(attempt));
      attempt++;
      await sleep(wait, opts.signal);
      continue;
    }

    if (res.status === 429) {
      blockedUntil = Math.max(blockedUntil, Date.now() + retryAfterMs(res.headers, backoff(attempt, 1000)));
    }
    if (res.status === 429 && attempt < maxRetries) {
      const wait = Math.max(0, blockedUntil - Date.now());
      attempt++;
      await sleep(wait, opts.signal);
      continue;
    }

    if (!res.ok) throw await toError(res);

    let data: unknown = null;
    if (res.status !== 204) {
      const text = await res.text();
      data = text ? (JSON.parse(text) as unknown) : null;
    }
    return { data: data as T, status: res.status, headers: res.headers };
  }
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  return (await apiFull<T>(path, opts)).data;
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

export function uuid(): string {
  return crypto.randomUUID();
}
