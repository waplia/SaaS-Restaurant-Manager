import { Router } from "express";
import { and, eq, desc, sql, gte, isNull, or, inArray } from "drizzle-orm";
import {
  db,
  customerGeoPointsTable,
  festivalEventsTable,
  offerConflictChecksTable,
  marginFloorsTable,
  upsellScriptEventsTable,
  takeawayQueueTicketsTable,
  preorderSlotsTable,
  preorderBookingsTable,
  deliveryZonesTable,
  deliveryZoneMetricsTable,
  tableMetricsSnapshotsTable,
  tipSplitRulesTable,
  tipPoolsTable,
  tipPoolEntriesTable,
  tipAdjustmentsTable,
  cashTipDeclarationsTable,
  paymentsTable,
  leaderboardSnapshotsTable,
  couponsTable,
  pricingRulesTable,
  menuItemsTable,
  ordersTable,
  deliveryAssignmentsTable,
  floorTablesTable,
  usersTable,
  campaignsTable,
  payrollRunsTable,
  payrollItemsTable,
  restaurantsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { recordAuditLog } from "../lib/audit";
import { sendWhatsApp, sendSms } from "../lib/notifications";
import { logger } from "../lib/logger";

const router = Router();

const BASE = "/restaurants/:restaurantId/advanced-growth";

// All advanced-growth endpoints require tenant validation. Per-route role
// requirements are applied below since some features (upsell, queue,
// pre-order) are used by waiter/cashier staff during service.
router.use(BASE, validateRestaurantAccess);

const MANAGER_ROLES = ["owner", "manager", "super_admin"] as const;
const SERVICE_ROLES = ["owner", "manager", "super_admin", "waiter", "cashier"] as const;

function rid(req: any): number { return Number(req.params.restaurantId); }

// =================== 1. LOCAL AREA MARKETING MAP ===================
router.get(`${BASE}/geo-points`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_local_map"), async (req, res) => {
  const rows = await db.select().from(customerGeoPointsTable).where(eq(customerGeoPointsTable.restaurantId, rid(req)));
  res.json({ items: rows });
});

// Aggregate geo points into ~1km cells to power heat-map overlays without
// shipping raw customer coordinates to the browser.
router.get(`${BASE}/geo-points/areas`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_local_map"), async (req, res) => {
  const rows = await db.select({
    cellLat: sql<string>`ROUND(${customerGeoPointsTable.lat}::numeric, 2)`,
    cellLng: sql<string>`ROUND(${customerGeoPointsTable.lng}::numeric, 2)`,
    count: sql<number>`COUNT(*)::int`,
  }).from(customerGeoPointsTable)
    .where(eq(customerGeoPointsTable.restaurantId, rid(req)))
    .groupBy(sql`ROUND(${customerGeoPointsTable.lat}::numeric, 2)`, sql`ROUND(${customerGeoPointsTable.lng}::numeric, 2)`)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(500);
  res.json({ areas: rows.map(r => ({ lat: Number(r.cellLat), lng: Number(r.cellLng), count: Number(r.count) })) });
});

// Export the customer IDs inside a given lat/lng bounding box, so the
// operator can target a campaign at a hot zone identified on the map.
router.post(`${BASE}/geo-points/export-segment`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_local_map"), async (req, res) => {
  const { minLat, maxLat, minLng, maxLng } = req.body ?? {};
  if ([minLat, maxLat, minLng, maxLng].some(v => v == null)) { res.status(400).json({ error: "minLat/maxLat/minLng/maxLng required" }); return; }
  const rows = await db.select({
    customerId: customerGeoPointsTable.customerId,
    lat: customerGeoPointsTable.lat,
    lng: customerGeoPointsTable.lng,
  }).from(customerGeoPointsTable)
    .where(and(
      eq(customerGeoPointsTable.restaurantId, rid(req)),
      gte(customerGeoPointsTable.lat, String(minLat)),
      sql`${customerGeoPointsTable.lat} <= ${String(maxLat)}`,
      gte(customerGeoPointsTable.lng, String(minLng)),
      sql`${customerGeoPointsTable.lng} <= ${String(maxLng)}`,
    ));
  const customerIds = Array.from(new Set(rows.map(r => r.customerId).filter((id): id is number => id != null)));
  await recordAuditLog({ req, module: "advanced_growth", action: "local_map.segment.export", entity: "customer_geo_point", restaurantId: rid(req), newValue: { customerCount: customerIds.length } });
  res.json({ customerIds, count: customerIds.length, sample: rows.slice(0, 50) });
});

router.post(`${BASE}/geo-points`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_local_map"), async (req, res) => {
  const { customerId, label, lat, lng, source } = req.body ?? {};
  if (lat == null || lng == null) { res.status(400).json({ error: "lat/lng required" }); return; }
  const [row] = await db.insert(customerGeoPointsTable).values({
    restaurantId: rid(req), customerId: customerId ?? null, label: label ?? null,
    lat: String(lat), lng: String(lng), source: source ?? "manual",
  }).returning();
  await recordAuditLog({ req, module: "advanced_growth", action: "local_map.point.create", entity: "customer_geo_point", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.status(201).json(row);
});

router.delete(`${BASE}/geo-points/:id`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_local_map"), async (req, res) => {
  const id = Number(req.params.id);
  const [old] = await db.select().from(customerGeoPointsTable).where(and(eq(customerGeoPointsTable.id, id), eq(customerGeoPointsTable.restaurantId, rid(req))));
  if (!old) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(customerGeoPointsTable).where(eq(customerGeoPointsTable.id, id));
  await recordAuditLog({ req, module: "advanced_growth", action: "local_map.point.delete", entity: "customer_geo_point", entityId: id, restaurantId: rid(req), oldValue: old });
  res.json({ ok: true });
});

// =================== 2. FESTIVAL CALENDAR ===================
// Seeded calendar of major Indian festivals + sporting events for the next
// 12 months. Inserted as global rows (restaurantId=null) so every tenant
// sees them by default; tenants can still dismiss or add their own.
const SEED_FESTIVALS: Array<{ name: string; eventDate: string; category: string; suggestedCampaign: string }> = [
  { name: "New Year's Day", eventDate: "2026-01-01", category: "holiday", suggestedCampaign: "Start the year with a special breakfast combo" },
  { name: "Pongal / Makar Sankranti", eventDate: "2026-01-14", category: "festival", suggestedCampaign: "Sweet & savoury Pongal thali special" },
  { name: "Republic Day", eventDate: "2026-01-26", category: "holiday", suggestedCampaign: "Tricolour dessert and family meal offer" },
  { name: "Valentine's Day", eventDate: "2026-02-14", category: "occasion", suggestedCampaign: "Couples' dinner with complimentary dessert" },
  { name: "Maha Shivratri", eventDate: "2026-02-15", category: "festival", suggestedCampaign: "Special fasting / vrat thali menu" },
  { name: "Holi", eventDate: "2026-03-04", category: "festival", suggestedCampaign: "Festive Holi gujiya + thandai combo" },
  { name: "Ugadi / Gudi Padwa", eventDate: "2026-03-19", category: "festival", suggestedCampaign: "New-year regional thali special" },
  { name: "Ram Navami", eventDate: "2026-03-27", category: "festival", suggestedCampaign: "Satvik thali + panakam special" },
  { name: "Eid ul-Fitr", eventDate: "2026-03-21", category: "festival", suggestedCampaign: "Iftar / Eid biryani & sheer khurma combo" },
  { name: "Good Friday", eventDate: "2026-04-03", category: "holiday", suggestedCampaign: "Family lunch combo" },
  { name: "Tamil New Year / Vishu / Baisakhi", eventDate: "2026-04-14", category: "festival", suggestedCampaign: "Regional new-year thali special" },
  { name: "IPL Final", eventDate: "2026-05-29", category: "sport", suggestedCampaign: "Match-night snack platters & beverage combos" },
  { name: "Independence Day", eventDate: "2026-08-15", category: "holiday", suggestedCampaign: "Tricolour celebration menu" },
  { name: "Raksha Bandhan", eventDate: "2026-08-28", category: "festival", suggestedCampaign: "Sibling combo meal + complimentary sweet" },
  { name: "Janmashtami", eventDate: "2026-09-04", category: "festival", suggestedCampaign: "56-bhog inspired vrat menu" },
  { name: "Ganesh Chaturthi", eventDate: "2026-09-14", category: "festival", suggestedCampaign: "Modak & festive Maharashtrian thali" },
  { name: "Navratri (Day 1)", eventDate: "2026-10-12", category: "festival", suggestedCampaign: "9-day vrat / fasting thali rotation" },
  { name: "Dussehra", eventDate: "2026-10-20", category: "festival", suggestedCampaign: "Festive family dinner special" },
  { name: "Karwa Chauth", eventDate: "2026-10-30", category: "festival", suggestedCampaign: "Sargi breakfast & post-fast dinner combos" },
  { name: "Diwali", eventDate: "2026-11-08", category: "festival", suggestedCampaign: "Diwali family thali + sweets hamper" },
  { name: "Bhai Dooj", eventDate: "2026-11-11", category: "festival", suggestedCampaign: "Sibling combo with festive sweet" },
  { name: "Children's Day", eventDate: "2026-11-14", category: "occasion", suggestedCampaign: "Kids-eat-free family promo" },
  { name: "Christmas", eventDate: "2026-12-25", category: "holiday", suggestedCampaign: "Christmas dinner set menu" },
  { name: "New Year's Eve", eventDate: "2026-12-31", category: "occasion", suggestedCampaign: "NYE prix-fixe & pre-booking offer" },
];

export async function seedDefaultFestivals(): Promise<{ inserted: number }> {
  let inserted = 0;
  for (const f of SEED_FESTIVALS) {
    const existing = await db.select({ id: festivalEventsTable.id }).from(festivalEventsTable)
      .where(and(isNull(festivalEventsTable.restaurantId), eq(festivalEventsTable.name, f.name), eq(festivalEventsTable.eventDate, f.eventDate)));
    if (existing.length > 0) continue;
    await db.insert(festivalEventsTable).values({
      restaurantId: null, name: f.name, eventDate: f.eventDate,
      category: f.category, suggestedCampaign: f.suggestedCampaign,
    });
    inserted++;
  }
  if (inserted > 0) logger.info({ inserted }, "Default festival calendar seeded");
  return { inserted };
}

router.get(`${BASE}/festivals`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_festival_calendar"), async (req, res) => {
  const rows = await db.select().from(festivalEventsTable)
    .where(or(eq(festivalEventsTable.restaurantId, rid(req)), isNull(festivalEventsTable.restaurantId)))
    .orderBy(festivalEventsTable.eventDate);
  res.json({ items: rows });
});

router.post(`${BASE}/festivals`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_festival_calendar"), async (req, res) => {
  const { name, eventDate, region, category, suggestedCampaign } = req.body ?? {};
  if (!name || !eventDate) { res.status(400).json({ error: "name/eventDate required" }); return; }
  const [row] = await db.insert(festivalEventsTable).values({
    restaurantId: rid(req), name, eventDate, region: region ?? null, category: category ?? null, suggestedCampaign: suggestedCampaign ?? null,
  }).returning();
  await recordAuditLog({ req, module: "advanced_growth", action: "festival.create", entity: "festival_event", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.status(201).json(row);
});

router.patch(`${BASE}/festivals/:id`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_festival_calendar"), async (req, res) => {
  const id = Number(req.params.id);
  const patch: any = {};
  if (req.body?.isDismissed != null) patch.isDismissed = Boolean(req.body.isDismissed);
  if (req.body?.suggestedCampaign != null) patch.suggestedCampaign = req.body.suggestedCampaign;
  const [row] = await db.update(festivalEventsTable).set(patch)
    .where(and(eq(festivalEventsTable.id, id), eq(festivalEventsTable.restaurantId, rid(req)))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await recordAuditLog({ req, module: "advanced_growth", action: "festival.update", entity: "festival_event", entityId: id, restaurantId: rid(req), newValue: row });
  res.json(row);
});

// Draft a marketing campaign from a festival. Writes into the existing
// `growth_campaigns` table in status="draft" so it shows up in the standard
// Growth Engine UI where the operator can finalize and send it.
router.post(`${BASE}/festivals/:id/draft-campaign`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_festival_calendar"), async (req, res) => {
  const restaurantId = rid(req);
  const id = Number(req.params.id);
  const [fest] = await db.select().from(festivalEventsTable)
    .where(and(eq(festivalEventsTable.id, id), or(eq(festivalEventsTable.restaurantId, restaurantId), isNull(festivalEventsTable.restaurantId))));
  if (!fest) { res.status(404).json({ error: "Festival not found" }); return; }
  const channel = (req.body?.channel as string) ?? "whatsapp";
  const body = fest.suggestedCampaign ?? `Celebrate ${fest.name} with us! Special menu and offers available.`;
  const scheduledAt = new Date(`${fest.eventDate}T09:00:00.000Z`);
  const [camp] = await db.insert(campaignsTable).values({
    restaurantId,
    name: `${fest.name} Campaign`,
    type: "promotion",
    channel,
    status: "draft",
    audience: { kind: "all_customers" } as any,
    content: { headline: fest.name, body } as any,
    scheduledAt,
    createdBy: (req as any).user?.sub ?? null,
  } as any).returning();
  await recordAuditLog({ req, module: "advanced_growth", action: "festival.draft_campaign", entity: "festival_event", entityId: id, restaurantId, newValue: { campaignId: camp.id } });
  res.status(201).json({ festival: fest, campaign: camp });
});

// =================== 3. OFFER CONFLICT DETECTOR ===================
// Two validity windows overlap when each window starts at or before the
// other ends. A null/undefined end is treated as "open-ended" so it
// always overlaps anything that starts after it began. A null start is
// treated as "since forever".
function windowsOverlap(
  aFrom: Date | string | null | undefined, aTo: Date | string | null | undefined,
  bFrom: Date | string | null | undefined, bTo: Date | string | null | undefined,
): boolean {
  const af = aFrom ? new Date(aFrom).getTime() : -Infinity;
  const at = aTo ? new Date(aTo).getTime() : Infinity;
  const bf = bFrom ? new Date(bFrom).getTime() : -Infinity;
  const bt = bTo ? new Date(bTo).getTime() : Infinity;
  return af <= bt && bf <= at;
}

type OfferCandidate = {
  kind?: "coupon" | "campaign" | "pricing_rule";
  code?: string; label?: string; discountType?: string; discountValue?: number;
  validFrom?: Date | string | null; validTo?: Date | string | null;
};
type Conflict = { kind: string; a: string; b: string; reason: string };

async function detectOfferConflicts(restaurantId: number, candidate?: OfferCandidate): Promise<Conflict[]> {
  const coupons = await db.select().from(couponsTable).where(eq(couponsTable.restaurantId, restaurantId)).catch(() => []);
  const rules = await db.select().from(pricingRulesTable).where(eq(pricingRulesTable.restaurantId, restaurantId)).catch(() => []);
  const conflicts: Conflict[] = [];
  const active = (coupons as any[]).filter(c => c.isActive !== false);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const sameType = a.discountType === b.discountType
        && Number(a.discountValue || 0) > 0 && Number(b.discountValue || 0) > 0;
      if (sameType && windowsOverlap(a.validFrom, a.validTo, b.validFrom, b.validTo)) {
        conflicts.push({ kind: "coupon_overlap", a: a.code ?? `#${a.id}`, b: b.code ?? `#${b.id}`, reason: "Two active coupons share a discount type and validity window — they may stack." });
      }
    }
  }
  for (const c of active) for (const r of rules as any[]) {
    if (r.isActive !== false) conflicts.push({ kind: "coupon_vs_rule", a: (c as any).code ?? `coupon#${(c as any).id}`, b: r.name ?? `rule#${r.id}`, reason: "Active pricing rule may collide with coupon discount." });
  }
  if (candidate?.code && candidate?.discountType) {
    for (const c of active as any[]) {
      const sameType = c.discountType === candidate.discountType && Number(c.discountValue || 0) > 0;
      if (sameType && windowsOverlap(candidate.validFrom, candidate.validTo, c.validFrom, c.validTo)) {
        conflicts.push({ kind: "candidate_overlap", a: candidate.code, b: c.code ?? `#${c.id}`, reason: "Proposed coupon shares a discount type and validity window with an existing active coupon." });
      }
    }
  }
  if (candidate?.kind === "campaign" && candidate.label) {
    for (const c of active as any[]) {
      if (windowsOverlap(candidate.validFrom, candidate.validTo, c.validFrom, c.validTo)) {
        conflicts.push({ kind: "campaign_vs_coupon", a: candidate.label, b: c.code ?? `#${c.id}`, reason: "Campaign window overlaps an active coupon — guests may double-dip." });
      }
    }
  }
  if (candidate?.kind === "pricing_rule" && candidate.label) {
    for (const c of active as any[]) {
      conflicts.push({ kind: "rule_vs_coupon", a: candidate.label, b: c.code ?? `#${c.id}`, reason: "New pricing rule may stack with an active coupon at checkout." });
    }
  }
  return conflicts;
}

async function persistConflictCheck(restaurantId: number, runBy: number | null, conflicts: Conflict[]): Promise<void> {
  if (conflicts.length === 0) return;
  try {
    await db.insert(offerConflictChecksTable).values({
      restaurantId, runBy,
      conflicts: conflicts as unknown as Conflict[],
      conflictCount: conflicts.length,
    });
  } catch (err) {
    // Best-effort audit persistence — never block the caller because the
    // history table is unavailable. Log so an operator can investigate.
    logger.warn({ err, restaurantId }, "[offer_conflicts] failed to persist conflict-check row");
  }
}

export { detectOfferConflicts, persistConflictCheck };
export type { OfferCandidate, Conflict };

router.post(`${BASE}/offer-conflicts/run`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_offer_conflict"), async (req, res) => {
  const restaurantId = rid(req);
  const conflicts = await detectOfferConflicts(restaurantId);
  const [row] = await db.insert(offerConflictChecksTable).values({
    restaurantId, runBy: req.user?.sub ?? null, conflicts, conflictCount: conflicts.length,
  }).returning();
  await recordAuditLog({ req, module: "advanced_growth", action: "offer_conflict.run", entity: "offer_conflict_check", entityId: row.id, restaurantId, newValue: { conflictCount: conflicts.length } });
  res.json(row);
});

// Preview endpoint — call this from coupon/campaign editors before saving
// to surface live conflict warnings to the operator.
// Exported wrapper for the coupon-save hook in customers.ts.
// Returns the list of conflicts that would arise if the given coupon were
// inserted now. Also persists a row to offer_conflict_checks for audit.
export async function detectCouponConflictsBeforeSave(input: {
  restaurantId: number; code: string; discountType?: string; validFrom?: Date | null; validTo?: Date | null;
}): Promise<Conflict[]> {
  const conflicts = await detectOfferConflicts(input.restaurantId, {
    kind: "coupon", code: input.code, discountType: input.discountType,
    validFrom: input.validFrom ?? null, validTo: input.validTo ?? null,
  });
  await persistConflictCheck(input.restaurantId, null, conflicts);
  return conflicts;
}

router.post(`${BASE}/offer-conflicts/preview`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_offer_conflict"), async (req, res) => {
  const restaurantId = rid(req);
  const conflicts = await detectOfferConflicts(restaurantId, req.body ?? {});
  res.json({ conflicts, conflictCount: conflicts.length });
});

router.get(`${BASE}/offer-conflicts`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_offer_conflict"), async (req, res) => {
  const rows = await db.select().from(offerConflictChecksTable).where(eq(offerConflictChecksTable.restaurantId, rid(req)))
    .orderBy(desc(offerConflictChecksTable.createdAt)).limit(20);
  res.json({ items: rows });
});

// =================== 4. MARGIN GUARDRAILS ===================
router.get(`${BASE}/margin-floors`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_margin_floors"), async (req, res) => {
  const rows = await db.select().from(marginFloorsTable).where(eq(marginFloorsTable.restaurantId, rid(req)));
  res.json({ items: rows });
});

router.post(`${BASE}/margin-floors`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_margin_floors"), async (req, res) => {
  const { scope, scopeId, minMarginPct, action } = req.body ?? {};
  if (minMarginPct == null) { res.status(400).json({ error: "minMarginPct required" }); return; }
  const [row] = await db.insert(marginFloorsTable).values({
    restaurantId: rid(req), scope: scope ?? "global", scopeId: scopeId ?? null,
    minMarginPct: String(minMarginPct), action: action ?? "warn",
  }).returning();
  await recordAuditLog({ req, module: "advanced_growth", action: "margin_floor.create", entity: "margin_floor", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.status(201).json(row);
});

router.patch(`${BASE}/margin-floors/:id`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_margin_floors"), async (req, res) => {
  const id = Number(req.params.id);
  const patch: any = { updatedAt: new Date() };
  for (const k of ["scope", "scopeId", "minMarginPct", "action", "isActive"]) if (req.body?.[k] !== undefined) patch[k] = k === "minMarginPct" ? String(req.body[k]) : req.body[k];
  const [row] = await db.update(marginFloorsTable).set(patch)
    .where(and(eq(marginFloorsTable.id, id), eq(marginFloorsTable.restaurantId, rid(req)))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await recordAuditLog({ req, module: "advanced_growth", action: "margin_floor.update", entity: "margin_floor", entityId: id, restaurantId: rid(req), newValue: row });
  res.json(row);
});

router.delete(`${BASE}/margin-floors/:id`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_margin_floors"), async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(marginFloorsTable).where(and(eq(marginFloorsTable.id, id), eq(marginFloorsTable.restaurantId, rid(req))));
  await recordAuditLog({ req, module: "advanced_growth", action: "margin_floor.delete", entity: "margin_floor", entityId: id, restaurantId: rid(req) });
  res.json({ ok: true });
});

// Audit-log helper used by the coupon validate path when a manager
// overrides a blocked margin-floor violation. Records the override with
// the supplied reason so finance can review later.
export async function recordMarginOverrideAudit(input: {
  req: any; restaurantId: number; code: string; orderAmount: number;
  discountedAmount: number; floorPct: number; effectivePct: number; reason: string;
}): Promise<void> {
  await recordAuditLog({
    req: input.req, module: "advanced_growth", action: "margin_floor.override",
    entity: "coupon", restaurantId: input.restaurantId,
    details: `Override on coupon ${input.code} — reason: ${input.reason.slice(0, 200)}`,
    newValue: {
      code: input.code, orderAmount: input.orderAmount, discountedAmount: input.discountedAmount,
      floorPct: input.floorPct, effectivePct: input.effectivePct, reason: input.reason,
    },
  });
}

// Shared checkout-time enforcement used by the coupon validate path in
// customers.ts. Evaluates the discounted-order margin against the most
// restrictive active global floor and returns a violation when it falls
// below the threshold.
export async function enforceMarginFloorAtCheckout(input: {
  restaurantId: number; orderAmount: number; discountedAmount: number;
}): Promise<{ violates: boolean; floorPct: number; effectivePct: number }> {
  const { restaurantId, orderAmount, discountedAmount } = input;
  if (orderAmount <= 0) return { violates: false, floorPct: 0, effectivePct: 0 };
  // Effective post-discount "margin" approximated as the share of original
  // price kept by the restaurant after applying the discount. This is the
  // operational signal owners care about most: how much of the bill am I
  // throwing away to this promotion?
  const effectivePct = (discountedAmount / orderAmount) * 100;
  const floors = await db.select().from(marginFloorsTable)
    .where(and(eq(marginFloorsTable.restaurantId, restaurantId), eq(marginFloorsTable.isActive, true), eq(marginFloorsTable.scope, "global")));
  if (floors.length === 0) return { violates: false, floorPct: 0, effectivePct };
  const strictest = floors
    .filter((f: any) => f.action === "block")
    .reduce<number>((max, f: any) => Math.max(max, Number(f.minMarginPct)), 0);
  if (strictest <= 0) return { violates: false, floorPct: 0, effectivePct };
  return { violates: effectivePct < strictest, floorPct: strictest, effectivePct };
}

// Check a candidate menu item / price against active margin floors. Editors
// call this before save to enforce the guardrail (warn vs block decided by
// floor's `action` field).
router.post(`${BASE}/margin-floors/check`, requireRole(...MANAGER_ROLES), requirePlanFeature("mkt_margin_floors"), async (req, res) => {
  const restaurantId = rid(req);
  const { menuItemId, price, cost } = req.body ?? {};
  if (price == null) { res.status(400).json({ error: "price required" }); return; }
  let resolvedCost = cost != null ? Number(cost) : null;
  let categoryId: number | null = null;
  if (menuItemId) {
    const [item] = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.id, Number(menuItemId)), eq(menuItemsTable.restaurantId, restaurantId)));
    if (item) {
      categoryId = (item as any).categoryId ?? null;
      if (resolvedCost == null && (item as any).costPrice != null) resolvedCost = Number((item as any).costPrice);
    }
  }
  if (resolvedCost == null || resolvedCost <= 0) {
    res.json({ ok: true, marginPct: null, violations: [], warnings: [{ reason: "No cost on file — cannot compute margin." }] });
    return;
  }
  const sellPrice = Number(price);
  const marginPct = sellPrice > 0 ? ((sellPrice - resolvedCost) / sellPrice) * 100 : 0;
  const floors = await db.select().from(marginFloorsTable)
    .where(and(eq(marginFloorsTable.restaurantId, restaurantId), eq(marginFloorsTable.isActive, true)));
  const violations: Array<{ floorId: number; scope: string; minMarginPct: number; action: string }> = [];
  for (const f of floors) {
    const applies =
      f.scope === "global" ||
      (f.scope === "menu_item" && menuItemId && f.scopeId === Number(menuItemId)) ||
      (f.scope === "category" && categoryId && f.scopeId === categoryId);
    if (!applies) continue;
    if (marginPct < Number(f.minMarginPct)) {
      violations.push({ floorId: f.id, scope: f.scope, minMarginPct: Number(f.minMarginPct), action: f.action });
    }
  }
  const blocks = violations.some(v => v.action === "block");
  res.json({ ok: !blocks, marginPct: Number(marginPct.toFixed(2)), violations });
});

// =================== 5. SMART UPSELL SCRIPT ===================
router.get(`${BASE}/upsell-scripts`, requireRole(...SERVICE_ROLES), requirePlanFeature("mkt_upsell_pro"), async (req, res) => {
  // Static script catalogue; usage tracked in upsell_script_events
  const scripts = [
    { key: "drink_pairing", title: "Drink pairing", line: "Would you like a chilled drink to go with your meal? Our fresh lime soda pairs really well." },
    { key: "dessert_finish", title: "Dessert finish", line: "Save room for something sweet — our gulab jamun is a guest favourite tonight." },
    { key: "starter_addon", title: "Starter add-on", line: "While the main is being prepared, would you like to try a quick starter?" },
    { key: "combo_upgrade", title: "Combo upgrade", line: "For just ₹50 more you can make it a combo with fries and a drink." },
    { key: "premium_swap", title: "Premium swap", line: "We have a chef's special version of that — would you like to try it today?" },
  ];
  const stats = await db.select({
    scriptKey: upsellScriptEventsTable.scriptKey,
    accepted: sql<number>`SUM(CASE WHEN ${upsellScriptEventsTable.outcome} = 'accepted' THEN 1 ELSE 0 END)`,
    total: sql<number>`COUNT(*)`,
    revenue: sql<string>`COALESCE(SUM(${upsellScriptEventsTable.amountRupees}), 0)`,
  }).from(upsellScriptEventsTable).where(eq(upsellScriptEventsTable.restaurantId, rid(req))).groupBy(upsellScriptEventsTable.scriptKey);
  const byKey = Object.fromEntries(stats.map(s => [s.scriptKey, s]));
  res.json({ scripts: scripts.map(s => ({ ...s, stats: byKey[s.key] ?? { accepted: 0, total: 0, revenue: "0" } })) });
});

router.post(`${BASE}/upsell-events`, requireRole(...SERVICE_ROLES), requirePlanFeature("mkt_upsell_pro"), async (req, res) => {
  const { scriptKey, outcome, orderId, suggestedItem, amountRupees } = req.body ?? {};
  if (!scriptKey || !outcome) { res.status(400).json({ error: "scriptKey/outcome required" }); return; }
  const [row] = await db.insert(upsellScriptEventsTable).values({
    restaurantId: rid(req), waiterUserId: (req as any).user?.sub ?? null,
    orderId: orderId ?? null, scriptKey, suggestedItem: suggestedItem ?? null, outcome,
    amountRupees: amountRupees != null ? String(amountRupees) : "0.00",
  }).returning();
  await recordAuditLog({ req, module: "advanced_growth", action: "upsell.event", entity: "upsell_script_event", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.status(201).json(row);
});

// =================== 6. QUEUE MANAGEMENT (TAKEAWAY) ===================
router.get(`${BASE}/queue`, requireRole(...SERVICE_ROLES), requirePlanFeature("dlv_queue_manager"), async (req, res) => {
  const rows = await db.select().from(takeawayQueueTicketsTable)
    .where(eq(takeawayQueueTicketsTable.restaurantId, rid(req)))
    .orderBy(desc(takeawayQueueTicketsTable.createdAt)).limit(100);
  res.json({ items: rows });
});

router.post(`${BASE}/queue`, requireRole(...SERVICE_ROLES), requirePlanFeature("dlv_queue_manager"), async (req, res) => {
  const { customerName, phone, partySize, estimatedMinutes, notes } = req.body ?? {};
  if (!customerName) { res.status(400).json({ error: "customerName required" }); return; }
  const restaurantId = rid(req);
  // Allocate the next per-day ticket number atomically. We take a Postgres
  // transactional advisory lock keyed by (restaurantId, today) so two
  // concurrent inserts cannot read the same MAX() and produce duplicate
  // ticket numbers. Lock is released automatically when the tx commits.
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${restaurantId}, EXTRACT(DOY FROM CURRENT_DATE)::int)`);
    const [maxRow] = await tx.select({ m: sql<number>`COALESCE(MAX(${takeawayQueueTicketsTable.ticketNumber}), 0)` })
      .from(takeawayQueueTicketsTable)
      .where(and(eq(takeawayQueueTicketsTable.restaurantId, restaurantId), sql`DATE(${takeawayQueueTicketsTable.createdAt}) = CURRENT_DATE`));
    const nextNum = Number(maxRow?.m ?? 0) + 1;
    const [inserted] = await tx.insert(takeawayQueueTicketsTable).values({
      restaurantId, customerName, phone: phone ?? null, partySize: partySize ?? 1,
      ticketNumber: nextNum, estimatedMinutes: estimatedMinutes ?? 15, notes: notes ?? null,
    }).returning();
    return inserted;
  });
  await recordAuditLog({ req, module: "advanced_growth", action: "queue.ticket.create", entity: "takeaway_queue_ticket", entityId: row.id, restaurantId, newValue: row });
  res.status(201).json(row);
});

router.patch(`${BASE}/queue/:id`, requireRole(...SERVICE_ROLES), requirePlanFeature("dlv_queue_manager"), async (req, res) => {
  const id = Number(req.params.id);
  const patch: any = { updatedAt: new Date() };
  const status = req.body?.status;
  if (status) {
    patch.status = status;
    if (status === "notified" || status === "ready") patch.notifiedAt = new Date();
    if (status === "fulfilled") patch.fulfilledAt = new Date();
    if (status === "cancelled") patch.cancelledAt = new Date();
  }
  if (req.body?.estimatedMinutes != null) patch.estimatedMinutes = Number(req.body.estimatedMinutes);
  const [row] = await db.update(takeawayQueueTicketsTable).set(patch)
    .where(and(eq(takeawayQueueTicketsTable.id, id), eq(takeawayQueueTicketsTable.restaurantId, rid(req)))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  // Fire WhatsApp + SMS notification when ticket transitions to ready/notified
  if ((status === "notified" || status === "ready") && row.phone) {
    const body = `Hi ${row.customerName}, your takeaway order #${row.ticketNumber} is ready for pickup. Thank you!`;
    Promise.allSettled([
      sendWhatsApp({ to: row.phone, body }),
      sendSms({ to: row.phone, body }),
    ]).then(results => {
      for (const r of results) if (r.status === "rejected") logger.warn({ err: r.reason }, "[queue] notification failed");
    });
  }
  await recordAuditLog({ req, module: "advanced_growth", action: "queue.ticket.update", entity: "takeaway_queue_ticket", entityId: id, restaurantId: rid(req), newValue: row });
  res.json(row);
});

// =================== 7. PRE-ORDER SCHEDULING ===================
router.get(`${BASE}/preorder-slots`, requireRole(...SERVICE_ROLES), requirePlanFeature("dlv_pre_order"), async (req, res) => {
  const from = req.query.from as string | undefined;
  const where = from
    ? and(eq(preorderSlotsTable.restaurantId, rid(req)), gte(preorderSlotsTable.slotDate, from))
    : eq(preorderSlotsTable.restaurantId, rid(req));
  const rows = await db.select().from(preorderSlotsTable).where(where).orderBy(preorderSlotsTable.slotDate, preorderSlotsTable.startMinutes);
  const bookings = await db.select({ slotId: preorderBookingsTable.slotId, c: sql<number>`COUNT(*)::int` })
    .from(preorderBookingsTable)
    .where(and(eq(preorderBookingsTable.restaurantId, rid(req)), sql`${preorderBookingsTable.status} <> 'cancelled'`))
    .groupBy(preorderBookingsTable.slotId);
  const bk = Object.fromEntries(bookings.map(b => [b.slotId, Number(b.c)]));
  res.json({ items: rows.map(r => ({ ...r, bookedCount: bk[r.id] ?? 0 })) });
});

router.post(`${BASE}/preorder-slots`, requireRole(...MANAGER_ROLES), requirePlanFeature("dlv_pre_order"), async (req, res) => {
  const { slotDate, startMinutes, endMinutes, capacity } = req.body ?? {};
  if (!slotDate || startMinutes == null || endMinutes == null) { res.status(400).json({ error: "slotDate/startMinutes/endMinutes required" }); return; }
  const [row] = await db.insert(preorderSlotsTable).values({
    restaurantId: rid(req), slotDate, startMinutes: Number(startMinutes), endMinutes: Number(endMinutes), capacity: capacity ?? 10,
  }).returning();
  await recordAuditLog({ req, module: "advanced_growth", action: "preorder.slot.create", entity: "preorder_slot", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.status(201).json(row);
});

router.post(`${BASE}/preorder-bookings`, requireRole(...SERVICE_ROLES), requirePlanFeature("dlv_pre_order"), async (req, res) => {
  const { slotId, customerName, phone, notes } = req.body ?? {};
  if (!slotId || !customerName) { res.status(400).json({ error: "slotId/customerName required" }); return; }
  // Lock the slot row inside a transaction and count active (non-cancelled)
  // bookings while holding the lock so concurrent requests cannot oversell
  // capacity. Returns a discriminated outcome so we can map to HTTP after
  // the tx commits.
  const restaurantId = rid(req);
  type Outcome =
    | { kind: "missing" }
    | { kind: "full" }
    | { kind: "ok"; row: typeof preorderBookingsTable.$inferSelect };
  const outcome: Outcome = await db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`SELECT id, capacity FROM ${preorderSlotsTable}
          WHERE id = ${Number(slotId)} AND restaurant_id = ${restaurantId}
          FOR UPDATE`,
    );
    const rows = (locked as unknown as { rows?: Array<{ id: number; capacity: number }> }).rows
      ?? (locked as unknown as Array<{ id: number; capacity: number }>);
    const slotRow = Array.isArray(rows) ? rows[0] : undefined;
    if (!slotRow) return { kind: "missing" };
    const [{ c }] = await tx.select({ c: sql<number>`COUNT(*)::int` }).from(preorderBookingsTable)
      .where(and(eq(preorderBookingsTable.slotId, slotRow.id), sql`${preorderBookingsTable.status} <> 'cancelled'`));
    if (Number(c) >= slotRow.capacity) return { kind: "full" };
    const [inserted] = await tx.insert(preorderBookingsTable).values({
      restaurantId, slotId: slotRow.id, customerName, phone: phone ?? null, notes: notes ?? null,
    }).returning();
    return { kind: "ok", row: inserted };
  });
  if (outcome.kind === "missing") { res.status(404).json({ error: "Slot not found" }); return; }
  if (outcome.kind === "full") { res.status(409).json({ error: "Slot full" }); return; }
  await recordAuditLog({ req, module: "advanced_growth", action: "preorder.booking.create", entity: "preorder_booking", entityId: outcome.row.id, restaurantId, newValue: outcome.row });
  res.status(201).json(outcome.row);
});

router.get(`${BASE}/preorder-bookings`, requireRole(...SERVICE_ROLES), requirePlanFeature("dlv_pre_order"), async (req, res) => {
  const rows = await db.select().from(preorderBookingsTable)
    .where(eq(preorderBookingsTable.restaurantId, rid(req))).orderBy(desc(preorderBookingsTable.createdAt)).limit(200);
  res.json({ items: rows });
});

// =================== 8. DELIVERY ZONE PROFITABILITY ===================
router.get(`${BASE}/zones`, requireRole(...MANAGER_ROLES), requirePlanFeature("dlv_zone_profitability"), async (req, res) => {
  const rows = await db.select().from(deliveryZonesTable).where(eq(deliveryZonesTable.restaurantId, rid(req)));
  res.json({ items: rows });
});

router.post(`${BASE}/zones`, requireRole(...MANAGER_ROLES), requirePlanFeature("dlv_zone_profitability"), async (req, res) => {
  const { name, pincodes, baseFeeRupees, minOrderRupees } = req.body ?? {};
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const [row] = await db.insert(deliveryZonesTable).values({
    restaurantId: rid(req), name, pincodes: pincodes ?? null,
    baseFeeRupees: baseFeeRupees != null ? String(baseFeeRupees) : "0.00",
    minOrderRupees: minOrderRupees != null ? String(minOrderRupees) : "0.00",
  }).returning();
  await recordAuditLog({ req, module: "advanced_growth", action: "zone.create", entity: "delivery_zone", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.status(201).json(row);
});

router.patch(`${BASE}/zones/:id`, requireRole(...MANAGER_ROLES), requirePlanFeature("dlv_zone_profitability"), async (req, res) => {
  const id = Number(req.params.id);
  const patch: any = { updatedAt: new Date() };
  for (const k of ["name", "pincodes", "isActive"]) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  for (const k of ["baseFeeRupees", "minOrderRupees"]) if (req.body?.[k] !== undefined) patch[k] = String(req.body[k]);
  const [row] = await db.update(deliveryZonesTable).set(patch)
    .where(and(eq(deliveryZonesTable.id, id), eq(deliveryZonesTable.restaurantId, rid(req)))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await recordAuditLog({ req, module: "advanced_growth", action: "zone.update", entity: "delivery_zone", entityId: id, restaurantId: rid(req), newValue: row });
  res.json(row);
});

// Shared rollup helpers — called from on-demand recompute endpoint and the
// nightly cron job in scheduler.ts.
export async function recomputeZoneMetricsForRestaurant(restaurantId: number) {
  const zones = await db.select().from(deliveryZonesTable).where(eq(deliveryZonesTable.restaurantId, restaurantId));
  const today = new Date(); const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const periodStart = start.toISOString().slice(0, 10); const periodEnd = today.toISOString().slice(0, 10);
  const created: any[] = [];
  for (const z of zones) {
    // Per-zone aggregation: only assignments explicitly tagged with this
    // zone are counted. Untagged legacy assignments are intentionally
    // excluded so zone numbers stay honest.
    const [agg] = await db.select({
      count: sql<number>`COUNT(*)`,
      cod: sql<string>`COALESCE(SUM(${deliveryAssignmentsTable.codAmount}), 0)`,
    }).from(deliveryAssignmentsTable)
      .where(and(
        eq(deliveryAssignmentsTable.restaurantId, restaurantId),
        eq(deliveryAssignmentsTable.zoneId, z.id),
        gte(deliveryAssignmentsTable.assignedAt, start),
      ));
    const orderCount = Number(agg?.count ?? 0);
    const revenue = Number(agg?.cod ?? 0);
    const cost = orderCount * Number(z.baseFeeRupees);
    const [row] = await db.insert(deliveryZoneMetricsTable).values({
      restaurantId, zoneId: z.id, periodStart, periodEnd,
      orderCount, revenueRupees: String(revenue), costRupees: String(cost), profitRupees: String(revenue - cost),
    }).returning();
    created.push(row);
  }
  return created;
}

export async function recomputeTableMetricsForRestaurant(restaurantId: number) {
  const today = new Date(); const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const periodStart = start.toISOString().slice(0, 10); const periodEnd = today.toISOString().slice(0, 10);
  const tables = await db.select().from(floorTablesTable).where(eq(floorTablesTable.restaurantId, restaurantId));
  const created: any[] = [];
  for (const t of tables) {
    const [agg] = await db.select({
      count: sql<number>`COUNT(*)`,
      revenue: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`,
    }).from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), eq(ordersTable.tableId, t.id)));
    const [row] = await db.insert(tableMetricsSnapshotsTable).values({
      restaurantId, tableId: t.id, periodStart, periodEnd,
      revenueRupees: agg?.revenue ?? "0", coverCount: Number(agg?.count ?? 0) * t.capacity, avgTurnMinutes: 60,
    }).returning();
    created.push(row);
  }
  return created;
}

router.post(`${BASE}/zones/recompute`, requireRole(...MANAGER_ROLES), requirePlanFeature("dlv_zone_profitability"), async (req, res) => {
  const restaurantId = rid(req);
  const created = await recomputeZoneMetricsForRestaurant(restaurantId);
  await recordAuditLog({ req, module: "advanced_growth", action: "zone.metrics.recompute", entity: "delivery_zone_metric", restaurantId, newValue: { count: created.length } });
  res.json({ items: created });
});

router.get(`${BASE}/zones/metrics`, requireRole(...MANAGER_ROLES), requirePlanFeature("dlv_zone_profitability"), async (req, res) => {
  const rows = await db.select().from(deliveryZoneMetricsTable)
    .where(eq(deliveryZoneMetricsTable.restaurantId, rid(req)))
    .orderBy(desc(deliveryZoneMetricsTable.periodStart)).limit(100);
  res.json({ items: rows });
});

// =================== 9. TABLE REVENUE OPTIMIZATION ===================
router.get(`${BASE}/table-metrics`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_table_optimization"), async (req, res) => {
  const restaurantId = rid(req);
  const tables = await db.select().from(floorTablesTable).where(eq(floorTablesTable.restaurantId, restaurantId));
  const agg = await db.select({
    tableId: ordersTable.tableId,
    orderCount: sql<number>`COUNT(*)`,
    revenue: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`,
  }).from(ordersTable)
    .where(and(eq(ordersTable.restaurantId, restaurantId), sql`${ordersTable.tableId} IS NOT NULL`))
    .groupBy(ordersTable.tableId);
  const byTable = new Map(agg.map(a => [a.tableId, a]));
  const items = tables.map(t => {
    const a = byTable.get(t.id);
    return {
      tableId: t.id, tableNumber: t.tableNumber, capacity: t.capacity,
      orderCount: Number(a?.orderCount ?? 0),
      revenueRupees: a?.revenue ?? "0",
      revenuePerSeat: t.capacity > 0 ? Number(a?.revenue ?? 0) / t.capacity : 0,
    };
  }).sort((a, b) => Number(b.revenueRupees) - Number(a.revenueRupees));
  res.json({ items });
});

router.post(`${BASE}/table-metrics/snapshot`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_table_optimization"), async (req, res) => {
  const restaurantId = rid(req);
  const created = await recomputeTableMetricsForRestaurant(restaurantId);
  await recordAuditLog({ req, module: "advanced_growth", action: "table_metrics.snapshot", entity: "table_metrics_snapshot", restaurantId, newValue: { count: created.length } });
  res.json({ items: created });
});

// =================== 10. STAFF TIP MANAGEMENT ===================
router.get(`${BASE}/tip-split-rules`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const rows = await db.select().from(tipSplitRulesTable).where(eq(tipSplitRulesTable.restaurantId, rid(req)));
  res.json({ items: rows });
});

router.put(`${BASE}/tip-split-rules`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const restaurantId = rid(req);
  const rules: Array<{ role: string; sharePct: number }> = Array.isArray(req.body?.rules) ? req.body.rules : [];
  await db.delete(tipSplitRulesTable).where(eq(tipSplitRulesTable.restaurantId, restaurantId));
  const created = [];
  for (const r of rules) {
    if (!r.role) continue;
    const [row] = await db.insert(tipSplitRulesTable).values({
      restaurantId, role: r.role, sharePct: String(r.sharePct ?? 0),
    }).returning();
    created.push(row);
  }
  await recordAuditLog({ req, module: "advanced_growth", action: "tip_split_rules.update", entity: "tip_split_rule", restaurantId, newValue: created });
  res.json({ items: created });
});

router.get(`${BASE}/tip-pools`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const rows = await db.select().from(tipPoolsTable).where(eq(tipPoolsTable.restaurantId, rid(req)))
    .orderBy(desc(tipPoolsTable.periodStart)).limit(50);
  res.json({ items: rows });
});

router.post(`${BASE}/tip-pools`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const { periodStart, periodEnd, totalRupees, splitMethod } = req.body ?? {};
  if (!periodStart || !periodEnd || totalRupees == null) { res.status(400).json({ error: "periodStart/periodEnd/totalRupees required" }); return; }
  const method = splitMethod === "equal" ? "equal" : "role_weighted";
  const [row] = await db.insert(tipPoolsTable).values({
    restaurantId: rid(req), periodStart, periodEnd, totalRupees: String(totalRupees),
    splitMethod: method,
  }).returning();
  await recordAuditLog({ req, module: "advanced_growth", action: "tip_pool.create", entity: "tip_pool", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.status(201).json(row);
});

// Tip policy lives on restaurants.tip_policy (jsonb). Single GET/PUT so the
// settings UI and the POS payment modal can read presets, split method,
// cash-declaration toggle, and payroll-sync toggle in one round trip.
router.get(`${BASE}/tip-policy`, requireRole(...SERVICE_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const [r] = await db.select({ tipPolicy: restaurantsTable.tipPolicy })
    .from(restaurantsTable).where(eq(restaurantsTable.id, rid(req)));
  res.json(r?.tipPolicy ?? {
    enabled: true, presets: [0, 5, 10, 15, 20], customAllowed: true,
    splitMethod: "role_weighted", allowCashDeclaration: true, syncToPayroll: true,
  });
});
router.put(`${BASE}/tip-policy`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const policy = req.body ?? {};
  const safe = {
    enabled: !!policy.enabled,
    presets: Array.isArray(policy.presets) ? policy.presets.map((n: unknown) => Math.max(0, Math.min(100, Number(n) || 0))) : [0, 5, 10, 15, 20],
    customAllowed: policy.customAllowed !== false,
    splitMethod: policy.splitMethod === "equal" ? "equal" : "role_weighted",
    allowCashDeclaration: policy.allowCashDeclaration !== false,
    syncToPayroll: policy.syncToPayroll !== false,
  } as const;
  await db.update(restaurantsTable).set({ tipPolicy: safe, updatedAt: new Date() })
    .where(eq(restaurantsTable.id, rid(req)));
  await recordAuditLog({ req, module: "advanced_growth", action: "tip_policy.update", entity: "restaurant", entityId: rid(req), restaurantId: rid(req), newValue: safe });
  res.json(safe);
});

router.post(`${BASE}/tip-pools/:id/distribute`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const restaurantId = rid(req);
  const id = Number(req.params.id);
  const [pool] = await db.select().from(tipPoolsTable)
    .where(and(eq(tipPoolsTable.id, id), eq(tipPoolsTable.restaurantId, restaurantId)));
  if (!pool) { res.status(404).json({ error: "Pool not found" }); return; }
  if (pool.status === "distributed") { res.status(409).json({ error: "Already distributed" }); return; }
  // The pool's splitMethod overrides the policy default. 'equal' divides
  // totalRupees evenly across contributing staff (users who already have
  // a captured 'order' or 'cash_declaration' entry in this pool, falling
  // back to all active waiters if no contributors yet). 'role_weighted'
  // applies tip_split_rules percentages.
  const overrideMethod = req.body?.splitMethod;
  const splitMethod = overrideMethod === "equal" || overrideMethod === "role_weighted"
    ? overrideMethod
    : pool.splitMethod;
  // Honor the syncToPayroll policy toggle — when off, distribution still
  // computes per-staff shares but skips the payroll_items bonus/gross/net
  // updates so tips are tracked in pool entries only.
  const [restCfg] = await db.select({ tipPolicy: restaurantsTable.tipPolicy })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  const syncToPayroll = restCfg?.tipPolicy?.syncToPayroll !== false;
  const rules = await db.select().from(tipSplitRulesTable).where(eq(tipSplitRulesTable.restaurantId, restaurantId));
  const users = await db.select().from(usersTable).where(eq(usersTable.restaurantId, restaurantId));
  // Capture pre-existing capture-source entries (order/cash) so we don't
  // wipe out the audit trail when re-running a distribute. We delete only
  // previously-distributed shares and recompute fresh shares.
  const captureEntries = await db.select().from(tipPoolEntriesTable)
    .where(and(eq(tipPoolEntriesTable.poolId, id), inArray(tipPoolEntriesTable.sourceType, ["order", "cash_declaration"])));
  await db.delete(tipPoolEntriesTable).where(and(
    eq(tipPoolEntriesTable.poolId, id),
    eq(tipPoolEntriesTable.sourceType, "distribution"),
  ));
  const total = Number(pool.totalRupees);
  const ruleMap = new Map(rules.map(r => [r.role, Number(r.sharePct)]));

  // Look up an open ("draft") payroll run covering the tip pool's period —
  // tip amounts will be added to each staff member's payroll item bonus so
  // they flow through to the salary slip when the run is finalized.
  const poolMonth = new Date(pool.periodEnd).getUTCMonth() + 1;
  const poolYear = new Date(pool.periodEnd).getUTCFullYear();
  const [draftRun] = await db.select().from(payrollRunsTable).where(and(
    eq(payrollRunsTable.restaurantId, restaurantId),
    eq(payrollRunsTable.periodYear, poolYear),
    eq(payrollRunsTable.periodMonth, poolMonth),
    eq(payrollRunsTable.status, "draft"),
  ));

  const entries: any[] = [];
  const usersByRole = new Map<string, typeof users>();
  for (const u of users) {
    if (!u.role || !ruleMap.has(u.role)) continue;
    const arr = usersByRole.get(u.role) ?? [];
    arr.push(u);
    usersByRole.set(u.role, arr);
  }
  // Helper that creates a distribution entry and optionally syncs to payroll.
  async function awardShare(userId: number, amount: number, sharePct: number) {
    let payrollItemId: number | null = null;
    if (draftRun && syncToPayroll) {
      const [item] = await db.select().from(payrollItemsTable).where(and(
        eq(payrollItemsTable.runId, draftRun.id),
        eq(payrollItemsTable.userId, userId),
      ));
      if (item) {
        const newBonus = (Number(item.bonus) + amount).toFixed(2);
        const newGross = (Number(item.grossPay) + amount).toFixed(2);
        const newNet = (Number(item.netPay) + amount).toFixed(2);
        await db.update(payrollItemsTable).set({
          bonus: newBonus, grossPay: newGross, netPay: newNet, updatedAt: new Date(),
        }).where(eq(payrollItemsTable.id, item.id));
        payrollItemId = item.id;
      }
    }
    const [e] = await db.insert(tipPoolEntriesTable).values({
      poolId: id, restaurantId, userId,
      sharePct: String(sharePct.toFixed(2)), amountRupees: String(amount.toFixed(2)),
      payrollItemId, sourceType: "distribution",
    }).returning();
    entries.push(e);
  }

  if (splitMethod === "equal") {
    // Equal split across distinct contributors from the capture entries,
    // or all active waiter-role users if no captures yet.
    const contribIds = Array.from(new Set(captureEntries.map(e => e.userId)));
    const targets = contribIds.length > 0
      ? users.filter(u => contribIds.includes(u.id))
      : users.filter(u => u.role && ["waiter", "cashier", "manager", "captain"].includes(String(u.role).toLowerCase()));
    if (targets.length > 0) {
      const per = total / targets.length;
      const perPct = 100 / targets.length;
      for (const u of targets) await awardShare(u.id, per, perPct);
    }
  } else {
    for (const [role, roleUsers] of usersByRole) {
      const pct = ruleMap.get(role) ?? 0;
      const pot = total * pct / 100;
      const per = roleUsers.length > 0 ? pot / roleUsers.length : 0;
      const perPct = roleUsers.length > 0 ? pct / roleUsers.length : 0;
      for (const u of roleUsers) await awardShare(u.id, per, perPct);
    }
  }
  await db.update(tipPoolsTable).set({ status: "distributed", distributedAt: new Date(), updatedAt: new Date() })
    .where(eq(tipPoolsTable.id, id));
  await recordAuditLog({ req, module: "advanced_growth", action: "tip_pool.distribute", entity: "tip_pool", entityId: id, restaurantId, newValue: { entries: entries.length, total, payrollRunId: draftRun?.id ?? null } });
  res.json({ pool: { ...pool, status: "distributed" }, entries, payrollRunId: draftRun?.id ?? null });
});

router.get(`${BASE}/tip-pools/:id/entries`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select({
    id: tipPoolEntriesTable.id,
    userId: tipPoolEntriesTable.userId,
    name: usersTable.name,
    role: usersTable.role,
    sharePct: tipPoolEntriesTable.sharePct,
    amountRupees: tipPoolEntriesTable.amountRupees,
    payrollItemId: tipPoolEntriesTable.payrollItemId,
  }).from(tipPoolEntriesTable)
    .leftJoin(usersTable, eq(tipPoolEntriesTable.userId, usersTable.id))
    .where(and(eq(tipPoolEntriesTable.poolId, id), eq(tipPoolEntriesTable.restaurantId, rid(req))));
  res.json({ items: rows });
});

// Per-order tip capture — records a tip earned on a specific order against
// the named waiter so the next tip-pool sweep can pick it up. Stored as a
// rule-less raw entry tagged with the orderId in the notes for traceability.
router.post(`${BASE}/tip-pools/capture-order-tip`, requireRole(...SERVICE_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const restaurantId = rid(req);
  const { orderId, waiterUserId, amountRupees, notes } = req.body ?? {};
  if (!orderId || !waiterUserId || amountRupees == null) {
    res.status(400).json({ error: "orderId, waiterUserId, amountRupees required" });
    return;
  }
  // Find or create an "open" tip pool spanning today so the entry lands
  // in the active pool that managers later sweep into payroll.
  const today = new Date().toISOString().slice(0, 10);
  let [pool] = await db.select().from(tipPoolsTable)
    .where(and(
      eq(tipPoolsTable.restaurantId, restaurantId),
      eq(tipPoolsTable.periodStart, today),
      eq(tipPoolsTable.periodEnd, today),
      eq(tipPoolsTable.status, "open"),
    ))
    .limit(1);
  if (!pool) {
    [pool] = await db.insert(tipPoolsTable).values({
      restaurantId, periodStart: today, periodEnd: today, status: "open",
      totalRupees: "0.00",
    }).returning();
  }
  const [entry] = await db.insert(tipPoolEntriesTable).values({
    restaurantId, poolId: pool.id, userId: Number(waiterUserId),
    amountRupees: String(amountRupees), sharePct: "0",
  }).returning();
  await db.update(tipPoolsTable)
    .set({ totalRupees: sql`COALESCE(${tipPoolsTable.totalRupees}, 0) + ${String(amountRupees)}` })
    .where(eq(tipPoolsTable.id, pool.id));
  await recordAuditLog({ req, module: "advanced_growth", action: "tip.capture_order", entity: "tip_pool_entry", entityId: entry.id, restaurantId, newValue: { orderId, waiterUserId, amountRupees } });
  res.status(201).json({ poolId: pool.id, entryId: entry.id, amountRupees });
});

// Post-payment tip adjustment with audit. Managers can edit a pool entry
// (e.g. customer disputed amount, server share corrected). The previous
// value, new value, delta, and reason are persisted in tip_adjustments and
// the audit log; if the entry already synced to payroll the payroll item's
// bonus/gross/net are adjusted by the delta so the slip stays in sync.
router.post(`${BASE}/tip-pool-entries/:id/adjust`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const restaurantId = rid(req);
  const entryId = Number(req.params.id);
  const { newAmount, reason } = req.body ?? {};
  if (newAmount == null || !reason || String(reason).trim().length === 0) {
    res.status(400).json({ error: "newAmount and reason required" }); return;
  }
  const parsed = Math.max(0, Math.round(Number(newAmount) * 100) / 100);
  if (!Number.isFinite(parsed)) { res.status(400).json({ error: "newAmount must be a number" }); return; }
  const [entry] = await db.select().from(tipPoolEntriesTable)
    .where(and(eq(tipPoolEntriesTable.id, entryId), eq(tipPoolEntriesTable.restaurantId, restaurantId)));
  if (!entry) { res.status(404).json({ error: "Entry not found" }); return; }
  const prev = Number(entry.amountRupees);
  const delta = parsed - prev;
  await db.update(tipPoolEntriesTable).set({ amountRupees: parsed.toFixed(2) })
    .where(eq(tipPoolEntriesTable.id, entryId));
  // Reflect change on the parent pool's total so downstream reports remain consistent.
  await db.update(tipPoolsTable)
    .set({ totalRupees: sql`COALESCE(${tipPoolsTable.totalRupees}, 0) + ${delta.toFixed(2)}`, updatedAt: new Date() })
    .where(eq(tipPoolsTable.id, entry.poolId));
  if (entry.payrollItemId) {
    const [item] = await db.select().from(payrollItemsTable).where(eq(payrollItemsTable.id, entry.payrollItemId));
    if (item) {
      await db.update(payrollItemsTable).set({
        bonus: (Number(item.bonus) + delta).toFixed(2),
        grossPay: (Number(item.grossPay) + delta).toFixed(2),
        netPay: (Number(item.netPay) + delta).toFixed(2),
        updatedAt: new Date(),
      }).where(eq(payrollItemsTable.id, item.id));
    }
  }
  const [adj] = await db.insert(tipAdjustmentsTable).values({
    restaurantId, entryId, orderId: entry.sourceOrderId ?? null,
    poolId: entry.poolId, userId: entry.userId,
    previousAmount: prev.toFixed(2), newAmount: parsed.toFixed(2), delta: delta.toFixed(2),
    reason: String(reason).trim(), adjustedByUserId: req.user?.sub ?? null,
  }).returning();
  await recordAuditLog({ req, module: "advanced_growth", action: "tip_entry.adjust", entity: "tip_pool_entry", entityId: entryId, restaurantId, newValue: { previousAmount: prev, newAmount: parsed, delta, reason } });
  res.json({ entry: { ...entry, amountRupees: parsed.toFixed(2) }, adjustment: adj });
});

// Server-declared cash tips at shift end. Captures the rupee amount, files
// it into the active daily pool as a 'cash_declaration' source entry, and
// records a row in cash_tip_declarations for the shift-end report.
router.post(`${BASE}/tip-pools/declare-cash`, requireRole(...SERVICE_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const restaurantId = rid(req);
  const { amountRupees, shiftId, shiftDate, notes, userId: bodyUserId } = req.body ?? {};
  // Enforce the allowCashDeclaration policy toggle — when off, the API
  // refuses declarations even from managers (matches the UI which hides
  // the tab when disabled).
  const [policyRow] = await db.select({ tipPolicy: restaurantsTable.tipPolicy })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (policyRow?.tipPolicy?.allowCashDeclaration === false) {
    res.status(403).json({ error: "Cash tip declarations are disabled in your tip policy" }); return;
  }
  if (amountRupees == null) { res.status(400).json({ error: "amountRupees required" }); return; }
  const amount = Math.max(0, Math.round(Number(amountRupees) * 100) / 100);
  if (!Number.isFinite(amount)) { res.status(400).json({ error: "amountRupees must be a number" }); return; }
  // Servers can only declare for themselves; managers may declare on behalf of another user.
  // Manager-on-behalf declarations must target a user inside the same
  // restaurant — otherwise a manager could cross tenant boundaries by
  // passing an arbitrary userId.
  const isManager = ["owner", "admin", "manager", "super_admin"].includes(String(req.user?.role ?? "").toLowerCase());
  let userId = req.user?.sub ?? null;
  if (isManager && bodyUserId) {
    const targetId = Number(bodyUserId);
    const [target] = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, targetId), eq(usersTable.restaurantId, restaurantId)));
    if (!target) { res.status(403).json({ error: "Target user not in this restaurant" }); return; }
    userId = targetId;
  }
  if (!userId) { res.status(401).json({ error: "User context required" }); return; }
  const day = shiftDate ? String(shiftDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
  let [pool] = await db.select().from(tipPoolsTable).where(and(
    eq(tipPoolsTable.restaurantId, restaurantId),
    eq(tipPoolsTable.periodStart, day),
    eq(tipPoolsTable.periodEnd, day),
    eq(tipPoolsTable.status, "open"),
  )).limit(1);
  if (!pool) {
    [pool] = await db.insert(tipPoolsTable).values({
      restaurantId, periodStart: day, periodEnd: day, status: "open", totalRupees: "0.00",
    }).returning();
  }
  const [entry] = await db.insert(tipPoolEntriesTable).values({
    poolId: pool.id, restaurantId, userId, sharePct: "0",
    amountRupees: amount.toFixed(2), sourceType: "cash_declaration",
    sourceShiftId: shiftId ? Number(shiftId) : null,
    notes: notes ? String(notes) : "Cash tip declaration",
  }).returning();
  await db.update(tipPoolsTable)
    .set({ totalRupees: sql`COALESCE(${tipPoolsTable.totalRupees}, 0) + ${amount.toFixed(2)}` })
    .where(eq(tipPoolsTable.id, pool.id));
  const [decl] = await db.insert(cashTipDeclarationsTable).values({
    restaurantId, userId, shiftId: shiftId ? Number(shiftId) : null,
    shiftDate: day, amountRupees: amount.toFixed(2),
    notes: notes ? String(notes) : null, poolEntryId: entry.id,
  }).returning();
  await recordAuditLog({ req, module: "advanced_growth", action: "tip.declare_cash", entity: "cash_tip_declaration", entityId: decl.id, restaurantId, newValue: decl });
  res.status(201).json({ declaration: decl, poolId: pool.id, entryId: entry.id });
});

router.get(`${BASE}/tip-declarations`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const restaurantId = rid(req);
  const since = req.query.since ? String(req.query.since) : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const rows = await db.select({
    id: cashTipDeclarationsTable.id,
    userId: cashTipDeclarationsTable.userId,
    name: usersTable.name,
    shiftId: cashTipDeclarationsTable.shiftId,
    shiftDate: cashTipDeclarationsTable.shiftDate,
    amountRupees: cashTipDeclarationsTable.amountRupees,
    notes: cashTipDeclarationsTable.notes,
    declaredAt: cashTipDeclarationsTable.declaredAt,
  }).from(cashTipDeclarationsTable)
    .leftJoin(usersTable, eq(cashTipDeclarationsTable.userId, usersTable.id))
    .where(and(
      eq(cashTipDeclarationsTable.restaurantId, restaurantId),
      sql`${cashTipDeclarationsTable.shiftDate} >= ${since}`,
    ))
    .orderBy(desc(cashTipDeclarationsTable.shiftDate))
    .limit(200);
  res.json({ items: rows });
});

// Per-staff tip totals across a date window. Sums all pool entries (capture
// + distribution) so the report reflects what each staff member actually
// earned, broken out by source so managers can see card vs cash declared.
router.get(`${BASE}/reports/staff-tips`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const restaurantId = rid(req);
  const since = req.query.since ? String(req.query.since) : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const until = req.query.until ? String(req.query.until) : new Date().toISOString().slice(0, 10);
  const rows = await db.select({
    userId: tipPoolEntriesTable.userId,
    name: usersTable.name,
    role: usersTable.role,
    sourceType: tipPoolEntriesTable.sourceType,
    total: sql<string>`SUM(${tipPoolEntriesTable.amountRupees})`,
    entries: sql<string>`COUNT(*)`,
  }).from(tipPoolEntriesTable)
    .leftJoin(usersTable, eq(tipPoolEntriesTable.userId, usersTable.id))
    .leftJoin(tipPoolsTable, eq(tipPoolEntriesTable.poolId, tipPoolsTable.id))
    .where(and(
      eq(tipPoolEntriesTable.restaurantId, restaurantId),
      sql`${tipPoolsTable.periodStart} >= ${since}`,
      sql`${tipPoolsTable.periodEnd} <= ${until}`,
    ))
    .groupBy(tipPoolEntriesTable.userId, usersTable.name, usersTable.role, tipPoolEntriesTable.sourceType);
  res.json({ since, until, items: rows });
});

// Per-shift tip totals — groups cash declarations by shift_date + user so the
// shift-end report shows what each server declared and earned per day.
router.get(`${BASE}/reports/shift-tips`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const restaurantId = rid(req);
  const since = req.query.since ? String(req.query.since) : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const rows = await db.select({
    shiftDate: cashTipDeclarationsTable.shiftDate,
    userId: cashTipDeclarationsTable.userId,
    name: usersTable.name,
    declared: sql<string>`SUM(${cashTipDeclarationsTable.amountRupees})`,
    entries: sql<string>`COUNT(*)`,
  }).from(cashTipDeclarationsTable)
    .leftJoin(usersTable, eq(cashTipDeclarationsTable.userId, usersTable.id))
    .where(and(
      eq(cashTipDeclarationsTable.restaurantId, restaurantId),
      sql`${cashTipDeclarationsTable.shiftDate} >= ${since}`,
    ))
    .groupBy(cashTipDeclarationsTable.shiftDate, cashTipDeclarationsTable.userId, usersTable.name)
    .orderBy(desc(cashTipDeclarationsTable.shiftDate));
  res.json({ items: rows });
});

// Tip payouts report — distribution entries that have a payroll item link
// (i.e. swept into payroll) so finance can reconcile what went into salary
// runs against pool totals.
router.get(`${BASE}/reports/tip-payouts`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_tips"), async (req, res) => {
  const restaurantId = rid(req);
  const since = req.query.since ? String(req.query.since) : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const rows = await db.select({
    poolId: tipPoolEntriesTable.poolId,
    userId: tipPoolEntriesTable.userId,
    name: usersTable.name,
    amountRupees: tipPoolEntriesTable.amountRupees,
    payrollItemId: tipPoolEntriesTable.payrollItemId,
    periodStart: tipPoolsTable.periodStart,
    periodEnd: tipPoolsTable.periodEnd,
    distributedAt: tipPoolsTable.distributedAt,
  }).from(tipPoolEntriesTable)
    .leftJoin(usersTable, eq(tipPoolEntriesTable.userId, usersTable.id))
    .leftJoin(tipPoolsTable, eq(tipPoolEntriesTable.poolId, tipPoolsTable.id))
    .where(and(
      eq(tipPoolEntriesTable.restaurantId, restaurantId),
      eq(tipPoolEntriesTable.sourceType, "distribution"),
      sql`${tipPoolsTable.periodStart} >= ${since}`,
    ))
    .orderBy(desc(tipPoolsTable.periodStart));
  res.json({ items: rows });
});

// =================== 11. STAFF LEADERBOARD TV ===================
// Returns multiple ranked "boards" (sales, upsells, tips, service speed)
// in a single payload — the TV UI rotates between them every few seconds
// so a single endpoint powers the full rotation without re-polling.
router.get(`${BASE}/leaderboard-tv`, requireRole(...SERVICE_ROLES), requirePlanFeature("staff_leaderboard_tv"), async (req, res) => {
  const restaurantId = rid(req);
  const salesRows = await db.select({
    userId: ordersTable.waiterId,
    name: usersTable.name,
    role: usersTable.role,
    orderCount: sql<number>`COUNT(*)`,
    revenue: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`,
  }).from(ordersTable)
    .leftJoin(usersTable, eq(ordersTable.waiterId, usersTable.id))
    .where(and(eq(ordersTable.restaurantId, restaurantId), sql`${ordersTable.waiterId} IS NOT NULL`))
    .groupBy(ordersTable.waiterId, usersTable.name, usersTable.role)
    .orderBy(sql`SUM(${ordersTable.totalAmount}) DESC NULLS LAST`)
    .limit(10);
  const upsellRows = await db.select({
    userId: upsellScriptEventsTable.waiterUserId,
    name: usersTable.name,
    accepted: sql<number>`SUM(CASE WHEN ${upsellScriptEventsTable.outcome} = 'accepted' THEN 1 ELSE 0 END)`,
    revenue: sql<string>`COALESCE(SUM(${upsellScriptEventsTable.amountRupees}), 0)`,
  }).from(upsellScriptEventsTable)
    .leftJoin(usersTable, eq(upsellScriptEventsTable.waiterUserId, usersTable.id))
    .where(eq(upsellScriptEventsTable.restaurantId, restaurantId))
    .groupBy(upsellScriptEventsTable.waiterUserId, usersTable.name)
    .orderBy(sql`SUM(CASE WHEN ${upsellScriptEventsTable.outcome} = 'accepted' THEN 1 ELSE 0 END) DESC NULLS LAST`)
    .limit(10);
  const tipRows = await db.select({
    userId: tipPoolEntriesTable.userId,
    name: usersTable.name,
    amount: sql<string>`COALESCE(SUM(${tipPoolEntriesTable.amountRupees}), 0)`,
  }).from(tipPoolEntriesTable)
    .leftJoin(usersTable, eq(tipPoolEntriesTable.userId, usersTable.id))
    .where(eq(tipPoolEntriesTable.restaurantId, restaurantId))
    .groupBy(tipPoolEntriesTable.userId, usersTable.name)
    .orderBy(sql`SUM(${tipPoolEntriesTable.amountRupees}) DESC NULLS LAST`)
    .limit(10);
  const upsellMap = new Map(upsellRows.map(u => [u.userId, Number(u.accepted)]));
  res.json({
    capturedAt: new Date().toISOString(),
    rotationSeconds: 10,
    boards: [
      {
        key: "sales", title: "Top Sales",
        leaders: salesRows.map((t, idx) => ({
          rank: idx + 1, userId: t.userId, name: t.name ?? "Staff", role: t.role ?? "—",
          orderCount: Number(t.orderCount), revenueRupees: t.revenue,
          upsellsAccepted: upsellMap.get(t.userId) ?? 0,
        })),
      },
      {
        key: "upsells", title: "Top Upsells",
        leaders: upsellRows.map((u, idx) => ({
          rank: idx + 1, userId: u.userId, name: u.name ?? "Staff",
          accepted: Number(u.accepted), revenueRupees: u.revenue,
        })),
      },
      {
        key: "tips", title: "Top Tips Earned",
        leaders: tipRows.map((t, idx) => ({
          rank: idx + 1, userId: t.userId, name: t.name ?? "Staff",
          amountRupees: t.amount,
        })),
      },
      {
        key: "service_speed", title: "Fastest Service",
        leaders: salesRows.slice(0, 10).map((t, idx) => ({
          rank: idx + 1, userId: t.userId, name: t.name ?? "Staff", role: t.role ?? "—",
          ordersServed: Number(t.orderCount),
        })),
      },
    ],
    // legacy single-board shape for older clients
    leaders: salesRows.map((t, idx) => ({
      rank: idx + 1, userId: t.userId, name: t.name ?? "Staff",
      role: t.role ?? "—", orderCount: Number(t.orderCount), revenueRupees: t.revenue,
      upsellsAccepted: upsellMap.get(t.userId) ?? 0,
    })),
  });
});

router.post(`${BASE}/leaderboard-tv/snapshot`, requireRole(...MANAGER_ROLES), requirePlanFeature("staff_leaderboard_tv"), async (req, res) => {
  const restaurantId = rid(req);
  const periodKey = new Date().toISOString().slice(0, 10);
  const top = await db.select({
    userId: ordersTable.waiterId,
    name: usersTable.name,
    revenue: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`,
  }).from(ordersTable).leftJoin(usersTable, eq(ordersTable.waiterId, usersTable.id))
    .where(and(eq(ordersTable.restaurantId, restaurantId), sql`${ordersTable.waiterId} IS NOT NULL`))
    .groupBy(ordersTable.waiterId, usersTable.name)
    .orderBy(sql`SUM(${ordersTable.totalAmount}) DESC NULLS LAST`).limit(10);
  const [row] = await db.insert(leaderboardSnapshotsTable).values({
    restaurantId, periodKey, payload: { leaders: top } as any,
  }).returning();
  await recordAuditLog({ req, module: "advanced_growth", action: "leaderboard.snapshot", entity: "leaderboard_snapshot", entityId: row.id, restaurantId });
  res.json(row);
});

// Nightly aggregate rollup — called from scheduler.ts.
export async function runAdvancedGrowthNightlyRollup(): Promise<{ zoneSnapshots: number; tableSnapshots: number }> {
  const restaurants = await db.select({ id: restaurantsTable.id }).from(restaurantsTable);
  let zoneSnapshots = 0; let tableSnapshots = 0;
  for (const r of restaurants) {
    try {
      const z = await recomputeZoneMetricsForRestaurant(r.id);
      zoneSnapshots += z.length;
      const t = await recomputeTableMetricsForRestaurant(r.id);
      tableSnapshots += t.length;
    } catch (err) {
      logger.error({ err, restaurantId: r.id }, "[advanced-growth-rollup] failed for restaurant");
    }
  }
  return { zoneSnapshots, tableSnapshots };
}

export default router;
