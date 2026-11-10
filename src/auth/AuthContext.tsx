import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  authChannel,
  clearLocalSession,
  getRefreshToken,
  onSessionLost,
  refreshAccess,
  setSession,
} from "../api/client";
import type { Me, TokenResponse } from "../api/contract";

type Status = "loading" | "authed" | "anon";

interface AuthValue {
  status: Status;
  me: Me | null;
  notice: string | null;
  can: (perm: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (body: Record<string, string>) => Promise<void>;
  logout: () => Promise<void>;
  reloadMe: () => Promise<void>;
  clearNotice: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

const REVOKE_MSG: Record<string, string> = {
  REFRESH_REUSED: "Tu sesión se cerró por seguridad: se detectó un refresh token reutilizado. Vuelve a ingresar.",
  SESSION_REVOKED: "Tu sesión fue revocada. Vuelve a ingresar.",
  TOKEN_INVALID: "Tu sesión no es válida. Vuelve a ingresar.",
  LOGOUT: "Cerraste sesión.",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const goAnon = useCallback((code: string | null) => {
    clearLocalSession();
    setMe(null);
    setStatus("anon");
    setNotice(code ? REVOKE_MSG[code] ?? "La sesión terminó. Vuelve a ingresar." : null);
  }, []);

  const reloadMe = useCallback(async () => {
    const m = await api<Me>("/auth/me");
    setMe(m);
    setStatus("authed");
  }, []);

  // Restauración de sesión al recargar.
  useEffect(() => {
    onSessionLost((code) => goAnon(code));
    if (!getRefreshToken()) {
      setStatus("anon");
      return;
    }
    refreshAccess()
      .then(reloadMe)
      .catch(() => {
        if (!getRefreshToken()) goAnon(null);
        else setStatus("anon");
      });
  }, [goAnon, reloadMe]);

  // Varias pestañas: logout / revocación se propagan.
  useEffect(() => {
    const onMsg = (e: MessageEvent<{ type: string; code?: string }>) => {
      if (e.data.type === "logout") goAnon("LOGOUT");
      if (e.data.type === "revoked") goAnon(e.data.code ?? "SESSION_REVOKED");
      if (e.data.type === "login" && status !== "authed") {
        refreshAccess().then(reloadMe).catch(() => undefined);
      }
    };
    authChannel?.addEventListener("message", onMsg);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "lumon.rt" && e.newValue === null && status === "authed") goAnon("LOGOUT");
    };
    window.addEventListener("storage", onStorage);
    return () => {
      authChannel?.removeEventListener("message", onMsg);
      window.removeEventListener("storage", onStorage);
    };
  }, [goAnon, reloadMe, status]);

  const afterTokens = useCallback(
    async (t: TokenResponse) => {
      setSession(t);
      setNotice(null);
      await reloadMe();
      authChannel?.postMessage({ type: "login" });
    },
    [reloadMe],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const t = await api<TokenResponse>("/auth/login", { method: "POST", body: { email, password }, auth: false });
      await afterTokens(t);
    },
    [afterTokens],
  );

  const register = useCallback(
    async (body: Record<string, string>) => {
      const t = await api<TokenResponse>("/auth/register", { method: "POST", body, auth: false });
      await afterTokens(t);
    },
    [afterTokens],
  );

  const logout = useCallback(async () => {
    const rt = getRefreshToken();
    try {
      await api("/auth/logout", { method: "POST", body: { refreshToken: rt }, maxRetries: 1 });
    } catch {
      /* igual cerramos localmente */
    }
    authChannel?.postMessage({ type: "logout" });
    goAnon("LOGOUT");
  }, [goAnon]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      notice,
      can: (perm) => !!me?.permissions?.includes(perm),
      login,
      register,
      logout,
      reloadMe,
      clearNotice: () => setNotice(null),
    }),
    [status, me, notice, login, register, logout, reloadMe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth fuera de AuthProvider");
  return v;
}
