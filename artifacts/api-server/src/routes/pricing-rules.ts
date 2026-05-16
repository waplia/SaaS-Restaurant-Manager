/**
 * Dynamic pricing rules — owner-facing CRUD + simulator + calendar.
 *
 * Mounted under `/restaurants/:restaurantId/pricing-rules`. Limited to
 * owner / manager / super_admin since rules directly affect billing.
 */
import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  pricingRulesTable,
  menuItemsTable,
  type PricingRule,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  resolveItemPrice,
  buildPricingCalendar,
  invalidatePricingRulesCache,
} from "../lib/pricingRules";
import { recordAuditLog } from "../lib/audit";

const router = Router();

router.use(
  "/restaurants/:restaurantId/pricing-rules",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);
router.use(
  "/restaurants/:restaurantId/pricing-rules/:rest",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

const RULE_TYPES = [
  "happy_hour",
  "lunch_special",
  "weekend",
  "delivery_only",
  "outlet",
  "customer_group",
  "event",
  "time_of_day",
  "day_of_week",
  "custom",
] as const;

const ADJUSTMENT_KINDS = ["percent_off", "percent_up", "flat_off", "fixed_price"] as const;
const SCOPE_KINDS = ["all", "category", "item"] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const ruleInputSchema = z.object({
  name: z.string().min(1).max(120),
  ruleType: z.enum(RULE_TYPES),
  description: z.string().nullish(),
  isActive: z.boolean().default(true),
  priority: z.number().int().min(0).max(10000).default(100),
  scopeKind: z.enum(SCOPE_KINDS).default("all"),
  scopeIds: z.array(z.number().int().positive()).default([]),
  adjustmentKind: z.enum(ADJUSTMENT_KINDS),
  adjustmentValue: z.number().min(0),
  startDate: z.string().datetime().nullish(),
  endDate: z.string().datetime().nullish(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  startTime: z.string().regex(TIME_RE).nullish(),
  endTime: z.string().regex(TIME_RE).nullish(),
  channels: z.array(z.enum(["dine_in", "takeaway", "delivery"])).default([]),
  branchIds: z.array(z.number().int().positive()).default([]),
  customerGroups: z
    .array(z.enum(["guest", "regular", "vip", "loyalty_silver", "loyalty_gold", "loyalty_platinum"]))
    .default([]),
});

type RuleInput = z.infer<typeof ruleInputSchema>;

function inputToRow(restaurantId: number, input: RuleInput, userId: number | undefined) {
  return {
    restaurantId,
    name: input.name,
    ruleType: input.ruleType,
    description: input.description ?? null,
    isActive: input.isActive,
    priority: input.priority,
    scopeKind: input.scopeKind,
    scopeIds: input.scopeIds,
    adjustmentKind: input.adjustmentKind,
    adjustmentValue: input.adjustmentValue.toFixed(2),
    startDate: input.startDate ? new Date(input.startDate) : null,
    endDate: input.endDate ? new Date(input.endDate) : null,
    daysOfWeek: input.daysOfWeek,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    channels: input.channels,
    branchIds: input.branchIds,
    customerGroups: input.customerGroups,
    createdBy: userId ?? null,
  };
}

router.get("/restaurants/:restaurantId/pricing-rules", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { type, branchId, active } = req.query;
  const conds = [eq(pricingRulesTable.restaurantId, restaurantId)];
  if (active === "true") conds.push(eq(pricingRulesTable.isActive, true));
  if (active === "false") conds.push(eq(pricingRulesTable.isActive, false));
  if (type) conds.push(eq(pricingRulesTable.ruleType, String(type)));
  let rows = await db.select().from(pricingRulesTable).where(and(...conds));
  if (branchId) {
    const bid = Number(branchId);
    rows = rows.filter((r) => (r.branchIds ?? []).length === 0 || (r.branchIds ?? []).includes(bid));
  }
  rows.sort((a, b) => b.priority - a.priority || b.id - a.id);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/pricing-rules/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db
    .select()
    .from(pricingRulesTable)
    .where(and(eq(pricingRulesTable.id, id), eq(pricingRulesTable.restaurantId, restaurantId)));
  if (!row) {
    res.status(404).json({ error: "Pricing rule not found" });
    return;
  }
  res.json(row);
});

router.post("/restaurants/:restaurantId/pricing-rules", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = ruleInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid pricing rule", issues: parsed.error.issues });
    return;
  }
  const [row] = await db
    .insert(pricingRulesTable)
    .values(inputToRow(restaurantId, parsed.data, req.user?.sub))
    .returning();
  invalidatePricingRulesCache();
  await recordAuditLog({
    req,
    module: "pricing_rules",
    action: "create",
    entity: "pricing_rule",
    entityId: row.id,
    restaurantId,
    newValue: { name: row.name, ruleType: row.ruleType },
  }).catch(() => {});
  res.status(201).json(row);
});

router.put("/restaurants/:restaurantId/pricing-rules/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const parsed = ruleInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid pricing rule", issues: parsed.error.issues });
    return;
  }
  const update = inputToRow(restaurantId, parsed.data, req.user?.sub);
  const [row] = await db
    .update(pricingRulesTable)
    .set({ ...update, updatedAt: new Date() })
    .where(and(eq(pricingRulesTable.id, id), eq(pricingRulesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Pricing rule not found" });
    return;
  }
  invalidatePricingRulesCache();
  await recordAuditLog({
    req,
    module: "pricing_rules",
    action: "update",
    entity: "pricing_rule",
    entityId: row.id,
    restaurantId,
    newValue: { name: row.name, ruleType: row.ruleType },
  }).catch(() => {});
  res.json(row);
});

router.patch("/restaurants/:restaurantId/pricing-rules/:id/toggle", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const isActive = Boolean(req.body?.isActive);
  const [row] = await db
    .update(pricingRulesTable)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(pricingRulesTable.id, id), eq(pricingRulesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Pricing rule not found" });
    return;
  }
  invalidatePricingRulesCache();
  res.json(row);
});

router.delete("/restaurants/:restaurantId/pricing-rules/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const result = await db
    .delete(pricingRulesTable)
    .where(and(eq(pricingRulesTable.id, id), eq(pricingRulesTable.restaurantId, restaurantId)))
    .returning();
  if (result.length === 0) {
    res.status(404).json({ error: "Pricing rule not found" });
    return;
  }
  invalidatePricingRulesCache();
  await recordAuditLog({
    req,
    module: "pricing_rules",
    action: "delete",
    entity: "pricing_rule",
    entityId: id,
    restaurantId,
  }).catch(() => {});
  res.status(204).end();
});

// Simulate the price for an item under a chosen context.
router.post("/restaurants/:restaurantId/pricing-rules/simulate", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const body = z
    .object({
      menuItemId: z.number().int().positive(),
      branchId: z.number().int().positive().nullish(),
      channel: z.enum(["dine_in", "takeaway", "delivery"]).nullish(),
      customerId: z.number().int().positive().nullish(),
      at: z.string().datetime().nullish(),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid simulate payload", issues: body.error.issues });
    return;
  }
  const [item] = await db
    .select({ id: menuItemsTable.id, name: menuItemsTable.name, price: menuItemsTable.price, categoryId: menuItemsTable.categoryId })
    .from(menuItemsTable)
    .where(and(eq(menuItemsTable.id, body.data.menuItemId), eq(menuItemsTable.restaurantId, restaurantId)));
  if (!item) {
    res.status(404).json({ error: "Menu item not found" });
    return;
  }
  const result = await resolveItemPrice({
    item: { id: item.id, price: item.price, categoryId: item.categoryId },
    restaurantId,
    branchId: body.data.branchId ?? null,
    channel: body.data.channel ?? null,
    customerId: body.data.customerId ?? null,
    at: body.data.at ? new Date(body.data.at) : new Date(),
  });
  res.json({
    menuItem: { id: item.id, name: item.name, price: item.price },
    originalPrice: result.originalPrice,
    unitPrice: result.unitPrice,
    appliedRule: result.appliedRule
      ? { id: result.appliedRule.id, name: result.appliedRule.name, ruleType: result.appliedRule.ruleType, adjustmentKind: result.appliedRule.adjustmentKind, adjustmentValue: result.appliedRule.adjustmentValue }
      : null,
  });
});

router.get("/restaurants/:restaurantId/pricing-rules/calendar/view", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const fromStr = String(req.query.from ?? "");
  const toStr = String(req.query.to ?? "");
  const from = fromStr ? new Date(fromStr) : new Date();
  const to = toStr ? new Date(toStr) : new Date(Date.now() + 7 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    res.status(400).json({ error: "Invalid from/to" });
    return;
  }
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const channel = req.query.channel ? String(req.query.channel) : null;
  const slots = await buildPricingCalendar({ restaurantId, branchId, channel, from, to });
  // Conflict detection: any slot with two or more rules is flagged.
  const flagged = slots.map((s) => ({
    ...s,
    conflict: s.rules.length > 1 && new Set(s.rules.map((r) => r.priority)).size < s.rules.length,
  }));
  res.json({ from: from.toISOString(), to: to.toISOString(), slots: flagged });
});

export default router;

// Re-export so tests can import via the routes module path if desired.
export type { PricingRule };
