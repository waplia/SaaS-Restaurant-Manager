import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, ordersTable, menuItemsTable, customersTable } from "../lib/db";
import { apiKeyAuth } from "../middleware/apiKeyAuth";

/**
 * Public, key-authenticated API surface. Mounted under /api/v1/* and
 * gated by `apiKeyAuth`. Endpoints are intentionally read-only and
 * scoped to the api key's restaurant — they expose existing business
 * data without re-implementing it.
 */
const router = Router();

router.use("/v1", apiKeyAuth);

router.get("/v1/restaurant", (req, res) => {
  res.json({ restaurantId: req.apiKey!.restaurantId });
});

router.get("/v1/orders", async (req, res) => {
  const restaurantId = req.apiKey!.restaurantId;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const conds = [eq(ordersTable.restaurantId, restaurantId)];
  if (status) conds.push(eq(ordersTable.status, status));
  const rows = await db.select().from(ordersTable).where(and(...conds))
    .orderBy(desc(ordersTable.createdAt)).limit(limit);
  res.json({ data: rows });
});

router.get("/v1/orders/:id", async (req, res) => {
  const restaurantId = req.apiKey!.restaurantId;
  const id = Number(req.params.id);
  const [row] = await db.select().from(ordersTable)
    .where(and(eq(ordersTable.id, id), eq(ordersTable.restaurantId, restaurantId)));
  if (!row) return void res.status(404).json({ error: { code: "not_found", message: "Order not found" } });
  res.json({ data: row });
});

router.get("/v1/menu-items", async (req, res) => {
  const restaurantId = req.apiKey!.restaurantId;
  const rows = await db.select().from(menuItemsTable)
    .where(eq(menuItemsTable.restaurantId, restaurantId)).limit(500);
  res.json({ data: rows });
});

router.get("/v1/customers", async (req, res) => {
  const restaurantId = req.apiKey!.restaurantId;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const rows = await db.select().from(customersTable)
    .where(eq(customersTable.restaurantId, restaurantId))
    .orderBy(desc(customersTable.createdAt)).limit(limit);
  res.json({ data: rows });
});

export default router;
