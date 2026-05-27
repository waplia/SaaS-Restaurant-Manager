/**
 * Kitchen display — column board grouping open orders by status.
 *
 * Columns (left → right):
 *   • New        — pending / placed / open
 *   • Preparing  — preparing / in_progress
 *   • Ready      — ready / served (waiting pickup)
 *   • Delayed    — anything past the SLA (red overdue tickets, surfaced
 *                   regardless of underlying status, with the original
 *                   column still represented)
 *   • Completed  — recently completed (last 30 min, for confirmation)
 *
 * Cards show order #, table / type, item count, age and a one-click
 * "advance" action. Per-item ready toggles are kept locally so a cook
 * can tick off finished items even while the order is still preparing.
 *
 * Fullscreen toggle blanks out the rest of the shell for line-of-sight
 * during service.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { OrderDetailView, OrderHeader } from "../../../shared/ipc-contract";
import { shortOrderNumber } from "../../../shared/orderNumber";
import { Banner, Button, Spinner, colors } from "../ui/components";

type Column = "new" | "preparing" | "ready" | "delayed" | "completed";

interface Props {
  onOpenOrder: (orderId: number) => void;
}

const COLUMN_LABEL: Record<Column, string> = {
  new: "New",
  preparing: "Preparing",
  ready: "Ready",
  delayed: "Delayed",
  completed: "Completed",
};

const SLA_MIN = 20; // minutes — anything older is "delayed"
const ITEM_DONE_KEY = "kp:kitchen:itemDone";

function columnFor(status: string): Exclude<Column, "delayed" | "completed"> | null {
  const s = status.toLowerCase();
  if (["pending", "placed", "open", "new", "received"].includes(s)) return "new";
  if (["preparing", "in_progress", "in-progress", "cooking"].includes(s)) return "preparing";
  if (["ready", "served"].includes(s)) return "ready";
  return null;
}

function nextStatus(c: Exclude<Column, "delayed" | "completed">): string | null {
  if (c === "new") return "preparing";
  if (c === "preparing") return "ready";
  return null;
}

function readItemDone(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(ITEM_DONE_KEY) ?? "{}"); } catch { return {}; }
}
function writeItemDone(map: Record<string, boolean>) {
  try { localStorage.setItem(ITEM_DONE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

export function KitchenScreen({ onOpenOrder }: Props) {
  const [orders, setOrders] = useState<OrderHeader[] | null>(null);
  const [details, setDetails] = useState<Record<number, OrderDetailView>>({});
  const [recentCompleted, setRecentCompleted] = useState<OrderHeader[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [, force] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [itemDone, setItemDone] = useState<Record<string, boolean>>(() => readItemDone());

  const refresh = useCallback(async () => {
    try {
      const all = await window.khanalagao.orders.list({ limit: 120 });
      const live = all.filter(o => columnFor(o.status) != null);
      setOrders(live);
      // Completed in the last 30 min — a soft "done" trail for the line cook.
      const cutoff = Date.now() - 30 * 60_000;
      const completed = all.filter(o => {
        const s = o.status.toLowerCase();
        return (s === "completed" || s === "served") && new Date(o.createdAt).getTime() >= cutoff;
      }).slice(0, 15);
      setRecentCompleted(completed);
      setErr(null);
      const need = live.filter(o => !details[o.id]).slice(0, 12);
      if (need.length > 0) {
        const res = await Promise.all(need.map(o =>
          window.khanalagao.orders.detail({ id: o.id }).catch(() => null)
        ));
        setDetails(prev => {
          const n = { ...prev };
          res.forEach(d => { if (d) n[d.id] = d; });
          return n;
        });
      }
    } catch (e) { setErr((e as Error).message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => force(v => v + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const advance = useCallback(async (o: OrderHeader) => {
    const col = columnFor(o.status); if (!col) return;
    const ns = nextStatus(col); if (!ns) return;
    setBusy(o.id);
    try {
      await window.khanalagao.orders.update({ id: o.id, patch: { status: ns } });
      await refresh();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }, [refresh]);

  const completeOrder = useCallback(async (o: OrderHeader) => {
    setBusy(o.id);
    try {
      await window.khanalagao.orders.update({ id: o.id, patch: { status: "completed" } });
      await refresh();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }, [refresh]);

  const toggleItem = useCallback((orderId: number, itemId: number) => {
    const key = `${orderId}:${itemId}`;
    setItemDone(prev => {
      const next = { ...prev, [key]: !prev[key] };
      writeItemDone(next);
      return next;
    });
  }, []);

  const grouped = useMemo(() => {
    const g: Record<Column, OrderHeader[]> = { new: [], preparing: [], ready: [], delayed: [], completed: recentCompleted };
    (orders ?? []).forEach(o => {
      const c = columnFor(o.status);
      if (!c) return;
      const minutes = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60_000);
      if (minutes >= SLA_MIN) g.delayed.push(o);
      else g[c].push(o);
    });
    return g;
  }, [orders, recentCompleted]);

  if (err) return <div style={{ padding: 20 }}><Banner kind="error">{err}</Banner></div>;
  if (!orders) return <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Spinner size={26} /></div>;

  const shell: React.CSSProperties = fullscreen
    ? { position: "fixed", inset: 0, zIndex: 1000, background: colors.bg, display: "flex", flexDirection: "column" }
    : { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 };

  return (
    <div style={shell}>
      <div style={{ padding: "16px 20px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Kitchen display</h2>
          <div style={{ fontSize: 12, color: colors.textDim, marginTop: 4 }}>
            {grouped.new.length} new · {grouped.preparing.length} preparing · {grouped.ready.length} ready
            {grouped.delayed.length > 0 ? ` · ⚠ ${grouped.delayed.length} delayed` : ""}
            {" · auto-refreshes every 10 s"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Button variant="ghost" onClick={() => setFullscreen(v => !v)}>
            {fullscreen ? "Exit fullscreen" : "⛶ Fullscreen"}
          </Button>
          <Button variant="ghost" onClick={refresh}>Refresh</Button>
        </div>
      </div>

      <div style={{
        flex: 1, minHeight: 0, padding: 16, paddingTop: 8,
        display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12,
      }}>
        {(["new", "preparing", "ready", "delayed", "completed"] as Column[]).map(col => (
          <KitchenColumn
            key={col}
            column={col}
            orders={grouped[col]}
            details={details}
            busyId={busy}
            itemDone={itemDone}
            onAdvance={advance}
            onComplete={completeOrder}
            onToggleItem={toggleItem}
            onOpen={onOpenOrder}
          />
        ))}
      </div>
    </div>
  );
}

function KitchenColumn({ column, orders, details, busyId, itemDone, onAdvance, onComplete, onToggleItem, onOpen }: {
  column: Column;
  orders: OrderHeader[];
  details: Record<number, OrderDetailView>;
  busyId: number | null;
  itemDone: Record<string, boolean>;
  onAdvance: (o: OrderHeader) => void;
  onComplete: (o: OrderHeader) => void;
  onToggleItem: (orderId: number, itemId: number) => void;
  onOpen: (id: number) => void;
}) {
  const tone =
    column === "new" ? { border: colors.danger, label: "#fca5a5" }
    : column === "preparing" ? { border: "#eab308", label: "#fde68a" }
    : column === "ready" ? { border: colors.success, label: "#86efac" }
    : column === "delayed" ? { border: "#dc2626", label: "#fecaca" }
    : { border: colors.borderStrong, label: colors.textDim };
  return (
    <section style={{
      background: colors.panel,
      borderRadius: 10,
      border: `1px solid ${colors.border}`,
      borderTop: `3px solid ${tone.border}`,
      display: "flex", flexDirection: "column", minHeight: 0,
    }}>
      <header style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: tone.label, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {COLUMN_LABEL[column]}
        </span>
        <span style={{ fontSize: 12, color: colors.textDim }}>{orders.length}</span>
      </header>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 10px 10px", display: "grid", gap: 8 }}>
        {orders.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: colors.textMuted, fontSize: 12 }}>
            Nothing here.
          </div>
        )}
        {orders.map(o => (
          <KitchenCard
            key={o.id}
            column={column}
            order={o}
            detail={details[o.id]}
            busy={busyId === o.id}
            itemDone={itemDone}
            onAdvance={() => onAdvance(o)}
            onComplete={() => onComplete(o)}
            onToggleItem={onToggleItem}
            onOpen={() => onOpen(o.id)}
          />
        ))}
      </div>
    </section>
  );
}

function KitchenCard({ column, order, detail, busy, itemDone, onAdvance, onComplete, onToggleItem, onOpen }: {
  column: Column;
  order: OrderHeader;
  detail?: OrderDetailView;
  busy: boolean;
  itemDone: Record<string, boolean>;
  onAdvance: () => void;
  onComplete: () => void;
  onToggleItem: (orderId: number, itemId: number) => void;
  onOpen: () => void;
}) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60_000));
  const timerTone = minutes >= SLA_MIN ? "danger" : minutes >= 10 ? "warn" : "ok";
  const timerStyle = timerTone === "danger"
    ? { bg: "rgba(220,38,38,0.18)", color: "#fca5a5" }
    : timerTone === "warn"
      ? { bg: "rgba(234,179,8,0.18)", color: "#fde68a" }
      : { bg: colors.panelAlt, color: colors.textDim };

  const liveStatus = columnFor(order.status);
  const canAdvance = column !== "completed" && liveStatus !== null && nextStatus(liveStatus) !== null;
  const canComplete = column === "ready" || (column === "delayed" && order.status.toLowerCase() === "ready");

  return (
    <div style={{
      background: colors.bg, border: `1px solid ${column === "delayed" ? "#dc2626" : colors.border}`,
      borderRadius: 8, padding: 10,
      boxShadow: column === "delayed" ? "0 0 0 1px rgba(220,38,38,0.25)" : "none",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>#{shortOrderNumber(order)}</span>
        <span style={{
          fontSize: 11, fontWeight: 700,
          padding: "2px 7px", borderRadius: 999,
          background: timerStyle.bg, color: timerStyle.color, fontVariantNumeric: "tabular-nums",
        }}>{minutes}m</span>
      </div>
      <div style={{ fontSize: 11, color: colors.textDim, marginTop: 3 }}>
        {order.tableLabel ?? order.orderType.replace(/_/g, " ")}
        {order.customerName ? ` · ${order.customerName}` : ""}
      </div>
      {detail && (
        <div style={{ marginTop: 8, display: "grid", gap: 3 }}>
          {detail.items.slice(0, 6).map(i => {
            const k = `${order.id}:${i.id}`;
            const done = !!itemDone[k];
            return (
              <button
                key={i.id}
                onClick={(e) => { e.stopPropagation(); onToggleItem(order.id, i.id); }}
                style={{
                  background: "transparent", border: 0, padding: 0,
                  textAlign: "left", cursor: "pointer",
                  textDecoration: done ? "line-through" : "none",
                  opacity: done ? 0.55 : 1,
                  color: colors.textPrimary, fontSize: 12,
                }}
                title="Tap to mark item ready"
              >
                <span style={{ color: colors.brand, fontWeight: 700 }}>{i.quantity}×</span>{" "}
                {i.menuItemName}
                {(i.modifiers && i.modifiers.length > 0) && (
                  <span style={{ color: colors.textDim, fontSize: 11 }}> · {i.modifiers.map(m => m.name).join(", ")}</span>
                )}
                {i.notes && <div style={{ fontSize: 11, color: "#fde68a", marginLeft: 18 }}>note: {i.notes}</div>}
              </button>
            );
          })}
          {detail.items.length > 6 && (
            <div style={{ fontSize: 11, color: colors.textMuted }}>+{detail.items.length - 6} more…</div>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <Button variant="ghost" onClick={onOpen} style={{ flex: 1, padding: "6px 8px", fontSize: 12 }}>Open</Button>
        {column !== "completed" && canAdvance && (
          <Button onClick={onAdvance} disabled={busy} style={{ flex: 1, padding: "6px 8px", fontSize: 12 }}>
            {busy ? "…" : "Advance →"}
          </Button>
        )}
        {canComplete && (
          <Button onClick={onComplete} disabled={busy} variant="ghost" style={{ flex: 1, padding: "6px 8px", fontSize: 12 }}>
            {busy ? "…" : "Done ✓"}
          </Button>
        )}
      </div>
    </div>
  );
}
