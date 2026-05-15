import { Router } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  deliveryAssignmentsTable,
  codHandoversTable,
  ordersTable,
  usersTable,
  paymentsTable,
  notificationsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { broadcastEvent } from "../lib/socketio";
import { sendPush } from "../lib/notifications";

const router = Router();

router.use(
  "/restaurants/:restaurantId",
  requireRole("owner", "manager", "cashier", "waiter", "kitchen", "delivery_executive", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("delivery_module"),
);

// Roles allowed on non-COD delivery operations (excludes cashier).
const DELIVERY_OPS_ROLES = ["owner", "manager", "waiter", "kitchen", "delivery_executive", "super_admin"] as const;

// List delivery executives for the restaurant.
router.get("/restaurants/:restaurantId/delivery/executives", requireRole(...DELIVERY_OPS_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      phone: usersTable.phone,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(and(eq(usersTable.restaurantId, restaurantId), eq(usersTable.role, "delivery_executive")));

  // Active assignment counts per rider
  const counts = await db
    .select({
      riderId: deliveryAssignmentsTable.riderId,
      count: sql<number>`count(*)::int`,
    })
    .from(deliveryAssignmentsTable)
    .where(
      and(
        eq(deliveryAssignmentsTable.restaurantId, restaurantId),
        inArray(deliveryAssignmentsTable.status, ["assigned", "picked_up"]),
      ),
    )
    .groupBy(deliveryAssignmentsTable.riderId);

  const countMap = new Map(counts.map(c => [c.riderId, Number(c.count)]));
  res.json(rows.map(r => ({ ...r, activeDeliveries: countMap.get(r.id) ?? 0 })));
});

// Assign a rider to an order.
router.post("/restaurants/:restaurantId/delivery/assign", requireRole(...DELIVERY_OPS_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { orderId, riderId, notes } = req.body as { orderId: number; riderId: number; notes?: string };
  if (!orderId || !riderId) return void res.status(400).json({ error: "orderId and riderId are required" });

  const [order] = await db.select().from(ordersTable).where(
    and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)),
  );
  if (!order) return void res.status(404).json({ error: "Order not found" });

  const [rider] = await db.select().from(usersTable).where(
    and(eq(usersTable.id, riderId), eq(usersTable.restaurantId, restaurantId), eq(usersTable.role, "delivery_executive")),
  );
  if (!rider) return void res.status(404).json({ error: "Rider not found" });

  // Cancel any prior active assignment for this order
  await db.update(deliveryAssignmentsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(deliveryAssignmentsTable.orderId, orderId),
      inArray(deliveryAssignmentsTable.status, ["assigned", "picked_up"]),
    ));

  const codAmount = order.paymentStatus === "paid" ? "0.00" : Number(order.totalAmount).toFixed(2);

  const [assignment] = await db.insert(deliveryAssignmentsTable).values({
    restaurantId,
    orderId,
    riderId,
    status: "assigned",
    codAmount,
    notes: notes ?? null,
    assignedBy: req.user!.sub,
  }).returning();

  await db.update(ordersTable)
    .set({ status: "out_for_delivery", updatedAt: new Date() })
    .where(eq(ordersTable.id, orderId));

  await db.insert(notificationsTable).values({
    restaurantId,
    type: "delivery_assigned",
    title: "Delivery assigned",
    message: `Order #${order.orderNumber} assigned to ${rider.name}`,
    entityId: orderId,
    entityType: "order",
  }).catch(() => {});

  broadcastEvent(restaurantId, "delivery:assigned", { assignment, orderId, riderId });

  if (rider.pushToken) {
    sendPush({
      to: rider.pushToken,
      title: "New delivery assigned",
      body: `Order #${order.orderNumber} • ₹${Number(order.totalAmount).toFixed(2)}${codAmount !== "0.00" ? ` • COD ₹${codAmount}` : ""}`,
      data: { type: "delivery_assigned", orderId, assignmentId: assignment.id },
    }).catch(() => {});
  }

  res.status(201).json(assignment);
});

// Update assignment status: picked_up, delivered, cancelled
router.patch("/restaurants/:restaurantId/delivery/assignments/:id/status", requireRole(...DELIVERY_OPS_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { status, codCollected } = req.body as { status: string; codCollected?: boolean };
  const allowed = ["picked_up", "delivered", "cancelled"];
  if (!allowed.includes(status)) return void res.status(400).json({ error: "Invalid status" });

  const [assignment] = await db.select().from(deliveryAssignmentsTable).where(
    and(eq(deliveryAssignmentsTable.id, id), eq(deliveryAssignmentsTable.restaurantId, restaurantId)),
  );
  if (!assignment) return void res.status(404).json({ error: "Not found" });

  // Riders can only update their own
  if (req.user!.role === "delivery_executive" && assignment.riderId !== req.user!.sub) {
    return void res.status(403).json({ error: "Not your assignment" });
  }

  const now = new Date();
  const update: Partial<typeof deliveryAssignmentsTable.$inferInsert> = { status, updatedAt: now };
  if (status === "picked_up" && !assignment.pickedUpAt) update.pickedUpAt = now;
  if (status === "delivered" && !assignment.deliveredAt) update.deliveredAt = now;
  if (status === "cancelled" && !assignment.cancelledAt) update.cancelledAt = now;
  if (typeof codCollected === "boolean") update.codCollected = codCollected;

  const [updated] = await db.update(deliveryAssignmentsTable)
    .set(update)
    .where(eq(deliveryAssignmentsTable.id, id))
    .returning();

  if (status === "delivered") {
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, assignment.orderId));
    if (order) {
      const orderUpdate: Partial<typeof ordersTable.$inferInsert> = { status: "completed", updatedAt: now };
      // If COD collected, mark paid
      if ((codCollected ?? updated.codCollected) && order.paymentStatus !== "paid") {
        orderUpdate.paymentStatus = "paid";
        orderUpdate.paymentMethod = "cash";
      }
      await db.update(ordersTable).set(orderUpdate).where(eq(ordersTable.id, order.id));
    }
  } else if (status === "cancelled") {
    await db.update(ordersTable)
      .set({ status: "ready", updatedAt: now })
      .where(eq(ordersTable.id, assignment.orderId));
  }

  broadcastEvent(restaurantId, "delivery:updated", { assignment: updated });
  res.json(updated);
});

// Mark COD collected on an assignment
router.post("/restaurants/:restaurantId/delivery/assignments/:id/cod-collected", requireRole(...DELIVERY_OPS_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [assignment] = await db.select().from(deliveryAssignmentsTable).where(
    and(eq(deliveryAssignmentsTable.id, id), eq(deliveryAssignmentsTable.restaurantId, restaurantId)),
  );
  if (!assignment) return void res.status(404).json({ error: "Not found" });
  if (req.user!.role === "delivery_executive" && assignment.riderId !== req.user!.sub) {
    return void res.status(403).json({ error: "Not your assignment" });
  }
  const [updated] = await db.update(deliveryAssignmentsTable)
    .set({ codCollected: true, updatedAt: new Date() })
    .where(eq(deliveryAssignmentsTable.id, id))
    .returning();
  broadcastEvent(restaurantId, "delivery:updated", { assignment: updated });
  res.json(updated);
});

// My deliveries (for the logged-in rider)
router.get("/restaurants/:restaurantId/delivery/my", requireRole(...DELIVERY_OPS_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const riderId = req.user!.sub;
  const rows = await db
    .select({
      assignment: deliveryAssignmentsTable,
      order: ordersTable,
    })
    .from(deliveryAssignmentsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, deliveryAssignmentsTable.orderId))
    .where(and(
      eq(deliveryAssignmentsTable.restaurantId, restaurantId),
      eq(deliveryAssignmentsTable.riderId, riderId),
    ))
    .orderBy(desc(deliveryAssignmentsTable.assignedAt))
    .limit(100);
  res.json(rows.map(r => ({ ...r.assignment, order: r.order })));
});

// All assignments (manager view)
router.get("/restaurants/:restaurantId/delivery/assignments", requireRole(...DELIVERY_OPS_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = req.query.status as string | undefined;
  const conditions = [eq(deliveryAssignmentsTable.restaurantId, restaurantId)];
  if (status) conditions.push(eq(deliveryAssignmentsTable.status, status));

  const rows = await db
    .select({
      assignment: deliveryAssignmentsTable,
      order: ordersTable,
      rider: { id: usersTable.id, name: usersTable.name, phone: usersTable.phone },
    })
    .from(deliveryAssignmentsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, deliveryAssignmentsTable.orderId))
    .innerJoin(usersTable, eq(usersTable.id, deliveryAssignmentsTable.riderId))
    .where(and(...conditions))
    .orderBy(desc(deliveryAssignmentsTable.assignedAt))
    .limit(200);

  res.json(rows.map(r => ({ ...r.assignment, order: r.order, rider: r.rider })));
});

// COD summary per rider (outstanding cash to be handed in)
router.get("/restaurants/:restaurantId/delivery/cod-summary", requireRole("owner", "manager", "cashier", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);

  const collected = await db
    .select({
      riderId: deliveryAssignmentsTable.riderId,
      total: sql<string>`coalesce(sum(case when ${deliveryAssignmentsTable.codCollected} and not ${deliveryAssignmentsTable.codHandedIn} then ${deliveryAssignmentsTable.codAmount}::numeric else 0 end), 0)::text`,
      delivered: sql<number>`count(case when ${deliveryAssignmentsTable.status} = 'delivered' then 1 end)::int`,
    })
    .from(deliveryAssignmentsTable)
    .where(eq(deliveryAssignmentsTable.restaurantId, restaurantId))
    .groupBy(deliveryAssignmentsTable.riderId);

  const riderIds = collected.map(c => c.riderId);
  const riders = riderIds.length === 0 ? [] : await db
    .select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, isActive: usersTable.isActive })
    .from(usersTable)
    .where(inArray(usersTable.id, riderIds));
  const riderMap = new Map(riders.map(r => [r.id, r]));

  const result = collected
    .map(c => ({
      riderId: c.riderId,
      riderName: riderMap.get(c.riderId)?.name ?? `Rider #${c.riderId}`,
      riderPhone: riderMap.get(c.riderId)?.phone ?? null,
      outstanding: Number(c.total ?? 0),
      deliveredCount: Number(c.delivered ?? 0),
    }))
    .filter(r => riderMap.has(r.riderId));

  res.json(result);
});

// Recent COD handovers
router.get("/restaurants/:restaurantId/delivery/handovers", requireRole("owner", "manager", "cashier", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select({
      handover: codHandoversTable,
      rider: { id: usersTable.id, name: usersTable.name },
    })
    .from(codHandoversTable)
    .innerJoin(usersTable, eq(usersTable.id, codHandoversTable.riderId))
    .where(eq(codHandoversTable.restaurantId, restaurantId))
    .orderBy(desc(codHandoversTable.handedInAt))
    .limit(50);
  res.json(rows.map(r => ({ ...r.handover, rider: r.rider })));
});

// Record a COD handover (rider hands cash to manager/cashier)
router.post(
  "/restaurants/:restaurantId/delivery/handovers",
  requireRole("owner", "manager", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { riderId, amount, notes } = req.body as { riderId: number; amount: number; notes?: string };
    if (!riderId || !amount || amount <= 0) {
      return void res.status(400).json({ error: "riderId and positive amount required" });
    }

    const [rider] = await db.select().from(usersTable).where(
      and(eq(usersTable.id, riderId), eq(usersTable.restaurantId, restaurantId)),
    );
    if (!rider) return void res.status(404).json({ error: "Rider not found" });

    const amountStr = Number(amount).toFixed(2);

    const [payment] = await db.insert(paymentsTable).values({
      restaurantId,
      direction: "in",
      method: "cash",
      amount: amountStr,
      partyType: "staff",
      partyId: riderId,
      partyName: rider.name,
      referenceType: "cod_handover",
      notes: notes ?? `COD handover from ${rider.name}`,
      recordedBy: req.user!.sub,
    }).returning();

    const [handover] = await db.insert(codHandoversTable).values({
      restaurantId,
      riderId,
      amount: amountStr,
      notes: notes ?? null,
      recordedBy: req.user!.sub,
      paymentId: payment.id,
    }).returning();

    // Mark all collected-but-not-handed-in assignments for this rider as handed in
    await db.update(deliveryAssignmentsTable)
      .set({ codHandedIn: true, updatedAt: new Date() })
      .where(and(
        eq(deliveryAssignmentsTable.restaurantId, restaurantId),
        eq(deliveryAssignmentsTable.riderId, riderId),
        eq(deliveryAssignmentsTable.codCollected, true),
        eq(deliveryAssignmentsTable.codHandedIn, false),
      ));

    broadcastEvent(restaurantId, "delivery:handover", { handover });
    res.status(201).json(handover);
  },
);

export default router;
