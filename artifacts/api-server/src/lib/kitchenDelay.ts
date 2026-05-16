import { eq, and, inArray, sql } from "drizzle-orm";
import {
  db,
  kitchenTicketsTable,
  ticketDelayAlertsTable,
  restaurantSettingsTable,
  ordersTable,
  notificationsTable,
} from "./db";
import { broadcastEvent } from "./socketio";
import { pushToStaff } from "./pushNotify";
import { logger } from "./logger";

export interface KitchenDelayConfig {
  enabled: boolean;
  thresholdMinutes: number;
  perKitchen: Record<string, number>;
}

const DEFAULT_CONFIG: KitchenDelayConfig = {
  enabled: true,
  thresholdMinutes: 10,
  perKitchen: {},
};

export async function loadKitchenDelayConfig(restaurantId: number): Promise<KitchenDelayConfig> {
  const [row] = await db.select().from(restaurantSettingsTable).where(and(
    eq(restaurantSettingsTable.restaurantId, restaurantId),
    eq(restaurantSettingsTable.section, "kitchen-delay"),
  ));
  const data = (row?.data ?? {}) as Partial<KitchenDelayConfig>;
  const threshold = Number(data.thresholdMinutes);
  const perKitchen: Record<string, number> = {};
  if (data.perKitchen && typeof data.perKitchen === "object") {
    for (const [k, v] of Object.entries(data.perKitchen)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) perKitchen[String(k)] = Math.floor(n);
    }
  }
  return {
    enabled: data.enabled !== false,
    thresholdMinutes: Number.isFinite(threshold) && threshold > 0 ? Math.floor(threshold) : DEFAULT_CONFIG.thresholdMinutes,
    perKitchen,
  };
}

export function thresholdForKitchen(cfg: KitchenDelayConfig, kitchenId: number | null): number {
  if (kitchenId != null) {
    const v = cfg.perKitchen[String(kitchenId)];
    if (Number.isFinite(v) && v > 0) return v;
  }
  return cfg.thresholdMinutes;
}

/**
 * Scan active kitchen tickets and emit delay alerts. Dedupes per ticket: at
 * most one alert is generated per ticket unless the delay grows by another
 * full threshold window (escalation).
 */
export async function runDelayDetectionTick(now: Date = new Date()): Promise<{ alertsCreated: number }> {
  // Collect active tickets across all restaurants in one shot.
  const active = await db
    .select({
      id: kitchenTicketsTable.id,
      restaurantId: kitchenTicketsTable.restaurantId,
      kitchenId: kitchenTicketsTable.kitchenId,
      orderId: kitchenTicketsTable.orderId,
      status: kitchenTicketsTable.status,
      createdAt: kitchenTicketsTable.createdAt,
      expectedReadyAt: kitchenTicketsTable.expectedReadyAt,
      expectedPrepMinutes: kitchenTicketsTable.expectedPrepMinutes,
      delayAlertCount: kitchenTicketsTable.delayAlertCount,
      lastDelayAlertAt: kitchenTicketsTable.lastDelayAlertAt,
    })
    .from(kitchenTicketsTable)
    .where(sql`${kitchenTicketsTable.status} IN ('new','preparing')`);

  if (active.length === 0) return { alertsCreated: 0 };

  // Group per restaurant so we load config once per restaurant.
  const byRestaurant = new Map<number, typeof active>();
  for (const t of active) {
    const arr = byRestaurant.get(t.restaurantId) ?? [];
    arr.push(t);
    byRestaurant.set(t.restaurantId, arr);
  }

  let alertsCreated = 0;
  for (const [restaurantId, tickets] of byRestaurant) {
    const cfg = await loadKitchenDelayConfig(restaurantId);
    if (!cfg.enabled) continue;

    for (const t of tickets) {
      const threshold = thresholdForKitchen(cfg, t.kitchenId);
      const expectedReady = t.expectedReadyAt
        ? new Date(t.expectedReadyAt).getTime()
        : new Date(t.createdAt).getTime() + (t.expectedPrepMinutes ?? 15) * 60_000;
      const overdueMs = now.getTime() - expectedReady;
      const overdueMinutes = Math.floor(overdueMs / 60_000);
      if (overdueMinutes < threshold) continue;

      // Dedupe: one alert per ticket per (threshold-sized) escalation window.
      const requiredAlerts = Math.floor(overdueMinutes / threshold);
      if (t.delayAlertCount >= requiredAlerts) continue;

      try {
        await db.insert(ticketDelayAlertsTable).values({
          ticketId: t.id,
          restaurantId,
          kitchenId: t.kitchenId,
          thresholdMinutes: threshold,
          delayedByMinutes: overdueMinutes,
          expectedReadyAt: t.expectedReadyAt,
        });
        await db.update(kitchenTicketsTable)
          .set({ delayAlertCount: requiredAlerts, lastDelayAlertAt: now })
          .where(eq(kitchenTicketsTable.id, t.id));
        alertsCreated++;

        // Get order number for nicer messages.
        const [order] = await db
          .select({ orderNumber: ordersTable.orderNumber })
          .from(ordersTable)
          .where(eq(ordersTable.id, t.orderId));
        const orderLabel = order?.orderNumber ?? `#${t.orderId}`;

        broadcastEvent(restaurantId, "ticket:delayed", {
          id: t.id,
          orderId: t.orderId,
          orderNumber: order?.orderNumber ?? null,
          kitchenId: t.kitchenId,
          delayedByMinutes: overdueMinutes,
          thresholdMinutes: threshold,
          alertCount: requiredAlerts,
        });

        await db.insert(notificationsTable).values({
          restaurantId,
          type: "kitchen_delay",
          title: "Kitchen delay alert",
          message: `Order ${orderLabel} is ${overdueMinutes} min past expected ready time (threshold ${threshold} min).`,
          entityId: t.orderId,
          entityType: "order",
        }).catch(() => {});
        broadcastEvent(restaurantId, "notification:new", { type: "kitchen_delay" });

        await pushToStaff(
          { restaurantId, roles: ["waiter", "manager", "owner"], type: "kitchen_delay", kitchenId: t.kitchenId },
          {
            title: "Kitchen delay",
            body: `Order ${orderLabel} is ${overdueMinutes} min late`,
            data: { orderId: t.orderId, ticketId: t.id, kitchenId: t.kitchenId },
          },
        );
      } catch (err) {
        logger.error({ err, ticketId: t.id }, "Failed to record kitchen delay alert");
      }
    }
  }
  return { alertsCreated };
}
