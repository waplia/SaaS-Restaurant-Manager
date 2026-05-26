/**
 * Sync panel — Phase 5.
 *
 * Shows the live state of the offline queue:
 *   • Connectivity (latency, last check)
 *   • Pending operations queue (oldest-first)
 *   • Conflicts tray (rejected by server — discard or retry)
 *
 * "Sync now" forces a probe + drain so the cashier doesn't have to wait
 * the 10s polling interval.
 */
import { useEffect, useState } from "react";
import type {
  ConnectivityState, SyncStatusView, ConflictEntry,
} from "../../../../shared/ipc-contract";
import { Banner, Button, Spinner, colors } from "../../ui/components";
import { Modal } from "./Modals";

export function SyncPanel({ onClose }: { onClose: () => void }) {
  const [conn, setConn] = useState<ConnectivityState | null>(null);
  const [status, setStatus] = useState<SyncStatusView | null>(null);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    const [c, s, cf] = await Promise.all([
      window.khanalagao.connectivity.get(),
      window.khanalagao.sync.status(),
      window.khanalagao.sync.listConflicts(),
    ]);
    setConn(c); setStatus(s); setConflicts(cf);
  };

  useEffect(() => {
    reload().catch((e) => setErr((e as Error).message));
    const offSync = window.khanalagao.sync.onStatusChanged(() => { void reload(); });
    const offConn = window.khanalagao.connectivity.onChange(() => { void reload(); });
    return () => { offSync(); offConn(); };
  }, []);

  async function runNow() {
    setBusy(true); setErr(null);
    try {
      await window.khanalagao.sync.runNow();
      await reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function resolve(id: number, action: "discard" | "retry" | "skip") {
    setBusy(true); setErr(null);
    try {
      const next = await window.khanalagao.sync.resolveConflict({ id, action });
      setConflicts(next);
      await reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Sync status" onClose={onClose} width={620}>
      {err && <div style={{ marginBottom: 12 }}><Banner kind="error">{err}</Banner></div>}
      {!conn || !status ? <Spinner /> : (
        <>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10,
            background: colors.bg, padding: 12, borderRadius: 8, marginBottom: 14,
          }}>
            <Stat label="Connection" value={conn.online ? "Online" : "Offline"} highlight tone={conn.online ? "ok" : "bad"} />
            <Stat label="Pending" value={String(status.pending)} highlight tone={status.pending > 0 ? "warn" : "ok"} />
            <Stat label="Conflicts" value={String(status.conflicts)} highlight tone={status.conflicts > 0 ? "bad" : "ok"} />
            <Stat label="Latency" value={conn.latencyMs != null ? `${conn.latencyMs} ms` : "—"} />
            <Stat label="Last check" value={fmtTime(conn.lastCheckedAt)} />
            <Stat label="Last drain" value={fmtTime(status.lastRunAt)} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 600 }}>Pending operations</div>
            <Button onClick={runNow} disabled={busy} variant="ghost">
              {busy ? "Working…" : "Sync now"}
            </Button>
          </div>
          {status.queue.length === 0 ? (
            <div style={{ color: colors.textMuted, fontSize: 13, marginBottom: 14 }}>Queue is empty.</div>
          ) : (
            <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
              {status.queue.map((q) => (
                <div key={q.id} style={{
                  border: `1px solid ${colors.border}`, borderRadius: 8, padding: 10,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{q.summary}</span>
                    <span style={{ color: colors.textDim, fontFamily: "monospace" }}>{q.kind}</span>
                  </div>
                  <div style={{ fontSize: 11, color: colors.textDim, marginTop: 4 }}>
                    {fmtTime(q.createdAt)} · attempts {q.attempts} · {q.status}
                    {q.lastError ? ` · ${q.lastError}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontWeight: 600, marginBottom: 8 }}>Conflicts</div>
          {conflicts.length === 0 ? (
            <div style={{ color: colors.textMuted, fontSize: 13 }}>No conflicts — server is happy.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {conflicts.map((c) => (
                <div key={c.id} style={{
                  border: `1px solid ${colors.danger}`, borderRadius: 8, padding: 10,
                  background: "rgba(220,38,38,0.08)",
                  display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 8, alignItems: "center",
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{c.summary}</div>
                    <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
                      {fmtTime(c.capturedAt)} · {c.kind}
                      {c.details ? ` · ${c.details}` : ""}
                    </div>
                  </div>
                  <Button variant="ghost" disabled={busy} onClick={() => void resolve(c.id, "retry")}>Retry</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void resolve(c.id, "skip")}>Skip</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void resolve(c.id, "discard")}>Discard</Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

function Stat({ label, value, highlight, tone }: {
  label: string; value: string; highlight?: boolean;
  tone?: "ok" | "warn" | "bad";
}) {
  const color = tone === "ok" ? colors.success
    : tone === "warn" ? "#fde68a"
    : tone === "bad" ? colors.danger
    : colors.textPrimary;
  return (
    <div>
      <div style={{ fontSize: 11, color: colors.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{
        fontSize: highlight ? 16 : 13,
        fontWeight: highlight ? 700 : 500, color,
        fontVariantNumeric: "tabular-nums", marginTop: 2,
      }}>{value}</div>
    </div>
  );
}
