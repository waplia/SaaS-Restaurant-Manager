import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, restaurantsTable, menusTable, menuCategoriesTable, menuItemsTable, ordersTable, orderItemsTable, floorTablesTable, notificationsTable } from "../lib/db";

const router = Router();

function generateOrderNumber(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}`;
}

router.get("/public/menu/:slug", async (req, res) => {
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.slug, req.params.slug));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  const [menu] = await db.select().from(menusTable).where(and(eq(menusTable.restaurantId, restaurant.id), eq(menusTable.isActive, true)));
  if (!menu) return void res.json({ restaurantId: restaurant.id, restaurantName: restaurant.name, restaurantSlug: restaurant.slug, logoUrl: restaurant.logoUrl, currency: restaurant.currency, categories: [] });

  const categories = await db.select().from(menuCategoriesTable).where(and(eq(menuCategoriesTable.menuId, menu.id), eq(menuCategoriesTable.isActive, true)));
  const enriched = await Promise.all(categories.map(async (cat) => {
    const items = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.categoryId, cat.id), eq(menuItemsTable.isAvailable, true)));
    return { ...cat, items };
  }));

  res.json({ restaurantId: restaurant.id, restaurantName: restaurant.name, restaurantSlug: restaurant.slug, logoUrl: restaurant.logoUrl, currency: restaurant.currency, categories: enriched });
});

router.post("/public/orders", async (req, res) => {
  const { restaurantId, tableId, customerName, customerPhone, notes, items } = req.body;

  let subtotal = 0;
  const enrichedItems: Array<{ mi: typeof menuItemsTable.$inferSelect; qty: number; notes?: string; modifiers?: Array<{ name: string; price: string }> }> = [];

  for (const item of items as Array<{ menuItemId: number; quantity: number; notes?: string; modifiers?: Array<{ name: string; price: string }> }>) {
    const [mi] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, item.menuItemId));
    if (!mi) continue;
    const modTotal = (item.modifiers ?? []).reduce((s, m) => s + Number(m.price), 0);
    subtotal += (Number(mi.price) + modTotal) * item.quantity;
    enrichedItems.push({ mi, qty: item.quantity, notes: item.notes, modifiers: item.modifiers });
  }

  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  const taxRate = Number(restaurant?.taxRate ?? 5) / 100;
  const taxAmount = subtotal * taxRate;
  const totalAmount = subtotal + taxAmount;

  const [order] = await db.insert(ordersTable).values({ restaurantId, tableId, orderNumber: generateOrderNumber(), orderType: "dine_in", subtotal: subtotal.toFixed(2), taxAmount: taxAmount.toFixed(2), totalAmount: totalAmount.toFixed(2), customerName, customerPhone, notes }).returning();

  for (const ei of enrichedItems) {
    const modTotal = (ei.modifiers ?? []).reduce((s, m) => s + Number(m.price), 0);
    const unitPrice = Number(ei.mi.price) + modTotal;
    await db.insert(orderItemsTable).values({ orderId: order.id, menuItemId: ei.mi.id, menuItemName: ei.mi.name, quantity: ei.qty, unitPrice: unitPrice.toFixed(2), totalPrice: (unitPrice * ei.qty).toFixed(2), notes: ei.notes });
  }

  if (tableId) {
    await db.update(floorTablesTable).set({ status: "occupied" }).where(eq(floorTablesTable.id, tableId));
    await db.insert(notificationsTable).values({ restaurantId, type: "new_order", title: "New Order", message: `New order from table. Order: ${order.orderNumber}` });
  }

  res.status(201).json({ orderId: order.id, orderNumber: order.orderNumber, status: order.status, totalAmount: order.totalAmount });
});

router.get("/public/orders/:id", async (req, res) => {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, Number(req.params.id)));
  if (!order) return void res.status(404).json({ error: "Not found" });
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  res.json({ id: order.id, orderNumber: order.orderNumber, status: order.status, paymentStatus: order.paymentStatus, totalAmount: order.totalAmount, items, createdAt: order.createdAt });
});

router.post("/public/call-waiter", async (req, res) => {
  const { restaurantId, tableId, message } = req.body;
  const [table] = await db.select().from(floorTablesTable).where(eq(floorTablesTable.id, tableId));
  await db.insert(notificationsTable).values({ restaurantId, type: "waiter_call", title: "Waiter Called", message: message ?? `Table ${table?.tableNumber ?? tableId} is calling for a waiter` });
  res.json({ success: true, message: "Waiter has been notified" });
});

router.post("/public/feedback", async (req, res) => {
  const { orderId, rating, comment } = req.body;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (order) {
    await db.insert(notificationsTable).values({ restaurantId: order.restaurantId, type: "feedback", title: `${rating}/5 Rating`, message: comment ?? `Customer gave ${rating} stars for order ${order.orderNumber}` });
  }
  res.status(201).json({ success: true });
});

export default router;
