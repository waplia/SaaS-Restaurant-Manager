import { Router } from "express";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { db, inventoryItemsTable, suppliersTable, inventoryTransactionsTable, purchaseOrdersTable, purchaseOrderItemsTable, recipeMappingsTable, notificationsTable, paymentsTable, menuItemsTable, menuCategoriesTable, restaurantsTable, inventoryItemBatchesTable, ordersTable, orderItemsTable } from "../lib/db";
import { asc, gt, gte, lte } from "drizzle-orm";
import { classifyMenuItems, type MenuEngineeringInput } from "../lib/menuEngineering";
import { runAutoReorderForRestaurant } from "../lib/autoReorder";
import { requireRole } from "../middleware/authorize";
import { requirePlanFeature } from "../middleware/planFeature";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { triggerAutoPost } from "./accounting-books";

const router = Router();

const inventoryScopes = [
  "/restaurants/:restaurantId/inventory",
  "/restaurants/:restaurantId/purchase-orders",
  "/restaurants/:restaurantId/auto-reorder",
  "/restaurants/:restaurantId/suppliers",
  "/restaurants/:restaurantId/recipe-mappings",
  "/restaurants/:restaurantId/food-cost",
  "/restaurants/:restaurantId/menu-engineering",
];
router.use(inventoryScopes, requireRole("owner", "manager", "kitchen", "super_admin"), validateRestaurantAccess, requirePlanFeature("inventory_management"));

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

router.post("/restaurants/:restaurantId/inventory", requireRole("owner", "manager", "super_admin"), requirePlanFeature("inventory_management"), async (req, res) => {
  const { name, unit, currentStock, minStockLevel, costPerUnit, category, supplierId, parLevel, reorderQuantity, autoReorderEnabled } = req.body;
  const [item] = await db.insert(inventoryItemsTable).values({
    restaurantId: Number(req.params.restaurantId),
    name, unit, currentStock, minStockLevel, costPerUnit, category,
    supplierId: supplierId ?? null,
    parLevel: parLevel ?? null,
    reorderQuantity: reorderQuantity ?? null,
    autoReorderEnabled: autoReorderEnabled ?? true,
  }).returning();
  res.status(201).json({ ...item, isLowStock: Number(item.currentStock) <= Number(item.minStockLevel) });
});

router.patch("/restaurants/:restaurantId/inventory/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, unit, minStockLevel, costPerUnit, category, supplierId, isActive, parLevel, reorderQuantity, autoReorderEnabled } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (unit !== undefined) updates.unit = unit;
  if (minStockLevel !== undefined) updates.minStockLevel = minStockLevel;
  if (costPerUnit !== undefined) updates.costPerUnit = costPerUnit;
  if (category !== undefined) updates.category = category;
  if (supplierId !== undefined) updates.supplierId = supplierId;
  if (isActive !== undefined) updates.isActive = isActive;
  if (parLevel !== undefined) updates.parLevel = parLevel;
  if (reorderQuantity !== undefined) updates.reorderQuantity = reorderQuantity;
  if (autoReorderEnabled !== undefined) updates.autoReorderEnabled = autoReorderEnabled;
  const [updated] = await db.update(inventoryItemsTable).set(updates).where(and(eq(inventoryItemsTable.id, Number(req.params.id)), eq(inventoryItemsTable.restaurantId, Number(req.params.restaurantId)))).returning();
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
    try {
      const { pushToStaff } = await import("../lib/pushNotify");
      await pushToStaff(
        { restaurantId, roles: ["manager", "owner"], type: "low_stock" },
        {
          title: "Low stock alert",
          body: `${item.name} is running low (${Number(item.currentStock).toFixed(1)} ${item.unit} left).`,
          data: { itemId: item.id, type: "low_stock" },
        },
      );
    } catch (err) {
      console.error("low-stock push failed:", err);
    }
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
  const { type, quantity, notes, batchNumber, expiryDate } = req.body as {
    type: string; quantity: string | number; notes?: string;
    batchNumber?: string | null; expiryDate?: string | null;
  };
  const id = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);

  const [item] = await db.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.restaurantId, restaurantId)));
  if (!item) return void res.status(404).json({ error: "Not found" });

  const qtyNum = Number(quantity);
  let newStock = Number(item.currentStock);
  if (type === "add" || type === "receive") newStock += qtyNum;
  else if (type === "remove" || type === "use" || type === "waste") newStock -= qtyNum;
  else newStock = qtyNum;
  const finalStock = Math.max(0, newStock);

  await db.transaction(async (tx) => {
    await tx.update(inventoryItemsTable).set({ currentStock: finalStock.toFixed(3), updatedAt: new Date() })
      .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.restaurantId, restaurantId)));
    await tx.insert(inventoryTransactionsTable).values({ itemId: id, restaurantId, type, quantity: String(quantity), notes });

    // On inflows, optionally capture a batch with expiry.
    if ((type === "add" || type === "receive") && qtyNum > 0 && (expiryDate || batchNumber)) {
      const expiryTs = expiryDate ? new Date(expiryDate) : null;
      if (!expiryDate || (expiryTs && !Number.isNaN(expiryTs.getTime()))) {
        await tx.insert(inventoryItemBatchesTable).values({
          restaurantId, inventoryItemId: id,
          batchNumber: batchNumber ?? null,
          quantityReceived: qtyNum.toFixed(3),
          quantityRemaining: qtyNum.toFixed(3),
          expiryDate: expiryTs,
          notes: notes ?? null,
        });
      }
    }

    // On outflows, FIFO-decrement earliest-expiring batches.
    if ((type === "remove" || type === "use" || type === "waste") && qtyNum > 0) {
      let toConsume = qtyNum;
      const batches = await tx.select().from(inventoryItemBatchesTable)
        .where(and(
          eq(inventoryItemBatchesTable.inventoryItemId, id),
          gt(inventoryItemBatchesTable.quantityRemaining, "0"),
        ))
        .orderBy(asc(inventoryItemBatchesTable.expiryDate), asc(inventoryItemBatchesTable.receivedAt));
      for (const b of batches) {
        if (toConsume <= 0) break;
        const remain = Number(b.quantityRemaining);
        const take = Math.min(remain, toConsume);
        toConsume -= take;
        await tx.update(inventoryItemBatchesTable)
          .set({ quantityRemaining: (remain - take).toFixed(3), updatedAt: new Date() })
          .where(eq(inventoryItemBatchesTable.id, b.id));
      }
    }
  });

  const [updated] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  await triggerLowStockNotification({ ...updated!, currentStock: finalStock.toFixed(3) }, restaurantId);

  // Accounting auto-post: inventory purchase or adjustment → ledger
  // (fail-soft, idempotent per item+timestamp; uses unit cost when known)
  const unitCost = Number(updated?.costPerUnit ?? 0);
  if (qtyNum > 0 && unitCost > 0) {
    const value = qtyNum * unitCost;
    const today = new Date().toISOString().slice(0, 10);
    if (type === "add" || type === "receive") {
      void triggerAutoPost({
        restaurantId,
        source: "inventory_purchase",
        sourceRef: `inv_recv:${id}:${Date.now()}`,
        entryDate: today,
        amount: value,
        memo: `Inventory receipt: ${updated?.name ?? `#${id}`} ×${qtyNum}`,
      });
    } else if (type === "remove" || type === "use" || type === "waste") {
      void triggerAutoPost({
        restaurantId,
        source: "inventory_adjustment",
        sourceRef: `inv_adj:${id}:${Date.now()}`,
        entryDate: today,
        amount: value,
        matchKey: type,
        memo: `Inventory ${type}: ${updated?.name ?? `#${id}`} ×${qtyNum}`,
      });
    }
  }

  res.json({ ...updated!, isLowStock: finalStock <= Number(updated!.minStockLevel) });
});

// List batches for an inventory item (oldest-expiring first). Optionally filter remaining > 0.
router.get("/restaurants/:restaurantId/inventory/:id/batches", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const onlyOpen = String(req.query.onlyOpen ?? "true") === "true";
  const conds = [
    eq(inventoryItemBatchesTable.inventoryItemId, id),
    eq(inventoryItemBatchesTable.restaurantId, restaurantId),
  ];
  if (onlyOpen) conds.push(gt(inventoryItemBatchesTable.quantityRemaining, "0"));
  const rows = await db.select().from(inventoryItemBatchesTable)
    .where(and(...conds))
    .orderBy(asc(inventoryItemBatchesTable.expiryDate), asc(inventoryItemBatchesTable.receivedAt));
  res.json(rows);
});

// Manually delete a batch (e.g. recorded in error). Decrements item stock by remaining qty.
router.delete("/restaurants/:restaurantId/inventory/batches/:batchId", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const batchId = Number(req.params.batchId);
  await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(inventoryItemBatchesTable)
      .where(and(eq(inventoryItemBatchesTable.id, batchId), eq(inventoryItemBatchesTable.restaurantId, restaurantId)));
    if (!batch) return;
    const remain = Number(batch.quantityRemaining);
    if (remain > 0) {
      await tx.update(inventoryItemsTable)
        .set({ currentStock: sql`greatest(0, ${inventoryItemsTable.currentStock} - ${remain})`, updatedAt: new Date() })
        .where(eq(inventoryItemsTable.id, batch.inventoryItemId));
      await tx.insert(inventoryTransactionsTable).values({
        itemId: batch.inventoryItemId, restaurantId, type: "remove",
        quantity: remain.toFixed(3), notes: `Batch ${batch.batchNumber ?? "#" + batch.id} removed`,
      });
    }
    await tx.delete(inventoryItemBatchesTable).where(eq(inventoryItemBatchesTable.id, batchId));
  });
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/inventory/:id/transactions", async (req, res) => {
  const rows = await db.select().from(inventoryTransactionsTable)
    .where(and(eq(inventoryTransactionsTable.itemId, Number(req.params.id)), eq(inventoryTransactionsTable.restaurantId, Number(req.params.restaurantId))))
    .orderBy(desc(inventoryTransactionsTable.createdAt)).limit(50);
  res.json(rows);
});

// Inventory valuation: current stock × cost per unit, broken down by category.
// Used by Reports → Inventory Valuation. Owners and managers can read.
router.get("/restaurants/:restaurantId/inventory/valuation", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.restaurantId, restaurantId), eq(inventoryItemsTable.isActive, true)));

  const items = rows.map(r => {
    const stock = Number(r.currentStock);
    const cost = Number(r.costPerUnit);
    const value = stock * cost;
    return {
      id: r.id,
      name: r.name,
      category: r.category ?? "general",
      kind: r.kind,
      unit: r.unit,
      currentStock: r.currentStock,
      costPerUnit: r.costPerUnit,
      value: value.toFixed(2),
      isLowStock: stock <= Number(r.minStockLevel),
    };
  });

  const byCategory = new Map<string, { category: string; itemCount: number; value: number }>();
  for (const it of items) {
    const cat = it.category ?? "general";
    const e = byCategory.get(cat) ?? { category: cat, itemCount: 0, value: 0 };
    e.itemCount += 1;
    e.value += Number(it.value);
    byCategory.set(cat, e);
  }
  const byKind = new Map<string, { kind: string; itemCount: number; value: number }>();
  for (const it of items) {
    const k = it.kind ?? "ingredient";
    const e = byKind.get(k) ?? { kind: k, itemCount: 0, value: 0 };
    e.itemCount += 1;
    e.value += Number(it.value);
    byKind.set(k, e);
  }

  const totalValue = items.reduce((s, it) => s + Number(it.value), 0);
  res.json({
    asOf: new Date().toISOString(),
    totalItems: items.length,
    totalValue: totalValue.toFixed(2),
    byCategory: Array.from(byCategory.values())
      .map(c => ({ ...c, value: c.value.toFixed(2) }))
      .sort((a, b) => Number(b.value) - Number(a.value)),
    byKind: Array.from(byKind.values())
      .map(k => ({ ...k, value: k.value.toFixed(2) })),
    items: items.sort((a, b) => Number(b.value) - Number(a.value)),
  });
});

// Stock transfer between two outlets (restaurants) under the same tenant.
// Decrements source item, increments matching destination item (matched by
// name + unit, created if missing). Records audit transactions on both ends.
router.post("/restaurants/:restaurantId/inventory/:id/transfer", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const srcRestaurantId = Number(req.params.restaurantId);
  const srcItemId = Number(req.params.id);
  const { destRestaurantId, quantity, notes } = req.body as { destRestaurantId: number; quantity: string | number; notes?: string };
  const destId = Number(destRestaurantId);
  const qty = Number(quantity);
  if (!destId || destId === srcRestaurantId) return void res.status(400).json({ error: "destRestaurantId required and must differ from source" });
  if (!Number.isFinite(qty) || qty <= 0) return void res.status(400).json({ error: "quantity must be > 0" });

  // Authorize destination outlet with the same rules as validateRestaurantAccess:
  //   - must exist
  //   - super-admin bypasses tenant + branch checks
  //   - otherwise must share tenant
  //   - branch-pinned users (non-owner with restaurantId on JWT) can't write
  //     to any restaurant other than their own — so they can't transfer to
  //     a sibling outlet at all.
  const [dest] = await db.select({ id: restaurantsTable.id, tenantId: restaurantsTable.tenantId })
    .from(restaurantsTable).where(eq(restaurantsTable.id, destId));
  if (!dest) return void res.status(404).json({ error: "Destination restaurant not found" });
  if (!req.user?.isSuperAdmin) {
    if (dest.tenantId !== req.user?.tenantId) {
      return void res.status(403).json({ error: "Access denied: destination outlet is in a different tenant" });
    }
    if (
      req.user.restaurantId != null &&
      req.user.role !== "owner" &&
      req.user.restaurantId !== destId
    ) {
      return void res.status(403).json({ error: "Access denied: destination outlet is out of branch scope" });
    }
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [src] = await tx.select().from(inventoryItemsTable)
        .where(and(
          eq(inventoryItemsTable.id, srcItemId),
          eq(inventoryItemsTable.restaurantId, srcRestaurantId),
          eq(inventoryItemsTable.isActive, true),
        )).for("update");
      if (!src) throw new Error("SRC_NOT_FOUND");
      if (Number(src.currentStock) < qty) throw new Error("INSUFFICIENT_STOCK");

      // Find matching ACTIVE item in destination by (name, unit); create if
      // missing. We deliberately ignore soft-deleted (isActive=false) items
      // so that transferred stock never lands on a hidden row that's
      // filtered out of inventory lists and valuation.
      const [existingDest] = await tx.select().from(inventoryItemsTable)
        .where(and(
          eq(inventoryItemsTable.restaurantId, destId),
          eq(inventoryItemsTable.name, src.name),
          eq(inventoryItemsTable.unit, src.unit),
          eq(inventoryItemsTable.isActive, true),
        )).for("update");

      let destItem = existingDest;
      if (!destItem) {
        const [created] = await tx.insert(inventoryItemsTable).values({
          restaurantId: destId,
          name: src.name,
          unit: src.unit,
          currentStock: "0.000",
          minStockLevel: src.minStockLevel,
          costPerUnit: src.costPerUnit,
          category: src.category,
          kind: src.kind,
        }).returning();
        destItem = created;
      }

      const newSrcStock = Number(src.currentStock) - qty;
      const newDestStock = Number(destItem!.currentStock) + qty;
      await tx.update(inventoryItemsTable)
        .set({ currentStock: newSrcStock.toFixed(3), updatedAt: new Date() })
        .where(eq(inventoryItemsTable.id, src.id));
      await tx.update(inventoryItemsTable)
        .set({ currentStock: newDestStock.toFixed(3), updatedAt: new Date() })
        .where(eq(inventoryItemsTable.id, destItem!.id));

      const transferNote = `Transfer to outlet #${destId}${notes ? `: ${notes}` : ""}`;
      const receiveNote = `Transfer from outlet #${srcRestaurantId}${notes ? `: ${notes}` : ""}`;
      await tx.insert(inventoryTransactionsTable).values([
        { itemId: src.id, restaurantId: srcRestaurantId, type: "transfer_out", quantity: qty.toFixed(3), notes: transferNote, referenceId: destItem!.id, referenceType: "stock_transfer" },
        { itemId: destItem!.id, restaurantId: destId, type: "transfer_in", quantity: qty.toFixed(3), notes: receiveNote, referenceId: src.id, referenceType: "stock_transfer" },
      ]);
      return { src: { ...src, currentStock: newSrcStock.toFixed(3) }, dest: { ...destItem!, currentStock: newDestStock.toFixed(3) } };
    });
    res.json({ ok: true, source: result.src, destination: result.dest });
  } catch (err) {
    const m = (err as Error).message;
    if (m === "SRC_NOT_FOUND") return void res.status(404).json({ error: "Source item not found" });
    if (m === "INSUFFICIENT_STOCK") return void res.status(409).json({ error: "Insufficient stock for transfer" });
    console.error("[Inventory] transfer failed:", err);
    res.status(500).json({ error: "Transfer failed" });
  }
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
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.restaurantId, restaurantId))
    .orderBy(desc(purchaseOrdersTable.createdAt));

  if (rows.length === 0) return void res.json([]);
  const poIds = rows.map(r => r.id);
  const items = await db.select().from(purchaseOrderItemsTable)
    .where(inArray(purchaseOrderItemsTable.purchaseOrderId, poIds));
  const byPo = new Map<number, typeof items>();
  for (const it of items) {
    const arr = byPo.get(it.purchaseOrderId) ?? [];
    arr.push(it);
    byPo.set(it.purchaseOrderId, arr);
  }
  res.json(rows.map(po => ({ ...po, items: byPo.get(po.id) ?? [] })));
});

router.post("/restaurants/:restaurantId/auto-reorder/run", requireRole("owner", "manager", "super_admin"), requirePlanFeature("inventory_management"), async (req, res) => {
  try {
    const result = await runAutoReorderForRestaurant(Number(req.params.restaurantId));
    res.json(result);
  } catch (err) {
    console.error("[AutoReorder] manual run failed", err);
    res.status(500).json({ error: "Failed to run auto-reorder" });
  }
});

// Replace all line items on a pending PO and recompute its total. Owners use this to
// edit auto-drafted POs before sending (adjust qty/price, remove or add items).
router.put("/restaurants/:restaurantId/purchase-orders/:id/items", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const poId = Number(req.params.id);
  const { items } = req.body as { items?: Array<{ inventoryItemId?: number | null; name: string; unit: string; quantity: string | number; costPerUnit: string | number }> };
  if (!Array.isArray(items)) return void res.status(400).json({ error: "items array required" });

  try {
    const updated = await db.transaction(async tx => {
      const [po] = await tx.select().from(purchaseOrdersTable)
        .where(and(eq(purchaseOrdersTable.id, poId), eq(purchaseOrdersTable.restaurantId, restaurantId)));
      if (!po) throw new Error("NOT_FOUND");
      if (po.status !== "pending") throw new Error("NOT_EDITABLE");

      await tx.delete(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, poId));

      let total = 0;
      const inserts = items
        .filter(it => Number(it.quantity) > 0 && it.name)
        .map(it => {
          const qty = Number(it.quantity);
          const cost = Number(it.costPerUnit);
          total += qty * cost;
          return {
            purchaseOrderId: poId,
            inventoryItemId: it.inventoryItemId ?? null,
            name: it.name,
            unit: it.unit || "kg",
            quantity: qty.toFixed(3),
            costPerUnit: cost.toFixed(2),
          };
        });
      if (inserts.length > 0) {
        await tx.insert(purchaseOrderItemsTable).values(inserts);
      }

      const [u] = await tx.update(purchaseOrdersTable)
        .set({ totalAmount: total.toFixed(2), updatedAt: new Date() })
        .where(eq(purchaseOrdersTable.id, poId))
        .returning();
      return u;
    });
    res.json(updated);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "NOT_FOUND") return void res.status(404).json({ error: "Not found" });
    if (msg === "NOT_EDITABLE") return void res.status(409).json({ error: "Only pending purchase orders can be edited" });
    console.error("[PO] Edit items failed:", err);
    res.status(500).json({ error: "Failed to update line items" });
  }
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
  const { status, notes, totalAmount, paymentMethod, batches } = req.body as {
    status?: string; notes?: string; totalAmount?: string; paymentMethod?: string;
    batches?: Array<{ purchaseOrderItemId: number; batchNumber?: string | null; expiryDate?: string | null; quantity?: string | number }>;
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
        // Increment inventory stock from PO line items (idempotent: only when transitioning into received)
        const lineItems = await tx.select().from(purchaseOrderItemsTable)
          .where(eq(purchaseOrderItemsTable.purchaseOrderId, poId));
        const batchByLine = new Map<number, { batchNumber?: string | null; expiryDate?: string | null; quantity?: string | number }>();
        for (const b of (batches ?? [])) {
          if (b && Number.isFinite(Number(b.purchaseOrderItemId))) {
            batchByLine.set(Number(b.purchaseOrderItemId), b);
          }
        }
        for (const li of lineItems) {
          if (li.inventoryItemId === null) continue;
          const qty = Number(li.quantity);
          if (!(qty > 0)) continue;
          await tx.update(inventoryItemsTable)
            .set({
              currentStock: sql`${inventoryItemsTable.currentStock} + ${qty}`,
              costPerUnit: li.costPerUnit,
              updatedAt: new Date(),
            })
            .where(and(
              eq(inventoryItemsTable.id, li.inventoryItemId),
              eq(inventoryItemsTable.restaurantId, restaurantId),
            ));
          await tx.insert(inventoryTransactionsTable).values({
            itemId: li.inventoryItemId,
            restaurantId,
            type: "receive",
            quantity: qty.toFixed(3),
            notes: `Received from PO-${String(poId).padStart(4, "0")}`,
            referenceId: poId,
            referenceType: "purchase_order",
          });
          // Capture batch row (with optional expiry) for the received quantity.
          const b = batchByLine.get(li.id);
          const batchQty = b?.quantity != null ? Number(b.quantity) : qty;
          const expiryTs = b?.expiryDate ? new Date(b.expiryDate) : null;
          if (batchQty > 0 && (!expiryTs || !Number.isNaN(expiryTs.getTime()))) {
            await tx.insert(inventoryItemBatchesTable).values({
              restaurantId,
              inventoryItemId: li.inventoryItemId,
              batchNumber: b?.batchNumber ?? null,
              quantityReceived: batchQty.toFixed(3),
              quantityRemaining: batchQty.toFixed(3),
              expiryDate: expiryTs,
              receivedAt: new Date(),
              purchaseOrderId: poId,
              purchaseOrderItemId: li.id,
              notes: null,
            });
          }
        }

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

router.get("/restaurants/:restaurantId/menu-engineering", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { period, from: fromStr, to: toStr } = req.query;

  let from = new Date();
  let to = new Date();
  if (fromStr && toStr) {
    from = new Date(String(fromStr));
    to = new Date(String(toStr));
    to.setHours(23, 59, 59, 999);
  } else {
    const p = String(period ?? "30d");
    if (p === "1y") from.setFullYear(from.getFullYear() - 1);
    else if (p === "90d") from.setDate(from.getDate() - 90);
    else if (p === "7d") from.setDate(from.getDate() - 7);
    else if (p === "1m" || p === "30d") from.setMonth(from.getMonth() - 1);
    else from.setMonth(from.getMonth() - 1);
  }
  from.setHours(0, 0, 0, 0);

  const marginQ = req.query.marginThreshold;
  const popularityQ = req.query.popularityThreshold;
  const marginOverride = marginQ != null && marginQ !== "" && Number.isFinite(Number(marginQ)) ? Number(marginQ) : null;
  const popularityOverride = popularityQ != null && popularityQ !== "" && Number.isFinite(Number(popularityQ)) ? Number(popularityQ) : null;

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
    costPerUnit: inventoryItemsTable.costPerUnit,
  }).from(recipeMappingsTable)
    .leftJoin(inventoryItemsTable, eq(recipeMappingsTable.inventoryItemId, inventoryItemsTable.id))
    .where(eq(recipeMappingsTable.restaurantId, restaurantId));

  const cogsByItem = new Map<number, { cogs: number; count: number }>();
  for (const m of mappings) {
    const e = cogsByItem.get(m.menuItemId) ?? { cogs: 0, count: 0 };
    e.cogs += Number(m.quantity) * Number(m.costPerUnit ?? 0);
    e.count += 1;
    cogsByItem.set(m.menuItemId, e);
  }

  const sales = await db.select({
    menuItemId: orderItemsTable.menuItemId,
    units: sql<number>`cast(coalesce(sum(${orderItemsTable.quantity}), 0) as int)`,
    revenue: sql<string>`cast(coalesce(sum(${orderItemsTable.totalPrice}), 0) as text)`,
  }).from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      gte(ordersTable.createdAt, from),
      lte(ordersTable.createdAt, to),
    ))
    .groupBy(orderItemsTable.menuItemId);

  const salesByItem = new Map<number, { units: number; revenue: number }>();
  for (const s of sales) {
    salesByItem.set(s.menuItemId, { units: Number(s.units), revenue: Number(s.revenue) });
  }

  const inputs: MenuEngineeringInput[] = items.map(it => {
    const sold = salesByItem.get(it.id) ?? { units: 0, revenue: 0 };
    const cogs = cogsByItem.get(it.id);
    return {
      id: it.id,
      name: it.name,
      categoryId: it.categoryId ?? null,
      categoryName: it.categoryName ?? null,
      price: Number(it.price),
      unitsSold: sold.units,
      revenue: sold.revenue,
      unitCost: cogs ? cogs.cogs : 0,
      hasRecipe: !!cogs && cogs.count > 0,
      ingredientCount: cogs?.count ?? 0,
    };
  });

  const result = classifyMenuItems(inputs, {
    marginThreshold: marginOverride,
    popularityThreshold: popularityOverride,
  });

  const quadrantSummary: Record<string, { count: number; revenue: number }> = {
    star: { count: 0, revenue: 0 },
    plowhorse: { count: 0, revenue: 0 },
    puzzle: { count: 0, revenue: 0 },
    dog: { count: 0, revenue: 0 },
  };
  for (const it of result.items) {
    if (it.quadrant) {
      quadrantSummary[it.quadrant].count++;
      quadrantSummary[it.quadrant].revenue += it.revenue;
    }
  }

  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    marginThreshold: result.marginThreshold,
    popularityThreshold: result.popularityThreshold,
    overrides: { marginThreshold: marginOverride, popularityThreshold: popularityOverride },
    totals: {
      itemCount: items.length,
      classifiedCount: result.classifiedCount,
      noSalesCount: result.noSalesCount,
      noRecipeCount: result.noRecipeCount,
      units: result.totalUnits,
      revenue: result.totalRevenue,
      profit: result.totalProfit,
    },
    quadrantSummary,
    items: result.items,
  });
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
