import type { Request } from "express";
import { eq, and, type SQL } from "drizzle-orm";
import { tenantsTable, restaurantsTable } from "../lib/db";

export function restaurantScopeCondition(
  req: Request,
  restaurantIdParam: number,
): SQL | undefined {
  if (req.user?.isSuperAdmin) return undefined;
  if (req.user?.tenantId) {
    return eq(restaurantsTable.tenantId, req.user.tenantId);
  }
  return eq(restaurantsTable.id, restaurantIdParam);
}

export function getTenantIdFromRequest(req: Request): number | null {
  return req.user?.tenantId ?? null;
}

export function getRestaurantIdFromRequest(req: Request): number | null {
  return req.user?.restaurantId ?? null;
}
