import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiAction } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  useCreatePaymentIntent, useCreateRazorpayOrder,
  useCurrentCashRegister,
  useTerminals, useTerminalCharge, useConfirmTerminalCharge, useTerminalRunOnReader,
  useRestaurantId,
} from "@/lib/hooks";
import type { TipPolicy } from "@/lib/types";
import {
  CreditCard, Banknote, Smartphone, Gift, Clock,
  X, AlertCircle, Lock, Loader2,
} from "lucide-react";

/**
 * Shared POS payment modal. Originally lived inline in pos.tsx; promoted
 * to its own module so the Orders drawer (and any future "Take Payment"
 * surface) can show the exact same flow — tip selector, cash-register
 * gate, Stripe card, Razorpay UPI, gift card, terminal tap-to-pay,
 * pay-later. There is one source of truth for what "Take Payment" looks
 * like across the web app.
 */

export interface Totals {
  subtotal: number;
  taxAmount: number;
  serviceCharge: number;
  discountAmount: number;
  totalAmount: number;
}

export interface PaymentConfirmDetails {
  amountTendered?: number;
  stripePaymentIntentId?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
  giftCardCode?: string;
  redeemedPaise?: number;
  tipAmount?: number;
}

type PayStage = "select" | "cash-confirm" | "card-form" | "upi-form" | "gift-card-form" | "terminal-form" | "processing";

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "card", label: "Card", icon: CreditCard },
  { value: "upi", label: "UPI", icon: Smartphone },
  { value: "gift_card", label: "Gift Card", icon: Gift },
  { value: "terminal", label: "Terminal", icon: CreditCard },
  { value: "pay_later", label: "Pay Later", icon: Clock },
];

export function PaymentModal({
  totals,
  orderId,
  onClose,
  onConfirm,
  onTerminalConfirmed,
  isPending,
  hasCustomer,
}: {
  totals: Totals;
  orderId: number;
  onClose: () => void;
  onConfirm: (method: string, details?: PaymentConfirmDetails) => Promise<void>;
  /** Called after a terminal charge has been verified + finalized server-side.
   *  POS uses this to print and reset state WITHOUT going through
   *  /orders/:id/pay (terminal /confirm is the sole finalizer). */
  onTerminalConfirmed?: (info: { providerRef: string; receiptUrl: string | null }) => Promise<void>;
  isPending: boolean;
  /** Whether a customer is linked to the order. Required for pay_later. */
  hasCustomer: boolean;
}) {
  const [method, setMethod] = useState<"cash" | "card" | "upi" | "gift_card" | "terminal" | "pay_later">("cash");
  const [stage, setStage] = useState<PayStage>("select");
  const [amountTendered, setAmountTendered] = useState("");
  const [tipPct, setTipPct] = useState<number>(0);
  const [customTip, setCustomTip] = useState<string>("");
  const restaurantId = useRestaurantId();
  const { data: tipPolicy, isError: tipPolicyError } = useQuery<TipPolicy>({
    queryKey: ["tip-policy", restaurantId],
    queryFn: async () => {
      const { apiGet } = await import("@/lib/api");
      return apiGet<TipPolicy>(`/restaurants/${restaurantId}/advanced-growth/tip-policy`);
    },
    enabled: !!restaurantId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const tipsEnabled = tipPolicyError ? false : (tipPolicy?.enabled ?? true);
  const presets = tipPolicy?.presets ?? [0, 5, 10, 15, 20];
  const customAllowed = tipPolicy?.customAllowed ?? true;
  const tipAmount = tipPct === -1
    ? Math.max(0, Math.round((Number(customTip) || 0) * 100) / 100)
    : Math.round(totals.totalAmount * tipPct) / 100;
  const grandTotal = totals.totalAmount + tipAmount;
  const [upiId, setUpiId] = useState("");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardError, setGiftCardError] = useState("");
  const [terminalId, setTerminalId] = useState<number | null>(null);
  const [terminalTip, setTerminalTip] = useState("");
  const [terminalStatus, setTerminalStatus] = useState("");
  const [terminalError, setTerminalError] = useState("");
  const { data: terminals = [] } = useTerminals();
  const terminalCharge = useTerminalCharge();
  const terminalRunOnReader = useTerminalRunOnReader();
  const confirmTerminalCharge = useConfirmTerminalCharge();
  const restaurantIdForGift = restaurantId;
  const [cardReady, setCardReady] = useState(false);
  const [stripeError, setStripeError] = useState("");
  const cardMountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<{ stripe: import("@stripe/stripe-js").Stripe | null; card: import("@stripe/stripe-js").StripeCardElement | null }>({ stripe: null, card: null });
  const createPaymentIntent = useCreatePaymentIntent();
  const createRazorpayOrder = useCreateRazorpayOrder();
  const { toast } = useToast();
  const { data: cashRegister } = useCurrentCashRegister();
  const isRegisterOpen = !!cashRegister?.session;
  useEffect(() => {
    if (!isRegisterOpen && method === "cash") setMethod("card");
  }, [isRegisterOpen, method]);

  const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
  const RAZORPAY_KEY = import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined;

  const change = method === "cash" && amountTendered
    ? Math.max(0, Number(amountTendered) - grandTotal)
    : 0;

  useEffect(() => {
    if (stage !== "card-form" || !STRIPE_PK) return;
    let destroyed = false;
    import("@stripe/stripe-js").then(({ loadStripe }) => {
      loadStripe(STRIPE_PK).then(stripe => {
        if (destroyed || !stripe || !cardMountRef.current) return;
        stripeRef.current.stripe = stripe;
        const elements = stripe.elements();
        const card = elements.create("card", {
          style: { base: { fontSize: "16px", color: "#1a1a1a", "::placeholder": { color: "#9ca3af" } } },
          hidePostalCode: true,
        });
        card.mount(cardMountRef.current!);
        stripeRef.current.card = card;
        card.on("change", evt => {
          setStripeError(evt.error?.message ?? "");
          setCardReady(evt.complete);
        });
      });
    });
    return () => {
      destroyed = true;
      stripeRef.current.card?.destroy();
      stripeRef.current = { stripe: null, card: null };
      setCardReady(false);
      setStripeError("");
    };
  }, [stage, STRIPE_PK]);

  const handleProceed = () => {
    if (method === "card") { setStage("card-form"); return; }
    if (method === "upi") { setStage("upi-form"); return; }
    if (method === "gift_card") { setStage("gift-card-form"); return; }
    if (method === "terminal") {
      if (terminalId == null && terminals.length > 0) setTerminalId(terminals[0].id);
      setStage("terminal-form"); return;
    }
    if (method === "pay_later") {
      setStage("processing");
      void onConfirm("pay_later", { tipAmount }).finally(() => setStage("select"));
      return;
    }
    setStage("cash-confirm");
  };

  const handleProcessPayment = async () => {
    setStage("processing");
    try {
      if (method === "card") {
        const intent = await createPaymentIntent.mutateAsync({ orderId, tipAmount });
        if (intent.mode === "live" && intent.clientSecret && stripeRef.current.stripe && stripeRef.current.card) {
          const result = await stripeRef.current.stripe.confirmCardPayment(intent.clientSecret, {
            payment_method: { card: stripeRef.current.card },
          });
          if (result.error) {
            setStripeError(result.error.message ?? "Payment failed");
            setStage("card-form");
            return;
          }
          await onConfirm("card", { stripePaymentIntentId: result.paymentIntent?.id, tipAmount });
        } else {
          await new Promise(r => setTimeout(r, 1500));
          await onConfirm("card", { stripePaymentIntentId: intent.intentId, tipAmount });
        }
      } else if (method === "upi") {
        const rzpOrder = await createRazorpayOrder.mutateAsync({ orderId, tipAmount });
        if (rzpOrder.mode === "live" && rzpOrder.keyId) {
          if (!(window as unknown as Record<string, unknown>).Razorpay) {
            await new Promise<void>((resolve, reject) => {
              const s = document.createElement("script");
              s.src = "https://checkout.razorpay.com/v1/checkout.js";
              s.onload = () => resolve();
              s.onerror = () => reject(new Error("Failed to load Razorpay checkout"));
              document.body.appendChild(s);
            });
          }
          await new Promise<void>((resolve, reject) => {
            const rzp = new (window as unknown as { Razorpay: new (opts: Record<string, unknown>) => { open(): void } }).Razorpay({
              key: rzpOrder.keyId,
              amount: rzpOrder.amount,
              currency: rzpOrder.currency,
              order_id: rzpOrder.id,
              handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
                await onConfirm("upi", {
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpaySignature: response.razorpay_signature,
                  tipAmount,
                });
                resolve();
              },
              modal: {
                ondismiss: () => {
                  setStage("upi-form");
                  reject(new Error("Payment cancelled"));
                },
              },
            });
            rzp.open();
          });
        } else {
          await new Promise(r => setTimeout(r, 1500));
          await onConfirm("upi", { razorpayPaymentId: `demo_rzp_pay_${orderId}_${Date.now()}`, tipAmount });
        }
      } else if (method === "gift_card") {
        if (!restaurantIdForGift) throw new Error("No restaurant context");
        try {
          const result = await apiAction<{ redeemedPaise: number; remainingBalancePaise: number; code: string }>(
            `/restaurants/${restaurantIdForGift}/gift-cards/redeem-by-code`,
            "POST",
            {
              code: giftCardCode.trim(),
              amountPaise: Math.round(grandTotal * 100),
              referenceType: "order",
              referenceId: orderId,
              idempotencyKey: `pos-${orderId}-${Date.now()}`,
              notes: `POS payment for order #${orderId}`,
            },
          );
          await onConfirm("gift_card", { giftCardCode: result.code, redeemedPaise: result.redeemedPaise, tipAmount });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Gift card redemption failed";
          setGiftCardError(msg);
          setStage("gift-card-form");
          return;
        }
      } else if (method === "terminal") {
        if (!terminalId) throw new Error("No terminal selected");
        const tipMinor = Math.max(0, Math.round((Number(terminalTip) || 0) * 100));
        const amountMinor = Math.round(totals.totalAmount * 100);
        try {
          setTerminalStatus("Creating payment…");
          const charge = await terminalCharge.mutateAsync({ terminalId, orderId, amountMinor, tipMinor });
          if (!charge.providerRef) throw new Error("Terminal did not return a payment reference");
          setTerminalStatus("Tap or insert card on the reader…");
          await terminalRunOnReader.mutateAsync({ terminalId, providerRef: charge.providerRef });
          setTerminalStatus("Confirming payment…");
          const confirmed = await confirmTerminalCharge.mutateAsync({
            terminalId, orderId,
            providerRef: charge.providerRef,
            amountMinor, tipMinor,
            receiptUrl: charge.receiptUrl,
          });
          await onTerminalConfirmed?.({
            providerRef: charge.providerRef,
            receiptUrl: confirmed.receiptUrl ?? charge.receiptUrl,
          });
        } catch (err) {
          setTerminalError(err instanceof Error ? err.message : "Terminal charge failed");
          setTerminalStatus("");
          setStage("terminal-form");
          return;
        }
      } else {
        await onConfirm("cash", { amountTendered: Number(amountTendered) || undefined, tipAmount });
      }
    } catch {
      toast({ title: "Payment failed", description: "Please try again.", variant: "destructive" });
      setStage(method === "cash" ? "cash-confirm" : method === "card" ? "card-form" : method === "gift_card" ? "gift-card-form" : method === "terminal" ? "terminal-form" : "upi-form");
    }
  };

  const TotalsSummary = () => (
    <div className="bg-muted/50 rounded-xl p-4 border border-border space-y-1.5">
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>Subtotal</span><span>₹{totals.subtotal.toFixed(2)}</span>
      </div>
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>Tax</span><span>₹{totals.taxAmount.toFixed(2)}</span>
      </div>
      {totals.serviceCharge > 0 && (
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Service Charge</span><span>₹{totals.serviceCharge.toFixed(2)}</span>
        </div>
      )}
      {totals.discountAmount > 0 && (
        <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
          <span>Discount</span><span>-₹{totals.discountAmount.toFixed(2)}</span>
        </div>
      )}
      {tipAmount > 0 && (
        <div className="flex justify-between text-sm text-amber-600 dark:text-amber-400">
          <span>Tip{tipPct > 0 ? ` (${tipPct}%)` : ""}</span><span>+₹{tipAmount.toFixed(2)}</span>
        </div>
      )}
      <div className="flex justify-between font-bold text-xl border-t border-border pt-2">
        <span>Total</span>
        <span className="text-primary">₹{grandTotal.toFixed(2)}</span>
      </div>
    </div>
  );

  const TipSelector = () => {
    if (!tipsEnabled) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Add a tip</span>
          {tipAmount > 0 && (
            <button className="text-xs text-muted-foreground hover:underline"
              onClick={() => { setTipPct(0); setCustomTip(""); }}>Clear</button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map(p => (
            <button key={p} onClick={() => { setTipPct(p); setCustomTip(""); }}
              className={`px-3 py-1.5 rounded-lg text-sm border transition ${tipPct === p && tipAmount > 0 ? "bg-primary text-primary-foreground border-primary" : tipPct === 0 && p === 0 ? "bg-muted border-border" : "border-border hover:bg-muted"}`}>
              {p === 0 ? "No tip" : `${p}%`}
            </button>
          ))}
          {customAllowed && (
            <input type="number" min="0" step="0.01" placeholder="Custom ₹"
              value={tipPct === -1 ? customTip : ""}
              onChange={e => { setTipPct(-1); setCustomTip(e.target.value); }}
              className="px-3 py-1.5 rounded-lg text-sm border border-border bg-background w-28" />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" /> Process Payment
          </h2>
          {stage !== "processing" && (
            <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        <div className="p-6 space-y-5">
          {stage === "select" && (
            <>
              <TotalsSummary />
              <TipSelector />
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => {
                    const disabled = (value === "cash" && !isRegisterOpen)
                      || (value === "pay_later" && !hasCustomer);
                    const disabledHint = value === "cash" && !isRegisterOpen
                      ? "Open the cash register before accepting cash"
                      : value === "pay_later" && !hasCustomer
                        ? "Link a customer (by phone) before billing on account"
                        : "";
                    return (
                      <button
                        key={value}
                        disabled={disabled}
                        title={disabledHint}
                        onClick={() => setMethod(value as "cash" | "card" | "upi" | "gift_card" | "terminal" | "pay_later")}
                        className={cn(
                          "flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-sm font-medium transition-all duration-150 active:scale-[0.98]",
                          disabled
                            ? "border-border text-muted-foreground/40 cursor-not-allowed bg-muted/30"
                            : method === value
                              ? "border-primary bg-gradient-to-br from-primary/10 to-primary/5 text-primary shadow-sm shadow-primary/20"
                              : "border-border text-muted-foreground hover:border-primary/50 hover:bg-accent/40"
                        )}
                      >
                        <Icon className="w-5 h-5" />{label}
                      </button>
                    );
                  })}
                </div>
                {!isRegisterOpen && (
                  <div className="mt-2 flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="font-medium text-amber-800 dark:text-amber-200">Cash register is closed</div>
                      <div className="text-amber-700 dark:text-amber-300/80">Open the register before accepting cash payments.</div>
                    </div>
                    <a href="/cash-register" className="text-xs font-semibold text-primary hover:underline whitespace-nowrap">Open Register →</a>
                  </div>
                )}
              </div>
              <Button
                className="w-full h-11"
                onClick={handleProceed}
                disabled={(method === "cash" && !isRegisterOpen) || (method === "pay_later" && !hasCustomer)}
              >
                Continue with {
                  method === "cash" ? "Cash"
                  : method === "card" ? "Card"
                  : method === "gift_card" ? "Gift Card"
                  : method === "terminal" ? "Terminal"
                  : method === "pay_later" ? "Pay Later"
                  : "UPI"
                }
              </Button>
            </>
          )}

          {stage === "cash-confirm" && (
            <>
              <TotalsSummary />
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Amount Tendered</label>
                <Input
                  type="number"
                  placeholder={`₹${totals.totalAmount.toFixed(2)}`}
                  value={amountTendered}
                  onChange={e => setAmountTendered(e.target.value)}
                  className="text-base font-mono"
                  autoFocus
                />
                {change > 0 && (
                  <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2 flex justify-between">
                    <span className="text-green-700 dark:text-green-400 font-medium">Change</span>
                    <span className="text-green-700 dark:text-green-400 font-bold text-xl">₹{change.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  {[100, 200, 500, 1000, 2000].map(amt => (
                    <Button key={amt} size="sm" variant="outline" className="text-xs h-7" onClick={() => setAmountTendered(String(amt))}>
                      ₹{amt}
                    </Button>
                  ))}
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setAmountTendered(totals.totalAmount.toFixed(2))}>
                    Exact
                  </Button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStage("select")}>Back</Button>
                <Button className="flex-1 h-11" disabled={isPending} onClick={handleProcessPayment}>
                  Confirm Cash Payment
                </Button>
              </div>
            </>
          )}

          {stage === "card-form" && (
            <>
              <TotalsSummary />
              <div className="space-y-3">
                {STRIPE_PK ? (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-700 dark:text-blue-400">
                      <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                      Card details are entered securely in Stripe's hosted form — never touch our servers
                    </div>
                    <div
                      ref={cardMountRef}
                      className="border border-border rounded-lg px-4 py-3 bg-background min-h-[44px]"
                    />
                    {stripeError && <p className="text-xs text-red-500">{stripeError}</p>}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 px-4 py-5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-300">
                    <Lock className="w-6 h-6" />
                    <p className="font-semibold">Stripe not configured</p>
                    <p className="text-xs text-center">
                      Set <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">STRIPE_SECRET_KEY</code> and{" "}
                      <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">VITE_STRIPE_PUBLISHABLE_KEY</code> to enable real card payments.
                      In demo mode no card data is collected.
                    </p>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStage("select")}>Back</Button>
                <Button
                  className="flex-1 h-11"
                  disabled={(!!STRIPE_PK && !cardReady) || isPending || createPaymentIntent.isPending}
                  onClick={handleProcessPayment}
                >
                  <Lock className="w-3.5 h-3.5 mr-2" />
                  {STRIPE_PK ? `Pay ₹${grandTotal.toFixed(2)}` : "Process Demo Payment"}
                </Button>
              </div>
            </>
          )}

          {stage === "upi-form" && (
            <>
              <TotalsSummary />
              <div className="space-y-3">
                {RAZORPAY_KEY ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg text-xs text-purple-700 dark:text-purple-400">
                    <Smartphone className="w-3.5 h-3.5 flex-shrink-0" />
                    Razorpay UPI checkout will open in a secure popup
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 px-4 py-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-300">
                    <Smartphone className="w-6 h-6" />
                    <p className="font-semibold">Razorpay not configured</p>
                    <p className="text-xs text-center">
                      Set <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">VITE_RAZORPAY_KEY_ID</code> to enable real UPI payments.
                      In demo mode the payment is simulated.
                    </p>
                  </div>
                )}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Customer UPI ID (for receipt reference)</label>
                  <Input
                    placeholder="customer@paytm / 9999999999@ybl"
                    value={upiId}
                    onChange={e => setUpiId(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="text-center py-1">
                  <p className="text-xs text-muted-foreground">
                    Amount: <span className="font-bold text-foreground text-base">₹{totals.totalAmount.toFixed(2)}</span>
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStage("select")}>Back</Button>
                <Button
                  className="flex-1 h-11"
                  disabled={isPending}
                  onClick={handleProcessPayment}
                >
                  <Smartphone className="w-3.5 h-3.5 mr-2" />
                  {RAZORPAY_KEY ? "Open Razorpay" : "Process Demo UPI"}
                </Button>
              </div>
            </>
          )}

          {stage === "gift-card-form" && (
            <>
              <TotalsSummary />
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-3 py-2 bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800 rounded-lg text-xs text-pink-700 dark:text-pink-400">
                  <Gift className="w-3.5 h-3.5 flex-shrink-0" />
                  Enter the gift card code to redeem ₹{totals.totalAmount.toFixed(2)}. Insufficient balance will be rejected.
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Gift Card Code</label>
                  <Input
                    placeholder="e.g. GC-XXXX-XXXX-XXXX"
                    value={giftCardCode}
                    onChange={e => { setGiftCardCode(e.target.value); setGiftCardError(""); }}
                    autoFocus
                    className="font-mono uppercase"
                  />
                  {giftCardError && <p className="text-xs text-red-500 mt-1">{giftCardError}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStage("select")}>Back</Button>
                <Button
                  className="flex-1 h-11"
                  disabled={isPending || !giftCardCode.trim()}
                  onClick={handleProcessPayment}
                >
                  <Gift className="w-3.5 h-3.5 mr-2" />
                  Redeem ₹{totals.totalAmount.toFixed(2)}
                </Button>
              </div>
            </>
          )}

          {stage === "terminal-form" && (
            <>
              <TotalsSummary />
              {terminals.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-4 py-6 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-300 text-center">
                  <CreditCard className="w-7 h-7" />
                  <p className="font-semibold">Configuration required</p>
                  <p className="text-xs">No card terminals are paired yet. Pair one in Settings → Card Terminals to accept tap-to-pay.</p>
                  <Link href="/settings/terminals">
                    <Button size="sm" className="mt-1 gap-1.5">
                      <CreditCard className="w-3.5 h-3.5" />
                      Open Terminal Settings
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Terminal</label>
                    <div className="grid grid-cols-1 gap-2">
                      {terminals.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => { setTerminalId(t.id); setTerminalError(""); }}
                          className={cn(
                            "flex items-center justify-between px-3 py-2 rounded-lg border-2 text-sm transition-all",
                            terminalId === t.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <CreditCard className="w-4 h-4 text-primary" />
                            <span className="font-medium">{t.name}</span>
                            <span className="text-xs text-muted-foreground capitalize">{t.terminal?.provider}</span>
                          </span>
                          <span className={cn(
                            "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded",
                            t.status === "online" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600",
                          )}>{t.status}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Tip on terminal (optional)</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={terminalTip}
                      onChange={e => setTerminalTip(e.target.value)}
                    />
                  </div>
                  {terminalError && (
                    <div className="flex items-start gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-400">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>{terminalError}</span>
                    </div>
                  )}
                  <div className="text-center py-1">
                    <p className="text-xs text-muted-foreground">
                      Charging: <span className="font-bold text-foreground text-base">
                        ₹{(totals.totalAmount + (Number(terminalTip) || 0)).toFixed(2)}
                      </span>
                    </p>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStage("select")}>Back</Button>
                <Button
                  className="flex-1 h-11"
                  disabled={isPending || terminals.length === 0 || !terminalId || terminalCharge.isPending || terminalRunOnReader.isPending}
                  onClick={handleProcessPayment}
                >
                  <CreditCard className="w-3.5 h-3.5 mr-2" />
                  Charge Terminal
                </Button>
              </div>
            </>
          )}

          {stage === "processing" && (
            <div className="py-8 flex flex-col items-center gap-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <p className="text-base font-medium text-foreground">Processing payment…</p>
              <p className="text-sm text-muted-foreground text-center">
                {method === "terminal"
                  ? (terminalStatus || "Communicating with reader…")
                  : method === "card" ? "Contacting payment gateway"
                  : method === "upi" ? "Awaiting UPI confirmation"
                  : method === "gift_card" ? "Redeeming gift card"
                  : "Confirming payment"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
