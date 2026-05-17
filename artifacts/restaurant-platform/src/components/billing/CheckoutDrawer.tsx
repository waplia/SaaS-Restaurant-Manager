import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadField, resolveImageUrl } from "@/components/ImageUploadField";
import {
  useCreateCheckout,
  useCreateCashfreeOrder,
  useCreateSubscriptionRazorpayOrder, useConfirmSubscriptionRazorpayOrder, useSubmitManualPayment,
  useValidateCoupon, type CouponValidationResult,
} from "@/lib/hooks";
import type { PaymentMethodsView } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ExternalLink, RefreshCw, CreditCard,
  Landmark, Smartphone, Clock,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAppSettings } from "@/lib/appSettings";
import { ApiError } from "@/lib/api";
import type { SubscriptionPlan } from "@/lib/types";

export type PayMethod = "cashfree" | "razorpay" | "stripe" | "bank" | "upi";

const RESTAURANT_ID = 1;
const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  handler: (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}
type RazorpayInstance = { open: () => void };
type RazorpayCtor = new (opts: RazorpayCheckoutOptions) => RazorpayInstance;

export function loadRazorpay(): Promise<RazorpayCtor> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Razorpay?: RazorpayCtor };
    if (w.Razorpay) return resolve(w.Razorpay);
    const s = document.createElement("script");
    s.src = RAZORPAY_SCRIPT;
    s.async = true;
    s.onload = () => {
      const w2 = window as unknown as { Razorpay?: RazorpayCtor };
      w2.Razorpay ? resolve(w2.Razorpay) : reject(new Error("Razorpay script loaded but global missing"));
    };
    s.onerror = () => reject(new Error("Could not load Razorpay checkout"));
    document.body.appendChild(s);
  });
}

function MethodChip({ id, label, icon: Icon, selected, onClick, disabled }: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; selected: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      key={id}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
        selected ? "border-primary bg-primary/10 text-foreground font-medium" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <Icon className="w-4 h-4" />{label}
    </button>
  );
}

function ManualForm({
  reference, setReference,
  amount, setAmount,
  proofUrl, setProofUrl,
  note, setNote,
  referencePlaceholder, referenceLabel, sym,
}: {
  reference: string; setReference: (v: string) => void;
  amount: string; setAmount: (v: string) => void;
  proofUrl: string; setProofUrl: (v: string) => void;
  note: string; setNote: (v: string) => void;
  referencePlaceholder: string; referenceLabel: string; sym: string;
}) {
  return (
    <>
      <div className="space-y-1.5"><Label htmlFor="ref">{referenceLabel}</Label><Input id="ref" value={reference} onChange={e => setReference(e.target.value)} placeholder={referencePlaceholder} /></div>
      <div className="space-y-1.5">
        <Label htmlFor="amount">Amount paid ({sym})</Label>
        <Input id="amount" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount transferred" />
      </div>
      <div className="space-y-1.5">
        <ImageUploadField label="Proof of payment (screenshot/receipt)" value={proofUrl} onChange={setProofUrl} />
      </div>
      <div className="space-y-1.5"><Label htmlFor="note">Note (optional)</Label><Textarea id="note" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Anything we should know" /></div>
    </>
  );
}

export function CheckoutDrawer({
  plan, methods, methodsLoading, initialMethod, initialBillingPeriod, onClose, onPaid,
}: {
  plan: SubscriptionPlan & { currency?: string };
  methods: PaymentMethodsView | undefined;
  methodsLoading: boolean;
  initialMethod?: PayMethod;
  initialBillingPeriod?: "monthly" | "yearly";
  onClose: () => void;
  onPaid: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const appSettings = useAppSettings();
  const createCheckout = useCreateCheckout();
  const createCashfree = useCreateCashfreeOrder();
  const createRazorpay = useCreateSubscriptionRazorpayOrder();
  const confirmRazorpay = useConfirmSubscriptionRazorpayOrder();
  const submitManual = useSubmitManualPayment();
  const validateCoupon = useValidateCoupon();
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<CouponValidationResult | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  async function applyCoupon() {
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setCouponResult(null); setCouponError(null);
      return;
    }
    try {
      const r = await validateCoupon.mutateAsync({ code, planId: plan.id, restaurantId: RESTAURANT_ID });
      if (r.valid) { setCouponResult(r); setCouponError(null); }
      else { setCouponResult(null); setCouponError(r.message ?? "Coupon is not valid for this plan."); }
    } catch (err) {
      setCouponResult(null);
      const e = err as { data?: { message?: string }; message?: string };
      setCouponError(e.data?.message ?? e.message ?? "Could not validate coupon.");
    }
  }
  function clearCoupon() {
    setCouponCode(""); setCouponResult(null); setCouponError(null);
  }

  const effectiveMethods: PaymentMethodsView = methods ?? {
    online: { cashfree: { enabled: false }, razorpay: { enabled: false, keyId: null }, stripe: { enabled: false }, default: null },
    manual: { bank: { enabled: false }, upi: { enabled: false } },
    latestManual: null,
    pendingManual: null,
  };

  const planCurrency = (plan.currency ?? "INR").toUpperCase();
  const manualAllowed = planCurrency === "INR";
  const available: PayMethod[] = [];
  if (effectiveMethods.online.cashfree.enabled) available.push("cashfree");
  if (effectiveMethods.online.razorpay.enabled) available.push("razorpay");
  if (effectiveMethods.online.stripe.enabled) available.push("stripe");
  if (manualAllowed && effectiveMethods.manual.upi.enabled) available.push("upi");
  if (manualAllowed && effectiveMethods.manual.bank.enabled) available.push("bank");

  const defOnline = effectiveMethods.online.default;
  const defaultMethod: PayMethod | null =
    initialMethod && available.includes(initialMethod) ? initialMethod
    : defOnline && available.includes(defOnline) ? defOnline
    : (available[0] ?? null);
  const [method, setMethod] = useState<PayMethod>(defaultMethod ?? "cashfree");
  useEffect(() => {
    if (available.length > 0 && !available.includes(method)) {
      setMethod(available[0]);
    }
  }, [available.join("|"), method]);
  const [reference, setReference] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [note, setNote] = useState("");
  const planYearly = (plan as { yearlyPrice?: string | null }).yearlyPrice;
  const yearlyConfigured = planYearly != null && planYearly !== "" && Number(planYearly) > 0;
  const initialPeriod: "monthly" | "yearly" =
    initialBillingPeriod === "yearly" && yearlyConfigured ? "yearly"
    : initialBillingPeriod === "monthly" ? "monthly"
    : plan.billingPeriod === "yearly" ? "yearly" : "monthly";
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">(initialPeriod);
  const periodPrice = billingPeriod === "yearly" && yearlyConfigured
    ? Number(planYearly)
    : Number(plan.price);
  const [amount, setAmount] = useState<string>(String(periodPrice || ""));
  const [busy, setBusy] = useState(false);

  async function handlePay() {
    setBusy(true);
    try {
      const origin = window.location.origin;
      const base = import.meta.env.BASE_URL ?? "/";
      const successUrl = `${origin}${base}settings/subscription`;
      const cancelUrl = successUrl;

      const cc = couponResult?.code;
      if (method === "cashfree") {
        const r = await createCashfree.mutateAsync({ restaurantId: RESTAURANT_ID, planId: plan.id, successUrl, couponCode: cc, billingPeriod });
        if (r.activated || r.freeActivation) {
          toast({ title: "Subscription activated", description: cc ? `Coupon ${cc} covered the full amount.` : "Activated." });
          onPaid(); return;
        }
        if (r.url) { window.location.href = r.url; return; }
        throw new Error("Cashfree didn't return a checkout URL.");
      } else if (method === "stripe") {
        const r = await createCheckout.mutateAsync({ restaurantId: RESTAURANT_ID, planId: plan.id, successUrl, cancelUrl, couponCode: cc, billingPeriod });
        if (r.activated || r.freeActivation) {
          toast({ title: "Subscription activated", description: cc ? `Coupon ${cc} covered the full amount.` : "Activated." });
          onPaid(); return;
        }
        if (r.url) { window.location.href = r.url; return; }
        throw new Error("Stripe didn't return a checkout URL.");
      } else if (method === "razorpay") {
        const order = await createRazorpay.mutateAsync({ restaurantId: RESTAURANT_ID, planId: plan.id, couponCode: cc, billingPeriod });
        if (order.activated) {
          toast({ title: "Subscription activated", description: cc ? `Coupon ${cc} covered the full amount.` : "Activated." });
          onPaid(); return;
        }
        if (!order.orderId || !order.keyId) {
          throw new Error("Razorpay order could not be created.");
        }
        const Razorpay = await loadRazorpay();
        const rzp = new Razorpay({
          key: order.keyId,
          amount: order.amount ?? 0,
          currency: order.currency ?? "INR",
          name: "KhanaLagao",
          description: `${plan.name} subscription`,
          order_id: order.orderId,
          prefill: { name: user?.name ?? "", email: user?.email ?? undefined },
          handler: async (resp) => {
            try {
              const r = await confirmRazorpay.mutateAsync({
                restaurantId: RESTAURANT_ID,
                orderId: resp.razorpay_order_id,
                paymentId: resp.razorpay_payment_id,
                signature: resp.razorpay_signature,
              });
              if (r.activated) {
                toast({ title: "Subscription activated", description: "Thanks — your Razorpay payment was confirmed." });
                onPaid();
              } else {
                toast({ title: "Payment pending", description: `Status: ${r.status ?? "processing"}.` });
                onPaid();
              }
            } catch (err) {
              toast({ title: "Could not verify payment", description: (err as Error).message, variant: "destructive" });
            }
          },
          modal: { ondismiss: () => setBusy(false) },
          theme: { color: "#f97316" },
        });
        rzp.open();
        return;
      } else if (method === "bank" || method === "upi") {
        if (!reference.trim()) {
          toast({ title: "Reference required", description: "Please enter the bank/UPI transaction reference.", variant: "destructive" });
          setBusy(false);
          return;
        }
        const amt = amount === "" ? undefined : Number(amount);
        if (amt !== undefined && (!Number.isFinite(amt) || amt <= 0)) {
          toast({ title: "Invalid amount", description: "Please enter a positive amount.", variant: "destructive" });
          setBusy(false);
          return;
        }
        await submitManual.mutateAsync({
          restaurantId: RESTAURANT_ID, planId: plan.id, method,
          reference: reference.trim(),
          proofUrl: proofUrl.trim() || undefined,
          note: note.trim() || undefined,
          amount: amt,
          couponCode: cc,
          billingPeriod,
        });
        toast({ title: "Submitted for review", description: "Our team will verify and activate your plan within one business day." });
        onPaid();
      }
    } catch (err) {
      const apiErr = err as ApiError & { data?: { code?: string; provider?: string } };
      const code = apiErr?.data?.code;
      if (code === "GATEWAY_DISABLED") {
        toast({
          title: "Payment method unavailable",
          description: `${apiErr.data?.provider ?? "This provider"} isn't fully configured yet. Please pick another method or contact support.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Payment could not start", description: (err as Error).message, variant: "destructive" });
      }
    } finally {
      if (method !== "razorpay") setBusy(false);
    }
  }

  const sym = (plan.currency ?? "INR").toUpperCase() === "USD" ? "$" : "₹";

  const monthlyN = Number(plan.price) || 0;
  const yearlyN = yearlyConfigured ? Number(planYearly) : 0;
  const isStillListAmount = amount === "" || Number(amount) === monthlyN || Number(amount) === yearlyN;
  function chooseBillingPeriod(next: "monthly" | "yearly") {
    setBillingPeriod(next);
    if (isStillListAmount) {
      const np = next === "yearly" && yearlyConfigured ? yearlyN : monthlyN;
      setAmount(String(np || ""));
    }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "p-0 flex flex-col gap-0",
          isMobile
            ? "h-[100dvh] max-h-[100dvh] w-full pb-[env(safe-area-inset-bottom)]"
            : "w-full sm:max-w-md sm:h-full",
        )}
        data-testid="checkout-drawer"
      >
        <SheetHeader className="px-6 py-4 border-b border-border space-y-1 text-left">
          <SheetTitle>Pay for {plan.name}</SheetTitle>
          <SheetDescription>
            {sym}{periodPrice.toLocaleString()} / {billingPeriod === "yearly" ? "year" : "month"}
          </SheetDescription>
          {yearlyConfigured && plan.billingPeriod !== "yearly" && (
            <div className="mt-2 inline-flex rounded-md border border-border bg-muted/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => chooseBillingPeriod("monthly")}
                className={`px-2.5 py-1 rounded ${billingPeriod === "monthly" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
              >Monthly</button>
              <button
                type="button"
                onClick={() => chooseBillingPeriod("yearly")}
                className={`px-2.5 py-1 rounded ${billingPeriod === "yearly" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
              >Yearly</button>
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {methodsLoading && !methods ? (
            <div className="space-y-3" data-testid="checkout-methods-skeleton">
              <div className="h-3 w-32 bg-muted rounded animate-pulse" />
              <div className="flex gap-2">
                <div className="h-9 w-24 bg-muted rounded animate-pulse" />
                <div className="h-9 w-24 bg-muted rounded animate-pulse" />
                <div className="h-9 w-24 bg-muted rounded animate-pulse" />
              </div>
              <div className="h-32 bg-muted/50 rounded animate-pulse" />
            </div>
          ) : available.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center space-y-2">
              <CreditCard className="w-6 h-6 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Online payments aren't set up yet. Please contact support to activate your plan.
              </p>
              <a
                href={`mailto:${appSettings.supportEmail}?subject=${encodeURIComponent(`Activate ${plan.name} plan`)}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Email {appSettings.supportEmail}
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <div>
              <p className="text-xs uppercase font-semibold tracking-wide text-muted-foreground mb-2">Choose a payment method</p>
              <div className="flex flex-wrap gap-2">
                {available.map(m => {
                  if (m === "cashfree") return <MethodChip key={m} id="cashfree" label="Cashfree" icon={CreditCard} selected={method === "cashfree"} onClick={() => setMethod("cashfree")} />;
                  if (m === "razorpay") return <MethodChip key={m} id="razorpay" label="Razorpay" icon={CreditCard} selected={method === "razorpay"} onClick={() => setMethod("razorpay")} />;
                  if (m === "stripe")   return <MethodChip key={m} id="stripe"   label="Stripe"   icon={CreditCard} selected={method === "stripe"}   onClick={() => setMethod("stripe")} />;
                  if (m === "bank")     return <MethodChip key={m} id="bank"     label="Bank transfer" icon={Landmark}   selected={method === "bank"}     onClick={() => setMethod("bank")} />;
                  if (m === "upi")      return <MethodChip key={m} id="upi"      label="UPI"      icon={Smartphone} selected={method === "upi"}      onClick={() => setMethod("upi")} />;
                  return null;
                })}
              </div>
            </div>
          )}

          {method === "bank" && effectiveMethods.manual.bank.enabled && (
            <div className="space-y-3">
              {effectiveMethods.manual.bank.isPlaceholder && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  Sample details — ask your admin to update these in Admin → Payment methods. You can still submit a payment request below.
                </div>
              )}
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm space-y-1">
                {effectiveMethods.manual.bank.bankName && <p><span className="text-muted-foreground">Bank:</span> <span className="font-medium">{effectiveMethods.manual.bank.bankName}</span></p>}
                {effectiveMethods.manual.bank.accountHolder && <p><span className="text-muted-foreground">Account holder:</span> <span className="font-medium">{effectiveMethods.manual.bank.accountHolder}</span></p>}
                {effectiveMethods.manual.bank.accountNumber && <p><span className="text-muted-foreground">Account no.:</span> <span className="font-mono font-medium">{effectiveMethods.manual.bank.accountNumber}</span></p>}
                {effectiveMethods.manual.bank.ifsc && <p><span className="text-muted-foreground">IFSC:</span> <span className="font-mono font-medium">{effectiveMethods.manual.bank.ifsc}</span></p>}
                {effectiveMethods.manual.bank.branch && <p><span className="text-muted-foreground">Branch:</span> <span className="font-medium">{effectiveMethods.manual.bank.branch}</span></p>}
                {effectiveMethods.manual.bank.instructions && <p className="text-muted-foreground pt-1 border-t border-border mt-2">{effectiveMethods.manual.bank.instructions}</p>}
              </div>
              <ManualForm
                reference={reference} setReference={setReference}
                amount={amount} setAmount={setAmount}
                proofUrl={proofUrl} setProofUrl={setProofUrl}
                note={note} setNote={setNote}
                referencePlaceholder="UTR number or transaction id"
                referenceLabel="Transaction reference / UTR"
                sym={sym}
              />
            </div>
          )}

          {method === "upi" && effectiveMethods.manual.upi.enabled && (
            <div className="space-y-3">
              {effectiveMethods.manual.upi.isPlaceholder && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  Sample details — ask your admin to update these in Admin → Payment methods. You can still submit a payment request below.
                </div>
              )}
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm space-y-2">
                {effectiveMethods.manual.upi.upiId && <p><span className="text-muted-foreground">UPI ID:</span> <span className="font-mono font-medium">{effectiveMethods.manual.upi.upiId}</span></p>}
                {effectiveMethods.manual.upi.payeeName && <p><span className="text-muted-foreground">Payee:</span> <span className="font-medium">{effectiveMethods.manual.upi.payeeName}</span></p>}
                {effectiveMethods.manual.upi.qrUrl && <img src={resolveImageUrl(effectiveMethods.manual.upi.qrUrl)} alt="UPI QR code" className="w-40 h-40 rounded-md border border-border bg-white p-2" />}
              </div>
              <ManualForm
                reference={reference} setReference={setReference}
                amount={amount} setAmount={setAmount}
                proofUrl={proofUrl} setProofUrl={setProofUrl}
                note={note} setNote={setNote}
                referencePlaceholder="UPI transaction id (RRN)"
                referenceLabel="UPI reference"
                sym={sym}
              />
            </div>
          )}

          {(method === "bank" || method === "upi") && (
            <p className="text-xs text-muted-foreground flex items-start gap-2">
              <Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              Manual payments are reviewed by our team. Your plan will be activated once we've confirmed receipt — usually within one business day.
            </p>
          )}

          <div className="border-t border-border pt-4 space-y-2">
            <Label htmlFor="coupon" className="text-xs uppercase font-semibold tracking-wide text-muted-foreground">Promo code</Label>
            <div className="flex gap-2">
              <Input
                id="coupon" value={couponCode}
                onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponResult(null); setCouponError(null); }}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); applyCoupon(); } }}
                placeholder="Enter promo code"
                className="font-mono uppercase"
                disabled={!!couponResult}
              />
              {couponResult ? (
                <Button type="button" variant="outline" onClick={clearCoupon}>Remove</Button>
              ) : (
                <Button type="button" variant="outline" onClick={applyCoupon} disabled={validateCoupon.isPending || !couponCode.trim()}>
                  {validateCoupon.isPending ? "Checking…" : "Apply"}
                </Button>
              )}
            </div>
            {couponError && <p className="text-xs text-destructive">{couponError}</p>}
            {couponResult && couponResult.valid && (
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{couponResult.code} applied</span>
                  {couponResult.discountType === "trial_extension" ? (
                    <span className="font-mono">+{couponResult.trialDaysAdded} day{couponResult.trialDaysAdded === 1 ? "" : "s"}</span>
                  ) : (
                    <span className="font-mono">−{sym}{Number(couponResult.discountApplied ?? 0).toLocaleString()}</span>
                  )}
                </div>
                {couponResult.discountType !== "trial_extension" && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="opacity-80">{couponResult.discountType === "lifetime" ? "Lifetime discount — applied to every renewal" : couponResult.discountType === "first_month" ? "Applies to your first billing cycle only" : "Discount applied"}</span>
                    <span>You pay <strong>{sym}{Number(couponResult.finalAmount ?? 0).toLocaleString()}</strong></span>
                  </div>
                )}
                {couponResult.discountType === "trial_extension" && couponResult.message && (
                  <p className="text-xs opacity-80">{couponResult.message}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {available.length > 0 && (
            <Button onClick={handlePay} disabled={busy}>
              {busy ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
              {method === "bank" || method === "upi" ? "Submit for review" : "Continue to payment"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
