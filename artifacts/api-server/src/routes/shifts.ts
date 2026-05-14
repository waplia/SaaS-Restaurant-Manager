import { Router } from "express";
import { eq, and, desc, gte, lte, sql, inArray, isNull } from "drizzle-orm";
import { db, shiftsTable, staffShiftsTable, attendanceTable, auditLogsTable, usersTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

const ALLOWED_STATUSES = new Set([
  "present", "late", "half_day", "absent", "weekly_off", "leave",
]);
const ALLOWED_SOURCES = new Set(["web", "mobile", "manual"]);
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WORKING_STATUSES = ["present", "late", "half_day"] as const;
const NON_WORKING_STATUSES = new Set(["absent", "weekly_off", "leave"]);

async function audit(
  restaurantId: number,
  userId: number | null,
  action: string,
  entity: string,
  entityId: number | null,
  details?: unknown,
  ip?: string,
) {
  try {
    await db.insert(auditLogsTable).values({
      restaurantId,
      userId,
      action,
      entity,
      entityId: entityId ?? undefined,
      details: details ? JSON.stringify(details) : undefined,
      ipAddress: ip,
    });
  } catch {
    // never break the request
  }
}

function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function shiftDurationMinutes(start: string, end: string): number {
  const s = parseHHMM(start) ?? 0;
  const e = parseHHMM(end) ?? 0;
  const diff = e - s;
  return diff > 0 ? diff : diff + 24 * 60;
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Verify a target userId is a member of the given restaurant. */
async function userBelongsToRestaurant(userId: number, restaurantId: number): Promise<boolean> {
  if (!userId || !restaurantId) return false;
  const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.restaurantId, restaurantId))).limit(1);
  return !!u;
}

async function usersBelongToRestaurant(userIds: number[], restaurantId: number): Promise<boolean> {
  if (userIds.length === 0) return false;
  const rows = await db.select({ id: usersTable.id }).from(usersTable).where(and(inArray(usersTable.id, userIds), eq(usersTable.restaurantId, restaurantId)));
  return rows.length === userIds.length;
}

async function shiftBelongsToRestaurant(shiftId: number, restaurantId: number): Promise<boolean> {
  if (!shiftId) return false;
  const [s] = await db.select({ id: shiftsTable.id }).from(shiftsTable).where(and(eq(shiftsTable.id, shiftId), eq(shiftsTable.restaurantId, restaurantId))).limit(1);
  return !!s;
}

/**
 * Compute attendance metrics (scheduled/late/overtime/status) for a given user
 * on a target date, optionally against a known clock-in time.
 */
async function computeAttendanceMetrics(restaurantId: number, userId: number, date: Date, clockInAt?: Date | null) {
  const assigned = await resolveAssignedShift(restaurantId, userId, date);
  let scheduledMinutes = 0;
  let lateMinutes = 0;
  let scheduledShiftId: number | undefined;
  if (assigned) {
    scheduledMinutes = shiftDurationMinutes(assigned.shift.startTime, assigned.shift.endTime);
    scheduledShiftId = assigned.shift.id;
    if (clockInAt) {
      const startMin = parseHHMM(assigned.shift.startTime) ?? 0;
      const inMin = clockInAt.getHours() * 60 + clockInAt.getMinutes();
      const diff = inMin - startMin;
      if (diff > 5) lateMinutes = diff;
    }
  }
  return { scheduledMinutes, lateMinutes, scheduledShiftId };
}

router.use(
  "/restaurants/:restaurantId",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive", "super_admin"),
  validateRestaurantAccess,
);

// ---------- Shift definitions ----------

router.get("/restaurants/:restaurantId/shifts", async (req, res) => {
  const rows = await db.select().from(shiftsTable).where(eq(shiftsTable.restaurantId, Number(req.params.restaurantId)));
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/shifts",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { name, startTime, endTime, days } = req.body ?? {};
    if (!name || !startTime || !endTime) {
      res.status(400).json({ error: "name, startTime, endTime are required" });
      return;
    }
    const [shift] = await db.insert(shiftsTable).values({ restaurantId, name, startTime, endTime, days: Array.isArray(days) ? days : [] }).returning();
    await audit(restaurantId, req.user?.sub ?? null, "create", "shift", shift.id, { name, startTime, endTime, days }, req.ip);
    res.status(201).json(shift);
  },
);

router.patch(
  "/restaurants/:restaurantId/shifts/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { name, startTime, endTime, days, isActive } = req.body ?? {};
    const [updated] = await db.update(shiftsTable).set({ name, startTime, endTime, days, isActive, updatedAt: new Date() }).where(and(eq(shiftsTable.id, id), eq(shiftsTable.restaurantId, restaurantId))).returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await audit(restaurantId, req.user?.sub ?? null, "update", "shift", id, req.body, req.ip);
    res.json(updated);
  },
);

router.delete(
  "/restaurants/:restaurantId/shifts/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    await db.update(shiftsTable).set({ isActive: false }).where(and(eq(shiftsTable.id, id), eq(shiftsTable.restaurantId, restaurantId)));
    await audit(restaurantId, req.user?.sub ?? null, "delete", "shift", id, null, req.ip);
    res.status(204).send();
  },
);

// ---------- Staff shift assignments ----------

router.get("/restaurants/:restaurantId/staff-shifts", async (req, res) => {
  const { userId } = req.query;
  const restaurantId = Number(req.params.restaurantId);
  const conditions = [eq(staffShiftsTable.restaurantId, restaurantId)];
  if (userId) conditions.push(eq(staffShiftsTable.userId, Number(userId)));
  const rows = await db.select().from(staffShiftsTable).where(and(...conditions)).orderBy(desc(staffShiftsTable.date));
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/staff-shifts",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { userId, shiftId, date, endDate, recurringDays } = req.body ?? {};
    if (!userId || !shiftId || !date) {
      res.status(400).json({ error: "userId, shiftId, date are required" });
      return;
    }
    if (!(await userBelongsToRestaurant(Number(userId), restaurantId))) {
      res.status(403).json({ error: "User does not belong to this restaurant" });
      return;
    }
    if (!(await shiftBelongsToRestaurant(Number(shiftId), restaurantId))) {
      res.status(403).json({ error: "Shift does not belong to this restaurant" });
      return;
    }
    const cleanDays = Array.isArray(recurringDays)
      ? recurringDays.filter((d: unknown) => typeof d === "string" && DAY_NAMES.includes(d))
      : [];
    const [entry] = await db.insert(staffShiftsTable).values({
      restaurantId,
      userId: Number(userId),
      shiftId: Number(shiftId),
      date: new Date(date),
      endDate: endDate ? new Date(endDate) : null,
      recurringDays: cleanDays,
    }).returning();
    await audit(restaurantId, req.user?.sub ?? null, "create", "staff_shift", entry.id, { userId, shiftId, date, endDate, recurringDays: cleanDays }, req.ip);
    res.status(201).json(entry);
  },
);

router.delete(
  "/restaurants/:restaurantId/staff-shifts/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const result = await db.delete(staffShiftsTable).where(and(eq(staffShiftsTable.id, id), eq(staffShiftsTable.restaurantId, restaurantId))).returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await audit(restaurantId, req.user?.sub ?? null, "delete", "staff_shift", id, null, req.ip);
    res.status(204).send();
  },
);

/**
 * Resolve the assigned shift for a user on a given date.
 * Matches either an exact-date assignment, or a recurring assignment whose
 * date <= target <= endDate (or no endDate) AND target's weekday is in recurringDays.
 */
async function resolveAssignedShift(restaurantId: number, userId: number, date: Date) {
  const rows = await db.select().from(staffShiftsTable).where(
    and(eq(staffShiftsTable.restaurantId, restaurantId), eq(staffShiftsTable.userId, userId)),
  );
  const targetYMD = toYMD(date);
  const targetDay = DAY_NAMES[date.getDay()];
  let assignment: typeof rows[number] | null = null;
  for (const r of rows) {
    const startYMD = toYMD(r.date);
    if (startYMD === targetYMD) {
      assignment = r;
      break;
    }
    const days = (r.recurringDays ?? []) as string[];
    if (days.length === 0) continue;
    const inRange = startYMD <= targetYMD && (!r.endDate || toYMD(r.endDate) >= targetYMD);
    if (inRange && days.includes(targetDay)) {
      assignment = r;
      // don't break — prefer exact-date if found later
    }
  }
  if (!assignment) return null;
  const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, assignment.shiftId));
  return shift ? { assignment, shift } : null;
}

// ---------- Attendance ----------

router.get("/restaurants/:restaurantId/attendance", async (req, res) => {
  const { userId, from, to } = req.query;
  const restaurantId = Number(req.params.restaurantId);
  const conditions = [eq(attendanceTable.restaurantId, restaurantId)];
  if (userId) conditions.push(eq(attendanceTable.userId, Number(userId)));
  if (from) conditions.push(gte(attendanceTable.clockIn, new Date(String(from))));
  if (to) conditions.push(lte(attendanceTable.clockIn, new Date(String(to))));
  const rows = await db.select().from(attendanceTable).where(and(...conditions)).orderBy(desc(attendanceTable.clockIn));
  res.json(rows);
});

async function performPunchIn(restaurantId: number, targetUserId: number, callerId: number, source: string, notes: string | null, ip?: string) {
  // Block double punch-in: ANY truly open punch session (handles overnight shifts).
  // Non-working manual rows (absent/weekly_off/leave) are NEVER considered open.
  const [open] = await db.select().from(attendanceTable).where(and(
    eq(attendanceTable.restaurantId, restaurantId),
    eq(attendanceTable.userId, targetUserId),
    isNull(attendanceTable.clockOut),
    inArray(attendanceTable.status, [...WORKING_STATUSES]),
  )).orderBy(desc(attendanceTable.clockIn)).limit(1);
  if (open) {
    return { existing: true, record: open };
  }

  const now = new Date();
  const { scheduledMinutes, lateMinutes, scheduledShiftId } = await computeAttendanceMetrics(restaurantId, targetUserId, now, now);
  const status: "present" | "late" = lateMinutes > 0 ? "late" : "present";

  const [record] = await db.insert(attendanceTable).values({
    userId: targetUserId,
    restaurantId,
    date: now,
    clockIn: now,
    status,
    scheduledShiftId,
    scheduledMinutes,
    lateMinutes,
    source,
    markedByUserId: callerId || null,
    notes,
  }).returning();
  await audit(restaurantId, callerId || null, "create", "attendance", record.id, { userId: targetUserId, source, status, lateMinutes }, ip);
  return { existing: false, record };
}

/**
 * Legacy clock-in endpoint preserved for backwards compatibility.
 * Delegates to punch-in semantics (blocks double-punch).
 */
router.post(
  "/restaurants/:restaurantId/attendance",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const callerId = req.user?.sub ?? 0;
    const isPrivileged = req.user?.isSuperAdmin || ["owner", "manager", "super_admin"].includes(req.user?.role ?? "");
    const targetUserId = Number(req.body?.userId ?? callerId);
    if (!isPrivileged && targetUserId !== callerId) {
      res.status(403).json({ error: "Cannot clock in for another user" });
      return;
    }
    if (targetUserId !== callerId && !(await userBelongsToRestaurant(targetUserId, restaurantId))) {
      res.status(403).json({ error: "Target user not in this restaurant" });
      return;
    }
    const source = req.body?.source && ALLOWED_SOURCES.has(req.body.source) ? req.body.source : "web";
    const { existing, record } = await performPunchIn(restaurantId, targetUserId, callerId, source, req.body?.notes ?? null, req.ip);
    res.status(existing ? 200 : 201).json(record);
  },
);

router.post(
  "/restaurants/:restaurantId/attendance/punch-in",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const callerId = req.user?.sub ?? 0;
    const isPrivileged = req.user?.isSuperAdmin || ["owner", "manager", "super_admin"].includes(req.user?.role ?? "");
    const targetUserId = Number(req.body?.userId ?? callerId);
    if (!isPrivileged && targetUserId !== callerId) {
      res.status(403).json({ error: "Cannot punch in for another user" });
      return;
    }
    if (targetUserId !== callerId && !(await userBelongsToRestaurant(targetUserId, restaurantId))) {
      res.status(403).json({ error: "Target user not in this restaurant" });
      return;
    }
    const source = req.body?.source && ALLOWED_SOURCES.has(req.body.source) ? req.body.source : "web";
    const { existing, record } = await performPunchIn(restaurantId, targetUserId, callerId, source, req.body?.notes ?? null, req.ip);
    res.status(existing ? 200 : 201).json(record);
  },
);

router.patch(
  "/restaurants/:restaurantId/attendance/:id/clock-out",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const callerId = req.user?.sub ?? 0;
    const isPrivileged = req.user?.isSuperAdmin || ["owner", "manager", "super_admin"].includes(req.user?.role ?? "");
    const { notes } = req.body ?? {};
    const [existing] = await db.select().from(attendanceTable).where(and(eq(attendanceTable.id, id), eq(attendanceTable.restaurantId, restaurantId)));
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!isPrivileged && existing.userId !== callerId) {
      res.status(403).json({ error: "Cannot clock out for another user" });
      return;
    }

    const clockOut = new Date();
    const workedMs = clockOut.getTime() - existing.clockIn.getTime();
    const workedMinutes = Math.max(0, Math.round(workedMs / 60000));
    const totalHours = (workedMinutes / 60).toFixed(2);
    const scheduledMinutes = existing.scheduledMinutes ?? 0;
    const overtimeMinutes = scheduledMinutes > 0 ? Math.max(0, workedMinutes - scheduledMinutes) : 0;
    let status = existing.status;
    if (scheduledMinutes > 0 && workedMinutes < scheduledMinutes / 2) {
      status = "half_day";
    }

    const [updated] = await db.update(attendanceTable).set({
      clockOut,
      totalHours,
      workedMinutes,
      overtimeMinutes,
      status,
      notes: notes ?? existing.notes,
      updatedAt: new Date(),
    }).where(eq(attendanceTable.id, existing.id)).returning();
    await audit(restaurantId, callerId || null, "update", "attendance", id, { event: "clock_out", workedMinutes, overtimeMinutes, status }, req.ip);
    res.json(updated);
  },
);

router.post(
  "/restaurants/:restaurantId/attendance/punch-out",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const callerId = req.user?.sub ?? 0;
    const isPrivileged = req.user?.isSuperAdmin || ["owner", "manager", "super_admin"].includes(req.user?.role ?? "");
    const targetUserId = Number(req.body?.userId ?? callerId);
    if (!isPrivileged && targetUserId !== callerId) {
      res.status(403).json({ error: "Cannot punch out for another user" });
      return;
    }
    if (targetUserId !== callerId && !(await userBelongsToRestaurant(targetUserId, restaurantId))) {
      res.status(403).json({ error: "Target user not in this restaurant" });
      return;
    }
    // Find ANY truly open punch session (working-status only; supports overnight shifts).
    const [open] = await db.select().from(attendanceTable).where(and(
      eq(attendanceTable.restaurantId, restaurantId),
      eq(attendanceTable.userId, targetUserId),
      isNull(attendanceTable.clockOut),
      inArray(attendanceTable.status, [...WORKING_STATUSES]),
    )).orderBy(desc(attendanceTable.clockIn)).limit(1);
    if (!open) {
      res.status(404).json({ error: "No open session to punch out" });
      return;
    }

    const clockOut = new Date();
    const workedMs = clockOut.getTime() - open.clockIn.getTime();
    const workedMinutes = Math.max(0, Math.round(workedMs / 60000));
    const totalHours = (workedMinutes / 60).toFixed(2);
    const scheduledMinutes = open.scheduledMinutes ?? 0;
    const overtimeMinutes = scheduledMinutes > 0 ? Math.max(0, workedMinutes - scheduledMinutes) : 0;
    let status = open.status;
    if (scheduledMinutes > 0 && workedMinutes < scheduledMinutes / 2) {
      status = "half_day";
    }

    const [updated] = await db.update(attendanceTable).set({
      clockOut,
      totalHours,
      workedMinutes,
      overtimeMinutes,
      status,
      notes: req.body?.notes ?? open.notes,
      updatedAt: new Date(),
    }).where(eq(attendanceTable.id, open.id)).returning();
    await audit(restaurantId, callerId || null, "update", "attendance", open.id, { event: "punch_out", workedMinutes, overtimeMinutes, status }, req.ip);
    res.json(updated);
  },
);

/**
 * Manual mark — manager/owner records an attendance status without punch.
 * Supports backdating via `date`. Use this for absent, weekly_off, leave.
 */
router.post(
  "/restaurants/:restaurantId/attendance/mark",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const callerId = req.user?.sub ?? null;
    const { userId, date, status, notes, workedMinutes } = req.body ?? {};
    if (!userId || !date || !status || !ALLOWED_STATUSES.has(status)) {
      res.status(400).json({ error: "userId, date and a valid status are required" });
      return;
    }
    if (!(await userBelongsToRestaurant(Number(userId), restaurantId))) {
      res.status(403).json({ error: "Target user not in this restaurant" });
      return;
    }
    const day = new Date(date);
    if (Number.isNaN(day.getTime())) {
      res.status(400).json({ error: "Invalid date" });
      return;
    }
    day.setHours(9, 0, 0, 0); // place at 9 AM so it sorts as a "day record"

    // Resolve scheduled shift for this date so worked vs. scheduled / overtime make sense.
    const { scheduledMinutes, scheduledShiftId } = await computeAttendanceMetrics(restaurantId, Number(userId), day);

    // If a record already exists for that calendar date, update it (upsert by user+date).
    const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
    const [existing] = await db.select().from(attendanceTable).where(and(
      eq(attendanceTable.restaurantId, restaurantId),
      eq(attendanceTable.userId, Number(userId)),
      gte(attendanceTable.clockIn, dayStart),
      lte(attendanceTable.clockIn, dayEnd),
    )).limit(1);

    // Non-working statuses zero out worked/overtime so payroll never carries stale hours.
    const isNonWorking = NON_WORKING_STATUSES.has(status);
    const w = isNonWorking
      ? 0
      : (typeof workedMinutes === "number" && workedMinutes >= 0 ? Math.round(workedMinutes) : 0);
    const overtimeMinutes = !isNonWorking && scheduledMinutes > 0 && w > scheduledMinutes ? w - scheduledMinutes : 0;

    if (existing) {
      const [updated] = await db.update(attendanceTable).set({
        status,
        scheduledShiftId: scheduledShiftId ?? existing.scheduledShiftId,
        scheduledMinutes: isNonWorking ? 0 : (scheduledMinutes || existing.scheduledMinutes),
        workedMinutes: isNonWorking ? 0 : (w || existing.workedMinutes),
        overtimeMinutes: isNonWorking ? 0 : (w ? overtimeMinutes : existing.overtimeMinutes),
        lateMinutes: isNonWorking ? 0 : existing.lateMinutes,
        totalHours: isNonWorking ? "0" : (w ? (w / 60).toFixed(2) : existing.totalHours),
        // For non-working statuses, force clockOut=clockIn so the row is never
        // mistaken for an open punch session.
        clockOut: isNonWorking ? existing.clockIn : existing.clockOut,
        notes: notes ?? existing.notes,
        markedByUserId: callerId,
        source: "manual",
        updatedAt: new Date(),
      }).where(eq(attendanceTable.id, existing.id)).returning();
      await audit(restaurantId, callerId, "update", "attendance", existing.id, { event: "mark", status }, req.ip);
      res.json(updated);
      return;
    }

    const [record] = await db.insert(attendanceTable).values({
      userId: Number(userId),
      restaurantId,
      date: day,
      clockIn: day,
      // Non-working manual rows are closed (clockOut=clockIn) so they never
      // surface as open punch sessions.
      clockOut: isNonWorking ? day : null,
      status,
      scheduledShiftId: isNonWorking ? null : scheduledShiftId,
      scheduledMinutes: isNonWorking ? 0 : scheduledMinutes,
      workedMinutes: w,
      overtimeMinutes,
      totalHours: (w / 60).toFixed(2),
      source: "manual",
      markedByUserId: callerId,
      notes: notes ?? null,
    }).returning();
    await audit(restaurantId, callerId, "create", "attendance", record.id, { event: "mark", userId, status }, req.ip);
    res.status(201).json(record);
  },
);

/**
 * Bulk weekly-off marker: marks one or more userIds with status=weekly_off for a single date.
 */
router.post(
  "/restaurants/:restaurantId/attendance/weekly-off",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const callerId = req.user?.sub ?? null;
    const { userIds, date } = req.body ?? {};
    if (!Array.isArray(userIds) || userIds.length === 0 || !date) {
      res.status(400).json({ error: "userIds[] and date are required" });
      return;
    }
    const numericIds = userIds.map((u: unknown) => Number(u)).filter((n) => Number.isFinite(n));
    if (!(await usersBelongToRestaurant(numericIds, restaurantId))) {
      res.status(403).json({ error: "One or more users do not belong to this restaurant" });
      return;
    }
    const day = new Date(date);
    if (Number.isNaN(day.getTime())) {
      res.status(400).json({ error: "Invalid date" });
      return;
    }
    day.setHours(9, 0, 0, 0);
    const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
    // Upsert by (user, day) to avoid duplicate rows.
    const result = [];
    for (const uid of numericIds) {
      const [existing] = await db.select().from(attendanceTable).where(and(
        eq(attendanceTable.restaurantId, restaurantId),
        eq(attendanceTable.userId, uid),
        gte(attendanceTable.clockIn, dayStart),
        lte(attendanceTable.clockIn, dayEnd),
      )).limit(1);
      if (existing) {
        const [updated] = await db.update(attendanceTable).set({
          status: "weekly_off",
          workedMinutes: 0,
          overtimeMinutes: 0,
          lateMinutes: 0,
          scheduledMinutes: 0,
          scheduledShiftId: null,
          // Close the row so it never appears as an open punch session.
          clockOut: existing.clockIn,
          totalHours: "0",
          source: "manual",
          markedByUserId: callerId,
          updatedAt: new Date(),
        }).where(eq(attendanceTable.id, existing.id)).returning();
        result.push(updated);
      } else {
        const [created] = await db.insert(attendanceTable).values({
          userId: uid,
          restaurantId,
          date: day,
          clockIn: day,
          clockOut: day,
          status: "weekly_off",
          source: "manual",
          markedByUserId: callerId,
        }).returning();
        result.push(created);
      }
    }
    await audit(restaurantId, callerId, "create", "attendance", null, { event: "weekly_off_bulk", count: result.length, date }, req.ip);
    res.status(201).json(result);
  },
);

router.patch(
  "/restaurants/:restaurantId/attendance/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const callerId = req.user?.sub ?? null;
    const { status, notes, workedMinutes, overtimeMinutes, lateMinutes, clockIn, clockOut } = req.body ?? {};
    if (status && !ALLOWED_STATUSES.has(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    // Load existing (tenant-scoped) first so we can recompute against scheduled shift.
    const [existing] = await db.select().from(attendanceTable).where(and(eq(attendanceTable.id, id), eq(attendanceTable.restaurantId, restaurantId)));
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const patch: Record<string, unknown> = { updatedAt: new Date(), markedByUserId: callerId };
    if (status !== undefined) patch.status = status;
    if (notes !== undefined) patch.notes = notes;

    const newClockIn = clockIn ? new Date(clockIn) : existing.clockIn;
    let newClockOut = clockOut === null ? null : (clockOut ? new Date(clockOut) : existing.clockOut);
    // If transitioning to a non-working status, force the row closed so it never
    // surfaces as an open punch session.
    const newStatus = status ?? existing.status;
    if (NON_WORKING_STATUSES.has(newStatus)) {
      newClockOut = newClockOut ?? newClockIn;
    }
    if (clockIn) patch.clockIn = newClockIn;
    if (clockOut !== undefined || NON_WORKING_STATUSES.has(newStatus)) patch.clockOut = newClockOut;

    // Recompute scheduled/late against assigned shift for the date of the record.
    const targetDate = existing.date ?? existing.clockIn;
    const metrics = await computeAttendanceMetrics(restaurantId, existing.userId, targetDate, newClockIn);
    patch.scheduledShiftId = metrics.scheduledShiftId ?? existing.scheduledShiftId;
    patch.scheduledMinutes = metrics.scheduledMinutes || existing.scheduledMinutes;
    patch.lateMinutes = typeof lateMinutes === "number" ? lateMinutes : metrics.lateMinutes;

    // Worked minutes: prefer explicit, else derive from clockIn/clockOut.
    let w = existing.workedMinutes ?? 0;
    if (typeof workedMinutes === "number") {
      w = Math.max(0, Math.round(workedMinutes));
    } else if (newClockOut) {
      w = Math.max(0, Math.round((newClockOut.getTime() - newClockIn.getTime()) / 60000));
    }
    patch.workedMinutes = w;
    patch.totalHours = (w / 60).toFixed(2);

    const sched = (patch.scheduledMinutes as number) ?? 0;
    if (typeof overtimeMinutes === "number") {
      patch.overtimeMinutes = overtimeMinutes;
    } else {
      patch.overtimeMinutes = sched > 0 && w > sched ? w - sched : 0;
    }

    const [updated] = await db.update(attendanceTable).set(patch).where(eq(attendanceTable.id, existing.id)).returning();
    await audit(restaurantId, callerId, "update", "attendance", id, req.body, req.ip);
    res.json(updated);
  },
);

router.delete(
  "/restaurants/:restaurantId/attendance/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const result = await db.delete(attendanceTable).where(and(eq(attendanceTable.id, id), eq(attendanceTable.restaurantId, restaurantId))).returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await audit(restaurantId, req.user?.sub ?? null, "delete", "attendance", id, null, req.ip);
    res.status(204).send();
  },
);

/**
 * Current open punch session for the authenticated user (used by mobile My Shift screen).
 */
router.get("/restaurants/:restaurantId/attendance/my-active", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const callerId = req.user?.sub ?? 0;
  // ANY truly open punch session (working-status only; supports overnight shifts).
  const [open] = await db.select().from(attendanceTable).where(and(
    eq(attendanceTable.restaurantId, restaurantId),
    eq(attendanceTable.userId, callerId),
    isNull(attendanceTable.clockOut),
    inArray(attendanceTable.status, [...WORKING_STATUSES]),
  )).orderBy(desc(attendanceTable.clockIn)).limit(1);

  const now = new Date();
  const assigned = await resolveAssignedShift(restaurantId, callerId, now);
  res.json({
    open: open ?? null,
    todayShift: assigned ? assigned.shift : null,
  });
});

router.get("/restaurants/:restaurantId/audit-logs", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { userId, action, page, limit } = req.query;
  const pg = Number(page) || 1;
  const lim = Number(limit) || 50;
  const offset = (pg - 1) * lim;
  const restaurantId = Number(req.params.restaurantId);

  const conditions = [eq(auditLogsTable.restaurantId, restaurantId)];
  if (userId) conditions.push(eq(auditLogsTable.userId, Number(userId)));
  if (action) conditions.push(eq(auditLogsTable.action, String(action)));

  const rows = await db.select().from(auditLogsTable).where(and(...conditions)).orderBy(desc(auditLogsTable.createdAt)).limit(lim).offset(offset);
  res.json(rows);
});

export default router;
