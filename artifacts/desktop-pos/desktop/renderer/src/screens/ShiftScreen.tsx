/**
 * Shift module — single-screen view of the open shift with quick actions
 * for cash in/out, expense recording, and close-shift handoff. KPIs come
 * from the real `reports:shift-kpis` IPC. Cash-movement and close-shift
 * are owned by the shell (this screen calls back into them).
 */
import { useCallback, useEffect, useState } from "react";
import type { ShiftKpis } from "../../../shared/ipc-contract";
import { Banner, Button, Spinner, colors } from "../ui/components";
import { fmtINR } from "./order/types";
import type { CashMovementKind } from "./order/CashMovementModal";

interface Props {
  shiftOpenedAt: string | null;
  cashier: string;
  onOpenCash: (kind: CashMovementKind) => void;
  onCloseShift: () => void;
}

export function ShiftScreen({ shiftOpenedAt, cashier, onOpenCash, onCloseShift }: Props) {
  const [kpis, setKpis] = useState<ShiftKpis | null>(null);
  const [noShift, setNoShift] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const cur = await window.khanalagao.shifts.current();
      if (!cur.session) { setNoShift(true); setKpis(null); return; }
      setNoShift(false);
      const k = await window.khanalagao.reports.shiftKpis({ sessionId: cur.session.id });
      setKpis(k);
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 20_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (err) return <div style={{ padding: 20 }}><Banner kind="error">{err}</Banner></div>;

  return (
    <div style={{ overflow: "auto", padding: 20, flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Shift</h2>
          <div style={{ fontSize: 12, color: colors.textDim, marginTop: 4 }}>
            Cashier: <b style={{ color: colors.textPrimary }}>{cashier || "—"}</b>
            {shiftOpenedAt && ` · opened ${new Date(shiftOpenedAt).toLocaleString()}`}
          </div>
        </div>
        <Button variant="ghost" onClick={refresh}>Refresh</Button>
      </div>

      {noShift && <Banner kind="info">No open shift on this counter. Use the gate at sign-in to open one.</Banner>}
      {!noShift && !kpis && <Spinner />}

      {kpis && (
        <>
          <section style={panelStyle}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, color: colors.textDim }}>Current performance</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              <Kpi label="Orders" value={String(kpis.orderCount)} sub={`${kpis.paidCount} paid · ${kpis.unpaidCount} unpaid`} />
              <Kpi label="Gross" value={fmtINR(kpis.grossRevenue)} highlight />
              <Kpi label="Net" value={fmtINR(kpis.netRevenue)} />
              <Kpi label="Avg ticket" value={fmtINR(kpis.averageTicket)} />
              <Kpi label="Tax" value={fmtINR(kpis.taxCollected)} />
              <Kpi label="Service" value={fmtINR(kpis.serviceCollected)} />
              <Kpi label="Discounts" value={fmtINR(kpis.discountTotal)} />
              <Kpi label="Tips" value={fmtINR(kpis.tipsCollected)} />
            </div>
          </section>

          <section style={{ ...panelStyle, marginTop: 14 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, color: colors.textDim }}>Cash drawer</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button onClick={() => onOpenCash("in")}>+ Cash in</Button>
              <Button variant="ghost" onClick={() => onOpenCash("out")}>− Cash out</Button>
              <Button variant="ghost" onClick={() => onOpenCash("expense")}>Record expense</Button>
            </div>
          </section>

          {kpis.byMethod && kpis.byMethod.length > 0 && (
            <section style={{ ...panelStyle, marginTop: 14 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 15, color: colors.textDim }}>Tender split</h3>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: colors.textMuted, textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Method</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Amount</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {kpis.byMethod.map(m => (
                    <tr key={m.method} style={{ borderTop: `1px solid ${colors.border}` }}>
                      <td style={{ padding: "6px 8px", textTransform: "capitalize" }}>{m.method.replace(/_/g, " ")}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtINR(m.amount)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{m.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section style={{ ...panelStyle, marginTop: 14 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, color: colors.textDim }}>Close out</h3>
            <p style={{ fontSize: 12, color: colors.textDim, marginTop: 0 }}>
              Close the shift to count cash, lock the counter, and produce a Z-report.
            </p>
            <Button variant="danger" onClick={onCloseShift}>Close shift…</Button>
          </section>
        </>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: colors.panel, border: `1px solid ${colors.border}`,
  borderRadius: 10, padding: 16,
};

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div style={{
      background: colors.bg, border: `1px solid ${colors.border}`,
      borderRadius: 8, padding: "12px 14px",
    }}>
      <div style={{ fontSize: 10, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{
        fontSize: highlight ? 22 : 18, fontWeight: 800,
        color: highlight ? colors.brand : colors.textPrimary,
        fontVariantNumeric: "tabular-nums", marginTop: 2,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
