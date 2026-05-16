import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadField, resolveImageUrl } from "@/components/ImageUploadField";
import {
  useSubscription, useCreateCheckout, useMockActivate,
  useCreateCashfreeOrder, useConfirmCashfreeOrder,
  usePaymentMethods, useCreateSubscriptionRazorpayOrder, useConfirmSubscriptionRazorpayOrder, useSubmitManualPayment,
  useValidateCoupon, type CouponValidationResult,
} from "@/lib/hooks";
import type { PaymentMethodsView } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Check, Crown, Zap, Building, Users, Table2, UtensilsCrossed,
  AlertTriangle, ExternalLink, RefreshCw, CreditCard, Minus,
  Landmark, Smartphone, Clock, X,
} from "lucide-react";
import type { SubscriptionPlan } from "@/lib/types";
import {
  PLAN_BOOLEAN_FEATURES, PLAN_QUANTITY_FEATURES,
  isFeatureEnabled, formatQuantity,
} from "@workspace/db/planFeatures";

type PayMethod = "cashfree" | "razorpay" | "stripe" | "bank" | "upi";

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

function loadRazorpay(): Promise<RazorpayCtor> {
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

function UsageMeter({ label, used, max, icon: Icon }: { label: string; used: number; max: number; icon: React.ComponentType<{ className?: string }> }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-orange-400" : "bg-primary";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground"><Icon className="w-3.5 h-3.5" />{label}</span>
        <span className="font-medium">{used} / {max === 999999 ? "∞" : max}</span>
      </div>
      <div className="h-2 rounded-full bg-accent overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PlanCard({
  plan, isCurrent, onChoose, isLoading,
}: {
  plan: SubscriptionPlan & { currency?: string };
  isCurrent: boolean;
  onChoose: (planId: number) => void;
  isLoading: boolean;
}) {
  const price = Number(plan.price);
  const isPopular = plan.slug === "professional" || plan.slug === "pro";
  const currency = (plan.currency ?? "INR").toUpperCase();
  const sym = currency === "USD" ? "$" : "₹";

  return (
    <div className={cn(
      "relative rounded-2xl border-2 p-6 flex flex-col gap-4 transition-all",
      isCurrent
        ? "border-primary bg-primary/5"
        : isPopular
          ? "border-orange-300 dark:border-orange-700 shadow-lg"
          : "border-border hover:border-primary/40",
    )}>
      {isPopular && !isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">Most Popular</div>
      )}
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
          <Check className="w-3 h-3" /> Current Plan
        </div>
      )}

      <div>
        <p className="font-bold text-lg text-foreground capitalize">{plan.name}</p>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="text-3xl font-bold text-foreground">{sym}{price.toLocaleString()}</span>
          <span className="text-sm text-muted-foreground">/{plan.billingPeriod === "yearly" ? "yr" : "mo"}</span>
        </div>
      </div>

      <ul className="space-y-2 flex-1">
        {PLAN_QUANTITY_FEATURES.map(q => {
          const label = formatQuantity(q, Number(plan[q.key] ?? 0));
          if (!label) return null;
          return (
            <li key={q.key} className="flex items-center gap-2 text-sm text-foreground">
              <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />{label}
            </li>
          );
        })}
        {PLAN_BOOLEAN_FEATURES.map(f => {
          const on = isFeatureEnabled(plan.featureFlags, f.key);
          return (
            <li key={f.key} className={cn("flex items-center gap-2 text-sm", on ? "text-foreground" : "text-muted-foreground/70 line-through decoration-muted-foreground/40")} title={f.description}>
              {on ? <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" /> : <Minus className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />}
              {f.label}
            </li>
          );
        })}
        {(plan.features ?? []).map(extra => (
          <li key={extra} className="flex items-center gap-2 text-sm text-foreground">
            <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />{extra}
          </li>
        ))}
      </ul>

      <Button onClick={() => onChoose(plan.id)} disabled={isCurrent || isLoading} variant={isCurrent ? "outline" : "default"} className="w-full">
        {isCurrent ? "Current Plan" : isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Choose this plan"}
      </Button>
    </div>
  );
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

function CheckoutModal({
  plan, methods, initialMethod, onClose, onPaid,
}: {
  plan: SubscriptionPlan & { currency?: string };
  methods: PaymentMethodsView;
  initialMethod?: PayMethod;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const createCheckout = useCreateCheckout();
  const createCashfree = useCreateCashfreeOrder();
  const createRazorpay = useCreateSubscriptionRazorpayOrder();
  const confirmRazorpay = useConfirmSubscriptionRazorpayOrder();
  const submitManual = useSubmitManualPayment();
  const mockActivate = useMockActivate();
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

  // Build the list in the order tenants should see them, with the admin-configured
  // default online provider first.
  const planCurrency = (plan.currency ?? "INR").toUpperCase();
  const manualAllowed = planCurrency === "INR";
  const available: PayMethod[] = [];
  const defOnline = methods.online.default;
  if (defOnline === "razorpay" && methods.online.razorpay.enabled) available.push("razorpay");
  if (defOnline === "cashfree" && methods.online.cashfree.enabled) available.push("cashfree");
  if (methods.online.cashfree.enabled && !available.includes("cashfree")) available.push("cashfree");
  if (methods.online.razorpay.enabled && !available.includes("razorpay")) available.push("razorpay");
  if (methods.online.stripe.enabled) available.push("stripe");
  if (manualAllowed && methods.manual.bank.enabled) available.push("bank");
  if (manualAllowed && methods.manual.upi.enabled) available.push("upi");

  const [method, setMethod] = useState<PayMethod>(
    initialMethod && available.includes(initialMethod) ? initialMethod : (available[0] ?? "cashfree"),
  );
  const [reference, setReference] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState<string>(String(Number(plan.price) || ""));
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
        const r = await createCashfree.mutateAsync({ restaurantId: RESTAURANT_ID, planId: plan.id, successUrl, couponCode: cc });
        if (r.activated) {
          toast({ title: "Subscription activated", description: cc ? `Coupon ${cc} covered the full amount.` : "Activated." });
          onPaid(); return;
        }
        if (r.url) { window.location.href = r.url; return; }
        if (r.mock) {
          await mockActivate.mutateAsync({ restaurantId: RESTAURANT_ID, planId: plan.id, couponCode: cc });
          toast({ title: "Plan activated (demo)", description: "Cashfree not configured — plan upgraded in demo mode." });
          onPaid(); return;
        }
      } else if (method === "stripe") {
        const r = await createCheckout.mutateAsync({ restaurantId: RESTAURANT_ID, planId: plan.id, successUrl, cancelUrl });
        if (r.url) { window.location.href = r.url; return; }
        if (r.mock) {
          await mockActivate.mutateAsync({ restaurantId: RESTAURANT_ID, planId: plan.id, couponCode: cc });
          toast({ title: "Plan activated (demo)", description: "Stripe not configured — plan upgraded in demo mode." });
          onPaid(); return;
        }
      } else if (method === "razorpay") {
        const order = await createRazorpay.mutateAsync({ restaurantId: RESTAURANT_ID, planId: plan.id, couponCode: cc });
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
          name: "Khana Lagao",
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
        return; // checkout opened — leave modal in place until handler/dismiss
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
        });
        toast({ title: "Submitted for review", description: "Our team will verify and activate your plan within one business day." });
        onPaid();
      }
    } catch (err) {
      toast({ title: "Payment could not start", description: (err as Error).message, variant: "destructive" });
    } finally {
      if (method !== "razorpay") setBusy(false);
    }
  }

  const sym = (plan.currency ?? "INR").toUpperCase() === "USD" ? "$" : "₹";

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="font-semibold text-lg">Pay for {plan.name}</h3>
            <p className="text-sm text-muted-foreground">{sym}{Number(plan.price).toLocaleString()} / {plan.billingPeriod === "yearly" ? "year" : "month"}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
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
              {available.length === 0 && <p className="text-sm text-muted-foreground">No payment methods are currently enabled. Please contact support.</p>}
            </div>
          </div>

          {method === "bank" && methods.manual.bank.enabled && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm space-y-1">
                {methods.manual.bank.bankName && <p><span className="text-muted-foreground">Bank:</span> <span className="font-medium">{methods.manual.bank.bankName}</span></p>}
                {methods.manual.bank.accountHolder && <p><span className="text-muted-foreground">Account holder:</span> <span className="font-medium">{methods.manual.bank.accountHolder}</span></p>}
                {methods.manual.bank.accountNumber && <p><span className="text-muted-foreground">Account no.:</span> <span className="font-mono font-medium">{methods.manual.bank.accountNumber}</span></p>}
                {methods.manual.bank.ifsc && <p><span className="text-muted-foreground">IFSC:</span> <span className="font-mono font-medium">{methods.manual.bank.ifsc}</span></p>}
                {methods.manual.bank.branch && <p><span className="text-muted-foreground">Branch:</span> <span className="font-medium">{methods.manual.bank.branch}</span></p>}
                {methods.manual.bank.instructions && <p className="text-muted-foreground pt-1 border-t border-border mt-2">{methods.manual.bank.instructions}</p>}
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

          {method === "upi" && methods.manual.upi.enabled && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm space-y-2">
                {methods.manual.upi.upiId && <p><span className="text-muted-foreground">UPI ID:</span> <span className="font-mono font-medium">{methods.manual.upi.upiId}</span></p>}
                {methods.manual.upi.payeeName && <p><span className="text-muted-foreground">Payee:</span> <span className="font-medium">{methods.manual.upi.payeeName}</span></p>}
                {methods.manual.upi.qrUrl && <img src={resolveImageUrl(methods.manual.upi.qrUrl)} alt="UPI QR code" className="w-40 h-40 rounded-md border border-border bg-white p-2" />}
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
          <Button onClick={handlePay} disabled={busy || available.length === 0}>
            {busy ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {method === "bank" || method === "upi" ? "Submit for review" : "Continue to payment"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionPage() {
  const { data, isLoading, refetch } = useSubscription(RESTAURANT_ID);
  const { data: methods } = usePaymentMethods(RESTAURANT_ID);
  const confirmCashfreeOrder = useConfirmCashfreeOrder();
  const { user } = useAuth();
  const { toast } = useToast();
  const [activePlan, setActivePlan] = useState<(SubscriptionPlan & { currency?: string }) | null>(null);
  const [initialMethod, setInitialMethod] = useState<PayMethod | undefined>(undefined);

  const { tenant, plan: currentPlan, plans = [], usage } = (data ?? {}) as {
    tenant?: { trialDaysLeft?: number | null; isTrialExpired?: boolean; planStatus?: string; trialEndsAt?: string | null; subscriptionEndsAt?: string | null };
    plan?: SubscriptionPlan & { currency?: string };
    plans?: (SubscriptionPlan & { currency?: string })[];
    usage?: { staffCount: number; tableCount: number; menuItemCount: number };
  };
  const isOwner = user?.role === "owner" || user?.isSuperAdmin;

  // If we returned from Cashfree (?cashfree_order_id=...), confirm it.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const cfOrderId = sp.get("cashfree_order_id");
    if (!cfOrderId) return;
    confirmCashfreeOrder.mutateAsync({ restaurantId: RESTAURANT_ID, orderId: cfOrderId })
      .then(r => {
        if (r.activated) {
          toast({ title: "Subscription activated", description: "Thanks — your Cashfree payment was confirmed." });
        } else if (!r.mock) {
          const s = (r.status ?? "").toUpperCase();
          if (s === "FAILED" || s === "USER_DROPPED" || s === "CANCELLED") {
            toast({ title: "Payment was not completed", description: "Your Cashfree checkout was cancelled or failed. You haven't been charged.", variant: "destructive" });
          } else if (s === "EXPIRED") {
            toast({ title: "Checkout session expired", description: "Please try the payment again.", variant: "destructive" });
          } else {
            toast({ title: "Payment pending", description: `Status: ${r.status ?? "unknown"}. We'll update once Cashfree confirms.` });
          }
        }
      })
      .catch(() => toast({ title: "Could not confirm payment", variant: "destructive" }))
      .finally(() => {
        sp.delete("cashfree_order_id");
        const newSearch = sp.toString();
        const url = window.location.pathname + (newSearch ? `?${newSearch}` : "");
        window.history.replaceState({}, "", url);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return (
      <Layout>
        <PageHeader title="Subscription" subtitle="Manage your plan" />
        <div className="p-6 flex items-center justify-center min-h-64 text-muted-foreground text-sm">Loading…</div>
      </Layout>
    );
  }

  const trialDaysLeft = tenant?.trialDaysLeft ?? null;
  const isExpired = tenant?.isTrialExpired;
  const planStatus = tenant?.planStatus ?? "trial";

  return (
    <Layout>
      <PageHeader title="Subscription & Billing" subtitle="Manage your Khana Lagao plan" />

      <div className="p-6 max-w-5xl space-y-8">
        {planStatus === "trial" && !isExpired && trialDaysLeft !== null && trialDaysLeft <= 7 && (
          <div className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium",
            trialDaysLeft <= 3
              ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400"
              : "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400"
          )}>
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span>{trialDaysLeft === 0 ? "Your trial expires today! Upgrade now to continue without interruption." : `Your trial expires in ${trialDaysLeft} day${trialDaysLeft > 1 ? "s" : ""}. Upgrade now to avoid service disruption.`}</span>
          </div>
        )}
        {isExpired && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400 text-sm font-medium">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            Your trial has expired. Please upgrade to continue using Khana Lagao.
          </div>
        )}

        {methods?.latestManual && methods.latestManual.status === "pending" && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-200 text-sm">
            <Clock className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Manual payment under review</p>
              <p className="text-xs opacity-80">You submitted a {methods.latestManual.method.toUpperCase()} payment of {methods.latestManual.currency} {Number(methods.latestManual.amount).toLocaleString()} on {new Date(methods.latestManual.submittedAt).toLocaleString()}. We'll activate your plan after verification.</p>
              {methods.latestManual.proofUrl && <a href={resolveImageUrl(methods.latestManual.proofUrl) || methods.latestManual.proofUrl} target="_blank" rel="noreferrer" className="text-xs underline mt-1 inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" />View proof</a>}
            </div>
          </div>
        )}

        {methods?.latestManual && methods.latestManual.status === "rejected" && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300 text-sm">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">Last manual payment was rejected</p>
              <p className="text-xs opacity-90">Your {methods.latestManual.method.toUpperCase()} payment of {methods.latestManual.currency} {Number(methods.latestManual.amount).toLocaleString()} submitted on {new Date(methods.latestManual.submittedAt).toLocaleString()} was not accepted.</p>
              {methods.latestManual.reviewerNote && <p className="text-xs mt-1"><span className="font-medium">Reason:</span> {methods.latestManual.reviewerNote}</p>}
              <Button
                size="sm" variant="outline" className="mt-2 h-7 text-xs"
                onClick={() => {
                  const rejectedMethod = methods.latestManual!.method as PayMethod;
                  const targetPlan = (plans as (SubscriptionPlan & { currency?: string })[]).find(p => p.id === methods.latestManual!.planId);
                  if (targetPlan) { setInitialMethod(rejectedMethod); setActivePlan(targetPlan); }
                }}
              >
                Resubmit payment
              </Button>
            </div>
          </div>
        )}

        {methods?.latestManual && methods.latestManual.status === "approved" && currentPlan?.id !== methods.latestManual.planId && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800 dark:text-green-300 text-sm">
            <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Manual payment approved</p>
              <p className="text-xs opacity-80">Your last {methods.latestManual.method.toUpperCase()} payment was approved on {methods.latestManual.reviewedAt ? new Date(methods.latestManual.reviewedAt).toLocaleString() : "—"}.</p>
            </div>
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl p-6 flex flex-wrap items-start gap-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center"><Crown className="w-6 h-6 text-primary" /></div>
            <div>
              <p className="text-sm text-muted-foreground">Current plan</p>
              <p className="text-lg font-bold text-foreground capitalize">{currentPlan ? currentPlan.name : "Free Trial"}</p>
            </div>
          </div>
          <div className="flex gap-6 flex-wrap">
            {[
              { label: "Status", value: planStatus === "trial" ? "Trial" : planStatus === "active" ? "Active" : planStatus === "cancelled" ? "Cancelled" : planStatus },
              { label: "Trial ends", value: tenant?.trialEndsAt ? new Date(tenant.trialEndsAt).toLocaleDateString() : "—" },
              { label: "Renews", value: tenant?.subscriptionEndsAt ? new Date(tenant.subscriptionEndsAt).toLocaleDateString() : "—" },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-semibold text-foreground">{value}</p>
              </div>
            ))}
          </div>
          {planStatus === "active" && isOwner && (
            <Button
              variant="outline" size="sm" className="ml-auto"
              onClick={async () => {
                const origin = window.location.origin;
                const base = import.meta.env.BASE_URL ?? "/";
                try {
                  const res = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/restaurants/${RESTAURANT_ID}/subscription/portal`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("tt_access_token") ?? ""}` },
                    body: JSON.stringify({ returnUrl: `${origin}${base}settings/subscription` }),
                  });
                  const data = await res.json() as { url?: string };
                  if (data.url) window.location.href = data.url;
                  else toast({ title: "Stripe portal not configured", variant: "destructive" });
                } catch {
                  toast({ title: "Failed to open billing portal", variant: "destructive" });
                }
              }}
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />Manage Billing
            </Button>
          )}
        </div>

        {usage && currentPlan && (
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> Usage</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <UsageMeter label="Staff Members" used={usage.staffCount} max={currentPlan.maxStaff} icon={Users} />
              <UsageMeter label="Tables" used={usage.tableCount} max={currentPlan.maxTables} icon={Table2} />
              <UsageMeter label="Menu Items" used={usage.menuItemCount} max={currentPlan.maxMenuItems} icon={UtensilsCrossed} />
            </div>
          </div>
        )}

        {isOwner && (
          <div>
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Building className="w-4 h-4 text-primary" /> Choose a Plan</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {(plans as (SubscriptionPlan & { currency?: string })[]).map(plan => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  isCurrent={currentPlan?.id === plan.id && planStatus === "active"}
                  onChoose={() => { setInitialMethod(undefined); setActivePlan(plan); }}
                  isLoading={false}
                />
              ))}
            </div>
          </div>
        )}

        {!isOwner && (
          <div className="bg-accent/30 border border-border rounded-xl p-6 text-center text-muted-foreground text-sm">
            Contact your account owner to manage subscription and billing.
          </div>
        )}
      </div>

      {activePlan && methods && (
        <CheckoutModal
          plan={activePlan}
          initialMethod={initialMethod}
          methods={methods}
          onClose={() => setActivePlan(null)}
          onPaid={() => { setActivePlan(null); refetch(); }}
        />
      )}
    </Layout>
  );
}
