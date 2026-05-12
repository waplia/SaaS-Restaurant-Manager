import { Router } from "express";
import { eq, and, desc, count } from "drizzle-orm";
import { db, ordersTable, orderItemsTable, orderItemModifiersTable, kitchenTicketsTable, menuItemsTable, floorTablesTable, restaurantsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { broadcastEvent } from "../lib/socketio";

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), validateRestaurantAccess);

function generateOrderNumber(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}`;
}

async function getRestaurantRates(restaurantId: number) {
  const [row] = await db
    .select({ taxRate: restaurantsTable.taxRate, serviceCharge: restaurantsTable.serviceCharge })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  return {
    taxRate: Number(row?.taxRate ?? 5) / 100,
    serviceRate: Number(row?.serviceCharge ?? 0) / 100,
  };
}

async function recalculateOrderTotals(orderId: number, restaurantId: number, discountAmount: number) {
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const subtotal = items.reduce((s, i) => s + Number(i.totalPrice), 0);
  const { taxRate, serviceRate } = await getRestaurantRates(restaurantId);
  const taxAmount = subtotal * taxRate;
  const serviceCharge = subtotal * serviceRate;
  const totalAmount = Math.max(0, subtotal + taxAmount + serviceCharge - discountAmount);
  await db.update(ordersTable).set({
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    serviceCharge: serviceCharge.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    updatedAt: new Date(),
  }).where(eq(ordersTable.id, orderId));
  return { subtotal, taxAmount, serviceCharge, totalAmount };
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
  const { tableId, orderType, notes, customerName, customerPhone, isPriority, items, discountAmount } = req.body;

  let subtotal = 0;
  const enrichedItems: Array<{ menuItem: typeof menuItemsTable.$inferSelect; qty: number; notes?: string; modifiers?: Array<{ name: string; price: string }> }> = [];

  for (const item of items as Array<{ menuItemId: number; quantity: number; notes?: string; modifiers?: Array<{ name: string; price: string }> }>) {
    const [mi] = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.id, item.menuItemId), eq(menuItemsTable.restaurantId, restaurantId)));
    if (!mi) continue;
    const modTotal = (item.modifiers ?? []).reduce((s, m) => s + Number(m.price), 0);
    subtotal += (Number(mi.price) + modTotal) * item.quantity;
    enrichedItems.push({ menuItem: mi, qty: item.quantity, notes: item.notes, modifiers: item.modifiers });
  }

  const { taxRate, serviceRate } = await getRestaurantRates(restaurantId);
  const taxAmount = subtotal * taxRate;
  const serviceCharge = subtotal * serviceRate;
  const discountAmt = Number(discountAmount ?? 0);
  const totalAmount = Math.max(0, subtotal + taxAmount + serviceCharge - discountAmt);

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
    discountAmount: discountAmt.toFixed(2),
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
    await db.update(floorTablesTable).set({ status: "occupied" }).where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId)));
  }

  broadcastEvent(restaurantId, "order:new", order);

  res.status(201).json(order);
});

router.get("/restaurants/:restaurantId/orders/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, Number(req.params.id)), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Not found" });
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  res.json({ ...order, items });
});

router.patch("/restaurants/:restaurantId/orders/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status, notes, isPriority, customerName, discountAmount } = req.body;
  const updates: Record<string, unknown> = { notes, isPriority, customerName, discountAmount, updatedAt: new Date() };
  if (status) updates.status = status;
  const [updated] = await db.update(ordersTable).set(updates).where(and(eq(ordersTable.id, Number(req.params.id)), eq(ordersTable.restaurantId, restaurantId))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });

  broadcastEvent(restaurantId, "order:status", { id: updated.id, status: updated.status, orderNumber: updated.orderNumber });

  res.json(updated);
});

router.post("/restaurants/:restaurantId/orders/:id/items", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const { menuItemId, quantity, notes } = req.body;

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Cannot modify a completed or cancelled order" });
  }

  const [mi] = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.id, menuItemId), eq(menuItemsTable.restaurantId, restaurantId)));
  if (!mi) return void res.status(404).json({ error: "Menu item not found" });

  const unitPrice = Number(mi.price);
  const qty = Number(quantity) || 1;

  const existingItems = await db.select().from(orderItemsTable).where(and(eq(orderItemsTable.orderId, orderId), eq(orderItemsTable.menuItemId, menuItemId)));

  if (existingItems.length > 0) {
    const existing = existingItems[0];
    const newQty = existing.quantity + qty;
    await db.update(orderItemsTable).set({
      quantity: newQty,
      totalPrice: (unitPrice * newQty).toFixed(2),
    }).where(eq(orderItemsTable.id, existing.id));
  } else {
    await db.insert(orderItemsTable).values({
      orderId,
      menuItemId: mi.id,
      menuItemName: mi.name,
      quantity: qty,
      unitPrice: unitPrice.toFixed(2),
      totalPrice: (unitPrice * qty).toFixed(2),
      notes,
    });
  }

  const totals = await recalculateOrderTotals(orderId, restaurantId, Number(order.discountAmount ?? 0));
  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));

  broadcastEvent(restaurantId, "order:updated", { id: orderId, ...totals });

  res.json({ ...updatedOrder, items });
});

router.delete("/restaurants/:restaurantId/orders/:id/items/:itemId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Cannot modify a completed or cancelled order" });
  }

  await db.delete(orderItemModifiersTable).where(eq(orderItemModifiersTable.orderItemId, itemId));
  await db.delete(orderItemsTable).where(and(eq(orderItemsTable.id, itemId), eq(orderItemsTable.orderId, orderId)));

  const totals = await recalculateOrderTotals(orderId, restaurantId, Number(order.discountAmount ?? 0));
  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));

  broadcastEvent(restaurantId, "order:updated", { id: orderId, ...totals });

  res.json({ ...updatedOrder, items });
});

router.post("/restaurants/:restaurantId/orders/:id/discount", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const { discountAmount } = req.body;

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });

  const discount = Math.max(0, Number(discountAmount ?? 0));
  await db.update(ordersTable).set({ discountAmount: discount.toFixed(2), updatedAt: new Date() }).where(eq(ordersTable.id, orderId));

  await recalculateOrderTotals(orderId, restaurantId, discount);
  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));

  res.json({ ...updatedOrder, items });
});

router.post("/restaurants/:restaurantId/orders/:id/split", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const { splits } = req.body;

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Order is already completed or cancelled" });
  }

  const splitMethods = (splits as Array<{ paymentMethod: string }>).map(s => s.paymentMethod).join(",");
  const [updated] = await db.update(ordersTable).set({
    paymentMethod: `split:${splitMethods}`,
    paymentStatus: "paid",
    status: "completed",
    updatedAt: new Date(),
  }).where(eq(ordersTable.id, orderId)).returning();

  if (order.tableId) {
    await db.update(floorTablesTable).set({ status: "free" }).where(and(eq(floorTablesTable.id, order.tableId), eq(floorTablesTable.restaurantId, restaurantId)));
  }

  broadcastEvent(restaurantId, "order:status", { id: orderId, status: "completed", paymentStatus: "paid", orderNumber: order.orderNumber });

  res.json(updated);
});

router.post("/restaurants/:restaurantId/orders/:id/void", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed") return void res.status(400).json({ error: "Cannot void a completed order" });

  const [updated] = await db.update(ordersTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(ordersTable.id, orderId)).returning();

  if (order.tableId) {
    await db.update(floorTablesTable).set({ status: "free" }).where(and(eq(floorTablesTable.id, order.tableId), eq(floorTablesTable.restaurantId, restaurantId)));
  }

  broadcastEvent(restaurantId, "order:status", { id: orderId, status: "cancelled", orderNumber: order.orderNumber });

  res.json(updated);
});

router.post("/restaurants/:restaurantId/orders/:id/pay", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { paymentMethod } = req.body;
  const [updated] = await db.update(ordersTable).set({ paymentMethod, paymentStatus: "paid", status: "completed", updatedAt: new Date() }).where(and(eq(ordersTable.id, Number(req.params.id)), eq(ordersTable.restaurantId, restaurantId))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  if (updated.tableId) {
    await db.update(floorTablesTable).set({ status: "free" }).where(and(eq(floorTablesTable.id, updated.tableId), eq(floorTablesTable.restaurantId, restaurantId)));
  }

  broadcastEvent(restaurantId, "order:status", { id: updated.id, status: "completed", paymentStatus: "paid", orderNumber: updated.orderNumber });

  res.json(updated);
});

router.get("/restaurants/:restaurantId/kitchen/tickets", async (req, res) => {
  const { status } = req.query;
  const restaurantId = Number(req.params.restaurantId);
  const conditions: ReturnType<typeof eq>[] = [eq(kitchenTicketsTable.restaurantId, restaurantId)];
  if (status) conditions.push(eq(kitchenTicketsTable.status, String(status)));

  const tickets = await db.select().from(kitchenTicketsTable).where(and(...conditions)).orderBy(desc(kitchenTicketsTable.isPriority), kitchenTicketsTable.createdAt);

  const enriched = await Promise.all(tickets.map(async (t) => {
    const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, t.orderId), eq(ordersTable.restaurantId, restaurantId)));
    const items = order ? await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id)) : [];
    let tableNumber: string | null = null;
    if (order?.tableId) {
      const [tbl] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, order.tableId), eq(floorTablesTable.restaurantId, restaurantId)));
      tableNumber = tbl?.tableNumber ?? null;
    }
    return { ...t, orderNumber: order?.orderNumber ?? "", tableNumber, orderType: order?.orderType ?? "dine_in", items };
  }));

  res.json(enriched);
});

router.patch("/restaurants/:restaurantId/kitchen/tickets/:id/status", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status } = req.body;
  const updates: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "preparing") updates.startedAt = new Date();
  if (status === "ready" || status === "served") updates.completedAt = new Date();
  const [updated] = await db.update(kitchenTicketsTable).set(updates).where(and(eq(kitchenTicketsTable.id, Number(req.params.id)), eq(kitchenTicketsTable.restaurantId, restaurantId))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });

  broadcastEvent(restaurantId, "ticket:status", { id: updated.id, status: updated.status, orderId: updated.orderId });

  res.json(updated);
});

export default router;
