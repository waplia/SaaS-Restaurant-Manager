/**
 * Payment modal — Phase 4.
 *
 * Renders three tender lanes for a placed order:
 *   • Cash               — straight POST /pay (drawer kicks on success).
 *   • UPI                — creates a Razorpay order; in demo mode we pay
 *                          with the returned `demo_*` IDs, in live mode the
 *                          cashier confirms the paymentId from the customer.
 *   • Card-on-Terminal   — picks a Stripe terminal device, charges it, then
 *                          confirms (server records the payment + marks paid).
 *
 * On success the main process auto-prints the bill + opens the drawer when
 * the tender was cash, so this modal only owns the gateway dance.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { OrderDetailView, PayMethod, Terminal } from "../../../../shared/ipc-contract";
import { Banner, Button, Input, Label, Spinner, colors } from "../../ui/components";
import { Modal } from "./Modals";
import { fmtINR } from "./types";

type Lane = "cash" | "upi" | "card";

export function PaymentModal({ order, onClose, onPaid, online }: {
  order: OrderDetailView;
  onClose: () => void;
  onPaid: (next: OrderDetailView) => void;
  /** Drives the offline tender gate — UPI / card require a live connection. */
  online: boolean;
}) {
  const [lane, setLane] = useState<Lane>("cash");
  // Snap back to cash if the connection drops while a non-cash lane is open.
  useEffect(() => { if (!online && lane !== "cash") setLane("cash"); }, [online, lane]);
  const [tip, setTip] = useState("");
  const [cashTendered, setCashTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // UPI lane
  const [rzpMode, setRzpMode] = useState<"live" | "demo" | null>(null);
  const [rzpOrderId, setRzpOrderId] = useState<string | null>(null);
  const [rzpKeyId, setRzpKeyId] = useState<string | null>(null);
  const [rzpPaymentId, setRzpPaymentId] = useState("");
  const [rzpSignature, setRzpSignature] = useState("");

  // Card lane
  const [terminals, setTerminals] = useState<Terminal[] | null>(null);
  const [terminalId, setTerminalId] = useState<number | null>(null);
  const [terminalIntentId, setTerminalIntentId] = useState<string | null>(null);

  const idemRef = useRef(crypto.randomUUID());

  const grandTotal = useMemo(() => Number(order.totalAmount) || 0, [order]);
  const tipNum = useMemo(() => Math.max(0, Number(tip) || 0), [tip]);
  const totalWithTip = grandTotal + tipNum;
  const change = useMemo(() => {
    const t = Number(cashTendered) || 0;
    return Math.max(0, t - totalWithTip);
  }, [cashTendered, totalWithTip]);

  // Load terminals when switching to card lane.
  useEffect(() => {
    if (lane !== "card" || terminals !== null) return;
    let alive = true;
    window.khanalagao.terminals.list({ restaurantId: order.restaurantId })
      .then((rows) => { if (alive) setTerminals(rows); })
      .catch(() => { if (alive) setTerminals([]); });
    return () => { alive = false; };
  }, [lane, terminals, order.restaurantId]);

  async function payCash() {
    setBusy(true); setErr(null);
    try {
      const next = await window.khanalagao.orders.pay({
        orderId: order.id, paymentMethod: "cash" as PayMethod,
        tipAmount: tipNum > 0 ? tipNum : undefined,
        idempotencyKey: idemRef.current,
      });
      onPaid(next);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function startUpi() {
    setBusy(true); setErr(null);
    try {
      const r = await window.khanalagao.payments.razorpayOrder({
        orderId: order.id, tipAmount: tipNum > 0 ? tipNum : undefined,
      });
      setRzpMode(r.mode); setRzpOrderId(r.id); setRzpKeyId(r.keyId);
      if (r.mode === "demo") {
        // Demo path: server accepts `demo_*` IDs.
        const next = await window.khanalagao.orders.pay({
          orderId: order.id, paymentMethod: "upi" as PayMethod,
          tipAmount: tipNum > 0 ? tipNum : undefined,
          razorpayOrderId: r.id,
          razorpayPaymentId: `demo_pay_${Date.now()}`,
          razorpaySignature: `demo_sig_${Date.now()}`,
          idempotencyKey: idemRef.current,
        });
        onPaid(next);
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmUpiLive() {
    if (!rzpOrderId || !rzpPaymentId.trim() || !rzpSignature.trim()) return;
    setBusy(true); setErr(null);
    try {
      const next = await window.khanalagao.orders.pay({
        orderId: order.id, paymentMethod: "upi" as PayMethod,
        tipAmount: tipNum > 0 ? tipNum : undefined,
        razorpayOrderId: rzpOrderId,
        razorpayPaymentId: rzpPaymentId.trim(),
        razorpaySignature: rzpSignature.trim(),
        idempotencyKey: idemRef.current,
      });
      onPaid(next);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function chargeTerminal() {
    if (!terminalId) return;
    setBusy(true); setErr(null);
    try {
      const r = await window.khanalagao.payments.terminalCharge({
        terminalDeviceId: terminalId, orderId: order.id,
        amount: grandTotal, tipAmount: tipNum > 0 ? tipNum : undefined,
      });
      setTerminalIntentId(r.paymentIntentId);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmTerminal() {
    if (!terminalId || !terminalIntentId) return;
    setBusy(true); setErr(null);
    try {
      const confirmed = await window.khanalagao.payments.terminalConfirm({
        terminalDeviceId: terminalId, orderId: order.id,
        paymentIntentId: terminalIntentId,
      });
      onPaid(confirmed);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Pay · Order #${order.orderNumber}`} onClose={onClose} width={520}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <span style={{ color: colors.textDim, fontSize: 13 }}>Amount due</span>
        <span style={{ fontSize: 28, fontWeight: 800, color: colors.brand, fontVariantNumeric: "tabular-nums" }}>
          {fmtINR(totalWithTip)}
        </span>
      </div>

      {/* Tender tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["cash", "upi", "card"] as Lane[]).map((k) => {
          const disabledByOffline = !online && k !== "cash";
          return (
            <button
              key={k}
              onClick={() => { if (disabledByOffline) return; setLane(k); setErr(null); }}
              disabled={busy || disabledByOffline}
              title={disabledByOffline ? "Requires connection — offline only supports cash" : undefined}
              style={{
                flex: 1, padding: "10px 12px", borderRadius: 6,
                background: lane === k ? colors.brand : colors.panelAlt,
                color: lane === k ? "#fff" : colors.textPrimary,
                border: 0, fontWeight: 600, fontSize: 13,
                cursor: disabledByOffline ? "not-allowed" : "pointer",
                opacity: disabledByOffline ? 0.5 : 1,
              }}
            >{k === "cash" ? "Cash" : k === "upi" ? "UPI" : "Card (terminal)"}</button>
          );
        })}
      </div>

      {!online && (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="info">Offline mode — only cash payments can be recorded. They will sync when the connection returns.</Banner>
        </div>
      )}

      {err && <div style={{ marginBottom: 12 }}><Banner kind="error">{err}</Banner></div>}

      {/* Tip — common to all lanes */}
      <div style={{ marginBottom: 14 }}>
        <Label>Tip (optional)</Label>
        <Input
          inputMode="decimal"
          value={tip}
          onChange={(e) => setTip(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder="0.00"
        />
      </div>

      {lane === "cash" && (
        <>
          <div style={{ marginBottom: 14 }}>
            <Label>Cash tendered</Label>
            <Input
              autoFocus
              inputMode="decimal"
              value={cashTendered}
              onChange={(e) => setCashTendered(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={totalWithTip.toFixed(2)}
            />
            {Number(cashTendered) > 0 && (
              <div style={{ marginTop: 8, fontSize: 13, color: change > 0 ? colors.success : colors.textDim }}>
                Change: <b>{fmtINR(change)}</b>
              </div>
            )}
          </div>
          <Button onClick={payCash} disabled={busy} style={{ width: "100%" }}>
            {busy ? "Recording…" : `Take cash · ${fmtINR(totalWithTip)}`}
          </Button>
        </>
      )}

      {lane === "upi" && (
        <>
          {!rzpOrderId && (
            <Button onClick={startUpi} disabled={busy} style={{ width: "100%" }}>
              {busy ? "Starting…" : "Generate UPI request"}
            </Button>
          )}
          {rzpOrderId && rzpMode === "live" && (
            <div style={{ display: "grid", gap: 10 }}>
              <Banner kind="info">
                Razorpay order created · {rzpOrderId}{rzpKeyId ? ` · key ${rzpKeyId}` : ""}.
                Enter the captured payment details from the customer's UPI app.
              </Banner>
              <div>
                <Label>razorpayPaymentId</Label>
                <Input value={rzpPaymentId} onChange={(e) => setRzpPaymentId(e.target.value)} placeholder="pay_xxx" />
              </div>
              <div>
                <Label>razorpaySignature</Label>
                <Input value={rzpSignature} onChange={(e) => setRzpSignature(e.target.value)} placeholder="sha256 hex" />
              </div>
              <Button onClick={confirmUpiLive} disabled={busy || !rzpPaymentId || !rzpSignature}>
                {busy ? "Verifying…" : "Confirm UPI payment"}
              </Button>
            </div>
          )}
          {rzpOrderId && rzpMode === "demo" && busy && <Spinner />}
        </>
      )}

      {lane === "card" && (
        <>
          {terminals === null && <Spinner />}
          {terminals && terminals.length === 0 && (
            <Banner kind="info">No card terminals registered for this outlet.</Banner>
          )}
          {terminals && terminals.length > 0 && (
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              {terminals.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setTerminalId(t.id); setTerminalIntentId(null); }}
                  disabled={busy}
                  style={{
                    textAlign: "left", padding: "10px 12px", borderRadius: 6,
                    background: terminalId === t.id ? colors.brandSoft : colors.panelAlt,
                    color: colors.textPrimary,
                    border: `1px solid ${terminalId === t.id ? colors.brand : "transparent"}`,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{t.name ?? `Terminal #${t.id}`}</div>
                  <div style={{ fontSize: 11, color: colors.textDim }}>
                    {t.provider ?? "stripe"}{t.serial ? ` · ${t.serial}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
          {terminalId && !terminalIntentId && (
            <Button onClick={chargeTerminal} disabled={busy} style={{ width: "100%" }}>
              {busy ? "Charging…" : `Charge terminal · ${fmtINR(totalWithTip)}`}
            </Button>
          )}
          {terminalIntentId && (
            <div style={{ display: "grid", gap: 10 }}>
              <Banner kind="info">Tap / insert / swipe the card on the terminal, then confirm.</Banner>
              <Button onClick={confirmTerminal} disabled={busy} style={{ width: "100%" }}>
                {busy ? "Confirming…" : "Confirm card payment"}
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
