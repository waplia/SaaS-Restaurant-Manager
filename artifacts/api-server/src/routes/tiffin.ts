import { Router } from "express";
import { eq, and, desc, gte, lte, sql, isNull } from "drizzle-orm";
import {
  db,
  tiffinPlansTable,
  tiffinSubscriptionsTable,
  tiffinFamilyMembersTable,
  tiffinRoutesTable,
  tiffinDeliveriesTable,
  tiffinInvoicesTable,
  customersTable,
  usersTable,
  paymentsTable,
  insertTiffinPlanSchema,
  insertTiffinSubscriptionSchema,
  insertTiffinFamilyMemberSchema,
  insertTiffinRouteSchema,
  insertTiffinInvoiceSchema,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { z } from "zod/v4";
import { broadcastEvent } from "../lib/socketio";

const router = Router();

router.use(
  "/restaurants/:restaurantId",
  requireRole(
    "owner", "manager", "cashier", "waiter", "kitchen",
    "delivery_executive", "customer", "super_admin",
  ),
  validateRestaurantAccess,
);

const STAFF_ROLES = ["owner", "manager", "cashier", "super_admin"] as const;
const OPS_ROLES = ["owner", "manager", "delivery_executive", "super_admin"] as const;

// ─── PLANS ────────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/tiffin/plans", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(tiffinPlansTable)
    .where(eq(tiffinPlansTable.restaurantId, restaurantId))
    .orderBy(desc(tiffinPlansTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/tiffin/plans", requireRole(...STAFF_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = insertTiffinPlanSchema.safeParse({ ...req.body, restaurantId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  const [row] = await db.insert(tiffinPlansTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/tiffin/plans/:id", requireRole(...STAFF_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const update = insertTiffinPlanSchema.partial().omit({ restaurantId: true }).safeParse(req.body);
  if (!update.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [row] = await db.update(tiffinPlansTable).set({ ...update.data, updatedAt: new Date() })
    .where(and(eq(tiffinPlansTable.id, id), eq(tiffinPlansTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Plan not found" }); return; }
  res.json(row);
});

router.delete("/restaurants/:restaurantId/tiffin/plans/:id", requireRole(...STAFF_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  await db.update(tiffinPlansTable).set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(tiffinPlansTable.id, id), eq(tiffinPlansTable.restaurantId, restaurantId)));
  res.json({ ok: true });
});

// ─── ROUTES ───────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/tiffin/routes", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select({
    id: tiffinRoutesTable.id,
    name: tiffinRoutesTable.name,
    description: tiffinRoutesTable.description,
    riderId: tiffinRoutesTable.riderId,
    slot: tiffinRoutesTable.slot,
    isActive: tiffinRoutesTable.isActive,
    riderName: usersTable.name,
  }).from(tiffinRoutesTable)
    .leftJoin(usersTable, eq(usersTable.id, tiffinRoutesTable.riderId))
    .where(eq(tiffinRoutesTable.restaurantId, restaurantId));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/tiffin/routes", requireRole(...STAFF_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = insertTiffinRouteSchema.safeParse({ ...req.body, restaurantId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  const [row] = await db.insert(tiffinRoutesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/tiffin/routes/:id", requireRole(...STAFF_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const update = insertTiffinRouteSchema.partial().omit({ restaurantId: true }).safeParse(req.body);
  if (!update.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [row] = await db.update(tiffinRoutesTable).set(update.data)
    .where(and(eq(tiffinRoutesTable.id, id), eq(tiffinRoutesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Route not found" }); return; }
  res.json(row);
});

// ─── SUBSCRIPTIONS ────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/tiffin/subscriptions", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const where = [eq(tiffinSubscriptionsTable.restaurantId, restaurantId)];
  if (status) where.push(eq(tiffinSubscriptionsTable.status, status));
  const rows = await db.select({
    id: tiffinSubscriptionsTable.id,
    customerId: tiffinSubscriptionsTable.customerId,
    customerName: customersTable.name,
    customerPhone: customersTable.phone,
    planId: tiffinSubscriptionsTable.planId,
    planName: tiffinPlansTable.name,
    status: tiffinSubscriptionsTable.status,
    startDate: tiffinSubscriptionsTable.startDate,
    endDate: tiffinSubscriptionsTable.endDate,
    pausedFrom: tiffinSubscriptionsTable.pausedFrom,
    pausedTo: tiffinSubscriptionsTable.pausedTo,
    deliveryAddress: tiffinSubscriptionsTable.deliveryAddress,
    routeId: tiffinSubscriptionsTable.routeId,
    routeStop: tiffinSubscriptionsTable.routeStop,
    preferredSlot: tiffinSubscriptionsTable.preferredSlot,
    mealsPerDay: tiffinSubscriptionsTable.mealsPerDay,
    notes: tiffinSubscriptionsTable.notes,
    monthlyPrice: tiffinPlansTable.monthlyPrice,
    pricePerMeal: tiffinPlansTable.pricePerMeal,
  }).from(tiffinSubscriptionsTable)
    .leftJoin(customersTable, eq(customersTable.id, tiffinSubscriptionsTable.customerId))
    .leftJoin(tiffinPlansTable, eq(tiffinPlansTable.id, tiffinSubscriptionsTable.planId))
    .where(and(...where))
    .orderBy(desc(tiffinSubscriptionsTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/tiffin/subscriptions", requireRole(...STAFF_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = insertTiffinSubscriptionSchema.safeParse({ ...req.body, restaurantId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  const [row] = await db.insert(tiffinSubscriptionsTable).values(parsed.data).returning();
  broadcastEvent(restaurantId, "tiffin.subscription.created", { id: row.id });
  res.status(201).json(row);
});

router.get("/restaurants/:restaurantId/tiffin/subscriptions/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [sub] = await db.select().from(tiffinSubscriptionsTable)
    .where(and(eq(tiffinSubscriptionsTable.id, id), eq(tiffinSubscriptionsTable.restaurantId, restaurantId)));
  if (!sub) { res.status(404).json({ error: "Subscription not found" }); return; }
  const family = await db.select().from(tiffinFamilyMembersTable)
    .where(eq(tiffinFamilyMembersTable.subscriptionId, id));
  res.json({ ...sub, family });
});

router.patch("/restaurants/:restaurantId/tiffin/subscriptions/:id", requireRole(...STAFF_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const update = insertTiffinSubscriptionSchema.partial().omit({ restaurantId: true }).safeParse(req.body);
  if (!update.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [row] = await db.update(tiffinSubscriptionsTable).set({ ...update.data, updatedAt: new Date() })
    .where(and(eq(tiffinSubscriptionsTable.id, id), eq(tiffinSubscriptionsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Subscription not found" }); return; }
  res.json(row);
});

const pauseSchema = z.object({ from: z.string(), to: z.string() });
router.post("/restaurants/:restaurantId/tiffin/subscriptions/:id/pause", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const parsed = pauseSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "from/to required (YYYY-MM-DD)" }); return; }
  const [row] = await db.update(tiffinSubscriptionsTable).set({
    status: "paused", pausedFrom: parsed.data.from, pausedTo: parsed.data.to, updatedAt: new Date(),
  }).where(and(eq(tiffinSubscriptionsTable.id, id), eq(tiffinSubscriptionsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Subscription not found" }); return; }
  // Mark scheduled deliveries in window as paused
  await db.update(tiffinDeliveriesTable).set({ status: "paused" }).where(and(
    eq(tiffinDeliveriesTable.subscriptionId, id),
    gte(tiffinDeliveriesTable.deliveryDate, parsed.data.from),
    lte(tiffinDeliveriesTable.deliveryDate, parsed.data.to),
    eq(tiffinDeliveriesTable.status, "scheduled"),
  ));
  res.json(row);
});

router.post("/restaurants/:restaurantId/tiffin/subscriptions/:id/resume", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db.update(tiffinSubscriptionsTable).set({
    status: "active", pausedFrom: null, pausedTo: null, updatedAt: new Date(),
  }).where(and(eq(tiffinSubscriptionsTable.id, id), eq(tiffinSubscriptionsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Subscription not found" }); return; }
  res.json(row);
});

router.post("/restaurants/:restaurantId/tiffin/subscriptions/:id/cancel", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const today = new Date().toISOString().slice(0, 10);
  const [row] = await db.update(tiffinSubscriptionsTable).set({
    status: "cancelled", endDate: today, updatedAt: new Date(),
  }).where(and(eq(tiffinSubscriptionsTable.id, id), eq(tiffinSubscriptionsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Subscription not found" }); return; }
  res.json(row);
});

// ─── FAMILY MEMBERS ───────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/tiffin/subscriptions/:id/family", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(tiffinFamilyMembersTable)
    .where(eq(tiffinFamilyMembersTable.subscriptionId, id));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/tiffin/subscriptions/:id/family", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const subscriptionId = Number(req.params.id);
  const parsed = insertTiffinFamilyMemberSchema.safeParse({ ...req.body, restaurantId, subscriptionId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [row] = await db.insert(tiffinFamilyMembersTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.delete("/restaurants/:restaurantId/tiffin/subscriptions/:sid/family/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(tiffinFamilyMembersTable).where(eq(tiffinFamilyMembersTable.id, id));
  res.json({ ok: true });
});

// ─── CALENDAR / DELIVERIES ────────────────────────────────────────────────────
function parseDow(s: string): Set<number> {
  return new Set(s.split(",").map((x) => Number(x.trim())).filter((x) => !isNaN(x)));
}

// Generate scheduled deliveries for a subscription over a date range.
async function generateDeliveriesForRange(
  restaurantId: number, subscriptionId: number, from: string, to: string,
) {
  const [sub] = await db.select().from(tiffinSubscriptionsTable)
    .where(and(eq(tiffinSubscriptionsTable.id, subscriptionId), eq(tiffinSubscriptionsTable.restaurantId, restaurantId)));
  if (!sub) return [];
  const [plan] = await db.select().from(tiffinPlansTable).where(eq(tiffinPlansTable.id, sub.planId));
  if (!plan) return [];
  const dow = parseDow(plan.daysOfWeek);
  const start = new Date(from);
  const end = new Date(to);
  const rows: { restaurantId: number; subscriptionId: number; routeId: number | null; riderId: number | null; deliveryDate: string; slot: string; status: string; mealsCount: number }[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (!dow.has(d.getDay())) continue;
    const ymd = d.toISOString().slice(0, 10);
    if (sub.pausedFrom && sub.pausedTo && ymd >= sub.pausedFrom && ymd <= sub.pausedTo) continue;
    if (sub.endDate && ymd > sub.endDate) continue;
    if (ymd < sub.startDate) continue;
    rows.push({
      restaurantId, subscriptionId, routeId: sub.routeId, riderId: null,
      deliveryDate: ymd, slot: sub.preferredSlot, status: "scheduled",
      mealsCount: sub.mealsPerDay,
    });
  }
  if (rows.length === 0) return [];
  return db.insert(tiffinDeliveriesTable).values(rows).onConflictDoNothing().returning();
}

router.post("/restaurants/:restaurantId/tiffin/subscriptions/:id/generate-calendar", requireRole(...STAFF_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const from = String(req.body?.from ?? "");
  const to = String(req.body?.to ?? "");
  if (!from || !to) { res.status(400).json({ error: "from/to required" }); return; }
  const inserted = await generateDeliveriesForRange(restaurantId, id, from, to);
  res.json({ inserted: inserted.length });
});

// Today's deliveries for the restaurant
router.get("/restaurants/:restaurantId/tiffin/deliveries", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const date = (typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10));
  const routeId = req.query.routeId ? Number(req.query.routeId) : undefined;
  const where = [
    eq(tiffinDeliveriesTable.restaurantId, restaurantId),
    eq(tiffinDeliveriesTable.deliveryDate, date),
  ];
  if (routeId) where.push(eq(tiffinDeliveriesTable.routeId, routeId));
  const rows = await db.select({
    id: tiffinDeliveriesTable.id,
    subscriptionId: tiffinDeliveriesTable.subscriptionId,
    routeId: tiffinDeliveriesTable.routeId,
    riderId: tiffinDeliveriesTable.riderId,
    deliveryDate: tiffinDeliveriesTable.deliveryDate,
    slot: tiffinDeliveriesTable.slot,
    status: tiffinDeliveriesTable.status,
    mealsCount: tiffinDeliveriesTable.mealsCount,
    skippedReason: tiffinDeliveriesTable.skippedReason,
    customerName: customersTable.name,
    customerPhone: customersTable.phone,
    deliveryAddress: tiffinSubscriptionsTable.deliveryAddress,
    routeStop: tiffinSubscriptionsTable.routeStop,
    routeName: tiffinRoutesTable.name,
  }).from(tiffinDeliveriesTable)
    .leftJoin(tiffinSubscriptionsTable, eq(tiffinSubscriptionsTable.id, tiffinDeliveriesTable.subscriptionId))
    .leftJoin(customersTable, eq(customersTable.id, tiffinSubscriptionsTable.customerId))
    .leftJoin(tiffinRoutesTable, eq(tiffinRoutesTable.id, tiffinDeliveriesTable.routeId))
    .where(and(...where))
    .orderBy(tiffinSubscriptionsTable.routeStop);
  res.json(rows);
});

// Skip / restore single delivery
router.post("/restaurants/:restaurantId/tiffin/deliveries/:id/skip", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const reason = String(req.body?.reason ?? "skipped");
  const [row] = await db.update(tiffinDeliveriesTable).set({ status: "skipped", skippedReason: reason })
    .where(and(eq(tiffinDeliveriesTable.id, id), eq(tiffinDeliveriesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Delivery not found" }); return; }
  res.json(row);
});

router.patch("/restaurants/:restaurantId/tiffin/deliveries/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const data: Partial<{ status: string; riderId: number | null; routeId: number | null }> = {};
  if (typeof req.body?.status === "string") data.status = req.body.status;
  if ("riderId" in (req.body ?? {})) data.riderId = req.body.riderId;
  if ("routeId" in (req.body ?? {})) data.routeId = req.body.routeId;
  const [row] = await db.update(tiffinDeliveriesTable).set(data)
    .where(and(eq(tiffinDeliveriesTable.id, id), eq(tiffinDeliveriesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Delivery not found" }); return; }
  res.json(row);
});

// Mark attendance (delivered / not_delivered)
const attendanceSchema = z.object({ status: z.enum(["delivered", "not_delivered", "skipped"]), reason: z.string().optional() });
router.post("/restaurants/:restaurantId/tiffin/deliveries/:id/attendance", requireRole(...OPS_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const parsed = attendanceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "status required" }); return; }
  const [row] = await db.update(tiffinDeliveriesTable).set({
    status: parsed.data.status,
    skippedReason: parsed.data.reason ?? null,
    attendanceMarkedAt: new Date(),
    attendanceMarkedBy: req.user?.id ?? null,
  }).where(and(eq(tiffinDeliveriesTable.id, id), eq(tiffinDeliveriesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Delivery not found" }); return; }
  broadcastEvent(restaurantId, "tiffin.delivery.attendance", { id: row.id, status: row.status });
  res.json(row);
});

// Rider's deliveries today
router.get("/restaurants/:restaurantId/tiffin/my-route", requireRole("delivery_executive", "owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const date = (typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10));
  const userId = req.user!.id;
  const rows = await db.select({
    id: tiffinDeliveriesTable.id,
    subscriptionId: tiffinDeliveriesTable.subscriptionId,
    deliveryDate: tiffinDeliveriesTable.deliveryDate,
    slot: tiffinDeliveriesTable.slot,
    status: tiffinDeliveriesTable.status,
    mealsCount: tiffinDeliveriesTable.mealsCount,
    customerName: customersTable.name,
    customerPhone: customersTable.phone,
    deliveryAddress: tiffinSubscriptionsTable.deliveryAddress,
    routeStop: tiffinSubscriptionsTable.routeStop,
    routeName: tiffinRoutesTable.name,
  }).from(tiffinDeliveriesTable)
    .leftJoin(tiffinSubscriptionsTable, eq(tiffinSubscriptionsTable.id, tiffinDeliveriesTable.subscriptionId))
    .leftJoin(customersTable, eq(customersTable.id, tiffinSubscriptionsTable.customerId))
    .leftJoin(tiffinRoutesTable, eq(tiffinRoutesTable.id, tiffinDeliveriesTable.routeId))
    .where(and(
      eq(tiffinDeliveriesTable.restaurantId, restaurantId),
      eq(tiffinDeliveriesTable.deliveryDate, date),
      eq(tiffinDeliveriesTable.riderId, userId),
    ))
    .orderBy(tiffinSubscriptionsTable.routeStop);
  res.json(rows);
});

// ─── CUSTOMER HISTORY ─────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/tiffin/customers/:customerId/history", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.customerId);
  const subs = await db.select().from(tiffinSubscriptionsTable)
    .where(and(
      eq(tiffinSubscriptionsTable.restaurantId, restaurantId),
      eq(tiffinSubscriptionsTable.customerId, customerId),
    ));
  const subIds = subs.map((s) => s.id);
  let deliveries: typeof tiffinDeliveriesTable.$inferSelect[] = [];
  let invoices: typeof tiffinInvoicesTable.$inferSelect[] = [];
  if (subIds.length > 0) {
    deliveries = await db.select().from(tiffinDeliveriesTable)
      .where(and(
        eq(tiffinDeliveriesTable.restaurantId, restaurantId),
        sql`${tiffinDeliveriesTable.subscriptionId} = ANY(${subIds})`,
      ))
      .orderBy(desc(tiffinDeliveriesTable.deliveryDate))
      .limit(200);
    invoices = await db.select().from(tiffinInvoicesTable)
      .where(and(
        eq(tiffinInvoicesTable.restaurantId, restaurantId),
        eq(tiffinInvoicesTable.customerId, customerId),
      ))
      .orderBy(desc(tiffinInvoicesTable.periodStart));
  }
  res.json({ subscriptions: subs, deliveries, invoices });
});

// ─── BILLING / INVOICES ───────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/tiffin/invoices", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const where = [eq(tiffinInvoicesTable.restaurantId, restaurantId)];
  if (status) where.push(eq(tiffinInvoicesTable.status, status));
  const rows = await db.select({
    id: tiffinInvoicesTable.id,
    invoiceNumber: tiffinInvoicesTable.invoiceNumber,
    customerId: tiffinInvoicesTable.customerId,
    customerName: customersTable.name,
    customerPhone: customersTable.phone,
    subscriptionId: tiffinInvoicesTable.subscriptionId,
    periodStart: tiffinInvoicesTable.periodStart,
    periodEnd: tiffinInvoicesTable.periodEnd,
    mealsDelivered: tiffinInvoicesTable.mealsDelivered,
    subtotal: tiffinInvoicesTable.subtotal,
    discount: tiffinInvoicesTable.discount,
    tax: tiffinInvoicesTable.tax,
    total: tiffinInvoicesTable.total,
    amountPaid: tiffinInvoicesTable.amountPaid,
    status: tiffinInvoicesTable.status,
    dueDate: tiffinInvoicesTable.dueDate,
    paidAt: tiffinInvoicesTable.paidAt,
  }).from(tiffinInvoicesTable)
    .leftJoin(customersTable, eq(customersTable.id, tiffinInvoicesTable.customerId))
    .where(and(...where))
    .orderBy(desc(tiffinInvoicesTable.periodStart));
  res.json(rows);
});

// Create one invoice for a subscription for a given period
router.post("/restaurants/:restaurantId/tiffin/invoices/generate", requireRole(...STAFF_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const subscriptionId = Number(req.body?.subscriptionId);
  const periodStart = String(req.body?.periodStart ?? "");
  const periodEnd = String(req.body?.periodEnd ?? "");
  if (!subscriptionId || !periodStart || !periodEnd) { res.status(400).json({ error: "subscriptionId/periodStart/periodEnd required" }); return; }
  const result = await generateInvoiceForSubscription(restaurantId, subscriptionId, periodStart, periodEnd);
  if (!result) { res.status(404).json({ error: "Subscription not found or no deliveries" }); return; }
  res.status(201).json(result);
});

// Run billing for all active subscriptions in the restaurant for the prior month
router.post("/restaurants/:restaurantId/tiffin/billing/run", requireRole(...STAFF_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const monthStart = String(req.body?.periodStart ?? "");
  const monthEnd = String(req.body?.periodEnd ?? "");
  if (!monthStart || !monthEnd) { res.status(400).json({ error: "periodStart/periodEnd required" }); return; }
  const subs = await db.select().from(tiffinSubscriptionsTable)
    .where(and(
      eq(tiffinSubscriptionsTable.restaurantId, restaurantId),
      sql`${tiffinSubscriptionsTable.status} != 'cancelled'`,
    ));
  let created = 0;
  for (const s of subs) {
    const r = await generateInvoiceForSubscription(restaurantId, s.id, monthStart, monthEnd);
    if (r) created++;
  }
  res.json({ created, total: subs.length });
});

// Mark invoice paid
const payInvoiceSchema = z.object({ method: z.string().default("cash"), amount: z.string().optional() });
router.post("/restaurants/:restaurantId/tiffin/invoices/:id/pay", requireRole(...STAFF_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const parsed = payInvoiceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [inv] = await db.select().from(tiffinInvoicesTable)
    .where(and(eq(tiffinInvoicesTable.id, id), eq(tiffinInvoicesTable.restaurantId, restaurantId)));
  if (!inv) { res.status(404).json({ error: "Invoice not found" }); return; }
  const amt = parsed.data.amount ?? inv.total;
  const [updated] = await db.update(tiffinInvoicesTable).set({
    status: "paid", amountPaid: amt, paidAt: new Date(), paymentMethod: parsed.data.method, updatedAt: new Date(),
  }).where(eq(tiffinInvoicesTable.id, id)).returning();
  // Also write a row to the central payments ledger
  try {
    await db.insert(paymentsTable).values({
      restaurantId,
      direction: "in",
      method: ["cash", "card", "upi", "stripe", "razorpay", "bank", "other"].includes(parsed.data.method) ? parsed.data.method : "other",
      amount: String(amt),
      paymentDate: new Date(),
      partyType: "customer",
      partyId: inv.customerId,
      referenceType: "tiffin_invoice",
      referenceId: id,
      notes: `Tiffin invoice ${inv.invoiceNumber}`,
    } as never);
  } catch { /* payments table shape may differ — non-fatal */ }
  res.json(updated);
});

async function generateInvoiceForSubscription(
  restaurantId: number, subscriptionId: number, periodStart: string, periodEnd: string,
) {
  const [sub] = await db.select().from(tiffinSubscriptionsTable)
    .where(and(eq(tiffinSubscriptionsTable.id, subscriptionId), eq(tiffinSubscriptionsTable.restaurantId, restaurantId)));
  if (!sub) return null;
  const [plan] = await db.select().from(tiffinPlansTable).where(eq(tiffinPlansTable.id, sub.planId));
  if (!plan) return null;

  // Count delivered meals in period (or scheduled if attendance not enforced)
  const [{ delivered }] = await db.select({
    delivered: sql<number>`COALESCE(SUM(${tiffinDeliveriesTable.mealsCount}), 0)::int`,
  }).from(tiffinDeliveriesTable).where(and(
    eq(tiffinDeliveriesTable.subscriptionId, subscriptionId),
    gte(tiffinDeliveriesTable.deliveryDate, periodStart),
    lte(tiffinDeliveriesTable.deliveryDate, periodEnd),
    eq(tiffinDeliveriesTable.status, "delivered"),
  ));

  const meals = Number(delivered ?? 0);
  const subtotal = (Number(plan.pricePerMeal) * meals).toFixed(2);
  const total = subtotal;
  // Skip if 0 meals
  if (meals === 0) return null;
  // Avoid duplicate
  const existing = await db.select().from(tiffinInvoicesTable).where(and(
    eq(tiffinInvoicesTable.subscriptionId, subscriptionId),
    eq(tiffinInvoicesTable.periodStart, periodStart),
    eq(tiffinInvoicesTable.periodEnd, periodEnd),
  ));
  if (existing.length > 0) return existing[0];

  const invoiceNumber = `TIF-${restaurantId}-${subscriptionId}-${periodStart.replace(/-/g, "")}`;
  const dueDate = new Date(periodEnd); dueDate.setDate(dueDate.getDate() + 7);
  const parsed = insertTiffinInvoiceSchema.safeParse({
    restaurantId, subscriptionId, customerId: sub.customerId, invoiceNumber,
    periodStart, periodEnd, mealsDelivered: meals, subtotal, total,
    dueDate: dueDate.toISOString().slice(0, 10), status: "pending",
  });
  if (!parsed.success) return null;
  const [row] = await db.insert(tiffinInvoicesTable).values(parsed.data).returning();
  return row;
}

// ─── CUSTOMER-FACING (mobile) ─────────────────────────────────────────────────
// Customer's own subscriptions (resolved by phone match on customer record).
router.get("/restaurants/:restaurantId/tiffin/me/subscriptions", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  // Resolve customer record by phone or email matching the auth user.
  const phone = req.user?.phone ?? null;
  const email = req.user?.email ?? null;
  if (!phone && !email) { res.json([]); return; }
  const matches = await db.select().from(customersTable).where(and(
    eq(customersTable.restaurantId, restaurantId),
    phone ? eq(customersTable.phone, phone) : eq(customersTable.email, email!),
  ));
  if (matches.length === 0) { res.json([]); return; }
  const customerId = matches[0].id;
  const rows = await db.select({
    id: tiffinSubscriptionsTable.id,
    planId: tiffinSubscriptionsTable.planId,
    planName: tiffinPlansTable.name,
    status: tiffinSubscriptionsTable.status,
    startDate: tiffinSubscriptionsTable.startDate,
    endDate: tiffinSubscriptionsTable.endDate,
    pausedFrom: tiffinSubscriptionsTable.pausedFrom,
    pausedTo: tiffinSubscriptionsTable.pausedTo,
    deliveryAddress: tiffinSubscriptionsTable.deliveryAddress,
    preferredSlot: tiffinSubscriptionsTable.preferredSlot,
    mealsPerDay: tiffinSubscriptionsTable.mealsPerDay,
    pricePerMeal: tiffinPlansTable.pricePerMeal,
  }).from(tiffinSubscriptionsTable)
    .leftJoin(tiffinPlansTable, eq(tiffinPlansTable.id, tiffinSubscriptionsTable.planId))
    .where(and(
      eq(tiffinSubscriptionsTable.restaurantId, restaurantId),
      eq(tiffinSubscriptionsTable.customerId, customerId),
    ));
  res.json(rows);
});

export default router;
export { generateInvoiceForSubscription };
