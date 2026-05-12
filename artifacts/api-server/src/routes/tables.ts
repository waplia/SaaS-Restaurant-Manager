import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, floorTablesTable, reservationsTable, subscriptionPlansTable, tenantsTable, restaurantsTable } from "../lib/db";
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
  if (!sourceTableId || !targetTableId || sourceTableId === targetTableId) {
    return void res.status(400).json({ error: "sourceTableId and targetTableId must be different" });
  }
  const [srcTable] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, sourceTableId), eq(floorTablesTable.restaurantId, restaurantId)));
  const [tgtTable] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, targetTableId), eq(floorTablesTable.restaurantId, restaurantId)));
  if (!srcTable || !tgtTable) return void res.status(404).json({ error: "Table not found" });

  const { ordersTable, orderItemsTable } = await import("../lib/db");
  const { eq: eqI, and: andI, or, inArray } = await import("drizzle-orm");

  const [srcOrder] = await db.select().from(ordersTable).where(andI(eqI(ordersTable.tableId, sourceTableId), eqI(ordersTable.restaurantId, restaurantId), or(eqI(ordersTable.status, "pending"), eqI(ordersTable.status, "preparing")))).orderBy(ordersTable.createdAt);
  const [tgtOrder] = await db.select().from(ordersTable).where(andI(eqI(ordersTable.tableId, targetTableId), eqI(ordersTable.restaurantId, restaurantId), or(eqI(ordersTable.status, "pending"), eqI(ordersTable.status, "preparing")))).orderBy(ordersTable.createdAt);

  if (srcOrder && tgtOrder) {
    const srcItems = await db.select().from(orderItemsTable).where(eqI(orderItemsTable.orderId, srcOrder.id));
    if (srcItems.length > 0) {
      await db.update(orderItemsTable).set({ orderId: tgtOrder.id }).where(inArray(orderItemsTable.id, srcItems.map(i => i.id)));
    }
    const newTotal = Number(tgtOrder.totalAmount) + Number(srcOrder.totalAmount);
    await db.update(ordersTable).set({ totalAmount: newTotal.toFixed(2), updatedAt: new Date() }).where(eqI(ordersTable.id, tgtOrder.id));
    await db.update(ordersTable).set({ status: "cancelled", tableId: null, updatedAt: new Date() }).where(eqI(ordersTable.id, srcOrder.id));
  }

  await db.update(floorTablesTable).set({ status: "free", updatedAt: new Date() }).where(eqI(floorTablesTable.id, sourceTableId));
  const [updatedSrc] = await db.select().from(floorTablesTable).where(eqI(floorTablesTable.id, sourceTableId));
  const [updatedTgt] = await db.select().from(floorTablesTable).where(eqI(floorTablesTable.id, targetTableId));

  const { broadcastEvent } = await import("../lib/socketio");
  broadcastEvent(restaurantId, "tables:merged", { sourceTableId, targetTableId, sourceOrder: srcOrder?.id, targetOrder: tgtOrder?.id });

  res.json({ success: true, sourceTable: updatedSrc, targetTable: updatedTgt });
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
