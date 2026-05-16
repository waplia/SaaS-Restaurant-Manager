import type { Request, Response, NextFunction } from "express";
import { tenantHasAddon } from "../lib/addons";
import { db, addonsTable } from "../lib/db";
import { eq } from "drizzle-orm";

/**
 * Express middleware: gates a route on an installed/active add-on. Super
 * admins bypass. Tenants without a matching install/inclusion get 403 with
 * a marketplace upgrade hint.
 */
export function requireAddon(addonKey: string) {
  return async function addonGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.user?.isSuperAdmin) return next();
    const tenantId = req.user?.tenantId;
    if (!tenantId) { res.status(403).json({ error: "No tenant" }); return; }
    const has = await tenantHasAddon(tenantId, addonKey);
    if (has) return next();
    const [addon] = await db.select({ name: addonsTable.name }).from(addonsTable).where(eq(addonsTable.key, addonKey));
    res.status(403).json({
      error: `Install the ${addon?.name ?? addonKey} add-on to use this — open Marketplace to enable it.`,
      addon: addonKey,
      requiresAddon: true,
    });
  };
}
