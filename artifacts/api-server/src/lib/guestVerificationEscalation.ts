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

/**
 * Release any guest-verification holds for an order. Called when an order's
 * payment completes online (Stripe/PhonePe etc.) — once the guest has paid
 * real money the fraud vector is gone, so held tickets are auto-flipped to
 * 'new' and the session is marked staff-verified (system-verified). Safe to
 * call on orders that were never held: it's a no-op when zero rows match.
 *
 * Returns the count of released tickets so the caller can decide whether to
 * broadcast `order:new` / `guest_verification:accepted` events.
 */
export async function releaseHeldTicketsForPaidOrder(
  orderId: number,
  restaurantId: number,
): Promise<{ released: Array<{ id: number; kitchenId: number | null }>; tableSessionId: number | null; tableId: number | null; orderNumber: string | null }> {
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const released = await tx.update(kitchenTicketsTable)
      .set({ status: "new", updatedAt: now })
      .where(and(
        eq(kitchenTicketsTable.orderId, orderId),
        eq(kitchenTicketsTable.restaurantId, restaurantId),
        eq(kitchenTicketsTable.status, "pending_acceptance"),
      ))
      .returning({ id: kitchenTicketsTable.id, kitchenId: kitchenTicketsTable.kitchenId });
    if (released.length === 0) {
      return { released, tableSessionId: null, tableId: null, orderNumber: null };
    }
    const [order] = await tx.select({
      id: ordersTable.id,
      tableSessionId: ordersTable.tableSessionId,
      tableId: ordersTable.tableId,
      orderNumber: ordersTable.orderNumber,
    }).from(ordersTable).where(eq(ordersTable.id, orderId));
    if (order?.tableSessionId) {
      const { tableSessionsTable } = await import("./db");
      await tx.update(tableSessionsTable).set({
        staffVerifiedAt: now, updatedAt: now,
      }).where(eq(tableSessionsTable.id, order.tableSessionId));
    }
    return {
      released,
      tableSessionId: order?.tableSessionId ?? null,
      tableId: order?.tableId ?? null,
      orderNumber: order?.orderNumber ?? null,
    };
  });

  if (result.released.length > 0) {
    try {
      broadcastEvent(restaurantId, "guest_verification:accepted", {
        orderId, tableId: result.tableId, autoReleasedByPayment: true,
      });
      for (const t of result.released) {
        broadcastEvent(restaurantId, "order:new", {
          id: orderId, orderNumber: result.orderNumber, status: "new",
          tableId: result.tableId, ticketId: t.id, kitchenId: t.kitchenId,
        });
      }
    } catch (err) {
      logger.error({ err, orderId }, "[guest-verification] broadcast after auto-release failed");
    }
  }
  return result;
}

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
