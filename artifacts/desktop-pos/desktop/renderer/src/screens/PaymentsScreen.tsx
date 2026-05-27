/**
 * Payments centre — today's tendered payments, unpaid bills, and a quick
 * tender-mix summary for the open shift. Every row is real data pulled
 * from `orders:list` + `reports:shift-kpis`; no mocks.
 *
 * Actions:
 *   • Open in POS    → resume the order
 *   • Print receipt  → reuses the printers IPC
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { OrderHeader, ShiftKpis } from "../../../shared/ipc-contract";
import { shortOrderNumber } from "../../../shared/orderNumber";
import { Banner, Button, Spinner, colors } from "../ui/components";
import { fmtINR } from "./order/types";

interface Props {
  onOpenOrder: (orderId: number) => void;
}

type Tab = "today" | "unpaid" | "tender";

export function PaymentsScreen({ onOpenOrder }: Props) {
  const [orders, setOrders] = useState<OrderHeader[] | null>(null);
  const [kpis, setKpis] = useState<ShiftKpis | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [busy, setBusy] = useState<number | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await window.khanalagao.orders.list({ limit: 100 });
      setOrders(list);
      try {
        const cur = await window.khanalagao.shifts.current();
        if (cur.session) {
          const k = await window.khanalagao.reports.shiftKpis({ sessionId: cur.session.id });
          setKpis(k);
        } else { setKpis(null); }
      } catch { /* shift kpis optional */ }
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 20_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const flash = (m: string) => { setInfo(m); window.setTimeout(() => setInfo(c => c === m ? null : c), 3000); };

  const today = useMemo(() => {
    if (!orders) return [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return orders.filter(o => o.paymentStatus === "paid" && new Date(o.createdAt).getTime() >= start.getTime());
  }, [orders]);
  const unpaid = useMemo(() => (orders ?? []).filter(o => o.paymentStatus !== "paid" && o.status !== "cancelled"), [orders]);

  const printReceipt = useCallback(async (o: OrderHeader) => {
    setBusy(o.id);
    try {
      await window.khanalagao.printers.printBillForOrder({ orderId: o.id });
      flash(`Receipt sent for #${shortOrderNumber(o)}`);
    } catch (e) { flash(`Print failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }, []);

  if (err) return <div style={{ padding: 20 }}><Banner kind="error">{err}</Banner></div>;
  if (!orders) return <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Spinner size={26} /></div>;

  return (
    <div style={{ overflow: "auto", padding: 20, flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Payments</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {(["today", "unpaid", "tender"] as Tab[]).map(k => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                background: tab === k ? colors.brand : colors.panelAlt,
                color: tab === k ? "#fff" : colors.textPrimary,
                border: 0, borderRadius: 6, padding: "6px 12px",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                textTransform: "capitalize",
              }}
            >{k === "today" ? `Today (${today.length})`
                : k === "unpaid" ? `Unpaid (${unpaid.length})`
                : "Tender split"}</button>
          ))}
          <Button variant="ghost" onClick={refresh}>Refresh</Button>
        </div>
      </div>

      {info && <div style={{ marginBottom: 12 }}><Banner kind="info">{info}</Banner></div>}

      {tab === "today" && (
        <PaymentList rows={today} kind="paid" busyId={busy} onOpen={onOpenOrder} onPrint={printReceipt} />
      )}
      {tab === "unpaid" && (
        <PaymentList rows={unpaid} kind="unpaid" busyId={busy} onOpen={onOpenOrder} onPrint={printReceipt} />
      )}
      {tab === "tender" && <TenderMix kpis={kpis} />}
    </div>
  );
}

function PaymentList({ rows, kind, busyId, onOpen, onPrint }: {
  rows: OrderHeader[];
  kind: "paid" | "unpaid";
  busyId: number | null;
  onOpen: (id: number) => void;
  onPrint: (o: OrderHeader) => void;
}) {
  if (rows.length === 0) {
    return <div style={{ color: colors.textDim, padding: 40, textAlign: "center" }}>
      {kind === "paid" ? "No payments today yet." : "No unpaid bills — nice!"}
    </div>;
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map(o => (
        <div key={o.id} style={{
          background: colors.panel, border: `1px solid ${colors.border}`,
          borderRadius: 10, padding: 12,
          display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 12,
        }}>
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontWeight: 800, fontSize: 15 }}>#{shortOrderNumber(o)}</span>
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                padding: "2px 6px", borderRadius: 999,
                background: kind === "paid" ? "rgba(22,163,74,0.18)" : "rgba(234,179,8,0.18)",
                color: kind === "paid" ? "#86efac" : "#fde68a",
              }}>{kind === "paid" ? (o.paymentMethod ?? "paid") : "unpaid"}</span>
              <span style={{ fontSize: 11, color: colors.textDim }}>{o.orderType.replace(/_/g, " ")}</span>
              {o.tableLabel && <span style={{ fontSize: 11, color: colors.textDim }}>· {o.tableLabel}</span>}
              {o.customerName && <span style={{ fontSize: 11, color: colors.textDim }}>· {o.customerName}</span>}
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 3 }}>
              {new Date(o.createdAt).toLocaleString()}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: colors.brand, fontVariantNumeric: "tabular-nums" }}>
              {fmtINR(Number(o.totalAmount))}
            </span>
            <Button variant="ghost" onClick={() => onOpen(o.id)} style={{ padding: "6px 12px", fontSize: 12 }}>Open</Button>
            <Button variant="ghost" disabled={busyId === o.id} onClick={() => onPrint(o)} style={{ padding: "6px 12px", fontSize: 12 }}>
              {busyId === o.id ? "…" : "Print"}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function TenderMix({ kpis }: { kpis: ShiftKpis | null }) {
  if (!kpis) return <Banner kind="info">No open shift on this counter — open one to see the tender split.</Banner>;
  if (kpis.byMethod.length === 0) return <div style={{ color: colors.textDim, padding: 40, textAlign: "center" }}>No tendered payments yet.</div>;
  const total = kpis.byMethod.reduce((s, m) => s + m.amount, 0) || 1;
  return (
    <div style={{ background: colors.panel, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16 }}>
      {kpis.byMethod.map(m => {
        const pct = (m.amount / total) * 100;
        return (
          <div key={m.method} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ textTransform: "capitalize" }}>{m.method.replace(/_/g, " ")} · {m.count}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: colors.textPrimary }}>{fmtINR(m.amount)}</span>
            </div>
            <div style={{ height: 8, background: colors.bg, borderRadius: 4, marginTop: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: colors.brand }} />
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{pct.toFixed(1)}%</div>
          </div>
        );
      })}
    </div>
  );
}
