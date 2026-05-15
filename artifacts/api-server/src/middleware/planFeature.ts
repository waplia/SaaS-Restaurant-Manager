import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, tenantsTable, subscriptionPlansTable, isFeatureEnabled, PLAN_BOOLEAN_FEATURES } from "../lib/db";

/**
 * Express middleware factory: gates a route on a per-plan boolean feature flag.
 * Super admins bypass the check. Tenants with no plan assigned (e.g. trial)
 * are allowed — the flag is only enforced once a plan exists.
 *
 * Returns 403 with a friendly upgrade message when the plan disables the flag.
 */
export function requirePlanFeature(featureKey: string) {
  return async function planFeatureGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.user?.isSuperAdmin) return next();
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      res.status(403).json({ error: "No tenant" });
      return;
    }
    const [tenant] = await db
      .select({ planId: tenantsTable.planId, isSuspended: tenantsTable.isSuspended })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId));
    if (!tenant) {
      res.status(403).json({ error: "Tenant not found" });
      return;
    }
    if (tenant.isSuspended) {
      res.status(403).json({ error: "Account suspended" });
      return;
    }
    if (!tenant.planId) return next(); // trial / no plan → allowed
    const [plan] = await db
      .select({ featureFlags: subscriptionPlansTable.featureFlags })
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.id, tenant.planId));
    if (plan && !isFeatureEnabled(plan.featureFlags, featureKey)) {
      const def = PLAN_BOOLEAN_FEATURES.find((f) => f.key === featureKey);
      const label = def?.label ?? featureKey;
      res.status(403).json({
        error: `Your plan doesn't include ${label} — upgrade in Settings → Subscription.`,
        feature: featureKey,
      });
      return;
    }
    next();
  };
}
