/**
 * Payment modal — extended tender lanes.
 *
 * Lanes:
 *   • Cash               — straight POST /pay (drawer kicks on success).
 *   • UPI                — Razorpay order + capture (demo or live).
 *   • Card-on-Terminal   — Stripe Terminal device list, charge + confirm.
 *   • Pay later          — room_charge / pay_later (deferred settlement).
 *   • Comp / Void        — manager-PIN-gated.
 *   • PhonePe EDC / Dynamic QR — placeholders awaiting outlet config.
 *
 * On success the main process auto-prints the bill + opens the drawer when
 * the tender was cash. This modal only owns the gateway dance.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { OrderDetailView, PayMethod, Terminal } from "../../../../shared/ipc-contract";
import { shortOrderNumber } from "../../../../shared/orderNumber";
import { Banner, Button, Input, Label, Spinner, colors } from "../../ui/components";
import { Modal } from "./Modals";
import { CalculatorModal } from "./CalculatorModal";
import { fmtINR } from "./types";
import { useSounds } from "../../hooks/useSounds";
import { ManagerPinModal } from "../ManagerPinModal";
import { broadcastDisplay } from "../CustomerDisplay";

type Lane =
  | "cash" | "upi" | "card" | "later" | "phonepe_edc" | "phonepe_qr"
  | "cashfree" | "wallet" | "comp" | "void";

const LANES: Array<{ key: Lane; label: string; needsOnline: boolean }> = [
  { key: "cash",        label: "Cash",            needsOnline: false },
  { key: "upi",         label: "UPI",             needsOnline: true  },
  { key: "card",        label: "Card",            needsOnline: true  },
  { key: "phonepe_edc", label: "PhonePe EDC",     needsOnline: true  },
  { key: "phonepe_qr",  label: "PhonePe QR",      needsOnline: true  },
  { key: "cashfree",    label: "Cashfree",        needsOnline: true  },
  { key: "wallet",      label: "Wallet/Loyalty",  needsOnline: true  },
  { key: "later",       label: "Pay later",       needsOnline: false },
  { key: "comp",        label: "Comp",            needsOnline: true  },
  { key: "void",        label: "Void",            needsOnline: true  },
];

export function PaymentModal({ order, onClose, onPaid, online }: {
  order: OrderDetailView;
  onClose: () => void;
  onPaid: (next: OrderDetailView) => void;
  online: boolean;
}) {
  const [lane, setLane] = useState<Lane>("cash");
  const [showCalc, setShowCalc] = useState(false);
  const [pinGate, setPinGate] = useState<null | { reason: string; run: () => Promise<void> }>(null);
  const { play } = useSounds();
  const handlePaid = (next: OrderDetailView) => {
    play("pay");
    // Customer display: show paid / thank-you panel.
    broadcastDisplay({
      status: "paid",
      orderNumber: shortOrderNumber(next),
      total: Number(next.totalAmount) || 0,
      tendered: Number(cashTendered) || undefined,
      change: change > 0 ? change : undefined,
    });
    onPaid(next);
  };
  const handleErr = (e: unknown) => { play("error"); setErr((e as Error).message); };
  useEffect(() => {
    const ll = LANES.find(l => l.key === lane);
    if (!online && ll?.needsOnline) setLane("cash");
  }, [online, lane]);
  const [tip, setTip] = useState("");
  const [cashTendered, setCashTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [compReason, setCompReason] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [laterRef, setLaterRef] = useState("");
  const [laterKind, setLaterKind] = useState<"pay_later" | "room_charge">("pay_later");

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

  // Wallet / Loyalty lane
  const [walletAmount, setWalletAmount] = useState("");
  const [walletRef, setWalletRef] = useState("");

  const idemRef = useRef(crypto.randomUUID());

  const grandTotal = useMemo(() => Number(order.totalAmount) || 0, [order]);
  const tipNum = useMemo(() => Math.max(0, Number(tip) || 0), [tip]);
  const totalWithTip = grandTotal + tipNum;
  const change = useMemo(() => {
    const t = Number(cashTendered) || 0;
    return Math.max(0, t - totalWithTip);
  }, [cashTendered, totalWithTip]);

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
      handlePaid(next);
    } catch (e) { handleErr(e); }
    finally { setBusy(false); }
  }

  async function payDeferred() {
    setBusy(true); setErr(null);
    try {
      const next = await window.khanalagao.orders.pay({
        orderId: order.id,
        paymentMethod: laterKind as PayMethod,
        tipAmount: tipNum > 0 ? tipNum : undefined,
        idempotencyKey: idemRef.current,
      });
      handlePaid(next);
    } catch (e) { handleErr(e); }
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
        const next = await window.khanalagao.orders.pay({
          orderId: order.id, paymentMethod: "upi" as PayMethod,
          tipAmount: tipNum > 0 ? tipNum : undefined,
          razorpayOrderId: r.id,
          razorpayPaymentId: `demo_pay_${Date.now()}`,
          razorpaySignature: `demo_sig_${Date.now()}`,
          idempotencyKey: idemRef.current,
        });
        handlePaid(next);
      }
    } catch (e) { handleErr(e); }
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
      handlePaid(next);
    } catch (e) { handleErr(e); }
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
    } catch (e) { handleErr(e); }
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
      handlePaid(confirmed);
    } catch (e) { handleErr(e); }
    finally { setBusy(false); }
  }

  async function doVoid() {
    setBusy(true); setErr(null);
    try {
      const reason = voidReason.trim() || "voided at terminal";
      await window.khanalagao.orders.update({
        id: order.id,
        patch: { status: "cancelled", notes: `[VOID] ${reason}` } as Partial<OrderDetailView>,
      });
      const next = await window.khanalagao.orders.detail({ id: order.id });
      play("alert");
      onPaid(next);
    } catch (e) { handleErr(e); }
    finally { setBusy(false); }
  }

  async function payWallet() {
    const redeem = Math.max(0, Number(walletAmount) || 0);
    if (redeem <= 0) { setErr("Enter amount to redeem from wallet / loyalty."); return; }
    setBusy(true); setErr(null);
    try {
      // Apply redemption as a flat discount, then settle the remainder
      // (if any) under pay_later — operator collects the rest in cash/UPI.
      if (redeem > 0) {
        await window.khanalagao.discounts.apply({
          orderId: order.id,
          type: "flat",
          value: Math.min(redeem, grandTotal),
          reason: walletRef.trim() ? `Wallet/Loyalty · ${walletRef.trim()}` : "Wallet/Loyalty redemption",
        });
      }
      const next = await window.khanalagao.orders.pay({
        orderId: order.id,
        paymentMethod: "pay_later" as PayMethod,
        idempotencyKey: idemRef.current,
      });
      handlePaid(next);
    } catch (e) { handleErr(e); }
    finally { setBusy(false); }
  }

  async function doComp() {
    setBusy(true); setErr(null);
    try {
      const reason = compReason.trim() || "complimentary";
      // 100% order-level discount, then settle the (now ₹0) total under
      // pay_later so it sits in the deferred bucket with a clear marker.
      try {
        await window.khanalagao.discounts.apply({
          orderId: order.id, type: "percentage", value: 100, reason,
        });
      } catch (e) {
        throw new Error(`Discount step failed: ${(e as Error).message}`);
      }
      const next = await window.khanalagao.orders.pay({
        orderId: order.id,
        paymentMethod: "pay_later",
        idempotencyKey: idemRef.current,
      });
      handlePaid(next);
    } catch (e) { handleErr(e); }
    finally { setBusy(false); }
  }

  function gated(reason: string, run: () => Promise<void>) {
    setPinGate({ reason, run });
  }

  // Mirror payment activity onto the customer display whenever the modal
  // is open — totals, change due, lane label. The display falls back to
  // "active" until handlePaid flips it to "paid".
  useEffect(() => {
    broadcastDisplay({
      status: "active",
      orderNumber: shortOrderNumber(order),
      total: totalWithTip,
      tendered: Number(cashTendered) || undefined,
      change: change > 0 ? change : undefined,
    });
  }, [order, totalWithTip, cashTendered, change]);

  return (
    <Modal title={`Pay · Order #${shortOrderNumber(order)}`} onClose={onClose} width={560}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <span style={{ color: colors.textDim, fontSize: 13 }}>Amount due</span>
        <span style={{ fontSize: 28, fontWeight: 800, color: colors.brand, fontVariantNumeric: "tabular-nums" }}>
          {fmtINR(totalWithTip)}
        </span>
      </div>

      {/* Tender tabs — wrap onto two rows */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 16 }}>
        {LANES.map(({ key, label, needsOnline }) => {
          const disabledByOffline = !online && needsOnline;
          return (
            <button
              key={key}
              onClick={() => { if (disabledByOffline) return; setLane(key); setErr(null); }}
              disabled={busy || disabledByOffline}
              title={disabledByOffline ? "Requires connection" : undefined}
              style={{
                padding: "10px 8px", borderRadius: 6,
                background: lane === key ? colors.brand : colors.panelAlt,
                color: lane === key ? "#fff" : colors.textPrimary,
                border: 0, fontWeight: 600, fontSize: 12,
                cursor: disabledByOffline ? "not-allowed" : "pointer",
                opacity: disabledByOffline ? 0.5 : 1,
              }}
            >{label}</button>
          );
        })}
      </div>

      {!online && (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="info">Offline — cash and pay-later only. Other tenders sync when reconnected.</Banner>
        </div>
      )}

      {err && <div style={{ marginBottom: 12 }}><Banner kind="error">{err}</Banner></div>}

      {(lane === "cash" || lane === "upi" || lane === "card") && (
        <div style={{ marginBottom: 14 }}>
          <Label>Tip (optional)</Label>
          <Input
            inputMode="decimal"
            value={tip}
            onChange={(e) => setTip(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0.00"
          />
        </div>
      )}

      {lane === "cash" && (
        <>
          <div style={{ marginBottom: 14 }}>
            <Label>Cash tendered</Label>
            <div style={{ display: "flex", gap: 6 }}>
              <Input
                autoFocus
                inputMode="decimal"
                value={cashTendered}
                onChange={(e) => setCashTendered(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder={totalWithTip.toFixed(2)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() => setShowCalc(true)}
                title="Open calculator"
                style={{
                  background: colors.panelAlt, color: colors.textPrimary, border: 0,
                  borderRadius: 6, padding: "0 14px", fontSize: 16, cursor: "pointer",
                }}
              >🧮</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              <button type="button" onClick={() => setCashTendered(totalWithTip.toFixed(2))} style={cashChipStyle}>Exact</button>
              {[100, 200, 500, 2000].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    const due = Math.max(totalWithTip, n);
                    const rounded = Math.ceil(due / n) * n;
                    setCashTendered(rounded.toFixed(2));
                  }}
                  style={cashChipStyle}
                >₹{n}</button>
              ))}
            </div>
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
            <Banner kind="info">No card terminals registered for this outlet. Configure one in the web admin.</Banner>
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

      {lane === "later" && (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setLaterKind("pay_later")}
              style={{
                ...cashChipStyle, padding: "8px 14px", fontSize: 13,
                background: laterKind === "pay_later" ? colors.brand : colors.panelAlt,
                color: laterKind === "pay_later" ? "#fff" : colors.textPrimary,
              }}
            >On account</button>
            <button
              onClick={() => setLaterKind("room_charge")}
              style={{
                ...cashChipStyle, padding: "8px 14px", fontSize: 13,
                background: laterKind === "room_charge" ? colors.brand : colors.panelAlt,
                color: laterKind === "room_charge" ? "#fff" : colors.textPrimary,
              }}
            >Room charge</button>
          </div>
          <Label>Reference (optional — room # / account)</Label>
          <Input value={laterRef} onChange={e => setLaterRef(e.target.value)} placeholder="e.g. Room 204 / acct-1042" />
          <Banner kind="info">
            The order will be marked as {laterKind === "room_charge" ? "charged to room" : "on account"}.
            Settle later from the Payments tab.
          </Banner>
          <Button onClick={payDeferred} disabled={busy} style={{ width: "100%" }}>
            {busy ? "Recording…" : `Mark ${laterKind === "room_charge" ? "room charge" : "on account"}`}
          </Button>
        </div>
      )}

      {lane === "phonepe_edc" && (
        <div style={{ display: "grid", gap: 10 }}>
          <Banner kind="info">
            PhonePe EDC terminal integration requires the merchant credentials
            and the EDC device pairing to be configured under
            Hardware → PhonePe EDC. Use UPI for now.
          </Banner>
          <Button variant="ghost" onClick={() => setLane("upi")}>Switch to UPI</Button>
        </div>
      )}

      {lane === "phonepe_qr" && (
        <div style={{ display: "grid", gap: 10 }}>
          <Banner kind="info">
            PhonePe Dynamic QR requires the merchant credentials to be configured
            in the web admin (Settings → Payments → PhonePe). Until then, the
            generic UPI QR works for PhonePe customers.
          </Banner>
          <Button variant="ghost" onClick={() => setLane("upi")}>Switch to UPI QR</Button>
        </div>
      )}

      {lane === "cashfree" && (
        <div style={{ display: "grid", gap: 10 }}>
          <Banner kind="info">
            Cashfree gateway requires merchant credentials in the web admin
            (Settings → Payments → Cashfree). Until then, use UPI or Card.
          </Banner>
          <Button variant="ghost" onClick={() => setLane("upi")}>Switch to UPI</Button>
        </div>
      )}

      {lane === "wallet" && (
        <div style={{ display: "grid", gap: 10 }}>
          <Banner kind="info">
            Redeem the customer's loyalty / wallet balance against this bill.
            The redemption is recorded as a flat discount; any remainder is
            settled on account.
          </Banner>
          <Label>Amount to redeem (₹)</Label>
          <Input
            inputMode="decimal"
            value={walletAmount}
            onChange={(e) => setWalletAmount(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder={Math.min(grandTotal, 100).toFixed(2)}
          />
          <Label>Reference (optional — loyalty card / wallet id)</Label>
          <Input
            value={walletRef}
            onChange={(e) => setWalletRef(e.target.value)}
            placeholder="LOY-1042 / wallet:abc"
          />
          <Button onClick={payWallet} disabled={busy || !walletAmount} style={{ width: "100%" }}>
            {busy ? "Recording…" : `Redeem ${walletAmount ? fmtINR(Number(walletAmount)) : ""}`}
          </Button>
        </div>
      )}

      {lane === "comp" && (
        <div style={{ display: "grid", gap: 10 }}>
          <Banner kind="info">Complimentary closes the order at ₹0 and applies a 100% discount with the reason.</Banner>
          <Label>Reason</Label>
          <Input value={compReason} onChange={e => setCompReason(e.target.value)} placeholder="VIP guest / staff / on the house" />
          <Button
            variant="danger"
            onClick={() => gated(`Mark order #${shortOrderNumber(order)} as complimentary?`, doComp)}
            disabled={busy}
            style={{ width: "100%" }}
          >{busy ? "Closing…" : "Authorise & mark complimentary"}</Button>
        </div>
      )}

      {lane === "void" && (
        <div style={{ display: "grid", gap: 10 }}>
          <Banner kind="error">Voiding cancels the order. KOTs printed will need to be recalled at the kitchen.</Banner>
          <Label>Reason</Label>
          <Input value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="duplicate / wrong table / customer left" />
          <Button
            variant="danger"
            onClick={() => gated(`Void order #${shortOrderNumber(order)}?`, doVoid)}
            disabled={busy}
            style={{ width: "100%" }}
          >{busy ? "Voiding…" : "Authorise & void order"}</Button>
        </div>
      )}

      {showCalc && (
        <CalculatorModal
          target={totalWithTip}
          onClose={() => setShowCalc(false)}
          onSendToCash={(v) => setCashTendered(v.toFixed(2))}
        />
      )}
      {pinGate && (
        <ManagerPinModal
          reason={pinGate.reason}
          onCancel={() => setPinGate(null)}
          onAllow={async () => { const fn = pinGate.run; setPinGate(null); await fn(); }}
        />
      )}
    </Modal>
  );
}

const cashChipStyle: React.CSSProperties = {
  background: colors.panelAlt, color: colors.textPrimary, border: 0,
  borderRadius: 999, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600,
};
