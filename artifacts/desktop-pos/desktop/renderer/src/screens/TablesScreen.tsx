/**
 * Tables screen — floor map of every table with live status badges.
 *
 * Status colour key (matches the web POS):
 *   • available  → green border, empty
 *   • occupied   → red border, shows the open order + amount
 *   • reserved   → yellow border
 *   • billed     → orange border (settled but not cleared)
 *
 * Actions per table:
 *   • Open / resume order   → jumps to Orders tab with the table picked
 *   • Add more items        → same flow when the order is still active
 *   • Transfer / merge / split — placeholder buttons that surface the
 *     manager flow guidance; the actual moves are owned by the web admin
 *     (the backend doesn't expose those mutations to the terminal yet).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FloorTable, OrderHeader } from "../../../shared/ipc-contract";
import { Banner, Button, Spinner, colors } from "../ui/components";
import { fmtINR } from "./order/types";

interface Props {
  /** Called when the cashier wants to open a table in the Orders workspace. */
  onOpenTable: (table: FloorTable, orderId: number | null) => void;
}

type FilterKey = "all" | "available" | "occupied" | "reserved" | "billed";

interface MoveDialogState {
  // Only transfer is supported renderer-side — true merge (combining two
  // active checks) needs a backend mutation we don't have today.
  mode: "transfer";
  sourceTable: FloorTable;
  sourceOrder: OrderHeader;
}

export function TablesScreen({ onOpenTable }: Props) {
  const [tables, setTables] = useState<FloorTable[] | null>(null);
  const [orders, setOrders] = useState<OrderHeader[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [info, setInfo] = useState<string | null>(null);
  const [moveDialog, setMoveDialog] = useState<MoveDialogState | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [t, o] = await Promise.all([
        window.khanalagao.tables.list(),
        window.khanalagao.orders.list({ limit: 100 }),
      ]);
      setTables(t);
      setOrders(o.filter(x => x.status !== "completed" && x.status !== "cancelled"));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const doMove = useCallback(async (target: FloorTable) => {
    if (!moveDialog) return;
    setMoveBusy(true);
    try {
      await window.khanalagao.orders.update({
        id: moveDialog.sourceOrder.id,
        patch: { tableId: target.id } as Partial<OrderHeader>,
      });
      const verb = "Transferred";
      setMoveDialog(null);
      await refresh();
      setInfo(`${verb} table T${target.tableNumber}.`);
      window.setTimeout(() => setInfo(c => c?.startsWith(verb) ? null : c), 3500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setMoveBusy(false);
    }
  }, [moveDialog, refresh]);

  const ordersByTable = useMemo(() => {
    const map = new Map<number, OrderHeader>();
    for (const o of orders) if (o.tableId) map.set(o.tableId, o);
    return map;
  }, [orders]);

  const filtered = useMemo(() => {
    if (!tables) return null;
    if (filter === "all") return tables;
    return tables.filter(t => {
      const live = ordersByTable.get(t.id);
      const status = live ? "occupied" : (t.status ?? "available");
      return status === filter;
    });
  }, [tables, ordersByTable, filter]);

  const counts = useMemo(() => {
    if (!tables) return { all: 0, available: 0, occupied: 0, reserved: 0, billed: 0 };
    let available = 0, occupied = 0, reserved = 0, billed = 0;
    for (const t of tables) {
      const live = ordersByTable.get(t.id);
      const s = live ? "occupied" : (t.status ?? "available");
      if (s === "available") available++;
      else if (s === "occupied") occupied++;
      else if (s === "reserved") reserved++;
      else if (s === "billed") billed++;
    }
    return { all: tables.length, available, occupied, reserved, billed };
  }, [tables, ordersByTable]);

  const showInfo = (msg: string) => {
    setInfo(msg);
    window.setTimeout(() => setInfo(c => c === msg ? null : c), 4000);
  };

  if (err) return <div style={{ padding: 20 }}><Banner kind="error">{err}</Banner></div>;
  if (!filtered) return <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Spinner size={26} /></div>;

  return (
    <div style={{ overflow: "auto", padding: 20, flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Tables</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {(["all", "available", "occupied", "reserved", "billed"] as FilterKey[]).map(k => (
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
            >{k} · {counts[k]}</button>
          ))}
        </div>
        <Button variant="ghost" onClick={refresh}>Refresh</Button>
      </div>

      {info && <div style={{ marginBottom: 12 }}><Banner kind="info">{info}</Banner></div>}

      {filtered.length === 0 && (
        <div style={{ color: colors.textDim, padding: 30, textAlign: "center" }}>
          No tables match this filter.
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: 12,
      }}>
        {filtered.map(t => {
          const live = ordersByTable.get(t.id);
          const status: "available" | "occupied" | "reserved" | "billed" =
            live ? "occupied"
              : (t.status === "reserved" || t.status === "billed" ? t.status
                : "available");
          const palette = STATUS_PALETTE[status];
          return (
            <div key={t.id} style={{
              background: colors.panel, border: `2px solid ${palette.border}`,
              borderRadius: 10, padding: 14,
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>T{t.tableNumber}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                  color: palette.text, background: palette.chip,
                  padding: "2px 6px", borderRadius: 999, letterSpacing: 0.5,
                }}>{status}</span>
              </div>
              <div style={{ fontSize: 11, color: colors.textDim }}>
                {t.capacity} seats{t.shape ? ` · ${t.shape}` : ""}
              </div>
              {live && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 12, color: colors.textDim }}>Order</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: colors.brand }}>
                    #{live.orderNumber} · {fmtINR(Number(live.totalAmount))}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>{live.status}</div>
                </div>
              )}
              <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                <Button
                  style={{ flex: 1, padding: "6px 8px", fontSize: 12 }}
                  onClick={() => onOpenTable(t, live?.id ?? null)}
                >
                  {live ? "Open" : "Seat"}
                </Button>
                <button
                  title="Move this order to a different (free) table"
                  disabled={!live}
                  onClick={() => live && setMoveDialog({ mode: "transfer", sourceTable: t, sourceOrder: live })}
                  style={{ ...smallBtn, opacity: live ? 1 : 0.4, cursor: live ? "pointer" : "not-allowed" }}
                >⇄</button>
                <button
                  title="Split bill"
                  onClick={() => {
                    if (!live) { showInfo("No order to split."); return; }
                    onOpenTable(t, live.id);
                    showInfo(`Opened #${live.orderNumber} — use Split bill from the cart.`);
                  }}
                  style={smallBtn}
                >⊥</button>
              </div>
            </div>
          );
        })}
      </div>

      {moveDialog && tables && (
        <TableMoveOverlay
          dialog={moveDialog}
          tables={tables}
          ordersByTable={ordersByTable}
          busy={moveBusy}
          onPick={doMove}
          onClose={() => setMoveDialog(null)}
        />
      )}
    </div>
  );
}

function TableMoveOverlay({ dialog, tables, ordersByTable, busy, onPick, onClose }: {
  dialog: MoveDialogState;
  tables: FloorTable[];
  ordersByTable: Map<number, OrderHeader>;
  busy: boolean;
  onPick: (t: FloorTable) => void;
  onClose: () => void;
}) {
  const candidates = tables.filter(x => x.id !== dialog.sourceTable.id);
  return (
    <div
      role="dialog"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "grid", placeItems: "center", zIndex: 50,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.panel, border: `1px solid ${colors.border}`,
          borderRadius: 12, padding: 18, width: 540, maxHeight: "80vh",
          display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Transfer order</h3>
            <div style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>
              Order #{dialog.sourceOrder.orderNumber} on T{dialog.sourceTable.tableNumber}
              {" · "}
              {fmtINR(Number(dialog.sourceOrder.totalAmount))}
            </div>
          </div>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <Banner kind="info">
          Pick the destination table. The order will move there and the source
          table will free up. Occupied tables are disabled — true cheque merge
          isn't supported from the desktop POS yet.
        </Banner>

        <div style={{
          overflowY: "auto", display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
          gap: 8, paddingRight: 4,
        }}>
          {candidates.map(t => {
            const live = ordersByTable.get(t.id);
            const occupied = !!live;
            const disabled = occupied;
            return (
              <button
                key={t.id}
                disabled={disabled || busy}
                onClick={() => onPick(t)}
                style={{
                  background: disabled ? colors.bg : colors.panelAlt,
                  border: `1px solid ${disabled ? colors.border : colors.borderStrong}`,
                  borderRadius: 8, padding: 10, textAlign: "left",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 16 }}>T{t.tableNumber}</div>
                <div style={{ fontSize: 10, color: colors.textDim }}>
                  {t.capacity} seats · {occupied ? "occupied" : "free"}
                </div>
                {occupied && (
                  <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                    #{live.orderNumber} · {fmtINR(Number(live.totalAmount))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const STATUS_PALETTE: Record<string, { border: string; text: string; chip: string }> = {
  available: { border: "#16a34a", text: "#86efac", chip: "rgba(22,163,74,0.18)" },
  occupied:  { border: "#dc2626", text: "#fca5a5", chip: "rgba(220,38,38,0.18)" },
  reserved:  { border: "#eab308", text: "#fde68a", chip: "rgba(234,179,8,0.18)" },
  billed:    { border: "#ea580c", text: "#fed7aa", chip: "rgba(234,88,12,0.18)" },
};

const smallBtn: React.CSSProperties = {
  background: colors.panelAlt, border: `1px solid ${colors.borderStrong}`,
  color: colors.textPrimary, borderRadius: 6, width: 30, height: 30,
  cursor: "pointer", fontSize: 12, fontWeight: 700,
};
