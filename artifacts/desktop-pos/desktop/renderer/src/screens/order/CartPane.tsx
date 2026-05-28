import { useEffect } from "react";
import type { CartItem, Totals } from "./types";
import type { OrderDetailView } from "../../../../shared/ipc-contract";
import { shortOrderNumber } from "../../../../shared/orderNumber";
import { Button, colors } from "../../ui/components";
import { fmtINR } from "./types";
import { broadcastDisplay } from "../CustomerDisplay";
import { useAppPrefs } from "../../hooks/useAppPrefs";

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
  /** Phase 4 — payment + bill actions on a placed order. */
  onPay?: () => void;
  onSplit?: () => void;
  onReprint?: () => void;
  /** Reprint last KOT (F9). */
  onReprintKot?: () => void;
  /** Hold the current bill (F5). */
  onHold?: () => void;
  /** Task #693 trio — place-then-print/pay in one click. Each composes
   *  Send + follow-up; no-op safely when nothing is pending. */
  onKotAndPrint?: () => void;
  onBillAndPay?: () => void;
  onBillAndPrint?: () => void;
  /** Add / edit a line note. */
  onSetLineNote?: (lineKey: string, note: string) => void;
  /** Cashier display name shown in the header. */
  cashierName?: string;
  /** Dense row mode (per app prefs). */
  compact?: boolean;
  /** Round-off applied to the grand total (cash mode). */
  roundOffEnabled?: boolean;
  onToggleRoundOff?: () => void;
  cartListRef?: React.RefObject<HTMLDivElement | null>;
}

const emptyActionBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 10, padding: "10px 12px", borderRadius: 8,
  background: colors.panelAlt, border: `1px solid ${colors.border}`,
  color: colors.textPrimary, cursor: "pointer", fontSize: 13, fontWeight: 600,
};
const kbdStyle: React.CSSProperties = {
  fontFamily: "monospace", fontSize: 10,
  background: colors.bg, padding: "1px 5px", borderRadius: 4,
  border: `1px solid ${colors.borderStrong}`, color: colors.textDim,
};

export function CartPane(props: Props) {
  const {
    cart, placedOrder, totals, taxRate, serviceRate,
    customerName, customerPhone, selectedTableLabel, orderType, busy,
    selectedCartIdx, onSelectCartIdx, onEditLine,
    onQtyDelta, onRemoveLine, onSend, onClear, onOpenDiscount,
    onOpenLineDiscount, onRemoveDiscount, onPay, onSplit, onReprint, onReprintKot,
    onHold, onKotAndPrint, onBillAndPay, onBillAndPrint,
    onSetLineNote, cashierName, compact,
    roundOffEnabled, onToggleRoundOff, cartListRef,
  } = props;

  const serverItems = placedOrder?.items ?? [];
  const hasAnyLines = cart.length > 0 || serverItems.length > 0;

  const rowPad = compact ? 6 : 10;
  const rowGap = compact ? 4 : 6;

  // Round-off to the nearest rupee for cash payments — purely a display
  // hint here; the actual rounding is up to the server when the cashier
  // pays cash. Show as a one-rupee adjustment row.
  const rounded = Math.round(totals.totalAmount);
  const roundOff = roundOffEnabled ? rounded - totals.totalAmount : 0;
  const grandTotal = totals.totalAmount + roundOff;

  // Live broadcast to the customer-facing second screen. The Hardware
  // settings card toggles whether the display window is launched; we
  // always emit so any open display window stays in sync.
  const { prefs } = useAppPrefs();
  useEffect(() => {
    if (!prefs.customerDisplay) return;
    const allLines = [
      ...serverItems.map(it => ({
        name: it.menuItemName ?? "Item",
        quantity: Number(it.quantity),
        price: Number(it.unitPrice),
        lineTotal: Number(it.totalPrice ?? Number(it.unitPrice) * Number(it.quantity)),
      })),
      ...cart.map(it => ({
        name: it.name,
        quantity: it.quantity,
        price: it.unitPrice,
        lineTotal: it.unitPrice * it.quantity,
      })),
    ];
    if (allLines.length === 0) {
      broadcastDisplay({ status: "idle", tagline: prefs.customerDisplayTagline });
      return;
    }
    broadcastDisplay({
      status: "active",
      items: allLines,
      subtotal: totals.subtotal,
      tax: totals.taxAmount,
      service: totals.serviceCharge,
      discount: totals.discountAmount,
      total: grandTotal,
      tagline: prefs.customerDisplayTagline,
    });
  }, [
    prefs.customerDisplay, prefs.customerDisplayTagline,
    cart, serverItems, totals.subtotal, totals.taxAmount,
    totals.serviceCharge, totals.discountAmount, grandTotal,
  ]);

  return (
    <aside style={{
      display: "flex", flexDirection: "column", minHeight: 0,
      background: colors.panel, borderLeft: `1px solid ${colors.border}`,
    }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: colors.textDim }}>
            {placedOrder ? `Order #${shortOrderNumber(placedOrder)}` : "New Order"}
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
          {cashierName && (
            <div style={{ marginTop: 2, color: colors.textMuted }}>Cashier · {cashierName}</div>
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
          <div style={{ color: colors.textMuted, textAlign: "center", padding: "28px 16px", fontSize: 13 }}>
            <div style={{ marginBottom: 14 }}>Cart is empty — tap items on the left.</div>
            <div style={{ display: "grid", gap: 6 }}>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("tt:shortcut", { detail: { key: "open-customer" } }))}
                style={emptyActionBtn}
              >👤  Pick customer  <kbd style={kbdStyle}>F3</kbd></button>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("tt:shortcut", { detail: { key: "open-held" } }))}
                style={emptyActionBtn}
              >📌  Recall held bill  <kbd style={kbdStyle}>F5</kbd></button>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("tt:shortcut", { detail: { key: "open-calc" } }))}
                style={emptyActionBtn}
              >🧮  Calculator  <kbd style={kbdStyle}>Ctrl+L</kbd></button>
            </div>
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
                padding: rowPad, borderRadius: 8, background: colors.panelAlt,
                marginBottom: rowGap,
                border: `1px solid ${isSel ? colors.brand : "transparent"}`,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 600, fontSize: compact ? 13 : 14, lineHeight: 1.25 }}>{line.name}</div>
                <div style={{ fontWeight: 700, fontSize: compact ? 13 : 14, color: colors.brand }}>
                  {fmtINR(line.unitPrice * line.quantity)}
                </div>
              </div>
              {line.modifiers.length > 0 && (
                <div style={{ fontSize: 11, color: colors.textDim, marginTop: 4, lineHeight: 1.4 }}>
                  {line.modifiers.map(m => m.name).join(" · ")}
                </div>
              )}
              {line.notes && (
                <div style={{
                  fontSize: 11, color: "#fed7aa", marginTop: 4,
                  fontStyle: "italic",
                }}>📝 {line.notes}</div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: compact ? 6 : 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <StepBtn onClick={(e) => { e.stopPropagation(); onQtyDelta(line.lineKey, -1); }}>−</StepBtn>
                  <span style={{ minWidth: 24, textAlign: "center", fontWeight: 700 }}>{line.quantity}</span>
                  <StepBtn onClick={(e) => { e.stopPropagation(); onQtyDelta(line.lineKey, +1); }}>+</StepBtn>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {onSetLineNote && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = window.prompt("Note for this line:", line.notes ?? "") ?? line.notes ?? "";
                        onSetLineNote(line.lineKey, next.trim());
                      }}
                      style={lineActionStyle}
                      title="Add / edit note"
                    >Note</button>
                  )}
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
          <div key={`s${it.id}`} style={{
            padding: rowPad, borderRadius: 8, background: colors.bg,
            marginBottom: rowGap,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: compact ? 13 : 14, lineHeight: 1.25 }}>{it.menuItemName}</div>
              <div style={{ fontWeight: 700, fontSize: compact ? 13 : 14, color: colors.brand }}>{fmtINR(Number(it.totalPrice))}</div>
            </div>
            {(it.modifiers && it.modifiers.length > 0) && (
              <div style={{ fontSize: 11, color: colors.textDim, marginTop: 4 }}>
                {it.modifiers.map(m => m.name).join(" · ")}
              </div>
            )}
            {it.kitchenName && (
              <div style={{
                display: "inline-block", marginTop: 4,
                fontSize: 10, color: colors.textDim,
                background: colors.panelAlt, borderRadius: 999, padding: "1px 6px",
              }}>{it.kitchenName}</div>
            )}
            {it.notes && (
              <div style={{ fontSize: 11, color: "#fed7aa", marginTop: 4, fontStyle: "italic" }}>📝 {it.notes}</div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: compact ? 6 : 8 }}>
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

      {/* Action row */}
      {hasAnyLines && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6,
          padding: "10px 12px 0 12px",
        }}>
          {onHold && (
            <ActionPill onClick={onHold} disabled={busy || cart.length === 0} title="Hold bill (F5)"
              tone="#d97706">
              ⏸ Hold
            </ActionPill>
          )}
          {onReprintKot && placedOrder && (
            <ActionPill onClick={onReprintKot} disabled={busy} title="Reprint last KOT (F9)"
              tone="#2563eb">
              🖨 KOT
            </ActionPill>
          )}
          {onReprint && placedOrder && (
            <ActionPill onClick={onReprint} disabled={busy} title="Reprint bill"
              tone="#0891b2">
              🧾 Bill
            </ActionPill>
          )}
          {onOpenDiscount && placedOrder && (
            <ActionPill onClick={onOpenDiscount} disabled={busy} title="Apply discount"
              tone="#9333ea">
              % Disc
            </ActionPill>
          )}
          {onToggleRoundOff && (
            <ActionPill
              onClick={onToggleRoundOff} disabled={busy}
              active={!!roundOffEnabled}
              title="Toggle round-off to nearest ₹"
            >○ Round</ActionPill>
          )}
          <ActionPill
            onClick={onClear} disabled={busy || cart.length === 0}
            title="Clear pending cart"
          >🗑 Clear</ActionPill>
        </div>
      )}

      {/* Totals footer */}
      <div style={{ borderTop: `1px solid ${colors.border}`, padding: "12px 16px", background: colors.bg, marginTop: 10 }}>
        <Row label="Subtotal" value={fmtINR(totals.subtotal)} />
        <Row label={`Tax (${(taxRate * 100).toFixed(0)}%)`} value={fmtINR(totals.taxAmount)} />
        {totals.serviceCharge > 0 && (
          <Row label={`Service (${(serviceRate * 100).toFixed(0)}%)`} value={fmtINR(totals.serviceCharge)} />
        )}
        {totals.discountAmount > 0 && (
          <Row label="Discount" value={`−${fmtINR(totals.discountAmount)}`} color={colors.success} />
        )}
        {roundOffEnabled && Math.abs(roundOff) > 0.0001 && (
          <Row label="Round-off" value={`${roundOff >= 0 ? "+" : "−"}${fmtINR(Math.abs(roundOff))}`} color={colors.textDim} />
        )}
        <div style={{ height: 1, background: colors.border, margin: "8px 0" }} />
        <Row label="Total" value={fmtINR(grandTotal)} bold />

        {/* Task #693 trio — KOT & Print · Bill & Pay · Bill & Print.
            Each composes Send + a follow-up (print KOT / open payment /
            print bill) in one click. Shown whenever something is
            actionable: a pending cart, OR an unpaid placed order. */}
        {(onKotAndPrint || onBillAndPay || onBillAndPrint) &&
         (cart.length > 0 || (placedOrder && placedOrder.paymentStatus !== "paid")) && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8, marginTop: 12,
          }}>
            {onKotAndPrint && (
              <ComboBtn onClick={onKotAndPrint} disabled={busy || (!placedOrder && cart.length === 0)}
                bg="#2563eb" hover="#1d4ed8" title="Place + print KOT">
                🧑‍🍳 KOT & Print
              </ComboBtn>
            )}
            {onBillAndPay && (
              <ComboBtn onClick={onBillAndPay} disabled={busy || (!placedOrder && cart.length === 0)}
                bg={colors.success} hover="#15803d" title="Place + open payment">
                💳 Bill & Pay
              </ComboBtn>
            )}
            {onBillAndPrint && (
              <ComboBtn onClick={onBillAndPrint} disabled={busy || (!placedOrder && cart.length === 0)}
                bg="#d97706" hover="#b45309" title="Place + print bill">
                🧾 Bill & Print
              </ComboBtn>
            )}
          </div>
        )}

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

        {/* Phase 4 — payment + bill row (only when an order has been placed) */}
        {placedOrder && (onPay || onSplit || onReprint) && (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {placedOrder.paymentStatus === "paid" ? (
              <>
                <div style={{ flex: 1, padding: "8px 10px", borderRadius: 6, fontSize: 12,
                  background: "rgba(22,163,74,0.14)", color: "#86efac", textAlign: "center", fontWeight: 700 }}>
                  ✓ PAID{placedOrder.paymentMethod ? ` · ${String(placedOrder.paymentMethod).toUpperCase()}` : ""}
                </div>
                {onReprint && (
                  <Button variant="ghost" onClick={onReprint} disabled={busy} style={{ flex: 1 }}>Reprint bill</Button>
                )}
              </>
            ) : (
              <>
                {onReprint && (
                  <Button variant="ghost" onClick={onReprint} disabled={busy} style={{ flex: 1 }}>Reprint</Button>
                )}
                {onSplit && (
                  <Button variant="ghost" onClick={onSplit} disabled={busy || cart.length > 0} style={{ flex: 1 }}>Split</Button>
                )}
                {onPay && (
                  <Button onClick={onPay} disabled={busy || cart.length > 0}
                    style={{ flex: 2, background: colors.success, color: "#fff" }}>
                    Pay {fmtINR(grandTotal)} (F8)
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

const removeBtnStyle: React.CSSProperties = {
  background: "transparent", border: 0, color: colors.textDim,
  fontSize: 12, cursor: "pointer", padding: "4px 8px",
};

const lineActionStyle: React.CSSProperties = {
  background: colors.panel, border: `1px solid ${colors.borderStrong}`,
  color: colors.textPrimary, borderRadius: 6,
  fontSize: 11, cursor: "pointer", padding: "4px 8px", fontWeight: 600,
};

function ActionPill({ children, onClick, disabled, title, active, tone }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
  /** Accent color when not active; applied as a tinted background and
   *  matching text color so each pill is visually distinct without
   *  overwhelming the cart. */
  tone?: string;
}) {
  const bg = active
    ? colors.brandSoft
    : tone ? `${tone}26` /* ~15% alpha */ : colors.panelAlt;
  const fg = active ? "#fff" : tone ?? colors.textPrimary;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: bg, color: fg,
        border: tone && !active ? `1px solid ${tone}55` : 0,
        padding: "8px 6px", borderRadius: 6,
        fontSize: 11, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >{children}</button>
  );
}

/** Solid-fill compound action button for the Task #693 trio.
 *  Each row gets its own brand color so cashiers can spot them at a
 *  glance during a rush. */
function ComboBtn({ children, onClick, disabled, title, bg, hover }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  bg: string;
  hover: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = hover; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = bg; }}
      style={{
        background: bg, color: "#fff", border: 0,
        padding: "12px 8px", borderRadius: 8,
        fontSize: 13, fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 120ms ease",
        boxShadow: disabled ? "none" : "0 1px 2px rgba(0,0,0,0.25)",
      }}
    >{children}</button>
  );
}

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
