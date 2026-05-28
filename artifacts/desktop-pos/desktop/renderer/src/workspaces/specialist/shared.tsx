/**
 * Shared building blocks for the specialist workspace screens.
 *
 * Keeps the inventory/accountant/marketing/delivery surfaces visually
 * consistent without leaking any single workspace's concerns. These
 * helpers are intentionally tiny — the workspaces ship as plain
 * top-down React; we don't want a half-baked design system getting in
 * the way of the real wiring work.
 */
import { useEffect, useState } from "react";
import { colors, Button, Input } from "../../ui/components";

export function PageShell({ title, actions, attention, children }: {
  title: string;
  actions?: React.ReactNode;
  attention?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <header style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "16px 22px", borderBottom: `1px solid ${colors.border}`,
        background: colors.panel,
      }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: colors.textPrimary, margin: 0, flex: 1 }}>
          {title}
        </h1>
        <div style={{ display: "flex", gap: 8 }}>{actions}</div>
      </header>
      {attention && (
        <div style={{
          padding: "10px 22px",
          background: "#3a1d10",
          borderBottom: `1px solid ${colors.borderStrong}`,
          color: "#fde7d6", fontSize: 13,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 14 }}>⚠️</span>
          {attention}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 22 }}>
        {children}
      </div>
    </div>
  );
}

export function Empty({ title, hint, icon = "∅" }: { title: string; hint?: string; icon?: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 48, color: colors.textDim, gap: 8, textAlign: "center",
    }}>
      <div style={{ fontSize: 32, color: colors.textMuted }}>{icon}</div>
      <div style={{ fontSize: 15, color: colors.textPrimary, fontWeight: 600 }}>{title}</div>
      {hint && <div style={{ fontSize: 13, maxWidth: 380, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

export function PendingBackend({ feature, quickActions }: {
  feature: string;
  /**
   * Optional list of "quick action" labels — rendered as disabled
   * buttons under the placeholder so the role surface advertises the
   * intended flow even before the API exists. Each entry stays
   * non-interactive (no dead navigation), but communicates to the
   * operator what this module will offer.
   */
  quickActions?: string[];
}) {
  return (
    <>
      <Empty
        icon="⚙"
        title={`${feature} — server endpoint pending`}
        hint={`This module is registered in the workspace nav so the role surface stays complete, but the matching API has not been built yet. The screen will light up automatically once the endpoint is shipped.`}
      />
      {quickActions && quickActions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 18 }}>
          {quickActions.map((label) => (
            <button key={label} disabled title="Endpoint pending — see PHASE6_BACKEND_GAPS.md"
              style={{
                padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: colors.panel, color: colors.textMuted,
                border: `1px dashed ${colors.borderStrong}`, cursor: "not-allowed",
              }}>
              {label} <span style={{ opacity: 0.6, fontWeight: 400 }}>· pending</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div style={{
      padding: 16, borderRadius: 10, border: `1px solid ${colors.borderStrong}`,
      background: "#2d0c0c", color: "#fcd7d7", fontSize: 13, display: "flex", gap: 12, alignItems: "center",
    }}>
      <span style={{ fontSize: 16 }}>⚠</span>
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && <Button variant="ghost" onClick={onRetry} style={{ padding: "6px 10px", fontSize: 12 }}>Retry</Button>}
    </div>
  );
}

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          height: 44, borderRadius: 8, background: colors.panelAlt,
          opacity: 0.6 - (i / rows) * 0.3,
        }} />
      ))}
    </div>
  );
}

/** Generic async data hook — replaces a wall of useState/useEffect copy-paste. */
export function useAsync<T>(fetcher: () => Promise<T>, deps: React.DependencyList = []): {
  data: T | null; loading: boolean; error: string | null; reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    fetcher()
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, bump]);
  return { data, loading, error, reload: () => setBump((x) => x + 1) };
}

/** Slide-over drawer for quick-action forms — keyboard-friendly. */
export function Drawer({ open, title, onClose, children, footer }: {
  open: boolean; title: string; onClose: () => void;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 100, display: "flex", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460, maxWidth: "92vw", background: colors.panel,
          borderLeft: `1px solid ${colors.borderStrong}`,
          display: "flex", flexDirection: "column", height: "100%",
        }}
      >
        <header style={{
          padding: "16px 18px", borderBottom: `1px solid ${colors.border}`,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.textPrimary, flex: 1 }}>{title}</h2>
          <button onClick={onClose} style={{
            background: "transparent", border: 0, color: colors.textDim,
            cursor: "pointer", fontSize: 20,
          }}>×</button>
        </header>
        <div style={{ flex: 1, overflow: "auto", padding: 18 }}>{children}</div>
        {footer && (
          <footer style={{
            padding: 14, borderTop: `1px solid ${colors.border}`,
            display: "flex", gap: 8, justifyContent: "flex-end",
          }}>{footer}</footer>
        )}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: colors.textDim, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div style={{
      padding: 14, borderRadius: 10, border: `1px solid ${colors.border}`,
      background: colors.panel, minWidth: 160,
    }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: colors.textMuted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>{children}</div>
  );
}

/** Lightweight data table — wraps a list of objects in a clean grid. */
export function DataTable<T>(
  { columns, rows, empty, rowKey, onRowClick }: {
    columns: Array<{ key: string; header: string; render?: (r: T) => React.ReactNode; width?: string | number; align?: "left" | "right" | "center" }>;
    rows: T[];
    empty: React.ReactNode;
    rowKey: (r: T, i: number) => string | number;
    onRowClick?: (r: T) => void;
  },
) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 10, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: colors.panelAlt }}>
            {columns.map((c) => (
              <th key={c.key} style={{
                textAlign: c.align ?? "left", padding: "10px 12px",
                color: colors.textDim, fontWeight: 600, fontSize: 11,
                textTransform: "uppercase", letterSpacing: 0.4,
                width: c.width, borderBottom: `1px solid ${colors.border}`,
              }}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={rowKey(r, i)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              style={{
                background: i % 2 === 0 ? colors.panel : colors.bg,
                cursor: onRowClick ? "pointer" : "default",
              }}
            >
              {columns.map((c) => (
                <td key={c.key} style={{
                  padding: "10px 12px", color: colors.textPrimary,
                  borderTop: `1px solid ${colors.border}`,
                  textAlign: c.align ?? "left", verticalAlign: "middle",
                }}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Re-exports so screens don't need a long list of imports each. */
export { colors, Button, Input };

export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function fmtMoney(v: unknown, currency = "₹"): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

export function fmtDateShort(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString();
}

export function StatusPill({ status, tone }: { status: string; tone?: "ok" | "warn" | "bad" | "info" }) {
  const palette: Record<string, [string, string]> = {
    ok:   ["#0b3d20", "#7ee0a5"],
    warn: ["#3a2a0b", "#facc15"],
    bad:  ["#3a0d0d", "#fca5a5"],
    info: ["#0c2540", "#93c5fd"],
  };
  const [bg, fg] = palette[tone ?? "info"];
  return (
    <span style={{
      display: "inline-block", padding: "3px 8px", borderRadius: 999,
      background: bg, color: fg, fontSize: 11, fontWeight: 600,
      textTransform: "capitalize",
    }}>{status}</span>
  );
}

/** Sync Center reuses the existing sync panel via window.khanalagao.sync.* */
export function SyncCenter() {
  const [status, setStatus] = useState<{ pending: number; conflicts: number; lastRunAt: number | null; online: boolean; lastError: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try { const s = await window.khanalagao.sync.status(); setStatus(s); }
    catch (e) { /* status unavailable */ void e; }
  };
  useEffect(() => {
    void refresh();
    const off = window.khanalagao.sync.onStatusChanged(() => void refresh());
    return () => { off?.(); };
  }, []);
  return (
    <PageShell title="Sync Center">
      <StatRow>
        <Stat label="Pending operations" value={status?.pending ?? "—"} />
        <Stat label="Conflicts" value={status?.conflicts ?? "—"} />
        <Stat label="Connection" value={status?.online ? "Online" : "Offline"} />
        <Stat label="Last sync" value={status?.lastRunAt ? new Date(status.lastRunAt).toLocaleTimeString() : "—"} />
      </StatRow>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { const s = await window.khanalagao.sync.runNow(); setStatus(s); }
            finally { setBusy(false); }
          }}
        >{busy ? "Syncing…" : "Sync now"}</Button>
        <Button variant="ghost" onClick={() => void refresh()}>Refresh status</Button>
      </div>
      {status?.lastError && (
        <ErrorBox message={`Last error: ${status.lastError}`} />
      )}
      <div style={{ marginTop: 20, color: colors.textDim, fontSize: 13, lineHeight: 1.6 }}>
        The desktop POS queues offline changes locally and replays them when the
        connection is back. The richer queue inspector and conflict resolver
        ship with the offline/sync task — this entry point keeps the surface
        reachable from every specialist workspace.
      </div>
    </PageShell>
  );
}
