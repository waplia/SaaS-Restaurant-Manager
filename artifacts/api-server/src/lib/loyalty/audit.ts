import { eq, desc } from "drizzle-orm";
import { db, loyaltyAuditLogTable } from "../db";

export async function logAudit(args: {
  restaurantId: number; customerId?: number | null; actorId?: number | null;
  action: string; payload?: Record<string, unknown>;
}) {
  await db.insert(loyaltyAuditLogTable).values({
    restaurantId: args.restaurantId,
    customerId: args.customerId ?? null,
    actorId: args.actorId ?? null,
    action: args.action,
    payload: args.payload ?? null,
  }).catch(() => {});
}

export async function listRecentAudit(restaurantId: number, limit = 100) {
  return db.select().from(loyaltyAuditLogTable)
    .where(eq(loyaltyAuditLogTable.restaurantId, restaurantId))
    .orderBy(desc(loyaltyAuditLogTable.createdAt))
    .limit(limit);
}
