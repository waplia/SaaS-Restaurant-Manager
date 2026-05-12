import { Router } from "express";
import { eq, and, or, inArray } from "drizzle-orm";
import { db, floorTablesTable, reservationsTable, subscriptionPlansTable, tenantsTable, restaurantsTable, ordersTable, orderItemsTable, kitchenTicketsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), validateRestaurantAccess);

router.get("/restaurants/:restaurantId/tables", async (req, res) => {
  const rows = await db.select().from(floorTablesTable).where(eq(floorTablesTable.restaurantId, Number(req.params.restaurantId)));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/tables", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);

  if (!req.user!.isSuperAdmin) {
    const [restaurant] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
    if (restaurant?.tenantId) {
      const [tenant] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, restaurant.tenantId));
      if (tenant?.planId) {
        const [plan] = await db.select({ maxTables: subscriptionPlansTable.maxTables }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
        if (plan && plan.maxTables > 0) {
          const existing = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.restaurantId, restaurantId), eq(floorTablesTable.isActive, true)));
          if (existing.length >= plan.maxTables) {
            return void res.status(402).json({ error: `Your plan allows a maximum of ${plan.maxTables} table(s). Upgrade to add more.` });
          }
        }
      }
    }
  }

  const { tableNumber, capacity, positionX, positionY, shape } = req.body;
  const qrCode = `${restaurantId}-${tableNumber}-${Date.now()}`;
  const [table] = await db.insert(floorTablesTable).values({ restaurantId, tableNumber, capacity, positionX, positionY, shape, qrCode }).returning();
  res.status(201).json(table);
});

router.patch("/restaurants/:restaurantId/tables/:id", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const { tableNumber, capacity, status, positionX, positionY, shape, isActive } = req.body;
  const [updated] = await db.update(floorTablesTable).set({ tableNumber, capacity, status, positionX, positionY, shape, isActive, updatedAt: new Date() }).where(and(eq(floorTablesTable.id, Number(req.params.id)), eq(floorTablesTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/tables/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.update(floorTablesTable).set({ isActive: false }).where(and(eq(floorTablesTable.id, Number(req.params.id)), eq(floorTablesTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/tables/:id/qr", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [table] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, Number(req.params.id)), eq(floorTablesTable.restaurantId, restaurantId)));
  if (!table) return void res.status(404).json({ error: "Not found" });
  const [restaurant] = await db.select({ slug: restaurantsTable.slug }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  const slug = restaurant?.slug ?? String(restaurantId);
  const baseUrl = process.env.PUBLIC_URL?.replace(/\/$/, "") || "";
  const qrUrl = `${baseUrl}/menu/${slug}/${table.id}`;
  let svgData = "";
  try {
    const QRCode = await import("qrcode");
    svgData = await QRCode.toString(qrUrl || `menu/${slug}/${table.id}`, { type: "svg", margin: 1, width: 300 });
  } catch { /* qrcode unavailable — svgData stays empty */ }
  res.json({ qrUrl, tableNumber: table.tableNumber, svgData });
});

router.post("/restaurants/:restaurantId/tables/merge", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { sourceTableId, targetTableId } = req.body as { sourceTableId: number; targetTableId: number };
  if (!sourceTableId || !targetTableId || Number(sourceTableId) === Number(targetTableId)) {
    return void res.status(400).json({ error: "sourceTableId and targetTableId must be different valid IDs" });
  }

  const [srcTable] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, Number(sourceTableId)), eq(floorTablesTable.restaurantId, restaurantId)));
  const [tgtTable] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, Number(targetTableId)), eq(floorTablesTable.restaurantId, restaurantId)));
  if (!srcTable || !tgtTable) return void res.status(404).json({ error: "One or both tables not found" });
  if (srcTable.status !== "occupied") return void res.status(400).json({ error: "Source table must be occupied" });
  if (tgtTable.status !== "occupied") return void res.status(400).json({ error: "Target table must be occupied" });

  const activeStatuses = [eq(ordersTable.status, "pending"), eq(ordersTable.status, "preparing")];
  const [srcOrder] = await db.select().from(ordersTable).where(and(eq(ordersTable.tableId, Number(sourceTableId)), eq(ordersTable.restaurantId, restaurantId), or(...activeStatuses))).orderBy(ordersTable.createdAt);
  const [tgtOrder] = await db.select().from(ordersTable).where(and(eq(ordersTable.tableId, Number(targetTableId)), eq(ordersTable.restaurantId, restaurantId), or(...activeStatuses))).orderBy(ordersTable.createdAt);

  let cancelledTicketId: number | null = null;

  await db.transaction(async (tx) => {
    if (srcOrder && tgtOrder) {
      const srcItems = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, srcOrder.id));
      if (srcItems.length > 0) {
        await tx.update(orderItemsTable).set({ orderId: tgtOrder.id }).where(inArray(orderItemsTable.id, srcItems.map(i => i.id)));
      }
      const newTotal = (Number(tgtOrder.totalAmount) + Number(srcOrder.totalAmount)).toFixed(2);
      await tx.update(ordersTable).set({ totalAmount: newTotal, updatedAt: new Date() }).where(eq(ordersTable.id, tgtOrder.id));
      await tx.update(ordersTable).set({ status: "cancelled", tableId: null, updatedAt: new Date() }).where(eq(ordersTable.id, srcOrder.id));
      // Cancel the source kitchen ticket
      const [srcTicket] = await tx.update(kitchenTicketsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(kitchenTicketsTable.orderId, srcOrder.id), eq(kitchenTicketsTable.restaurantId, restaurantId)))
        .returning();
      if (srcTicket) cancelledTicketId = srcTicket.id;
    } else if (srcOrder && !tgtOrder) {
      await tx.update(ordersTable).set({ tableId: Number(targetTableId), updatedAt: new Date() }).where(eq(ordersTable.id, srcOrder.id));
      await tx.update(floorTablesTable).set({ status: "occupied", updatedAt: new Date() }).where(eq(floorTablesTable.id, Number(targetTableId)));
    }
    await tx.update(floorTablesTable).set({ status: "free", updatedAt: new Date() }).where(eq(floorTablesTable.id, Number(sourceTableId)));
  });

  const [updatedSrc] = await db.select().from(floorTablesTable).where(eq(floorTablesTable.id, Number(sourceTableId)));
  const [updatedTgt] = await db.select().from(floorTablesTable).where(eq(floorTablesTable.id, Number(targetTableId)));

  const { broadcastEvent } = await import("../lib/socketio");
  broadcastEvent(restaurantId, "tables:merged", { sourceTableId, targetTableId });
  if (cancelledTicketId !== null) {
    broadcastEvent(restaurantId, "ticket:status", { id: cancelledTicketId, status: "cancelled", orderId: srcOrder!.id });
  }

  res.json({ success: true, sourceTable: updatedSrc, targetTable: updatedTgt });
});

router.post("/restaurants/:restaurantId/orders/:orderId/split-to-table", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.orderId);
  const { targetTableId, itemIds } = req.body as { targetTableId: number; itemIds: number[] };

  if (!targetTableId || !Array.isArray(itemIds) || itemIds.length === 0) {
    return void res.status(400).json({ error: "targetTableId and at least one itemId are required" });
  }

  const [srcOrder] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!srcOrder) return void res.status(404).json({ error: "Source order not found" });

  const [tgtTable] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, Number(targetTableId)), eq(floorTablesTable.restaurantId, restaurantId)));
  if (!tgtTable) return void res.status(404).json({ error: "Target table not found" });

  const allSrcItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const toMove = allSrcItems.filter(i => (itemIds as number[]).includes(i.id));
  if (toMove.length === 0) return void res.status(400).json({ error: "None of the specified items belong to this order" });
  if (toMove.length === allSrcItems.length) return void res.status(400).json({ error: "Cannot move all items — use merge instead" });

  const movedTotal = toMove.reduce((s, i) => s + Number(i.unitPrice) * Number(i.quantity), 0);
  const newSrcTotal = Math.max(0, Number(srcOrder.totalAmount) - movedTotal).toFixed(2);

  const [existingTgtOrder] = await db.select().from(ordersTable).where(and(eq(ordersTable.tableId, Number(targetTableId)), eq(ordersTable.restaurantId, restaurantId), or(eq(ordersTable.status, "pending"), eq(ordersTable.status, "preparing"))));

  let targetOrderId: number;
  let newTicketId: number | null = null;

  await db.transaction(async (tx) => {
    if (existingTgtOrder) {
      targetOrderId = existingTgtOrder.id;
      await tx.update(ordersTable).set({ totalAmount: (Number(existingTgtOrder.totalAmount) + movedTotal).toFixed(2), updatedAt: new Date() }).where(eq(ordersTable.id, existingTgtOrder.id));
    } else {
      const splitOrderNumber = `SPL-${Date.now().toString(36).toUpperCase()}`;
      const [newOrder] = await tx.insert(ordersTable).values({
        restaurantId,
        tableId: Number(targetTableId),
        orderNumber: splitOrderNumber,
        orderType: srcOrder.orderType,
        status: "pending",
        paymentStatus: "unpaid",
        totalAmount: movedTotal.toFixed(2),
      }).returning();
      targetOrderId = newOrder.id;
      await tx.update(floorTablesTable).set({ status: "occupied", updatedAt: new Date() }).where(eq(floorTablesTable.id, Number(targetTableId)));
      // Create kitchen ticket for the new split order
      const [newTicket] = await tx.insert(kitchenTicketsTable).values({ orderId: targetOrderId, restaurantId, isPriority: false }).returning();
      newTicketId = newTicket.id;
    }
    await tx.update(orderItemsTable).set({ orderId: targetOrderId! }).where(inArray(orderItemsTable.id, toMove.map(i => i.id)));
    await tx.update(ordersTable).set({ totalAmount: newSrcTotal, updatedAt: new Date() }).where(eq(ordersTable.id, orderId));
  });

  const { broadcastEvent } = await import("../lib/socketio");
  broadcastEvent(restaurantId, "order:split", { sourceOrderId: orderId, targetOrderId: targetOrderId!, targetTableId, itemCount: toMove.length });
  if (newTicketId !== null) {
    broadcastEvent(restaurantId, "order:new", { id: targetOrderId!, restaurantId, tableId: Number(targetTableId), orderNumber: `SPL-ticket` });
  }

  res.json({ success: true, sourceOrderId: orderId, targetOrderId: targetOrderId!, itemsMoved: toMove.length });
});

router.get("/restaurants/:restaurantId/reservations", async (req, res) => {
  const { status } = req.query;
  const conditions: ReturnType<typeof eq>[] = [eq(reservationsTable.restaurantId, Number(req.params.restaurantId))];
  if (status) conditions.push(eq(reservationsTable.status, String(status)));
  const rows = await db.select().from(reservationsTable).where(and(...conditions));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/reservations", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const { guestName, guestPhone, guestEmail, tableId, partySize, scheduledAt, notes } = req.body;
  const [reservation] = await db.insert(reservationsTable).values({ restaurantId: Number(req.params.restaurantId), guestName, guestPhone, guestEmail, tableId, partySize, scheduledAt: new Date(scheduledAt), notes }).returning();
  res.status(201).json(reservation);
});

router.patch("/restaurants/:restaurantId/reservations/:id", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const { guestName, guestPhone, tableId, partySize, scheduledAt, status, notes } = req.body;
  const updates: Record<string, unknown> = { guestName, guestPhone, tableId, partySize, status, notes, updatedAt: new Date() };
  if (scheduledAt) updates.scheduledAt = new Date(scheduledAt);
  const [updated] = await db.update(reservationsTable).set(updates).where(and(eq(reservationsTable.id, Number(req.params.id)), eq(reservationsTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/reservations/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.delete(reservationsTable).where(eq(reservationsTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
