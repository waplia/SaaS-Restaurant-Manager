/**
 * Operations Intelligence pack — Task #366.
 * Provides REST endpoints for all 13 operations features behind plan gates.
 */
import { Router, type Request, type Response } from "express";
import { eq, and, desc, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  db,
  discountApprovalsTable,
  panicAlertsTable,
  managerHandoversTable,
  morningBriefingsTable,
  closingChecklistTemplatesTable,
  closingChecklistRunsTable,
  timelineEventsTable,
  opsApprovalsTable,
  incidentsTable,
  cleaningProofsTable,
  temperatureLogsTable,
  equipmentRegisterTable,
  equipmentMaintenanceRecordsTable,
  serviceTimerEventsTable,
  ordersTable,
  floorTablesTable,
  kitchensTable,
  usersTable,
  restaurantsTable,
  type ClosingChecklistItem,
} from "../lib/db";
import { sendByTemplateKey } from "../lib/emailSender";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { recordAuditLog } from "../lib/audit";
import { broadcastEvent } from "../lib/socketio";
import { pushToStaff } from "../lib/pushNotify";
import { sendWhatsAppMessage } from "../lib/whatsapp";
import { sendSms, sendEmail } from "../lib/notifications";
import { inArray } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Fanout a high-priority ops notification across all available channels:
 * in-app push, WhatsApp, and SMS. Each channel is best-effort; failures
 * in one channel never block the others or the API response.
 */
async function fanoutOpsNotification(
  restaurantId: number,
  roles: ("owner" | "manager" | "super_admin" | "waiter" | "kitchen" | "cashier")[],
  payload: { type: "panic_alert" | "approval_request" | "incident_reported" | "temperature_alert"; title: string; body: string; data?: Record<string, unknown> },
) {
  // Channel 1: in-app push — type goes in the filter, not the payload.
  pushToStaff(
    { restaurantId, roles, type: payload.type },
    { title: payload.title, body: payload.body, data: payload.data },
  ).catch(err => logger.error({ err, restaurantId }, "ops fanout push failed"));

  // Channels 2 & 3: WhatsApp + SMS to the same recipients (active users in the
  // restaurant with one of the requested roles and a phone number on file).
  void (async () => {
    try {
      const recipients = await db.select({ phone: usersTable.phone })
        .from(usersTable)
        .where(and(
          eq(usersTable.restaurantId, restaurantId),
          eq(usersTable.isActive, true),
          inArray(usersTable.role, roles),
        ));
      const phones = [...new Set(recipients.map(r => r.phone).filter((p): p is string => !!p && p.trim().length > 0))];
      const message = `[${payload.title}] ${payload.body}`;
      for (const to of phones) {
        sendWhatsAppMessage({ restaurantId, to, body: message, meta: { ops: payload.type, ...(payload.data ?? {}) } })
          .catch(err => logger.warn({ err, to }, "ops whatsapp send failed"));
        sendSms({ to, body: message })
          .catch(err => logger.warn({ err, to }, "ops sms send failed"));
      }
    } catch (err) {
      logger.error({ err, restaurantId }, "ops fanout recipient lookup failed");
    }
  })();
}

const router = Router();

// All routes are scoped to a restaurant. Validate access on every request.
router.use("/restaurants/:restaurantId/ops", validateRestaurantAccess);
router.use("/restaurants/:restaurantId/kitchen", validateRestaurantAccess);

function rid(req: Request): number { return Number(req.params.restaurantId); }
function userId(req: Request): number | null { return (req.user as { sub?: number; id?: number } | undefined)?.sub ?? (req.user as { id?: number } | undefined)?.id ?? null; }

async function logTimeline(restaurantId: number, eventType: string, summary: string, opts: { entity?: string; entityId?: number | null; actorUserId?: number | null; metadata?: Record<string, unknown> } = {}) {
  try {
    await db.insert(timelineEventsTable).values({
      restaurantId,
      eventType,
      entity: opts.entity ?? null,
      entityId: opts.entityId ?? null,
      summary,
      actorUserId: opts.actorUserId ?? null,
      metadata: opts.metadata ?? {},
    });
  } catch (err) {
    logger.error({ err, restaurantId, eventType }, "logTimeline failed");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Restaurant Digital Twin — read-only snapshot of floor + kitchen
// ─────────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/ops/digital-twin",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_digital_twin"),
  async (req, res) => {
    const restaurantId = rid(req);
    const [tables, kitchens, openOrders, panic, kitchenTicketCounts, recentTimers] = await Promise.all([
      db.select().from(floorTablesTable).where(eq(floorTablesTable.restaurantId, restaurantId)),
      db.select().from(kitchensTable).where(eq(kitchensTable.restaurantId, restaurantId)),
      db.select().from(ordersTable).where(and(
        eq(ordersTable.restaurantId, restaurantId),
        sql`${ordersTable.status} NOT IN ('completed','cancelled','refunded')`,
      )).orderBy(desc(ordersTable.createdAt)).limit(200),
      db.select().from(panicAlertsTable).where(and(
        eq(panicAlertsTable.restaurantId, restaurantId),
        eq(panicAlertsTable.status, "open"),
      )),
      // Per-kitchen open ticket counts via SQL over kitchen_tickets if present.
      db.execute(sql`
        SELECT kitchen_id::int AS "kitchenId", COUNT(*)::int AS "openTickets"
        FROM kitchen_tickets
        WHERE restaurant_id = ${restaurantId}
          AND status NOT IN ('completed','cancelled','served')
        GROUP BY kitchen_id
      `).then(r => (r as unknown as { rows: Array<{ kitchenId: number; openTickets: number }> }).rows ?? []).catch(() => [] as Array<{ kitchenId: number; openTickets: number }>),
      // Last 4h timer events for wait-time + bottleneck analysis.
      db.select({ stage: serviceTimerEventsTable.stage, durationMs: serviceTimerEventsTable.durationMs })
        .from(serviceTimerEventsTable)
        .where(and(
          eq(serviceTimerEventsTable.restaurantId, restaurantId),
          gte(serviceTimerEventsTable.occurredAt, new Date(Date.now() - 4 * 3600 * 1000)),
        )),
    ]);

    // Per-stage avg duration (ms) over last 4h; bottleneck = stage with max avg.
    const stageBuckets: Record<string, number[]> = {};
    for (const e of recentTimers) if (e.durationMs != null) (stageBuckets[e.stage] ??= []).push(e.durationMs);
    const stageAvg = Object.entries(stageBuckets).map(([stage, arr]) => ({
      stage,
      avgMs: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
      count: arr.length,
    }));
    const bottleneck = stageAvg.length > 0 ? stageAvg.reduce((m, s) => s.avgMs > m.avgMs ? s : m) : null;
    const avgWaitMs = stageAvg.length > 0 ? Math.round(stageAvg.reduce((a, s) => a + s.avgMs, 0) / stageAvg.length) : null;

    // Waiter load: distinct active waiter count + open orders per waiter.
    const waiterRows = await db.select({ waiterId: ordersTable.waiterId, count: sql<number>`count(*)::int` })
      .from(ordersTable)
      .where(and(
        eq(ordersTable.restaurantId, restaurantId),
        sql`${ordersTable.status} NOT IN ('completed','cancelled','refunded')`,
        sql`${ordersTable.waiterId} IS NOT NULL`,
      ))
      .groupBy(ordersTable.waiterId).catch(() => [] as Array<{ waiterId: number | null; count: number }>);
    const waiterLoad = waiterRows.map(r => ({ waiterId: r.waiterId, openOrders: r.count }));
    const activeWaiters = waiterLoad.length;
    const maxWaiterLoad = waiterLoad.reduce((m, w) => Math.max(m, w.openOrders), 0);

    res.json({
      tables: tables.map(t => ({ id: t.id, label: t.tableNumber, status: t.status, capacity: t.capacity })),
      kitchens: kitchens.map(k => ({
        id: k.id,
        name: k.name,
        openTickets: kitchenTicketCounts.find(c => c.kitchenId === k.id)?.openTickets ?? 0,
      })),
      openOrders: openOrders.map(o => ({ id: o.id, status: o.status, type: o.orderType, tableId: o.tableId, total: o.totalAmount, createdAt: o.createdAt })),
      activeAlerts: panic.length,
      kpis: {
        activeWaiters,
        maxWaiterLoad,
        avgWaitMs,
        openOrders: openOrders.length,
        openTickets: kitchenTicketCounts.reduce((a, c) => a + c.openTickets, 0),
      },
      waiterLoad,
      stageAvg,
      bottleneck: bottleneck ? { stage: bottleneck.stage, avgMs: bottleneck.avgMs, callout: `Bottleneck at "${bottleneck.stage}" — avg ${(bottleneck.avgMs / 1000).toFixed(1)}s` } : null,
      generatedAt: new Date().toISOString(),
    });
  });

// ─────────────────────────────────────────────────────────────────────────
// 2. Smart Service Timer — events on orders, returns durations per stage
// ─────────────────────────────────────────────────────────────────────────
router.post("/restaurants/:restaurantId/ops/service-timer/events",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "super_admin"),
  requirePlanFeature("ops_event_timeline"),
  async (req, res) => {
    const restaurantId = rid(req);
    const b = req.body as { orderId?: number; stage?: string };
    if (!b.orderId || !b.stage) return void res.status(400).json({ error: "orderId and stage required" });
    // Tenant-scope check: the order must belong to this restaurant before we
    // accept any timer events for it.
    const [order] = await db.select({ id: ordersTable.id }).from(ordersTable)
      .where(and(eq(ordersTable.id, b.orderId), eq(ordersTable.restaurantId, restaurantId)));
    if (!order) return void res.status(404).json({ error: "order not found" });
    const [prev] = await db.select().from(serviceTimerEventsTable)
      .where(and(eq(serviceTimerEventsTable.orderId, b.orderId), eq(serviceTimerEventsTable.restaurantId, restaurantId)))
      .orderBy(desc(serviceTimerEventsTable.occurredAt)).limit(1);
    const now = new Date();
    const durationMs = prev ? now.getTime() - new Date(prev.occurredAt).getTime() : null;
    const [row] = await db.insert(serviceTimerEventsTable).values({
      restaurantId, orderId: b.orderId, stage: b.stage, occurredAt: now, durationMs,
    }).returning();
    await recordAuditLog({ req, module: "ops", action: "service_timer.event", entity: "service_timer_event", entityId: row.id, restaurantId, newValue: { orderId: row.orderId, stage: row.stage, durationMs: row.durationMs } });
    broadcastEvent(restaurantId, "service_timer:event", row);
    res.status(201).json(row);
  });

router.get("/restaurants/:restaurantId/ops/service-timer/orders/:orderId",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "super_admin"),
  requirePlanFeature("ops_event_timeline"),
  async (req, res) => {
    const restaurantId = rid(req);
    const orderId = Number(req.params.orderId);
    // Tenant-scoped read: a user in restaurant A must not see service-timer
    // events for an order belonging to restaurant B.
    const rows = await db.select().from(serviceTimerEventsTable)
      .where(and(eq(serviceTimerEventsTable.orderId, orderId), eq(serviceTimerEventsTable.restaurantId, restaurantId)))
      .orderBy(serviceTimerEventsTable.occurredAt);
    res.json(rows);
  });

router.get("/restaurants/:restaurantId/ops/service-timer/summary",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_event_timeline"),
  async (req, res) => {
    const restaurantId = rid(req);
    const days = Math.max(1, Math.min(Number(req.query.days ?? 7), 90));
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    // Manager metrics: avg, median (p50), p90, count — bucketed by stage and day.
    const rows = await db.execute(sql`
      SELECT
        stage,
        date_trunc('day', occurred_at) AS day,
        COUNT(*)::int AS count,
        AVG(duration_ms)::int AS "avgMs",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS "medianMs",
        percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_ms)::int AS "p90Ms"
      FROM service_timer_events
      WHERE restaurant_id = ${restaurantId}
        AND occurred_at >= ${since}
        AND duration_ms IS NOT NULL
      GROUP BY stage, day
      ORDER BY day DESC, stage
    `);
    const byStageDay = (rows as unknown as { rows: Array<{ stage: string; day: string; count: number; avgMs: number; medianMs: number; p90Ms: number }> }).rows ?? [];
    // Roll-up across the window per stage.
    const overallRows = await db.execute(sql`
      SELECT
        stage,
        COUNT(*)::int AS count,
        AVG(duration_ms)::int AS "avgMs",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS "medianMs",
        percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_ms)::int AS "p90Ms"
      FROM service_timer_events
      WHERE restaurant_id = ${restaurantId}
        AND occurred_at >= ${since}
        AND duration_ms IS NOT NULL
      GROUP BY stage
      ORDER BY stage
    `);
    const overall = (overallRows as unknown as { rows: Array<{ stage: string; count: number; avgMs: number; medianMs: number; p90Ms: number }> }).rows ?? [];
    res.json({ windowDays: days, overall, byStageDay });
  });

// ─────────────────────────────────────────────────────────────────────────
// 3. Staff Panic Button
// ─────────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/ops/panic-alerts",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_panic_button"),
  async (req, res) => {
    const restaurantId = rid(req);
    const rows = await db.select().from(panicAlertsTable)
      .where(eq(panicAlertsTable.restaurantId, restaurantId))
      .orderBy(desc(panicAlertsTable.raisedAt)).limit(200);
    res.json(rows);
  });

router.post("/restaurants/:restaurantId/ops/panic-alerts",
  // Any authenticated staff member can raise a panic alert; the parent
  // router's restaurant-access guard ensures they belong to this tenant.
  requirePlanFeature("ops_panic_button"),
  async (req, res) => {
    const restaurantId = rid(req);
    const b = req.body as { type?: string; message?: string };
    const type = b.type ?? "general";
    const [row] = await db.insert(panicAlertsTable).values({
      restaurantId, type, message: b.message?.slice(0, 1000) ?? null,
      raisedByUserId: userId(req),
    }).returning();
    await recordAuditLog({ req, module: "ops", action: "panic.raise", entity: "panic_alert", entityId: row.id, restaurantId, newValue: { type } });
    await logTimeline(restaurantId, "panic_raised", `Panic alert: ${type}`, { entity: "panic_alert", entityId: row.id, actorUserId: userId(req), metadata: { type } });
    broadcastEvent(restaurantId, "panic:raised", row);
    try {
      await fanoutOpsNotification(restaurantId, ["owner", "manager"], {
        type: "panic_alert",
        title: "PANIC ALERT raised",
        body: `${type}${b.message ? ` — ${b.message}` : ""}`,
        data: { alertId: row.id, type },
      });
    } catch (err) { logger.error({ err }, "panic fanout failed"); }
    res.status(201).json(row);
  });

router.patch("/restaurants/:restaurantId/ops/panic-alerts/:id",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_panic_button"),
  async (req, res) => {
    const restaurantId = rid(req);
    const id = Number(req.params.id);
    const b = req.body as { status?: "acknowledged" | "resolved"; notes?: string };
    const patch: Record<string, unknown> = { notes: b.notes ?? null };
    const now = new Date();
    if (b.status === "acknowledged") { patch.status = "acknowledged"; patch.acknowledgedAt = now; patch.acknowledgedByUserId = userId(req); }
    if (b.status === "resolved") { patch.status = "resolved"; patch.resolvedAt = now; patch.resolvedByUserId = userId(req); }
    const [row] = await db.update(panicAlertsTable).set(patch)
      .where(and(eq(panicAlertsTable.id, id), eq(panicAlertsTable.restaurantId, restaurantId)))
      .returning();
    if (!row) return void res.status(404).json({ error: "not found" });
    await recordAuditLog({ req, module: "ops", action: `panic.${b.status ?? "update"}`, entity: "panic_alert", entityId: id, restaurantId, newValue: patch });
    broadcastEvent(restaurantId, "panic:updated", row);
    res.json(row);
  });

// ─────────────────────────────────────────────────────────────────────────
// 4. Daily Manager Handover
// ─────────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/ops/handovers",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_shift_handover"),
  async (req, res) => {
    const restaurantId = rid(req);
    const rows = await db.select().from(managerHandoversTable)
      .where(eq(managerHandoversTable.restaurantId, restaurantId))
      .orderBy(desc(managerHandoversTable.submittedAt)).limit(100);
    res.json(rows);
  });

router.post("/restaurants/:restaurantId/ops/handovers",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_shift_handover"),
  // Submission of a handover is restricted to managerial roles because the
  // payload contains cash, staff and complaint details.
  async (req, res) => {
    const restaurantId = rid(req);
    const b = req.body as Record<string, unknown>;
    // Tenant-scope toUserId: a manager must not be able to address a
    // handover (which contains cash/staff/complaint notes) to a user from
    // a different restaurant. Validate the id belongs to this tenant
    // before persisting; reject otherwise.
    let safeToUserId: number | null = null;
    if (typeof b.toUserId === "number") {
      const [recipient] = await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.id, b.toUserId), eq(usersTable.restaurantId, restaurantId), eq(usersTable.isActive, true)));
      if (!recipient) return void res.status(400).json({ error: "toUserId must reference an active user in this restaurant" });
      safeToUserId = recipient.id;
    }
    const [row] = await db.insert(managerHandoversTable).values({
      restaurantId,
      shiftId: typeof b.shiftId === "number" ? b.shiftId : null,
      fromUserId: userId(req),
      toUserId: safeToUserId,
      cashIssue: (b.cashIssue as string) ?? null,
      stockIssue: (b.stockIssue as string) ?? null,
      staffIssue: (b.staffIssue as string) ?? null,
      pendingOrders: (b.pendingOrders as string) ?? null,
      complaints: (b.complaints as string) ?? null,
      tomorrowTasks: (b.tomorrowTasks as string) ?? null,
      notes: (b.notes as string) ?? null,
    }).returning();
    await recordAuditLog({ req, module: "ops", action: "handover.create", entity: "manager_handover", entityId: row.id, restaurantId, newValue: { id: row.id } });
    await logTimeline(restaurantId, "handover_submitted", "Shift handover submitted", { entity: "manager_handover", entityId: row.id, actorUserId: userId(req) });

    // Email the incoming manager + every owner of the restaurant so the
    // handover is delivered, not just stored.
    void (async () => {
      try {
        const owners = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable)
          .where(and(eq(usersTable.restaurantId, restaurantId), eq(usersTable.isActive, true), inArray(usersTable.role, ["owner"])));
        // Defence-in-depth: re-check the tenant scope here too, so a
        // race between write and dispatch cannot leak email content to a
        // user that has since been moved between restaurants.
        const toUser = row.toUserId
          ? await db.select({ email: usersTable.email }).from(usersTable)
              .where(and(eq(usersTable.id, row.toUserId), eq(usersTable.restaurantId, restaurantId), eq(usersTable.isActive, true)))
          : [];
        const emails = [
          ...owners.map(o => o.email),
          ...toUser.map(u => u.email),
        ].filter((e): e is string => !!e);
        const uniqueEmails = [...new Set(emails)];
        const summaryHtml = `<ul>
  <li><b>Cash:</b> ${row.cashIssue ?? "—"}</li>
  <li><b>Stock:</b> ${row.stockIssue ?? "—"}</li>
  <li><b>Staff:</b> ${row.staffIssue ?? "—"}</li>
  <li><b>Pending orders:</b> ${row.pendingOrders ?? "—"}</li>
  <li><b>Complaints:</b> ${row.complaints ?? "—"}</li>
  <li><b>Tomorrow:</b> ${row.tomorrowTasks ?? "—"}</li>
</ul>
<p>${row.notes ?? ""}</p>`;
        const [restaurant] = await db.select({ name: restaurantsTable.name }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
        for (const to of uniqueEmails) {
          sendByTemplateKey("staff_shift_handover", to, {
            name: "team",
            restaurant: restaurant?.name ?? "Restaurant",
            summaryHtml,
          }, { restaurantId, recipientType: "user" })
            .catch(err => logger.warn({ err, to }, "handover email failed"));
        }
      } catch (err) {
        logger.error({ err, restaurantId }, "handover dispatch failed");
      }
    })();

    res.status(201).json(row);
  });

// ─────────────────────────────────────────────────────────────────────────
// 5. Owner Morning Briefing
// ─────────────────────────────────────────────────────────────────────────
async function computeBriefing(restaurantId: number, forDate: string) {
  const start = new Date(`${forDate}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const prevStart = new Date(start.getTime() - 24 * 3600 * 1000);
  const [todayOrders, prevOrders, openIncidents, panicCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${ordersTable.totalAmount})::float,0)` })
      .from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, prevStart), lte(ordersTable.createdAt, start))),
    db.select({ count: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${ordersTable.totalAmount})::float,0)` })
      .from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, new Date(prevStart.getTime() - 24 * 3600 * 1000)), lte(ordersTable.createdAt, prevStart))),
    db.select({ count: sql<number>`count(*)::int` }).from(incidentsTable)
      .where(and(eq(incidentsTable.restaurantId, restaurantId), sql`${incidentsTable.status} IN ('open','investigating')`)),
    db.select({ count: sql<number>`count(*)::int` }).from(panicAlertsTable)
      .where(and(eq(panicAlertsTable.restaurantId, restaurantId), gte(panicAlertsTable.raisedAt, prevStart), lte(panicAlertsTable.raisedAt, end))),
  ]);
  return {
    yesterdayOrders: todayOrders[0]?.count ?? 0,
    yesterdayRevenue: todayOrders[0]?.total ?? 0,
    prevDayOrders: prevOrders[0]?.count ?? 0,
    prevDayRevenue: prevOrders[0]?.total ?? 0,
    openIncidents: openIncidents[0]?.count ?? 0,
    panicAlerts24h: panicCount[0]?.count ?? 0,
  };
}

router.get("/restaurants/:restaurantId/ops/briefings",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_daily_briefings"),
  async (req, res) => {
    const restaurantId = rid(req);
    const rows = await db.select().from(morningBriefingsTable)
      .where(eq(morningBriefingsTable.restaurantId, restaurantId))
      .orderBy(desc(morningBriefingsTable.forDate)).limit(30);
    res.json(rows);
  });

router.post("/restaurants/:restaurantId/ops/briefings/generate",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_daily_briefings"),
  async (req, res) => {
    const restaurantId = rid(req);
    const forDate = (req.body?.forDate as string) ?? new Date().toISOString().slice(0, 10);
    const summary = await computeBriefing(restaurantId, forDate);
    const [row] = await db.insert(morningBriefingsTable).values({
      restaurantId, forDate, summary, sentAt: new Date(),
    }).returning();
    await recordAuditLog({ req, module: "ops", action: "briefing.generate", entity: "morning_briefing", entityId: row.id, restaurantId, newValue: { forDate } });
    res.status(201).json(row);
  });

// ─────────────────────────────────────────────────────────────────────────
// 6. End-of-Day Auto Summary (read endpoint)
// ─────────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/ops/end-of-day",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_daily_briefings"),
  async (req, res) => {
    const restaurantId = rid(req);
    const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    const [orderAgg, incidentRows, panicRows, closingRows] = await Promise.all([
      db.select({
        count: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(${ordersTable.totalAmount})::float,0)`,
        cancelled: sql<number>`count(*) filter (where ${ordersTable.status} = 'cancelled')::int`,
      }).from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, start), lte(ordersTable.createdAt, end))),
      db.select().from(incidentsTable).where(and(eq(incidentsTable.restaurantId, restaurantId), gte(incidentsTable.reportedAt, start), lte(incidentsTable.reportedAt, end))),
      db.select().from(panicAlertsTable).where(and(eq(panicAlertsTable.restaurantId, restaurantId), gte(panicAlertsTable.raisedAt, start), lte(panicAlertsTable.raisedAt, end))),
      db.select().from(closingChecklistRunsTable).where(and(eq(closingChecklistRunsTable.restaurantId, restaurantId), gte(closingChecklistRunsTable.submittedAt, start), lte(closingChecklistRunsTable.submittedAt, end))),
    ]);
    res.json({
      date,
      orders: orderAgg[0] ?? { count: 0, revenue: 0, cancelled: 0 },
      incidents: incidentRows,
      panicAlerts: panicRows,
      closingRuns: closingRows,
    });
  });

// ─────────────────────────────────────────────────────────────────────────
// 7. Smart Closing Checklist
// ─────────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/ops/closing-templates",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_closing_checklist"),
  async (req, res) => {
    const restaurantId = rid(req);
    const rows = await db.select().from(closingChecklistTemplatesTable)
      .where(eq(closingChecklistTemplatesTable.restaurantId, restaurantId))
      .orderBy(desc(closingChecklistTemplatesTable.createdAt));
    res.json(rows);
  });

router.post("/restaurants/:restaurantId/ops/closing-templates",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_closing_checklist"),
  async (req, res) => {
    const restaurantId = rid(req);
    const b = req.body as { name?: string; items?: ClosingChecklistItem[]; enforceOnClose?: boolean };
    if (!b.name) return void res.status(400).json({ error: "name required" });
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 100).map((it, i) => ({
      key: typeof it.key === "string" ? it.key : `item_${i + 1}`,
      label: String(it.label ?? "").slice(0, 200),
      required: it.required !== false,
    })).filter(it => it.label);
    const [row] = await db.insert(closingChecklistTemplatesTable).values({
      restaurantId, name: b.name.slice(0, 200), items, enforceOnClose: b.enforceOnClose !== false,
    }).returning();
    await recordAuditLog({ req, module: "ops", action: "closing.template.create", entity: "closing_template", entityId: row.id, restaurantId, newValue: { name: row.name } });
    res.status(201).json(row);
  });

router.patch("/restaurants/:restaurantId/ops/closing-templates/:id",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_closing_checklist"),
  async (req, res) => {
    const restaurantId = rid(req);
    const id = Number(req.params.id);
    const b = req.body as Partial<{ name: string; items: ClosingChecklistItem[]; enforceOnClose: boolean; isActive: boolean }>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof b.name === "string") patch.name = b.name.slice(0, 200);
    if (Array.isArray(b.items)) patch.items = b.items;
    if (typeof b.enforceOnClose === "boolean") patch.enforceOnClose = b.enforceOnClose;
    if (typeof b.isActive === "boolean") patch.isActive = b.isActive;
    const [row] = await db.update(closingChecklistTemplatesTable).set(patch)
      .where(and(eq(closingChecklistTemplatesTable.id, id), eq(closingChecklistTemplatesTable.restaurantId, restaurantId)))
      .returning();
    if (!row) return void res.status(404).json({ error: "not found" });
    await recordAuditLog({ req, module: "ops", action: "closing.template.update", entity: "closing_template", entityId: id, restaurantId, newValue: patch });
    res.json(row);
  });

router.get("/restaurants/:restaurantId/ops/closing-runs",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_closing_checklist"),
  async (req, res) => {
    const restaurantId = rid(req);
    const rows = await db.select().from(closingChecklistRunsTable)
      .where(eq(closingChecklistRunsTable.restaurantId, restaurantId))
      .orderBy(desc(closingChecklistRunsTable.submittedAt)).limit(100);
    res.json(rows);
  });

router.post("/restaurants/:restaurantId/ops/closing-runs",
  requireRole("owner", "manager", "cashier", "super_admin"),
  requirePlanFeature("ops_closing_checklist"),
  async (req, res) => {
    const restaurantId = rid(req);
    const b = req.body as { templateId?: number; completedItems?: string[]; blockers?: string[]; notes?: string; sessionId?: number };
    const [row] = await db.insert(closingChecklistRunsTable).values({
      restaurantId,
      templateId: b.templateId ?? null,
      sessionId: b.sessionId ?? null,
      completedItems: Array.isArray(b.completedItems) ? b.completedItems : [],
      blockers: Array.isArray(b.blockers) ? b.blockers : [],
      notes: b.notes ?? null,
      submittedByUserId: userId(req),
    }).returning();
    await recordAuditLog({ req, module: "ops", action: "closing.run.submit", entity: "closing_run", entityId: row.id, restaurantId, newValue: { templateId: row.templateId } });
    await logTimeline(restaurantId, "closing_submitted", "Closing checklist submitted", { entity: "closing_run", entityId: row.id, actorUserId: userId(req) });
    res.status(201).json(row);
  });

// ─────────────────────────────────────────────────────────────────────────
// 8. Restaurant Timeline (read events)
// ─────────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/ops/timeline",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_event_timeline"),
  async (req, res) => {
    const restaurantId = rid(req);
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    // Filtering contract: callers can narrow the timeline by entity type,
    // entity id, actor (staff) user id, and a from/to time range. `since`
    // is kept as a backwards-compatible alias for `from`.
    const from = req.query.from ? new Date(String(req.query.from)) : (req.query.since ? new Date(String(req.query.since)) : null);
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const entity = req.query.entity ? String(req.query.entity) : null;
    const entityId = req.query.entityId ? Number(req.query.entityId) : null;
    const actorUserId = req.query.actorUserId ? Number(req.query.actorUserId) : null;
    const conds: SQL[] = [eq(timelineEventsTable.restaurantId, restaurantId)];
    if (from) conds.push(gte(timelineEventsTable.occurredAt, from));
    if (to) conds.push(lte(timelineEventsTable.occurredAt, to));
    if (entity) conds.push(eq(timelineEventsTable.entity, entity));
    if (entityId != null && !Number.isNaN(entityId)) conds.push(eq(timelineEventsTable.entityId, entityId));
    if (actorUserId != null && !Number.isNaN(actorUserId)) conds.push(eq(timelineEventsTable.actorUserId, actorUserId));
    const rows = await db.select().from(timelineEventsTable)
      .where(and(...conds))
      .orderBy(desc(timelineEventsTable.occurredAt))
      .limit(limit);
    return void res.json(rows);
  });

// Legacy fallthrough kept for reference — never reached because the handler above returns first.
router.get("/restaurants/:restaurantId/ops/timeline/__legacy",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_event_timeline"),
  async (req, res) => {
    const restaurantId = rid(req);
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    const since = req.query.since ? new Date(String(req.query.since)) : null;
    const rows = await db.select().from(timelineEventsTable)
      .where(since
        ? and(eq(timelineEventsTable.restaurantId, restaurantId), gte(timelineEventsTable.occurredAt, since))
        : eq(timelineEventsTable.restaurantId, restaurantId))
      .orderBy(desc(timelineEventsTable.occurredAt)).limit(limit);
    res.json(rows);
  });

router.post("/restaurants/:restaurantId/ops/timeline",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "super_admin"),
  requirePlanFeature("ops_event_timeline"),
  async (req, res) => {
    const restaurantId = rid(req);
    const b = req.body as { eventType?: string; summary?: string; entity?: string; entityId?: number; metadata?: Record<string, unknown> };
    if (!b.eventType || !b.summary) return void res.status(400).json({ error: "eventType and summary required" });
    await logTimeline(restaurantId, b.eventType, b.summary, {
      entity: b.entity, entityId: b.entityId ?? null, actorUserId: userId(req), metadata: b.metadata ?? {},
    });
    await recordAuditLog({ req, module: "ops", action: "timeline.event.create", entity: b.entity ?? "timeline_event", entityId: b.entityId ?? null, restaurantId, newValue: { eventType: b.eventType, summary: b.summary } });
    res.status(201).json({ ok: true });
  });

// ─────────────────────────────────────────────────────────────────────────
// 9. Owner Approval Inbox (generic ops_approvals)
// ─────────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/ops/approvals",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_manager_approvals"),
  async (req, res) => {
    const restaurantId = rid(req);
    const status = (req.query.status as string) ?? "pending";
    // Unified inbox: merge native ops_approvals with the pre-existing
    // discount_approvals stream so a single screen reflects every pending
    // sign-off request in the restaurant. Both sources are normalised into
    // the same shape and sorted together by request time, newest first.
    // `status=all` returns every ops_approvals row regardless of state.
    const opsConds: SQL[] = [eq(opsApprovalsTable.restaurantId, restaurantId)];
    if (status !== "all") opsConds.push(eq(opsApprovalsTable.status, status));
    const ops = await db.select().from(opsApprovalsTable)
      .where(and(...opsConds))
      .orderBy(desc(opsApprovalsTable.requestedAt)).limit(200);
    interface NormalisedApproval {
      source: "ops_approval" | "discount_approval";
      id: number;
      type: string;
      title: string;
      description: string | null;
      amount: string | null;
      status: string;
      requestedByUserId: number | null;
      requestedAt: Date;
      decidedByUserId: number | null;
      decidedAt: Date | null;
      decisionComment: string | null;
      payload: Record<string, unknown> | null;
    }
    const normalisedOps: NormalisedApproval[] = ops.map(r => ({
      source: "ops_approval",
      id: r.id,
      type: r.type,
      title: r.title,
      description: r.description,
      amount: r.amount,
      status: r.status,
      requestedByUserId: r.requestedByUserId,
      requestedAt: r.requestedAt,
      decidedByUserId: r.decidedByUserId,
      decidedAt: r.decidedAt,
      decisionComment: r.decisionComment,
      payload: r.payload,
    }));
    // discount_approvals does not carry a status column — every row is a
    // recorded historical approval. Surface them only when callers ask for
    // a historical view, so the default "pending" inbox is not polluted.
    let normalisedDiscount: NormalisedApproval[] = [];
    if (status === "approved" || status === "all") {
      const discounts = await db.select().from(discountApprovalsTable)
        .where(eq(discountApprovalsTable.restaurantId, restaurantId))
        .orderBy(desc(discountApprovalsTable.createdAt)).limit(200);
      normalisedDiscount = discounts.map(d => ({
        source: "discount_approval",
        id: d.id,
        type: `discount_${d.type}`,
        title: `Discount on order #${d.orderId}`,
        description: d.reason,
        amount: d.amount,
        status: "approved",
        requestedByUserId: d.requestedByUserId,
        requestedAt: d.createdAt,
        decidedByUserId: d.approvedByUserId,
        decidedAt: d.createdAt,
        decisionComment: null,
        payload: { orderId: d.orderId, discountId: d.discountId, method: d.method, subtotal: d.subtotal },
      }));
    }
    const merged = [...normalisedOps, ...normalisedDiscount]
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
      .slice(0, 200);
    res.json(merged);
  });

router.post("/restaurants/:restaurantId/ops/approvals",
  requireRole("owner", "manager", "waiter", "cashier", "super_admin"),
  requirePlanFeature("ops_manager_approvals"),
  async (req, res) => {
    const restaurantId = rid(req);
    const b = req.body as { type?: string; title?: string; description?: string; amount?: number; payload?: Record<string, unknown> };
    if (!b.type || !b.title) return void res.status(400).json({ error: "type and title required" });
    const [row] = await db.insert(opsApprovalsTable).values({
      restaurantId,
      type: b.type,
      title: b.title.slice(0, 200),
      description: b.description?.slice(0, 2000) ?? null,
      amount: b.amount != null ? String(b.amount) : null,
      payload: b.payload ?? {},
      requestedByUserId: userId(req),
    }).returning();
    await recordAuditLog({ req, module: "ops", action: "approval.request", entity: "ops_approval", entityId: row.id, restaurantId, newValue: { type: row.type, title: row.title } });
    await logTimeline(restaurantId, "approval_requested", `Approval requested: ${row.title}`, { entity: "ops_approval", entityId: row.id, actorUserId: userId(req) });
    try {
      await fanoutOpsNotification(restaurantId, ["owner", "manager"], {
        type: "approval_request", title: "New approval required", body: row.title, data: { approvalId: row.id },
      });
    } catch (err) { logger.error({ err }, "approval fanout failed"); }
    broadcastEvent(restaurantId, "ops_approval:new", row);
    res.status(201).json(row);
  });

router.patch("/restaurants/:restaurantId/ops/approvals/:id",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_manager_approvals"),
  async (req, res) => {
    const restaurantId = rid(req);
    const id = Number(req.params.id);
    const b = req.body as { status?: "approved" | "rejected"; decisionComment?: string };
    if (b.status !== "approved" && b.status !== "rejected") return void res.status(400).json({ error: "status must be approved or rejected" });
    const [row] = await db.update(opsApprovalsTable).set({
      status: b.status, decidedByUserId: userId(req), decidedAt: new Date(), decisionComment: b.decisionComment ?? null,
    }).where(and(eq(opsApprovalsTable.id, id), eq(opsApprovalsTable.restaurantId, restaurantId))).returning();
    if (!row) return void res.status(404).json({ error: "not found" });
    await recordAuditLog({ req, module: "ops", action: `approval.${b.status}`, entity: "ops_approval", entityId: id, restaurantId, newValue: { status: b.status } });
    await logTimeline(restaurantId, `approval_${b.status}`, `Approval ${b.status}: ${row.title}`, { entity: "ops_approval", entityId: id, actorUserId: userId(req) });
    broadcastEvent(restaurantId, "ops_approval:updated", row);
    res.json(row);
  });

// Bulk approve / reject — operates only on pending items within this restaurant.
router.post("/restaurants/:restaurantId/ops/approvals/bulk",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_manager_approvals"),
  async (req, res) => {
    const restaurantId = rid(req);
    const b = req.body as { ids?: number[]; status?: "approved" | "rejected"; decisionComment?: string };
    if (!Array.isArray(b.ids) || b.ids.length === 0) return void res.status(400).json({ error: "ids required" });
    if (b.status !== "approved" && b.status !== "rejected") return void res.status(400).json({ error: "status must be approved or rejected" });
    const ids = b.ids.map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 200);
    if (ids.length === 0) return void res.status(400).json({ error: "no valid ids" });
    const rows = await db.update(opsApprovalsTable).set({
      status: b.status,
      decidedByUserId: userId(req),
      decidedAt: new Date(),
      decisionComment: b.decisionComment ?? null,
    }).where(and(
      eq(opsApprovalsTable.restaurantId, restaurantId),
      eq(opsApprovalsTable.status, "pending"),
      inArray(opsApprovalsTable.id, ids),
    )).returning();
    await recordAuditLog({ req, module: "ops", action: `approval.bulk.${b.status}`, entity: "ops_approval", entityId: rows[0]?.id ?? null, restaurantId, newValue: { count: rows.length, ids: rows.map(r => r.id) } });
    for (const row of rows) {
      await logTimeline(restaurantId, `approval_${b.status}`, `Approval ${b.status}: ${row.title}`, { entity: "ops_approval", entityId: row.id, actorUserId: userId(req) });
      broadcastEvent(restaurantId, "ops_approval:updated", row);
    }
    res.json({ updated: rows.length, rows });
  });

// ─────────────────────────────────────────────────────────────────────────
// 10. Incident Reporting
// ─────────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/ops/incidents",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_incident_log"),
  async (req, res) => {
    const restaurantId = rid(req);
    const rows = await db.select().from(incidentsTable)
      .where(eq(incidentsTable.restaurantId, restaurantId))
      .orderBy(desc(incidentsTable.reportedAt)).limit(200);
    res.json(rows);
  });

router.post("/restaurants/:restaurantId/ops/incidents",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "super_admin"),
  requirePlanFeature("ops_incident_log"),
  async (req, res) => {
    const restaurantId = rid(req);
    const b = req.body as { type?: string; severity?: string; title?: string; description?: string };
    if (!b.type || !b.title) return void res.status(400).json({ error: "type and title required" });
    const [row] = await db.insert(incidentsTable).values({
      restaurantId,
      type: b.type, severity: b.severity ?? "medium",
      title: b.title.slice(0, 200),
      description: b.description?.slice(0, 4000) ?? null,
      reportedByUserId: userId(req),
    }).returning();
    await recordAuditLog({ req, module: "ops", action: "incident.create", entity: "incident", entityId: row.id, restaurantId, newValue: { type: row.type, severity: row.severity, title: row.title } });
    await logTimeline(restaurantId, "incident_reported", `Incident: ${row.title}`, { entity: "incident", entityId: row.id, actorUserId: userId(req), metadata: { severity: row.severity, type: row.type } });
    if (row.severity === "high" || row.severity === "critical") {
      try {
        await fanoutOpsNotification(restaurantId, ["owner", "manager"], {
          type: "incident_reported", title: `Incident (${row.severity}): ${row.type}`, body: row.title, data: { incidentId: row.id },
        });
      } catch (err) { logger.error({ err }, "incident fanout failed"); }
    }
    res.status(201).json(row);
  });

router.patch("/restaurants/:restaurantId/ops/incidents/:id",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_incident_log"),
  async (req, res) => {
    const restaurantId = rid(req);
    const id = Number(req.params.id);
    const b = req.body as Partial<{ status: string; severity: string; assigneeUserId: number | null; resolutionNotes: string }>;
    const patch: Record<string, unknown> = {};
    if (b.status) {
      patch.status = b.status;
      if (b.status === "resolved" || b.status === "closed") patch.resolvedAt = new Date();
    }
    if (b.severity) patch.severity = b.severity;
    if (b.assigneeUserId !== undefined) patch.assigneeUserId = b.assigneeUserId;
    if (typeof b.resolutionNotes === "string") patch.resolutionNotes = b.resolutionNotes.slice(0, 4000);
    const [row] = await db.update(incidentsTable).set(patch)
      .where(and(eq(incidentsTable.id, id), eq(incidentsTable.restaurantId, restaurantId)))
      .returning();
    if (!row) return void res.status(404).json({ error: "not found" });
    await recordAuditLog({ req, module: "ops", action: "incident.update", entity: "incident", entityId: id, restaurantId, newValue: patch });
    res.json(row);
  });

// ─────────────────────────────────────────────────────────────────────────
// 11. Cleaning Proof Gallery
// ─────────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/kitchen/cleaning-proofs",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  requirePlanFeature("kq_cleaning_schedule"),
  async (req, res) => {
    const restaurantId = rid(req);
    // Manager review screen supports filtering by submission date range
    // (inclusive). Both `from` and `to` are optional ISO timestamps.
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const conds: SQL[] = [eq(cleaningProofsTable.restaurantId, restaurantId)];
    if (from) conds.push(gte(cleaningProofsTable.submittedAt, from));
    if (to) conds.push(lte(cleaningProofsTable.submittedAt, to));
    const rows = await db.select().from(cleaningProofsTable)
      .where(and(...conds))
      .orderBy(desc(cleaningProofsTable.submittedAt)).limit(200);
    res.json(rows);
  });

router.post("/restaurants/:restaurantId/kitchen/cleaning-proofs",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  requirePlanFeature("kq_cleaning_schedule"),
  async (req, res) => {
    const restaurantId = rid(req);
    const b = req.body as { area?: string; beforeUrl?: string; afterUrl?: string; notes?: string };
    if (!b.area) return void res.status(400).json({ error: "area required" });
    const [row] = await db.insert(cleaningProofsTable).values({
      restaurantId, area: b.area, beforeUrl: b.beforeUrl ?? null, afterUrl: b.afterUrl ?? null,
      notes: b.notes?.slice(0, 1000) ?? null, submittedByUserId: userId(req),
    }).returning();
    await recordAuditLog({ req, module: "kitchen", action: "cleaning.submit", entity: "cleaning_proof", entityId: row.id, restaurantId, newValue: { area: row.area } });
    res.status(201).json(row);
  });

router.patch("/restaurants/:restaurantId/kitchen/cleaning-proofs/:id",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("kq_cleaning_schedule"),
  async (req, res) => {
    const restaurantId = rid(req);
    const id = Number(req.params.id);
    const b = req.body as { status?: "approved" | "rejected"; reviewComment?: string };
    const [row] = await db.update(cleaningProofsTable).set({
      status: b.status ?? "approved",
      reviewedByUserId: userId(req), reviewedAt: new Date(), reviewComment: b.reviewComment ?? null,
    }).where(and(eq(cleaningProofsTable.id, id), eq(cleaningProofsTable.restaurantId, restaurantId))).returning();
    if (!row) return void res.status(404).json({ error: "not found" });
    await recordAuditLog({ req, module: "kitchen", action: `cleaning.${b.status ?? "review"}`, entity: "cleaning_proof", entityId: id, restaurantId, newValue: { status: row.status } });
    res.json(row);
  });

// ─────────────────────────────────────────────────────────────────────────
// 12. Temperature Log
// ─────────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/kitchen/temperatures",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  requirePlanFeature("kq_temperature_log"),
  async (req, res) => {
    const restaurantId = rid(req);
    const rows = await db.select().from(temperatureLogsTable)
      .where(eq(temperatureLogsTable.restaurantId, restaurantId))
      .orderBy(desc(temperatureLogsTable.readingAt)).limit(300);
    res.json(rows);
  });

router.post("/restaurants/:restaurantId/kitchen/temperatures",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  requirePlanFeature("kq_temperature_log"),
  async (req, res) => {
    const restaurantId = rid(req);
    const b = req.body as { deviceLabel?: string; location?: string; tempCelsius?: number; minThreshold?: number; maxThreshold?: number; notes?: string; source?: "manual" | "iot" };
    if (!b.deviceLabel || typeof b.tempCelsius !== "number") return void res.status(400).json({ error: "deviceLabel and tempCelsius required" });
    const out = b.minThreshold != null && b.tempCelsius < b.minThreshold;
    const over = b.maxThreshold != null && b.tempCelsius > b.maxThreshold;
    const deviated = out || over;
    const [row] = await db.insert(temperatureLogsTable).values({
      restaurantId,
      deviceLabel: b.deviceLabel.slice(0, 100),
      location: b.location ?? null,
      tempCelsius: String(b.tempCelsius),
      minThreshold: b.minThreshold != null ? String(b.minThreshold) : null,
      maxThreshold: b.maxThreshold != null ? String(b.maxThreshold) : null,
      source: b.source ?? "manual",
      recordedByUserId: userId(req),
      notes: b.notes?.slice(0, 500) ?? null,
      alertSent: deviated,
    }).returning();
    await recordAuditLog({ req, module: "kitchen", action: "temperature.log", entity: "temperature_log", entityId: row.id, restaurantId, newValue: { deviceLabel: row.deviceLabel, tempCelsius: row.tempCelsius, deviated } });
    if (deviated) {
      await logTimeline(restaurantId, "temperature_deviation", `Temp deviation on ${row.deviceLabel}: ${row.tempCelsius}°C`, { entity: "temperature_log", entityId: row.id, actorUserId: userId(req) });
      try {
        await pushToStaff(
          { restaurantId, roles: ["owner", "manager", "kitchen"], type: "temperature_alert" },
          { title: "Temperature deviation", body: `${row.deviceLabel}: ${row.tempCelsius}°C`, data: { logId: row.id } },
        );
      } catch (err) { logger.error({ err }, "temp push failed"); }
    }
    res.status(201).json(row);
  });

// ─────────────────────────────────────────────────────────────────────────
// 13. Equipment Register & Maintenance
// ─────────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/kitchen/equipment",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  requirePlanFeature("kq_equipment_register"),
  async (req, res) => {
    const restaurantId = rid(req);
    const rows = await db.select().from(equipmentRegisterTable)
      .where(eq(equipmentRegisterTable.restaurantId, restaurantId))
      .orderBy(equipmentRegisterTable.name);
    res.json(rows);
  });

router.post("/restaurants/:restaurantId/kitchen/equipment",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("kq_equipment_register"),
  async (req, res) => {
    const restaurantId = rid(req);
    const b = req.body as Partial<{ name: string; type: string; location: string; serialNumber: string; vendor: string; purchaseDate: string; amcExpiresAt: string; nextServiceAt: string; status: string; notes: string }>;
    if (!b.name) return void res.status(400).json({ error: "name required" });
    const [row] = await db.insert(equipmentRegisterTable).values({
      restaurantId,
      name: b.name.slice(0, 200),
      type: b.type ?? null, location: b.location ?? null,
      serialNumber: b.serialNumber ?? null, vendor: b.vendor ?? null,
      purchaseDate: b.purchaseDate ?? null, amcExpiresAt: b.amcExpiresAt ?? null, nextServiceAt: b.nextServiceAt ?? null,
      status: b.status ?? "operational", notes: b.notes ?? null,
    }).returning();
    await recordAuditLog({ req, module: "kitchen", action: "equipment.create", entity: "equipment", entityId: row.id, restaurantId, newValue: { name: row.name } });
    res.status(201).json(row);
  });

router.patch("/restaurants/:restaurantId/kitchen/equipment/:id",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("kq_equipment_register"),
  async (req, res) => {
    const restaurantId = rid(req);
    const id = Number(req.params.id);
    const raw = req.body as Record<string, unknown>;
    // Strip protected/owned columns from caller input before applying.
    const { id: _i, restaurantId: _r, createdAt: _c, ...rest } = raw;
    void _i; void _r; void _c;
    const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    const [row] = await db.update(equipmentRegisterTable).set(patch)
      .where(and(eq(equipmentRegisterTable.id, id), eq(equipmentRegisterTable.restaurantId, restaurantId)))
      .returning();
    if (!row) return void res.status(404).json({ error: "not found" });
    await recordAuditLog({ req, module: "kitchen", action: "equipment.update", entity: "equipment", entityId: id, restaurantId, newValue: patch });
    res.json(row);
  });

router.delete("/restaurants/:restaurantId/kitchen/equipment/:id",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("kq_equipment_register"),
  async (req, res) => {
    const restaurantId = rid(req);
    const id = Number(req.params.id);
    await db.delete(equipmentRegisterTable)
      .where(and(eq(equipmentRegisterTable.id, id), eq(equipmentRegisterTable.restaurantId, restaurantId)));
    await recordAuditLog({ req, module: "kitchen", action: "equipment.delete", entity: "equipment", entityId: id, restaurantId });
    res.status(204).end();
  });

router.get("/restaurants/:restaurantId/kitchen/equipment/:id/maintenance",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  requirePlanFeature("kq_equipment_register"),
  async (req, res) => {
    const restaurantId = rid(req);
    const id = Number(req.params.id);
    // Verify the equipment row belongs to this restaurant before exposing
    // its maintenance history (prevents cross-tenant IDOR).
    const [equipment] = await db.select({ id: equipmentRegisterTable.id }).from(equipmentRegisterTable)
      .where(and(eq(equipmentRegisterTable.id, id), eq(equipmentRegisterTable.restaurantId, restaurantId)));
    if (!equipment) return void res.status(404).json({ error: "not found" });
    const rows = await db.select().from(equipmentMaintenanceRecordsTable)
      .where(and(
        eq(equipmentMaintenanceRecordsTable.equipmentId, id),
        eq(equipmentMaintenanceRecordsTable.restaurantId, restaurantId),
      ))
      .orderBy(desc(equipmentMaintenanceRecordsTable.performedAt));
    res.json(rows);
  });

router.post("/restaurants/:restaurantId/kitchen/equipment/:id/maintenance",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("kq_equipment_register"),
  async (req, res) => {
    const restaurantId = rid(req);
    const equipmentId = Number(req.params.id);
    // Verify the target equipment belongs to this restaurant.
    const [equipment] = await db.select({ id: equipmentRegisterTable.id }).from(equipmentRegisterTable)
      .where(and(eq(equipmentRegisterTable.id, equipmentId), eq(equipmentRegisterTable.restaurantId, restaurantId)));
    if (!equipment) return void res.status(404).json({ error: "equipment not found" });
    const b = req.body as { type?: string; cost?: number; vendor?: string; notes?: string; performedAt?: string };
    if (!b.type) return void res.status(400).json({ error: "type required" });
    const [row] = await db.insert(equipmentMaintenanceRecordsTable).values({
      restaurantId, equipmentId,
      type: b.type, cost: b.cost != null ? String(b.cost) : "0",
      vendor: b.vendor ?? null, notes: b.notes ?? null,
      performedAt: b.performedAt ? new Date(b.performedAt) : new Date(),
      recordedByUserId: userId(req),
    }).returning();
    await recordAuditLog({ req, module: "kitchen", action: "equipment.maintenance", entity: "equipment_maintenance", entityId: row.id, restaurantId, newValue: { equipmentId, type: row.type } });
    res.status(201).json(row);
  });

// ─────────────────────────────────────────────────────────────────────────
// 13. Ops Reports — surfaces required metrics in a single roll-up endpoint
//     consumed by the Reports page. Covers: service-timer percentiles,
//     incident summary, equipment maintenance cost, closing-checklist
//     compliance, cleaning-proof compliance, temperature-log compliance.
// ─────────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/ops/reports",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("ops_event_timeline"),
  async (req, res) => {
    const restaurantId = rid(req);
    const days = Math.max(1, Math.min(Number(req.query.days ?? 7), 90));
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const [timer, incidentSummary, maintenanceCost, checklistCompliance, cleaningCompliance, tempCompliance] = await Promise.all([
      db.execute(sql`
        SELECT stage, COUNT(*)::int AS count,
               AVG(duration_ms)::int AS "avgMs",
               percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS "medianMs",
               percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_ms)::int AS "p90Ms"
        FROM service_timer_events
        WHERE restaurant_id = ${restaurantId} AND occurred_at >= ${since} AND duration_ms IS NOT NULL
        GROUP BY stage ORDER BY stage
      `),
      db.execute(sql`
        SELECT severity, status, COUNT(*)::int AS count
        FROM incidents
        WHERE restaurant_id = ${restaurantId} AND reported_at >= ${since}
        GROUP BY severity, status ORDER BY severity, status
      `),
      db.execute(sql`
        SELECT COALESCE(SUM(cost)::float, 0) AS "totalCost",
               COUNT(*)::int AS "recordCount"
        FROM equipment_maintenance_records
        WHERE restaurant_id = ${restaurantId} AND performed_at >= ${since}
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS runs,
               SUM(CASE WHEN jsonb_typeof(blockers) <> 'array' OR jsonb_array_length(blockers) = 0 THEN 1 ELSE 0 END)::int AS "cleanRuns"
        FROM closing_checklist_runs
        WHERE restaurant_id = ${restaurantId} AND submitted_at >= ${since}
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS proofs,
               SUM(CASE WHEN reviewed_at IS NOT NULL THEN 1 ELSE 0 END)::int AS "verifiedProofs"
        FROM cleaning_proofs
        WHERE restaurant_id = ${restaurantId} AND submitted_at >= ${since}
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS readings,
               SUM(CASE WHEN alert_sent = false THEN 1 ELSE 0 END)::int AS "inRangeReadings"
        FROM temperature_logs
        WHERE restaurant_id = ${restaurantId} AND reading_at >= ${since}
      `),
    ]);
    const rowsOf = (r: unknown) => (r as { rows: Array<Record<string, unknown>> }).rows ?? [];
    res.json({
      windowDays: days,
      serviceTimerPercentiles: rowsOf(timer),
      incidentSummary: rowsOf(incidentSummary),
      equipmentMaintenanceCost: rowsOf(maintenanceCost)[0] ?? { totalCost: 0, recordCount: 0 },
      closingChecklistCompliance: rowsOf(checklistCompliance)[0] ?? { runs: 0, cleanRuns: 0 },
      cleaningProofCompliance: rowsOf(cleaningCompliance)[0] ?? { proofs: 0, verifiedProofs: 0 },
      temperatureLogCompliance: rowsOf(tempCompliance)[0] ?? { readings: 0, inRangeReadings: 0 },
    });
  });

// Helper used by other routes (e.g. cash-register close) to enforce closing
// checklist completion before destructive shift operations. Returns null if
// no enforcement is required, or an error code string if blocked.
export async function checkClosingChecklistEnforcement(
  restaurantId: number,
  sessionId: number | null,
): Promise<{ blocked: boolean; reason?: string; templateId?: number; missing?: string[] }> {
  try {
    const enforced = await db.select().from(closingChecklistTemplatesTable)
      .where(and(
        eq(closingChecklistTemplatesTable.restaurantId, restaurantId),
        eq(closingChecklistTemplatesTable.isActive, true),
        eq(closingChecklistTemplatesTable.enforceOnClose, true),
      ));
    if (enforced.length === 0) return { blocked: false };
    // Scope by session/template only — long-running cash sessions
    // would otherwise have valid runs filtered out by a time window.
    if (sessionId == null) {
      const requiredKeys = (enforced[0].items ?? []).filter(i => i.required).map(i => i.key);
      return { blocked: true, reason: "OPS_CHECKLIST_NOT_SUBMITTED", templateId: enforced[0].id, missing: requiredKeys };
    }
    const runs = await db.select().from(closingChecklistRunsTable).where(and(
      eq(closingChecklistRunsTable.restaurantId, restaurantId),
      eq(closingChecklistRunsTable.sessionId, sessionId),
    ));
    for (const tmpl of enforced) {
      const requiredKeys = (tmpl.items ?? []).filter(i => i.required).map(i => i.key);
      // Enforcement requires a checklist run bound to THIS specific cash
      // register session. Generic (session-less) runs cannot be reused
      // across multiple closes — otherwise one submission would satisfy
      // every subsequent shift close.
      const matchingRun = runs.find(r => r.templateId === tmpl.id && sessionId != null && r.sessionId === sessionId);
      if (!matchingRun) return { blocked: true, reason: "OPS_CHECKLIST_NOT_SUBMITTED", templateId: tmpl.id, missing: requiredKeys };
      const missing = requiredKeys.filter(k => !matchingRun.completedItems.includes(k));
      if (missing.length > 0) return { blocked: true, reason: "OPS_CHECKLIST_INCOMPLETE", templateId: tmpl.id, missing };
    }
    return { blocked: false };
  } catch (err) {
    logger.error({ err, restaurantId }, "checkClosingChecklistEnforcement failed");
    // Fail-closed: rethrow so the caller (cash-register close) returns 503
    // rather than silently allowing the shift to close while enforcement is
    // unavailable.
    throw err;
  }
}

export default router;
