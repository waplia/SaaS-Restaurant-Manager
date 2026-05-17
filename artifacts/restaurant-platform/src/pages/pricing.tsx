import { useMemo, useState } from "react";
import { useSearch, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Check, X, ArrowRight, Sparkles } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePaymentMethods } from "@/lib/hooks";
import { CheckoutDrawer } from "@/components/billing/CheckoutDrawer";
import { useQueryClient } from "@tanstack/react-query";
import type { SubscriptionPlan } from "@/lib/types";
import {
  PLAN_BOOLEAN_FEATURES, PLAN_QUANTITY_FEATURES,
  isFeatureEnabled, formatQuantity,
} from "@workspace/db/planFeatures";

const RESTAURANT_ID = 1;

type Plan = SubscriptionPlan & {
  yearlyPrice?: string | null;
  description?: string | null;
};

interface SubscriptionInfo {
  tenant?: { planStatus: string } | null;
  plan?: Plan | null;
  plans: Plan[];
}

function priceLabel(plan: Plan, view: "monthly" | "yearly"): { price: string; period: string } {
  const sym = (plan.currency ?? "INR").toUpperCase() === "USD" ? "$" : "₹";
  const monthly = Number(plan.price ?? 0);
  if (view === "yearly") {
    const yearly = plan.yearlyPrice ? Number(plan.yearlyPrice) : monthly * 12;
    return { price: `${sym}${yearly.toLocaleString("en-IN")}`, period: "/yr" };
  }
  return { price: `${sym}${monthly.toLocaleString("en-IN")}`, period: "/mo" };
}

export default function PricingPage() {
  const { user } = useAuth();
  const restaurantId = user?.restaurantId;
  const search = useSearch();
  const queryClient = useQueryClient();
  const highlightFeature = useMemo(() => new URLSearchParams(search).get("feature") ?? "", [search]);
  const [view, setView] = useState<"monthly" | "yearly">("monthly");
  const [activePlan, setActivePlan] = useState<Plan | null>(null);
  const { data: methods, isLoading: methodsLoading } = usePaymentMethods(RESTAURANT_ID);

  const { data, isLoading } = useQuery<SubscriptionInfo>({
    queryKey: ["subscription", restaurantId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/subscription`),
    enabled: !!restaurantId,
    staleTime: 30_000,
  });

  const plans = (data?.plans ?? []).slice().sort((a, b) => Number(a.price) - Number(b.price));
  const currentPlanId = data?.plan?.id ?? null;
  const highlightLabel = PLAN_BOOLEAN_FEATURES.find((f) => f.key === highlightFeature)?.label ?? null;

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div className="text-center max-w-2xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-3">Plans &amp; Pricing</h1>
          <p className="text-muted-foreground">
            Upgrade to unlock more features, higher limits, and priority support.
          </p>
          {highlightLabel && (
            <div className="mt-4 inline-flex items-center gap-2 bg-primary/10 text-primary border border-primary/20 rounded-full px-4 py-1.5 text-sm">
              <Sparkles className="w-3.5 h-3.5" />
              <span><strong>{highlightLabel}</strong> is available on plans below.</span>
            </div>
          )}
          <div className="mt-6 inline-flex items-center bg-muted rounded-full p-1">
            <button
              onClick={() => setView("monthly")}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${view === "monthly" ? "bg-card shadow text-foreground" : "text-muted-foreground"}`}
              data-testid="btn-billing-monthly"
            >Monthly</button>
            <button
              onClick={() => setView("yearly")}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${view === "yearly" ? "bg-card shadow text-foreground" : "text-muted-foreground"}`}
              data-testid="btn-billing-yearly"
            >Yearly</button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center text-muted-foreground py-20">Loading plans…</div>
        ) : plans.length === 0 ? (
          <div className="text-center text-muted-foreground py-20">No plans available. Contact support.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {plans.map((plan) => {
                const isCurrent = plan.id === currentPlanId;
                const labels = priceLabel(plan, view);
                const featureHighlighted = highlightFeature ? isFeatureEnabled(plan.featureFlags, highlightFeature) : false;
                return (
                  <div
                    key={plan.id}
                    className={`relative bg-card border rounded-2xl p-6 flex flex-col shadow-sm ${featureHighlighted || isCurrent ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
                    data-testid={`plan-card-${plan.slug}`}
                  >
                    {isCurrent && (
                      <Badge className="absolute -top-2 right-4">Current plan</Badge>
                    )}
                    {!isCurrent && featureHighlighted && (
                      <Badge className="absolute -top-2 right-4" variant="default">Includes {highlightLabel}</Badge>
                    )}
                    <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2 min-h-[2.5rem]">
                      {plan.description ?? `Includes a ${plan.trialDays}-day free trial.`}
                    </p>
                    <div className="flex items-baseline gap-1 mb-5">
                      <span className="text-3xl font-bold text-foreground">{labels.price}</span>
                      <span className="text-muted-foreground text-sm">{labels.period}</span>
                    </div>
                    {isCurrent ? (
                      <Button variant="outline" className="w-full mb-5" disabled>Your current plan</Button>
                    ) : (
                      <Button
                        className="w-full mb-5 gap-2"
                        onClick={() => setActivePlan(plan)}
                        data-testid={`btn-buy-${plan.slug}`}
                      >
                        Upgrade <ArrowRight className="w-4 h-4" />
                      </Button>
                    )}
                    <ul className="space-y-2 text-sm">
                      {PLAN_QUANTITY_FEATURES.map((q) => {
                        const label = formatQuantity(q, plan[q.key] ?? 0);
                        if (!label) return null;
                        return (
                          <li key={q.key} className="flex items-start gap-2 text-foreground/80">
                            <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                            <span>{label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>

            {/* Comparison table */}
            <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-4 font-semibold text-muted-foreground w-1/3">Capability</th>
                    {plans.map((p) => (
                      <th key={p.id} className={`p-4 font-semibold ${p.id === currentPlanId ? "text-primary bg-primary/5" : "text-foreground"}`}>{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PLAN_BOOLEAN_FEATURES.map((f) => {
                    const isHighlightRow = f.key === highlightFeature;
                    return (
                      <tr
                        key={f.key}
                        className={`border-b border-border/60 last:border-0 ${isHighlightRow ? "bg-primary/5" : ""}`}
                        data-testid={`row-feature-${f.key}`}
                      >
                        <td className="p-4 font-medium text-foreground">
                          {f.label}
                          {isHighlightRow && <Badge className="ml-2 text-[10px]">Selected</Badge>}
                        </td>
                        {plans.map((p) => {
                          const on = isFeatureEnabled(p.featureFlags, f.key);
                          return (
                            <td key={p.id} className={`p-4 text-center ${p.id === currentPlanId ? "bg-primary/5" : ""}`}>
                              {on
                                ? <Check className="h-4 w-4 text-primary inline" />
                                : <X className="h-4 w-4 text-muted-foreground/40 inline" />}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="text-center text-sm text-muted-foreground">
              Need help choosing? <Link href="/support" className="text-primary hover:underline">Talk to support</Link>.
            </div>
          </>
        )}
      </div>

      {activePlan && (
        <CheckoutDrawer
          plan={activePlan}
          methods={methods}
          methodsLoading={methodsLoading}
          initialBillingPeriod={view}
          onClose={() => setActivePlan(null)}
          onPaid={() => {
            setActivePlan(null);
            void queryClient.invalidateQueries({ queryKey: ["subscription", restaurantId] });
            void queryClient.invalidateQueries({ queryKey: ["billing", "methods", RESTAURANT_ID] });
          }}
        />
      )}
    </Layout>
  );
}
