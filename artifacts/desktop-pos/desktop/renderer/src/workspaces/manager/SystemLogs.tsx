/**
 * SystemLogs — desktop-native System / Logs panel.
 *
 * Surfaces every diagnostic the desktop IPC exposes today:
 *   • App version + platform           (`app:version`)
 *   • Connectivity                     (`connectivity:get`)
 *   • Local store info (path, size,
 *     row counts, last hydrate)        (`local:info`)
 *   • Sync queue (head)                (`sync:status`)
 *   • Sync conflicts                   (`sync:conflicts:list`)
 *   • Failed prints                    (`failed-prints:list`)
 *   • Scanner state                    (`scanner:get-state`)
 *
 * Read-only by design — destructive actions (local:reset, conflict
 * resolve, print retry) are intentionally kept on their dedicated
 * surfaces (Sync screen, Hardware screen) so this stays a safe
 * everywhere-visible diagnostic.
 */
import { useEffect, useState } from "react";
import type {
  ConflictEntry, ConnectivityState, FailedPrintEntry,
  LocalStoreInfo, SyncStatusView,
} from "../../../../shared/ipc-contract";
import { Banner, Spinner, colors } from "../../ui/components";

interface Props {
  onNavigate?: (key: string) => void;
}

function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function relTime(ts: number | null | undefined): string {
  if (!ts) return "never";
  return new Date(ts).toLocaleString();
}

export function SystemLogs({ onNavigate }: Props) {
  const [version, setVersion] = useState<{ version: string; platform: string } | null>(null);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnectivityState | null>(null);
  const [sync, setSync] = useState<SyncStatusView | null>(null);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [local, setLocal] = useState<LocalStoreInfo | null>(null);
  const [failed, setFailed] = useState<FailedPrintEntry[]>([]);
  const [scanner, setScanner] = useState<{ enabled: boolean; lastScans: Array<{ at: number; value: string }> } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const reload = async () => {
      try {
        const [v, s, c, sy, cf, li, fp, sc] = await Promise.all([
          window.khanalagao.app.version().catch(() => null),
          window.khanalagao.settings.get().catch(() => null),
          window.khanalagao.connectivity.get().catch(() => null),
          window.khanalagao.sync.status().catch(() => null),
          window.khanalagao.sync.listConflicts().catch(() => []),
          window.khanalagao.local.info().catch(() => null),
          window.khanalagao.failedPrints.list().catch(() => []),
          window.khanalagao.scanner.getState().catch(() => null),
        ]);
        if (!alive) return;
        setVersion(v); setApiBaseUrl(s?.apiBaseUrl ?? null);
        setConn(c); setSync(sy); setConflicts(cf ?? []);
        setLocal(li); setFailed(fp ?? []); setScanner(sc);
        setErr(null);
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    };
    void reload();
    const id = window.setInterval(reload, 20_000);
    const offSync = window.khanalagao.sync?.onStatusChanged?.(reload);
    const offConn = window.khanalagao.connectivity?.onChange?.(reload);
    const offPrints = window.khanalagao.failedPrints?.onChanged?.(reload);
    return () => {
      alive = false;
      window.clearInterval(id);
      offSync?.(); offConn?.(); offPrints?.();
    };
  }, []);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, background: colors.bg, color: colors.textPrimary }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 22 }}>System & Logs</h1>
        <div style={{ fontSize: 12, color: colors.textDim, marginBottom: 18 }}>
          Live diagnostics for this desktop install — connectivity, sync queue, local cache, hardware.
        </div>

        {err && <Banner kind="error">{err}</Banner>}

        <Grid>
          <Panel title="App">
            <KV k="Version">{version?.version ?? "—"}</KV>
            <KV k="Platform">{version?.platform ?? "—"}</KV>
            <KV k="API server" mono>{apiBaseUrl ?? "—"}</KV>
          </Panel>

          <Panel title="Connectivity" tone={conn?.online ? "ok" : "bad"}>
            <KV k="State">{conn?.online ? "Online" : "Offline"}</KV>
            <KV k="Latency">{conn?.latencyMs != null ? `${Math.round(conn.latencyMs)} ms` : "—"}</KV>
            <KV k="Last check">{relTime(conn?.lastCheckedAt ?? null)}</KV>
            {conn?.error && <KV k="Last error" mono>{conn.error}</KV>}
          </Panel>

          <Panel
            title="Sync queue"
            tone={sync && sync.pending === 0 && sync.conflicts === 0 ? "ok" : "warn"}
            action={{ label: "Open sync", onClick: () => onNavigate?.("sync") }}
          >
            <KV k="Pending">{sync?.pending ?? 0}</KV>
            <KV k="Conflicts">{sync?.conflicts ?? 0}</KV>
            <KV k="Draining">{sync?.draining ? "yes" : "no"}</KV>
            <KV k="Last run">{relTime(sync?.lastRunAt ?? null)}</KV>
            {sync?.lastError && <KV k="Last error" mono>{sync.lastError}</KV>}
          </Panel>

          <Panel title="Local cache (SQLite)">
            <KV k="Path" mono>{local?.path ?? "—"}</KV>
            <KV k="Size">{local ? bytes(local.sizeBytes) : "—"}</KV>
            <KV k="Last hydrate">{relTime(local?.hydrateLastAt ?? null)}</KV>
            {local && Object.keys(local.counts).length > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: colors.textDim }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Row counts</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 2, columnGap: 12 }}>
                  {Object.entries(local.counts).map(([k, v]) => (
                    <>
                      <span key={`${k}-k`}>{k}</span>
                      <span key={`${k}-v`} style={{ fontVariantNumeric: "tabular-nums", color: colors.textPrimary }}>{v}</span>
                    </>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel
            title="Failed prints"
            tone={failed.length === 0 ? "ok" : "bad"}
            action={{ label: "Open hardware", onClick: () => onNavigate?.("hardware") }}
          >
            <KV k="Count">{failed.length}</KV>
            {failed.slice(0, 4).map(f => (
              <div key={f.id} style={{ borderTop: `1px solid ${colors.border}`, padding: "6px 0", fontSize: 11 }}>
                <div style={{ color: colors.textPrimary, fontWeight: 600 }}>{f.summary}</div>
                <div style={{ color: colors.textMuted }}>
                  {new Date(f.at).toLocaleString()} · {f.printerName ?? "no printer"} · {f.attempts} attempt{f.attempts === 1 ? "" : "s"}
                </div>
                <div style={{ color: "#fca5a5" }}>{f.error}</div>
              </div>
            ))}
          </Panel>

          <Panel title="Barcode scanner">
            <KV k="Enabled">{scanner?.enabled ? "yes" : "no"}</KV>
            <KV k="Recent scans">{scanner?.lastScans.length ?? 0}</KV>
            {(scanner?.lastScans ?? []).slice(0, 3).map((s, i) => (
              <div key={i} style={{ fontSize: 11, color: colors.textMuted, fontFamily: "monospace" }}>
                {new Date(s.at).toLocaleTimeString()} · {s.value}
              </div>
            ))}
          </Panel>
        </Grid>

        {conflicts.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <Panel title={`Sync conflicts (${conflicts.length})`} tone="bad" action={{ label: "Resolve", onClick: () => onNavigate?.("sync") }}>
              {conflicts.slice(0, 8).map(c => (
                <div key={c.id} style={{ borderTop: `1px solid ${colors.border}`, padding: "8px 0", fontSize: 12 }}>
                  <div style={{ color: colors.textPrimary, fontWeight: 600 }}>{c.summary}</div>
                  <div style={{ color: colors.textMuted, fontSize: 11 }}>
                    {c.kind} · captured {new Date(c.capturedAt).toLocaleString()}
                  </div>
                  {c.details && <div style={{ color: "#fca5a5", fontSize: 11, marginTop: 2 }}>{c.details}</div>}
                </div>
              ))}
            </Panel>
          </div>
        )}

        {!conn && !sync && !local && (
          <div style={{ padding: 32, textAlign: "center" }}><Spinner size={24} /></div>
        )}
      </div>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
      gap: 12,
    }}>{children}</div>
  );
}

function Panel({ title, tone, action, children }: {
  title: string;
  tone?: "ok" | "warn" | "bad";
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  const accent = tone === "ok" ? colors.success : tone === "bad" ? colors.danger : tone === "warn" ? "#eab308" : colors.borderStrong;
  return (
    <div style={{
      background: colors.panel, border: `1px solid ${colors.border}`,
      borderRadius: 12, padding: 16, borderTop: `3px solid ${accent}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
        {action && (
          <button onClick={action.onClick} style={{
            background: "transparent", border: 0, color: colors.brand, fontSize: 12, cursor: "pointer",
          }}>{action.label} →</button>
        )}
      </div>
      {children}
    </div>
  );
}

function KV({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0", fontSize: 12, gap: 12 }}>
      <span style={{ color: colors.textDim }}>{k}</span>
      <span style={{
        color: colors.textPrimary, fontWeight: 500, textAlign: "right",
        fontFamily: mono ? "monospace" : "inherit", fontSize: mono ? 11 : 12,
        overflow: "hidden", textOverflow: "ellipsis",
      }}>{children}</span>
    </div>
  );
}
