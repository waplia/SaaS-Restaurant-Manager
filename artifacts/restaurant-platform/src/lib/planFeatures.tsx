import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Lock, ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { isFeatureEnabled, PLAN_BOOLEAN_FEATURES } from "@workspace/db/planFeatures";

interface SubscriptionPayload {
  tenant?: { id: number; planStatus: string } | null;
  plan?: { id: number; name: string; featureFlags: Record<string, boolean> | null } | null;
}

export interface PlanCapabilityResult {
  isLoading: boolean;
  enabled: boolean;
  planName: string | null;
  featureKey: string;
  featureLabel: string;
  /**
   * True only when the subscription query has actually returned data
   * (success path). False while loading and also when the query errored
   * out — important for the offline-pos engine, which must not turn
   * queueing off just because /subscription couldn't be reached.
   */
  isResolved: boolean;
}

/**
 * Resolve whether the current tenant's plan has a particular boolean feature
 * turned on. Super admins always pass. Used by sidebar (to show locked) and
 * by <PlanProtectedRoute> (to gate full pages).
 */
export function usePlanCapability(featureKey: string): PlanCapabilityResult {
  const { user } = useAuth();
  const restaurantId = user?.restaurantId;
  // Any authenticated user belonging to the tenant should be able to evaluate
  // the plan — staff (kitchen, waiter, cashier, auditor, etc.) need to access
  // role-allowed gated pages when the tenant's plan includes the feature.
  const canQuery = !!restaurantId && !!user;

  const { data, isLoading, isSuccess } = useQuery<SubscriptionPayload>({
    queryKey: ["subscription-features", restaurantId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/subscription`),
    enabled: canQuery,
    staleTime: 60_000,
  });

  const def = PLAN_BOOLEAN_FEATURES.find((f) => f.key === featureKey);
  const label = def?.label ?? featureKey;

  if (user?.isSuperAdmin) {
    return { isLoading: false, enabled: true, planName: data?.plan?.name ?? null, featureKey, featureLabel: label, isResolved: true };
  }
  if (!canQuery) {
    return { isLoading: false, enabled: false, planName: null, featureKey, featureLabel: label, isResolved: false };
  }
  return {
    isLoading,
    enabled: isFeatureEnabled(data?.plan?.featureFlags ?? null, featureKey),
    planName: data?.plan?.name ?? null,
    featureKey,
    featureLabel: label,
    // Only treat the capability as resolved when /subscription actually
    // succeeded. While loading OR when the request failed (typical
    // offline path), keep `isResolved=false` so consumers like the
    // offline-pos engine don't clobber the persisted bootstrap value.
    isResolved: isSuccess && !!data,
  };
}

/**
 * Wraps a route component so it only renders when the tenant's plan has
 * the given boolean feature turned on. Otherwise renders a friendly
 * "Locked" card linking to /pricing?feature=KEY.
 */
export function PlanProtectedRoute({
  component: Component,
  feature,
}: {
  component: React.ComponentType;
  feature: string;
}) {
  const cap = usePlanCapability(feature);
  if (cap.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }
  if (cap.enabled) return <Component />;
  return <FeatureLockedCard featureKey={feature} featureLabel={cap.featureLabel} planName={cap.planName} />;
}

function FeatureLockedCard({ featureKey, featureLabel, planName }: { featureKey: string; featureLabel: string; planName: string | null }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 text-center shadow-sm">
        <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Lock className="w-6 h-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">{featureLabel}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {planName
            ? `${featureLabel} is not included on your ${planName} plan.`
            : `${featureLabel} requires a paid plan.`}{" "}
          Upgrade to unlock this feature for your team.
        </p>
        <Link href={`/pricing?feature=${encodeURIComponent(featureKey)}`}>
          <Button className="gap-2">
            See plans <ArrowRight className="w-4 h-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
