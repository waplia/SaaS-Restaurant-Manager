import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { resolveImageUrl } from "@/components/ImageUploadField";
import { CheckoutDrawer, loadRazorpay, type PayMethod } from "@/components/billing/CheckoutDrawer";
import {
  useSubscription,
  useConfirmCashfreeOrder,
  usePaymentMethods,
} from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Check, Crown, Zap, Building, Users, Table2, UtensilsCrossed,
  AlertTriangle, ExternalLink, RefreshCw, Minus,
  Clock, Wallet, Sparkles, Loader2,
} from "lucide-react";
import { useAppSettings } from "@/lib/appSettings";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, apiAction } from "@/lib/api";
import type { SubscriptionPlan } from "@/lib/types";
import {
  PLAN_BOOLEAN_FEATURES, PLAN_QUANTITY_FEATURES,
  isFeatureEnabled, formatQuantity,
} from "@workspace/db/planFeatures";

const RESTAURANT_ID = 1;

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


interface AiWalletSummary {
  walletId: number | null;
  balance: number; monthlyBalance: number; purchasedBalance: number; bonusBalance: number;
  reservedCredits: number; lifetimeCreditsUsed: number;
  isBlocked: boolean; planAiEnabled: boolean; planMonthlyIncluded: number;
}
interface PublicRechargePackage {
  id: number; slug: string; name: string; description: string | null;
  credits: number; bonusCredits: number; price: string; currency: string;
  validityDays: number | null; isFeatured: boolean;
}

type CashfreeSdk = { checkout: (opts: { paymentSessionId: string; returnUrl?: string; redirectTarget?: "_self" | "_blank" | "_modal" }) => void };
type CashfreeFactory = (opts: { mode: "sandbox" | "production" }) => CashfreeSdk;
async function loadCashfreeSdk(mode: "sandbox" | "production" = "sandbox"): Promise<CashfreeSdk> {
  const getFactory = (): CashfreeFactory | undefined =>
    (window as unknown as { Cashfree?: CashfreeFactory }).Cashfree;
  let factory = getFactory();
  if (!factory) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load Cashfree SDK"));
      document.head.appendChild(s);
    });
    factory = getFactory();
  }
  if (!factory) throw new Error("Cashfree SDK unavailable");
  return factory({ mode });
}

const PENDING_AI_RECHARGE_KEY = "khana.pendingAiRecharge";

function KhanaAiWalletSection({ isOwner }: { isOwner: boolean }) {
  const { toast } = useToast();
  const { data: wallet, refetch: refetchWallet } = useQuery<AiWalletSummary>({
    queryKey: ["ai-wallet"], queryFn: () => apiFetch("/ai/wallet"),
  });
  const { data: packages = [] } = useQuery<PublicRechargePackage[]>({
    queryKey: ["ai-recharge-packages"], queryFn: () => apiFetch("/ai/recharge-packages"),
  });
  const [busyId, setBusyId] = useState<number | null>(null);

  // After Cashfree returns to this page, finalize any pending AI recharge.
  useEffect(() => {
    const raw = window.localStorage.getItem(PENDING_AI_RECHARGE_KEY);
    if (!raw) return;
    let pending: { rechargeId: number; orderId: string } | null = null;
    try { pending = JSON.parse(raw); } catch { /* ignore */ }
    window.localStorage.removeItem(PENDING_AI_RECHARGE_KEY);
    if (!pending?.rechargeId || !pending?.orderId) return;
    apiAction("/ai/recharge/cashfree-confirm", "POST", { rechargeId: pending.rechargeId, orderId: pending.orderId })
      .then(() => { toast({ title: "Credits added", description: "Your Cashfree payment was confirmed." }); void refetchWallet(); })
      .catch((err: Error) => toast({ title: "Could not confirm AI recharge", description: err.message, variant: "destructive" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buyCashfree = async (pkg: PublicRechargePackage) => {
    if (!isOwner) return;
    setBusyId(pkg.id);
    try {
      const origin = window.location.origin;
      const base = import.meta.env.BASE_URL ?? "/";
      const returnUrl = `${origin}${base}settings/subscription`;
      const order = await apiAction("/ai/recharge/create-cashfree-order", "POST", { packageId: pkg.id, returnUrl }) as
        | { mock: true; activated: true }
        | { mock?: false; rechargeId: number; orderId: string; paymentSessionId: string; mode?: "sandbox" | "production" };
      if ("mock" in order && order.mock) {
        toast({ title: "Credits added", description: `${pkg.credits + pkg.bonusCredits} credits added (mock).` });
        await refetchWallet();
        setBusyId(null);
        return;
      }
      const real = order as { rechargeId: number; orderId: string; paymentSessionId: string; mode?: "sandbox" | "production" };
      window.localStorage.setItem(PENDING_AI_RECHARGE_KEY, JSON.stringify({ rechargeId: real.rechargeId, orderId: real.orderId }));
      const cashfree = await loadCashfreeSdk(real.mode ?? "sandbox");
      cashfree.checkout({ paymentSessionId: real.paymentSessionId, returnUrl, redirectTarget: "_self" });
    } catch (err) {
      window.localStorage.removeItem(PENDING_AI_RECHARGE_KEY);
      toast({ title: "Recharge failed", description: (err as Error).message, variant: "destructive" });
      setBusyId(null);
    }
  };

  const buy = async (pkg: PublicRechargePackage) => {
    if (!isOwner) return;
    setBusyId(pkg.id);
    try {
      const order = await apiAction("/ai/recharge/create-razorpay-order", "POST", { packageId: pkg.id }) as
        { mock: true; activated: true } | { mock?: false; key: string; orderId: string; amount: number; currency: string; rechargeId: number };
      if ("mock" in order && order.mock) {
        toast({ title: "Credits added", description: `${pkg.credits + pkg.bonusCredits} credits added (mock).` });
        await refetchWallet();
        return;
      }
      const Razorpay = await loadRazorpay();
      const realOrder = order as { key: string; orderId: string; amount: number; currency: string; rechargeId: number };
      const rzp = new Razorpay({
        key: realOrder.key, amount: realOrder.amount, currency: realOrder.currency,
        name: "Khana AI credits", description: pkg.name, order_id: realOrder.orderId,
        handler: (resp) => {
          void apiAction("/ai/recharge/razorpay-confirm", "POST", {
            rechargeId: realOrder.rechargeId,
            orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature,
          })
            .then(() => { toast({ title: "Credits added", description: `${pkg.credits + pkg.bonusCredits} credits added.` }); void refetchWallet(); })
            .catch((err: Error) => toast({ title: "Confirmation failed", description: err.message, variant: "destructive" }))
            .finally(() => setBusyId(null));
        },
        modal: { ondismiss: () => setBusyId(null) },
        theme: { color: "#16a34a" },
      });
      rzp.open();
    } catch (err) {
      toast({ title: "Recharge failed", description: (err as Error).message, variant: "destructive" });
      setBusyId(null);
    }
  };

  if (!wallet) return null;
  if (!wallet.planAiEnabled && wallet.balance === 0 && packages.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Khana AI credits</h3>
        {wallet.isBlocked && <span className="text-xs font-medium px-2 py-1 rounded-full bg-destructive/10 text-destructive">Wallet blocked</span>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-muted/30 rounded-xl p-3"><p className="text-[11px] text-muted-foreground">Available</p><p className="text-2xl font-bold text-primary tabular-nums">{wallet.balance.toLocaleString()}</p></div>
        <div className="bg-muted/30 rounded-xl p-3"><p className="text-[11px] text-muted-foreground">Monthly included</p><p className="text-2xl font-bold tabular-nums">{wallet.monthlyBalance.toLocaleString()}</p></div>
        <div className="bg-muted/30 rounded-xl p-3"><p className="text-[11px] text-muted-foreground">Purchased</p><p className="text-2xl font-bold text-green-600 tabular-nums">{wallet.purchasedBalance.toLocaleString()}</p></div>
        <div className="bg-muted/30 rounded-xl p-3"><p className="text-[11px] text-muted-foreground">Bonus</p><p className="text-2xl font-bold text-amber-600 tabular-nums">{wallet.bonusBalance.toLocaleString()}</p></div>
      </div>
      <p className="text-xs text-muted-foreground">Used so far: <span className="font-semibold text-foreground">{wallet.lifetimeCreditsUsed.toLocaleString()}</span> credits · Plan includes <span className="font-semibold text-foreground">{wallet.planMonthlyIncluded.toLocaleString()}</span>/month</p>
      {packages.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> Top up</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {packages.map(pkg => (
              <div key={pkg.id} className={cn("border rounded-xl p-4 space-y-2", pkg.isFeatured ? "border-primary bg-primary/5" : "border-border")}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{pkg.name}</p>
                    {pkg.description && <p className="text-xs text-muted-foreground">{pkg.description}</p>}
                  </div>
                  {pkg.isFeatured && <span className="text-[10px] uppercase font-bold text-primary">Best value</span>}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-bold tabular-nums">{pkg.credits.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">credits</span>
                  {pkg.bonusCredits > 0 && <span className="text-xs text-amber-600 font-medium ml-1">+{pkg.bonusCredits} bonus</span>}
                </div>
                <p className="text-sm font-medium">{pkg.currency} {pkg.price}{pkg.validityDays ? <span className="text-xs text-muted-foreground"> · {pkg.validityDays}d validity</span> : null}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" disabled={!isOwner || busyId === pkg.id || wallet.isBlocked} onClick={() => void buy(pkg)}>
                    {busyId === pkg.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Razorpay"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={!isOwner || busyId === pkg.id || wallet.isBlocked} onClick={() => void buyCashfree(pkg)}>
                    {busyId === pkg.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Cashfree"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {!isOwner && <p className="text-xs text-muted-foreground">Only owners can purchase AI credits.</p>}
          <ManualAiRechargePanel packages={packages} isOwner={isOwner} blocked={wallet.isBlocked} onSubmitted={() => void refetchWallet()} />
        </div>
      )}
    </div>
  );
}

interface ManualAiRecharge {
  id: number; packageId: number; amount: string; currency: string;
  status: string; failureReason: string | null; notes: string | null; createdAt: string;
}
function ManualAiRechargePanel({ packages, isOwner, blocked, onSubmitted }: {
  packages: PublicRechargePackage[]; isOwner: boolean; blocked: boolean; onSubmitted: () => void;
}) {
  const { toast } = useToast();
  const { data: methods } = usePaymentMethods(RESTAURANT_ID);
  const { data: list, refetch: refetchList } = useQuery<{ data: ManualAiRecharge[] }>({
    queryKey: ["ai-manual-recharges"], queryFn: () => apiFetch("/ai/recharge/manual"),
  });
  const bankEnabled = !!methods?.manual?.bank?.enabled;
  const upiEnabled = !!methods?.manual?.upi?.enabled;
  const anyEnabled = bankEnabled || upiEnabled;
  const inrPackages = packages.filter(p => (p.currency ?? "INR").toUpperCase() === "INR");
  const [pkgId, setPkgId] = useState<number | "">(inrPackages[0]?.id ?? "");
  const [method, setMethod] = useState<"bank" | "upi">(bankEnabled ? "bank" : "upi");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!anyEnabled || inrPackages.length === 0) return null;
  const pendingCount = (list?.data ?? []).filter(r => r.status === "pending").length;
  const submit = async () => {
    if (!isOwner || !pkgId) return;
    setBusy(true);
    try {
      await apiAction("/ai/recharge/manual", "POST", { packageId: pkgId, method, reference, note });
      toast({ title: "Manual recharge submitted", description: "A super-admin will review and approve it shortly." });
      setReference(""); setNote("");
      await refetchList();
      onSubmitted();
    } catch (err) {
      toast({ title: "Submission failed", description: (err as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <div className="border border-border rounded-xl p-4 mt-4 space-y-3 bg-muted/20">
      <p className="text-sm font-semibold">Pay manually (bank transfer / UPI)</p>
      <p className="text-xs text-muted-foreground">
        Pay offline and submit your reference. A super-admin will verify and credit your wallet.
        {pendingCount > 0 && <span className="ml-1 text-amber-600 font-medium">{pendingCount} pending review.</span>}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select className="border border-border rounded-md px-2 py-1.5 text-sm bg-background" value={pkgId} onChange={e => setPkgId(e.target.value ? Number(e.target.value) : "")}>
          {inrPackages.map(p => <option key={p.id} value={p.id}>{p.name} — {p.currency} {p.price}</option>)}
        </select>
        <select className="border border-border rounded-md px-2 py-1.5 text-sm bg-background" value={method} onChange={e => setMethod(e.target.value as "bank" | "upi")}>
          {bankEnabled && <option value="bank">Bank transfer</option>}
          {upiEnabled && <option value="upi">UPI</option>}
        </select>
        <input className="border border-border rounded-md px-2 py-1.5 text-sm bg-background sm:col-span-2" placeholder="Payment reference / UTR / transaction id" value={reference} onChange={e => setReference(e.target.value)} />
        <textarea className="border border-border rounded-md px-2 py-1.5 text-sm bg-background sm:col-span-2 min-h-12" placeholder="Optional note for the reviewer" value={note} onChange={e => setNote(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={!isOwner || blocked || busy || !pkgId || pendingCount > 0} onClick={() => void submit()}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          {pendingCount > 0 ? "Awaiting review" : "Submit for review"}
        </Button>
      </div>
    </div>
  );
}

export default function SubscriptionPage() {
  const { data, isLoading, refetch } = useSubscription(RESTAURANT_ID);
  const { data: methods, isLoading: methodsLoading } = usePaymentMethods(RESTAURANT_ID);
  const confirmCashfreeOrder = useConfirmCashfreeOrder();
  const { user } = useAuth();
  const { toast } = useToast();
  const [activePlan, setActivePlan] = useState<(SubscriptionPlan & { currency?: string }) | null>(null);
  const [initialMethod, setInitialMethod] = useState<PayMethod | undefined>(undefined);
  const [initialBillingPeriod, setInitialBillingPeriod] = useState<"monthly" | "yearly" | undefined>(undefined);

  const { tenant, plan: currentPlan, plans = [], usage } = (data ?? {}) as {
    tenant?: { trialDaysLeft?: number | null; isTrialExpired?: boolean; planStatus?: string; trialEndsAt?: string | null; subscriptionEndsAt?: string | null };
    plan?: SubscriptionPlan & { currency?: string };
    plans?: (SubscriptionPlan & { currency?: string })[];
    usage?: { staffCount: number; tableCount: number; menuItemCount: number };
  };
  const isOwner = !!(user?.role === "owner" || user?.isSuperAdmin);

  // If the user arrived from /pricing with ?planId=&billing=, auto-open the
  // checkout drawer prefilled to that plan/period so they can complete
  // purchase without re-picking. Runs whenever plans load.
  useEffect(() => {
    if (!plans || plans.length === 0) return;
    const sp = new URLSearchParams(window.location.search);
    const planIdRaw = sp.get("planId");
    if (!planIdRaw) return;
    const planId = Number(planIdRaw);
    const target = (plans as (SubscriptionPlan & { currency?: string })[]).find(p => p.id === planId);
    if (!target) return;
    const billingParam = sp.get("billing");
    setInitialMethod(undefined);
    setInitialBillingPeriod(billingParam === "yearly" ? "yearly" : billingParam === "monthly" ? "monthly" : undefined);
    setActivePlan(target);
    sp.delete("planId");
    sp.delete("billing");
    const ns = sp.toString();
    window.history.replaceState({}, "", window.location.pathname + (ns ? `?${ns}` : ""));
  }, [plans]);

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
      <PageHeader title="Subscription & Billing" subtitle="Manage your KhanaLagao plan" />

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
            Your trial has expired. Please upgrade to continue using KhanaLagao.
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

        <KhanaAiWalletSection isOwner={isOwner} />

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

      {activePlan && (
        <CheckoutDrawer
          plan={activePlan}
          initialMethod={initialMethod}
          initialBillingPeriod={initialBillingPeriod}
          methods={methods}
          methodsLoading={methodsLoading}
          onClose={() => { setActivePlan(null); setInitialBillingPeriod(undefined); }}
          onPaid={() => { setActivePlan(null); setInitialBillingPeriod(undefined); refetch(); }}
        />
      )}
    </Layout>
  );
}
