/**
 * Close-shift modal — Phase 4.
 *
 * Drives the Z-report flow:
 *   1. Cashier enters per-denomination counts (or toggles blind close).
 *   2. Variance vs. expected is shown live; |variance| ≥ ₹0.01 requires a
 *      reason text + (when configured) a manager PIN.
 *   3. On submit we call `shifts:close` which closes the session, fetches +
 *      caches the Z-report, and auto-prints it. We expose the cached
 *      ZReportSummary back to the caller so a reprint button works.
 */
import { useEffect, useMemo, useState } from "react";
import type {
  CashRegisterCurrent, DenominationInput, DiscountsConfig, ZReportSummary,
} from "../../../../shared/ipc-contract";
import { Banner, Button, Input, Label, Spinner, colors } from "../../ui/components";
import { Modal } from "./Modals";
import { fmtINR } from "./types";

const INR_DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

export function CloseShiftModal({ onClose, onClosed }: {
  onClose: () => void;
  onClosed: (z: ZReportSummary) => void;
}) {
  const [current, setCurrent] = useState<CashRegisterCurrent | null>(null);
  const [cfg, setCfg] = useState<DiscountsConfig | null>(null);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [blind, setBlind] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Phase 5 — surface the pending-ops queue so the cashier knows whether
  // the close will go through cleanly or needs a manager-PIN force-close.
  const [pendingOps, setPendingOps] = useState(0);
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      window.khanalagao.shifts.current(),
      window.khanalagao.discounts.config().catch(() => ({} as DiscountsConfig)),
      window.khanalagao.sync.status(),
      window.khanalagao.connectivity.get(),
    ]).then(([c, d, s, conn]) => {
      if (!alive) return;
      setCurrent(c); setCfg(d); setLoading(false);
      setPendingOps(s.pending); setOnline(conn.online);
    }).catch((e) => { if (alive) { setErr((e as Error).message); setLoading(false); } });
    const offSync = window.khanalagao.sync.onStatusChanged(async () => {
      try { setPendingOps((await window.khanalagao.sync.status()).pending); } catch { /* ignore */ }
    });
    const offConn = window.khanalagao.connectivity.onChange((s) => setOnline(s.online));
    return () => { alive = false; offSync(); offConn(); };
  }, []);

  const counted = useMemo(
    () => INR_DENOMINATIONS.reduce((s, d) => s + d * (counts[d] || 0), 0),
    [counts],
  );
  const totals = current?.totals ?? null;
  const expected = totals
    ? (totals.openingFloat ?? 0) + (totals.cashSales ?? 0)
      + (totals.totalCashIn ?? 0) - (totals.totalCashOut ?? 0)
    : 0;
  const variance = counted - expected;
  const varianceMaterial = Math.abs(variance) >= 0.01;
  // A manager PIN is needed for either a material variance OR a force-close
  // while sync ops are still queued. The main process enforces both gates.
  const needsPinForVariance = cfg?.hasManagerPin === true && varianceMaterial;
  const needsPinForPending = pendingOps > 0;
  const needsPin = needsPinForVariance || needsPinForPending;

  async function submit() {
    if (!current?.session) { setErr("No open shift to close."); return; }
    if (!blind && varianceMaterial && !reason.trim()) {
      setErr("Variance reason is required."); return;
    }
    if (needsPin && !pin.trim()) {
      setErr(needsPinForPending && !needsPinForVariance
        ? `Manager PIN is required to force-close with ${pendingOps} unsynced change${pendingOps === 1 ? "" : "s"}.`
        : "Manager PIN is required for variance close.");
      return;
    }
    if (!online) {
      setErr("Cannot close while offline — reconnect to the server first."); return;
    }
    setBusy(true); setErr(null);
    try {
      const denominations: DenominationInput[] = INR_DENOMINATIONS
        .map(d => ({ denomination: d, count: counts[d] || 0 }))
        .filter(d => d.count > 0);
      const res = await window.khanalagao.shifts.close({
        sessionId: current.session.id,
        denominations: blind ? undefined : denominations,
        isBlindClose: blind,
        varianceReason: !blind && varianceMaterial ? reason.trim() : undefined,
        closeNotes: notes.trim() || undefined,
        managerPin: needsPin ? pin.trim() : undefined,
      });
      onClosed(res.zReport);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Close shift" onClose={onClose} width={620}>
      {loading && <Spinner />}
      {!loading && !current?.session && (
        <Banner kind="info">There is no open shift on this counter.</Banner>
      )}
      {!loading && current?.session && (
        <>
          {(pendingOps > 0 || !online) && (
            <div style={{ marginBottom: 12 }}>
              <Banner kind={!online ? "error" : "info"}>
                {!online
                  ? "Offline — reconnect to close this shift."
                  : `${pendingOps} change${pendingOps === 1 ? "" : "s"} still syncing. Wait for sync to finish, or enter a manager PIN to force-close (queue is preserved).`}
              </Banner>
            </div>
          )}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
            background: colors.bg, padding: 12, borderRadius: 8, marginBottom: 14,
          }}>
            <Stat label="Opening float" value={fmtINR(totals?.openingFloat ?? 0)} />
            <Stat label="Cash sales" value={fmtINR(totals?.cashSales ?? 0)} />
            <Stat label="Cash in" value={fmtINR(totals?.totalCashIn ?? 0)} />
            <Stat label="Cash out" value={fmtINR(totals?.totalCashOut ?? 0)} />
            <Stat label="Expected cash" value={fmtINR(expected)} highlight />
            <Stat
              label="Counted"
              value={blind ? "— blind —" : fmtINR(counted)}
              highlight
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13 }}>
            <input
              id="blind-close"
              type="checkbox"
              checked={blind}
              onChange={(e) => setBlind(e.target.checked)}
            />
            <label htmlFor="blind-close" style={{ color: colors.textDim }}>
              Blind close (skip denomination count — manager will reconcile)
            </label>
          </div>

          {!blind && (
            <>
              <Label>Tray denominations</Label>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8,
                marginBottom: 12,
              }}>
                {INR_DENOMINATIONS.map(d => (
                  <div key={d} style={{
                    background: colors.panelAlt, borderRadius: 6, padding: 8,
                  }}>
                    <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 4 }}>₹{d}</div>
                    <Input
                      inputMode="numeric"
                      value={counts[d] ? String(counts[d]) : ""}
                      onChange={(e) => {
                        const n = Math.max(0, Math.floor(Number(e.target.value.replace(/\D+/g, "")) || 0));
                        setCounts(prev => ({ ...prev, [d]: n }));
                      }}
                      placeholder="0"
                    />
                    <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 4, textAlign: "right" }}>
                      {fmtINR(d * (counts[d] || 0))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: varianceMaterial ? "rgba(220,38,38,0.12)" : "rgba(22,163,74,0.12)",
                border: `1px solid ${varianceMaterial ? colors.danger : colors.success}`,
                borderRadius: 8, padding: "10px 14px", marginBottom: 12,
                fontVariantNumeric: "tabular-nums",
              }}>
                <span style={{ fontWeight: 700 }}>Variance</span>
                <span style={{
                  fontWeight: 800, fontSize: 18,
                  color: varianceMaterial ? "#fca5a5" : "#86efac",
                }}>
                  {variance >= 0 ? "+" : "−"}{fmtINR(Math.abs(variance))}
                </span>
              </div>

              {varianceMaterial && (
                <div style={{ marginBottom: 10 }}>
                  <Label>Variance reason</Label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. ₹100 misplaced, returned next shift"
                  />
                </div>
              )}
            </>
          )}

          <div style={{ marginBottom: 10 }}>
            <Label>Close notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything for the next cashier?" />
          </div>

          {needsPin && (
            <div style={{ marginBottom: 12 }}>
              <Label>Manager PIN</Label>
              <Input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D+/g, ""))}
                placeholder="••••"
                autoComplete="off"
              />
            </div>
          )}

          {err && <div style={{ marginBottom: 12 }}><Banner kind="error">{err}</Banner></div>}

          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={onClose} disabled={busy} style={{ flex: 1 }}>Cancel</Button>
            <Button onClick={submit} disabled={busy} style={{ flex: 2 }}>
              {busy ? "Closing…" : "Close shift + print Z-report"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: colors.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{
        fontSize: highlight ? 18 : 14,
        fontWeight: highlight ? 800 : 600,
        color: highlight ? colors.brand : colors.textPrimary,
        fontVariantNumeric: "tabular-nums", marginTop: 2,
      }}>{value}</div>
    </div>
  );
}
