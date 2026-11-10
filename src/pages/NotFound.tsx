import { Link } from "react-router-dom";
export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center p-6 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="text-slate-300">Esta sala no existe en el piso separado.</p>
        <Link to="/files" className="text-teal-300 underline">Volver a archivos</Link>
      </div>
    </main>
  );
}
