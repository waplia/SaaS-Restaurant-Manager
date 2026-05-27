/**
 * Reports screen — Phase 4.
 *
 * Sidebar destination for the on-shift cashier:
 *   • Top — live shift KPIs (orders, gross / net / tax, tender mix, AOV).
 *     Refreshes every 30 s while the screen is mounted.
 *   • Bottom — local Z-report history (≤30 days cached) with reprint.
 */
import { useEffect, useMemo, useState } from "react";
import type { CashRegisterCurrent, ShiftKpis, ZReportSummary } from "../../../shared/ipc-contract";
import { Banner, Button, Spinner, colors } from "../ui/components";
import { fmtINR } from "./order/types";
import { readCashMovements, type CashMovement } from "./order/CashMovementModal";

type TabKey = "shift" | "tender" | "discounts" | "cash" | "history";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "shift", label: "Shift" },
  { key: "tender", label: "Tender mix" },
  { key: "discounts", label: "Discounts & tax" },
  { key: "cash", label: "Cash movements" },
  { key: "history", label: "Z-report history" },
];

function downloadCsv(name: string, rows: Array<Array<string | number>>) {
  const body = rows.map(r => r.map(cell => {
    const s = String(cell ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function printReportLines(title: string, lines: string[]) {
  const text = [title, "─".repeat(32), ...lines, "─".repeat(32), new Date().toLocaleString()].join("\n");
  try {
    await window.khanalagao.printers.printReceipt({ text });
  } catch (e) {
    window.alert(`Print failed: ${(e as Error).message}\n\n${text}`);
  }
}

export function ReportsScreen() {
  const [session, setSession] = useState<CashRegisterCurrent | null>(null);
  const [kpis, setKpis] = useState<ShiftKpis | null>(null);
  const [zReports, setZReports] = useState<ZReportSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reprinting, setReprinting] = useState<number | null>(null);
  const [tab, setTab] = useState<TabKey>("shift");
  const [movements, setMovements] = useState<CashMovement[]>([]);

  useEffect(() => { setMovements(readCashMovements()); }, [tab]);
  const cashSummary = useMemo(() => {
    const sum = (k: CashMovement["kind"]) =>
      movements.filter(m => m.kind === k).reduce((s, m) => s + m.amount, 0);
    return { in: sum("in"), out: sum("out"), expense: sum("expense") };
  }, [movements]);

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

  const noShift = !session?.session;

  return (
    <div style={{ overflow: "auto", padding: 20, flex: 1 }}>
      <h2 style={{ marginTop: 0, fontSize: 20 }}>Reports</h2>

      {err && <div style={{ margin: "10px 0" }}><Banner kind="error">{err}</Banner></div>}

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: tab === t.key ? colors.brand : colors.panelAlt,
              color: tab === t.key ? "#fff" : colors.textPrimary,
              border: 0, padding: "8px 14px", borderRadius: 6,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === "shift" && (
        <section style={panelStyle}>
          <header style={hdrStyle}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Current shift</h3>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: colors.textMuted }}>auto-refreshes every 30 s</span>
              <Button variant="ghost" disabled={!kpis} style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => {
                if (!kpis) return;
                void printReportLines("SHIFT SUMMARY", [
                  `Orders        ${kpis.orderCount}`,
                  `Gross         ${fmtINR(kpis.grossRevenue)}`,
                  `Net           ${fmtINR(kpis.netRevenue)}`,
                  `Tax           ${fmtINR(kpis.taxCollected)}`,
                  `Service       ${fmtINR(kpis.serviceCollected)}`,
                  `Discounts     ${fmtINR(kpis.discountTotal)}`,
                  `Tips          ${fmtINR(kpis.tipsCollected)}`,
                  `Avg ticket    ${fmtINR(kpis.averageTicket)}`,
                  `Voided        ${kpis.voidedCount}`,
                ]);
              }}>Print</Button>
              <Button variant="ghost" disabled={!kpis} style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => {
                if (!kpis) return;
                downloadCsv(`shift-${session?.session?.id ?? "current"}`, [
                  ["metric", "value"],
                  ["orders", kpis.orderCount], ["paid", kpis.paidCount], ["unpaid", kpis.unpaidCount],
                  ["gross", kpis.grossRevenue], ["net", kpis.netRevenue],
                  ["tax", kpis.taxCollected], ["service", kpis.serviceCollected],
                  ["discounts", kpis.discountTotal], ["tips", kpis.tipsCollected],
                  ["avgTicket", kpis.averageTicket], ["voided", kpis.voidedCount],
                ]);
              }}>Export CSV</Button>
            </div>
          </header>
          {noShift && <Banner kind="info">No open shift on this counter.</Banner>}
          {!noShift && !kpis && <Spinner />}
          {kpis && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10,
            }}>
              <Kpi label="Orders" value={String(kpis.orderCount)} sub={`${kpis.paidCount} paid · ${kpis.unpaidCount} unpaid`} />
              <Kpi label="Gross" value={fmtINR(kpis.grossRevenue)} highlight />
              <Kpi label="Net" value={fmtINR(kpis.netRevenue)} />
              <Kpi label="Avg ticket" value={fmtINR(kpis.averageTicket)} />
              <Kpi label="Tax" value={fmtINR(kpis.taxCollected)} />
              <Kpi label="Service" value={fmtINR(kpis.serviceCollected)} />
              <Kpi label="Discounts" value={fmtINR(kpis.discountTotal)} />
              <Kpi label="Tips" value={fmtINR(kpis.tipsCollected)} />
              <Kpi label="Voided" value={String(kpis.voidedCount)} />
            </div>
          )}
        </section>
      )}

      {tab === "tender" && (
        <section style={panelStyle}>
          <header style={hdrStyle}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Payment split</h3>
            <div style={{ display: "flex", gap: 6 }}>
              <Button variant="ghost" disabled={!kpis} style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => {
                if (!kpis) return;
                void printReportLines("TENDER MIX",
                  kpis.byMethod.map(m => `${m.method.padEnd(14)} ${String(m.count).padStart(4)}  ${fmtINR(m.amount)}`));
              }}>Print</Button>
              <Button variant="ghost" disabled={!kpis} style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => {
                if (!kpis) return;
                downloadCsv("tender-mix", [["method", "count", "amount"], ...kpis.byMethod.map(m => [m.method, m.count, m.amount])]);
              }}>Export CSV</Button>
            </div>
          </header>
          {noShift && <Banner kind="info">No open shift on this counter.</Banner>}
          {!noShift && !kpis && <Spinner />}
          {kpis && kpis.byMethod.length === 0 && (
            <div style={{ fontSize: 12, color: colors.textMuted }}>No tendered payments yet.</div>
          )}
          {kpis && kpis.byMethod.length > 0 && (
            <>
              {(() => {
                const total = kpis.byMethod.reduce((s, m) => s + m.amount, 0) || 1;
                return kpis.byMethod.map(m => {
                  const pct = (m.amount / total) * 100;
                  return (
                    <div key={m.method} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <span style={{ textTransform: "capitalize" }}>{m.method.replace(/_/g, " ")} · {m.count}</span>
                        <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmtINR(m.amount)} ({pct.toFixed(1)}%)</b>
                      </div>
                      <div style={{ height: 6, background: colors.bg, borderRadius: 4, marginTop: 4, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: colors.brand }} />
                      </div>
                    </div>
                  );
                });
              })()}
            </>
          )}
        </section>
      )}

      {tab === "discounts" && (
        <section style={panelStyle}>
          <header style={hdrStyle}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Discounts & tax</h3>
          </header>
          {noShift && <Banner kind="info">No open shift on this counter.</Banner>}
          {kpis && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <Kpi label="Discounts" value={fmtINR(kpis.discountTotal)} />
              <Kpi label="Tax collected" value={fmtINR(kpis.taxCollected)} />
              <Kpi label="Service charge" value={fmtINR(kpis.serviceCollected)} />
            </div>
          )}
        </section>
      )}

      {tab === "cash" && (
        <section style={panelStyle}>
          <header style={hdrStyle}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Cash movements</h3>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: colors.textMuted }}>local entries for this device</span>
              <Button variant="ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => {
                void printReportLines("CASH MOVEMENTS", [
                  `Cash in   ${fmtINR(cashSummary.in)}`,
                  `Cash out  ${fmtINR(cashSummary.out)}`,
                  `Expenses  ${fmtINR(cashSummary.expense)}`,
                  "─".repeat(32),
                  ...movements.slice(-30).reverse().map(m => `${m.kind.padEnd(8)} ${fmtINR(m.amount).padStart(10)}  ${m.reason ?? ""}`),
                ]);
              }}>Print</Button>
              <Button variant="ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => {
                downloadCsv("cash-movements", [["at", "kind", "amount", "reason", "cashier"],
                  ...movements.map(m => [new Date(m.at).toISOString(), m.kind, m.amount, m.reason ?? "", m.cashier ?? ""])]);
              }}>Export CSV</Button>
            </div>
          </header>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
            <Kpi label="Cash in" value={fmtINR(cashSummary.in)} />
            <Kpi label="Cash out" value={fmtINR(cashSummary.out)} />
            <Kpi label="Expenses" value={fmtINR(cashSummary.expense)} />
          </div>
          {movements.length === 0 ? (
            <div style={{ fontSize: 13, color: colors.textMuted }}>No movements recorded yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 4 }}>
              {[...movements].reverse().map(m => (
                <div key={m.id} style={{
                  display: "grid", gridTemplateColumns: "90px 1fr auto auto", gap: 10,
                  alignItems: "center", padding: "8px 10px",
                  background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 6,
                  fontSize: 12,
                }}>
                  <span style={{
                    textTransform: "uppercase", fontSize: 10, fontWeight: 700,
                    color: m.kind === "in" ? colors.success : colors.danger,
                  }}>{m.kind}</span>
                  <span style={{ color: colors.textPrimary }}>{m.reason || "—"}</span>
                  <span style={{ color: colors.textDim }}>{m.cashier ?? ""}</span>
                  <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmtINR(m.amount)}</b>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "history" && (
        <section style={panelStyle}>
          <header style={hdrStyle}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Z-report history</h3>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: colors.textMuted }}>last 30 days · cached locally</span>
              <Button variant="ghost" disabled={!zReports?.length} style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => {
                if (!zReports) return;
                downloadCsv("z-reports", [["sessionId", "counter", "openedAt", "closedAt", "orderCount", "grossRevenue"],
                  ...zReports.map(z => [z.sessionId, z.counterName ?? "", z.openedAt, z.closedAt, z.orderCount, z.grossRevenue])]);
              }}>Export CSV</Button>
            </div>
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
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: colors.panel, border: `1px solid ${colors.border}`,
  borderRadius: 10, padding: 16,
};
const hdrStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
};

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
