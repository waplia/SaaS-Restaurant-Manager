import { Router } from "express";
import { and, eq, gte, lte, lt, sql, inArray } from "drizzle-orm";
import {
  db,
  staffAvailabilityTable,
  shiftTradeRequestsTable,
  schedulePublicationsTable,
  laborSettingsTable,
  staffShiftsTable,
  shiftsTable,
  usersTable,
  ordersTable,
  attendanceTable,
  auditLogsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { pushToUserIds, pushToStaff } from "../lib/pushNotify";
import { sendSms, sendWhatsApp } from "../lib/notifications";
import { logger } from "../lib/logger";

const router = Router();

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
      module: "scheduling",
      action,
      entity,
      entityId: entityId ?? undefined,
      details: details ? JSON.stringify(details) : undefined,
      ipAddress: ip,
    });
  } catch {
    /* never break */
  }
}

function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s ?? ""));
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function shiftDurationMinutes(start: string, end: string): number {
  const s = parseHHMM(start);
  let e = parseHHMM(end);
  if (e <= s) e += 24 * 60;
  return e - s;
}

const PLAN_GATE = requirePlanFeature("advanced_scheduling");
const MANAGER_ROLES = ["owner", "manager", "super_admin"] as const;
const ALL_STAFF_ROLES = ["owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive", "super_admin", "staff"] as const;

// ─────────────────────────────────────────────────────────────────────────
// Labor settings
// ─────────────────────────────────────────────────────────────────────────

async function getOrCreateSettings(restaurantId: number) {
  const [existing] = await db
    .select()
    .from(laborSettingsTable)
    .where(eq(laborSettingsTable.restaurantId, restaurantId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(laborSettingsTable)
    .values({ restaurantId })
    .returning();
  return created;
}

router.get(
  "/restaurants/:restaurantId/labor-settings",
  requireRole(...MANAGER_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const settings = await getOrCreateSettings(restaurantId);
    res.json(settings);
  },
);

router.patch(
  "/restaurants/:restaurantId/labor-settings",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const callerId = req.user?.sub ?? null;
    await getOrCreateSettings(restaurantId);
    const allowed: Record<string, unknown> = {};
    for (const k of [
      "targetLaborPct",
      "defaultHourlyCost",
      "salesPerLaborHour",
      "breakMinutesPerShift",
      "breakAfterMinutes",
      "overtimeAfterMinutesPerDay",
      "overtimeAfterMinutesPerWeek",
      "minHeadcountByRole",
    ]) {
      if (k in (req.body ?? {})) allowed[k] = (req.body as Record<string, unknown>)[k];
    }
    allowed.updatedByUserId = callerId;
    allowed.updatedAt = new Date();
    const [updated] = await db
      .update(laborSettingsTable)
      .set(allowed)
      .where(eq(laborSettingsTable.restaurantId, restaurantId))
      .returning();
    await audit(restaurantId, callerId, "update", "labor_settings", updated.id, allowed, req.ip);
    res.json(updated);
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Staff availability
// ─────────────────────────────────────────────────────────────────────────

router.get(
  "/restaurants/:restaurantId/staff-availability",
  requireRole(...ALL_STAFF_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const userIdParam = req.query.userId != null ? Number(req.query.userId) : null;
    const caller = req.user;
    const isManager = caller && (MANAGER_ROLES as readonly string[]).includes(caller.role ?? "");
    const targetUserId = isManager ? userIdParam : caller?.sub ?? null;
    const conds = [eq(staffAvailabilityTable.restaurantId, restaurantId)];
    if (targetUserId) conds.push(eq(staffAvailabilityTable.userId, targetUserId));
    const rows = await db.select().from(staffAvailabilityTable).where(and(...conds));
    res.json(rows);
  },
);

router.put(
  "/restaurants/:restaurantId/staff-availability",
  requireRole(...ALL_STAFF_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const caller = req.user;
    const isManager = caller && (MANAGER_ROLES as readonly string[]).includes(caller.role ?? "");
    const bodyUserId = req.body?.userId ? Number(req.body.userId) : null;
    const userId = isManager && bodyUserId ? bodyUserId : caller?.sub;
    if (!userId) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }
    const slots = Array.isArray(req.body?.slots) ? req.body.slots : [];
    // Validate slots
    for (const s of slots) {
      if (
        typeof s.dayOfWeek !== "number" || s.dayOfWeek < 0 || s.dayOfWeek > 6 ||
        typeof s.startTime !== "string" || typeof s.endTime !== "string"
      ) {
        res.status(400).json({ error: "Invalid slot payload" });
        return;
      }
    }
    // Replace-all semantics for the user.
    await db
      .delete(staffAvailabilityTable)
      .where(and(eq(staffAvailabilityTable.restaurantId, restaurantId), eq(staffAvailabilityTable.userId, userId)));
    let inserted: typeof staffAvailabilityTable.$inferSelect[] = [];
    if (slots.length > 0) {
      inserted = await db
        .insert(staffAvailabilityTable)
        .values(slots.map((s: { dayOfWeek: number; startTime: string; endTime: string; isAvailable?: boolean; note?: string | null; effectiveFrom?: string | null }) => ({
          userId,
          restaurantId,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          isAvailable: s.isAvailable !== false,
          note: s.note ?? null,
          effectiveFrom: s.effectiveFrom ? new Date(s.effectiveFrom) : null,
        })))
        .returning();
    }
    await audit(restaurantId, caller?.sub ?? null, "replace", "staff_availability", userId, { count: inserted.length }, req.ip);
    res.json(inserted);
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Shift trade requests
// ─────────────────────────────────────────────────────────────────────────

router.get(
  "/restaurants/:restaurantId/shift-trades",
  requireRole(...ALL_STAFF_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const caller = req.user;
    const isManager = caller && (MANAGER_ROLES as readonly string[]).includes(caller.role ?? "");
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const conds = [eq(shiftTradeRequestsTable.restaurantId, restaurantId)];
    if (status) conds.push(eq(shiftTradeRequestsTable.status, status));
    if (!isManager && caller?.sub) {
      conds.push(sql`(${shiftTradeRequestsTable.fromUserId} = ${caller.sub} OR ${shiftTradeRequestsTable.toUserId} = ${caller.sub})`);
    }
    const rows = await db.select().from(shiftTradeRequestsTable).where(and(...conds)).orderBy(sql`${shiftTradeRequestsTable.createdAt} DESC`);
    res.json(rows);
  },
);

router.post(
  "/restaurants/:restaurantId/shift-trades",
  requireRole(...ALL_STAFF_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const caller = req.user;
    if (!caller?.sub) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }
    const { staffShiftId, toUserId, tradeType, swapStaffShiftId, reason } = req.body ?? {};
    if (!staffShiftId) {
      res.status(400).json({ error: "staffShiftId is required" });
      return;
    }
    // Ensure caller owns the shift (or is manager).
    const [shift] = await db
      .select()
      .from(staffShiftsTable)
      .where(and(eq(staffShiftsTable.id, Number(staffShiftId)), eq(staffShiftsTable.restaurantId, restaurantId)))
      .limit(1);
    if (!shift) {
      res.status(404).json({ error: "Shift not found" });
      return;
    }
    const isManager = (MANAGER_ROLES as readonly string[]).includes(caller.role ?? "");
    if (!isManager && shift.userId !== caller.sub) {
      res.status(403).json({ error: "You can only trade your own shifts" });
      return;
    }
    // If a target peer was named, ensure they belong to this restaurant.
    if (toUserId != null) {
      const targetId = Number(toUserId);
      const [targetUser] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.id, targetId), eq(usersTable.restaurantId, restaurantId)))
        .limit(1);
      if (!targetUser) {
        res.status(403).json({ error: "Target user does not belong to this restaurant" });
        return;
      }
    }
    // If swapping, ensure the offered counter-shift also belongs here.
    if (tradeType === "swap" && swapStaffShiftId != null) {
      const [swapShift] = await db
        .select({ id: staffShiftsTable.id })
        .from(staffShiftsTable)
        .where(and(eq(staffShiftsTable.id, Number(swapStaffShiftId)), eq(staffShiftsTable.restaurantId, restaurantId)))
        .limit(1);
      if (!swapShift) {
        res.status(403).json({ error: "Swap shift does not belong to this restaurant" });
        return;
      }
    }
    const [created] = await db
      .insert(shiftTradeRequestsTable)
      .values({
        restaurantId,
        fromUserId: shift.userId,
        toUserId: toUserId ? Number(toUserId) : null,
        staffShiftId: Number(staffShiftId),
        tradeType: tradeType === "swap" ? "swap" : "giveaway",
        swapStaffShiftId: swapStaffShiftId ? Number(swapStaffShiftId) : null,
        reason: reason ?? null,
        status: "pending",
      })
      .returning();
    await audit(restaurantId, caller.sub, "create", "shift_trade_request", created.id, { staffShiftId, toUserId }, req.ip);
    // Notify peer + managers
    if (created.toUserId) {
      await pushToUserIds([created.toUserId], "approval_request", {
        title: "Shift trade request",
        body: "A colleague has asked you to take their shift.",
        data: { type: "shift_trade", id: created.id },
      }).catch(() => undefined);
    }
    await pushToStaff(
      { restaurantId, roles: ["owner", "manager"], type: "approval_request" },
      { title: "New shift trade", body: "A shift-trade request is awaiting approval.", data: { type: "shift_trade", id: created.id } },
    ).catch(() => undefined);
    res.status(201).json(created);
  },
);

// Peer accept/decline
router.post(
  "/restaurants/:restaurantId/shift-trades/:id/peer-respond",
  requireRole(...ALL_STAFF_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const caller = req.user;
    const accept = req.body?.accept !== false;
    const [trade] = await db
      .select()
      .from(shiftTradeRequestsTable)
      .where(and(eq(shiftTradeRequestsTable.id, id), eq(shiftTradeRequestsTable.restaurantId, restaurantId)));
    if (!trade) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (trade.toUserId !== caller?.sub) {
      res.status(403).json({ error: "Not your trade" });
      return;
    }
    if (trade.status !== "pending") {
      res.status(409).json({ error: "Trade no longer pending" });
      return;
    }
    const [updated] = await db
      .update(shiftTradeRequestsTable)
      .set({
        status: accept ? "accepted_peer" : "rejected",
        peerRespondedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shiftTradeRequestsTable.id, id))
      .returning();
    await audit(restaurantId, caller?.sub ?? null, "peer_respond", "shift_trade_request", id, { accept }, req.ip);
    res.json(updated);
  },
);

// Manager approve/reject
router.post(
  "/restaurants/:restaurantId/shift-trades/:id/decide",
  requireRole(...MANAGER_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const caller = req.user;
    const decision = req.body?.decision; // "approve" | "reject"
    const note = req.body?.note ?? null;
    if (!["approve", "reject"].includes(decision)) {
      res.status(400).json({ error: "decision must be approve or reject" });
      return;
    }
    const [trade] = await db
      .select()
      .from(shiftTradeRequestsTable)
      .where(and(eq(shiftTradeRequestsTable.id, id), eq(shiftTradeRequestsTable.restaurantId, restaurantId)));
    if (!trade) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (trade.status === "approved" || trade.status === "rejected" || trade.status === "cancelled") {
      res.status(409).json({ error: "Trade already decided" });
      return;
    }
    if (decision === "approve") {
      // Apply: reassign the staff_shift.userId. For swap, also flip the swap shift.
      if (!trade.toUserId) {
        res.status(400).json({ error: "Trade has no target user; assign a peer first" });
        return;
      }
      // Re-validate at approval time: both users and both shifts must belong
      // to this restaurant (guards against stale rows or tampering between
      // create and approve).
      const userIdsToCheck = [trade.fromUserId, trade.toUserId];
      const validUsers = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(inArray(usersTable.id, userIdsToCheck), eq(usersTable.restaurantId, restaurantId)));
      if (validUsers.length !== userIdsToCheck.length) {
        res.status(403).json({ error: "Trade involves a user outside this restaurant" });
        return;
      }
      const shiftIdsToCheck = [trade.staffShiftId, ...(trade.tradeType === "swap" && trade.swapStaffShiftId ? [trade.swapStaffShiftId] : [])];
      const validShifts = await db
        .select({ id: staffShiftsTable.id })
        .from(staffShiftsTable)
        .where(and(inArray(staffShiftsTable.id, shiftIdsToCheck), eq(staffShiftsTable.restaurantId, restaurantId)));
      if (validShifts.length !== shiftIdsToCheck.length) {
        res.status(403).json({ error: "Trade references a shift outside this restaurant" });
        return;
      }
      await db
        .update(staffShiftsTable)
        .set({ userId: trade.toUserId })
        .where(and(eq(staffShiftsTable.id, trade.staffShiftId), eq(staffShiftsTable.restaurantId, restaurantId)));
      if (trade.tradeType === "swap" && trade.swapStaffShiftId) {
        await db
          .update(staffShiftsTable)
          .set({ userId: trade.fromUserId })
          .where(and(eq(staffShiftsTable.id, trade.swapStaffShiftId), eq(staffShiftsTable.restaurantId, restaurantId)));
      }
    }
    const [updated] = await db
      .update(shiftTradeRequestsTable)
      .set({
        status: decision === "approve" ? "approved" : "rejected",
        decidedByUserId: caller?.sub ?? null,
        decidedAt: new Date(),
        decisionNote: note,
        updatedAt: new Date(),
      })
      .where(eq(shiftTradeRequestsTable.id, id))
      .returning();
    await audit(restaurantId, caller?.sub ?? null, decision, "shift_trade_request", id, { note }, req.ip);
    // Notify both parties
    const recipients = [trade.fromUserId, trade.toUserId].filter((x): x is number => x != null);
    if (recipients.length) {
      await pushToUserIds(recipients, "approval_request", {
        title: `Shift trade ${decision === "approve" ? "approved" : "rejected"}`,
        body: note ?? "Your shift-trade request has been reviewed.",
        data: { type: "shift_trade", id },
      }).catch(() => undefined);
    }
    res.json(updated);
  },
);

router.post(
  "/restaurants/:restaurantId/shift-trades/:id/cancel",
  requireRole(...ALL_STAFF_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const caller = req.user;
    const [trade] = await db
      .select()
      .from(shiftTradeRequestsTable)
      .where(and(eq(shiftTradeRequestsTable.id, id), eq(shiftTradeRequestsTable.restaurantId, restaurantId)));
    if (!trade) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const isManager = (MANAGER_ROLES as readonly string[]).includes(caller?.role ?? "");
    if (!isManager && trade.fromUserId !== caller?.sub) {
      res.status(403).json({ error: "Not your trade" });
      return;
    }
    if (trade.status === "approved") {
      res.status(409).json({ error: "Cannot cancel an approved trade" });
      return;
    }
    const [updated] = await db
      .update(shiftTradeRequestsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(shiftTradeRequestsTable.id, id))
      .returning();
    await audit(restaurantId, caller?.sub ?? null, "cancel", "shift_trade_request", id, null, req.ip);
    res.json(updated);
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Publish & notify
// ─────────────────────────────────────────────────────────────────────────

router.get(
  "/restaurants/:restaurantId/schedule-publications",
  requireRole(...MANAGER_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const rows = await db
      .select()
      .from(schedulePublicationsTable)
      .where(eq(schedulePublicationsTable.restaurantId, restaurantId))
      .orderBy(sql`${schedulePublicationsTable.weekStart} DESC`)
      .limit(50);
    res.json(rows);
  },
);

router.post(
  "/restaurants/:restaurantId/schedule-publications",
  requireRole(...MANAGER_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const caller = req.user;
    const { weekStart, weekEnd, note, channels } = req.body ?? {};
    if (!weekStart || !weekEnd) {
      res.status(400).json({ error: "weekStart and weekEnd are required" });
      return;
    }
    const start = new Date(weekStart);
    const end = new Date(weekEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      res.status(400).json({ error: "Invalid dates" });
      return;
    }
    // Snapshot the assignments in this window with assignee phone/email for notifications.
    const assignments = await db
      .select({
        id: staffShiftsTable.id,
        userId: staffShiftsTable.userId,
        date: staffShiftsTable.date,
        endDate: staffShiftsTable.endDate,
        shiftId: staffShiftsTable.shiftId,
        shiftName: shiftsTable.name,
        startTime: shiftsTable.startTime,
        endTimeStr: shiftsTable.endTime,
        userName: usersTable.name,
        userPhone: usersTable.phone,
      })
      .from(staffShiftsTable)
      .leftJoin(shiftsTable, eq(staffShiftsTable.shiftId, shiftsTable.id))
      .leftJoin(usersTable, eq(staffShiftsTable.userId, usersTable.id))
      .where(
        and(
          eq(staffShiftsTable.restaurantId, restaurantId),
          gte(staffShiftsTable.date, start),
          lt(staffShiftsTable.date, end),
        ),
      );

    const channelCfg = {
      push: channels?.push !== false,
      sms: channels?.sms === true,
      whatsapp: channels?.whatsapp === true,
    };

    const [pub] = await db
      .insert(schedulePublicationsTable)
      .values({
        restaurantId,
        weekStart: start,
        weekEnd: end,
        publishedByUserId: caller?.sub ?? null,
        assignmentCount: assignments.length,
        channels: channelCfg,
        note: note ?? null,
      })
      .returning();
    await audit(restaurantId, caller?.sub ?? null, "publish", "schedule_publication", pub.id, { weekStart, weekEnd, count: assignments.length, channels: channelCfg }, req.ip);

    // Push to in-app for all involved users in one batch.
    const userIds = Array.from(new Set(assignments.map(a => a.userId).filter((x): x is number => x != null)));
    if (channelCfg.push && userIds.length > 0) {
      await pushToUserIds(userIds, "approval_request", {
        title: "Your schedule is published",
        body: `Schedule for ${start.toDateString()} – ${end.toDateString()} is now live.`,
        data: { type: "schedule_published", publicationId: pub.id },
      }).catch((err) => logger.warn({ err }, "[scheduling] in-app push failed"));
    }

    // Per-user SMS / WhatsApp summary (best-effort, non-blocking).
    if (channelCfg.sms || channelCfg.whatsapp) {
      const byUser = new Map<number, typeof assignments>();
      for (const a of assignments) {
        if (!a.userId) continue;
        const arr = byUser.get(a.userId) ?? [];
        arr.push(a);
        byUser.set(a.userId, arr);
      }
      for (const [, rows] of byUser) {
        const first = rows[0];
        if (!first?.userPhone) continue;
        const lines = rows
          .slice(0, 7)
          .map(r => {
            const d = r.date instanceof Date ? r.date : new Date(r.date as unknown as string);
            return `• ${d.toDateString().slice(0, 10)} ${r.shiftName ?? ""} ${r.startTime ?? ""}-${r.endTimeStr ?? ""}`;
          })
          .join("\n");
        const body = `Hi ${first.userName ?? "team"}, your new schedule:\n${lines}`;
        if (channelCfg.sms) {
          sendSms({ to: first.userPhone, body }).catch(err => logger.warn({ err, to: first.userPhone }, "[scheduling] SMS failed"));
        }
        if (channelCfg.whatsapp) {
          sendWhatsApp({ to: first.userPhone, body }).catch(err => logger.warn({ err, to: first.userPhone }, "[scheduling] WhatsApp failed"));
        }
      }
    }

    res.status(201).json(pub);
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Labor forecast (sales-based hourly headcount)
// ─────────────────────────────────────────────────────────────────────────

router.get(
  "/restaurants/:restaurantId/labor-forecast",
  requireRole(...MANAGER_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const weekStartParam = typeof req.query.weekStart === "string" ? req.query.weekStart : null;
    if (!weekStartParam) {
      res.status(400).json({ error: "weekStart is required" });
      return;
    }
    const weekStart = new Date(weekStartParam);
    if (Number.isNaN(weekStart.getTime())) {
      res.status(400).json({ error: "Invalid weekStart" });
      return;
    }
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7); weekEnd.setHours(0, 0, 0, 0);
    const settings = await getOrCreateSettings(restaurantId);
    const salesPerLaborHour = Math.max(1, Number(settings.salesPerLaborHour));

    // Look back N weeks of orders, group by day-of-week × hour.
    const lookbackWeeks = 6;
    const lookbackStart = new Date(weekStart); lookbackStart.setDate(lookbackStart.getDate() - lookbackWeeks * 7);

    const rows = await db
      .select({
        dow: sql<number>`EXTRACT(DOW FROM ${ordersTable.createdAt})::int`,
        hour: sql<number>`EXTRACT(HOUR FROM ${ordersTable.createdAt})::int`,
        total: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`,
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.restaurantId, restaurantId),
          gte(ordersTable.createdAt, lookbackStart),
          lt(ordersTable.createdAt, weekStart),
        ),
      )
      .groupBy(sql`EXTRACT(DOW FROM ${ordersTable.createdAt}), EXTRACT(HOUR FROM ${ordersTable.createdAt})`);

    // Average per slot across weeks.
    const salesByDowHour = new Map<string, number>();
    for (const r of rows) {
      salesByDowHour.set(`${r.dow}:${r.hour}`, Number(r.total) / lookbackWeeks);
    }

    // Get currently scheduled headcount per hour for the target week.
    const sched = await db
      .select({
        userId: staffShiftsTable.userId,
        date: staffShiftsTable.date,
        startTime: shiftsTable.startTime,
        endTimeStr: shiftsTable.endTime,
      })
      .from(staffShiftsTable)
      .innerJoin(shiftsTable, eq(staffShiftsTable.shiftId, shiftsTable.id))
      .where(
        and(
          eq(staffShiftsTable.restaurantId, restaurantId),
          gte(staffShiftsTable.date, weekStart),
          lt(staffShiftsTable.date, weekEnd),
        ),
      );

    const scheduledByDowHour = new Map<string, number>();
    for (const a of sched) {
      const d = a.date instanceof Date ? a.date : new Date(a.date as unknown as string);
      const dow = d.getDay();
      const startMin = parseHHMM(a.startTime ?? "00:00");
      const endMin = (() => {
        let e = parseHHMM(a.endTimeStr ?? "00:00");
        if (e <= startMin) e += 24 * 60;
        return e;
      })();
      for (let m = startMin; m < endMin; m += 60) {
        const h = Math.floor((m % (24 * 60)) / 60);
        const k = `${dow}:${h}`;
        scheduledByDowHour.set(k, (scheduledByDowHour.get(k) ?? 0) + 1);
      }
    }

    const slots: Array<{
      dow: number;
      hour: number;
      avgSales: number;
      suggestedHeadcount: number;
      scheduledHeadcount: number;
      status: "ok" | "under" | "over";
    }> = [];
    const alerts: Array<{ dow: number; hour: number; kind: "under" | "over"; suggested: number; scheduled: number }> = [];
    for (let dow = 0; dow < 7; dow++) {
      for (let h = 0; h < 24; h++) {
        const k = `${dow}:${h}`;
        const avgSales = salesByDowHour.get(k) ?? 0;
        if (avgSales === 0 && !scheduledByDowHour.has(k)) continue;
        const suggested = Math.max(0, Math.ceil(avgSales / salesPerLaborHour));
        const scheduled = scheduledByDowHour.get(k) ?? 0;
        let status: "ok" | "under" | "over" = "ok";
        if (suggested > 0 && scheduled < suggested) status = "under";
        else if (suggested > 0 && scheduled > suggested + 1) status = "over";
        slots.push({ dow, hour: h, avgSales: Math.round(avgSales * 100) / 100, suggestedHeadcount: suggested, scheduledHeadcount: scheduled, status });
        if (status !== "ok") alerts.push({ dow, hour: h, kind: status, suggested, scheduled });
      }
    }

    res.json({
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      lookbackWeeks,
      salesPerLaborHour,
      slots,
      alerts,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Labor cost % vs sales report
// ─────────────────────────────────────────────────────────────────────────

router.get(
  "/restaurants/:restaurantId/labor-report",
  requireRole(...MANAGER_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.status(400).json({ error: "from and to are required (ISO dates)" });
      return;
    }
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    const settings = await getOrCreateSettings(restaurantId);
    const defaultHourlyCost = Number(settings.defaultHourlyCost);
    const targetPct = Number(settings.targetLaborPct);

    // Daily sales
    const salesRows = await db
      .select({
        day: sql<string>`TO_CHAR(${ordersTable.createdAt}, 'YYYY-MM-DD')`,
        total: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`,
      })
      .from(ordersTable)
      .where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to)))
      .groupBy(sql`TO_CHAR(${ordersTable.createdAt}, 'YYYY-MM-DD')`);

    // Daily labor minutes from attendance (worked + overtime) and per-user salary.
    const attRows = await db
      .select({
        day: sql<string>`TO_CHAR(${attendanceTable.clockIn}, 'YYYY-MM-DD')`,
        userId: attendanceTable.userId,
        worked: sql<number>`COALESCE(SUM(${attendanceTable.workedMinutes}), 0)::int`,
        overtime: sql<number>`COALESCE(SUM(${attendanceTable.overtimeMinutes}), 0)::int`,
      })
      .from(attendanceTable)
      .where(and(eq(attendanceTable.restaurantId, restaurantId), gte(attendanceTable.clockIn, from), lte(attendanceTable.clockIn, to)))
      .groupBy(sql`TO_CHAR(${attendanceTable.clockIn}, 'YYYY-MM-DD'), ${attendanceTable.userId}`);

    // Build daily labor cost = Σ (hours * effectiveHourlyCost). Use defaultHourlyCost as fallback.
    // NOTE: users.salary / users.salaryType were removed from the schema; we
    // currently apply defaultHourlyCost uniformly. When per-user payroll
    // data lands (HR-compliance module), reintroduce the join here.
    const userIds = Array.from(new Set(attRows.map(r => r.userId)));
    let hourlyByUser = new Map<number, number>();
    if (userIds.length > 0) {
      const users = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds));
      for (const u of users) {
        const salary = 0;
        if (!salary) continue;
        let hourly = defaultHourlyCost;
        switch ("" as string) {
          case "hourly": hourly = salary; break;
          case "fixed_monthly": hourly = salary / (4 * 40); break;
          case "fixed_weekly": hourly = salary / 40; break;
          case "fixed_daily": hourly = salary / 8; break;
          default: hourly = defaultHourlyCost;
        }
        hourlyByUser.set(u.id, hourly);
      }
    }

    const laborByDay = new Map<string, number>();
    const minutesByDay = new Map<string, number>();
    for (const r of attRows) {
      const hourly = hourlyByUser.get(r.userId) ?? defaultHourlyCost;
      const cost = ((r.worked + r.overtime) / 60) * hourly;
      laborByDay.set(r.day, (laborByDay.get(r.day) ?? 0) + cost);
      minutesByDay.set(r.day, (minutesByDay.get(r.day) ?? 0) + r.worked + r.overtime);
    }

    const days = Array.from(new Set([...salesRows.map(s => s.day), ...laborByDay.keys()])).sort();
    const series = days.map(day => {
      const sales = Number(salesRows.find(s => s.day === day)?.total ?? 0);
      const labor = laborByDay.get(day) ?? 0;
      const minutes = minutesByDay.get(day) ?? 0;
      const pct = sales > 0 ? (labor / sales) * 100 : 0;
      return {
        day,
        sales: Math.round(sales * 100) / 100,
        laborCost: Math.round(labor * 100) / 100,
        laborMinutes: minutes,
        laborPct: Math.round(pct * 100) / 100,
        overTarget: pct > targetPct,
      };
    });
    const totSales = series.reduce((s, d) => s + d.sales, 0);
    const totLabor = series.reduce((s, d) => s + d.laborCost, 0);
    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      targetLaborPct: targetPct,
      defaultHourlyCost,
      series,
      totals: {
        sales: Math.round(totSales * 100) / 100,
        laborCost: Math.round(totLabor * 100) / 100,
        laborPct: totSales > 0 ? Math.round((totLabor / totSales) * 10000) / 100 : 0,
      },
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Break / overtime reminders helper (returns who is currently in violation)
// ─────────────────────────────────────────────────────────────────────────

router.get(
  "/restaurants/:restaurantId/labor-violations",
  requireRole(...MANAGER_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const settings = await getOrCreateSettings(restaurantId);
    // Open attendance sessions
    const open = await db
      .select({
        id: attendanceTable.id,
        userId: attendanceTable.userId,
        clockIn: attendanceTable.clockIn,
        workedMinutes: attendanceTable.workedMinutes,
        overtimeMinutes: attendanceTable.overtimeMinutes,
        userName: usersTable.name,
      })
      .from(attendanceTable)
      .leftJoin(usersTable, eq(attendanceTable.userId, usersTable.id))
      .where(
        and(
          eq(attendanceTable.restaurantId, restaurantId),
          sql`${attendanceTable.clockOut} IS NULL`,
        ),
      );
    const now = Date.now();
    const violations = open
      .map(o => {
        const inAt = o.clockIn instanceof Date ? o.clockIn.getTime() : new Date(o.clockIn as unknown as string).getTime();
        const minutes = Math.max(0, Math.floor((now - inAt) / 60000));
        const issues: string[] = [];
        if (minutes >= settings.breakAfterMinutes && minutes < settings.breakAfterMinutes + 60) {
          issues.push(`Break due after ${settings.breakAfterMinutes / 60}h`);
        }
        if (minutes >= settings.overtimeAfterMinutesPerDay) {
          issues.push(`Overtime threshold reached (${(settings.overtimeAfterMinutesPerDay / 60).toFixed(1)}h)`);
        }
        return { ...o, currentMinutes: minutes, issues };
      })
      .filter(o => o.issues.length > 0);
    res.json({ violations, settings });
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Bulk assignment for the grid (drag-and-drop saves)
// ─────────────────────────────────────────────────────────────────────────

router.post(
  "/restaurants/:restaurantId/staff-shifts/bulk",
  requireRole(...MANAGER_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const caller = req.user;
    const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
    if (!assignments.length) {
      res.status(400).json({ error: "assignments[] is required" });
      return;
    }
    // Validate every userId and shiftId belongs to this restaurant before any insert.
    const userIds: number[] = Array.from(new Set(assignments.map((a: { userId?: number }) => Number(a.userId)).filter((n: number) => Number.isFinite(n) && n > 0)));
    const shiftIds: number[] = Array.from(new Set(assignments.map((a: { shiftId?: number }) => Number(a.shiftId)).filter((n: number) => Number.isFinite(n) && n > 0)));
    if (userIds.length === 0 || shiftIds.length === 0) {
      res.status(400).json({ error: "Each assignment requires userId, shiftId, and date" });
      return;
    }
    const validUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(inArray(usersTable.id, userIds), eq(usersTable.restaurantId, restaurantId)));
    if (validUsers.length !== userIds.length) {
      res.status(403).json({ error: "One or more users do not belong to this restaurant" });
      return;
    }
    const validShifts = await db
      .select({ id: shiftsTable.id })
      .from(shiftsTable)
      .where(and(inArray(shiftsTable.id, shiftIds), eq(shiftsTable.restaurantId, restaurantId)));
    if (validShifts.length !== shiftIds.length) {
      res.status(403).json({ error: "One or more shifts do not belong to this restaurant" });
      return;
    }
    const created: typeof staffShiftsTable.$inferSelect[] = [];
    for (const a of assignments) {
      if (!a.userId || !a.shiftId || !a.date) continue;
      const [row] = await db
        .insert(staffShiftsTable)
        .values({
          userId: Number(a.userId),
          shiftId: Number(a.shiftId),
          restaurantId,
          date: new Date(a.date),
          endDate: a.endDate ? new Date(a.endDate) : null,
          recurringDays: Array.isArray(a.recurringDays) ? a.recurringDays : [],
        })
        .returning();
      created.push(row);
    }
    await audit(restaurantId, caller?.sub ?? null, "bulk_create", "staff_shift", null, { count: created.length }, req.ip);
    res.status(201).json(created);
  },
);

// Copy previous week's assignments forward.
router.post(
  "/restaurants/:restaurantId/staff-shifts/copy-week",
  requireRole(...MANAGER_ROLES),
  validateRestaurantAccess,
  PLAN_GATE,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const caller = req.user;
    const { fromWeekStart, toWeekStart } = req.body ?? {};
    if (!fromWeekStart || !toWeekStart) {
      res.status(400).json({ error: "fromWeekStart and toWeekStart required" });
      return;
    }
    const fromStart = new Date(fromWeekStart); fromStart.setHours(0, 0, 0, 0);
    const fromEnd = new Date(fromStart); fromEnd.setDate(fromEnd.getDate() + 7);
    const toStart = new Date(toWeekStart); toStart.setHours(0, 0, 0, 0);
    const offsetMs = toStart.getTime() - fromStart.getTime();
    const source = await db
      .select()
      .from(staffShiftsTable)
      .where(
        and(
          eq(staffShiftsTable.restaurantId, restaurantId),
          gte(staffShiftsTable.date, fromStart),
          lt(staffShiftsTable.date, fromEnd),
        ),
      );
    // Dedup: skip targets that already exist (same user+shift+date in this restaurant).
    const toEnd = new Date(toStart); toEnd.setDate(toEnd.getDate() + 7);
    const existing = await db
      .select({ userId: staffShiftsTable.userId, shiftId: staffShiftsTable.shiftId, date: staffShiftsTable.date })
      .from(staffShiftsTable)
      .where(
        and(
          eq(staffShiftsTable.restaurantId, restaurantId),
          gte(staffShiftsTable.date, toStart),
          lt(staffShiftsTable.date, toEnd),
        ),
      );
    const existingKey = new Set(existing.map(e => {
      const d = e.date instanceof Date ? e.date : new Date(e.date as unknown as string);
      return `${e.userId}:${e.shiftId}:${d.toISOString().slice(0, 10)}`;
    }));
    const inserted: typeof staffShiftsTable.$inferSelect[] = [];
    let skipped = 0;
    for (const s of source) {
      const orig = s.date instanceof Date ? s.date : new Date(s.date as unknown as string);
      const newDate = new Date(orig.getTime() + offsetMs);
      const key = `${s.userId}:${s.shiftId}:${newDate.toISOString().slice(0, 10)}`;
      if (existingKey.has(key)) { skipped++; continue; }
      existingKey.add(key);
      const [row] = await db
        .insert(staffShiftsTable)
        .values({
          userId: s.userId,
          shiftId: s.shiftId,
          restaurantId,
          date: newDate,
          endDate: s.endDate ? new Date(new Date(s.endDate as unknown as string).getTime() + offsetMs) : null,
          recurringDays: s.recurringDays ?? [],
        })
        .returning();
      inserted.push(row);
    }
    await audit(restaurantId, caller?.sub ?? null, "copy_week", "staff_shift", null, { count: inserted.length, skipped, fromWeekStart, toWeekStart }, req.ip);
    res.status(201).json({ count: inserted.length, skipped, assignments: inserted });
  },
);

// Exported for tests / scheduler reuse.
export { shiftDurationMinutes };

export default router;
