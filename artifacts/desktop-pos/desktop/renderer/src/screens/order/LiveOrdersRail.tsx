import { useEffect, useState } from "react";
import type { OrderHeader } from "../../../../shared/ipc-contract";
import { shortOrderNumber } from "../../../../shared/orderNumber";
import { colors } from "../../ui/components";
import { fmtINR } from "./types";

interface Props {
  activeOrderId: number | null;
  onPick: (orderId: number) => void;
  /** Bumped by the parent after a create / add-items so the rail re-fetches. */
  refreshToken: number;
  /** Visible state — parent controls so the layout can hide the column entirely. */
  open: boolean;
  onToggle: () => void;
}

const REFRESH_INTERVAL_MS = 15_000;

export function LiveOrdersRail({ activeOrderId, onPick, refreshToken, open, onToggle }: Props) {
  const [orders, setOrders] = useState<OrderHeader[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const rows = await window.khanalagao.orders.list({ limit: 25 });
        if (!alive) return;
        const active = rows.filter(o => o.status !== "completed" && o.status !== "cancelled");
        setOrders(active);
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    const id = window.setInterval(load, REFRESH_INTERVAL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [refreshToken]);

  if (!open) {
    return (
      <aside style={{
        width: 36, borderRight: `1px solid ${colors.border}`,
        background: colors.panel, display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: 12,
      }}>
        <button
          onClick={onToggle}
          title="Show live orders"
          style={{
            writingMode: "vertical-rl", transform: "rotate(180deg)",
            background: "transparent", border: 0, color: colors.textDim,
            cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 0.6,
            textTransform: "uppercase", padding: "10px 4px",
          }}
        >» Live orders{orders.length > 0 ? ` · ${orders.length}` : ""}</button>
      </aside>
    );
  }

  return (
    <aside style={{
      width: 220, borderRight: `1px solid ${colors.border}`,
      background: colors.panel, display: "flex", flexDirection: "column", minHeight: 0,
    }}>
      <header style={{
        padding: "12px 14px", borderBottom: `1px solid ${colors.border}`,
        fontSize: 12, fontWeight: 700, color: colors.textDim, letterSpacing: 0.5,
        textTransform: "uppercase",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>Live orders {orders.length > 0 && <span style={{ color: colors.brand }}>· {orders.length}</span>}</span>
        <button
          onClick={onToggle}
          title="Hide live orders"
          style={{
            background: "transparent", border: 0, color: colors.textDim,
            cursor: "pointer", fontSize: 14, padding: 2,
          }}
        >«</button>
      </header>
      <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
        {loading && <div style={{ padding: 14, color: colors.textDim, fontSize: 12 }}>Loading…</div>}
        {error && <div style={{ padding: 14, color: colors.danger, fontSize: 12 }}>{error}</div>}
        {!loading && orders.length === 0 && (
          <div style={{ padding: 14, color: colors.textMuted, fontSize: 12 }}>No active orders.</div>
        )}
        {orders.map(o => {
          const isSel = o.id === activeOrderId;
          return (
            <button
              key={o.id}
              onClick={() => onPick(o.id)}
              style={{
                width: "100%", textAlign: "left",
                background: isSel ? colors.brandSoft : colors.panelAlt,
                border: 0, borderRadius: 6, padding: "8px 10px",
                marginBottom: 4, cursor: "pointer", color: colors.textPrimary,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>#{shortOrderNumber(o)}</span>
                <span style={{ fontSize: 11, color: isSel ? "#fed7aa" : colors.textDim }}>
                  {o.status}
                </span>
              </div>
              <div style={{ fontSize: 11, color: colors.textDim, marginTop: 3 }}>
                {o.orderType.replace(/_/g, " ")}
                {o.tableId ? ` · T${o.tableId}` : ""}
              </div>
              <div style={{ fontSize: 12, color: colors.brand, marginTop: 4, fontWeight: 700 }}>
                {fmtINR(Number(o.totalAmount))}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
