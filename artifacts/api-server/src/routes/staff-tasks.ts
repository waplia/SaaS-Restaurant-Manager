/**
 * QR-based staff task management.
 *
 * - Owners/managers configure task areas (each gets a printable QR), checklists,
 *   and schedules; they verify submissions and review missed tasks.
 * - Staff scan a QR (resolves the area via public token), then authenticated
 *   staff submit a checklist with optional photo proof.
 */
import { Router, type Request, type Response } from "express";
import { randomBytes, createHash } from "crypto";
import { eq, and, desc, gte, lte, sql, inArray, isNotNull, isNull, count } from "drizzle-orm";
import {
  db,
  staffTaskAreasTable,
  staffTaskChecklistsTable,
  staffTaskSubmissionsTable,
  staffTaskSubmissionItemsTable,
  staffTaskVerificationsTable,
  staffTaskMissedWindowsTable,
  notificationsTable,
  usersTable,
  type StaffTaskChecklistItem,
  type StaffTaskScheduleType,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy } from "../lib/objectAcl";
import { recordAuditLog } from "../lib/audit";
import { pushToStaff, pushToUserIds } from "../lib/pushNotify";
import { logger } from "../lib/logger";

const router = Router();
const objectStorage = new ObjectStorageService();

// Manager-only configuration & verification routes.
router.use(
  "/restaurants/:restaurantId/staff-tasks/manage",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

// Staff-accessible routes (any user belonging to the restaurant). Validation
// enforces tenant isolation for non-super-admins.
router.use(
  "/restaurants/:restaurantId/staff-tasks/staff",
  validateRestaurantAccess,
);

function newQrToken(restaurantId: number): string {
  return `stk_${restaurantId}_${randomBytes(8).toString("hex")}`;
}

function sanitizeItems(input: unknown): StaffTaskChecklistItem[] {
  if (!Array.isArray(input)) return [];
  const out: StaffTaskChecklistItem[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, 50)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 200) : "";
    if (!label) continue;
    let key = typeof r.key === "string" && r.key.trim() ? r.key.trim().slice(0, 64) : `item_${out.length + 1}`;
    while (seen.has(key)) key = `${key}_${out.length}`;
    seen.add(key);
    out.push({ key, label, requirePhoto: !!r.requirePhoto });
  }
  return out;
}

function sanitizeScheduleType(v: unknown): StaffTaskScheduleType {
  return v === "interval" || v === "times_per_day" || v === "none" ? v : "none";
}

async function assertPhotoOwnership(restaurantId: number, urls: string[]): Promise<void> {
  for (const url of urls) {
    if (typeof url !== "string" || !url.startsWith("/objects/")) throw new Error("invalid_photo_url");
    try {
      const file = await objectStorage.getObjectEntityFile(url);
      const acl = await getObjectAclPolicy(file);
      if (!acl || acl.restaurantId !== String(restaurantId)) throw new Error("invalid_photo_url");
    } catch (err) {
      if (err instanceof ObjectNotFoundError) throw new Error("invalid_photo_url");
      throw err;
    }
  }
}

// ─── Areas ───────────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/staff-tasks/manage/areas", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(staffTaskAreasTable)
    .where(eq(staffTaskAreasTable.restaurantId, restaurantId))
    .orderBy(desc(staffTaskAreasTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/staff-tasks/manage/areas", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 200) : "";
  if (!name) return void res.status(400).json({ error: "name required" });
  const [row] = await db.insert(staffTaskAreasTable).values({
    restaurantId,
    name,
    description: typeof b.description === "string" ? b.description.slice(0, 1000) : null,
    qrToken: newQrToken(restaurantId),
    isActive: b.isActive !== false,
  }).returning();
  await recordAuditLog({
    req, module: "staff_tasks", action: "area.create",
    entity: "staff_task_area", entityId: row.id, restaurantId, newValue: { name, id: row.id },
  });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/staff-tasks/manage/areas/:areaId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const areaId = Number(req.params.areaId);
  const [existing] = await db.select().from(staffTaskAreasTable)
    .where(and(eq(staffTaskAreasTable.id, areaId), eq(staffTaskAreasTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const update: Partial<typeof staffTaskAreasTable.$inferInsert> = { updatedAt: new Date() };
  if (typeof b.name === "string" && b.name.trim()) update.name = b.name.trim().slice(0, 200);
  if (b.description !== undefined) update.description = b.description == null ? null : String(b.description).slice(0, 1000);
  if (b.isActive !== undefined) update.isActive = !!b.isActive;
  const [row] = await db.update(staffTaskAreasTable).set(update).where(eq(staffTaskAreasTable.id, areaId)).returning();
  await recordAuditLog({
    req, module: "staff_tasks", action: "area.update",
    entity: "staff_task_area", entityId: areaId, restaurantId, oldValue: existing, newValue: update,
  });
  res.json(row);
});

router.post("/restaurants/:restaurantId/staff-tasks/manage/areas/:areaId/regenerate-qr", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const areaId = Number(req.params.areaId);
  const [existing] = await db.select().from(staffTaskAreasTable)
    .where(and(eq(staffTaskAreasTable.id, areaId), eq(staffTaskAreasTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const [row] = await db.update(staffTaskAreasTable)
    .set({ qrToken: newQrToken(restaurantId), updatedAt: new Date() })
    .where(eq(staffTaskAreasTable.id, areaId)).returning();
  await recordAuditLog({
    req, module: "staff_tasks", action: "area.regenerate_qr",
    entity: "staff_task_area", entityId: areaId, restaurantId,
  });
  res.json(row);
});

router.delete("/restaurants/:restaurantId/staff-tasks/manage/areas/:areaId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const areaId = Number(req.params.areaId);
  const [existing] = await db.select().from(staffTaskAreasTable)
    .where(and(eq(staffTaskAreasTable.id, areaId), eq(staffTaskAreasTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.delete(staffTaskAreasTable).where(eq(staffTaskAreasTable.id, areaId));
  await recordAuditLog({
    req, module: "staff_tasks", action: "area.delete",
    entity: "staff_task_area", entityId: areaId, restaurantId, oldValue: existing,
  });
  res.json({ success: true });
});

// QR PNG/SVG download (reuses the qrcode library that powers table/review QRs).
router.get("/restaurants/:restaurantId/staff-tasks/manage/areas/:areaId/qr.svg", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const areaId = Number(req.params.areaId);
  const [row] = await db.select().from(staffTaskAreasTable)
    .where(and(eq(staffTaskAreasTable.id, areaId), eq(staffTaskAreasTable.restaurantId, restaurantId)));
  if (!row) return void res.status(404).json({ error: "Not found" });
  const baseUrl = process.env.PUBLIC_URL?.replace(/\/$/, "") ?? `${req.protocol}://${req.get("host")}`;
  const url = `${baseUrl}/staff-task/${row.qrToken}`;
  const QRCode = await import("qrcode");
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 360 });
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

// ─── Checklists ──────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/staff-tasks/manage/checklists", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const areaId = req.query.areaId ? Number(req.query.areaId) : null;
  const conds = [eq(staffTaskChecklistsTable.restaurantId, restaurantId)];
  if (areaId) conds.push(eq(staffTaskChecklistsTable.areaId, areaId));
  const rows = await db.select().from(staffTaskChecklistsTable)
    .where(and(...conds)).orderBy(desc(staffTaskChecklistsTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/staff-tasks/manage/checklists", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const areaId = Number(b.areaId);
  const [area] = await db.select({ id: staffTaskAreasTable.id }).from(staffTaskAreasTable)
    .where(and(eq(staffTaskAreasTable.id, areaId), eq(staffTaskAreasTable.restaurantId, restaurantId)));
  if (!area) return void res.status(400).json({ error: "Invalid areaId" });
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 200) : "";
  if (!name) return void res.status(400).json({ error: "name required" });
  const items = sanitizeItems(b.items);
  if (items.length === 0) return void res.status(400).json({ error: "At least one checklist item required" });

  const [row] = await db.insert(staffTaskChecklistsTable).values({
    restaurantId,
    areaId,
    name,
    description: typeof b.description === "string" ? b.description.slice(0, 1000) : null,
    items,
    photoRequired: !!b.photoRequired,
    scheduleType: sanitizeScheduleType(b.scheduleType),
    intervalMinutes: Math.max(15, Math.min(1440, Number(b.intervalMinutes) || 120)),
    timesPerDay: Math.max(1, Math.min(24, Number(b.timesPerDay) || 3)),
    windowMinutes: Math.max(5, Math.min(1440, Number(b.windowMinutes) || 60)),
    isActive: b.isActive !== false,
  }).returning();
  await recordAuditLog({
    req, module: "staff_tasks", action: "checklist.create",
    entity: "staff_task_checklist", entityId: row.id, restaurantId, newValue: { name, areaId },
  });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/staff-tasks/manage/checklists/:checklistId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const checklistId = Number(req.params.checklistId);
  const [existing] = await db.select().from(staffTaskChecklistsTable)
    .where(and(eq(staffTaskChecklistsTable.id, checklistId), eq(staffTaskChecklistsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const update: Partial<typeof staffTaskChecklistsTable.$inferInsert> = { updatedAt: new Date() };
  if (typeof b.name === "string" && b.name.trim()) update.name = b.name.trim().slice(0, 200);
  if (b.description !== undefined) update.description = b.description == null ? null : String(b.description).slice(0, 1000);
  if (b.items !== undefined) {
    const items = sanitizeItems(b.items);
    if (items.length === 0) return void res.status(400).json({ error: "At least one checklist item required" });
    update.items = items;
  }
  if (b.photoRequired !== undefined) update.photoRequired = !!b.photoRequired;
  if (b.scheduleType !== undefined) update.scheduleType = sanitizeScheduleType(b.scheduleType);
  if (b.intervalMinutes !== undefined) update.intervalMinutes = Math.max(15, Math.min(1440, Number(b.intervalMinutes)));
  if (b.timesPerDay !== undefined) update.timesPerDay = Math.max(1, Math.min(24, Number(b.timesPerDay)));
  if (b.windowMinutes !== undefined) update.windowMinutes = Math.max(5, Math.min(1440, Number(b.windowMinutes)));
  if (b.isActive !== undefined) update.isActive = !!b.isActive;

  const [row] = await db.update(staffTaskChecklistsTable).set(update).where(eq(staffTaskChecklistsTable.id, checklistId)).returning();
  await recordAuditLog({
    req, module: "staff_tasks", action: "checklist.update",
    entity: "staff_task_checklist", entityId: checklistId, restaurantId, oldValue: existing, newValue: update,
  });
  res.json(row);
});

router.delete("/restaurants/:restaurantId/staff-tasks/manage/checklists/:checklistId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const checklistId = Number(req.params.checklistId);
  const [existing] = await db.select().from(staffTaskChecklistsTable)
    .where(and(eq(staffTaskChecklistsTable.id, checklistId), eq(staffTaskChecklistsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.delete(staffTaskChecklistsTable).where(eq(staffTaskChecklistsTable.id, checklistId));
  await recordAuditLog({
    req, module: "staff_tasks", action: "checklist.delete",
    entity: "staff_task_checklist", entityId: checklistId, restaurantId, oldValue: existing,
  });
  res.json({ success: true });
});

// ─── Submissions: list & history (manager) ───────────────────────────────────

interface SubmissionListFilters {
  areaId?: number;
  checklistId?: number;
  staffUserId?: number;
  status?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

async function loadSubmissionsWithDetails(restaurantId: number, f: SubmissionListFilters) {
  const conds = [eq(staffTaskSubmissionsTable.restaurantId, restaurantId)];
  if (f.areaId) conds.push(eq(staffTaskSubmissionsTable.areaId, f.areaId));
  if (f.checklistId) conds.push(eq(staffTaskSubmissionsTable.checklistId, f.checklistId));
  if (f.staffUserId) conds.push(eq(staffTaskSubmissionsTable.staffUserId, f.staffUserId));
  if (f.status && ["pending", "approved", "rejected"].includes(f.status)) {
    conds.push(eq(staffTaskSubmissionsTable.status, f.status as "pending" | "approved" | "rejected"));
  }
  if (f.from) conds.push(gte(staffTaskSubmissionsTable.submittedAt, f.from));
  if (f.to) conds.push(lte(staffTaskSubmissionsTable.submittedAt, f.to));

  const rows = await db.select({
    submission: staffTaskSubmissionsTable,
    areaName: staffTaskAreasTable.name,
    checklistName: staffTaskChecklistsTable.name,
    staffName: usersTable.name,
    staffEmail: usersTable.email,
  }).from(staffTaskSubmissionsTable)
    .leftJoin(staffTaskAreasTable, eq(staffTaskAreasTable.id, staffTaskSubmissionsTable.areaId))
    .leftJoin(staffTaskChecklistsTable, eq(staffTaskChecklistsTable.id, staffTaskSubmissionsTable.checklistId))
    .leftJoin(usersTable, eq(usersTable.id, staffTaskSubmissionsTable.staffUserId))
    .where(and(...conds))
    .orderBy(desc(staffTaskSubmissionsTable.submittedAt))
    .limit(Math.min(500, Math.max(1, f.limit ?? 200)));

  if (rows.length === 0) return [] as Array<typeof rows[number] & { items: typeof staffTaskSubmissionItemsTable.$inferSelect[]; verification: typeof staffTaskVerificationsTable.$inferSelect | null }>;

  const subIds = rows.map(r => r.submission.id);
  const items = await db.select().from(staffTaskSubmissionItemsTable)
    .where(inArray(staffTaskSubmissionItemsTable.submissionId, subIds));
  const verifications = await db.select().from(staffTaskVerificationsTable)
    .where(inArray(staffTaskVerificationsTable.submissionId, subIds))
    .orderBy(desc(staffTaskVerificationsTable.createdAt));
  const itemsBySub = new Map<number, typeof items>();
  for (const it of items) {
    const arr = itemsBySub.get(it.submissionId) ?? [];
    arr.push(it);
    itemsBySub.set(it.submissionId, arr);
  }
  const verifBySub = new Map<number, typeof verifications[number]>();
  for (const v of verifications) {
    if (!verifBySub.has(v.submissionId)) verifBySub.set(v.submissionId, v);
  }
  return rows.map(r => ({
    ...r,
    items: itemsBySub.get(r.submission.id) ?? [],
    verification: verifBySub.get(r.submission.id) ?? null,
  }));
}

router.get("/restaurants/:restaurantId/staff-tasks/manage/submissions", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const f: SubmissionListFilters = {
    areaId: req.query.areaId ? Number(req.query.areaId) : undefined,
    checklistId: req.query.checklistId ? Number(req.query.checklistId) : undefined,
    staffUserId: req.query.staffUserId ? Number(req.query.staffUserId) : undefined,
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    from: typeof req.query.from === "string" ? new Date(req.query.from) : undefined,
    to: typeof req.query.to === "string" ? new Date(req.query.to) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  };
  res.json(await loadSubmissionsWithDetails(restaurantId, f));
});

router.get("/restaurants/:restaurantId/staff-tasks/manage/pending", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  res.json(await loadSubmissionsWithDetails(restaurantId, { status: "pending", limit: 200 }));
});

router.get("/restaurants/:restaurantId/staff-tasks/manage/missed", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.min(60, Math.max(1, Number(req.query.days ?? 7)));
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.select({
    missed: staffTaskMissedWindowsTable,
    areaName: staffTaskAreasTable.name,
    checklistName: staffTaskChecklistsTable.name,
  }).from(staffTaskMissedWindowsTable)
    .leftJoin(staffTaskAreasTable, eq(staffTaskAreasTable.id, staffTaskMissedWindowsTable.areaId))
    .leftJoin(staffTaskChecklistsTable, eq(staffTaskChecklistsTable.id, staffTaskMissedWindowsTable.checklistId))
    .where(and(
      eq(staffTaskMissedWindowsTable.restaurantId, restaurantId),
      gte(staffTaskMissedWindowsTable.windowStart, since),
    ))
    .orderBy(desc(staffTaskMissedWindowsTable.windowStart))
    .limit(500);
  res.json(rows);
});

// Per-staff accountability score (rolling N days). Computed as the share of
// scheduled windows the user submitted on time vs. total scheduled windows.
router.get("/restaurants/:restaurantId/staff-tasks/manage/accountability/:userId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const days = Math.min(180, Math.max(1, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 86_400_000);

  const [submitted] = await db.select({ n: count() }).from(staffTaskSubmissionsTable)
    .where(and(
      eq(staffTaskSubmissionsTable.restaurantId, restaurantId),
      eq(staffTaskSubmissionsTable.staffUserId, userId),
      gte(staffTaskSubmissionsTable.submittedAt, since),
    ));
  const [onTime] = await db.select({ n: count() }).from(staffTaskSubmissionsTable)
    .where(and(
      eq(staffTaskSubmissionsTable.restaurantId, restaurantId),
      eq(staffTaskSubmissionsTable.staffUserId, userId),
      gte(staffTaskSubmissionsTable.submittedAt, since),
      isNotNull(staffTaskSubmissionsTable.windowStart),
    ));
  const [approved] = await db.select({ n: count() }).from(staffTaskSubmissionsTable)
    .where(and(
      eq(staffTaskSubmissionsTable.restaurantId, restaurantId),
      eq(staffTaskSubmissionsTable.staffUserId, userId),
      gte(staffTaskSubmissionsTable.submittedAt, since),
      eq(staffTaskSubmissionsTable.status, "approved"),
    ));
  const [rejected] = await db.select({ n: count() }).from(staffTaskSubmissionsTable)
    .where(and(
      eq(staffTaskSubmissionsTable.restaurantId, restaurantId),
      eq(staffTaskSubmissionsTable.staffUserId, userId),
      gte(staffTaskSubmissionsTable.submittedAt, since),
      eq(staffTaskSubmissionsTable.status, "rejected"),
    ));
  // Approximate "scheduled windows that should have been done by anyone" — we
  // do not pin missed windows to a specific staff member, so the score is a
  // restaurant-wide proxy combined with this user's on-time share.
  const [missed] = await db.select({ n: count() }).from(staffTaskMissedWindowsTable)
    .where(and(
      eq(staffTaskMissedWindowsTable.restaurantId, restaurantId),
      gte(staffTaskMissedWindowsTable.windowStart, since),
    ));

  const submittedN = Number(submitted?.n ?? 0);
  const onTimeN = Number(onTime?.n ?? 0);
  const approvedN = Number(approved?.n ?? 0);
  const rejectedN = Number(rejected?.n ?? 0);
  const missedN = Number(missed?.n ?? 0);
  const denom = submittedN + missedN;
  const score = denom === 0 ? 100 : Math.round((onTimeN / denom) * 100);

  res.json({
    userId,
    days,
    submitted: submittedN,
    onTime: onTimeN,
    approved: approvedN,
    rejected: rejectedN,
    missedRestaurantWide: missedN,
    score,
  });
});

// ─── Verify / Reject ─────────────────────────────────────────────────────────

router.post("/restaurants/:restaurantId/staff-tasks/manage/submissions/:subId/verify", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const subId = Number(req.params.subId);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const action = b.action === "rejected" ? "rejected" : "approved";
  const comment = typeof b.comment === "string" ? b.comment.slice(0, 1000) : null;

  const [sub] = await db.select().from(staffTaskSubmissionsTable)
    .where(and(eq(staffTaskSubmissionsTable.id, subId), eq(staffTaskSubmissionsTable.restaurantId, restaurantId)));
  if (!sub) return void res.status(404).json({ error: "Not found" });
  if (sub.status !== "pending") return void res.status(400).json({ error: "Already verified" });

  await db.update(staffTaskSubmissionsTable)
    .set({ status: action, updatedAt: new Date() })
    .where(eq(staffTaskSubmissionsTable.id, subId));
  await db.insert(staffTaskVerificationsTable).values({
    submissionId: subId,
    restaurantId,
    managerUserId: req.user!.sub,
    action,
    comment,
  });

  // Notify the staff member, in-app + push.
  await db.insert(notificationsTable).values({
    restaurantId,
    type: "system_error",
    title: action === "approved" ? "Task approved" : "Task rejected — please redo",
    message: comment ?? `Your task submission was ${action}.`,
  }).catch(() => undefined);
  pushToUserIds([sub.staffUserId], "leave_decision", {
    title: action === "approved" ? "Task approved" : "Task rejected",
    body: comment ?? `Your task submission was ${action}.`,
    data: { type: "staff_task_verification", submissionId: subId, action },
  }).catch(err => logger.warn({ err }, "[staff-tasks] verify push failed"));

  await recordAuditLog({
    req, module: "staff_tasks", action: `submission.${action}`,
    entity: "staff_task_submission", entityId: subId, restaurantId,
    oldValue: { status: sub.status }, newValue: { status: action, comment },
  });
  res.json({ success: true });
});

// ─── Staff scan resolve & submit ─────────────────────────────────────────────
//
// The public scan endpoint lives in routes/public.ts and resolves a token to a
// minimal area record (no auth required, just to render a "log in" landing
// page). The actual submit requires an authenticated staff user from the
// matching restaurant.

router.get("/restaurants/:restaurantId/staff-tasks/staff/area/:qrToken", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [area] = await db.select().from(staffTaskAreasTable)
    .where(and(eq(staffTaskAreasTable.qrToken, req.params.qrToken), eq(staffTaskAreasTable.restaurantId, restaurantId)));
  if (!area || !area.isActive) return void res.status(404).json({ error: "Area not found" });
  const checklists = await db.select().from(staffTaskChecklistsTable)
    .where(and(eq(staffTaskChecklistsTable.areaId, area.id), eq(staffTaskChecklistsTable.isActive, true)))
    .orderBy(desc(staffTaskChecklistsTable.createdAt));
  res.json({ area, checklists });
});

// "My tasks" — checklists scheduled for today across all areas (used by the
// mobile/list experience).
router.get("/restaurants/:restaurantId/staff-tasks/staff/my-today", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = req.user!.sub;
  const checklists = await db.select({
    checklist: staffTaskChecklistsTable,
    areaName: staffTaskAreasTable.name,
    areaId: staffTaskAreasTable.id,
    areaQr: staffTaskAreasTable.qrToken,
  }).from(staffTaskChecklistsTable)
    .leftJoin(staffTaskAreasTable, eq(staffTaskAreasTable.id, staffTaskChecklistsTable.areaId))
    .where(and(
      eq(staffTaskChecklistsTable.restaurantId, restaurantId),
      eq(staffTaskChecklistsTable.isActive, true),
    ));
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const my = await db.select({
    checklistId: staffTaskSubmissionsTable.checklistId,
    submittedAt: staffTaskSubmissionsTable.submittedAt,
    status: staffTaskSubmissionsTable.status,
  }).from(staffTaskSubmissionsTable)
    .where(and(
      eq(staffTaskSubmissionsTable.restaurantId, restaurantId),
      eq(staffTaskSubmissionsTable.staffUserId, userId),
      gte(staffTaskSubmissionsTable.submittedAt, dayStart),
    ));
  const lastByChecklist = new Map<number, { submittedAt: Date; status: string }>();
  for (const r of my) {
    const cur = lastByChecklist.get(r.checklistId);
    if (!cur || r.submittedAt > cur.submittedAt) lastByChecklist.set(r.checklistId, { submittedAt: r.submittedAt, status: r.status });
  }
  res.json(checklists.map(c => ({
    ...c,
    lastSubmissionToday: lastByChecklist.get(c.checklist.id) ?? null,
  })));
});

// Compute the active scheduling window for a checklist (the window the
// submission falls into). Returns null when scheduleType === 'none'.
function computeWindowForSubmission(
  checklist: typeof staffTaskChecklistsTable.$inferSelect,
  at: Date,
): { start: Date; end: Date } | null {
  if (checklist.scheduleType === "none") return null;
  const dayStart = new Date(at); dayStart.setHours(0, 0, 0, 0);
  const minutesSinceMidnight = Math.floor((at.getTime() - dayStart.getTime()) / 60_000);
  if (checklist.scheduleType === "interval") {
    const interval = Math.max(1, checklist.intervalMinutes);
    const idx = Math.floor(minutesSinceMidnight / interval);
    const start = new Date(dayStart.getTime() + idx * interval * 60_000);
    const end = new Date(start.getTime() + interval * 60_000);
    return { start, end };
  }
  // times_per_day: N evenly spaced windows across 24h
  const n = Math.max(1, checklist.timesPerDay);
  const spacing = (24 * 60) / n;
  const idx = Math.min(n - 1, Math.floor(minutesSinceMidnight / spacing));
  const start = new Date(dayStart.getTime() + idx * spacing * 60_000);
  const end = new Date(start.getTime() + checklist.windowMinutes * 60_000);
  return { start, end };
}

router.post("/restaurants/:restaurantId/staff-tasks/staff/submit", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = req.user!.sub;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const checklistId = Number(b.checklistId);
  const ticks = Array.isArray(b.itemTicks) ? (b.itemTicks as Array<{ key: string; checked: boolean }>) : [];
  const photoUrls = Array.isArray(b.photoUrls) ? (b.photoUrls as unknown[]).filter((u): u is string => typeof u === "string").slice(0, 6) : [];
  const notes = typeof b.notes === "string" ? b.notes.slice(0, 2000) : null;
  const startedAt = typeof b.startedAt === "string" ? new Date(b.startedAt) : null;

  const [checklist] = await db.select().from(staffTaskChecklistsTable)
    .where(and(eq(staffTaskChecklistsTable.id, checklistId), eq(staffTaskChecklistsTable.restaurantId, restaurantId)));
  if (!checklist || !checklist.isActive) return void res.status(404).json({ error: "Checklist not found" });

  // Enforce that all items are ticked and that photo proof is provided when
  // the checklist (or any specific item) requires it.
  const tickByKey = new Map(ticks.map(t => [String(t.key), !!t.checked]));
  const missing = (checklist.items as StaffTaskChecklistItem[]).filter((i: StaffTaskChecklistItem) => !tickByKey.get(i.key));
  if (missing.length > 0) {
    return void res.status(400).json({ error: "All items must be checked", missing: missing.map((m: StaffTaskChecklistItem) => m.key) });
  }
  const requiresPhoto = checklist.photoRequired || (checklist.items as StaffTaskChecklistItem[]).some((i: StaffTaskChecklistItem) => i.requirePhoto);
  if (requiresPhoto && photoUrls.length === 0) {
    return void res.status(400).json({ error: "Photo proof required" });
  }

  if (photoUrls.length > 0) {
    try { await assertPhotoOwnership(restaurantId, photoUrls); }
    catch { return void res.status(400).json({ error: "invalid_photo_url" }); }
  }

  const submittedAt = new Date();
  const window = computeWindowForSubmission(checklist, submittedAt);

  const [sub] = await db.insert(staffTaskSubmissionsTable).values({
    restaurantId,
    areaId: checklist.areaId,
    checklistId: checklist.id,
    staffUserId: userId,
    startedAt: startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : null,
    submittedAt,
    windowStart: window?.start ?? null,
    windowEnd: window?.end ?? null,
    notes,
    photoUrls,
    status: "pending",
  }).returning();

  if (checklist.items.length > 0) {
    await db.insert(staffTaskSubmissionItemsTable).values(
      (checklist.items as StaffTaskChecklistItem[]).map((i: StaffTaskChecklistItem) => ({
        submissionId: sub.id,
        itemKey: i.key,
        itemLabel: i.label,
        checked: !!tickByKey.get(i.key),
      })),
    );
  }

  // Clear any matching missed-window row so we don't double-count it.
  if (window) {
    await db.delete(staffTaskMissedWindowsTable).where(and(
      eq(staffTaskMissedWindowsTable.checklistId, checklist.id),
      eq(staffTaskMissedWindowsTable.windowStart, window.start),
    ));
  }

  // Notify managers there is a new submission to verify.
  await db.insert(notificationsTable).values({
    restaurantId,
    type: "system_error",
    title: "New task submission",
    message: `${checklist.name} submitted — pending verification`,
  }).catch(() => undefined);
  pushToStaff({
    restaurantId,
    roles: ["owner", "manager"],
    type: "leave_request",
  }, {
    title: "Task pending verification",
    body: `${checklist.name} submitted by staff — review and approve.`,
    data: { type: "staff_task_pending", submissionId: sub.id },
  }).catch(err => logger.warn({ err }, "[staff-tasks] manager push failed"));

  await recordAuditLog({
    req, module: "staff_tasks", action: "submission.create",
    entity: "staff_task_submission", entityId: sub.id, restaurantId,
    newValue: { checklistId: checklist.id, areaId: checklist.areaId },
  });
  res.status(201).json(sub);
});

// ─── Missed-task detection (called from scheduler) ───────────────────────────

export interface MissedSweepResult {
  checked: number;
  missed: number;
}

/**
 * For each active checklist with a schedule, marks the previous window as
 * "missed" if no submission landed in it. Idempotent via the unique index on
 * (checklist_id, window_start).
 */
export async function runStaffTaskMissedSweep(now: Date = new Date()): Promise<MissedSweepResult> {
  const checklists = await db.select().from(staffTaskChecklistsTable)
    .where(eq(staffTaskChecklistsTable.isActive, true));

  let missed = 0;
  for (const cl of checklists) {
    if (cl.scheduleType === "none") continue;
    // Look one window back so we only mark windows that have *fully closed*.
    const lookbackMs = cl.scheduleType === "interval"
      ? cl.intervalMinutes * 60_000
      : Math.max(cl.windowMinutes, Math.floor(24 * 60 / Math.max(1, cl.timesPerDay)) * 60_000);
    const at = new Date(now.getTime() - lookbackMs);
    const window = computeWindowForSubmission(cl, at);
    if (!window) continue;
    if (window.end > now) continue; // not yet closed

    const [sub] = await db.select({ id: staffTaskSubmissionsTable.id }).from(staffTaskSubmissionsTable)
      .where(and(
        eq(staffTaskSubmissionsTable.checklistId, cl.id),
        eq(staffTaskSubmissionsTable.windowStart, window.start),
      ));
    if (sub) continue;

    try {
      const inserted = await db.insert(staffTaskMissedWindowsTable).values({
        restaurantId: cl.restaurantId,
        areaId: cl.areaId,
        checklistId: cl.id,
        windowStart: window.start,
        windowEnd: window.end,
        notifiedAt: new Date(),
      }).onConflictDoNothing().returning();
      if (inserted.length > 0) {
        missed++;
        await db.insert(notificationsTable).values({
          restaurantId: cl.restaurantId,
          type: "system_error",
          title: "Missed scheduled task",
          message: `${cl.name} window ${window.start.toISOString()} closed without a submission`,
        }).catch(() => undefined);
        pushToStaff({
          restaurantId: cl.restaurantId,
          roles: ["owner", "manager"],
          type: "kitchen_delay",
        }, {
          title: "Missed scheduled task",
          body: `${cl.name} was not completed in its scheduled window.`,
          data: { type: "staff_task_missed", checklistId: cl.id },
        }).catch(err => logger.warn({ err }, "[staff-tasks] missed push failed"));
      }
    } catch (err) {
      logger.warn({ err, checklistId: cl.id }, "[staff-tasks] missed insert failed");
    }
  }
  return { checked: checklists.length, missed };
}

// Note: a public scan resolver lives in routes/public.ts at /public/staff-task/:qrToken
// — it returns a minimal "what restaurant is this and what's the area name"
// payload so the client can redirect into the authenticated submit flow.
export function hashStaffScanIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip + "|stafftask").digest("hex").slice(0, 32);
}

// Suppress unused warnings — these are exported for tests / public route.
export { isNull };

export default router;
