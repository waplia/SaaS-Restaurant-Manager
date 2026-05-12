import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, inventoryItemsTable, suppliersTable, inventoryTransactionsTable } from "../lib/db";

const router = Router();

router.get("/restaurants/:restaurantId/inventory", async (req, res) => {
  const { lowStock, search } = req.query;
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.restaurantId, restaurantId));

  let result = rows.map(item => ({
    ...item,
    isLowStock: Number(item.currentStock) <= Number(item.minStockLevel),
  }));

  if (lowStock === "true") result = result.filter(i => i.isLowStock);
  if (search) result = result.filter(i => i.name.toLowerCase().includes(String(search).toLowerCase()));

  res.json(result);
});

router.post("/restaurants/:restaurantId/inventory", async (req, res) => {
  const { name, unit, currentStock, minStockLevel, costPerUnit, category, supplierId } = req.body;
  const [item] = await db.insert(inventoryItemsTable).values({ restaurantId: Number(req.params.restaurantId), name, unit, currentStock, minStockLevel, costPerUnit, category, supplierId }).returning();
  res.status(201).json({ ...item, isLowStock: Number(item.currentStock) <= Number(item.minStockLevel) });
});

router.patch("/restaurants/:restaurantId/inventory/:id", async (req, res) => {
  const { name, unit, minStockLevel, costPerUnit, category, supplierId, isActive } = req.body;
  const [updated] = await db.update(inventoryItemsTable).set({ name, unit, minStockLevel, costPerUnit, category, supplierId, isActive, updatedAt: new Date() }).where(and(eq(inventoryItemsTable.id, Number(req.params.id)), eq(inventoryItemsTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json({ ...updated, isLowStock: Number(updated.currentStock) <= Number(updated.minStockLevel) });
});

router.delete("/restaurants/:restaurantId/inventory/:id", async (req, res) => {
  await db.update(inventoryItemsTable).set({ isActive: false }).where(and(eq(inventoryItemsTable.id, Number(req.params.id)), eq(inventoryItemsTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

router.post("/restaurants/:restaurantId/inventory/:id/adjust", async (req, res) => {
  const { type, quantity, notes } = req.body;
  const id = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);

  const [item] = await db.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.restaurantId, restaurantId)));
  if (!item) return void res.status(404).json({ error: "Not found" });

  let newStock = Number(item.currentStock);
  if (type === "add" || type === "receive") newStock += Number(quantity);
  else if (type === "remove" || type === "use") newStock -= Number(quantity);
  else newStock = Number(quantity);

  const [updated] = await db.update(inventoryItemsTable).set({ currentStock: Math.max(0, newStock).toFixed(3), updatedAt: new Date() }).where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.restaurantId, restaurantId))).returning();
  await db.insert(inventoryTransactionsTable).values({ itemId: id, restaurantId, type, quantity, notes });

  res.json({ ...updated!, isLowStock: Number(updated!.currentStock) <= Number(updated!.minStockLevel) });
});

router.get("/restaurants/:restaurantId/suppliers", async (req, res) => {
  const rows = await db.select().from(suppliersTable).where(eq(suppliersTable.restaurantId, Number(req.params.restaurantId)));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/suppliers", async (req, res) => {
  const { name, contactPerson, phone, email, address } = req.body;
  const [supplier] = await db.insert(suppliersTable).values({ restaurantId: Number(req.params.restaurantId), name, contactPerson, phone, email, address }).returning();
  res.status(201).json(supplier);
});

router.patch("/restaurants/:restaurantId/suppliers/:id", async (req, res) => {
  const { name, contactPerson, phone, email, address, isActive } = req.body;
  const [updated] = await db.update(suppliersTable).set({ name, contactPerson, phone, email, address, isActive, updatedAt: new Date() }).where(and(eq(suppliersTable.id, Number(req.params.id)), eq(suppliersTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/suppliers/:id", async (req, res) => {
  await db.update(suppliersTable).set({ isActive: false }).where(and(eq(suppliersTable.id, Number(req.params.id)), eq(suppliersTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

export default router;
