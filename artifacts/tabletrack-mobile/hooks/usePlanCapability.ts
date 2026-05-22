import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { PLAN_BOOLEAN_FEATURES, isFeatureEnabled } from "@workspace/db/planFeatures";
import { useAuth } from "@/context/AuthContext";

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
  /** True once the subscription query has succeeded. False while loading or on error. */
  isResolved: boolean;
}

/**
 * Mobile-side port of the web `usePlanCapability` hook.
 *
 * Resolves whether the current tenant's plan has a particular boolean
 * feature turned on. Super admins always pass. Used by the More screen
 * (to lock-mark unavailable modules) and by `<PlanGate>` (to gate full
 * screens).
 */
export function usePlanCapability(featureKey: string): PlanCapabilityResult {
  const { user, restaurantId } = useAuth();
  const canQuery = !!restaurantId && !!user;

  const q = useQuery<SubscriptionPayload>({
    queryKey: ["subscription-features", restaurantId],
    queryFn: () => customFetch<SubscriptionPayload>(`/api/restaurants/${restaurantId}/subscription`),
    enabled: canQuery,
    staleTime: 60_000,
  });

  const def = PLAN_BOOLEAN_FEATURES.find((f) => f.key === featureKey);
  const label = def?.label ?? featureKey;

  if (user?.isSuperAdmin) {
    return {
      isLoading: false,
      enabled: true,
      planName: q.data?.plan?.name ?? null,
      featureKey,
      featureLabel: label,
      isResolved: true,
    };
  }
  if (!canQuery) {
    return { isLoading: false, enabled: false, planName: null, featureKey, featureLabel: label, isResolved: false };
  }
  return {
    isLoading: q.isLoading,
    enabled: isFeatureEnabled(q.data?.plan?.featureFlags ?? null, featureKey),
    planName: q.data?.plan?.name ?? null,
    featureKey,
    featureLabel: label,
    isResolved: q.isSuccess && !!q.data,
  };
}
