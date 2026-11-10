import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErrorBoundary } from "./ErrorBoundary";
import { Suspense } from "react";

const link = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded ${isActive ? "bg-teal-800 text-white" : "text-slate-200 hover:bg-slate-800"}`;

export function Layout() {
  const { me, logout, can } = useAuth();
  const loc = useLocation();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900">
        <nav aria-label="Principal" className="flex flex-wrap items-center gap-2 px-4 py-2">
          <span className="font-bold tracking-widest text-teal-300 mr-4">LUMON · MDR</span>
          {can("files:read") && <NavLink to="/files" className={link}>Archivos</NavLink>}
          <NavLink to="/estado" className={link}>Estado</NavLink>
          <span className="ml-auto text-sm text-slate-300">
            {me?.team?.code} · {me?.user?.displayName ?? me?.displayName ?? me?.user?.email ?? me?.email} ·{" "}
            {me?.role?.name}
          </span>
          <button onClick={() => void logout()} className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600">
            Salir
          </button>
        </nav>
      </header>
      <main id="main" className="flex-1">
        <ErrorBoundary resetKey={loc.pathname}>
          <Suspense fallback={<p className="p-8 text-slate-300" role="status">Cargando…</p>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
