/**
 * SyncScreen — full-screen Manager-Office surface for the offline queue.
 *
 * Reuses every IPC the cashier `SyncPanel` modal already speaks
 * (`connectivity:*`, `sync:*`) but renders as a permanent module so
 * managers can audit pending operations and resolve conflicts without
 * leaving the workspace. "Sync now" forces a drain + probe.
 */
import { useCallback, useEffect, useState } from "react";
import type {
  ConflictEntry, ConnectivityState, SyncStatusView,
} from "../../../../shared/ipc-contract";
import { Banner, Button, Spinner, colors } from "../../ui/components";

function ago(ts: number | null | undefined): string {
  if (!ts) return "never";
  const d = Date.now() - ts;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

export function SyncScreen() {
  const [conn, setConn] = useState<ConnectivityState | null>(null);
  const [status, setStatus] = useState<SyncStatusView | null>(null);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [c, s, cf] = await Promise.all([
        window.khanalagao.connectivity.get(),
        window.khanalagao.sync.status(),
        window.khanalagao.sync.listConflicts(),
      ]);
      setConn(c); setStatus(s); setConflicts(cf); setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
    const offSync = window.khanalagao.sync?.onStatusChanged?.(() => { void reload(); });
    const offConn = window.khanalagao.connectivity?.onChange?.(() => { void reload(); });
    const id = window.setInterval(() => { void reload(); }, 10_000);
    return () => { offSync?.(); offConn?.(); window.clearInterval(id); };
  }, [reload]);

  const runNow = async () => {
    setBusy(true); setErr(null);
    try {
      await window.khanalagao.sync.runNow();
      await reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const resolve = async (id: number, action: "discard" | "retry" | "skip") => {
    try {
      const next = await window.khanalagao.sync.resolveConflict({ id, action });
      setConflicts(next);
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, background: colors.bg, color: colors.textPrimary }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>Sync</h1>
            <div style={{ fontSize: 12, color: colors.textDim }}>
              Offline-first queue · {status?.draining ? "draining…" : "idle"} · {conn?.online ? "online" : "offline"}
            </div>
          </div>
          <Button onClick={runNow} disabled={busy}>
            {busy ? "Syncing…" : "Sync now"}
          </Button>
        </div>

        {err && <Banner kind="error">{err}</Banner>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 18 }}>
          <Stat label="Pending operations" value={String(status?.pending ?? 0)} tone={status && status.pending > 0 ? "warn" : "ok"} />
          <Stat label="Conflicts" value={String(status?.conflicts ?? 0)} tone={status && status.conflicts > 0 ? "bad" : "ok"} />
          <Stat label="Connectivity" value={conn?.online ? `online · ${conn.latencyMs ? `${Math.round(conn.latencyMs)}ms` : ""}` : "offline"} tone={conn?.online ? "ok" : "bad"} />
          <Stat label="Last successful run" value={ago(status?.lastRunAt ?? null)} />
        </div>

        <div style={{
          background: colors.panel, border: `1px solid ${colors.border}`,
          borderRadius: 12, padding: 16, marginBottom: 16,
        }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 14 }}>Queue (oldest first)</h2>
          {!status ? <Spinner size={20} /> : status.queue.length === 0 ? (
            <div style={{ color: colors.textMuted, fontSize: 13, padding: 14 }}>Queue is empty.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: colors.textDim, textAlign: "left" }}>
                  <th style={th}>Kind</th><th style={th}>Summary</th><th style={th}>Status</th>
                  <th style={th}>Attempts</th><th style={th}>Created</th><th style={th}>Last error</th>
                </tr>
              </thead>
              <tbody>
                {status.queue.map(q => (
                  <tr key={q.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td style={td}>{q.kind}</td>
                    <td style={td}>{q.summary}</td>
                    <td style={td}>{q.status}</td>
                    <td style={td}>{q.attempts}</td>
                    <td style={td}>{ago(q.createdAt)}</td>
                    <td style={{ ...td, color: q.lastError ? "#fca5a5" : colors.textMuted }}>{q.lastError ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{
          background: colors.panel, border: `1px solid ${colors.border}`,
          borderRadius: 12, padding: 16,
        }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 14 }}>Conflicts ({conflicts.length})</h2>
          {conflicts.length === 0 ? (
            <div style={{ color: colors.textMuted, fontSize: 13, padding: 14 }}>No conflicts. The server accepts every local op.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {conflicts.map(c => (
                <div key={c.id} style={{
                  background: colors.bg, border: `1px solid ${colors.border}`,
                  borderRadius: 8, padding: 12,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.summary}</div>
                      <div style={{ fontSize: 11, color: colors.textMuted }}>
                        {c.kind} · op #{c.opId} · {new Date(c.capturedAt).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button variant="ghost" onClick={() => void resolve(c.id, "retry")}>Retry</Button>
                      <Button variant="ghost" onClick={() => void resolve(c.id, "skip")}>Skip</Button>
                      <Button variant="danger" onClick={() => void resolve(c.id, "discard")}>Discard</Button>
                    </div>
                  </div>
                  {c.details && (
                    <pre style={{
                      margin: "8px 0 0", background: colors.panel, padding: 10,
                      borderRadius: 6, fontSize: 11, color: colors.textDim,
                      whiteSpace: "pre-wrap", overflow: "auto", maxHeight: 200,
                    }}>{c.details}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 };
const td: React.CSSProperties = { padding: "8px", color: colors.textPrimary };

function Stat({ label, value, tone = "neutral" }: {
  label: string; value: string; tone?: "neutral" | "ok" | "warn" | "bad";
}) {
  const accent = tone === "ok" ? colors.success : tone === "warn" ? "#eab308" : tone === "bad" ? "#fca5a5" : colors.textPrimary;
  return (
    <div style={{
      background: colors.panel, border: `1px solid ${colors.border}`,
      borderRadius: 10, padding: 14,
    }}>
      <div style={{ fontSize: 11, color: colors.textDim, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6, color: accent }}>{value}</div>
    </div>
  );
}
