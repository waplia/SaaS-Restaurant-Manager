import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useSubscription, useCreateCheckout, useMockActivate } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Check, Crown, Zap, Building, Users, Table2, UtensilsCrossed,
  AlertTriangle, ExternalLink, RefreshCw,
} from "lucide-react";
import type { SubscriptionPlan } from "@/lib/types";

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
  plan, isCurrent, onUpgrade, isLoading,
}: { plan: SubscriptionPlan; isCurrent: boolean; onUpgrade: (planId: number) => void; isLoading: boolean }) {
  const price = Number(plan.price);
  const isPopular = plan.slug === "professional" || plan.slug === "pro";

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
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">
          Most Popular
        </div>
      )}
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
          <Check className="w-3 h-3" /> Current Plan
        </div>
      )}

      <div>
        <p className="font-bold text-lg text-foreground capitalize">{plan.name}</p>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="text-3xl font-bold text-foreground">₹{price.toLocaleString()}</span>
          <span className="text-sm text-muted-foreground">/{plan.billingPeriod === "yearly" ? "yr" : "mo"}</span>
        </div>
      </div>

      <ul className="space-y-2 flex-1">
        {[
          `${plan.maxRestaurants} restaurant${plan.maxRestaurants > 1 ? "s" : ""}`,
          `${plan.maxBranches} branch${plan.maxBranches > 1 ? "es" : ""}`,
          `Up to ${plan.maxStaff} staff`,
          `${plan.maxTables} tables`,
          `${plan.maxMenuItems} menu items`,
          ...(plan.features ?? []),
        ].map(f => (
          <li key={f} className="flex items-center gap-2 text-sm text-foreground">
            <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      <Button
        onClick={() => onUpgrade(plan.id)}
        disabled={isCurrent || isLoading}
        variant={isCurrent ? "outline" : "default"}
        className="w-full"
      >
        {isCurrent ? "Current Plan" : isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Upgrade"}
      </Button>
    </div>
  );
}

export default function SubscriptionPage() {
  const { data, isLoading, refetch } = useSubscription(RESTAURANT_ID);
  const createCheckout = useCreateCheckout();
  const mockActivate = useMockActivate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [checkoutLoading, setCheckoutLoading] = useState<number | null>(null);

  const { tenant, plan: currentPlan, plans = [], usage } = data ?? {};

  const isOwner = user?.role === "owner" || user?.isSuperAdmin;

  const handleUpgrade = async (planId: number) => {
    setCheckoutLoading(planId);
    try {
      const origin = window.location.origin;
      const base = import.meta.env.BASE_URL ?? "/";
      const successUrl = `${origin}${base}settings/subscription`;
      const cancelUrl = `${origin}${base}settings/subscription`;

      const result = await createCheckout.mutateAsync({ restaurantId: RESTAURANT_ID, planId, successUrl, cancelUrl });
      if (result.url) {
        window.location.href = result.url;
      } else if (result.mock) {
        await mockActivate.mutateAsync({ restaurantId: RESTAURANT_ID, planId });
        await refetch();
        toast({ title: "Plan activated (demo)", description: "Stripe not configured — plan upgraded in demo mode." });
      }
    } catch {
      toast({ title: "Failed to create checkout", variant: "destructive" });
    } finally {
      setCheckoutLoading(null);
    }
  };

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
      <PageHeader title="Subscription & Billing" subtitle="Manage your TableTrack plan" />

      <div className="p-6 max-w-5xl space-y-8">

        {/* Trial expiry warnings */}
        {planStatus === "trial" && !isExpired && trialDaysLeft !== null && trialDaysLeft <= 7 && (
          <div className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium",
            trialDaysLeft <= 3
              ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400"
              : "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400"
          )}>
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span>
              {trialDaysLeft === 0
                ? "Your trial expires today! Upgrade now to continue without interruption."
                : `Your trial expires in ${trialDaysLeft} day${trialDaysLeft > 1 ? "s" : ""}. Upgrade now to avoid service disruption.`}
            </span>
          </div>
        )}

        {isExpired && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400 text-sm font-medium">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            Your trial has expired. Please upgrade to continue using TableTrack.
          </div>
        )}

        {/* Current plan status card */}
        <div className="bg-card border border-border rounded-2xl p-6 flex flex-wrap items-start gap-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Crown className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Current plan</p>
              <p className="text-lg font-bold text-foreground capitalize">
                {currentPlan ? currentPlan.name : "Free Trial"}
              </p>
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
              variant="outline"
              size="sm"
              className="ml-auto"
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

        {/* Usage meters */}
        {usage && currentPlan && (
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" /> Usage
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <UsageMeter label="Staff Members" used={usage.staffCount} max={currentPlan.maxStaff} icon={Users} />
              <UsageMeter label="Tables" used={usage.tableCount} max={currentPlan.maxTables} icon={Table2} />
              <UsageMeter label="Menu Items" used={usage.menuItemCount} max={currentPlan.maxMenuItems} icon={UtensilsCrossed} />
            </div>
          </div>
        )}

        {/* Plan comparison */}
        {isOwner && (
          <div>
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Building className="w-4 h-4 text-primary" /> Choose a Plan
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {(plans as SubscriptionPlan[]).map(plan => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  isCurrent={currentPlan?.id === plan.id && planStatus === "active"}
                  onUpgrade={handleUpgrade}
                  isLoading={checkoutLoading === plan.id}
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
    </Layout>
  );
}
