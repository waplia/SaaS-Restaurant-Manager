import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, attendanceTable, auditLogsTable } from "../lib/db";

const router = Router();

router.get("/restaurants/:restaurantId/attendance", async (req, res) => {
  const { userId, date } = req.query;
  const restaurantId = Number(req.params.restaurantId);
  const conditions: ReturnType<typeof eq>[] = [eq(attendanceTable.restaurantId, restaurantId)];
  if (userId) conditions.push(eq(attendanceTable.userId, Number(userId)));
  const rows = await db.select().from(attendanceTable).where(and(...conditions)).orderBy(desc(attendanceTable.clockIn));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/attendance", async (req, res) => {
  const { userId, notes } = req.body;
  const [record] = await db.insert(attendanceTable).values({ userId, restaurantId: Number(req.params.restaurantId), clockIn: new Date(), notes }).returning();
  res.status(201).json(record);
});

router.patch("/restaurants/:restaurantId/attendance/:id/clock-out", async (req, res) => {
  const { notes } = req.body;
  const [existing] = await db.select().from(attendanceTable).where(eq(attendanceTable.id, Number(req.params.id)));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const clockOut = new Date();
  const totalHours = ((clockOut.getTime() - existing.clockIn.getTime()) / 3600000).toFixed(2);
  const [updated] = await db.update(attendanceTable).set({ clockOut, totalHours, notes: notes ?? existing.notes, updatedAt: new Date() }).where(eq(attendanceTable.id, existing.id)).returning();
  res.json(updated);
});

router.get("/restaurants/:restaurantId/audit-logs", async (req, res) => {
  const { userId, action, page, limit } = req.query;
  const pg = Number(page) || 1;
  const lim = Number(limit) || 50;
  const offset = (pg - 1) * lim;
  const restaurantId = Number(req.params.restaurantId);

  const conditions: ReturnType<typeof eq>[] = [eq(auditLogsTable.restaurantId, restaurantId)];
  if (userId) conditions.push(eq(auditLogsTable.userId, Number(userId)));
  if (action) conditions.push(eq(auditLogsTable.action, String(action)));

  const rows = await db.select().from(auditLogsTable).where(and(...conditions)).orderBy(desc(auditLogsTable.createdAt)).limit(lim).offset(offset);
  res.json(rows);
});

export default router;
