/**
 * QR / online-order panel — Kanban column flow.
 *
 * Columns:
 *   Pending  → Accepted (KOT'd) → Preparing → Payment due → Completed
 *
 * Surfaces incoming orders flagged as qr_order / online / whatsapp /
 * zomato / swiggy. The backend doesn't expose dedicated accept/reject
 * mutations to the terminal, so:
 *   • Accept = print KOTs + advance status to "preparing".
 *   • Reject = orders.update {status: cancelled}.
 *   • Advance buttons walk through status transitions.
 *
 * Triggers a desktop notification (Notification API) the first time a
 * fresh online order appears, and rings the alert tone via useSounds.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSounds } from "../hooks/useSounds";
import type { OrderHeader } from "../../../shared/ipc-contract";
import { shortOrderNumber } from "../../../shared/orderNumber";
import { Banner, Button, Spinner, colors } from "../ui/components";
import { fmtINR } from "./order/types";

interface Props {
  onOpenOrder: (orderId: number) => void;
}

type Col = "pending" | "accepted" | "preparing" | "paymentDue" | "completed";

const ONLINE_TYPES = new Set([
  "qr_order", "qr", "online", "online_order", "whatsapp", "zomato", "swiggy",
]);

const COL_LABEL: Record<Col, string> = {
  pending: "Pending",
  accepted: "Accepted",
  preparing: "Preparing",
  paymentDue: "Payment due",
  completed: "Completed",
};

const COL_TONE: Record<Col, { border: string; chip: string; text: string }> = {
  pending:     { border: colors.danger,  chip: "rgba(220,38,38,0.18)",  text: "#fca5a5" },
  accepted:    { border: colors.brand,   chip: "rgba(234,88,12,0.18)",  text: "#fed7aa" },
  preparing:   { border: "#eab308",      chip: "rgba(234,179,8,0.18)",  text: "#fde68a" },
  paymentDue:  { border: "#a855f7",      chip: "rgba(168,85,247,0.18)", text: "#d8b4fe" },
  completed:   { border: colors.success, chip: "rgba(22,163,74,0.18)",  text: "#86efac" },
};

function bucket(o: OrderHeader): Col | null {
  const s = o.status.toLowerCase();
  if (s === "cancelled") return null;
  if (s === "completed") return "completed";
  // Payment-due overrides status for completed-but-unpaid online orders.
  if ((s === "served" || s === "ready") && o.paymentStatus !== "paid") return "paymentDue";
  if (["pending", "placed", "open", "new", "received"].includes(s)) return "pending";
  if (["preparing", "in_progress", "in-progress", "cooking"].includes(s)) {
    // Once accepted but kitchen hasn't touched it, surface under Accepted
    // for the first 2 minutes for visibility, then under Preparing.
    const ageMin = (Date.now() - new Date(o.createdAt).getTime()) / 60_000;
    return ageMin < 2 ? "accepted" : "preparing";
  }
  if (["ready", "served"].includes(s)) return "preparing";
  return "pending";
}

export function QrOrdersPanel({ onOpenOrder }: Props) {
  const [orders, setOrders] = useState<OrderHeader[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { play } = useSounds();
  const knownIdsRef = useRef<Set<number> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const all = await window.khanalagao.orders.list({ limit: 150 });
      const online = all.filter(o => ONLINE_TYPES.has(o.orderType));
      if (knownIdsRef.current === null) {
        knownIdsRef.current = new Set(online.map(o => o.id));
      } else {
        const prev = knownIdsRef.current;
        const fresh = online.filter(o => !prev.has(o.id) && bucket(o) === "pending");
        if (fresh.length > 0) {
          play("alert");
          notify(fresh);
        }
        knownIdsRef.current = new Set(online.map(o => o.id));
      }
      setOrders(online);
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, [play]);

  useEffect(() => {
    void refresh();
    // Ask for desktop-notification permission once.
    try { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); } catch { /* ignore */ }
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
        orderNumber: shortOrderNumber(detail),
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
      // Push status forward so the order moves to "Accepted" in the board.
      try { await window.khanalagao.orders.update({ id: o.id, patch: { status: "preparing" } }); } catch { /* status push is best-effort */ }
      flash(`Accepted #${shortOrderNumber(o)} · ${r?.printed?.length ?? 0} ticket(s)`);
      void refresh();
    } catch (e) { flash(`Accept failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  async function advance(o: OrderHeader, to: string) {
    setBusy(`adv_${o.id}`);
    try {
      await window.khanalagao.orders.update({ id: o.id, patch: { status: to } });
      flash(`Moved #${shortOrderNumber(o)} → ${to}`);
      void refresh();
    } catch (e) { flash(`Move failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  async function reject(o: OrderHeader) {
    if (!window.confirm(`Cancel order #${shortOrderNumber(o)}? This cannot be undone.`)) return;
    setBusy(`reject_${o.id}`);
    try {
      await window.khanalagao.orders.update({ id: o.id, patch: { status: "cancelled" } });
      flash(`Cancelled #${shortOrderNumber(o)}`);
      void refresh();
    } catch (e) { flash(`Cancel failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  const grouped = useMemo(() => {
    const g: Record<Col, OrderHeader[]> = {
      pending: [], accepted: [], preparing: [], paymentDue: [], completed: [],
    };
    (orders ?? []).forEach(o => {
      const b = bucket(o);
      if (b) g[b].push(o);
    });
    return g;
  }, [orders]);

  if (err) return <div style={{ padding: 20 }}><Banner kind="error">{err}</Banner></div>;
  if (!orders) return <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Spinner size={26} /></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "14px 20px 6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>QR / online orders</h2>
          <div style={{ fontSize: 12, color: colors.textDim, marginTop: 4 }}>
            {grouped.pending.length} pending · {grouped.accepted.length} accepted · {grouped.preparing.length} preparing
            · {grouped.paymentDue.length} payment due
          </div>
        </div>
        <Button variant="ghost" onClick={refresh}>Refresh</Button>
      </div>

      {toast && <div style={{ padding: "0 20px 6px" }}><Banner kind="info">{toast}</Banner></div>}

      <div style={{
        flex: 1, minHeight: 0, padding: "8px 16px 16px",
        display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12,
      }}>
        {(Object.keys(COL_LABEL) as Col[]).map(col => (
          <section key={col} style={{
            background: colors.panel,
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            borderTop: `3px solid ${COL_TONE[col].border}`,
            display: "flex", flexDirection: "column", minHeight: 0,
          }}>
            <header style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: COL_TONE[col].text, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {COL_LABEL[col]}
              </span>
              <span style={{ fontSize: 12, color: colors.textDim }}>{grouped[col].length}</span>
            </header>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 10px 10px", display: "grid", gap: 8 }}>
              {grouped[col].length === 0 && (
                <div style={{ padding: 22, textAlign: "center", color: colors.textMuted, fontSize: 12 }}>—</div>
              )}
              {grouped[col].map(o => (
                <QrCard
                  key={o.id}
                  order={o}
                  col={col}
                  busy={busy}
                  onOpen={() => onOpenOrder(o.id)}
                  onAccept={() => void accept(o)}
                  onAdvance={(s) => void advance(o, s)}
                  onReject={() => void reject(o)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function QrCard({ order, col, busy, onOpen, onAccept, onAdvance, onReject }: {
  order: OrderHeader;
  col: Col;
  busy: string | null;
  onOpen: () => void;
  onAccept: () => void;
  onAdvance: (status: string) => void;
  onReject: () => void;
}) {
  const paid = order.paymentStatus === "paid";
  return (
    <div style={{
      background: colors.bg, border: `1px solid ${colors.border}`,
      borderRadius: 8, padding: 10,
    }}>
      <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>#{shortOrderNumber(order)}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          padding: "2px 6px", borderRadius: 999,
          background: colors.brandSoft, color: "#fed7aa",
        }}>{order.orderType.replace(/_/g, " ")}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          padding: "2px 6px", borderRadius: 999,
          background: paid ? "rgba(22,163,74,0.18)" : "rgba(234,179,8,0.18)",
          color: paid ? "#86efac" : "#fde68a",
        }}>{paid ? "Paid" : "Unpaid"}</span>
      </div>
      <div style={{ fontSize: 11, color: colors.textDim, marginTop: 4 }}>
        {order.customerName ?? "Guest"}{order.customerPhone ? ` · ${order.customerPhone}` : ""}
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: colors.brand, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
        {fmtINR(Number(order.totalAmount))}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={onOpen} style={{ flex: 1, padding: "6px 6px", fontSize: 11 }}>Open</Button>
        {col === "pending" && (
          <>
            <Button onClick={onAccept} disabled={busy === `accept_${order.id}`} style={{ flex: 1, padding: "6px 6px", fontSize: 11 }}>
              {busy === `accept_${order.id}` ? "…" : "Accept"}
            </Button>
            <Button variant="danger" onClick={onReject} disabled={busy === `reject_${order.id}`} style={{ flex: 1, padding: "6px 6px", fontSize: 11 }}>
              {busy === `reject_${order.id}` ? "…" : "Reject"}
            </Button>
          </>
        )}
        {col === "accepted" && (
          <Button onClick={() => onAdvance("preparing")} disabled={busy === `adv_${order.id}`} style={{ flex: 1, padding: "6px 6px", fontSize: 11 }}>Preparing →</Button>
        )}
        {col === "preparing" && (
          <Button onClick={() => onAdvance("ready")} disabled={busy === `adv_${order.id}`} style={{ flex: 1, padding: "6px 6px", fontSize: 11 }}>Ready →</Button>
        )}
        {col === "paymentDue" && (
          <Button onClick={onOpen} style={{ flex: 1, padding: "6px 6px", fontSize: 11 }}>Settle</Button>
        )}
        {(col === "preparing" || col === "paymentDue") && paid && (
          <Button onClick={() => onAdvance("completed")} variant="ghost" disabled={busy === `adv_${order.id}`} style={{ flex: 1, padding: "6px 6px", fontSize: 11 }}>Complete ✓</Button>
        )}
      </div>
    </div>
  );
}

function notify(orders: OrderHeader[]) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const top = orders[0];
    const body = orders.length === 1
      ? `${top.orderType.replace(/_/g, " ")} · ${top.customerName ?? "Guest"} · ₹${Number(top.totalAmount).toFixed(0)}`
      : `${orders.length} new online orders need attention`;
    new Notification("New QR / online order", { body, tag: "kp:qr" });
  } catch { /* ignore */ }
}
