import { Router } from "express";
import { and, desc, eq, gte, lte, sql, isNull, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  staffTable,
  attendanceTable,
  shiftsTable,
  staffShiftsTable,
  leavePoliciesTable,
  leaveBalancesTable,
  leaveRequestsTable,
  payrollItemsTable,
  payrollRunsTable,
  payrollPaymentsTable,
  performanceNotesTable,
  announcementsTable,
  announcementReadsTable,
  staffTasksTable,
  shiftSwapRequestsTable,
  attendanceSelfiesTable,
  payrollSlipQueriesTable,
  incentiveProgramsTable,
  incentivePayoutsTable,
  staffDocumentsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";

const router = Router();

/**
 * Staff portal API. All routes here are scoped to the *calling* user's own
 * data ("me" semantics) — there is no restaurantId in the path because the
 * caller's identity already ties them to a restaurant. Owner/manager are
 * also allowed (so they can preview the portal). Privileged management
 * endpoints (e.g. announcement create, task assignment, swap approval) are
 * additionally role-gated.
 */
const ANY_AUTH = requireRole(
  "owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive", "super_admin",
);
const PRIVILEGED = requireRole("owner", "manager", "super_admin");

router.use("/portal", ANY_AUTH);

function meCtx(req: import("express").Request) {
  const userId = req.user?.sub ?? 0;
  const restaurantId = req.user?.restaurantId ?? 0;
  return { userId, restaurantId };
}

// ---------- Profile / me ----------
router.get("/portal/me", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return void res.status(404).json({ error: "Not found" });
  const [staff] = await db.select().from(staffTable).where(and(eq(staffTable.userId, userId), eq(staffTable.restaurantId, restaurantId)));
  res.json({
    user: {
      id: user.id, name: user.name, email: user.email, phone: user.phone,
      role: user.role, avatarUrl: user.avatarUrl, restaurantId: user.restaurantId,
    },
    staff: staff ? {
      employeeCode: staff.employeeCode, jobTitle: staff.jobTitle, department: staff.department,
      hiredAt: staff.hiredAt,
      emergencyContact: staff.emergencyContact, emergencyContactName: staff.emergencyContactName,
      emergencyContactRelation: staff.emergencyContactRelation,
    } : null,
  });
});

// ---------- Attendance ----------
router.get("/portal/attendance/active", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const [open] = await db.select().from(attendanceTable).where(and(
    eq(attendanceTable.restaurantId, restaurantId),
    eq(attendanceTable.userId, userId),
    isNull(attendanceTable.clockOut),
  )).orderBy(desc(attendanceTable.clockIn)).limit(1);
  res.json(open ?? null);
});

router.get("/portal/attendance", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const limit = Math.min(Number(req.query.limit ?? 60), 200);
  const rows = await db.select().from(attendanceTable).where(and(
    eq(attendanceTable.restaurantId, restaurantId),
    eq(attendanceTable.userId, userId),
  )).orderBy(desc(attendanceTable.clockIn)).limit(limit);
  res.json(rows);
});

router.post("/portal/attendance/clock-in", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  if (!restaurantId) return void res.status(400).json({ error: "No restaurant" });
  const { latitude, longitude, accuracyMeters, selfieUrl, withinGeofence } = req.body ?? {};

  const [open] = await db.select().from(attendanceTable).where(and(
    eq(attendanceTable.restaurantId, restaurantId),
    eq(attendanceTable.userId, userId),
    isNull(attendanceTable.clockOut),
  )).orderBy(desc(attendanceTable.clockIn)).limit(1);
  if (open) return void res.json({ existing: true, attendance: open });

  const now = new Date();
  const [record] = await db.insert(attendanceTable).values({
    userId, restaurantId, date: now, clockIn: now, status: "present",
    source: "portal", markedByUserId: userId,
  }).returning();
  if (selfieUrl || latitude || longitude) {
    await db.insert(attendanceSelfiesTable).values({
      attendanceId: record.id, restaurantId, userId, kind: "clock_in",
      fileUrl: selfieUrl ?? null,
      latitude: latitude != null ? String(latitude) : null,
      longitude: longitude != null ? String(longitude) : null,
      accuracyMeters: accuracyMeters != null ? String(accuracyMeters) : null,
      withinGeofence: typeof withinGeofence === "boolean" ? withinGeofence : null,
    });
  }
  res.status(201).json({ existing: false, attendance: record });
});

router.post("/portal/attendance/clock-out", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const { latitude, longitude, accuracyMeters, selfieUrl, withinGeofence, notes } = req.body ?? {};

  const [open] = await db.select().from(attendanceTable).where(and(
    eq(attendanceTable.restaurantId, restaurantId),
    eq(attendanceTable.userId, userId),
    isNull(attendanceTable.clockOut),
  )).orderBy(desc(attendanceTable.clockIn)).limit(1);
  if (!open) return void res.status(404).json({ error: "No open session" });

  const clockOut = new Date();
  const workedMinutes = Math.max(0, Math.round((clockOut.getTime() - open.clockIn.getTime()) / 60000));
  const totalHours = (workedMinutes / 60).toFixed(2);
  const scheduledMinutes = open.scheduledMinutes ?? 0;
  const overtimeMinutes = scheduledMinutes > 0 ? Math.max(0, workedMinutes - scheduledMinutes) : 0;
  const [updated] = await db.update(attendanceTable).set({
    clockOut, totalHours, workedMinutes, overtimeMinutes,
    notes: notes ?? open.notes, updatedAt: new Date(),
  }).where(eq(attendanceTable.id, open.id)).returning();
  if (selfieUrl || latitude || longitude) {
    await db.insert(attendanceSelfiesTable).values({
      attendanceId: open.id, restaurantId, userId, kind: "clock_out",
      fileUrl: selfieUrl ?? null,
      latitude: latitude != null ? String(latitude) : null,
      longitude: longitude != null ? String(longitude) : null,
      accuracyMeters: accuracyMeters != null ? String(accuracyMeters) : null,
      withinGeofence: typeof withinGeofence === "boolean" ? withinGeofence : null,
    });
  }
  res.json(updated);
});

// ---------- Shifts ----------
router.get("/portal/shifts", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const rows = await db.select({
    id: staffShiftsTable.id, date: staffShiftsTable.date, endDate: staffShiftsTable.endDate,
    recurringDays: staffShiftsTable.recurringDays,
    shiftId: shiftsTable.id, shiftName: shiftsTable.name,
    startTime: shiftsTable.startTime, endTime: shiftsTable.endTime, days: shiftsTable.days,
  })
    .from(staffShiftsTable)
    .innerJoin(shiftsTable, eq(shiftsTable.id, staffShiftsTable.shiftId))
    .where(and(eq(staffShiftsTable.userId, userId), eq(staffShiftsTable.restaurantId, restaurantId)))
    .orderBy(desc(staffShiftsTable.date));
  res.json(rows);
});

router.get("/portal/shift-swaps", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const rows = await db.select().from(shiftSwapRequestsTable).where(and(
    eq(shiftSwapRequestsTable.restaurantId, restaurantId),
    eq(shiftSwapRequestsTable.requesterUserId, userId),
  )).orderBy(desc(shiftSwapRequestsTable.createdAt));
  res.json(rows);
});

router.post("/portal/shift-swaps", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const { kind, shiftDate, shiftId, targetUserId, reason } = req.body ?? {};
  if (!shiftDate) return void res.status(400).json({ error: "shiftDate required" });
  const k = kind === "swap" ? "swap" : "unavailable";
  const [row] = await db.insert(shiftSwapRequestsTable).values({
    restaurantId, requesterUserId: userId, kind: k,
    shiftDate: new Date(String(shiftDate)),
    shiftId: shiftId ? Number(shiftId) : null,
    targetUserId: targetUserId ? Number(targetUserId) : null,
    reason: reason ? String(reason) : null,
  }).returning();
  res.status(201).json(row);
});

router.post("/portal/shift-swaps/:id/cancel", async (req, res) => {
  const { userId } = meCtx(req);
  const id = Number(req.params.id);
  const [row] = await db.select().from(shiftSwapRequestsTable).where(eq(shiftSwapRequestsTable.id, id));
  if (!row || row.requesterUserId !== userId) return void res.status(404).json({ error: "Not found" });
  if (row.status !== "pending") return void res.status(400).json({ error: "Already decided" });
  const [u] = await db.update(shiftSwapRequestsTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(shiftSwapRequestsTable.id, id)).returning();
  res.json(u);
});

// Manager view of pending swaps for the restaurant
router.get("/portal/admin/shift-swaps", PRIVILEGED, async (req, res) => {
  const { restaurantId } = meCtx(req);
  const rows = await db.select({
    id: shiftSwapRequestsTable.id, kind: shiftSwapRequestsTable.kind,
    shiftDate: shiftSwapRequestsTable.shiftDate, shiftId: shiftSwapRequestsTable.shiftId,
    requesterUserId: shiftSwapRequestsTable.requesterUserId,
    requesterName: usersTable.name,
    targetUserId: shiftSwapRequestsTable.targetUserId,
    reason: shiftSwapRequestsTable.reason, status: shiftSwapRequestsTable.status,
    decidedAt: shiftSwapRequestsTable.decidedAt, decisionNote: shiftSwapRequestsTable.decisionNote,
    createdAt: shiftSwapRequestsTable.createdAt,
  })
    .from(shiftSwapRequestsTable)
    .innerJoin(usersTable, eq(usersTable.id, shiftSwapRequestsTable.requesterUserId))
    .where(eq(shiftSwapRequestsTable.restaurantId, restaurantId))
    .orderBy(desc(shiftSwapRequestsTable.createdAt));
  res.json(rows);
});

router.post("/portal/admin/shift-swaps/:id/decide", PRIVILEGED, async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const id = Number(req.params.id);
  const { decision, note } = req.body ?? {};
  if (!["approved", "rejected"].includes(decision)) return void res.status(400).json({ error: "Invalid decision" });
  const [row] = await db.select().from(shiftSwapRequestsTable).where(and(eq(shiftSwapRequestsTable.id, id), eq(shiftSwapRequestsTable.restaurantId, restaurantId)));
  if (!row) return void res.status(404).json({ error: "Not found" });
  const [u] = await db.update(shiftSwapRequestsTable).set({
    status: decision, decidedByUserId: userId, decidedAt: new Date(),
    decisionNote: note ? String(note) : null, updatedAt: new Date(),
  }).where(eq(shiftSwapRequestsTable.id, id)).returning();
  res.json(u);
});

// ---------- Leaves ----------
router.get("/portal/leave-balances", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const year = Number(req.query.year ?? new Date().getFullYear());
  const policies = await db.select().from(leavePoliciesTable).where(and(
    eq(leavePoliciesTable.restaurantId, restaurantId),
    eq(leavePoliciesTable.isActive, true),
  ));
  const balances = await db.select().from(leaveBalancesTable).where(and(
    eq(leaveBalancesTable.restaurantId, restaurantId),
    eq(leaveBalancesTable.userId, userId),
    eq(leaveBalancesTable.year, year),
  ));
  const byType = new Map(balances.map(b => [b.leaveType, b]));
  res.json(policies.map(p => {
    const b = byType.get(p.leaveType);
    const opening = Number(b?.opening ?? p.entitlementDays ?? 0);
    const used = Number(b?.used ?? 0);
    return {
      leaveType: p.leaveType, label: p.label, isPaid: p.isPaid,
      entitlement: p.entitlementDays, opening, used, remaining: opening - used,
    };
  }));
});

router.get("/portal/leave-requests", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const rows = await db.select().from(leaveRequestsTable).where(and(
    eq(leaveRequestsTable.restaurantId, restaurantId),
    eq(leaveRequestsTable.userId, userId),
  )).orderBy(desc(leaveRequestsTable.createdAt));
  res.json(rows);
});

router.post("/portal/leave-requests", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const { leaveType, fromDate, toDate, halfDay, reason } = req.body ?? {};
  if (!leaveType || !fromDate || !toDate) return void res.status(400).json({ error: "leaveType, fromDate, toDate required" });
  const from = new Date(String(fromDate));
  const to = new Date(String(toDate));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return void res.status(400).json({ error: "Invalid date range" });
  }
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
  const totalDays = halfDay ? "0.5" : String(days);
  const [row] = await db.insert(leaveRequestsTable).values({
    userId, restaurantId, leaveType: String(leaveType),
    fromDate: from, toDate: to, halfDay: !!halfDay, totalDays, reason: reason ? String(reason) : null,
    status: "pending",
  }).returning();
  res.status(201).json(row);
});

router.post("/portal/leave-requests/:id/cancel", async (req, res) => {
  const { userId } = meCtx(req);
  const id = Number(req.params.id);
  const [row] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
  if (!row || row.userId !== userId) return void res.status(404).json({ error: "Not found" });
  if (row.status !== "pending") return void res.status(400).json({ error: "Already decided" });
  const [u] = await db.update(leaveRequestsTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(leaveRequestsTable.id, id)).returning();
  res.json(u);
});

// ---------- Payroll (self) ----------
router.get("/portal/payroll-slips", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const rows = await db.select({
    id: payrollItemsTable.id, runId: payrollItemsTable.runId,
    grossPay: payrollItemsTable.grossPay, netPay: payrollItemsTable.netPay,
    paidAmount: payrollItemsTable.paidAmount, paymentStatus: payrollItemsTable.paymentStatus,
    daysWorked: payrollItemsTable.daysWorked, daysAbsent: payrollItemsTable.daysAbsent,
    advanceSettled: payrollItemsTable.advanceSettled,
    runStatus: payrollRunsTable.status,
    periodYear: payrollRunsTable.periodYear, periodMonth: payrollRunsTable.periodMonth,
    finalizedAt: payrollRunsTable.finalizedAt,
  })
    .from(payrollItemsTable)
    .innerJoin(payrollRunsTable, eq(payrollRunsTable.id, payrollItemsTable.runId))
    .where(and(
      eq(payrollItemsTable.restaurantId, restaurantId),
      eq(payrollItemsTable.userId, userId),
    ))
    .orderBy(desc(payrollRunsTable.periodYear), desc(payrollRunsTable.periodMonth));
  // Hide draft slips from staff (only owner/manager can see drafts)
  const isPriv = req.user?.isSuperAdmin || ["owner", "manager"].includes(req.user?.role ?? "");
  res.json(isPriv ? rows : rows.filter(r => r.runStatus === "finalized"));
});

router.get("/portal/payroll-slips/:itemId/payments", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const itemId = Number(req.params.itemId);
  const [item] = await db.select().from(payrollItemsTable).where(and(
    eq(payrollItemsTable.id, itemId),
    eq(payrollItemsTable.restaurantId, restaurantId),
    eq(payrollItemsTable.userId, userId),
  ));
  if (!item) return void res.status(404).json({ error: "Not found" });
  const payments = await db.select().from(payrollPaymentsTable)
    .where(eq(payrollPaymentsTable.itemId, itemId))
    .orderBy(desc(payrollPaymentsTable.paidOn));
  res.json(payments);
});

router.post("/portal/payroll-slips/:itemId/queries", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const itemId = Number(req.params.itemId);
  const { body } = req.body ?? {};
  if (!body || typeof body !== "string") return void res.status(400).json({ error: "body required" });
  const [item] = await db.select().from(payrollItemsTable).where(and(
    eq(payrollItemsTable.id, itemId),
    eq(payrollItemsTable.restaurantId, restaurantId),
    eq(payrollItemsTable.userId, userId),
  ));
  if (!item) return void res.status(404).json({ error: "Not found" });
  const [row] = await db.insert(payrollSlipQueriesTable).values({
    restaurantId, userId, payrollItemId: itemId, body: body.trim(),
  }).returning();
  res.status(201).json(row);
});

router.get("/portal/payroll-slips/:itemId/queries", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const itemId = Number(req.params.itemId);
  const rows = await db.select().from(payrollSlipQueriesTable).where(and(
    eq(payrollSlipQueriesTable.restaurantId, restaurantId),
    eq(payrollSlipQueriesTable.userId, userId),
    eq(payrollSlipQueriesTable.payrollItemId, itemId),
  )).orderBy(desc(payrollSlipQueriesTable.createdAt));
  res.json(rows);
});

// ---------- Tasks ----------
router.get("/portal/tasks", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const status = req.query.status as string | undefined;
  const where = [eq(staffTasksTable.restaurantId, restaurantId), eq(staffTasksTable.assigneeUserId, userId)];
  if (status) where.push(eq(staffTasksTable.status, status));
  const rows = await db.select().from(staffTasksTable).where(and(...where)).orderBy(desc(staffTasksTable.createdAt));
  res.json(rows);
});

router.post("/portal/tasks/:id/status", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  if (!["open", "in_progress", "done", "cancelled"].includes(status)) {
    return void res.status(400).json({ error: "Invalid status" });
  }
  const [row] = await db.select().from(staffTasksTable).where(and(
    eq(staffTasksTable.id, id),
    eq(staffTasksTable.restaurantId, restaurantId),
    eq(staffTasksTable.assigneeUserId, userId),
  ));
  if (!row) return void res.status(404).json({ error: "Not found" });

  const completedAt = status === "done" ? new Date() : null;
  const [u] = await db.update(staffTasksTable).set({
    status, completedAt, updatedAt: new Date(),
  }).where(eq(staffTasksTable.id, id)).returning();

  // Auto-create next occurrence for recurring tasks on completion
  if (status === "done" && row.recurrence && row.recurrence !== "none" && row.dueAt) {
    const next = new Date(row.dueAt);
    if (row.recurrence === "daily") next.setDate(next.getDate() + 1);
    else if (row.recurrence === "weekly") next.setDate(next.getDate() + 7);
    else if (row.recurrence === "monthly") next.setMonth(next.getMonth() + 1);
    await db.insert(staffTasksTable).values({
      restaurantId: row.restaurantId, assigneeUserId: row.assigneeUserId,
      createdByUserId: row.createdByUserId, title: row.title, description: row.description,
      priority: row.priority, status: "open", dueAt: next, recurrence: row.recurrence,
      parentTaskId: row.parentTaskId ?? row.id,
    });
  }
  res.json(u);
});

// Manager: list/create tasks for any staff in restaurant
router.get("/portal/admin/tasks", PRIVILEGED, async (req, res) => {
  const { restaurantId } = meCtx(req);
  const rows = await db.select({
    id: staffTasksTable.id, title: staffTasksTable.title, status: staffTasksTable.status,
    priority: staffTasksTable.priority, dueAt: staffTasksTable.dueAt,
    recurrence: staffTasksTable.recurrence,
    assigneeUserId: staffTasksTable.assigneeUserId, assigneeName: usersTable.name,
    completedAt: staffTasksTable.completedAt, createdAt: staffTasksTable.createdAt,
  })
    .from(staffTasksTable)
    .innerJoin(usersTable, eq(usersTable.id, staffTasksTable.assigneeUserId))
    .where(eq(staffTasksTable.restaurantId, restaurantId))
    .orderBy(desc(staffTasksTable.createdAt));
  res.json(rows);
});

router.post("/portal/admin/tasks", PRIVILEGED, async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const { assigneeUserId, title, description, priority, dueAt, recurrence } = req.body ?? {};
  if (!assigneeUserId || !title) return void res.status(400).json({ error: "assigneeUserId and title required" });
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, Number(assigneeUserId)));
  if (!target || target.restaurantId !== restaurantId) return void res.status(404).json({ error: "Assignee not in restaurant" });
  const [row] = await db.insert(staffTasksTable).values({
    restaurantId, assigneeUserId: Number(assigneeUserId), createdByUserId: userId,
    title: String(title), description: description ? String(description) : null,
    priority: ["low", "normal", "high"].includes(priority) ? priority : "normal",
    dueAt: dueAt ? new Date(String(dueAt)) : null,
    recurrence: ["none", "daily", "weekly", "monthly"].includes(recurrence) ? recurrence : "none",
    status: "open",
  }).returning();
  res.status(201).json(row);
});

// ---------- Announcements ----------
router.get("/portal/announcements", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const role = req.user?.role ?? "";
  const now = new Date();
  const rows = await db.select().from(announcementsTable).where(and(
    eq(announcementsTable.restaurantId, restaurantId),
    lte(announcementsTable.publishedAt, now),
  )).orderBy(desc(announcementsTable.publishedAt));
  const filtered = rows.filter(a => {
    if (a.expiresAt && a.expiresAt < now) return false;
    const roles = a.audience?.roles;
    if (!roles || roles.length === 0) return true;
    return roles.includes(role);
  });
  const reads = filtered.length === 0 ? [] : await db.select().from(announcementReadsTable).where(and(
    eq(announcementReadsTable.userId, userId),
    inArray(announcementReadsTable.announcementId, filtered.map(a => a.id)),
  ));
  const readSet = new Set(reads.map(r => r.announcementId));
  res.json(filtered.map(a => ({ ...a, read: readSet.has(a.id) })));
});

router.post("/portal/announcements/:id/read", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const id = Number(req.params.id);
  const [a] = await db.select().from(announcementsTable).where(and(eq(announcementsTable.id, id), eq(announcementsTable.restaurantId, restaurantId)));
  if (!a) return void res.status(404).json({ error: "Not found" });
  await db.insert(announcementReadsTable).values({ announcementId: id, userId }).onConflictDoNothing();
  res.json({ ok: true });
});

// Manager: create / list-with-stats
router.get("/portal/admin/announcements", PRIVILEGED, async (req, res) => {
  const { restaurantId } = meCtx(req);
  const rows = await db.select({
    a: announcementsTable,
    readCount: sql<number>`(SELECT COUNT(*) FROM ${announcementReadsTable} WHERE ${announcementReadsTable.announcementId} = ${announcementsTable.id})`,
  }).from(announcementsTable)
    .where(eq(announcementsTable.restaurantId, restaurantId))
    .orderBy(desc(announcementsTable.publishedAt));
  res.json(rows.map(r => ({ ...r.a, readCount: Number(r.readCount) })));
});

router.post("/portal/admin/announcements", PRIVILEGED, async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const { title, body, audience, priority, publishedAt, expiresAt } = req.body ?? {};
  if (!title || !body) return void res.status(400).json({ error: "title and body required" });
  const [row] = await db.insert(announcementsTable).values({
    restaurantId,
    title: String(title), body: String(body),
    audience: audience && typeof audience === "object" ? audience : {},
    priority: ["normal", "high", "urgent"].includes(priority) ? priority : "normal",
    publishedAt: publishedAt ? new Date(String(publishedAt)) : new Date(),
    expiresAt: expiresAt ? new Date(String(expiresAt)) : null,
    createdByUserId: userId,
  }).returning();
  res.status(201).json(row);
});

router.delete("/portal/admin/announcements/:id", PRIVILEGED, async (req, res) => {
  const { restaurantId } = meCtx(req);
  const id = Number(req.params.id);
  await db.delete(announcementsTable).where(and(eq(announcementsTable.id, id), eq(announcementsTable.restaurantId, restaurantId)));
  res.status(204).send();
});

// ---------- Performance scorecard (computed) ----------
router.get("/portal/scorecard", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const sinceDays = Math.min(Number(req.query.days ?? 90), 365);
  const since = new Date(Date.now() - sinceDays * 86400000);

  const att = await db.select({
    status: attendanceTable.status,
    workedMinutes: attendanceTable.workedMinutes,
    lateMinutes: attendanceTable.lateMinutes,
    overtimeMinutes: attendanceTable.overtimeMinutes,
  }).from(attendanceTable).where(and(
    eq(attendanceTable.restaurantId, restaurantId),
    eq(attendanceTable.userId, userId),
    gte(attendanceTable.clockIn, since),
  ));

  const tasks = await db.select({
    status: staffTasksTable.status,
    completedAt: staffTasksTable.completedAt,
    dueAt: staffTasksTable.dueAt,
  }).from(staffTasksTable).where(and(
    eq(staffTasksTable.restaurantId, restaurantId),
    eq(staffTasksTable.assigneeUserId, userId),
    gte(staffTasksTable.createdAt, since),
  ));

  const notes = await db.select().from(performanceNotesTable).where(and(
    eq(performanceNotesTable.restaurantId, restaurantId),
    eq(performanceNotesTable.userId, userId),
    gte(performanceNotesTable.createdAt, since),
  )).orderBy(desc(performanceNotesTable.createdAt));

  const totalDays = att.length;
  const present = att.filter(a => a.status === "present" || a.status === "half_day").length;
  const absent = att.filter(a => a.status === "absent").length;
  const totalLate = att.reduce((s, a) => s + (a.lateMinutes ?? 0), 0);
  const totalOvertime = att.reduce((s, a) => s + (a.overtimeMinutes ?? 0), 0);
  const totalWorked = att.reduce((s, a) => s + (a.workedMinutes ?? 0), 0);

  const tasksDone = tasks.filter(t => t.status === "done").length;
  const tasksOnTime = tasks.filter(t => t.status === "done" && t.completedAt && t.dueAt && t.completedAt <= t.dueAt).length;
  const tasksTotal = tasks.length;

  const ratings = notes.map(n => n.rating).filter((r): r is number => typeof r === "number" && r > 0);
  const avgRating = ratings.length > 0 ? ratings.reduce((s, r) => s + r, 0) / ratings.length : null;

  const attendanceScore = totalDays > 0 ? Math.round((present / totalDays) * 100) : 0;
  const punctualityScore = totalDays > 0 ? Math.max(0, 100 - Math.round((totalLate / totalDays) / 5)) : 100;
  const tasksScore = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0;

  res.json({
    sinceDays,
    attendance: { totalDays, present, absent, totalLate, totalOvertime, totalWorked, score: attendanceScore },
    punctuality: { totalLate, score: punctualityScore },
    tasks: { total: tasksTotal, done: tasksDone, onTime: tasksOnTime, score: tasksScore },
    rating: { count: ratings.length, average: avgRating },
    overall: Math.round((attendanceScore + punctualityScore + tasksScore) / 3),
    notes: notes.slice(0, 10),
  });
});

// ---------- Incentives ----------
router.get("/portal/incentives", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const role = req.user?.role ?? "";
  const programs = await db.select().from(incentiveProgramsTable).where(and(
    eq(incentiveProgramsTable.restaurantId, restaurantId),
    eq(incentiveProgramsTable.isActive, true),
  )).orderBy(desc(incentiveProgramsTable.createdAt));
  const visiblePrograms = programs.filter(p => {
    const scope = p.rolesScope ?? [];
    if (scope.length === 0) return true;
    return scope.includes(role);
  });
  const payouts = await db.select().from(incentivePayoutsTable).where(and(
    eq(incentivePayoutsTable.restaurantId, restaurantId),
    eq(incentivePayoutsTable.userId, userId),
  )).orderBy(desc(incentivePayoutsTable.period));
  const totalEarned = payouts.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const totalPaid = payouts.filter(p => p.status === "paid").reduce((s, p) => s + Number(p.amount ?? 0), 0);
  res.json({ programs: visiblePrograms, payouts, totals: { earned: totalEarned, paid: totalPaid, pending: totalEarned - totalPaid } });
});

// Manager-side incentive admin
router.get("/portal/admin/incentive-programs", PRIVILEGED, async (req, res) => {
  const { restaurantId } = meCtx(req);
  const rows = await db.select().from(incentiveProgramsTable).where(eq(incentiveProgramsTable.restaurantId, restaurantId)).orderBy(desc(incentiveProgramsTable.createdAt));
  res.json(rows);
});
router.post("/portal/admin/incentive-programs", PRIVILEGED, async (req, res) => {
  const { restaurantId } = meCtx(req);
  const { name, description, formula, rolesScope, isActive } = req.body ?? {};
  if (!name) return void res.status(400).json({ error: "name required" });
  const [row] = await db.insert(incentiveProgramsTable).values({
    restaurantId, name: String(name),
    description: description ? String(description) : null,
    formula: formula ? String(formula) : null,
    rolesScope: Array.isArray(rolesScope) ? rolesScope.map(String) : [],
    isActive: isActive !== false,
  }).returning();
  res.status(201).json(row);
});
router.post("/portal/admin/incentive-payouts", PRIVILEGED, async (req, res) => {
  const { restaurantId } = meCtx(req);
  const { userId: targetUserId, programId, period, amount, status, notes } = req.body ?? {};
  if (!targetUserId || !period || amount == null) {
    return void res.status(400).json({ error: "userId, period, amount required" });
  }
  const [row] = await db.insert(incentivePayoutsTable).values({
    restaurantId, userId: Number(targetUserId),
    programId: programId ? Number(programId) : null,
    period: String(period), amount: String(amount),
    status: status === "paid" ? "paid" : "pending",
    notes: notes ? String(notes) : null,
  }).returning();
  res.status(201).json(row);
});

// ---------- Documents (self-view) ----------
router.get("/portal/documents", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const [staff] = await db.select().from(staffTable).where(and(eq(staffTable.userId, userId), eq(staffTable.restaurantId, restaurantId)));
  if (!staff) return void res.json([]);
  const docs = await db.select().from(staffDocumentsTable).where(eq(staffDocumentsTable.staffId, staff.id)).orderBy(desc(staffDocumentsTable.createdAt));
  res.json(docs);
});

router.post("/portal/documents", async (req, res) => {
  const { userId, restaurantId } = meCtx(req);
  const { label, fileUrl, mimeType, sizeBytes } = req.body ?? {};
  if (!label || !fileUrl) return void res.status(400).json({ error: "label and fileUrl required" });
  if (typeof fileUrl !== "string" || !fileUrl.startsWith("/objects/")) {
    return void res.status(400).json({ error: "fileUrl must be a finalized /objects/ path" });
  }
  let [staff] = await db.select().from(staffTable).where(and(eq(staffTable.userId, userId), eq(staffTable.restaurantId, restaurantId)));
  if (!staff) {
    [staff] = await db.insert(staffTable).values({ userId, restaurantId }).returning();
  }
  const [doc] = await db.insert(staffDocumentsTable).values({
    staffId: staff.id, restaurantId, label: String(label), fileUrl: String(fileUrl),
    mimeType: mimeType ? String(mimeType) : undefined,
    sizeBytes: sizeBytes ? Number(sizeBytes) : undefined,
    uploadedByUserId: userId,
  }).returning();
  res.status(201).json(doc);
});

export default router;
