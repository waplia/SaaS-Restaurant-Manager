import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, floorTablesTable, reservationsTable } from "../lib/db";

const router = Router();

router.get("/restaurants/:restaurantId/tables", async (req, res) => {
  const rows = await db.select().from(floorTablesTable).where(eq(floorTablesTable.restaurantId, Number(req.params.restaurantId)));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/tables", async (req, res) => {
  const { tableNumber, capacity, positionX, positionY, shape } = req.body;
  const restaurantId = Number(req.params.restaurantId);
  const qrCode = `${restaurantId}-${tableNumber}-${Date.now()}`;
  const [table] = await db.insert(floorTablesTable).values({ restaurantId, tableNumber, capacity, positionX, positionY, shape, qrCode }).returning();
  res.status(201).json(table);
});

router.patch("/restaurants/:restaurantId/tables/:id", async (req, res) => {
  const { tableNumber, capacity, status, positionX, positionY, shape, isActive } = req.body;
  const [updated] = await db.update(floorTablesTable).set({ tableNumber, capacity, status, positionX, positionY, shape, isActive, updatedAt: new Date() }).where(and(eq(floorTablesTable.id, Number(req.params.id)), eq(floorTablesTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/tables/:id", async (req, res) => {
  await db.update(floorTablesTable).set({ isActive: false }).where(and(eq(floorTablesTable.id, Number(req.params.id)), eq(floorTablesTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/tables/:id/qr", async (req, res) => {
  const [table] = await db.select().from(floorTablesTable).where(eq(floorTablesTable.id, Number(req.params.id)));
  if (!table) return res.status(404).json({ error: "Not found" });
  const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({ qrUrl: `${baseUrl}/order/${table.qrCode}`, tableNumber: table.tableNumber, svgData: "" });
});

router.get("/restaurants/:restaurantId/reservations", async (req, res) => {
  const { date, status } = req.query;
  const conditions: ReturnType<typeof eq>[] = [eq(reservationsTable.restaurantId, Number(req.params.restaurantId))];
  if (status) conditions.push(eq(reservationsTable.status, String(status)));
  const rows = await db.select().from(reservationsTable).where(and(...conditions));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/reservations", async (req, res) => {
  const { guestName, guestPhone, guestEmail, tableId, partySize, scheduledAt, notes } = req.body;
  const [reservation] = await db.insert(reservationsTable).values({ restaurantId: Number(req.params.restaurantId), guestName, guestPhone, guestEmail, tableId, partySize, scheduledAt: new Date(scheduledAt), notes }).returning();
  res.status(201).json(reservation);
});

router.patch("/restaurants/:restaurantId/reservations/:id", async (req, res) => {
  const { guestName, guestPhone, tableId, partySize, scheduledAt, status, notes } = req.body;
  const updates: Record<string, unknown> = { guestName, guestPhone, tableId, partySize, status, notes, updatedAt: new Date() };
  if (scheduledAt) updates.scheduledAt = new Date(scheduledAt);
  const [updated] = await db.update(reservationsTable).set(updates).where(and(eq(reservationsTable.id, Number(req.params.id)), eq(reservationsTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/reservations/:id", async (req, res) => {
  await db.delete(reservationsTable).where(eq(reservationsTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
