import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";

type Plan = {
  id: number;
  name: string;
  maxStaff: number;
  maxBranches: number;
  maxTables: number;
  maxMenuItems: number;
};

type SubscriptionResponse = {
  plan: Plan | null;
  usage: { staffCount: number; tableCount: number; menuItemCount: number };
};

export type LimitInfo = {
  reached: boolean;
  reason: string | null;
  limit: number;
  used: number;
  planName: string;
};

const NO_LIMIT: LimitInfo = { reached: false, reason: null, limit: 0, used: 0, planName: "" };

/**
 * Fetches the tenant's current plan + usage from the same `/subscription`
 * endpoint the web dashboard uses, and returns gating helpers for each
 * limited resource. A `limit` of 0 means unlimited.
 */
export function usePlanLimits() {
  const { restaurantId, user } = useAuth();
  const isSuperAdmin = !!user?.isSuperAdmin;

  const q = useQuery({
    queryKey: ["subscription", restaurantId],
    queryFn: () => customFetch<SubscriptionResponse>(`/api/restaurants/${restaurantId}/subscription`)
      .catch(() => ({ plan: null, usage: { staffCount: 0, tableCount: 0, menuItemCount: 0 } })),
    enabled: restaurantId != null,
    staleTime: 60_000,
  });

  const plan = q.data?.plan ?? null;
  const usage = q.data?.usage ?? { staffCount: 0, tableCount: 0, menuItemCount: 0 };

  const checkLimit = (max: number, used: number, label: string): LimitInfo => {
    if (isSuperAdmin) return NO_LIMIT;
    if (!plan || max <= 0) return { ...NO_LIMIT, planName: plan?.name ?? "" };
    const reached = used >= max;
    return {
      reached,
      reason: reached
        ? `Your ${plan.name} plan allows ${max} ${label}. Upgrade to add more.`
        : null,
      limit: max,
      used,
      planName: plan.name,
    };
  };

  return {
    isLoading: q.isLoading,
    plan,
    staff: (currentUsed?: number) => checkLimit(plan?.maxStaff ?? 0, currentUsed ?? usage.staffCount, "staff"),
    branches: (currentUsed: number) => checkLimit(plan?.maxBranches ?? 0, currentUsed, "outlet(s)"),
    tables: (currentUsed?: number) => checkLimit(plan?.maxTables ?? 0, currentUsed ?? usage.tableCount, "table(s)"),
    menuItems: (currentUsed?: number) => checkLimit(plan?.maxMenuItems ?? 0, currentUsed ?? usage.menuItemCount, "menu item(s)"),
  };
}
