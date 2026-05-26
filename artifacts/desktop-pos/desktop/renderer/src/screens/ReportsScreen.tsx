/**
 * Reports screen — Phase 4.
 *
 * Sidebar destination for the on-shift cashier:
 *   • Top — live shift KPIs (orders, gross / net / tax, tender mix, AOV).
 *     Refreshes every 30 s while the screen is mounted.
 *   • Bottom — local Z-report history (≤30 days cached) with reprint.
 */
import { useEffect, useState } from "react";
import type { CashRegisterCurrent, ShiftKpis, ZReportSummary } from "../../../shared/ipc-contract";
import { Banner, Button, Spinner, colors } from "../ui/components";
import { fmtINR } from "./order/types";

export function ReportsScreen() {
  const [session, setSession] = useState<CashRegisterCurrent | null>(null);
  const [kpis, setKpis] = useState<ShiftKpis | null>(null);
  const [zReports, setZReports] = useState<ZReportSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reprinting, setReprinting] = useState<number | null>(null);

  // Initial load + 30 s refresh of KPIs.
  useEffect(() => {
    let alive = true;
    let timer: number | null = null;

    async function load() {
      try {
        const cur = await window.khanalagao.shifts.current();
        if (!alive) return;
        setSession(cur);
        if (cur.session) {
          const k = await window.khanalagao.reports.shiftKpis({ sessionId: cur.session.id });
          if (alive) setKpis(k);
        } else {
          setKpis(null);
        }
      } catch (e) { if (alive) setErr((e as Error).message); }
    }

    void load();
    timer = window.setInterval(load, 30_000);
    return () => { alive = false; if (timer) window.clearInterval(timer); };
  }, []);

  // Z-report history.
  useEffect(() => {
    let alive = true;
    window.khanalagao.zReports.list()
      .then(r => { if (alive) setZReports(r); })
      .catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, []);

  async function reprint(sessionId: number) {
    setReprinting(sessionId); setErr(null);
    try {
      await window.khanalagao.zReports.reprint({ sessionId });
    } catch (e) { setErr((e as Error).message); }
    finally { setReprinting(null); }
  }

  return (
    <div style={{ overflow: "auto", padding: 20, flex: 1 }}>
      <h2 style={{ marginTop: 0, fontSize: 20 }}>Reports</h2>

      {err && <div style={{ margin: "10px 0" }}><Banner kind="error">{err}</Banner></div>}

      <section style={{
        background: colors.panel, border: `1px solid ${colors.border}`,
        borderRadius: 10, padding: 16, marginBottom: 24,
      }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Current shift</h3>
          <span style={{ fontSize: 11, color: colors.textMuted }}>auto-refreshes every 30 s</span>
        </header>
        {!session?.session && <Banner kind="info">No open shift on this counter.</Banner>}
        {session?.session && !kpis && <Spinner />}
        {kpis && (
          <>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16,
            }}>
              <Kpi label="Orders" value={String(kpis.orderCount)} sub={`${kpis.paidCount} paid · ${kpis.unpaidCount} unpaid`} />
              <Kpi label="Gross" value={fmtINR(kpis.grossRevenue)} highlight />
              <Kpi label="Net" value={fmtINR(kpis.netRevenue)} />
              <Kpi label="Avg ticket" value={fmtINR(kpis.averageTicket)} />
              <Kpi label="Tax" value={fmtINR(kpis.taxCollected)} />
              <Kpi label="Service" value={fmtINR(kpis.serviceCollected)} />
              <Kpi label="Discounts" value={fmtINR(kpis.discountTotal)} />
              <Kpi label="Tips" value={fmtINR(kpis.tipsCollected)} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: colors.textDim, textTransform: "uppercase", marginBottom: 6 }}>
                Tender mix
              </div>
              {kpis.byMethod.length === 0 && (
                <div style={{ fontSize: 12, color: colors.textMuted }}>No tendered payments yet.</div>
              )}
              {kpis.byMethod.map(m => (
                <div key={m.method} style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "6px 0", borderBottom: `1px dashed ${colors.border}`,
                  fontSize: 13,
                }}>
                  <span style={{ textTransform: "capitalize" }}>{m.method.replace(/_/g, " ")} · {m.count}</span>
                  <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmtINR(m.amount)}</b>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section style={{
        background: colors.panel, border: `1px solid ${colors.border}`,
        borderRadius: 10, padding: 16,
      }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Z-report history</h3>
          <span style={{ fontSize: 11, color: colors.textMuted }}>last 30 days · cached locally</span>
        </header>
        {zReports === null && <Spinner />}
        {zReports && zReports.length === 0 && (
          <div style={{ fontSize: 13, color: colors.textMuted }}>
            No closed shifts cached on this device.
          </div>
        )}
        {zReports && zReports.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            {zReports.map(z => (
              <div key={z.sessionId} style={{
                display: "grid", gridTemplateColumns: "1fr auto auto auto",
                gap: 12, alignItems: "center",
                background: colors.bg, padding: "10px 12px",
                borderRadius: 6, border: `1px solid ${colors.border}`,
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    Session #{z.sessionId}{z.counterName ? ` · ${z.counterName}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textDim }}>
                    {new Date(z.openedAt).toLocaleString()} → {new Date(z.closedAt).toLocaleString()}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: colors.textDim }}>
                  {z.orderCount} orders
                </div>
                <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: colors.brand }}>
                  {fmtINR(z.grossRevenue)}
                </div>
                <Button
                  variant="ghost"
                  onClick={() => reprint(z.sessionId)}
                  disabled={reprinting === z.sessionId}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  {reprinting === z.sessionId ? "Printing…" : "Reprint"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div style={{
      background: colors.bg, borderRadius: 8, padding: "10px 12px",
      border: `1px solid ${colors.border}`,
    }}>
      <div style={{ fontSize: 10, color: colors.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{
        fontSize: highlight ? 22 : 16, fontWeight: highlight ? 800 : 600,
        color: highlight ? colors.brand : colors.textPrimary,
        fontVariantNumeric: "tabular-nums", marginTop: 2,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
