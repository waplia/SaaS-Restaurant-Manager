import { Router } from "express";
import { eq, and, desc, sql, lte, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  mealPlanTemplatesTable,
  customerSubscriptionsTable,
  subscriptionCyclesTable,
  subscriptionUsageTable,
  subscriptionInvoicesTable,
  subscriptionPaymentsCustomerTable,
  subscriptionFamilyMembersTable,
  subscriptionEventsTable,
  customersTable,
  restaurantsTable,
  notificationsTable,
} from "../lib/db";
import type { MealPlanTemplate, CustomerSubscription } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { logger } from "../lib/logger";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────

function addCycle(start: Date, billingCycle: string, cycleDays?: number | null): Date {
  const end = new Date(start);
  switch (billingCycle) {
    case "daily": end.setDate(end.getDate() + 1); break;
    case "weekly": end.setDate(end.getDate() + 7); break;
    case "monthly": end.setMonth(end.getMonth() + 1); break;
    case "quarterly": end.setMonth(end.getMonth() + 3); break;
    case "custom": end.setDate(end.getDate() + Math.max(1, cycleDays ?? 30)); break;
    default: end.setMonth(end.getMonth() + 1);
  }
  return end;
}

async function nextInvoiceNumber(restaurantId: number): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `MP-${year}-`;
  const [last] = await db.select({ n: subscriptionInvoicesTable.invoiceNumber })
    .from(subscriptionInvoicesTable)
    .where(and(
      eq(subscriptionInvoicesTable.restaurantId, restaurantId),
      sql`${subscriptionInvoicesTable.invoiceNumber} LIKE ${prefix + "%"}`,
    ))
    .orderBy(desc(subscriptionInvoicesTable.id))
    .limit(1);
  const lastSeq = last?.n ? Number(last.n.slice(prefix.length)) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(5, "0")}`;
}

async function logEvent(
  subscriptionId: number,
  type: string,
  message?: string,
  metadata: Record<string, unknown> = {},
  actorUserId?: number | null,
): Promise<void> {
  await db.insert(subscriptionEventsTable).values({
    subscriptionId, type, message: message ?? null, metadata, actorUserId: actorUserId ?? null,
  });
}

async function notifyRestaurant(restaurantId: number, type: string, title: string, message: string, entityId?: number) {
  await db.insert(notificationsTable).values({
    restaurantId, type, title, message,
    entityId: entityId ?? null, entityType: "customer_subscription",
  }).catch(err => logger.warn({ err }, "notifyRestaurant failed"));
}

function snapshotTemplate(t: MealPlanTemplate): Record<string, unknown> {
  return {
    id: t.id, name: t.name, type: t.type, price: t.price, currency: t.currency,
    billingCycle: t.billingCycle, cycleDays: t.cycleDays, durationCycles: t.durationCycles,
    autoRenew: t.autoRenew, mealsPerCycle: t.mealsPerCycle, creditsPerCycle: t.creditsPerCycle,
    bonusCredits: t.bonusCredits, perItemCreditCost: t.perItemCreditCost,
    allowedItemIds: t.allowedItemIds, allowedCategoryIds: t.allowedCategoryIds,
    maxMealsPerDay: t.maxMealsPerDay, validDaysOfWeek: t.validDaysOfWeek,
    validTimeStart: t.validTimeStart, validTimeEnd: t.validTimeEnd,
    eligibleOrderTypes: t.eligibleOrderTypes, maxFamilyMembers: t.maxFamilyMembers,
    refundPolicy: t.refundPolicy, refundWithinDays: t.refundWithinDays,
    maxPauseDays: t.maxPauseDays, renewalReminderDays: t.renewalReminderDays,
    lowBalanceThreshold: t.lowBalanceThreshold,
  };
}

// ─── Templates: CRUD ──────────────────────────────────────────────

router.use("/restaurants/:restaurantId/meal-plan-templates",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess);

router.get("/restaurants/:restaurantId/meal-plan-templates", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const includeArchived = req.query.includeArchived === "true";
  const conds = [eq(mealPlanTemplatesTable.restaurantId, restaurantId)];
  if (!includeArchived) conds.push(sql`${mealPlanTemplatesTable.archivedAt} IS NULL`);
  const rows = await db.select().from(mealPlanTemplatesTable)
    .where(and(...conds))
    .orderBy(desc(mealPlanTemplatesTable.id));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/meal-plan-templates", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const b = req.body as Partial<MealPlanTemplate>;
  if (!b.name || !b.price) return void res.status(400).json({ error: "name and price are required" });
  if (b.type === "credits" && !b.creditsPerCycle) {
    return void res.status(400).json({ error: "creditsPerCycle is required for credit plans" });
  }
  const [row] = await db.insert(mealPlanTemplatesTable).values({
    restaurantId,
    name: b.name,
    description: b.description ?? null,
    type: b.type ?? "custom",
    price: String(b.price),
    currency: b.currency ?? "INR",
    billingCycle: b.billingCycle ?? "monthly",
    cycleDays: b.cycleDays ?? null,
    durationCycles: b.durationCycles ?? null,
    autoRenew: b.autoRenew ?? true,
    mealsPerCycle: b.mealsPerCycle ?? null,
    creditsPerCycle: b.creditsPerCycle ?? null,
    bonusCredits: b.bonusCredits ?? 0,
    creditExpiryDays: b.creditExpiryDays ?? null,
    perItemCreditCost: b.perItemCreditCost ? String(b.perItemCreditCost) : null,
    allowedItemIds: b.allowedItemIds ?? [],
    allowedCategoryIds: b.allowedCategoryIds ?? [],
    maxMealsPerDay: b.maxMealsPerDay ?? null,
    validDaysOfWeek: b.validDaysOfWeek ?? [],
    validTimeStart: b.validTimeStart ?? null,
    validTimeEnd: b.validTimeEnd ?? null,
    eligibleOrderTypes: b.eligibleOrderTypes ?? ["dine_in", "takeaway", "delivery"],
    maxFamilyMembers: b.maxFamilyMembers ?? 1,
    refundPolicy: b.refundPolicy ?? "none",
    refundWithinDays: b.refundWithinDays ?? null,
    maxPauseDays: b.maxPauseDays ?? null,
    renewalReminderDays: b.renewalReminderDays ?? 3,
    lowBalanceThreshold: b.lowBalanceThreshold ?? 2,
    isActive: b.isActive ?? true,
    showOnCustomerApp: b.showOnCustomerApp ?? true,
  }).returning();
  res.status(201).json(row);
});

router.get("/restaurants/:restaurantId/meal-plan-templates/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db.select().from(mealPlanTemplatesTable)
    .where(and(eq(mealPlanTemplatesTable.id, id), eq(mealPlanTemplatesTable.restaurantId, restaurantId)));
  if (!row) return void res.status(404).json({ error: "Template not found" });
  res.json(row);
});

router.patch("/restaurants/:restaurantId/meal-plan-templates/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const b = req.body as Partial<MealPlanTemplate>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of [
    "name", "description", "type", "billingCycle", "cycleDays", "durationCycles", "autoRenew",
    "mealsPerCycle", "creditsPerCycle", "bonusCredits", "creditExpiryDays",
    "allowedItemIds", "allowedCategoryIds", "maxMealsPerDay", "validDaysOfWeek",
    "validTimeStart", "validTimeEnd", "eligibleOrderTypes", "maxFamilyMembers",
    "refundPolicy", "refundWithinDays", "maxPauseDays", "renewalReminderDays",
    "lowBalanceThreshold", "isActive", "showOnCustomerApp", "currency",
  ] as const) {
    if (b[k] !== undefined) updates[k] = b[k];
  }
  if (b.price !== undefined) updates.price = String(b.price);
  if (b.perItemCreditCost !== undefined) updates.perItemCreditCost = b.perItemCreditCost ? String(b.perItemCreditCost) : null;
  const [row] = await db.update(mealPlanTemplatesTable).set(updates)
    .where(and(eq(mealPlanTemplatesTable.id, id), eq(mealPlanTemplatesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Template not found" });
  res.json(row);
});

router.post("/restaurants/:restaurantId/meal-plan-templates/:id/duplicate", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [src] = await db.select().from(mealPlanTemplatesTable)
    .where(and(eq(mealPlanTemplatesTable.id, id), eq(mealPlanTemplatesTable.restaurantId, restaurantId)));
  if (!src) return void res.status(404).json({ error: "Template not found" });
  const { id: _ignore, createdAt: _c, updatedAt: _u, archivedAt: _a, ...rest } = src;
  const [row] = await db.insert(mealPlanTemplatesTable).values({
    ...rest,
    name: `${src.name} (copy)`,
  }).returning();
  res.status(201).json(row);
});

router.post("/restaurants/:restaurantId/meal-plan-templates/:id/archive", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [active] = await db.select({ c: sql<number>`count(*)::int` }).from(customerSubscriptionsTable)
    .where(and(
      eq(customerSubscriptionsTable.templateId, id),
      sql`${customerSubscriptionsTable.status} IN ('active','paused','pending')`,
    ));
  if ((active?.c ?? 0) > 0) {
    return void res.status(409).json({
      error: `Cannot archive — ${active!.c} active subscriptions still use this template. Cancel them first.`,
    });
  }
  const [row] = await db.update(mealPlanTemplatesTable)
    .set({ archivedAt: new Date(), isActive: false, showOnCustomerApp: false, updatedAt: new Date() })
    .where(and(eq(mealPlanTemplatesTable.id, id), eq(mealPlanTemplatesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Template not found" });
  res.json(row);
});

// ─── Subscriptions: CRUD + actions ────────────────────────────────

router.use("/restaurants/:restaurantId/customer-subscriptions",
  requireRole("owner", "manager", "waiter", "super_admin"), validateRestaurantAccess);

router.get("/restaurants/:restaurantId/customer-subscriptions", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status, customerId, templateId } = req.query;
  const conds = [eq(customerSubscriptionsTable.restaurantId, restaurantId)];
  if (status) conds.push(eq(customerSubscriptionsTable.status, String(status)));
  if (customerId) conds.push(eq(customerSubscriptionsTable.customerId, Number(customerId)));
  if (templateId) conds.push(eq(customerSubscriptionsTable.templateId, Number(templateId)));
  const rows = await db.select({
    sub: customerSubscriptionsTable,
    customer: { id: customersTable.id, name: customersTable.name, phone: customersTable.phone, email: customersTable.email },
    template: { id: mealPlanTemplatesTable.id, name: mealPlanTemplatesTable.name, type: mealPlanTemplatesTable.type },
  })
    .from(customerSubscriptionsTable)
    .leftJoin(customersTable, eq(customersTable.id, customerSubscriptionsTable.customerId))
    .leftJoin(mealPlanTemplatesTable, eq(mealPlanTemplatesTable.id, customerSubscriptionsTable.templateId))
    .where(and(...conds))
    .orderBy(desc(customerSubscriptionsTable.id));
  res.json(rows);
});

router.get("/restaurants/:restaurantId/customer-subscriptions/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [sub] = await db.select().from(customerSubscriptionsTable)
    .where(and(eq(customerSubscriptionsTable.id, id), eq(customerSubscriptionsTable.restaurantId, restaurantId)));
  if (!sub) return void res.status(404).json({ error: "Subscription not found" });
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, sub.customerId));
  const [template] = await db.select().from(mealPlanTemplatesTable).where(eq(mealPlanTemplatesTable.id, sub.templateId));
  const cycles = await db.select().from(subscriptionCyclesTable)
    .where(eq(subscriptionCyclesTable.subscriptionId, id))
    .orderBy(desc(subscriptionCyclesTable.cycleNumber));
  const usage = await db.select().from(subscriptionUsageTable)
    .where(eq(subscriptionUsageTable.subscriptionId, id))
    .orderBy(desc(subscriptionUsageTable.id))
    .limit(50);
  const invoices = await db.select().from(subscriptionInvoicesTable)
    .where(eq(subscriptionInvoicesTable.subscriptionId, id))
    .orderBy(desc(subscriptionInvoicesTable.id));
  const events = await db.select().from(subscriptionEventsTable)
    .where(eq(subscriptionEventsTable.subscriptionId, id))
    .orderBy(desc(subscriptionEventsTable.id))
    .limit(100);
  const family = await db.select().from(subscriptionFamilyMembersTable)
    .where(eq(subscriptionFamilyMembersTable.subscriptionId, id))
    .orderBy(subscriptionFamilyMembersTable.id);
  res.json({ subscription: sub, customer, template, cycles, usage, invoices, events, family });
});

/** Activate a subscription: write template snapshot, create first cycle, generate invoice. */
async function activateSubscription(opts: {
  restaurantId: number;
  customerId: number;
  templateId: number;
  paymentMethod: string;
  startDate?: Date;
  amountPaid?: string;
  externalRef?: string | null;
  actorUserId?: number | null;
}): Promise<{ subscription: CustomerSubscription; invoiceId: number }> {
  const [template] = await db.select().from(mealPlanTemplatesTable)
    .where(and(eq(mealPlanTemplatesTable.id, opts.templateId), eq(mealPlanTemplatesTable.restaurantId, opts.restaurantId)));
  if (!template || !template.isActive || template.archivedAt) throw new Error("TEMPLATE_NOT_AVAILABLE");
  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, opts.customerId), eq(customersTable.restaurantId, opts.restaurantId)));
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

  const start = opts.startDate ?? new Date();
  const cycleEnd = addCycle(start, template.billingCycle, template.cycleDays);
  const meals = template.mealsPerCycle ?? 0;
  const credits = (template.creditsPerCycle ?? 0) + (template.bonusCredits ?? 0);

  const [sub] = await db.insert(customerSubscriptionsTable).values({
    restaurantId: opts.restaurantId,
    customerId: opts.customerId,
    templateId: opts.templateId,
    templateSnapshot: snapshotTemplate(template),
    status: "active",
    startDate: start,
    currentCycleStart: start,
    currentCycleEnd: cycleEnd,
    nextBillingDate: template.autoRenew ? cycleEnd : null,
    mealsRemaining: meals,
    creditsRemaining: credits,
    paymentMethod: opts.paymentMethod,
    lastChargeAt: new Date(),
  }).returning();

  await db.insert(subscriptionCyclesTable).values({
    subscriptionId: sub.id,
    cycleNumber: 1,
    startsAt: start,
    endsAt: cycleEnd,
    mealsAllotted: meals,
    mealsRemaining: meals,
    creditsAllotted: credits,
    creditsRemaining: credits,
  });

  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, opts.restaurantId));
  const taxRate = Number(restaurant?.taxRate ?? 0);
  const subtotal = Number(opts.amountPaid ?? template.price);
  const taxAmount = +(subtotal * taxRate / 100).toFixed(2);
  const total = +(subtotal + taxAmount).toFixed(2);
  const invNum = await nextInvoiceNumber(opts.restaurantId);
  const [invoice] = await db.insert(subscriptionInvoicesTable).values({
    restaurantId: opts.restaurantId,
    subscriptionId: sub.id,
    customerId: opts.customerId,
    invoiceNumber: invNum,
    periodStart: start,
    periodEnd: cycleEnd,
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    taxRate: taxRate.toFixed(2),
    totalAmount: total.toFixed(2),
    currency: template.currency,
    paymentMethod: opts.paymentMethod,
    gatewayTxnId: opts.externalRef ?? null,
    status: "paid",
    snapshot: { templateName: template.name, customerName: customer.name, restaurantName: restaurant?.name },
  }).returning();

  await db.insert(subscriptionPaymentsCustomerTable).values({
    restaurantId: opts.restaurantId,
    subscriptionId: sub.id,
    customerId: opts.customerId,
    invoiceId: invoice.id,
    amount: total.toFixed(2),
    currency: template.currency,
    provider: opts.paymentMethod,
    externalRef: opts.externalRef ?? null,
    status: "succeeded",
  });

  await logEvent(sub.id, "activated", `Plan "${template.name}" activated`, { invoiceId: invoice.id }, opts.actorUserId ?? null);
  await notifyRestaurant(opts.restaurantId, "subscription.sold",
    "New subscription sold", `${customer.name} subscribed to ${template.name}.`, sub.id);
  return { subscription: sub, invoiceId: invoice.id };
}

router.post("/restaurants/:restaurantId/customer-subscriptions", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const b = req.body as { customerId: number; templateId: number; paymentMethod?: string; startDate?: string; amountPaid?: string; externalRef?: string };
  if (!b.customerId || !b.templateId) return void res.status(400).json({ error: "customerId and templateId required" });
  try {
    const result = await activateSubscription({
      restaurantId,
      customerId: b.customerId,
      templateId: b.templateId,
      paymentMethod: b.paymentMethod ?? "cash",
      startDate: b.startDate ? new Date(b.startDate) : undefined,
      amountPaid: b.amountPaid,
      externalRef: b.externalRef ?? null,
      actorUserId: req.user?.sub ?? null,
    });
    res.status(201).json(result);
  } catch (err) {
    const map: Record<string, [number, string]> = {
      TEMPLATE_NOT_AVAILABLE: [400, "Plan template is not available"],
      CUSTOMER_NOT_FOUND: [404, "Customer not found"],
    };
    const [status, msg] = map[(err as Error).message] ?? [500, "Failed to activate subscription"];
    res.status(status).json({ error: msg });
  }
});

router.post("/restaurants/:restaurantId/customer-subscriptions/:id/pause", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const reason = (req.body as { reason?: string }).reason ?? null;
  const [sub] = await db.select().from(customerSubscriptionsTable)
    .where(and(eq(customerSubscriptionsTable.id, id), eq(customerSubscriptionsTable.restaurantId, restaurantId)));
  if (!sub) return void res.status(404).json({ error: "Not found" });
  if (sub.status !== "active") return void res.status(400).json({ error: `Cannot pause from status ${sub.status}` });
  const [row] = await db.update(customerSubscriptionsTable)
    .set({ status: "paused", pausedAt: new Date(), pauseReason: reason, updatedAt: new Date() })
    .where(eq(customerSubscriptionsTable.id, id)).returning();
  await logEvent(id, "paused", reason ?? "Paused by staff/customer", {}, req.user?.sub ?? null);
  res.json(row);
});

router.post("/restaurants/:restaurantId/customer-subscriptions/:id/resume", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [sub] = await db.select().from(customerSubscriptionsTable)
    .where(and(eq(customerSubscriptionsTable.id, id), eq(customerSubscriptionsTable.restaurantId, restaurantId)));
  if (!sub || sub.status !== "paused" || !sub.pausedAt) return void res.status(400).json({ error: "Not paused" });
  const pauseDays = Math.ceil((Date.now() - sub.pausedAt.getTime()) / 86400000);
  const newCycleEnd = sub.currentCycleEnd ? new Date(sub.currentCycleEnd.getTime() + pauseDays * 86400000) : null;
  const newBilling = sub.nextBillingDate ? new Date(sub.nextBillingDate.getTime() + pauseDays * 86400000) : null;
  const [row] = await db.update(customerSubscriptionsTable).set({
    status: "active", pausedAt: null, pauseReason: null,
    pauseDaysUsed: sub.pauseDaysUsed + pauseDays,
    currentCycleEnd: newCycleEnd, nextBillingDate: newBilling, updatedAt: new Date(),
  }).where(eq(customerSubscriptionsTable.id, id)).returning();
  await logEvent(id, "resumed", `Resumed after ${pauseDays} days`, { pauseDays }, req.user?.sub ?? null);
  res.json(row);
});

router.post("/restaurants/:restaurantId/customer-subscriptions/:id/cancel", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { atCycleEnd } = req.body as { atCycleEnd?: boolean };
  const [sub] = await db.select().from(customerSubscriptionsTable)
    .where(and(eq(customerSubscriptionsTable.id, id), eq(customerSubscriptionsTable.restaurantId, restaurantId)));
  if (!sub) return void res.status(404).json({ error: "Not found" });
  if (atCycleEnd) {
    const [row] = await db.update(customerSubscriptionsTable)
      .set({ cancelAtCycleEnd: true, endsAt: sub.currentCycleEnd, nextBillingDate: null, updatedAt: new Date() })
      .where(eq(customerSubscriptionsTable.id, id)).returning();
    await logEvent(id, "cancelled", "Cancellation scheduled at end of cycle", {}, req.user?.sub ?? null);
    res.json(row);
  } else {
    const [row] = await db.update(customerSubscriptionsTable)
      .set({ status: "cancelled", endsAt: new Date(), nextBillingDate: null, updatedAt: new Date() })
      .where(eq(customerSubscriptionsTable.id, id)).returning();
    await logEvent(id, "cancelled", "Cancelled immediately", {}, req.user?.sub ?? null);
    await notifyRestaurant(restaurantId, "subscription.cancelled",
      "Subscription cancelled", `Subscription #${id} was cancelled.`, id);
    res.json(row);
  }
});

router.post("/restaurants/:restaurantId/customer-subscriptions/:id/reassign",
  requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { customerId } = req.body as { customerId: number };
  if (!customerId) return void res.status(400).json({ error: "customerId required" });
  const [c] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Customer not in this restaurant" });
  const [row] = await db.update(customerSubscriptionsTable)
    .set({ customerId, updatedAt: new Date() })
    .where(and(eq(customerSubscriptionsTable.id, id), eq(customerSubscriptionsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Subscription not found" });
  await logEvent(id, "reassigned", `Reassigned to customer ${c.name}`, { customerId }, req.user?.sub ?? null);
  res.json(row);
});

router.post("/restaurants/:restaurantId/customer-subscriptions/:id/charge-now",
  requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  try {
    const result = await runRenewalCharge(id, restaurantId, req.user?.sub ?? null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ─── Family members ───────────────────────────────────────────────

router.get("/restaurants/:restaurantId/customer-subscriptions/:id/family", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(subscriptionFamilyMembersTable)
    .where(eq(subscriptionFamilyMembersTable.subscriptionId, id));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/customer-subscriptions/:id/family", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { name, phone, email, customerId } = req.body as { name: string; phone?: string; email?: string; customerId?: number };
  if (!name) return void res.status(400).json({ error: "name required" });
  const [sub] = await db.select().from(customerSubscriptionsTable)
    .where(and(eq(customerSubscriptionsTable.id, id), eq(customerSubscriptionsTable.restaurantId, restaurantId)));
  if (!sub) return void res.status(404).json({ error: "Not found" });
  const snapshot = sub.templateSnapshot as { maxFamilyMembers?: number };
  const [{ c: existing }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(subscriptionFamilyMembersTable)
    .where(and(eq(subscriptionFamilyMembersTable.subscriptionId, id), eq(subscriptionFamilyMembersTable.isActive, true)));
  if (existing >= (snapshot.maxFamilyMembers ?? 1)) {
    return void res.status(400).json({ error: `Family plan allows max ${snapshot.maxFamilyMembers ?? 1} members` });
  }
  const [row] = await db.insert(subscriptionFamilyMembersTable).values({
    subscriptionId: id, customerId: customerId ?? null, name, phone: phone ?? null, email: email ?? null,
  }).returning();
  await logEvent(id, "family_added", `Added ${name}`, { name }, req.user?.sub ?? null);
  res.status(201).json(row);
});

router.delete("/restaurants/:restaurantId/customer-subscriptions/:id/family/:memberId", async (req, res) => {
  const id = Number(req.params.id);
  const memberId = Number(req.params.memberId);
  await db.update(subscriptionFamilyMembersTable)
    .set({ isActive: false, removedAt: new Date() })
    .where(and(eq(subscriptionFamilyMembersTable.id, memberId), eq(subscriptionFamilyMembersTable.subscriptionId, id)));
  await logEvent(id, "family_removed", `Removed family member`, { memberId }, req.user?.sub ?? null);
  res.status(204).end();
});

// ─── Manual redemption (staff override) ───────────────────────────

router.post("/restaurants/:restaurantId/customer-subscriptions/:id/redeem",
  requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { orderId, items, mealsConsumed, creditsConsumed, valueCovered, note } = req.body as {
    orderId?: number; items?: Array<{ itemId: number; name: string; quantity: number; value: string }>;
    mealsConsumed?: number; creditsConsumed?: number; valueCovered?: string; note?: string;
  };
  const [sub] = await db.select().from(customerSubscriptionsTable)
    .where(and(eq(customerSubscriptionsTable.id, id), eq(customerSubscriptionsTable.restaurantId, restaurantId)));
  if (!sub) return void res.status(404).json({ error: "Not found" });
  const meals = mealsConsumed ?? 0;
  const credits = creditsConsumed ?? 0;
  if (meals > sub.mealsRemaining) return void res.status(400).json({ error: "Insufficient meals remaining" });
  if (credits > sub.creditsRemaining) return void res.status(400).json({ error: "Insufficient credits remaining" });
  const [usage] = await db.insert(subscriptionUsageTable).values({
    subscriptionId: id, orderId: orderId ?? null, customerId: sub.customerId, restaurantId,
    itemsCovered: items ?? [], mealsConsumed: meals, creditsConsumed: credits,
    valueCovered: valueCovered ?? "0.00", note: note ?? "Manual redeem", recordedBy: req.user?.sub ?? null,
  }).returning();
  await db.update(customerSubscriptionsTable).set({
    mealsRemaining: sub.mealsRemaining - meals,
    mealsUsed: sub.mealsUsed + meals,
    creditsRemaining: sub.creditsRemaining - credits,
    creditsUsed: sub.creditsUsed + credits,
    totalMealsUsed: sub.totalMealsUsed + meals,
    totalCreditsUsed: sub.totalCreditsUsed + credits,
    updatedAt: new Date(),
  }).where(eq(customerSubscriptionsTable.id, id));
  await logEvent(id, "manual_redeem", note ?? "Manual redemption", { meals, credits }, req.user?.sub ?? null);
  res.status(201).json(usage);
});

router.post("/restaurants/:restaurantId/customer-subscriptions/:id/unredeem/:usageId",
  requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const usageId = Number(req.params.usageId);
  const [u] = await db.select().from(subscriptionUsageTable)
    .where(and(eq(subscriptionUsageTable.id, usageId), eq(subscriptionUsageTable.subscriptionId, id)));
  if (!u) return void res.status(404).json({ error: "Usage row not found" });
  const [sub] = await db.select().from(customerSubscriptionsTable)
    .where(and(eq(customerSubscriptionsTable.id, id), eq(customerSubscriptionsTable.restaurantId, restaurantId)));
  if (!sub) return void res.status(404).json({ error: "Not found" });
  await db.insert(subscriptionUsageTable).values({
    subscriptionId: id, orderId: u.orderId, customerId: u.customerId, restaurantId,
    itemsCovered: u.itemsCovered, mealsConsumed: -u.mealsConsumed, creditsConsumed: -u.creditsConsumed,
    valueCovered: (-Number(u.valueCovered)).toFixed(2), isReversal: true,
    note: `Reversal of usage #${usageId}`, recordedBy: req.user?.sub ?? null,
  });
  await db.update(customerSubscriptionsTable).set({
    mealsRemaining: sub.mealsRemaining + u.mealsConsumed,
    mealsUsed: Math.max(0, sub.mealsUsed - u.mealsConsumed),
    creditsRemaining: sub.creditsRemaining + u.creditsConsumed,
    creditsUsed: Math.max(0, sub.creditsUsed - u.creditsConsumed),
    updatedAt: new Date(),
  }).where(eq(customerSubscriptionsTable.id, id));
  await logEvent(id, "manual_redeem", `Reversed usage #${usageId}`, { reversedUsageId: usageId }, req.user?.sub ?? null);
  res.json({ ok: true });
});

// ─── Invoice download (simple HTML/text) ──────────────────────────

router.get("/restaurants/:restaurantId/subscription-invoices/:invoiceId",
  requireRole("owner", "manager", "waiter", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const invoiceId = Number(req.params.invoiceId);
  const [inv] = await db.select().from(subscriptionInvoicesTable)
    .where(and(eq(subscriptionInvoicesTable.id, invoiceId), eq(subscriptionInvoicesTable.restaurantId, restaurantId)));
  if (!inv) return void res.status(404).json({ error: "Invoice not found" });
  res.json(inv);
});

router.get("/restaurants/:restaurantId/subscription-invoices/:invoiceId/download",
  requireRole("owner", "manager", "waiter", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const invoiceId = Number(req.params.invoiceId);
  const [inv] = await db.select().from(subscriptionInvoicesTable)
    .where(and(eq(subscriptionInvoicesTable.id, invoiceId), eq(subscriptionInvoicesTable.restaurantId, restaurantId)));
  if (!inv) return void res.status(404).json({ error: "Invoice not found" });
  const snap = inv.snapshot as { templateName?: string; customerName?: string; restaurantName?: string };
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${inv.invoiceNumber}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem}
h1{margin:0 0 .25rem}.muted{color:#666}.row{display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #eee}
.total{font-weight:700;font-size:1.2rem}</style></head><body>
<h1>${snap.restaurantName ?? "Restaurant"}</h1>
<p class="muted">Invoice ${inv.invoiceNumber} · ${inv.createdAt.toISOString().slice(0, 10)}</p>
<h3>Customer: ${snap.customerName ?? "—"}</h3>
<p>Plan: <strong>${snap.templateName ?? "—"}</strong><br/>
Period: ${inv.periodStart.toISOString().slice(0, 10)} → ${inv.periodEnd.toISOString().slice(0, 10)}<br/>
Payment: ${inv.paymentMethod ?? "—"} ${inv.gatewayTxnId ? `· ref ${inv.gatewayTxnId}` : ""}</p>
<div class="row"><span>Subtotal</span><span>${inv.currency} ${inv.subtotal}</span></div>
<div class="row"><span>Tax (${inv.taxRate}%)</span><span>${inv.currency} ${inv.taxAmount}</span></div>
<div class="row total"><span>Total paid</span><span>${inv.currency} ${inv.totalAmount}</span></div>
<p class="muted">Status: ${inv.status}</p>
</body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${inv.invoiceNumber}.html"`);
  res.send(html);
});

// ─── Auto-billing engine (called from scheduler) ──────────────────

export async function runRenewalCharge(
  subscriptionId: number,
  restaurantId?: number,
  actorUserId?: number | null,
): Promise<{ ok: boolean; invoiceId?: number; error?: string }> {
  const conds = [eq(customerSubscriptionsTable.id, subscriptionId)];
  if (restaurantId) conds.push(eq(customerSubscriptionsTable.restaurantId, restaurantId));
  const [sub] = await db.select().from(customerSubscriptionsTable).where(and(...conds));
  if (!sub) throw new Error("Subscription not found");
  if (sub.status !== "active") throw new Error(`Cannot charge from status ${sub.status}`);

  const [template] = await db.select().from(mealPlanTemplatesTable)
    .where(eq(mealPlanTemplatesTable.id, sub.templateId));
  if (!template) throw new Error("Template missing");

  if (sub.cancelAtCycleEnd) {
    await db.update(customerSubscriptionsTable)
      .set({ status: "expired", endsAt: new Date(), nextBillingDate: null, updatedAt: new Date() })
      .where(eq(customerSubscriptionsTable.id, subscriptionId));
    await logEvent(subscriptionId, "expired", "Subscription expired (cancel-at-cycle-end)", {});
    return { ok: true };
  }

  // Reuse stored payment method. Cash/manual is auto-success; gateway tokens we
  // mark succeeded as a stub — production wires Razorpay/Cashfree mandate calls here.
  const method = sub.paymentMethod ?? "cash";
  const success = method === "cash" || method === "upi" || method === "bank" || method === "wallet"
    || method === "razorpay" || method === "cashfree" || method === "stripe";
  // Simulate occasional failure for gateway methods only via env flag (none by default).
  const failChance = Number(process.env.MEAL_PLAN_AUTOBILL_FAIL_PCT ?? 0);
  const forceFail = failChance > 0 && Math.random() * 100 < failChance && method !== "cash";

  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, sub.restaurantId));
  const taxRate = Number(restaurant?.taxRate ?? 0);
  const subtotal = Number(template.price);
  const taxAmount = +(subtotal * taxRate / 100).toFixed(2);
  const total = +(subtotal + taxAmount).toFixed(2);

  if (!success || forceFail) {
    const newAttempts = sub.failedAttempts + 1;
    const willSuspend = newAttempts >= 3;
    await db.update(customerSubscriptionsTable).set({
      failedAttempts: newAttempts,
      lastFailureReason: forceFail ? "Gateway declined (simulated)" : "Unsupported payment method",
      // Retry ladder: +1, +3, +7 days from today
      nextBillingDate: willSuspend ? null : new Date(Date.now() + (newAttempts === 1 ? 1 : newAttempts === 2 ? 3 : 7) * 86400000),
      status: willSuspend ? "paused" : sub.status,
      updatedAt: new Date(),
    }).where(eq(customerSubscriptionsTable.id, subscriptionId));
    await db.insert(subscriptionPaymentsCustomerTable).values({
      restaurantId: sub.restaurantId, subscriptionId, customerId: sub.customerId,
      amount: total.toFixed(2), currency: template.currency, provider: method,
      status: "failed", failureReason: "auto-renew failed",
    });
    await logEvent(subscriptionId, willSuspend ? "suspended" : "charge_failed",
      willSuspend ? "Auto-suspended after dunning ladder" : `Auto-charge failed (attempt ${newAttempts}/3)`,
      { attempt: newAttempts });
    if (willSuspend) {
      await notifyRestaurant(sub.restaurantId, "subscription.suspended",
        "Subscription auto-suspended", `Subscription #${subscriptionId} suspended after 3 failed charges.`, subscriptionId);
    }
    return { ok: false, error: "Charge failed" };
  }

  // Success — advance the cycle and generate the renewal invoice.
  const periodStart = sub.currentCycleEnd ?? new Date();
  const periodEnd = addCycle(periodStart, template.billingCycle, template.cycleDays);
  const meals = template.mealsPerCycle ?? 0;
  const credits = (template.creditsPerCycle ?? 0) + (template.bonusCredits ?? 0);
  const newCycleNumber = sub.cyclesCompleted + 2; // first cycle was #1

  await db.insert(subscriptionCyclesTable).values({
    subscriptionId, cycleNumber: newCycleNumber,
    startsAt: periodStart, endsAt: periodEnd,
    mealsAllotted: meals, mealsRemaining: meals,
    creditsAllotted: credits, creditsRemaining: credits,
  });

  const stillRenew = template.autoRenew
    && (template.durationCycles == null || newCycleNumber < template.durationCycles);

  await db.update(customerSubscriptionsTable).set({
    currentCycleStart: periodStart,
    currentCycleEnd: periodEnd,
    nextBillingDate: stillRenew ? periodEnd : null,
    cyclesCompleted: sub.cyclesCompleted + 1,
    mealsRemaining: meals,
    mealsUsed: 0,
    creditsRemaining: sub.creditsRemaining + credits, // top up credits
    creditsUsed: 0,
    failedAttempts: 0,
    lastFailureReason: null,
    lastChargeAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(customerSubscriptionsTable.id, subscriptionId));

  const invNum = await nextInvoiceNumber(sub.restaurantId);
  const [invoice] = await db.insert(subscriptionInvoicesTable).values({
    restaurantId: sub.restaurantId, subscriptionId, customerId: sub.customerId,
    invoiceNumber: invNum, periodStart, periodEnd,
    subtotal: subtotal.toFixed(2), taxAmount: taxAmount.toFixed(2),
    taxRate: taxRate.toFixed(2), totalAmount: total.toFixed(2), currency: template.currency,
    paymentMethod: method, gatewayTxnId: `auto_${Date.now()}`, status: "paid",
    snapshot: { templateName: template.name, restaurantName: restaurant?.name },
  }).returning();
  await db.insert(subscriptionPaymentsCustomerTable).values({
    restaurantId: sub.restaurantId, subscriptionId, customerId: sub.customerId,
    invoiceId: invoice.id, amount: total.toFixed(2), currency: template.currency,
    provider: method, status: "succeeded",
  });

  await logEvent(subscriptionId, "renewed", `Renewed cycle #${newCycleNumber}`, { invoiceId: invoice.id }, actorUserId);
  return { ok: true, invoiceId: invoice.id };
}

/** Daily scheduler entry point. Charges due subs and sweeps reminders / low balance / expiry. */
export async function processSubscriptionRenewalsAndReminders(): Promise<{ charged: number; failed: number }> {
  const now = new Date();
  const due = await db.select().from(customerSubscriptionsTable).where(and(
    eq(customerSubscriptionsTable.status, "active"),
    isNotNull(customerSubscriptionsTable.nextBillingDate),
    lte(customerSubscriptionsTable.nextBillingDate, now),
  ));
  let charged = 0, failed = 0;
  for (const sub of due) {
    try {
      const r = await runRenewalCharge(sub.id);
      if (r.ok) charged++; else failed++;
    } catch (err) {
      logger.warn({ err, subId: sub.id }, "auto-bill subscription failed");
      failed++;
    }
  }

  // Renewal reminders & expiry detection.
  const reminderSubs = await db.select().from(customerSubscriptionsTable).where(and(
    eq(customerSubscriptionsTable.status, "active"),
    isNotNull(customerSubscriptionsTable.nextBillingDate),
  ));
  for (const sub of reminderSubs) {
    const snap = sub.templateSnapshot as { renewalReminderDays?: number; lowBalanceThreshold?: number; mealsPerCycle?: number };
    const days = snap.renewalReminderDays ?? 3;
    if (sub.nextBillingDate) {
      const daysToRenew = Math.ceil((sub.nextBillingDate.getTime() - now.getTime()) / 86400000);
      if (daysToRenew === days || daysToRenew === 1) {
        await notifyRestaurant(sub.restaurantId, "subscription.renewal_reminder",
          "Subscription renewing soon",
          `Sub #${sub.id} renews in ${daysToRenew} day(s).`, sub.id);
        await logEvent(sub.id, "renewed", `Renewal reminder ${daysToRenew}d`, { daysToRenew });
      }
    }
    const threshold = snap.lowBalanceThreshold ?? 2;
    if ((snap.mealsPerCycle ?? 0) > 0 && sub.mealsRemaining <= threshold) {
      await logEvent(sub.id, "low_balance", `Low meal balance (${sub.mealsRemaining} left)`, { mealsRemaining: sub.mealsRemaining });
    }
  }

  // Expire subscriptions whose endsAt has passed.
  const expiring = await db.select().from(customerSubscriptionsTable).where(and(
    isNotNull(customerSubscriptionsTable.endsAt),
    lte(customerSubscriptionsTable.endsAt, now),
    sql`${customerSubscriptionsTable.status} IN ('active','paused')`,
  ));
  for (const sub of expiring) {
    await db.update(customerSubscriptionsTable)
      .set({ status: "expired", nextBillingDate: null, updatedAt: new Date() })
      .where(eq(customerSubscriptionsTable.id, sub.id));
    await logEvent(sub.id, "expired", "Subscription expired", {});
  }

  return { charged, failed };
}

// ─── Customer-facing endpoints (require auth as a customer or staff) ─

router.get("/restaurants/:restaurantId/public/meal-plans", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(mealPlanTemplatesTable).where(and(
    eq(mealPlanTemplatesTable.restaurantId, restaurantId),
    eq(mealPlanTemplatesTable.isActive, true),
    eq(mealPlanTemplatesTable.showOnCustomerApp, true),
    sql`${mealPlanTemplatesTable.archivedAt} IS NULL`,
  )).orderBy(mealPlanTemplatesTable.price);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/customers/:customerId/subscriptions",
  requireRole("owner", "manager", "waiter", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.customerId);
  const subs = await db.select().from(customerSubscriptionsTable).where(and(
    eq(customerSubscriptionsTable.restaurantId, restaurantId),
    eq(customerSubscriptionsTable.customerId, customerId),
  )).orderBy(desc(customerSubscriptionsTable.id));
  const tplIds = subs.map(s => s.templateId);
  const templates = tplIds.length ? await db.select().from(mealPlanTemplatesTable)
    .where(inArray(mealPlanTemplatesTable.id, tplIds)) : [];
  const tplMap = new Map(templates.map(t => [t.id, t]));
  res.json(subs.map(s => ({ ...s, template: tplMap.get(s.templateId) ?? null })));
});

export default router;
