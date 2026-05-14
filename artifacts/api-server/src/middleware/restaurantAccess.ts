import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, restaurantsTable } from "../lib/db";

/**
 * Verifies that the :restaurantId path param belongs to the authenticated
 * user's tenant (or allows super-admins through).  Must be placed AFTER
 * `authenticate` and any role middleware.
 *
 * Attaches `req.restaurant` so downstream handlers can use it without a
 * second DB round-trip.
 */
export async function validateRestaurantAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const restaurantId = Number(req.params.restaurantId);
  if (!restaurantId || isNaN(restaurantId)) {
    res.status(400).json({ error: "Invalid restaurantId" });
    return;
  }

  const [restaurant] = await db
    .select({ id: restaurantsTable.id, tenantId: restaurantsTable.tenantId })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));

  if (!restaurant) {
    res.status(404).json({ error: "Restaurant not found" });
    return;
  }

  if (!req.user!.isSuperAdmin) {
    if (restaurant.tenantId !== req.user!.tenantId) {
      res.status(403).json({ error: "Access denied: cross-tenant request" });
      return;
    }
    // Branch-scope enforcement: users whose JWT pins them to a specific
    // restaurantId (e.g. branch managers / waiters / kitchen staff) may
    // only access that branch. Tenant-wide owners have `restaurantId`
    // null on their JWT and pass through, matching the consolidation
    // logic in `branches.ts`.
    if (
      req.user!.restaurantId != null &&
      req.user!.role !== "owner" &&
      req.user!.restaurantId !== restaurantId
    ) {
      res.status(403).json({ error: "Access denied: out-of-scope branch" });
      return;
    }
  }

  next();
}
