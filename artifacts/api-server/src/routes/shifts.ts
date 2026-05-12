import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, shiftsTable, staffShiftsTable, attendanceTable, auditLogsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), validateRestaurantAccess);

router.get("/restaurants/:restaurantId/shifts", async (req, res) => {
  const rows = await db.select().from(shiftsTable).where(eq(shiftsTable.restaurantId, Number(req.params.restaurantId)));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/shifts", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, startTime, endTime, days } = req.body;
  const [shift] = await db.insert(shiftsTable).values({ restaurantId: Number(req.params.restaurantId), name, startTime, endTime, days }).returning();
  res.status(201).json(shift);
});

router.patch("/restaurants/:restaurantId/shifts/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, startTime, endTime, days, isActive } = req.body;
  const [updated] = await db.update(shiftsTable).set({ name, startTime, endTime, days, isActive, updatedAt: new Date() }).where(and(eq(shiftsTable.id, Number(req.params.id)), eq(shiftsTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/shifts/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.update(shiftsTable).set({ isActive: false }).where(and(eq(shiftsTable.id, Number(req.params.id)), eq(shiftsTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/staff-shifts", async (req, res) => {
  const { userId } = req.query;
  const restaurantId = Number(req.params.restaurantId);
  const conditions: ReturnType<typeof eq>[] = [eq(staffShiftsTable.restaurantId, restaurantId)];
  if (userId) conditions.push(eq(staffShiftsTable.userId, Number(userId)));
  const rows = await db.select().from(staffShiftsTable).where(and(...conditions)).orderBy(desc(staffShiftsTable.date));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/staff-shifts", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { userId, shiftId, date } = req.body;
  const [entry] = await db.insert(staffShiftsTable).values({ restaurantId: Number(req.params.restaurantId), userId, shiftId, date: new Date(date) }).returning();
  res.status(201).json(entry);
});

router.get("/restaurants/:restaurantId/attendance", async (req, res) => {
  const { userId } = req.query;
  const restaurantId = Number(req.params.restaurantId);
  const conditions: ReturnType<typeof eq>[] = [eq(attendanceTable.restaurantId, restaurantId)];
  if (userId) conditions.push(eq(attendanceTable.userId, Number(userId)));
  const rows = await db.select().from(attendanceTable).where(and(...conditions)).orderBy(desc(attendanceTable.clockIn));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/attendance", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const { userId, notes } = req.body;
  const [record] = await db.insert(attendanceTable).values({ userId, restaurantId: Number(req.params.restaurantId), clockIn: new Date(), notes }).returning();
  res.status(201).json(record);
});

router.patch("/restaurants/:restaurantId/attendance/:id/clock-out", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const { notes } = req.body;
  const [existing] = await db.select().from(attendanceTable).where(and(eq(attendanceTable.id, Number(req.params.id)), eq(attendanceTable.restaurantId, Number(req.params.restaurantId))));
  if (!existing) return void res.status(404).json({ error: "Not found" });

  const clockOut = new Date();
  const totalHours = ((clockOut.getTime() - existing.clockIn.getTime()) / 3600000).toFixed(2);
  const [updated] = await db.update(attendanceTable).set({ clockOut, totalHours, notes: notes ?? existing.notes, updatedAt: new Date() }).where(eq(attendanceTable.id, existing.id)).returning();
  res.json(updated);
});

router.get("/restaurants/:restaurantId/audit-logs", requireRole("owner", "manager", "super_admin"), async (req, res) => {
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
