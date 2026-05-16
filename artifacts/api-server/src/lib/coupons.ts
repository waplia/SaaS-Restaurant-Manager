import { eq, and, sql } from "drizzle-orm";
import { db, subscriptionCouponsTable, subscriptionCouponRedemptionsTable, type SubscriptionCoupon, type SubscriptionPlan } from "./db";

export const COUPON_DISCOUNT_TYPES = ["flat", "percent", "trial_extension", "first_month", "lifetime"] as const;
export type CouponDiscountType = (typeof COUPON_DISCOUNT_TYPES)[number];

export type CouponSnapshot = {
  id: number;
  code: string;
  discountType: CouponDiscountType;
  discountValue: string;
};

/** Reason a coupon could not be redeemed. Mapped to a human message in routes. */
export type CouponRejectReason =
  | "not_found"
  | "inactive"
  | "deleted"
  | "not_started"
  | "expired"
  | "exhausted"
  | "wrong_plan"
  | "wrong_restaurant"
  | "invalid_for_action";

export function describeRejectReason(r: CouponRejectReason): string {
  switch (r) {
    case "not_found": return "That coupon code doesn't exist.";
    case "inactive": return "This coupon is currently inactive.";
    case "deleted": return "This coupon has been removed.";
    case "not_started": return "This coupon is not yet active.";
    case "expired": return "This coupon has expired.";
    case "exhausted": return "This coupon has reached its maximum number of redemptions.";
    case "wrong_plan": return "This coupon does not apply to the selected plan.";
    case "wrong_restaurant": return "This coupon is not available for your account.";
    case "invalid_for_action": return "This coupon type cannot be used for this action.";
  }
}

export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Effective state once expiry / exhaustion is taken into account. */
export function effectiveStatus(c: Pick<SubscriptionCoupon, "status" | "validFrom" | "validUntil" | "maxUsage" | "usedCount" | "deletedAt">): "active" | "inactive" | "expired" | "exhausted" | "scheduled" | "deleted" {
  if (c.deletedAt) return "deleted";
  if (c.status !== "active") return "inactive";
  const now = new Date();
  if (c.validFrom && c.validFrom > now) return "scheduled";
  if (c.validUntil && c.validUntil < now) return "expired";
  if (c.maxUsage != null && c.usedCount >= c.maxUsage) return "exhausted";
  return "active";
}

export type ResolvedDiscount = {
  coupon: SubscriptionCoupon;
  /** Amount in plan currency that should be subtracted from this charge. */
  discountAmount: number;
  /** Effective amount the tenant should pay (>= 0). */
  effectiveAmount: number;
  /** Trial days to add (only for trial_extension type). */
  trialDaysToAdd: number;
  /** Whether this coupon should be persisted on the tenant for recurring use. */
  persistOnTenant: boolean;
  /** Whether this coupon applies only to the first billing cycle. */
  firstCycleOnly: boolean;
};

export type ValidateInput = {
  code: string;
  tenantId: number;
  plan?: Pick<SubscriptionPlan, "id" | "price"> | null;
  /** Action context — payment is the default. trial_extension restricts to trial-extension coupons. */
  action?: "payment" | "trial_extension";
  /** Whether this is the tenant's first billing cycle for this plan (used by first_month). */
  isFirstCycle?: boolean;
};

export type ValidateResult =
  | { ok: true; resolved: ResolvedDiscount }
  | { ok: false; reason: CouponRejectReason; message: string };

/**
 * Look up a coupon by code, enforce all eligibility rules, and compute the
 * resolved discount for the given plan/tenant. Pure validation — does NOT
 * mutate the coupon row or write a redemption.
 */
export async function validateCoupon(input: ValidateInput): Promise<ValidateResult> {
  const code = normaliseCode(input.code);
  if (!code) return { ok: false, reason: "not_found", message: describeRejectReason("not_found") };

  const [coupon] = await db.select().from(subscriptionCouponsTable).where(eq(subscriptionCouponsTable.code, code));
  if (!coupon) return { ok: false, reason: "not_found", message: describeRejectReason("not_found") };
  const eff = effectiveStatus(coupon);
  if (eff === "deleted") return { ok: false, reason: "deleted", message: describeRejectReason("deleted") };
  if (eff === "inactive") return { ok: false, reason: "inactive", message: describeRejectReason("inactive") };
  if (eff === "scheduled") return { ok: false, reason: "not_started", message: describeRejectReason("not_started") };
  if (eff === "expired") return { ok: false, reason: "expired", message: describeRejectReason("expired") };
  if (eff === "exhausted") return { ok: false, reason: "exhausted", message: describeRejectReason("exhausted") };

  if (coupon.applicableTenantIds.length > 0 && !coupon.applicableTenantIds.includes(input.tenantId)) {
    return { ok: false, reason: "wrong_restaurant", message: describeRejectReason("wrong_restaurant") };
  }

  const action = input.action ?? "payment";
  if (action === "trial_extension" && coupon.discountType !== "trial_extension") {
    return { ok: false, reason: "invalid_for_action", message: "Only trial-extension coupons can extend a trial." };
  }
  if (action === "payment" && coupon.discountType === "trial_extension") {
    return { ok: false, reason: "invalid_for_action", message: "This coupon can only be used to extend a trial, not for payment." };
  }

  if (coupon.discountType !== "trial_extension") {
    if (!input.plan) return { ok: false, reason: "wrong_plan", message: "A plan is required to apply this coupon." };
    if (coupon.applicablePlanIds.length > 0 && !coupon.applicablePlanIds.includes(input.plan.id)) {
      return { ok: false, reason: "wrong_plan", message: describeRejectReason("wrong_plan") };
    }
  }

  const value = Number(coupon.discountValue);
  let discountAmount = 0;
  let trialDaysToAdd = 0;
  let persistOnTenant = false;
  let firstCycleOnly = false;
  const planPrice = input.plan ? Number(input.plan.price) : 0;
  const isFirst = input.isFirstCycle ?? true;

  switch (coupon.discountType as CouponDiscountType) {
    case "flat":
      discountAmount = Math.min(planPrice, Math.max(0, value));
      break;
    case "percent":
      discountAmount = Math.max(0, Math.min(100, value)) / 100 * planPrice;
      break;
    case "first_month":
      firstCycleOnly = true;
      if (isFirst) {
        discountAmount = Math.max(0, Math.min(100, value)) / 100 * planPrice;
      } else {
        return { ok: false, reason: "invalid_for_action", message: "First-month coupon already used on the first cycle." };
      }
      break;
    case "lifetime":
      persistOnTenant = true;
      discountAmount = Math.max(0, Math.min(100, value)) / 100 * planPrice;
      break;
    case "trial_extension":
      trialDaysToAdd = Math.max(0, Math.floor(value));
      break;
  }

  const effectiveAmount = Math.max(0, planPrice - discountAmount);
  return {
    ok: true,
    resolved: {
      coupon,
      discountAmount: Number(discountAmount.toFixed(2)),
      effectiveAmount: Number(effectiveAmount.toFixed(2)),
      trialDaysToAdd,
      persistOnTenant,
      firstCycleOnly,
    },
  };
}

export function snapshotCoupon(c: SubscriptionCoupon): CouponSnapshot {
  return {
    id: c.id,
    code: c.code,
    discountType: c.discountType as CouponDiscountType,
    discountValue: String(c.discountValue),
  };
}

/**
 * Atomically increment usedCount and write a redemption row. Should be called
 * once a payment / trial extension has actually been applied. The caller may
 * pass `paymentId` (subscription_payments.id) and/or `manualRequestId`.
 */
export async function recordRedemption(args: {
  coupon: SubscriptionCoupon;
  tenantId: number;
  planId: number | null;
  paymentId?: number | null;
  manualRequestId?: number | null;
  discountApplied: number;
  trialDaysAdded?: number | null;
  context?: "payment" | "trial_extension" | "manual_admin";
  redeemedBy?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.transaction(async tx => {
    await tx.insert(subscriptionCouponRedemptionsTable).values({
      couponId: args.coupon.id,
      tenantId: args.tenantId,
      planId: args.planId,
      paymentId: args.paymentId ?? null,
      manualRequestId: args.manualRequestId ?? null,
      discountApplied: args.discountApplied.toFixed(2),
      trialDaysAdded: args.trialDaysAdded ?? null,
      context: args.context ?? "payment",
      redeemedBy: args.redeemedBy ?? null,
      metadata: args.metadata ?? {},
    });
    await tx.update(subscriptionCouponsTable)
      .set({ usedCount: sql`${subscriptionCouponsTable.usedCount} + 1`, updatedAt: new Date() })
      .where(eq(subscriptionCouponsTable.id, args.coupon.id));
  });
}

/**
 * Count prior succeeded payments for a tenant on a given plan. Used to decide
 * whether a `first_month` coupon is still applicable.
 */
export async function countPriorPayments(tenantId: number, planId: number): Promise<number> {
  const { subscriptionPaymentsTable } = await import("./db");
  const [r] = await db.select({ c: sql<number>`cast(count(*) as int)` })
    .from(subscriptionPaymentsTable)
    .where(and(
      eq(subscriptionPaymentsTable.tenantId, tenantId),
      eq(subscriptionPaymentsTable.planId, planId),
      eq(subscriptionPaymentsTable.status, "succeeded"),
    ));
  return r?.c ?? 0;
}
