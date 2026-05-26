/**
 * Guest Verification Hold — re-ping + escalation.
 *
 * Runs every minute (see scheduler.ts → `guest_verification_escalation`).
 * For each kitchen ticket still in `pending_acceptance`:
 *   - Around the 2-min mark: re-ping waiters+managers+owners (waiter tier).
 *   - Around the 5-min mark: escalate by pinging managers+owners only
 *     (loud channel: "manager attention needed").
 *   - We never auto-accept — staff must physically tap Accept/Reject.
 *
 * Idempotency: we look at the ticket's `created_at` age and only fire on
 * the minute that straddles each threshold (age ≥ N min AND age < N+1 min).
 * That way each ticket pings exactly once per threshold per minute window
 * even if the cron runs slightly off-schedule.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, kitchenTicketsTable, ordersTable, notificationsTable } from "./db";
import { broadcastEvent } from "./socketio";
import { pushToStaff } from "./pushNotify";
import { logger } from "./logger";

const REPING_AT_MIN = 2;
const ESCALATE_AT_MIN = 5;

export async function runGuestVerificationEscalation(now: Date): Promise<{ repinged: number; escalated: number }> {
  // Pick one ticket per order (the oldest) to avoid double-pinging when an
  // order spans multiple kitchens — we ping per order, not per ticket.
  const rows = await db
    .selectDistinctOn([kitchenTicketsTable.orderId], {
      orderId: kitchenTicketsTable.orderId,
      restaurantId: kitchenTicketsTable.restaurantId,
      ticketCreatedAt: kitchenTicketsTable.createdAt,
      orderNumber: ordersTable.orderNumber,
      tableId: ordersTable.tableId,
    })
    .from(kitchenTicketsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, kitchenTicketsTable.orderId))
    .where(and(
      eq(kitchenTicketsTable.status, "pending_acceptance"),
    ))
    .orderBy(kitchenTicketsTable.orderId, kitchenTicketsTable.createdAt);

  let repinged = 0;
  let escalated = 0;

  for (const r of rows) {
    if (!r.ticketCreatedAt) continue;
    const ageMin = (now.getTime() - new Date(r.ticketCreatedAt).getTime()) / 60_000;
    const ageWhole = Math.floor(ageMin);
    // Cron fires every minute. We fire a single re-ping when the held order
    // first crosses the 2-min mark, and from the 5-min mark onward we
    // escalate to manager+owner every minute until staff acts. Per spec we
    // never auto-fire the order.
    const shouldEscalate = ageWhole >= ESCALATE_AT_MIN;
    const shouldReping = !shouldEscalate && ageWhole === REPING_AT_MIN;

    if (!shouldReping && !shouldEscalate) continue;

    try {
      if (shouldEscalate) {
        await pushToStaff(
          { restaurantId: r.restaurantId, roles: ["manager", "owner"], type: "guest_verification" },
          {
            title: `Escalation · Guest still unverified · #${r.orderNumber}`,
            body: `Held for ${ageWhole} min. Please verify the table or reject the order.`,
            data: { orderId: r.orderId, tableId: r.tableId, type: "guest_verification", screen: "tables", escalation: true },
          },
        );
        await db.insert(notificationsTable).values({
          restaurantId: r.restaurantId, type: "guest_verification",
          title: `Escalation: guest unverified ${ageWhole}min`,
          message: `Order #${r.orderNumber} still awaiting staff verification`,
          entityId: r.orderId, entityType: "order",
        });
        broadcastEvent(r.restaurantId, "guest_verification:escalated", { orderId: r.orderId, tableId: r.tableId, ageMin: ageWhole });
        escalated++;
      } else {
        await pushToStaff(
          { restaurantId: r.restaurantId, roles: ["waiter", "manager", "owner"], type: "guest_verification" },
          {
            title: `Reminder · Guest waiting · #${r.orderNumber}`,
            body: `Held for ${ageWhole} min. Accept to fire to kitchen.`,
            data: { orderId: r.orderId, tableId: r.tableId, type: "guest_verification", screen: "tables" },
          },
        );
        broadcastEvent(r.restaurantId, "guest_verification:reping", { orderId: r.orderId, tableId: r.tableId, ageMin: ageWhole });
        repinged++;
      }
    } catch (err) {
      logger.error({ err, orderId: r.orderId }, "[guest-verification] re-ping/escalate failed");
    }
  }

  // Silence unused-variable lint for `sql` import kept for future filters.
  void sql;
  return { repinged, escalated };
}
