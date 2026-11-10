import { lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { HealthGate } from "./components/HealthGate";
import { RedirectIfAuthed, RequireAuth, RequirePerm } from "./components/Guards";
import { Layout } from "./components/Layout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Login from "./pages/Login";
import Register from "./pages/Register";
import NotFound from "./pages/NotFound";

const Files = lazy(() => import("./pages/Files"));
const Refine = lazy(() => import("./refine/Refine"));
const Estado = lazy(() => import("./pages/Estado"));

export default function App() {
  return (
    <ErrorBoundary>
      <HealthGate>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<RedirectIfAuthed><Login /></RedirectIfAuthed>} />
              <Route path="/register" element={<RedirectIfAuthed><Register /></RedirectIfAuthed>} />
              <Route element={<RequireAuth><Layout /></RequireAuth>}>
                <Route path="/" element={<Navigate to="/files" replace />} />
                <Route path="/estado" element={<Estado />} />
                <Route path="/files" element={<RequirePerm perm="files:read"><Files /></RequirePerm>} />
                <Route path="/files/:id/refine" element={<RequirePerm perm="files:read"><Refine /></RequirePerm>} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </HealthGate>
    </ErrorBoundary>
  );
}
