function strip(v: string | undefined): string {
  return (v ?? "").replace(/\/+$/, "");
}
export const API_BASE = strip(import.meta.env.VITE_API_BASE_URL);
export const WS_BASE = strip(import.meta.env.VITE_WS_BASE_URL);
export const BUILD = __LUMON_BUILD__;
