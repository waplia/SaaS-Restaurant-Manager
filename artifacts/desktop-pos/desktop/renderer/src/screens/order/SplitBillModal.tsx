/**
 * Split-bill modal — Phase 4.
 *
 * Lets the cashier divide a placed order's grand total across ≥2 tender
 * legs (cash / UPI / card). For UPI and card legs in demo mode we synthesise
 * `demo_*` IDs; in live mode the cashier must supply the verified IDs
 * captured at the terminal / from the customer's payment app.
 *
 * On success the server marks the order paid and returns the latest detail,
 * which we propagate back so the workspace can auto-print the bill.
 */
import { useMemo, useRef, useState } from "react";
import type { OrderDetailView, SplitLeg } from "../../../../shared/ipc-contract";
import { Banner, Button, Input, Label, colors } from "../../ui/components";
import { Modal } from "./Modals";
import { fmtINR } from "./types";

type Leg = SplitLeg & { _id: string; demo?: boolean };

function newLeg(method: Leg["paymentMethod"], amount = 0): Leg {
  return { _id: crypto.randomUUID(), paymentMethod: method, amount, demo: true };
}

export function SplitBillModal({ order, onClose, onPaid }: {
  order: OrderDetailView;
  onClose: () => void;
  onPaid: (next: OrderDetailView) => void;
}) {
  const grandTotal = useMemo(() => Number(order.totalAmount) || 0, [order]);
  const [legs, setLegs] = useState<Leg[]>(() => [newLeg("cash", grandTotal), newLeg("upi", 0)]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const idemRef = useRef(crypto.randomUUID());

  const sum = useMemo(
    () => legs.reduce((s, l) => s + (Number(l.amount) || 0), 0),
    [legs],
  );
  const remaining = grandTotal - sum;

  function setLeg(id: string, patch: Partial<Leg>) {
    setLegs(prev => prev.map(l => l._id === id ? { ...l, ...patch } : l));
  }
  function addLeg() { setLegs(prev => [...prev, newLeg("cash", Math.max(0, remaining))]); }
  function removeLeg(id: string) { setLegs(prev => prev.filter(l => l._id !== id)); }

  async function submit() {
    if (legs.length < 2) { setErr("At least two legs are required."); return; }
    if (Math.abs(sum - grandTotal) > 0.01) {
      setErr(`Legs must total ${fmtINR(grandTotal)} (off by ${fmtINR(grandTotal - sum)}).`);
      return;
    }
    for (const leg of legs) {
      if (!Number.isFinite(leg.amount) || leg.amount <= 0) {
        setErr("Each leg must have a positive amount."); return;
      }
      if (leg.paymentMethod === "upi" && leg.demo) {
        leg.razorpayOrderId = `demo_order_${Date.now()}_${leg._id.slice(0, 6)}`;
        leg.razorpayPaymentId = `demo_pay_${Date.now()}_${leg._id.slice(0, 6)}`;
        leg.razorpaySignature = `demo_sig_${leg._id.slice(0, 6)}`;
      }
      if (leg.paymentMethod === "card" && leg.demo) {
        leg.stripePaymentIntentId = `demo_pi_${Date.now()}_${leg._id.slice(0, 6)}`;
      }
      if (leg.paymentMethod === "card" && !leg.stripePaymentIntentId) {
        setErr("Card legs need a Stripe PaymentIntent ID."); return;
      }
      if (leg.paymentMethod === "upi" && (!leg.razorpayPaymentId || !leg.razorpayOrderId || !leg.razorpaySignature)) {
        setErr("UPI legs need razorpayPaymentId, razorpayOrderId and razorpaySignature."); return;
      }
    }
    setBusy(true); setErr(null);
    try {
      const payload: SplitLeg[] = legs.map(({ _id, demo, ...rest }) => { void _id; void demo; return rest; });
      const next = await window.khanalagao.orders.split({
        orderId: order.id, legs: payload, idempotencyKey: idemRef.current,
      });
      onPaid(next);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Split bill · Order #${order.orderNumber}`} onClose={onClose} width={620}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ color: colors.textDim, fontSize: 13 }}>Total to split</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: colors.brand, fontVariantNumeric: "tabular-nums" }}>
          {fmtINR(grandTotal)}
        </span>
      </div>

      {err && <div style={{ marginBottom: 12 }}><Banner kind="error">{err}</Banner></div>}

      <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
        {legs.map((leg, idx) => (
          <div key={leg._id} style={{
            background: colors.panelAlt, borderRadius: 8, padding: 12,
            border: `1px solid ${colors.border}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <b style={{ fontSize: 12, color: colors.textDim, minWidth: 50 }}>LEG {idx + 1}</b>
              <select
                value={leg.paymentMethod}
                onChange={(e) => setLeg(leg._id, { paymentMethod: e.target.value as Leg["paymentMethod"] })}
                style={{
                  background: colors.panel, color: colors.textPrimary,
                  border: `1px solid ${colors.border}`, borderRadius: 6,
                  padding: "6px 8px", fontSize: 13,
                }}
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
              </select>
              <div style={{ flex: 1 }} />
              {legs.length > 2 && (
                <button onClick={() => removeLeg(leg._id)} style={{
                  background: "transparent", border: 0, color: colors.textDim,
                  cursor: "pointer", fontSize: 18,
                }}>×</button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <Label>Amount</Label>
                <Input
                  inputMode="decimal"
                  value={leg.amount === 0 ? "" : String(leg.amount)}
                  onChange={(e) => setLeg(leg._id, { amount: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Tip</Label>
                <Input
                  inputMode="decimal"
                  value={leg.tipAmount == null || leg.tipAmount === 0 ? "" : String(leg.tipAmount)}
                  onChange={(e) => setLeg(leg._id, { tipAmount: Number(e.target.value.replace(/[^\d.]/g, "")) || undefined })}
                  placeholder="0.00"
                />
              </div>
            </div>
            {(leg.paymentMethod === "upi" || leg.paymentMethod === "card") && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: colors.textDim }}>
                <input
                  type="checkbox"
                  checked={!!leg.demo}
                  onChange={(e) => setLeg(leg._id, { demo: e.target.checked })}
                /> Use demo gateway IDs
              </div>
            )}
            {leg.paymentMethod === "card" && !leg.demo && (
              <div style={{ marginTop: 6 }}>
                <Label>Stripe PaymentIntent ID</Label>
                <Input
                  value={leg.stripePaymentIntentId ?? ""}
                  onChange={(e) => setLeg(leg._id, { stripePaymentIntentId: e.target.value })}
                  placeholder="pi_xxx"
                />
              </div>
            )}
            {leg.paymentMethod === "upi" && !leg.demo && (
              <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                <div>
                  <Label>Razorpay order ID</Label>
                  <Input value={leg.razorpayOrderId ?? ""} onChange={(e) => setLeg(leg._id, { razorpayOrderId: e.target.value })} placeholder="order_xxx" />
                </div>
                <div>
                  <Label>Razorpay payment ID</Label>
                  <Input value={leg.razorpayPaymentId ?? ""} onChange={(e) => setLeg(leg._id, { razorpayPaymentId: e.target.value })} placeholder="pay_xxx" />
                </div>
                <div>
                  <Label>Razorpay signature</Label>
                  <Input value={leg.razorpaySignature ?? ""} onChange={(e) => setLeg(leg._id, { razorpaySignature: e.target.value })} placeholder="sha256 hex" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <Button variant="ghost" onClick={addLeg} disabled={busy}>+ Add leg</Button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: Math.abs(remaining) < 0.01 ? colors.success : colors.danger, fontVariantNumeric: "tabular-nums" }}>
          {Math.abs(remaining) < 0.01
            ? `✓ Balanced · ${fmtINR(sum)}`
            : remaining > 0
              ? `Remaining: ${fmtINR(remaining)}`
              : `Over: ${fmtINR(-remaining)}`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="ghost" onClick={onClose} disabled={busy} style={{ flex: 1 }}>Cancel</Button>
        <Button onClick={submit} disabled={busy || Math.abs(remaining) > 0.01} style={{ flex: 2 }}>
          {busy ? "Recording…" : `Settle split · ${fmtINR(grandTotal)}`}
        </Button>
      </div>
    </Modal>
  );
}
