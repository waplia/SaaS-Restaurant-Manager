import type { CartItem, Totals } from "./types";
import type { OrderDetailView } from "../../../../shared/ipc-contract";
import { Button, colors } from "../../ui/components";
import { fmtINR } from "./types";

interface Props {
  cart: CartItem[];
  placedOrder: OrderDetailView | null;
  totals: Totals;
  taxRate: number;
  serviceRate: number;
  customerName: string;
  customerPhone: string;
  selectedTableLabel: string | null;
  orderType: string;
  busy: boolean;
  selectedCartIdx: number | null;
  onSelectCartIdx: (i: number | null) => void;
  /** Opens the modifier picker pre-seeded with the line's options. */
  onEditLine: (line: CartItem) => void;
  onQtyDelta: (lineKey: string, delta: number) => void;
  onRemoveLine: (lineKey: string) => void;
  onSend: () => void;
  onClear: () => void;
  onOpenDiscount: () => void;
  onOpenLineDiscount: (orderItemId: number, label: string) => void;
  onRemoveDiscount: (discountId: number) => void;
  cartListRef?: React.RefObject<HTMLDivElement | null>;
}

export function CartPane(props: Props) {
  const {
    cart, placedOrder, totals, taxRate, serviceRate,
    customerName, customerPhone, selectedTableLabel, orderType, busy,
    selectedCartIdx, onSelectCartIdx, onEditLine,
    onQtyDelta, onRemoveLine, onSend, onClear, onOpenDiscount,
    onOpenLineDiscount, onRemoveDiscount, cartListRef,
  } = props;
  void customerName; void customerPhone;

  const serverItems = placedOrder?.items ?? [];
  const hasAnyLines = cart.length > 0 || serverItems.length > 0;

  return (
    <aside style={{
      display: "flex", flexDirection: "column", minHeight: 0,
      background: colors.panel, borderLeft: `1px solid ${colors.border}`,
    }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: colors.textDim }}>
            {placedOrder ? `Order #${placedOrder.orderNumber}` : "New Order"}
          </span>
          {placedOrder && (
            <span style={{
              fontSize: 11, color: "#fed7aa", background: colors.brandSoft,
              padding: "2px 8px", borderRadius: 999, fontWeight: 600,
            }}>{placedOrder.status}</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: colors.textDim, lineHeight: 1.5 }}>
          <div>{orderType.replace(/_/g, " ").toUpperCase()}{selectedTableLabel ? ` · ${selectedTableLabel}` : ""}</div>
          {(customerName || customerPhone) && (
            <div>{customerName || "Guest"}{customerPhone ? ` · ${customerPhone}` : ""}</div>
          )}
        </div>
      </div>

      {/* Lines */}
      <div
        ref={cartListRef}
        tabIndex={-1}
        style={{ flex: 1, overflowY: "auto", padding: 8, outline: "none" }}
      >
        {!hasAnyLines && (
          <div style={{ color: colors.textMuted, textAlign: "center", padding: 32, fontSize: 13 }}>
            Cart is empty — tap items on the left.
          </div>
        )}

        {/* Local (unsent) cart lines */}
        {cart.map((line, idx) => {
          const isSel = selectedCartIdx === idx;
          const canEdit = line.modifiers.length > 0;
          return (
            <div
              key={line.lineKey}
              onClick={() => onSelectCartIdx(isSel ? null : idx)}
              onDoubleClick={() => { if (canEdit) onEditLine(line); }}
              title={canEdit ? "Double-click to edit options" : undefined}
              style={{
                ...lineStyle,
                border: `1px solid ${isSel ? colors.brand : "transparent"}`,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.25 }}>{line.name}</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: colors.brand }}>
                  {fmtINR(line.unitPrice * line.quantity)}
                </div>
              </div>
              {line.modifiers.length > 0 && (
                <div style={{ fontSize: 11, color: colors.textDim, marginTop: 4, lineHeight: 1.4 }}>
                  {line.modifiers.map(m => m.name).join(" · ")}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <StepBtn onClick={(e) => { e.stopPropagation(); onQtyDelta(line.lineKey, -1); }}>−</StepBtn>
                  <span style={{ minWidth: 24, textAlign: "center", fontWeight: 700 }}>{line.quantity}</span>
                  <StepBtn onClick={(e) => { e.stopPropagation(); onQtyDelta(line.lineKey, +1); }}>+</StepBtn>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {canEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditLine(line); }}
                      style={lineActionStyle}
                      title="Change modifiers"
                    >Edit</button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveLine(line.lineKey); }}
                    style={removeBtnStyle}
                  >Remove (Del)</button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Server-side items (already placed) */}
        {serverItems.length > 0 && cart.length > 0 && (
          <div style={{ height: 1, background: colors.border, margin: "8px 4px" }} />
        )}
        {serverItems.map(it => (
          <div key={`s${it.id}`} style={{ ...lineStyle, background: colors.bg }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.25 }}>{it.menuItemName}</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: colors.brand }}>{fmtINR(Number(it.totalPrice))}</div>
            </div>
            {(it.modifiers && it.modifiers.length > 0) && (
              <div style={{ fontSize: 11, color: colors.textDim, marginTop: 4 }}>
                {it.modifiers.map(m => m.name).join(" · ")}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: 12, color: colors.textDim }}>× {it.quantity}{" · sent"}</span>
              <button
                onClick={() => onOpenLineDiscount(it.id, it.menuItemName)}
                style={lineActionStyle}
              >% Discount</button>
            </div>
          </div>
        ))}

        {/* Discounts */}
        {placedOrder && placedOrder.discounts.length > 0 && (
          <div style={{ marginTop: 8, padding: "0 8px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.textDim, letterSpacing: 0.5, marginBottom: 4 }}>
              DISCOUNTS
            </div>
            {placedOrder.discounts.map(d => (
              <div key={d.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                fontSize: 12, color: colors.success, padding: "4px 0", gap: 8,
              }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {d.reason || d.couponCode || d.type}
                  {d.orderItemId ? " · line" : ""}
                </span>
                <span>−{fmtINR(Number(d.amount))}</span>
                <button
                  onClick={() => onRemoveDiscount(d.id)}
                  title="Remove discount"
                  style={{
                    background: "transparent", border: 0, color: colors.textDim,
                    cursor: "pointer", fontSize: 13, padding: "0 4px",
                  }}
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Totals footer */}
      <div style={{ borderTop: `1px solid ${colors.border}`, padding: "12px 16px", background: colors.bg }}>
        <Row label="Subtotal" value={fmtINR(totals.subtotal)} />
        <Row label={`Tax (${(taxRate * 100).toFixed(0)}%)`} value={fmtINR(totals.taxAmount)} />
        {totals.serviceCharge > 0 && (
          <Row label={`Service (${(serviceRate * 100).toFixed(0)}%)`} value={fmtINR(totals.serviceCharge)} />
        )}
        {totals.discountAmount > 0 && (
          <Row label="Discount" value={`−${fmtINR(totals.discountAmount)}`} color={colors.success} />
        )}
        <div style={{ height: 1, background: colors.border, margin: "8px 0" }} />
        <Row label="Total" value={fmtINR(totals.totalAmount)} bold />

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {placedOrder ? (
            <>
              <Button variant="ghost" onClick={onOpenDiscount} disabled={busy} style={{ flex: 1 }}>Discount</Button>
              <Button onClick={onSend} disabled={busy || cart.length === 0} style={{ flex: 2 }}>
                {busy ? "Sending…" : `Add ${cart.length} item${cart.length === 1 ? "" : "s"} (F4)`}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClear} disabled={busy || cart.length === 0} style={{ flex: 1 }}>Clear</Button>
              <Button onClick={onSend} disabled={busy || cart.length === 0} style={{ flex: 2 }}>
                {busy ? "Sending…" : "Send order (F4)"}
              </Button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

const lineStyle: React.CSSProperties = {
  padding: 10, borderRadius: 8, background: colors.panelAlt,
  marginBottom: 6,
};

const removeBtnStyle: React.CSSProperties = {
  background: "transparent", border: 0, color: colors.textDim,
  fontSize: 12, cursor: "pointer", padding: "4px 8px",
};

const lineActionStyle: React.CSSProperties = {
  background: colors.panel, border: `1px solid ${colors.borderStrong}`,
  color: colors.textPrimary, borderRadius: 6,
  fontSize: 11, cursor: "pointer", padding: "4px 8px", fontWeight: 600,
};

function StepBtn({ children, onClick }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick} style={{
      background: colors.panel, border: `1px solid ${colors.borderStrong}`,
      color: colors.textPrimary, borderRadius: 6,
      width: 26, height: 26, fontSize: 16, lineHeight: 1, cursor: "pointer",
      display: "grid", placeItems: "center",
    }}>{children}</button>
  );
}

function Row({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      fontSize: bold ? 16 : 13, fontWeight: bold ? 800 : 500,
      color: color ?? (bold ? colors.textPrimary : colors.textDim),
      padding: "3px 0", fontVariantNumeric: "tabular-nums",
    }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
