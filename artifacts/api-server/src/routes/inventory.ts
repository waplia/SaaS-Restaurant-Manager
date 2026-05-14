import { Router } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db, inventoryItemsTable, suppliersTable, inventoryTransactionsTable, purchaseOrdersTable, recipeMappingsTable, notificationsTable, paymentsTable, menuItemsTable, menuCategoriesTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "kitchen", "super_admin"), validateRestaurantAccess);

router.get("/restaurants/:restaurantId/inventory", async (req, res) => {
  const { lowStock, search } = req.query;
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.restaurantId, restaurantId), eq(inventoryItemsTable.isActive, true)));

  let result = rows.map(item => ({
    ...item,
    isLowStock: Number(item.currentStock) <= Number(item.minStockLevel),
  }));

  if (lowStock === "true") result = result.filter(i => i.isLowStock);
  if (search) result = result.filter(i => i.name.toLowerCase().includes(String(search).toLowerCase()));

  res.json(result);
});

router.post("/restaurants/:restaurantId/inventory", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, unit, currentStock, minStockLevel, costPerUnit, category, supplierId } = req.body;
  const [item] = await db.insert(inventoryItemsTable).values({ restaurantId: Number(req.params.restaurantId), name, unit, currentStock, minStockLevel, costPerUnit, category, supplierId: supplierId ?? null }).returning();
  res.status(201).json({ ...item, isLowStock: Number(item.currentStock) <= Number(item.minStockLevel) });
});

router.patch("/restaurants/:restaurantId/inventory/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, unit, minStockLevel, costPerUnit, category, supplierId, isActive } = req.body;
  const [updated] = await db.update(inventoryItemsTable).set({ name, unit, minStockLevel, costPerUnit, category, supplierId, isActive, updatedAt: new Date() }).where(and(eq(inventoryItemsTable.id, Number(req.params.id)), eq(inventoryItemsTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json({ ...updated, isLowStock: Number(updated.currentStock) <= Number(updated.minStockLevel) });
});

router.delete("/restaurants/:restaurantId/inventory/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.update(inventoryItemsTable).set({ isActive: false }).where(and(eq(inventoryItemsTable.id, Number(req.params.id)), eq(inventoryItemsTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

async function triggerLowStockNotification(item: { id: number; name: string; currentStock: string; minStockLevel: string; unit: string }, restaurantId: number) {
  if (Number(item.currentStock) <= Number(item.minStockLevel)) {
    await db.insert(notificationsTable).values({
      restaurantId,
      type: "low_stock",
      title: "Low Stock Alert",
      message: `${item.name} is running low (${Number(item.currentStock).toFixed(1)} ${item.unit} remaining, min: ${Number(item.minStockLevel).toFixed(1)} ${item.unit})`,
      entityId: item.id,
      entityType: "inventory_item",
    });
    const { broadcastEvent } = await import("../lib/socketio");
    broadcastEvent(restaurantId, "notification:new", { type: "low_stock" });
    const { sendEmail, lowStockEmail } = await import("../lib/notifications");
    const { restaurantsTable, usersTable } = await import("../lib/db");
    const { eq, and } = await import("drizzle-orm");
    const [restaurant] = await db.select({ name: restaurantsTable.name }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
    const owners = await db.select({ email: usersTable.email }).from(usersTable).where(and(eq(usersTable.restaurantId, restaurantId), eq(usersTable.role, "owner"), eq(usersTable.isActive, true)));
    const tpl = lowStockEmail({
      restaurantName: restaurant?.name ?? "Restaurant",
      items: [{ name: item.name, quantity: Number(item.currentStock), unit: item.unit, threshold: Number(item.minStockLevel) }],
    });
    for (const owner of owners) {
      if (owner.email) sendEmail({ to: owner.email, subject: tpl.subject, html: tpl.html, text: tpl.text }).catch(console.error);
    }
  }
}

router.post("/restaurants/:restaurantId/inventory/:id/adjust", requireRole("owner", "manager", "kitchen", "super_admin"), async (req, res) => {
  const { type, quantity, notes } = req.body;
  const id = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);

  const [item] = await db.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.restaurantId, restaurantId)));
  if (!item) return void res.status(404).json({ error: "Not found" });

  let newStock = Number(item.currentStock);
  if (type === "add" || type === "receive") newStock += Number(quantity);
  else if (type === "remove" || type === "use" || type === "waste") newStock -= Number(quantity);
  else newStock = Number(quantity);

  const finalStock = Math.max(0, newStock);
  const [updated] = await db.update(inventoryItemsTable).set({ currentStock: finalStock.toFixed(3), updatedAt: new Date() }).where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.restaurantId, restaurantId))).returning();
  await db.insert(inventoryTransactionsTable).values({ itemId: id, restaurantId, type, quantity, notes });

  await triggerLowStockNotification({ ...updated!, currentStock: finalStock.toFixed(3) }, restaurantId);

  res.json({ ...updated!, isLowStock: finalStock <= Number(updated!.minStockLevel) });
});

router.get("/restaurants/:restaurantId/inventory/:id/transactions", async (req, res) => {
  const rows = await db.select().from(inventoryTransactionsTable)
    .where(and(eq(inventoryTransactionsTable.itemId, Number(req.params.id)), eq(inventoryTransactionsTable.restaurantId, Number(req.params.restaurantId))))
    .orderBy(desc(inventoryTransactionsTable.createdAt)).limit(50);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/inventory/waste-log", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const wasteTxs = await db.select().from(inventoryTransactionsTable)
    .where(and(
      eq(inventoryTransactionsTable.restaurantId, restaurantId),
      inArray(inventoryTransactionsTable.type, ["waste", "remove"]),
    ))
    .orderBy(desc(inventoryTransactionsTable.createdAt)).limit(100);

  if (wasteTxs.length === 0) return void res.json([]);

  const itemIds = [...new Set(wasteTxs.map(t => t.itemId))];
  const items = await db.select({ id: inventoryItemsTable.id, name: inventoryItemsTable.name, unit: inventoryItemsTable.unit })
    .from(inventoryItemsTable).where(inArray(inventoryItemsTable.id, itemIds));
  const itemMap = new Map(items.map(i => [i.id, i]));

  res.json(wasteTxs.map(tx => ({ ...tx, itemName: itemMap.get(tx.itemId)?.name ?? "Unknown", unit: itemMap.get(tx.itemId)?.unit ?? "" })));
});

router.get("/restaurants/:restaurantId/purchase-orders", async (req, res) => {
  const rows = await db.select().from(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.restaurantId, Number(req.params.restaurantId)))
    .orderBy(desc(purchaseOrdersTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/purchase-orders", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { supplierId, totalAmount, notes } = req.body;
  const [po] = await db.insert(purchaseOrdersTable).values({
    restaurantId: Number(req.params.restaurantId),
    supplierId: supplierId || null,
    totalAmount: totalAmount || "0.00",
    notes,
    status: "pending",
    orderedAt: new Date(),
  }).returning();
  res.status(201).json(po);
});

router.patch("/restaurants/:restaurantId/purchase-orders/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { status, notes, totalAmount, paymentMethod } = req.body as {
    status?: string; notes?: string; totalAmount?: string; paymentMethod?: string;
  };
  const restaurantId = Number(req.params.restaurantId);
  const poId = Number(req.params.id);
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status) updates.status = status;
  if (notes !== undefined) updates.notes = notes;
  if (totalAmount !== undefined) updates.totalAmount = totalAmount;
  if (status === "received") updates.receivedAt = new Date();

  let updated: typeof purchaseOrdersTable.$inferSelect | undefined;
  try {
    updated = await db.transaction(async tx => {
      const [existing] = await tx.select().from(purchaseOrdersTable)
        .where(and(eq(purchaseOrdersTable.id, poId), eq(purchaseOrdersTable.restaurantId, restaurantId)));
      if (!existing) throw new Error("NOT_FOUND");

      const [u] = await tx.update(purchaseOrdersTable).set(updates)
        .where(and(eq(purchaseOrdersTable.id, poId), eq(purchaseOrdersTable.restaurantId, restaurantId))).returning();
      if (!u) throw new Error("NOT_FOUND");

      if (status === "received" && existing.status !== "received") {
        const total = Number(u.totalAmount);
        const alreadyPaid = Number(u.paidAmount);
        const due = Math.max(0, total - alreadyPaid);
        if (due > 0.01) {
          const method = ["cash", "card", "upi", "stripe", "razorpay", "bank", "other"].includes(String(paymentMethod))
            ? String(paymentMethod) : "cash";
          await tx.insert(paymentsTable).values({
            restaurantId,
            direction: "out",
            method,
            amount: due.toFixed(2),
            paymentDate: new Date(),
            partyType: u.supplierId ? "supplier" : "other",
            partyId: u.supplierId ?? null,
            partyName: null,
            referenceType: "purchase_order",
            referenceId: u.id,
            notes: "Auto-recorded on PO received",
            recordedBy: req.user?.sub ?? null,
          });
          const [reUpdated] = await tx.update(purchaseOrdersTable)
            .set({ paidAmount: total.toFixed(2) })
            .where(eq(purchaseOrdersTable.id, poId))
            .returning();
          return reUpdated ?? u;
        }
      }
      return u;
    });
  } catch (err) {
    if ((err as Error).message === "NOT_FOUND") return void res.status(404).json({ error: "Not found" });
    console.error("[PO] Transaction failed:", err);
    return void res.status(500).json({ error: "Failed to update purchase order" });
  }

  res.json(updated);
});

router.delete("/restaurants/:restaurantId/purchase-orders/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.delete(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.id, Number(req.params.id)), eq(purchaseOrdersTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/suppliers", async (req, res) => {
  const rows = await db.select().from(suppliersTable).where(eq(suppliersTable.restaurantId, Number(req.params.restaurantId)));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/suppliers", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, contactPerson, phone, email, address } = req.body;
  const [supplier] = await db.insert(suppliersTable).values({ restaurantId: Number(req.params.restaurantId), name, contactPerson, phone, email, address }).returning();
  res.status(201).json(supplier);
});

router.patch("/restaurants/:restaurantId/suppliers/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, contactPerson, phone, email, address, isActive } = req.body;
  const [updated] = await db.update(suppliersTable).set({ name, contactPerson, phone, email, address, isActive, updatedAt: new Date() }).where(and(eq(suppliersTable.id, Number(req.params.id)), eq(suppliersTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/suppliers/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.update(suppliersTable).set({ isActive: false }).where(and(eq(suppliersTable.id, Number(req.params.id)), eq(suppliersTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/recipe-mappings", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { menuItemId, inventoryItemId } = req.query;
  const conditions = [eq(recipeMappingsTable.restaurantId, restaurantId)];
  if (menuItemId) conditions.push(eq(recipeMappingsTable.menuItemId, Number(menuItemId)));
  if (inventoryItemId) conditions.push(eq(recipeMappingsTable.inventoryItemId, Number(inventoryItemId)));
  const rows = await db.select({
    id: recipeMappingsTable.id,
    restaurantId: recipeMappingsTable.restaurantId,
    menuItemId: recipeMappingsTable.menuItemId,
    inventoryItemId: recipeMappingsTable.inventoryItemId,
    quantity: recipeMappingsTable.quantity,
    unit: recipeMappingsTable.unit,
    createdAt: recipeMappingsTable.createdAt,
    inventoryItemName: inventoryItemsTable.name,
    inventoryUnit: inventoryItemsTable.unit,
    costPerUnit: inventoryItemsTable.costPerUnit,
  }).from(recipeMappingsTable)
    .leftJoin(inventoryItemsTable, eq(recipeMappingsTable.inventoryItemId, inventoryItemsTable.id))
    .where(and(...conditions));
  res.json(rows);
});

router.patch("/restaurants/:restaurantId/recipe-mappings/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { quantity, unit } = req.body as { quantity?: string | number; unit?: string };
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (quantity !== undefined) updates.quantity = String(quantity);
  if (unit !== undefined) updates.unit = unit;
  const [updated] = await db.update(recipeMappingsTable).set(updates)
    .where(and(eq(recipeMappingsTable.id, Number(req.params.id)), eq(recipeMappingsTable.restaurantId, Number(req.params.restaurantId))))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.get("/restaurants/:restaurantId/food-cost", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rawThreshold = Number(req.query.threshold ?? 65);
  const threshold = Number.isFinite(rawThreshold) ? Math.max(1, Math.min(100, rawThreshold)) : 65;

  const items = await db.select({
    id: menuItemsTable.id,
    name: menuItemsTable.name,
    price: menuItemsTable.price,
    categoryId: menuItemsTable.categoryId,
    categoryName: menuCategoriesTable.name,
  }).from(menuItemsTable)
    .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
    .where(eq(menuItemsTable.restaurantId, restaurantId));

  const mappings = await db.select({
    menuItemId: recipeMappingsTable.menuItemId,
    quantity: recipeMappingsTable.quantity,
    inventoryItemId: recipeMappingsTable.inventoryItemId,
    inventoryName: inventoryItemsTable.name,
    inventoryUnit: inventoryItemsTable.unit,
    costPerUnit: inventoryItemsTable.costPerUnit,
  }).from(recipeMappingsTable)
    .leftJoin(inventoryItemsTable, eq(recipeMappingsTable.inventoryItemId, inventoryItemsTable.id))
    .where(eq(recipeMappingsTable.restaurantId, restaurantId));

  const byItem = new Map<number, typeof mappings>();
  for (const m of mappings) {
    const arr = byItem.get(m.menuItemId) ?? [];
    arr.push(m);
    byItem.set(m.menuItemId, arr);
  }

  const result = items.map(item => {
    const recipe = byItem.get(item.id) ?? [];
    const cogs = recipe.reduce((s, r) => s + Number(r.quantity) * Number(r.costPerUnit ?? 0), 0);
    const price = Number(item.price);
    const margin = price > 0 ? ((price - cogs) / price) * 100 : 0;
    const foodCostPct = price > 0 ? (cogs / price) * 100 : 0;
    return {
      id: item.id,
      name: item.name,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      price: price.toFixed(2),
      cogs: cogs.toFixed(2),
      margin: Number(margin.toFixed(2)),
      foodCostPct: Number(foodCostPct.toFixed(2)),
      hasRecipe: recipe.length > 0,
      ingredientCount: recipe.length,
      isLowMargin: recipe.length > 0 && foodCostPct >= threshold,
    };
  });

  res.json({ threshold, items: result });
});

router.post("/restaurants/:restaurantId/recipe-mappings", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { menuItemId, inventoryItemId, quantity, unit } = req.body;
  const [mapping] = await db.insert(recipeMappingsTable).values({
    restaurantId: Number(req.params.restaurantId),
    menuItemId: Number(menuItemId),
    inventoryItemId: Number(inventoryItemId),
    quantity: String(quantity),
    unit: unit ?? "kg",
  }).returning();
  res.status(201).json(mapping);
});

router.delete("/restaurants/:restaurantId/recipe-mappings/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.delete(recipeMappingsTable).where(and(eq(recipeMappingsTable.id, Number(req.params.id)), eq(recipeMappingsTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

export { triggerLowStockNotification };
export default router;
