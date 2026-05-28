/**
 * Sync Center — Phase 5+ upgrade.
 *
 * Tabs:
 *   • Overview   — connectivity + per-category counters + queue head
 *   • Conflicts  — list with side-by-side diff modal
 *   • Logs       — recent sync_log entries (synced / failed / conflict)
 *   • Cache      — safe-clear of reference data (menu/tables/etc.) without
 *                  touching pending ops, conflicts, audit log, or expenses
 */
import { useEffect, useMemo, useState } from "react";
import type {
  ConnectivityState, SyncStatusView, ConflictEntry, ConflictDiff,
  SyncLogEntry, LocalStoreInfo, SyncCategoryKey,
} from "../../../../shared/ipc-contract";
import { Banner, Button, Spinner, colors } from "../../ui/components";
import { Modal } from "./Modals";

type Tab = "overview" | "conflicts" | "logs" | "cache";

const CATEGORY_LABELS: Record<SyncCategoryKey, string> = {
  shift: "Shift cash", orders: "Orders", payments: "Payments",
  prints: "Prints", expenses: "Expenses", stock: "Stock",
  customers: "Customers", audit: "Audit",
  held_bills: "Held bills", other: "Other",
};

export function SyncPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [conn, setConn] = useState<ConnectivityState | null>(null);
  const [status, setStatus] = useState<SyncStatusView | null>(null);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [local, setLocal] = useState<LocalStoreInfo | null>(null);
  const [activeDiff, setActiveDiff] = useState<ConflictDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reload = async () => {
    const [c, s, cf] = await Promise.all([
      window.khanalagao.connectivity.get(),
      window.khanalagao.sync.status(),
      window.khanalagao.sync.listConflicts(),
    ]);
    setConn(c); setStatus(s); setConflicts(cf);
    if (tab === "logs") setLogs(await window.khanalagao.sync.logs({ limit: 200 }));
    if (tab === "cache") setLocal(await window.khanalagao.local.info());
  };

  useEffect(() => {
    reload().catch((e) => setErr((e as Error).message));
    const offSync = window.khanalagao.sync.onStatusChanged(() => { void reload(); });
    const offConn = window.khanalagao.connectivity.onChange(() => { void reload(); });
    return () => { offSync(); offConn(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function runNow() {
    setBusy(true); setErr(null); setInfo(null);
    try {
      await window.khanalagao.sync.runNow();
      await reload();
      setInfo("Sync triggered.");
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

  async function openDiff(opId: number) {
    setBusy(true); setErr(null);
    try {
      const d = await window.khanalagao.sync.diffConflict({ id: opId });
      setActiveDiff(d);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function clearCache() {
    if (!window.confirm("Clear the local menu / tables / customers cache?\nPending ops, conflicts, audit log, expenses and held bills are kept.")) return;
    setBusy(true); setErr(null); setInfo(null);
    try {
      const next = await window.khanalagao.sync.clearCache();
      setLocal(next);
      setInfo("Cache cleared. Re-hydrate to pull fresh data.");
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function rehydrate() {
    setBusy(true); setErr(null); setInfo(null);
    try {
      await window.khanalagao.local.hydrate();
      const next = await window.khanalagao.local.info();
      setLocal(next);
      setInfo("Re-hydrate complete.");
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const tabs: Array<{ id: Tab; label: string; badge?: number }> = useMemo(() => [
    { id: "overview", label: "Overview" },
    { id: "conflicts", label: "Conflicts", badge: status?.conflicts ?? 0 },
    { id: "logs", label: "Logs" },
    { id: "cache", label: "Cache" },
  ], [status?.conflicts]);

  return (
    <Modal title="Sync Center" onClose={onClose} width={720}>
      {err && <div style={{ marginBottom: 12 }}><Banner kind="error">{err}</Banner></div>}
      {info && <div style={{ marginBottom: 12 }}><Banner kind="info">{info}</Banner></div>}

      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${colors.border}`, marginBottom: 14 }}>
        {tabs.map((t) => (
          <TabButton
            key={t.id} active={tab === t.id}
            badge={t.badge}
            onClick={() => setTab(t.id)}
          >{t.label}</TabButton>
        ))}
        <div style={{ flex: 1 }} />
        <Button onClick={runNow} disabled={busy} variant="ghost">
          {busy ? "Working…" : "Sync now"}
        </Button>
      </div>

      {!conn || !status ? <Spinner /> : (
        <>
          {tab === "overview" && <Overview conn={conn} status={status} />}
          {tab === "conflicts" && (
            <ConflictsList conflicts={conflicts} busy={busy} onResolve={resolve} onDiff={openDiff} />
          )}
          {tab === "logs" && <LogsList logs={logs} />}
          {tab === "cache" && (
            <CachePane local={local} busy={busy} onClear={clearCache} onHydrate={rehydrate} />
          )}
        </>
      )}

      {activeDiff && (
        <DiffModal diff={activeDiff} onClose={() => setActiveDiff(null)} />
      )}
    </Modal>
  );
}

function TabButton({ active, badge, onClick, children }: {
  active: boolean; badge?: number; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent", border: "none", padding: "8px 12px",
        borderBottom: active ? `2px solid ${colors.brand}` : "2px solid transparent",
        color: active ? colors.textPrimary : colors.textDim,
        fontWeight: active ? 600 : 500, cursor: "pointer",
      }}
    >
      {children}
      {badge != null && badge > 0 && (
        <span style={{
          marginLeft: 6, padding: "1px 6px", borderRadius: 999,
          background: colors.danger, color: "white", fontSize: 11,
        }}>{badge}</span>
      )}
    </button>
  );
}

function Overview({ conn, status }: { conn: ConnectivityState; status: SyncStatusView }) {
  const cats = Object.entries(status.categories) as Array<[SyncCategoryKey, SyncStatusView["categories"][SyncCategoryKey]]>;
  return (
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

      <div style={{ fontWeight: 600, marginBottom: 8 }}>By category</div>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14,
      }}>
        {cats.map(([key, c]) => {
          const total = c.pending + c.failed + c.conflicts;
          return (
            <div key={key} style={{
              border: `1px solid ${colors.border}`, borderRadius: 8, padding: 10,
              background: total > 0 ? "rgba(253,224,71,0.08)" : "transparent",
            }}>
              <div style={{ fontSize: 11, color: colors.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {CATEGORY_LABELS[key]}
              </div>
              <div style={{
                fontSize: 18, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums",
                color: c.conflicts > 0 ? colors.danger : c.failed > 0 ? "#fde68a" : colors.textPrimary,
              }}>{total}</div>
              <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
                {c.pending} pend · {c.failed} fail · {c.conflicts} conf
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ fontWeight: 600, marginBottom: 8 }}>Queue head</div>
      {status.queue.length === 0 ? (
        <div style={{ color: colors.textMuted, fontSize: 13 }}>Queue is empty.</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {status.queue.map((q) => (
            <div key={q.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 10 }}>
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
    </>
  );
}

function ConflictsList({ conflicts, busy, onResolve, onDiff }: {
  conflicts: ConflictEntry[]; busy: boolean;
  onResolve: (id: number, a: "discard" | "retry" | "skip") => void;
  onDiff: (opId: number) => void;
}) {
  if (conflicts.length === 0) {
    return <div style={{ color: colors.textMuted, fontSize: 13 }}>No conflicts — server is happy.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {conflicts.map((c) => (
        <div key={c.id} style={{
          border: `1px solid ${colors.danger}`, borderRadius: 8, padding: 10,
          background: "rgba(220,38,38,0.08)",
          display: "grid", gridTemplateColumns: "1fr auto auto auto auto", gap: 8, alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{c.summary}</div>
            <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
              {fmtTime(c.capturedAt)} · {c.kind}
              {c.details ? ` · ${c.details}` : ""}
            </div>
          </div>
          <Button variant="ghost" disabled={busy} onClick={() => onDiff(c.opId)}>Diff</Button>
          <Button variant="ghost" disabled={busy} onClick={() => onResolve(c.id, "retry")}>Retry</Button>
          <Button variant="ghost" disabled={busy} onClick={() => onResolve(c.id, "skip")}>Skip</Button>
          <Button variant="ghost" disabled={busy} onClick={() => onResolve(c.id, "discard")}>Discard</Button>
        </div>
      ))}
    </div>
  );
}

function LogsList({ logs }: { logs: SyncLogEntry[] }) {
  if (logs.length === 0) {
    return <div style={{ color: colors.textMuted, fontSize: 13 }}>No log entries yet.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 4, maxHeight: 420, overflow: "auto" }}>
      {logs.map((l) => {
        const tone =
          l.outcome === "synced" ? colors.success :
          l.outcome === "conflict" ? colors.danger :
          l.outcome === "failed" ? "#fde68a" : colors.textDim;
        return (
          <div key={l.id} style={{
            display: "grid", gridTemplateColumns: "auto auto 1fr auto", gap: 8,
            fontSize: 12, fontFamily: "monospace", padding: "4px 8px",
            borderLeft: `3px solid ${tone}`, background: colors.bg, borderRadius: 4,
          }}>
            <span style={{ color: colors.textDim }}>{fmtTime(l.at)}</span>
            <span style={{ color: tone, fontWeight: 600, minWidth: 70 }}>{l.outcome}</span>
            <span style={{ color: colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {l.kind}{l.details ? ` · ${l.details}` : ""}
            </span>
            {l.opId != null && <span style={{ color: colors.textDim }}>#{l.opId}</span>}
          </div>
        );
      })}
    </div>
  );
}

function CachePane({ local, busy, onClear, onHydrate }: {
  local: LocalStoreInfo | null; busy: boolean;
  onClear: () => void; onHydrate: () => void;
}) {
  if (!local) return <Spinner />;
  const sizeMb = (local.sizeBytes / (1024 * 1024)).toFixed(2);
  return (
    <>
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10,
        background: colors.bg, padding: 12, borderRadius: 8, marginBottom: 14,
      }}>
        <Stat label="DB size" value={`${sizeMb} MB`} />
        <Stat label="Last hydrate" value={fmtTime(local.hydrateLastAt)} />
        <Stat label="Tables" value={String(Object.keys(local.counts).length)} />
      </div>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Row counts</div>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 14, fontSize: 12,
      }}>
        {Object.entries(local.counts).map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "2px 6px" }}>
            <span style={{ color: colors.textDim, fontFamily: "monospace" }}>{k}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="ghost" disabled={busy} onClick={onClear}>Clear safe cache</Button>
        <Button disabled={busy} onClick={onHydrate}>Re-hydrate now</Button>
      </div>
      <div style={{ fontSize: 11, color: colors.textDim, marginTop: 8 }}>
        "Safe" clear removes menu / tables / customers / outlet settings. Pending
        ops, conflicts, audit log, expenses, stock actions, held bills and the
        sync log are preserved.
      </div>
    </>
  );
}

function DiffModal({ diff, onClose }: { diff: ConflictDiff; onClose: () => void }) {
  return (
    <Modal title={`Conflict diff · ${diff.kind}`} onClose={onClose} width={760}>
      <div style={{ fontSize: 12, color: colors.textDim, marginBottom: 10 }}>
        Op #{diff.opId} · captured {fmtTime(diff.capturedAt)}
        {diff.server.status != null ? ` · HTTP ${diff.server.status}` : ""}
      </div>
      {diff.message && <div style={{ marginBottom: 10 }}><Banner kind="error">{diff.message}</Banner></div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <DiffPanel title="Local payload" value={diff.local} />
        <DiffPanel title="Server response" value={diff.server.body} />
      </div>
    </Modal>
  );
}

function DiffPanel({ title, value }: { title: string; value: unknown }) {
  let text = "";
  try { text = JSON.stringify(value, null, 2); }
  catch { text = String(value); }
  return (
    <div>
      <div style={{ fontSize: 11, color: colors.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{title}</div>
      <pre style={{
        margin: 0, padding: 10, background: colors.bg, borderRadius: 6,
        fontSize: 11, maxHeight: 360, overflow: "auto",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>{text || "—"}</pre>
    </div>
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
