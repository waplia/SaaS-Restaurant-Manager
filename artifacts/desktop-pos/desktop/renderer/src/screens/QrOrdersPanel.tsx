/**
 * QR / online-order panel.
 *
 * Surfaces incoming orders flagged as `qr_order` / `online` / `whatsapp`
 * so the cashier can accept, KOT-print, mark as paid, or open them for
 * editing. The backend doesn't expose dedicated accept/reject mutations
 * to the terminal yet — accept = print KOT; reject = cancel via order
 * update (status:cancelled).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSounds } from "../hooks/useSounds";
import type { OrderHeader } from "../../../shared/ipc-contract";
import { Banner, Button, Spinner, colors } from "../ui/components";
import { fmtINR } from "./order/types";

interface Props {
  onOpenOrder: (orderId: number) => void;
}

const ONLINE_TYPES = new Set([
  "qr_order", "qr", "online", "online_order", "whatsapp", "zomato", "swiggy",
]);

export function QrOrdersPanel({ onOpenOrder }: Props) {
  const [orders, setOrders] = useState<OrderHeader[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [toast, setToast] = useState<string | null>(null);
  const { play } = useSounds();
  const knownIdsRef = useRef<Set<number> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const all = await window.khanalagao.orders.list({ limit: 100 });
      const online = all.filter(o => ONLINE_TYPES.has(o.orderType));
      // Ring the alert cue when a new online/QR order arrives between polls.
      // Skip the very first refresh — that's the baseline, not "new".
      if (knownIdsRef.current === null) {
        knownIdsRef.current = new Set(online.map(o => o.id));
      } else {
        const prev = knownIdsRef.current;
        const fresh = online.filter(o => !prev.has(o.id));
        if (fresh.length > 0) play("alert");
        knownIdsRef.current = new Set(online.map(o => o.id));
      }
      setOrders(online);
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, [play]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 12_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(c => c === m ? null : c), 3000); };

  async function accept(o: OrderHeader) {
    setBusy(`accept_${o.id}`);
    try {
      const detail = await window.khanalagao.orders.detail({ id: o.id });
      if (detail.items.length === 0) { flash("Order has no items to KOT."); return; }
      const r = await window.khanalagao.printers.printOrderKots({
        orderNumber: detail.orderNumber,
        tableLabel: detail.tableLabel ?? null,
        orderType: detail.orderType,
        createdAt: detail.createdAt,
        items: detail.items.map(i => ({
          name: i.menuItemName,
          quantity: i.quantity,
          kitchenId: i.kitchenId ?? null,
          kitchenName: i.kitchenName ?? null,
          modifiers: (i.modifiers ?? []).map(m => ({ name: m.name })),
          notes: i.notes ?? null,
        })),
      });
      flash(`Accepted #${o.orderNumber} · ${r?.printed?.length ?? 0} ticket(s)`);
      void refresh();
    } catch (e) { flash(`Accept failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  async function reject(o: OrderHeader) {
    if (!window.confirm(`Cancel order #${o.orderNumber}? This cannot be undone.`)) return;
    setBusy(`reject_${o.id}`);
    try {
      await window.khanalagao.orders.update({
        id: o.id, patch: { status: "cancelled" },
      });
      flash(`Cancelled #${o.orderNumber}`);
      void refresh();
    } catch (e) { flash(`Cancel failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  if (err) return <div style={{ padding: 20 }}><Banner kind="error">{err}</Banner></div>;
  if (!orders) return <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Spinner size={26} /></div>;

  const visible = filter === "pending"
    ? orders.filter(o => o.status !== "completed" && o.status !== "cancelled")
    : orders;

  return (
    <div style={{ overflow: "auto", padding: 20, flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>QR / online orders</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {(["pending", "all"] as const).map(k => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                background: filter === k ? colors.brand : colors.panelAlt,
                color: filter === k ? "#fff" : colors.textPrimary,
                border: 0, borderRadius: 6, padding: "6px 12px",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                textTransform: "capitalize",
              }}
            >{k}</button>
          ))}
          <Button variant="ghost" onClick={refresh}>Refresh</Button>
        </div>
      </div>

      {toast && <div style={{ marginBottom: 12 }}><Banner kind="info">{toast}</Banner></div>}

      {visible.length === 0 && (
        <div style={{ color: colors.textDim, padding: 40, textAlign: "center" }}>
          No {filter === "pending" ? "pending " : ""}QR / online orders right now.
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {visible.map(o => {
          const paid = o.paymentStatus === "paid";
          return (
            <div key={o.id} style={{
              background: colors.panel, border: `1px solid ${colors.border}`,
              borderRadius: 10, padding: 14,
              display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center",
            }}>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 800, fontSize: 16 }}>#{o.orderNumber}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                    padding: "2px 6px", borderRadius: 999,
                    background: colors.brandSoft, color: "#fed7aa",
                  }}>{o.orderType.replace(/_/g, " ")}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                    padding: "2px 6px", borderRadius: 999,
                    background: paid ? "rgba(22,163,74,0.18)" : "rgba(234,179,8,0.18)",
                    color: paid ? "#86efac" : "#fde68a",
                  }}>{paid ? "Paid" : "Unpaid"}</span>
                </div>
                <div style={{ fontSize: 12, color: colors.textDim, marginTop: 4 }}>
                  {o.tableId ? `Table ${o.tableId} · ` : ""}{o.status}
                  {o.customerName ? ` · ${o.customerName}` : ""}
                  {o.customerPhone ? ` · ${o.customerPhone}` : ""}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: colors.brand, marginTop: 4 }}>
                  {fmtINR(Number(o.totalAmount))}
                </div>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <Button onClick={() => onOpenOrder(o.id)} style={{ padding: "8px 14px" }}>Open</Button>
                <Button
                  variant="ghost"
                  onClick={() => void accept(o)}
                  disabled={busy === `accept_${o.id}`}
                  style={{ padding: "8px 14px", fontSize: 12 }}
                >{busy === `accept_${o.id}` ? "KOTing…" : "Accept · KOT"}</Button>
                <Button
                  variant="danger"
                  onClick={() => void reject(o)}
                  disabled={busy === `reject_${o.id}`}
                  style={{ padding: "8px 14px", fontSize: 12 }}
                >{busy === `reject_${o.id}` ? "…" : "Reject"}</Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
