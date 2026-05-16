import { useQuery } from "@tanstack/react-query";

export interface PublicPlan {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  price: string;
  currency: "INR" | "USD";
  billingPeriod: "monthly" | "yearly";
  trialDays: number;
  maxRestaurants: number;
  maxBranches: number;
  maxStaff: number;
  maxTables: number;
  maxMenuItems: number;
  features: string[] | null;
  featureFlags: Record<string, boolean> | null;
  isActive: boolean;
}

export function currencySymbol(c: string): string {
  return c === "USD" ? "$" : "₹";
}

export function formatPlanPrice(plan: Pick<PublicPlan, "price" | "currency">): string {
  const n = Number(plan.price);
  if (!Number.isFinite(n)) return plan.price;
  if (n === 0) return "Free";
  return `${currencySymbol(plan.currency)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export interface UsePublicPlansResult {
  plans: PublicPlan[];
  monthlyPlans: PublicPlan[];
  yearlyPlans: PublicPlan[];
  hasMonthly: boolean;
  hasYearly: boolean;
  isLoading: boolean;
  error: unknown;
}

export function usePublicPlans(): UsePublicPlansResult {
  const { data, isLoading, error } = useQuery<PublicPlan[]>({
    queryKey: ["public-plans"],
    queryFn: async () => {
      const res = await fetch("/api/marketing/plans");
      if (!res.ok) throw new Error("Failed to fetch plans");
      return res.json();
    },
    staleTime: 60_000,
  });

  const plans = (data ?? []).slice().sort((a, b) => Number(a.price) - Number(b.price));
  const monthlyPlans = plans.filter((p) => p.billingPeriod === "monthly");
  const yearlyPlans = plans.filter((p) => p.billingPeriod === "yearly");

  return {
    plans,
    monthlyPlans,
    yearlyPlans,
    hasMonthly: monthlyPlans.length > 0,
    hasYearly: yearlyPlans.length > 0,
    isLoading,
    error,
  };
}
