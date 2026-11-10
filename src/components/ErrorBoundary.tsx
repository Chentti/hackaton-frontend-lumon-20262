import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }
  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section role="alert" className="p-8 space-y-3">
        <h1 className="text-2xl font-semibold">Algo falló en esta sección</h1>
        <p className="text-slate-300">{this.state.error.message}</p>
        <div className="flex gap-3">
          <button className="rounded bg-teal-700 px-3 py-2" onClick={() => this.setState({ error: null })}>
            Reintentar
          </button>
          <a className="rounded bg-slate-700 px-3 py-2" href="/files">Volver a archivos</a>
        </div>
      </section>
    );
  }
}
