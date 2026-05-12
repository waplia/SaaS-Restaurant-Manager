import { Router } from "express";
import { eq, and, desc, count } from "drizzle-orm";
import { db, ordersTable, orderItemsTable, orderItemModifiersTable, kitchenTicketsTable, menuItemsTable, floorTablesTable, restaurantsTable } from "../lib/db";

const router = Router();

function generateOrderNumber(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}`;
}

router.get("/restaurants/:restaurantId/orders", async (req, res) => {
  const { status, tableId, page, limit } = req.query;
  const pg = Number(page) || 1;
  const lim = Number(limit) || 50;
  const offset = (pg - 1) * lim;
  const restaurantId = Number(req.params.restaurantId);

  const conditions: ReturnType<typeof eq>[] = [eq(ordersTable.restaurantId, restaurantId)];
  if (status) conditions.push(eq(ordersTable.status, String(status)));
  if (tableId) conditions.push(eq(ordersTable.tableId, Number(tableId)));

  const [rows, totalRows] = await Promise.all([
    db.select().from(ordersTable).where(and(...conditions)).orderBy(desc(ordersTable.createdAt)).limit(lim).offset(offset),
    db.select({ count: count() }).from(ordersTable).where(and(...conditions)),
  ]);
  res.json({ data: rows, total: totalRows[0]?.count ?? 0 });
});

router.post("/restaurants/:restaurantId/orders", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { tableId, orderType, notes, customerName, customerPhone, isPriority, items } = req.body;

  let subtotal = 0;
  const enrichedItems: Array<{ menuItem: typeof menuItemsTable.$inferSelect; qty: number; notes?: string; modifiers?: Array<{ name: string; price: string }> }> = [];

  for (const item of items as Array<{ menuItemId: number; quantity: number; notes?: string; modifiers?: Array<{ name: string; price: string }> }>) {
    const [mi] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, item.menuItemId));
    if (!mi) continue;
    const modTotal = (item.modifiers ?? []).reduce((s, m) => s + Number(m.price), 0);
    subtotal += (Number(mi.price) + modTotal) * item.quantity;
    enrichedItems.push({ menuItem: mi, qty: item.quantity, notes: item.notes, modifiers: item.modifiers });
  }

  const [restaurantRow] = await db
    .select({ taxRate: restaurantsTable.taxRate, serviceCharge: restaurantsTable.serviceCharge })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  const taxRate = Number(restaurantRow?.taxRate ?? 5) / 100;
  const serviceRate = Number(restaurantRow?.serviceCharge ?? 0) / 100;
  const taxAmount = subtotal * taxRate;
  const serviceCharge = subtotal * serviceRate;
  const totalAmount = subtotal + taxAmount + serviceCharge;

  const [order] = await db.insert(ordersTable).values({
    restaurantId,
    tableId,
    orderNumber: generateOrderNumber(),
    orderType: orderType ?? "dine_in",
    notes,
    customerName,
    customerPhone,
    isPriority: isPriority ?? false,
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    serviceCharge: serviceCharge.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
  }).returning();

  for (const ei of enrichedItems) {
    const modTotal = (ei.modifiers ?? []).reduce((s, m) => s + Number(m.price), 0);
    const unitPrice = Number(ei.menuItem.price) + modTotal;
    const [oi] = await db.insert(orderItemsTable).values({
      orderId: order.id,
      menuItemId: ei.menuItem.id,
      menuItemName: ei.menuItem.name,
      quantity: ei.qty,
      unitPrice: unitPrice.toFixed(2),
      totalPrice: (unitPrice * ei.qty).toFixed(2),
      notes: ei.notes,
    }).returning();

    for (const mod of ei.modifiers ?? []) {
      await db.insert(orderItemModifiersTable).values({ orderItemId: oi.id, modifierName: mod.name, price: mod.price });
    }
  }

  await db.insert(kitchenTicketsTable).values({ orderId: order.id, restaurantId, isPriority: isPriority ?? false });

  if (tableId) {
    await db.update(floorTablesTable).set({ status: "occupied" }).where(eq(floorTablesTable.id, tableId));
  }

  res.status(201).json(order);
});

router.get("/restaurants/:restaurantId/orders/:id", async (req, res) => {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, Number(req.params.id)));
  if (!order) return void res.status(404).json({ error: "Not found" });
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  res.json({ ...order, items });
});

router.patch("/restaurants/:restaurantId/orders/:id", async (req, res) => {
  const { status, notes, isPriority, customerName, discountAmount } = req.body;
  const updates: Record<string, unknown> = { notes, isPriority, customerName, discountAmount, updatedAt: new Date() };
  if (status) updates.status = status;
  const [updated] = await db.update(ordersTable).set(updates).where(eq(ordersTable.id, Number(req.params.id))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/orders/:id/pay", async (req, res) => {
  const { paymentMethod } = req.body;
  const [updated] = await db.update(ordersTable).set({ paymentMethod, paymentStatus: "paid", status: "completed", updatedAt: new Date() }).where(eq(ordersTable.id, Number(req.params.id))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  if (updated.tableId) {
    await db.update(floorTablesTable).set({ status: "free" }).where(eq(floorTablesTable.id, updated.tableId));
  }
  res.json(updated);
});

router.get("/restaurants/:restaurantId/kitchen/tickets", async (req, res) => {
  const { status } = req.query;
  const restaurantId = Number(req.params.restaurantId);
  const conditions: ReturnType<typeof eq>[] = [eq(kitchenTicketsTable.restaurantId, restaurantId)];
  if (status) conditions.push(eq(kitchenTicketsTable.status, String(status)));

  const tickets = await db.select().from(kitchenTicketsTable).where(and(...conditions)).orderBy(desc(kitchenTicketsTable.isPriority), kitchenTicketsTable.createdAt);

  const enriched = await Promise.all(tickets.map(async (t) => {
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, t.orderId));
    const items = order ? await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id)) : [];
    let tableNumber: string | null = null;
    if (order?.tableId) {
      const [tbl] = await db.select().from(floorTablesTable).where(eq(floorTablesTable.id, order.tableId));
      tableNumber = tbl?.tableNumber ?? null;
    }
    return { ...t, orderNumber: order?.orderNumber ?? "", tableNumber, orderType: order?.orderType ?? "dine_in", items };
  }));

  res.json(enriched);
});

router.patch("/restaurants/:restaurantId/kitchen/tickets/:id/status", async (req, res) => {
  const { status } = req.body;
  const updates: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "preparing") updates.startedAt = new Date();
  if (status === "ready" || status === "served") updates.completedAt = new Date();
  const [updated] = await db.update(kitchenTicketsTable).set(updates).where(eq(kitchenTicketsTable.id, Number(req.params.id))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

export default router;
