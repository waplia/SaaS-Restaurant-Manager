/**
 * Dynamic pricing engine.
 *
 * `resolveItemPrice` picks the highest-priority matching rule for a given
 * menu item / context and returns the unit price to use plus a snapshot of
 * the rule that was applied. The same engine handles happy hour, lunch
 * special, weekend, delivery-only (channel), outlet-specific, customer
 * group / VIP / loyalty tier targeting, and event/date-range rules — they
 * are all configurations of the same row in `pricing_rules`.
 *
 * Tie-breaking, per the spec:
 *   1. Higher `priority` wins.
 *   2. On equal priority, the more specific scope wins:
 *        item (2) > category (1) > all (0).
 *   3. On equal priority + specificity, `fixed_price` beats other kinds.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  pricingRulesTable,
  menuItemsTable,
  customersTable,
  type PricingRule,
} from "./db";

export type Channel = "dine_in" | "takeaway" | "delivery";

export interface ResolveContext {
  restaurantId: number;
  branchId?: number | null;
  channel?: Channel | string | null;
  customerId?: number | null;
  at?: Date;
}

export interface ResolveResult {
  unitPrice: number;
  originalPrice: number;
  appliedRule: PricingRule | null;
}

interface MenuItemRef {
  id: number;
  price: number | string;
  categoryId: number | null;
}

interface CustomerSnapshot {
  isVip: boolean;
  loyaltyPoints: number;
}

const ALL_CHANNELS: Channel[] = ["dine_in", "takeaway", "delivery"];

// Loyalty tier mapping mirrors the loyalty config used elsewhere — kept
// simple here to avoid a circular dependency on the loyalty service.
function pickLoyaltyTier(points: number): "loyalty_silver" | "loyalty_gold" | "loyalty_platinum" | null {
  if (points >= 5000) return "loyalty_platinum";
  if (points >= 1500) return "loyalty_gold";
  if (points >= 500) return "loyalty_silver";
  return null;
}

function customerGroupsFor(snapshot: CustomerSnapshot | null): string[] {
  if (!snapshot) return ["guest"];
  const groups: string[] = ["regular"];
  if (snapshot.isVip) groups.push("vip");
  const tier = pickLoyaltyTier(snapshot.loyaltyPoints);
  if (tier) groups.push(tier);
  return groups;
}

function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map((p) => Number(p));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function withinTimeWindow(start: string | null, end: string | null, at: Date): boolean {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s == null && e == null) return true;
  const cur = minutesOfDay(at);
  if (s != null && e != null) {
    if (s <= e) return cur >= s && cur < e;
    // crosses midnight
    return cur >= s || cur < e;
  }
  if (s != null) return cur >= s;
  if (e != null) return cur < e;
  return true;
}

function withinDateWindow(start: Date | null, end: Date | null, at: Date): boolean {
  if (start && at < start) return false;
  if (end && at > end) return false;
  return true;
}

export function ruleMatches(
  rule: PricingRule,
  ctx: {
    item: MenuItemRef;
    branchId?: number | null;
    channel?: string | null;
    customerGroups: string[];
    at: Date;
  },
): boolean {
  if (!rule.isActive) return false;
  if (!withinDateWindow(rule.startDate, rule.endDate, ctx.at)) return false;

  const dows = rule.daysOfWeek ?? [];
  if (dows.length > 0 && !dows.includes(ctx.at.getDay())) return false;

  if (!withinTimeWindow(rule.startTime ?? null, rule.endTime ?? null, ctx.at)) return false;

  const channels = rule.channels ?? [];
  if (channels.length > 0) {
    if (!ctx.channel || !channels.includes(ctx.channel)) return false;
  }

  const branchIds = rule.branchIds ?? [];
  if (branchIds.length > 0) {
    if (ctx.branchId == null || !branchIds.includes(ctx.branchId)) return false;
  }

  const groups = rule.customerGroups ?? [];
  if (groups.length > 0) {
    if (!groups.some((g) => ctx.customerGroups.includes(g))) return false;
  }

  const ids = rule.scopeIds ?? [];
  switch (rule.scopeKind) {
    case "all":
      return true;
    case "category":
      return ctx.item.categoryId != null && ids.includes(ctx.item.categoryId);
    case "item":
      return ids.includes(ctx.item.id);
    default:
      return false;
  }
}

function specificity(rule: PricingRule): number {
  if (rule.scopeKind === "item") return 2;
  if (rule.scopeKind === "category") return 1;
  return 0;
}

function adjustmentRank(rule: PricingRule): number {
  return rule.adjustmentKind === "fixed_price" ? 1 : 0;
}

export function pickRule(rules: PricingRule[]): PricingRule | null {
  if (rules.length === 0) return null;
  return rules
    .slice()
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const sa = specificity(a);
      const sb = specificity(b);
      if (sb !== sa) return sb - sa;
      const aa = adjustmentRank(a);
      const ab = adjustmentRank(b);
      if (ab !== aa) return ab - aa;
      return b.id - a.id;
    })[0];
}

export function applyAdjustment(originalPrice: number, rule: PricingRule): number {
  const v = Number(rule.adjustmentValue);
  let next = originalPrice;
  switch (rule.adjustmentKind) {
    case "percent_off":
      next = originalPrice * (1 - v / 100);
      break;
    case "percent_up":
      next = originalPrice * (1 + v / 100);
      break;
    case "flat_off":
      next = originalPrice - v;
      break;
    case "fixed_price":
      next = v;
      break;
  }
  if (!Number.isFinite(next) || next < 0) next = 0;
  return Math.round(next * 100) / 100;
}

let cachedRules: { restaurantId: number; loadedAt: number; rules: PricingRule[] } | null = null;
const RULE_CACHE_TTL_MS = 5_000;

async function loadActiveRules(restaurantId: number): Promise<PricingRule[]> {
  const now = Date.now();
  if (
    cachedRules &&
    cachedRules.restaurantId === restaurantId &&
    now - cachedRules.loadedAt < RULE_CACHE_TTL_MS
  ) {
    return cachedRules.rules;
  }
  const rules = await db
    .select()
    .from(pricingRulesTable)
    .where(and(eq(pricingRulesTable.restaurantId, restaurantId), eq(pricingRulesTable.isActive, true)));
  cachedRules = { restaurantId, loadedAt: now, rules };
  return rules;
}

export function invalidatePricingRulesCache(): void {
  cachedRules = null;
}

async function loadCustomerSnapshot(customerId: number, restaurantId: number): Promise<CustomerSnapshot | null> {
  const [c] = await db
    .select({ isVip: customersTable.isVip, loyaltyPoints: customersTable.loyaltyPoints })
    .from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  return c ?? null;
}

/**
 * Resolve the unit price for an item under a given context.
 * `item.price` is treated as the original (menu) price; modifier add-ons
 * are intentionally not adjusted by pricing rules.
 */
export async function resolveItemPrice(opts: {
  item: MenuItemRef;
  restaurantId: number;
  branchId?: number | null;
  channel?: string | null;
  customerId?: number | null;
  at?: Date;
  rules?: PricingRule[];
}): Promise<ResolveResult> {
  const at = opts.at ?? new Date();
  const originalPrice = Number(opts.item.price);

  const rules = opts.rules ?? (await loadActiveRules(opts.restaurantId));
  const customerSnapshot = opts.customerId
    ? await loadCustomerSnapshot(opts.customerId, opts.restaurantId)
    : null;
  const customerGroups = customerGroupsFor(customerSnapshot);

  const matching = rules.filter((r) =>
    ruleMatches(r, {
      item: opts.item,
      branchId: opts.branchId ?? null,
      channel: opts.channel ?? null,
      customerGroups,
      at,
    }),
  );

  const chosen = pickRule(matching);
  if (!chosen) {
    return { unitPrice: originalPrice, originalPrice, appliedRule: null };
  }
  const unitPrice = applyAdjustment(originalPrice, chosen);
  return { unitPrice, originalPrice, appliedRule: chosen };
}

/**
 * Helper used by the order pipeline: given a full menuItem row, return both
 * the unit price (rule-adjusted base + modifier total) and a snapshot of
 * the rule that was applied (if any). Modifier prices are not touched.
 */
export async function resolveOrderItemUnitPrice(opts: {
  menuItem: { id: number; price: string | number; categoryId: number | null };
  restaurantId: number;
  branchId?: number | null;
  channel?: string | null;
  customerId?: number | null;
  modifierTotal: number;
  at?: Date;
  rules?: PricingRule[];
}): Promise<{
  unitPrice: number;
  originalPrice: number;
  appliedRule: PricingRule | null;
}> {
  const result = await resolveItemPrice({
    item: { id: opts.menuItem.id, price: opts.menuItem.price, categoryId: opts.menuItem.categoryId },
    restaurantId: opts.restaurantId,
    branchId: opts.branchId,
    channel: opts.channel,
    customerId: opts.customerId,
    at: opts.at,
    rules: opts.rules,
  });
  return {
    unitPrice: Math.round((result.unitPrice + opts.modifierTotal) * 100) / 100,
    originalPrice: Math.round((result.originalPrice + opts.modifierTotal) * 100) / 100,
    appliedRule: result.appliedRule,
  };
}

/**
 * Build a calendar of active rules across a date range, broken into hourly
 * slots. Used by the owner-facing "Pricing Calendar" view.
 */
export async function buildPricingCalendar(opts: {
  restaurantId: number;
  branchId?: number | null;
  channel?: string | null;
  from: Date;
  to: Date;
}): Promise<Array<{ date: string; hour: number; rules: Array<{ id: number; name: string; ruleType: string; priority: number }> }>> {
  const rules = await loadActiveRules(opts.restaurantId);
  const slots: Array<{ date: string; hour: number; rules: Array<{ id: number; name: string; ruleType: string; priority: number }> }> = [];
  const cursor = new Date(opts.from);
  cursor.setMinutes(0, 0, 0);
  const end = new Date(opts.to);
  while (cursor <= end) {
    const at = new Date(cursor);
    const customerGroups = ["guest", "regular", "vip", "loyalty_silver", "loyalty_gold", "loyalty_platinum"];
    const matching = rules.filter((r) =>
      ruleMatches(r, {
        item: { id: -1, price: 0, categoryId: -1 },
        branchId: opts.branchId ?? null,
        channel: opts.channel ?? null,
        customerGroups,
        at,
      }) ||
      // Allow any rule whose time/date/channel/branch matches even when
      // scope is item/category — for the calendar overview we want to
      // surface all rules active in the slot.
      ruleMatchesSlot(r, { branchId: opts.branchId ?? null, channel: opts.channel ?? null, at }),
    );
    const seen = new Set<number>();
    const dedup = matching.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    slots.push({
      date: at.toISOString().slice(0, 10),
      hour: at.getHours(),
      rules: dedup.map((r) => ({ id: r.id, name: r.name, ruleType: r.ruleType, priority: r.priority })),
    });
    cursor.setHours(cursor.getHours() + 1);
  }
  return slots;
}

function ruleMatchesSlot(rule: PricingRule, ctx: { branchId: number | null; channel: string | null; at: Date }): boolean {
  if (!rule.isActive) return false;
  if (!withinDateWindow(rule.startDate, rule.endDate, ctx.at)) return false;
  const dows = rule.daysOfWeek ?? [];
  if (dows.length > 0 && !dows.includes(ctx.at.getDay())) return false;
  if (!withinTimeWindow(rule.startTime ?? null, rule.endTime ?? null, ctx.at)) return false;
  const channels = rule.channels ?? [];
  if (channels.length > 0 && (!ctx.channel || !channels.includes(ctx.channel))) return false;
  const branchIds = rule.branchIds ?? [];
  if (branchIds.length > 0 && (ctx.branchId == null || !branchIds.includes(ctx.branchId))) return false;
  return true;
}

export const __testing = { customerGroupsFor, withinTimeWindow, withinDateWindow, pickLoyaltyTier };

export const ALL_CHANNELS_LIST = ALL_CHANNELS;
