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

export type BillingView = "monthly" | "yearly";

/** Default frontend-only yearly discount applied to monthly × 12 when no real
 * yearly variant exists. Kept here so both surfaces stay consistent. */
export const YEARLY_DISCOUNT_PCT = 16;

export function currencySymbol(c: string): string {
  return c === "USD" ? "$" : "₹";
}

function formatAmount(n: number, currency: string): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "Free";
  return `${currencySymbol(currency)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function formatPlanPrice(plan: Pick<PublicPlan, "price" | "currency">): string {
  return formatAmount(Number(plan.price), plan.currency);
}

/** A plan as it should be shown for the currently active billing view. The
 * underlying `plan` is the source row from the API; `displayPrice` and
 * `displayPeriod` already account for any derived monthly→yearly conversion. */
export interface DisplayPlan {
  plan: PublicPlan;
  /** "monthly" | "yearly" — the period this card is showing. */
  period: BillingView;
  /** Formatted price string ready for the UI (e.g. "₹499", "Free"). */
  displayPrice: string;
  /** True when this price was derived on the frontend rather than coming
   * straight from an admin-configured yearly/monthly variant. */
  isDerived: boolean;
}

export interface UsePublicPlansResult {
  plans: PublicPlan[];
  monthlyPlans: PublicPlan[];
  yearlyPlans: PublicPlan[];
  hasMonthly: boolean;
  hasYearly: boolean;
  /** True when at least one card on the toggle's opposite side is derived
   * (frontend-computed). UI can use this to show a "save 16%" hint. */
  hasDerivedYearly: boolean;
  hasDerivedMonthly: boolean;
  /** Return one display card per logical plan for the chosen view, deriving
   * the missing side from the available side so the toggle is never dead. */
  getDisplayPlans: (view: BillingView) => DisplayPlan[];
  isLoading: boolean;
  error: unknown;
}

function deriveYearly(monthly: PublicPlan): DisplayPlan {
  const monthlyN = Number(monthly.price);
  if (!Number.isFinite(monthlyN) || monthlyN <= 0) {
    return {
      plan: monthly,
      period: "yearly",
      displayPrice: formatAmount(monthlyN || 0, monthly.currency),
      isDerived: true,
    };
  }
  const yearly = Math.round(monthlyN * 12 * (1 - YEARLY_DISCOUNT_PCT / 100));
  return {
    plan: monthly,
    period: "yearly",
    displayPrice: formatAmount(yearly, monthly.currency),
    isDerived: true,
  };
}

function deriveMonthly(yearly: PublicPlan): DisplayPlan {
  const yearlyN = Number(yearly.price);
  if (!Number.isFinite(yearlyN) || yearlyN <= 0) {
    return {
      plan: yearly,
      period: "monthly",
      displayPrice: formatAmount(yearlyN || 0, yearly.currency),
      isDerived: true,
    };
  }
  // Reverse of the yearly discount, then divide by 12 — best-effort recovery.
  const monthly = Math.round(yearlyN / 12 / (1 - YEARLY_DISCOUNT_PCT / 100));
  return {
    plan: yearly,
    period: "monthly",
    displayPrice: formatAmount(monthly, yearly.currency),
    isDerived: true,
  };
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

  const plans = (data ?? [])
    .filter((p) => p.isActive !== false)
    .slice()
    .sort((a, b) => Number(a.price) - Number(b.price));
  const monthlyPlans = plans.filter((p) => p.billingPeriod === "monthly");
  const yearlyPlans = plans.filter((p) => p.billingPeriod === "yearly");

  const hasMonthly = monthlyPlans.length > 0;
  const hasYearly = yearlyPlans.length > 0;

  // True if ANY plan needs derivation on a given side (no real variant for
  // that slug on the opposite side). Covers fully-missing and mixed catalogs.
  const monthlySlugs = new Set(monthlyPlans.map((p) => p.slug));
  const yearlySlugs = new Set(yearlyPlans.map((p) => p.slug));
  const hasDerivedYearly = monthlyPlans.some((p) => !yearlySlugs.has(p.slug));
  const hasDerivedMonthly = yearlyPlans.some((p) => !monthlySlugs.has(p.slug));

  const getDisplayPlans = (view: BillingView): DisplayPlan[] => {
    if (view === "yearly") {
      if (hasYearly) {
        const out: DisplayPlan[] = yearlyPlans.map((p) => ({
          plan: p,
          period: "yearly",
          displayPrice: formatPlanPrice(p),
          isDerived: false,
        }));
        for (const m of monthlyPlans) {
          if (!yearlySlugs.has(m.slug)) out.push(deriveYearly(m));
        }
        return out.sort((a, b) => Number(a.plan.price) - Number(b.plan.price));
      }
      return monthlyPlans.map(deriveYearly);
    }
    if (hasMonthly) {
      const out: DisplayPlan[] = monthlyPlans.map((p) => ({
        plan: p,
        period: "monthly",
        displayPrice: formatPlanPrice(p),
        isDerived: false,
      }));
      for (const y of yearlyPlans) {
        if (!monthlySlugs.has(y.slug)) out.push(deriveMonthly(y));
      }
      return out.sort((a, b) => Number(a.plan.price) - Number(b.plan.price));
    }
    return yearlyPlans.map(deriveMonthly);
  };

  return {
    plans,
    monthlyPlans,
    yearlyPlans,
    hasMonthly,
    hasYearly,
    hasDerivedYearly,
    hasDerivedMonthly,
    getDisplayPlans,
    isLoading,
    error,
  };
}
