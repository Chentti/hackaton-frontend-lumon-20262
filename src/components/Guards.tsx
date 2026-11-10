import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Splash() {
  return (
    <main className="min-h-screen grid place-items-center" role="status" aria-live="polite">
      <p className="text-slate-300">Verificando sesión…</p>
    </main>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === "loading") return <Splash />;
  if (status === "anon") {
    const next = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

export function RequirePerm({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <NoPermission perm={perm} />;
  return <>{children}</>;
}

export function NoPermission({ perm }: { perm: string }) {
  return (
    <section className="p-8 space-y-2">
      <h1 className="text-2xl font-semibold">Sin permiso</h1>
      <p className="text-slate-300">
        Tu rol no tiene el permiso <code className="text-teal-300">{perm}</code> necesario para esta sección.
      </p>
    </section>
  );
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === "loading") return <Splash />;
  if (status === "authed") {
    const next = new URLSearchParams(loc.search).get("next");
    return <Navigate to={safeNext(next)} replace />;
  }
  return <>{children}</>;
}

export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/files";
  return next;
}
