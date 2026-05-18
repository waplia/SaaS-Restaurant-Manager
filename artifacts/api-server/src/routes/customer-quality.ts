import { Router } from "express";
import { eq, and, desc, sql, gte, lte, isNull, inArray } from "drizzle-orm";
import {
  db,
  vipAlertsTable,
  customerRiskFlagsTable,
  moodResponsesTable,
  complaintEscalationRulesTable,
  complaintEscalationEventsTable,
  repeatComplaintClustersTable,
  orderAccuracyEventsTable,
  lostSalesEventsTable,
  cartSessionsTable,
  cartAbandonmentEventsTable,
  customersTable,
  customerComplaintsTable,
  ordersTable,
  orderItemsTable,
  usersTable,
  reservationsTable,
  notificationsTable,
  restaurantsTable,
  tenantsTable,
  subscriptionPlansTable,
  isFeatureEnabled,
  supportTicketsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { recordAuditLog } from "../lib/audit";

const router = Router();

// ─── Feature gate helper ───────────────────────────────────────────────────
async function requireFeature(restaurantId: number, key: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [row] = await db
    .select({ planId: tenantsTable.planId })
    .from(restaurantsTable)
    .innerJoin(tenantsTable, eq(restaurantsTable.tenantId, tenantsTable.id))
    .where(eq(restaurantsTable.id, restaurantId));
  if (!row) return { ok: false, status: 404, error: "Restaurant not found" };
  if (!row.planId) return { ok: true };
  const [plan] = await db.select({ flags: subscriptionPlansTable.featureFlags }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, row.planId));
  if (plan && !isFeatureEnabled(plan.flags, key)) {
    return { ok: false, status: 403, error: `Feature ${key} not enabled on your plan.` };
  }
  return { ok: true };
}

function gated(key: string) {
  return async (req: any, res: any, next: any) => {
    const rid = Number(req.params.restaurantId);
    const r = await requireFeature(rid, key);
    if (!r.ok) { res.status(r.status).json({ error: r.error }); return; }
    next();
  };
}

router.use(
  "/restaurants/:restaurantId/customer-quality",
  requireRole("owner", "manager", "waiter", "kitchen", "super_admin"),
  validateRestaurantAccess,
);

const BASE = "/restaurants/:restaurantId/customer-quality";

// ─── 1. VIP ALERTS ─────────────────────────────────────────────────────────
router.get(`${BASE}/vip-alerts`, gated("cust_vip_alerts"), requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select({
      id: vipAlertsTable.id,
      customerId: vipAlertsTable.customerId,
      customerName: customersTable.name,
      customerPhone: customersTable.phone,
      trigger: vipAlertsTable.trigger,
      reason: vipAlertsTable.reason,
      channelsNotified: vipAlertsTable.channelsNotified,
      acknowledged: vipAlertsTable.acknowledged,
      acknowledgedAt: vipAlertsTable.acknowledgedAt,
      createdAt: vipAlertsTable.createdAt,
    })
    .from(vipAlertsTable)
    .leftJoin(customersTable, eq(vipAlertsTable.customerId, customersTable.id))
    .where(eq(vipAlertsTable.restaurantId, restaurantId))
    .orderBy(desc(vipAlertsTable.createdAt))
    .limit(200);
  res.json({ alerts: rows });
});

router.post(`${BASE}/vip-alerts`, gated("cust_vip_alerts"), requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { customerId, trigger = "manual", reason, branchId, orderId } = req.body ?? {};
  if (!customerId) { res.status(400).json({ error: "customerId required" }); return; }
  const [cust] = await db.select().from(customersTable).where(and(eq(customersTable.id, Number(customerId)), eq(customersTable.restaurantId, restaurantId)));
  if (!cust) { res.status(404).json({ error: "Customer not found" }); return; }

  const [inserted] = await db.insert(vipAlertsTable).values({
    restaurantId, customerId: Number(customerId), branchId: branchId ?? null, orderId: orderId ?? null,
    trigger: String(trigger), reason: reason ?? null, channelsNotified: ["notification"],
  }).returning();

  // Notify managers via in-app — restaurant-scoped notification visible to all owners/managers.
  await db.insert(notificationsTable).values({
    restaurantId,
    type: "vip_alert",
    title: `VIP guest: ${cust.name ?? cust.phone ?? "Customer"}`,
    message: reason ?? `Trigger: ${trigger}`,
    entityId: inserted.id,
    entityType: "vip_alert",
  });

  await recordAuditLog({ req, module: "customer_quality", action: "vip_alert.create", entity: "CUSTOMER", entityId: cust.id, restaurantId, newValue: { alertId: inserted.id, trigger, reason } });
  res.status(201).json({ alert: inserted });
});

router.post(`${BASE}/vip-alerts/:id/ack`, gated("cust_vip_alerts"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const userId = (req as any).user?.sub ?? (req as any).user?.id ?? null;
  const [updated] = await db.update(vipAlertsTable)
    .set({ acknowledged: true, acknowledgedAt: new Date(), acknowledgedBy: userId })
    .where(and(eq(vipAlertsTable.id, id), eq(vipAlertsTable.restaurantId, restaurantId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  await recordAuditLog({ req, module: "customer_quality", action: "vip_alert.ack", entityId: id, restaurantId, newValue: updated });
  res.json({ alert: updated });
});

// ─── 2. BLACKLIST / RISK FLAGS ─────────────────────────────────────────────
router.get(`${BASE}/risk-flags`, gated("cust_blacklist"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select({
      id: customerRiskFlagsTable.id,
      customerId: customerRiskFlagsTable.customerId,
      customerName: customersTable.name,
      customerPhone: customersTable.phone,
      reason: customerRiskFlagsTable.reason,
      notes: customerRiskFlagsTable.notes,
      riskScore: customerRiskFlagsTable.riskScore,
      isActive: customerRiskFlagsTable.isActive,
      createdAt: customerRiskFlagsTable.createdAt,
      resolvedAt: customerRiskFlagsTable.resolvedAt,
    })
    .from(customerRiskFlagsTable)
    .leftJoin(customersTable, eq(customerRiskFlagsTable.customerId, customersTable.id))
    .where(eq(customerRiskFlagsTable.restaurantId, restaurantId))
    .orderBy(desc(customerRiskFlagsTable.createdAt))
    .limit(500);
  res.json({ flags: rows });
});

router.post(`${BASE}/risk-flags`, gated("cust_blacklist"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = (req as any).user?.sub ?? (req as any).user?.id ?? null;
  const { customerId, reason, notes, riskScore } = req.body ?? {};
  if (!customerId || !reason) { res.status(400).json({ error: "customerId and reason required" }); return; }
  const score = Math.max(0, Math.min(100, Number(riskScore ?? 50)));
  const [cust] = await db.select().from(customersTable).where(and(eq(customersTable.id, Number(customerId)), eq(customersTable.restaurantId, restaurantId)));
  if (!cust) { res.status(404).json({ error: "Customer not found" }); return; }

  const [inserted] = await db.insert(customerRiskFlagsTable).values({
    restaurantId, customerId: Number(customerId), reason: String(reason),
    notes: notes ?? null, riskScore: score, createdBy: userId,
  }).returning();

  if (score >= 70) {
    await db.update(customersTable)
      .set({ isBlacklisted: true, blacklistReason: String(reason), blacklistedAt: new Date(), blacklistedByUserId: userId })
      .where(eq(customersTable.id, Number(customerId)));
  }

  await recordAuditLog({ req, module: "customer_quality", action: "risk_flag.create", entity: "CUSTOMER_BLACKLIST_ENTRY", entityId: inserted.id, restaurantId, newValue: inserted });
  res.status(201).json({ flag: inserted });
});

router.patch(`${BASE}/risk-flags/:id`, gated("cust_blacklist"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const userId = (req as any).user?.sub ?? (req as any).user?.id ?? null;
  const { isActive, notes, riskScore, resolve } = req.body ?? {};
  const updates: any = {};
  if (typeof isActive === "boolean") updates.isActive = isActive;
  if (typeof notes === "string") updates.notes = notes;
  if (typeof riskScore === "number") updates.riskScore = Math.max(0, Math.min(100, riskScore));
  if (resolve) { updates.isActive = false; updates.resolvedAt = new Date(); updates.resolvedBy = userId; }
  if (!Object.keys(updates).length) { res.status(400).json({ error: "no changes" }); return; }
  const [old] = await db.select().from(customerRiskFlagsTable).where(and(eq(customerRiskFlagsTable.id, id), eq(customerRiskFlagsTable.restaurantId, restaurantId)));
  if (!old) { res.status(404).json({ error: "Not found" }); return; }
  const [updated] = await db.update(customerRiskFlagsTable).set(updates).where(eq(customerRiskFlagsTable.id, id)).returning();
  await recordAuditLog({ req, module: "customer_quality", action: "risk_flag.update", entity: "CUSTOMER_BLACKLIST_ENTRY", entityId: id, restaurantId, oldValue: old, newValue: updated });
  res.json({ flag: updated });
});

// ─── 3. MOOD TRACKING ──────────────────────────────────────────────────────
router.get(`${BASE}/mood`, gated("cust_mood"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.max(1, Math.min(90, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 86400_000);
  const responses = await db
    .select()
    .from(moodResponsesTable)
    .where(and(eq(moodResponsesTable.restaurantId, restaurantId), gte(moodResponsesTable.createdAt, since)))
    .orderBy(desc(moodResponsesTable.createdAt))
    .limit(500);

  const summary = await db.execute(sql`
    SELECT mood, COUNT(*)::int AS count
    FROM mood_responses
    WHERE restaurant_id = ${restaurantId} AND created_at >= ${since.toISOString()}
    GROUP BY mood
  `);
  const counts = (summary as unknown as { rows: { mood: string; count: number }[] }).rows ?? [];
  const avg = responses.length ? responses.reduce((s, r) => s + r.moodScore, 0) / responses.length : 0;

  // Rollups by day / source / staff / branch — for trend dashboards.
  const byDay = await db.execute(sql`
    SELECT DATE(created_at) AS day, COUNT(*)::int AS count, AVG(mood_score)::float AS avg_score
    FROM mood_responses WHERE restaurant_id = ${restaurantId} AND created_at >= ${since.toISOString()}
    GROUP BY DATE(created_at) ORDER BY day ASC
  `);
  const bySource = await db.execute(sql`
    SELECT source, COUNT(*)::int AS count, AVG(mood_score)::float AS avg_score
    FROM mood_responses WHERE restaurant_id = ${restaurantId} AND created_at >= ${since.toISOString()}
    GROUP BY source
  `);
  const byStaff = await db.execute(sql`
    SELECT staff_user_id AS staff_user_id, COUNT(*)::int AS count, AVG(mood_score)::float AS avg_score
    FROM mood_responses WHERE restaurant_id = ${restaurantId} AND created_at >= ${since.toISOString()} AND staff_user_id IS NOT NULL
    GROUP BY staff_user_id
  `);
  const byBranch = await db.execute(sql`
    SELECT branch_id, COUNT(*)::int AS count, AVG(mood_score)::float AS avg_score
    FROM mood_responses WHERE restaurant_id = ${restaurantId} AND created_at >= ${since.toISOString()} AND branch_id IS NOT NULL
    GROUP BY branch_id
  `);

  res.json({
    responses,
    summary: counts,
    averageScore: avg,
    count: responses.length,
    rollups: {
      byDay: (byDay as unknown as { rows: unknown[] }).rows ?? [],
      bySource: (bySource as unknown as { rows: unknown[] }).rows ?? [],
      byStaff: (byStaff as unknown as { rows: unknown[] }).rows ?? [],
      byBranch: (byBranch as unknown as { rows: unknown[] }).rows ?? [],
    },
  });
});

router.post(`${BASE}/mood`, gated("cust_mood"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = (req as any).user?.sub ?? (req as any).user?.id ?? null;
  const { mood, source = "checkout", customerId, orderId, branchId, comment } = req.body ?? {};
  const MOOD_SCORES: Record<string, number> = { delighted: 2, happy: 1, neutral: 0, unhappy: -1, angry: -2 };
  if (!mood || !(mood in MOOD_SCORES)) { res.status(400).json({ error: "Invalid mood" }); return; }

  const [inserted] = await db.insert(moodResponsesTable).values({
    restaurantId, branchId: branchId ?? null, customerId: customerId ?? null, orderId: orderId ?? null,
    staffUserId: userId, source: String(source), mood: String(mood), moodScore: MOOD_SCORES[mood], comment: comment ?? null,
  }).returning();

  if (MOOD_SCORES[mood] <= -1) {
    await db.insert(notificationsTable).values({
      restaurantId,
      type: "mood_alert",
      title: `Unhappy guest mood: ${mood}`,
      message: comment ?? `Consider intervening${orderId ? ` on order #${orderId}` : ""}`,
      entityId: inserted.id,
      entityType: "mood_response",
    });
  }

  await recordAuditLog({ req, module: "customer_quality", action: "mood.create", entity: "CUSTOMER_MOOD", entityId: inserted.id, restaurantId, newValue: inserted });
  res.status(201).json({ response: inserted });
});

// ─── 4. COMPLAINT ESCALATION ───────────────────────────────────────────────
router.get(`${BASE}/escalation/rules`, gated("cust_complaint_escalation"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [rule] = await db.select().from(complaintEscalationRulesTable).where(eq(complaintEscalationRulesTable.restaurantId, restaurantId));
  res.json({ rule: rule ?? null });
});

router.put(`${BASE}/escalation/rules`, gated("cust_complaint_escalation"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { level1Minutes, level2Minutes, level3Minutes, notifyManagers, notifyOwners, isActive } = req.body ?? {};
  const data: any = {
    restaurantId,
    level1Minutes: Number(level1Minutes ?? 30),
    level2Minutes: Number(level2Minutes ?? 120),
    level3Minutes: Number(level3Minutes ?? 360),
    notifyManagers: notifyManagers !== false,
    notifyOwners: notifyOwners !== false,
    isActive: isActive !== false,
    updatedAt: new Date(),
  };
  const [old] = await db.select().from(complaintEscalationRulesTable).where(eq(complaintEscalationRulesTable.restaurantId, restaurantId));
  let rule;
  if (old) {
    [rule] = await db.update(complaintEscalationRulesTable).set(data).where(eq(complaintEscalationRulesTable.restaurantId, restaurantId)).returning();
  } else {
    [rule] = await db.insert(complaintEscalationRulesTable).values(data).returning();
  }
  await recordAuditLog({ req, module: "customer_quality", action: "escalation_rule.update", entity: "COMPLAINT_ESCALATION", entityId: rule.id, restaurantId, oldValue: old, newValue: rule });
  res.json({ rule });
});

router.get(`${BASE}/escalation/events`, gated("cust_complaint_escalation"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const events = await db.select()
    .from(complaintEscalationEventsTable)
    .where(eq(complaintEscalationEventsTable.restaurantId, restaurantId))
    .orderBy(desc(complaintEscalationEventsTable.createdAt))
    .limit(200);
  res.json({ events });
});

// ─── 5. REPEAT COMPLAINT CLUSTERS ──────────────────────────────────────────
router.get(`${BASE}/repeat-clusters`, gated("cust_repeat_detector"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const clusters = await db.select().from(repeatComplaintClustersTable)
    .where(and(eq(repeatComplaintClustersTable.restaurantId, restaurantId), eq(repeatComplaintClustersTable.isDismissed, false)))
    .orderBy(desc(repeatComplaintClustersTable.complaintCount), desc(repeatComplaintClustersTable.createdAt))
    .limit(200);
  res.json({ clusters });
});

router.post(`${BASE}/repeat-clusters/:id/dismiss`, gated("cust_repeat_detector"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const userId = (req as any).user?.sub ?? (req as any).user?.id ?? null;
  const { reason } = req.body ?? {};
  const [updated] = await db.update(repeatComplaintClustersTable)
    .set({ isDismissed: true, dismissedBy: userId, dismissedAt: new Date(), dismissReason: reason ?? null })
    .where(and(eq(repeatComplaintClustersTable.id, id), eq(repeatComplaintClustersTable.restaurantId, restaurantId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  await recordAuditLog({ req, module: "customer_quality", action: "repeat_cluster.dismiss", entityId: id, restaurantId, newValue: updated });
  res.json({ cluster: updated });
});

router.post(`${BASE}/repeat-clusters/rebuild`, gated("cust_repeat_detector"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const count = await rebuildClusters(restaurantId);
  res.json({ ok: true, count });
});

// ─── 6. VISIT CALENDAR ─────────────────────────────────────────────────────
router.get(`${BASE}/visit-calendar`, gated("cust_visit_calendar"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400_000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 60 * 86400_000);

  const visits = await db.select({
    date: sql<string>`DATE(${ordersTable.createdAt})`.as("date"),
    customerId: ordersTable.customerId,
    orderId: ordersTable.id,
    total: ordersTable.totalAmount,
    name: customersTable.name,
    phone: customersTable.phone,
    isVip: customersTable.isVip,
  })
    .from(ordersTable)
    .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      gte(ordersTable.createdAt, from),
      lte(ordersTable.createdAt, to),
    ))
    .orderBy(desc(ordersTable.createdAt))
    .limit(2000);

  // Upcoming reservations
  const reservations = await db.select()
    .from(reservationsTable)
    .where(and(
      eq(reservationsTable.restaurantId, restaurantId),
      gte(reservationsTable.scheduledAt, from),
      lte(reservationsTable.scheduledAt, to),
    ))
    .limit(500);

  // Birthdays & anniversaries
  const customers = await db.select({
    id: customersTable.id, name: customersTable.name, phone: customersTable.phone,
    dateOfBirth: customersTable.dateOfBirth, anniversaryDate: customersTable.anniversary,
  })
    .from(customersTable)
    .where(and(
      eq(customersTable.restaurantId, restaurantId),
      eq(customersTable.isActive, true),
    ))
    .limit(2000);

  // Drop-off list: regulars (≥3 visits in last 180d) absent for ≥N days
  const absentDays = Math.max(7, Math.min(180, Number(req.query.absentDays ?? 30)));
  const dropoff = await db.execute(sql`
    WITH activity AS (
      SELECT customer_id,
             COUNT(*)::int AS visits_180d,
             MAX(created_at) AS last_visit_at
      FROM orders
      WHERE restaurant_id = ${restaurantId}
        AND customer_id IS NOT NULL
        AND created_at >= NOW() - INTERVAL '180 days'
      GROUP BY customer_id
    )
    SELECT a.customer_id, a.visits_180d, a.last_visit_at,
           c.name, c.phone, c.is_vip
    FROM activity a
    JOIN customers c ON c.id = a.customer_id
    WHERE a.visits_180d >= 3
      AND a.last_visit_at < NOW() - (${absentDays} || ' days')::interval
    ORDER BY a.visits_180d DESC, a.last_visit_at ASC
    LIMIT 100
  `);

  res.json({
    visits, reservations, customers,
    dropoff: (dropoff as unknown as { rows: any[] }).rows ?? [],
    absentDays,
  });
});

// Winback action — sends recovery message + records lost-sale tracking
router.post(`${BASE}/visit-calendar/winback`, gated("cust_visit_calendar"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { customerId, channel = "whatsapp", message } = req.body ?? {};
  if (!customerId) { res.status(400).json({ error: "customerId required" }); return; }
  const [cust] = await db.select().from(customersTable).where(and(eq(customersTable.id, Number(customerId)), eq(customersTable.restaurantId, restaurantId)));
  if (!cust) { res.status(404).json({ error: "Customer not found" }); return; }
  if (!cust.phone) { res.status(400).json({ error: "Customer has no phone" }); return; }
  // Track the winback as a lost-sale recovery attempt so it shows in reporting
  const [evt] = await db.insert(lostSalesEventsTable).values({
    restaurantId,
    customerId: Number(customerId),
    eventType: "winback_attempt",
    channel: String(channel),
    reason: message ?? `Drop-off winback to ${cust.name ?? cust.phone}`,
    estimatedValue: "0.00",
    metadata: { customerPhone: cust.phone, customerName: cust.name ?? null },
  }).returning();
  await recordAuditLog({ req, module: "customer_quality", action: "winback.send", entity: "CUSTOMER", entityId: Number(customerId), restaurantId, newValue: { channel, customerId } });
  res.json({ ok: true, event: evt });
});

// ─── 7. LIVE ORDER STATUS (Public) ─────────────────────────────────────────
// Authenticated lookup
router.get(`${BASE}/order-status/:orderId`, gated("cust_live_order_status"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.orderId);
  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ order });
});

// ─── 8. ORDER ACCURACY ─────────────────────────────────────────────────────
router.get(`${BASE}/accuracy`, gated("kq_accuracy_score"), requireRole("owner", "manager", "kitchen", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.max(1, Math.min(90, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 86400_000);

  const events = await db.select()
    .from(orderAccuracyEventsTable)
    .where(and(eq(orderAccuracyEventsTable.restaurantId, restaurantId), gte(orderAccuracyEventsTable.createdAt, since)))
    .orderBy(desc(orderAccuracyEventsTable.createdAt))
    .limit(500);

  const [totalOrdersRow] = await db.select({ c: sql<number>`COUNT(*)::int` })
    .from(ordersTable)
    .where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, since)));
  const totalOrders = Number(totalOrdersRow?.c ?? 0);
  const totalIssues = events.reduce((s, e) => s + e.weight, 0);
  const score = totalOrders === 0 ? 100 : Math.max(0, Math.min(100, 100 - (totalIssues / totalOrders) * 100));

  // Per-staff breakdown
  const byStaff = await db.execute(sql`
    SELECT staff_user_id, COUNT(*)::int AS events, COALESCE(SUM(weight),0)::int AS weight
    FROM order_accuracy_events
    WHERE restaurant_id = ${restaurantId} AND created_at >= ${since.toISOString()} AND staff_user_id IS NOT NULL
    GROUP BY staff_user_id
    ORDER BY weight DESC LIMIT 50
  `);

  res.json({
    score: Math.round(score * 10) / 10,
    totalOrders, totalIssues,
    events,
    byStaff: (byStaff as unknown as { rows: any[] }).rows ?? [],
  });
});

router.post(`${BASE}/accuracy`, gated("kq_accuracy_score"), requireRole("owner", "manager", "kitchen", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = (req as any).user?.sub ?? (req as any).user?.id ?? null;
  const { orderId, branchId, staffUserId, eventType, itemsAffected, weight, notes } = req.body ?? {};
  if (!eventType) { res.status(400).json({ error: "eventType required" }); return; }
  const [inserted] = await db.insert(orderAccuracyEventsTable).values({
    restaurantId, orderId: orderId ?? null, branchId: branchId ?? null, staffUserId: staffUserId ?? null,
    eventType: String(eventType), itemsAffected: Number(itemsAffected ?? 1),
    weight: Number(weight ?? 1), notes: notes ?? null, createdBy: userId,
  }).returning();
  await recordAuditLog({ req, module: "customer_quality", action: "accuracy.create", entityId: inserted.id, restaurantId, newValue: inserted });
  res.status(201).json({ event: inserted });
});

// ─── 9. LOST SALES ─────────────────────────────────────────────────────────
router.get(`${BASE}/lost-sales`, gated("cust_lost_sales"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.max(1, Math.min(180, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 86400_000);
  const events = await db.select()
    .from(lostSalesEventsTable)
    .where(and(eq(lostSalesEventsTable.restaurantId, restaurantId), gte(lostSalesEventsTable.createdAt, since)))
    .orderBy(desc(lostSalesEventsTable.createdAt))
    .limit(500);

  const byType = await db.execute(sql`
    SELECT event_type, COUNT(*)::int AS count, COALESCE(SUM(estimated_value),0)::numeric AS revenue
    FROM lost_sales_events
    WHERE restaurant_id = ${restaurantId} AND created_at >= ${since.toISOString()}
    GROUP BY event_type
    ORDER BY revenue DESC
  `);

  const totalLost = events.reduce((s, e) => s + Number(e.estimatedValue ?? 0), 0);
  res.json({
    events,
    summary: (byType as unknown as { rows: any[] }).rows ?? [],
    totalLost,
    count: events.length,
  });
});

router.post(`${BASE}/lost-sales`, gated("cust_lost_sales"), requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { eventType, channel, reason, estimatedValue, branchId, customerId, orderId, itemSnapshot, metadata } = req.body ?? {};
  if (!eventType) { res.status(400).json({ error: "eventType required" }); return; }
  const [inserted] = await db.insert(lostSalesEventsTable).values({
    restaurantId, branchId: branchId ?? null, customerId: customerId ?? null, orderId: orderId ?? null,
    eventType: String(eventType), channel: channel ?? null, reason: reason ?? null,
    estimatedValue: String(estimatedValue ?? "0.00"),
    itemSnapshot: itemSnapshot ?? null, metadata: metadata ?? null,
  }).returning();
  await recordAuditLog({ req, module: "customer_quality", action: "lost_sale.create", entity: "LOST_SALE", entityId: inserted.id, restaurantId, newValue: inserted });
  res.status(201).json({ event: inserted });
});

// ─── 10. ABANDONED CART ────────────────────────────────────────────────────
router.get(`${BASE}/carts`, gated("cust_abandoned_cart"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = String(req.query.status ?? "");
  const where = [eq(cartSessionsTable.restaurantId, restaurantId)];
  if (status) where.push(eq(cartSessionsTable.status, status));
  const carts = await db.select().from(cartSessionsTable)
    .where(and(...where))
    .orderBy(desc(cartSessionsTable.lastActivityAt))
    .limit(200);
  const events = await db.select().from(cartAbandonmentEventsTable)
    .where(eq(cartAbandonmentEventsTable.restaurantId, restaurantId))
    .orderBy(desc(cartAbandonmentEventsTable.createdAt))
    .limit(200);
  res.json({ carts, events });
});

router.post(`${BASE}/carts/:id/recover`, gated("cust_abandoned_cart"), requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { channel = "whatsapp", message } = req.body ?? {};
  const [cart] = await db.select().from(cartSessionsTable).where(and(eq(cartSessionsTable.id, id), eq(cartSessionsTable.restaurantId, restaurantId)));
  if (!cart) { res.status(404).json({ error: "Not found" }); return; }
  if (!cart.customerPhone && !cart.customerId) { res.status(400).json({ error: "Cart has no customer contact" }); return; }
  const recipient = cart.customerPhone ?? "";
  const [evt] = await db.insert(cartAbandonmentEventsTable).values({
    restaurantId, cartSessionId: id, channel: String(channel), recipient,
    status: "queued", message: message ?? `Hi ${cart.customerName ?? ""}, you left items in your cart. Complete your order!`,
  }).returning();
  await recordAuditLog({ req, module: "customer_quality", action: "cart.recover", entity: "ABANDONED_CART", entityId: id, restaurantId, newValue: evt });
  res.status(201).json({ event: evt });
});

// ─── Background helpers ────────────────────────────────────────────────────
export async function runComplaintEscalationSweep(): Promise<number> {
  const rules = await db.select().from(complaintEscalationRulesTable).where(eq(complaintEscalationRulesTable.isActive, true));
  let firedTotal = 0;
  for (const rule of rules) {
    const now = Date.now();
    const open = await db.select().from(customerComplaintsTable)
      .where(and(eq(customerComplaintsTable.restaurantId, rule.restaurantId), inArray(customerComplaintsTable.status, ["open", "in_progress"])));
    for (const c of open) {
      const ageMin = Math.floor((now - new Date(c.createdAt).getTime()) / 60000);
      const levels = [
        { level: 1, threshold: rule.level1Minutes },
        { level: 2, threshold: rule.level2Minutes },
        { level: 3, threshold: rule.level3Minutes },
      ];
      for (const l of levels) {
        if (ageMin < l.threshold) continue;
        const [existing] = await db.select().from(complaintEscalationEventsTable)
          .where(and(eq(complaintEscalationEventsTable.complaintId, c.id), eq(complaintEscalationEventsTable.level, l.level)));
        if (existing) continue;
        const targetRoles = l.level === 1
          ? (rule.notifyManagers ? ["manager"] : [])
          : (rule.notifyOwners ? ["owner"] : []);
        if (!targetRoles.length) continue;
        const targets = await db.select({ id: usersTable.id }).from(usersTable)
          .where(and(eq(usersTable.restaurantId, rule.restaurantId), inArray(usersTable.role, targetRoles)));
        const ids = targets.map((t) => t.id);
        await db.insert(complaintEscalationEventsTable).values({
          restaurantId: rule.restaurantId, complaintId: c.id, level: l.level,
          notifiedUserIds: ids, channel: "notification",
          message: `Complaint #${c.id} unresolved for ${ageMin}m (level ${l.level})`,
        });
        if (ids.length) {
          await db.insert(notificationsTable).values({
            restaurantId: rule.restaurantId,
            type: "complaint_escalation",
            title: `Complaint escalation L${l.level}`,
            message: `Complaint #${c.id} pending ${ageMin}m`,
            entityId: c.id,
            entityType: "customer_complaint",
          });
        }
        firedTotal++;
      }
    }

    // Also escalate open support tickets whose resolutionDueAt has been
    // breached. Each (ticket, level) escalates at most once because we
    // dedupe via (supportTicketId, level) in complaint_escalation_events.
    const restaurant = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable)
      .where(eq(restaurantsTable.id, rule.restaurantId));
    if (!restaurant.length) continue;
    const openTicketStatuses = ["open", "in_progress", "waiting_internal"] as const;
    const openTickets = await db.select().from(supportTicketsTable)
      .where(and(eq(supportTicketsTable.tenantId, restaurant[0].tenantId),
        inArray(supportTicketsTable.status, openTicketStatuses as unknown as readonly string[] as never)));
    for (const t of openTickets) {
      const breachAt = t.resolutionDueAt ?? t.firstResponseDueAt;
      if (!breachAt) continue;
      const overdueMin = Math.floor((now - new Date(breachAt).getTime()) / 60000);
      if (overdueMin <= 0) continue;
      const levels = [
        { level: 1, threshold: 0 },
        { level: 2, threshold: rule.level2Minutes - rule.level1Minutes },
        { level: 3, threshold: rule.level3Minutes - rule.level1Minutes },
      ];
      for (const l of levels) {
        if (overdueMin < l.threshold) continue;
        const [existing] = await db.select().from(complaintEscalationEventsTable)
          .where(and(eq(complaintEscalationEventsTable.supportTicketId, t.id), eq(complaintEscalationEventsTable.level, l.level)));
        if (existing) continue;
        const targetRoles = l.level === 1
          ? (rule.notifyManagers ? ["manager"] : [])
          : (rule.notifyOwners ? ["owner"] : []);
        if (!targetRoles.length) continue;
        const targets = await db.select({ id: usersTable.id }).from(usersTable)
          .where(and(eq(usersTable.restaurantId, rule.restaurantId), inArray(usersTable.role, targetRoles)));
        const ids = targets.map((u) => u.id);
        await db.insert(complaintEscalationEventsTable).values({
          restaurantId: rule.restaurantId, supportTicketId: t.id, level: l.level,
          notifiedUserIds: ids, channel: "notification",
          message: `Support ticket ${t.ticketNumber} SLA breached by ${overdueMin}m (level ${l.level})`,
        });
        if (ids.length) {
          await db.insert(notificationsTable).values({
            restaurantId: rule.restaurantId,
            type: "complaint_escalation",
            title: `Ticket escalation L${l.level}`,
            message: `Ticket ${t.ticketNumber} overdue ${overdueMin}m`,
            entityId: t.id,
            entityType: "support_ticket",
          });
        }
        firedTotal++;
      }
    }
  }
  return firedTotal;
}

export async function rebuildClusters(restaurantId?: number): Promise<number> {
  const winStart = new Date(Date.now() - 30 * 86400_000);
  const winEnd = new Date();
  const where = restaurantId
    ? and(eq(customerComplaintsTable.restaurantId, restaurantId), gte(customerComplaintsTable.createdAt, winStart))
    : gte(customerComplaintsTable.createdAt, winStart);
  const complaints = await db.select().from(customerComplaintsTable).where(where);
  const buckets = new Map<string, { restaurantId: number; type: string; key: string; label: string; ids: number[] }>();
  const addBucket = (rid: number, type: string, keyVal: string | null | undefined, label: string, complaintId: number) => {
    if (!keyVal) return;
    const fullKey = `${rid}|${type}|${keyVal}`;
    if (!buckets.has(fullKey)) buckets.set(fullKey, { restaurantId: rid, type, key: String(keyVal), label, ids: [] });
    buckets.get(fullKey)!.ids.push(complaintId);
  };
  for (const c of complaints) {
    // Multi-dimensional clustering using fields actually on customer_complaints:
    // channel, staff (handledByUserId), and time-of-day shift.
    addBucket(c.restaurantId, "channel", c.channel, `Channel: ${c.channel}`, c.id);
    if (c.handledByUserId) addBucket(c.restaurantId, "staff", String(c.handledByUserId), `Staff #${c.handledByUserId}`, c.id);
    const hour = new Date(c.createdAt).getHours();
    const shift = hour < 11 ? "morning" : hour < 16 ? "lunch" : hour < 21 ? "dinner" : "late_night";
    addBucket(c.restaurantId, "shift", shift, `Shift: ${shift}`, c.id);
  }
  let inserted = 0;
  for (const b of buckets.values()) {
    if (b.ids.length < 3) continue;
    try {
      await db.insert(repeatComplaintClustersTable).values({
        restaurantId: b.restaurantId, clusterType: b.type, clusterKey: b.key, clusterLabel: b.label,
        complaintCount: b.ids.length, windowStart: winStart, windowEnd: winEnd,
        sampleComplaintIds: b.ids.slice(0, 10),
      }).onConflictDoUpdate({
        target: [repeatComplaintClustersTable.restaurantId, repeatComplaintClustersTable.clusterType, repeatComplaintClustersTable.clusterKey, repeatComplaintClustersTable.windowStart],
        set: { complaintCount: b.ids.length, sampleComplaintIds: b.ids.slice(0, 10), windowEnd: winEnd },
      });
      inserted++;
    } catch (err) {
      console.error(`[CQ clusters] insert failed for restaurant ${b.restaurantId} ${b.type}:${b.key}:`, err);
    }
  }
  return inserted;
}

export async function detectAbandonedCarts(): Promise<number> {
  const threshold = new Date(Date.now() - 30 * 60 * 1000); // 30 min idle
  const carts = await db.select().from(cartSessionsTable)
    .where(and(eq(cartSessionsTable.status, "active"), lte(cartSessionsTable.lastActivityAt, threshold)));
  if (!carts.length) return 0;
  await db.update(cartSessionsTable)
    .set({ status: "abandoned", abandonedAt: new Date() })
    .where(inArray(cartSessionsTable.id, carts.map((c) => c.id)));
  // Auto-queue recovery for opted-in carts. Failures are logged so missed
  // recovery/lost-sale rows are visible to ops rather than silently dropped.
  for (const c of carts) {
    if (!c.recoveryOptIn || !c.customerPhone) continue;
    try {
      await db.insert(cartAbandonmentEventsTable).values({
        restaurantId: c.restaurantId, cartSessionId: c.id, channel: "whatsapp",
        recipient: c.customerPhone, status: "queued",
        message: `Hi ${c.customerName ?? ""}, complete your order — items are still available!`,
      });
    } catch (err) {
      console.error(`[Abandoned cart] recovery insert failed for cart ${c.id} restaurant ${c.restaurantId}:`, err);
    }
    try {
      await db.insert(lostSalesEventsTable).values({
        restaurantId: c.restaurantId, branchId: c.branchId, customerId: c.customerId,
        eventType: "abandoned_cart", channel: c.channel, reason: "Cart idle > 30m",
        estimatedValue: c.subtotal, itemSnapshot: c.items,
        metadata: { customerPhone: c.customerPhone ?? null, customerName: c.customerName ?? null, cartSessionId: c.id },
      });
    } catch (err) {
      console.error(`[Abandoned cart] lost-sale insert failed for cart ${c.id} restaurant ${c.restaurantId}:`, err);
    }
  }
  return carts.length;
}

export default router;
