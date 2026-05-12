import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, restaurantsTable, branchesTable } from "../lib/db";

const router = Router();

router.get("/restaurants", async (req, res) => {
  const { tenantId } = req.query;
  const rows = tenantId
    ? await db.select().from(restaurantsTable).where(eq(restaurantsTable.tenantId, Number(tenantId)))
    : await db.select().from(restaurantsTable);
  res.json(rows);
});

router.post("/restaurants", async (req, res) => {
  const { tenantId, name, slug, description, phone, email, address, city, country, taxRate, openingTime, closingTime } = req.body;
  const [restaurant] = await db.insert(restaurantsTable).values({ tenantId, name, slug, description, phone, email, address, city, country, taxRate, openingTime, closingTime }).returning();
  res.status(201).json(restaurant);
});

router.get("/restaurants/:id", async (req, res) => {
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, Number(req.params.id)));
  if (!restaurant) return void res.status(404).json({ error: "Not found" });
  res.json(restaurant);
});

router.patch("/restaurants/:id", async (req, res) => {
  const { name, description, phone, email, address, city, taxRate, serviceCharge, logoUrl, openingTime, closingTime } = req.body;
  const [updated] = await db.update(restaurantsTable).set({ name, description, phone, email, address, city, taxRate, serviceCharge, logoUrl, openingTime, closingTime, updatedAt: new Date() }).where(eq(restaurantsTable.id, Number(req.params.id))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.get("/restaurants/:restaurantId/branches", async (req, res) => {
  const rows = await db.select().from(branchesTable).where(eq(branchesTable.restaurantId, Number(req.params.restaurantId)));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/branches", async (req, res) => {
  const { name, address, phone, isMain } = req.body;
  const [branch] = await db.insert(branchesTable).values({ restaurantId: Number(req.params.restaurantId), name, address, phone, isMain }).returning();
  res.status(201).json(branch);
});

export default router;
