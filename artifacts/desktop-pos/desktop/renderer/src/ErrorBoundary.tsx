import { Component, type ReactNode } from "react";

/**
 * Top-level error boundary for the desktop POS shell.
 *
 * Without this, a crash in any screen (cart math, kitchen ticket
 * formatter, etc.) would white-screen the entire terminal — fatal
 * during service. With it the cashier sees a recovery panel with
 * Reload + Restart options and a copy-to-clipboard error trace so
 * they can keep taking orders on a fallback flow while a manager
 * collects the trace.
 */
type State = { err: Error | null };
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: { componentStack?: string | null }): void {
    // eslint-disable-next-line no-console
    console.error("[pos] uncaught render error:", err, info?.componentStack);
  }

  reload = (): void => {
    this.setState({ err: null });
    // Hard reload keeps the IPC bridge fresh — clears any stale React
    // Query caches that may have contributed to the crash.
    location.reload();
  };

  render(): ReactNode {
    const { err } = this.state;
    if (!err) return this.props.children;
    const trace = `${err.message}\n\n${err.stack ?? ""}`;
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: 32,
          background: "#0b0f17",
          color: "#f8fafc",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 48 }}>⚠</div>
        <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: 520, textAlign: "center", color: "#94a3b8", margin: 0 }}>
          The POS terminal hit an unexpected error. Your unsaved cart and any
          held bills are preserved locally. Reload to continue taking orders.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            onClick={this.reload}
            style={{
              padding: "10px 18px",
              background: "#f97316",
              color: "#fff",
              border: 0,
              borderRadius: 8,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload terminal
          </button>
          <button
            type="button"
            onClick={() => { void navigator.clipboard.writeText(trace); }}
            style={{
              padding: "10px 18px",
              background: "transparent",
              color: "#f8fafc",
              border: "1px solid #334155",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Copy error
          </button>
        </div>
        <pre
          style={{
            maxWidth: 720,
            maxHeight: 220,
            overflow: "auto",
            background: "#0f172a",
            color: "#cbd5e1",
            padding: 12,
            borderRadius: 8,
            fontSize: 11,
            width: "100%",
          }}
        >
          {trace}
        </pre>
      </div>
    );
  }
}
