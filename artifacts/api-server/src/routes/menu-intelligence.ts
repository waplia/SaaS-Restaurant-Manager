import { Router } from "express";
import { and, desc, eq, gte, sql, inArray } from "drizzle-orm";
import {
  db,
  menuItemEventsTable,
  menuSearchesTable,
  menuAbExperimentsTable,
  menuAbAssignmentsTable,
  modifierTemplatesTable,
  customerTasteProfilesTable,
  menuGroupSessionsTable,
  menuGroupMembersTable,
  menuItemLifecycleTable,
  menuItemLaunchesTable,
  menuPhotoSubmissionsTable,
  brandAssetsTable,
  menuItemsTable,
  modifierGroupsTable,
  modifiersTable,
  ordersTable,
  orderItemsTable,
  customersTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { recordAuditLog } from "../lib/audit";

const router = Router();

function trim(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// Verifies that a menu item exists AND belongs to the given restaurant. Used to
// block cross-tenant IDOR on menuItemId references in lifecycle/photo paths.
async function menuItemBelongsTo(restaurantId: number, menuItemId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: menuItemsTable.id })
    .from(menuItemsTable)
    .where(and(eq(menuItemsTable.id, menuItemId), eq(menuItemsTable.restaurantId, restaurantId)));
  return !!row;
}

const ownerManager = requireRole("owner", "manager", "super_admin");
const ownerManagerStaff = requireRole("owner", "manager", "waiter", "kitchen", "super_admin");

// ─── 1. Menu Heatmap ──────────────────────────────────────────────
router.use(
  "/restaurants/:restaurantId/menu-intel/heatmap",
  ownerManager,
  validateRestaurantAccess,
  requirePlanFeature("menu_heatmap"),
);

router.get("/restaurants/:restaurantId/menu-intel/heatmap", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 86400_000);

  const eventAgg = await db
    .select({
      menuItemId: menuItemEventsTable.menuItemId,
      impressions: sql<number>`sum(case when ${menuItemEventsTable.eventType} = 'impression' then 1 else 0 end)::int`,
      clicks: sql<number>`sum(case when ${menuItemEventsTable.eventType} = 'click' then 1 else 0 end)::int`,
    })
    .from(menuItemEventsTable)
    .where(
      and(
        eq(menuItemEventsTable.restaurantId, restaurantId),
        gte(menuItemEventsTable.createdAt, since),
      ),
    )
    .groupBy(menuItemEventsTable.menuItemId);

  const orderAgg = await db
    .select({
      menuItemId: orderItemsTable.menuItemId,
      orders: sql<number>`count(*)::int`,
      revenue: sql<string>`coalesce(sum(${orderItemsTable.totalPrice}), 0)`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
    .where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, since)))
    .groupBy(orderItemsTable.menuItemId);

  const items = await db
    .select({ id: menuItemsTable.id, name: menuItemsTable.name, price: menuItemsTable.price })
    .from(menuItemsTable)
    .where(eq(menuItemsTable.restaurantId, restaurantId));

  const evtMap = new Map(eventAgg.map((r) => [r.menuItemId, r]));
  const ordMap = new Map(orderAgg.map((r) => [r.menuItemId, r]));

  const rows = items.map((it) => {
    const e = evtMap.get(it.id);
    const o = ordMap.get(it.id);
    return {
      menuItemId: it.id,
      name: it.name,
      price: it.price,
      impressions: e?.impressions ?? 0,
      clicks: e?.clicks ?? 0,
      orders: o?.orders ?? 0,
      revenue: o?.revenue ?? "0",
    };
  });
  res.json({ data: rows, windowDays: days });
});

// ─── 2. QR Menu A/B Tests ─────────────────────────────────────────
router.use(
  "/restaurants/:restaurantId/menu-intel/ab-tests",
  ownerManager,
  validateRestaurantAccess,
  requirePlanFeature("menu_ab_tests"),
);

router.get("/restaurants/:restaurantId/menu-intel/ab-tests", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(menuAbExperimentsTable)
    .where(eq(menuAbExperimentsTable.restaurantId, restaurantId))
    .orderBy(desc(menuAbExperimentsTable.createdAt));
  res.json({ data: rows });
});

router.post("/restaurants/:restaurantId/menu-intel/ab-tests", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const name = trim(req.body?.name);
  const menuItemId = num(req.body?.menuItemId);
  if (!name || !menuItemId) {
    res.status(400).json({ error: "name and menuItemId are required" });
    return;
  }
  if (!(await menuItemBelongsTo(restaurantId, menuItemId))) {
    return void res.status(404).json({ error: "Menu item not found" });
  }
  const [row] = await db
    .insert(menuAbExperimentsTable)
    .values({
      restaurantId,
      menuItemId,
      name,
      hypothesis: trim(req.body?.hypothesis),
      variantAName: trim(req.body?.variantAName) ?? "Control",
      variantBName: trim(req.body?.variantBName) ?? "Variant B",
      variantAPrice: req.body?.variantAPrice != null ? String(req.body.variantAPrice) : null,
      variantBPrice: req.body?.variantBPrice != null ? String(req.body.variantBPrice) : null,
      variantADescription: trim(req.body?.variantADescription),
      variantBDescription: trim(req.body?.variantBDescription),
      createdBy: req.user?.sub ?? null,
    })
    .returning();
  await recordAuditLog({ req, module: "menu_intelligence", action: "ab_test.created", entity: "menu_ab_test", entityId: row.id, restaurantId, newValue: row });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/menu-intel/ab-tests/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["name", "hypothesis", "status", "winnerVariant", "variantAName", "variantBName", "variantADescription", "variantBDescription"]) {
    if (k in (req.body ?? {})) patch[k] = trim((req.body as Record<string, unknown>)[k]);
  }
  for (const k of ["variantAPrice", "variantBPrice"]) {
    if (k in (req.body ?? {})) {
      const v = (req.body as Record<string, unknown>)[k];
      patch[k] = v == null ? null : String(v);
    }
  }
  if (req.body?.status === "running" && !patch.startedAt) patch.startedAt = new Date();
  if (req.body?.status === "completed") patch.endedAt = new Date();
  const [row] = await db
    .update(menuAbExperimentsTable)
    .set(patch)
    .where(and(eq(menuAbExperimentsTable.id, id), eq(menuAbExperimentsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "menu_intelligence", action: "ab_test.updated", entity: "menu_ab_test", entityId: id, restaurantId, newValue: patch });
  res.json(row);
});

router.get("/restaurants/:restaurantId/menu-intel/ab-tests/:id/results", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  // Enforce experiment ↔ restaurant scope so IDs from other tenants cannot leak data.
  const [exp] = await db
    .select()
    .from(menuAbExperimentsTable)
    .where(and(eq(menuAbExperimentsTable.id, id), eq(menuAbExperimentsTable.restaurantId, restaurantId)));
  if (!exp) return void res.status(404).json({ error: "Not found" });

  const rows = await db
    .select({
      variant: menuAbAssignmentsTable.variant,
      sessions: sql<number>`count(distinct ${menuAbAssignmentsTable.sessionId})::int`,
      impressions: sql<number>`coalesce(sum(${menuAbAssignmentsTable.impressions}), 0)::int`,
      clicks: sql<number>`coalesce(sum(${menuAbAssignmentsTable.clicks}), 0)::int`,
      orders: sql<number>`coalesce(sum(${menuAbAssignmentsTable.orders}), 0)::int`,
      revenue: sql<string>`coalesce(sum(${menuAbAssignmentsTable.revenue}), 0)`,
    })
    .from(menuAbAssignmentsTable)
    .where(eq(menuAbAssignmentsTable.experimentId, id))
    .groupBy(menuAbAssignmentsTable.variant);

  // Two-proportion z-test on order/click conversion. Returns p-value approximation
  // and a 95% confidence call-out so users can decide when to pick a winner.
  const a = rows.find((r) => r.variant === "a");
  const b = rows.find((r) => r.variant === "b");
  let significance: {
    metric: string;
    aRate: number;
    bRate: number;
    uplift: number;
    zScore: number;
    pValue: number;
    significant: boolean;
    leader: "a" | "b" | "tie";
  } | null = null;
  if (a && b && a.clicks > 0 && b.clicks > 0) {
    const pA = a.orders / Math.max(1, a.clicks);
    const pB = b.orders / Math.max(1, b.clicks);
    const pooled = (a.orders + b.orders) / Math.max(1, a.clicks + b.clicks);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(1, a.clicks) + 1 / Math.max(1, b.clicks)));
    const z = se > 0 ? (pB - pA) / se : 0;
    // Normal CDF tail approximation via Abramowitz & Stegun 26.2.17.
    const normCdf = (x: number): number => {
      const t = 1 / (1 + 0.2316419 * Math.abs(x));
      const d = 0.3989422804 * Math.exp(-x * x / 2);
      const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
      return x > 0 ? 1 - p : p;
    };
    const pValue = 2 * (1 - normCdf(Math.abs(z)));
    significance = {
      metric: "click_to_order",
      aRate: pA,
      bRate: pB,
      uplift: pA === 0 ? 0 : (pB - pA) / pA,
      zScore: z,
      pValue,
      significant: pValue < 0.05,
      leader: pB > pA ? "b" : pB < pA ? "a" : "tie",
    };
  }
  res.json({ data: rows, significance, experiment: exp });
});

router.delete("/restaurants/:restaurantId/menu-intel/ab-tests/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  // Verify ownership FIRST — otherwise an attacker could blank another tenant's
  // assignment rows by passing a foreign experiment ID.
  const [exp] = await db
    .select()
    .from(menuAbExperimentsTable)
    .where(and(eq(menuAbExperimentsTable.id, id), eq(menuAbExperimentsTable.restaurantId, restaurantId)));
  if (!exp) return void res.status(404).json({ error: "Not found" });
  await db.delete(menuAbAssignmentsTable).where(eq(menuAbAssignmentsTable.experimentId, id));
  await db.delete(menuAbExperimentsTable).where(eq(menuAbExperimentsTable.id, id));
  await recordAuditLog({ req, module: "menu_intelligence", action: "ab_test.deleted", entity: "menu_ab_test", entityId: id, restaurantId, oldValue: exp });
  res.json({ ok: true });
});

// ─── 3. Search Analytics ──────────────────────────────────────────
router.use(
  "/restaurants/:restaurantId/menu-intel/search-analytics",
  ownerManager,
  validateRestaurantAccess,
  requirePlanFeature("menu_search_analytics"),
);

router.get("/restaurants/:restaurantId/menu-intel/search-analytics", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db
    .select({
      query: menuSearchesTable.normalizedQuery,
      count: sql<number>`count(*)::int`,
      zeroResultCount: sql<number>`sum(case when ${menuSearchesTable.resultsCount} = 0 then 1 else 0 end)::int`,
      lastSeen: sql<Date>`max(${menuSearchesTable.createdAt})`,
    })
    .from(menuSearchesTable)
    .where(and(eq(menuSearchesTable.restaurantId, restaurantId), gte(menuSearchesTable.createdAt, since)))
    .groupBy(menuSearchesTable.normalizedQuery)
    .orderBy(sql`count(*) desc`)
    .limit(200);
  res.json({ data: rows, windowDays: days });
});

// ─── 4. Smart Modifier Builder ────────────────────────────────────
router.use(
  "/restaurants/:restaurantId/menu-intel/modifier-templates",
  ownerManager,
  validateRestaurantAccess,
  requirePlanFeature("menu_modifier_builder"),
);

router.get("/restaurants/:restaurantId/menu-intel/modifier-templates", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(modifierTemplatesTable)
    .where(eq(modifierTemplatesTable.restaurantId, restaurantId))
    .orderBy(desc(modifierTemplatesTable.createdAt));
  res.json({ data: rows });
});

router.post("/restaurants/:restaurantId/menu-intel/modifier-templates", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const name = trim(req.body?.name);
  if (!name) return void res.status(400).json({ error: "name is required" });
  const [row] = await db
    .insert(modifierTemplatesTable)
    .values({
      restaurantId,
      name,
      description: trim(req.body?.description),
      groups: Array.isArray(req.body?.groups) ? req.body.groups : [],
      createdBy: req.user?.sub ?? null,
    })
    .returning();
  await recordAuditLog({ req, module: "menu_intelligence", action: "modifier_template.created", entity: "menu_modifier_template", entityId: row.id, restaurantId, newValue: row });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/menu-intel/modifier-templates/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if ("name" in (req.body ?? {})) patch.name = trim(req.body.name);
  if ("description" in (req.body ?? {})) patch.description = trim(req.body.description);
  if (Array.isArray(req.body?.groups)) patch.groups = req.body.groups;
  const [row] = await db
    .update(modifierTemplatesTable)
    .set(patch)
    .where(and(eq(modifierTemplatesTable.id, id), eq(modifierTemplatesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "menu_intelligence", action: "modifier_template.updated", entity: "menu_modifier_template", entityId: id, restaurantId, newValue: patch });
  res.json(row);
});

router.post("/restaurants/:restaurantId/menu-intel/modifier-templates/:id/apply", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const menuItemIds: number[] = Array.isArray(req.body?.menuItemIds) ? req.body.menuItemIds.map(Number).filter(Boolean) : [];
  const replace = req.body?.mode === "replace"; // replace existing groups vs append
  if (menuItemIds.length === 0) return void res.status(400).json({ error: "menuItemIds required" });

  // Load template, verify it belongs to this restaurant.
  const [tpl] = await db
    .select()
    .from(modifierTemplatesTable)
    .where(and(eq(modifierTemplatesTable.id, id), eq(modifierTemplatesTable.restaurantId, restaurantId)));
  if (!tpl) return void res.status(404).json({ error: "Template not found" });

  // Verify every targeted menu item belongs to this restaurant.
  const validItems = await db
    .select({ id: menuItemsTable.id })
    .from(menuItemsTable)
    .where(and(eq(menuItemsTable.restaurantId, restaurantId), inArray(menuItemsTable.id, menuItemIds)));
  const validIds = new Set(validItems.map((r) => r.id));
  const targetIds = menuItemIds.filter((mid) => validIds.has(mid));
  if (targetIds.length === 0) return void res.status(404).json({ error: "No matching menu items" });

  type TplOption = { name?: unknown; price?: unknown; isDefault?: unknown; default?: unknown };
  type TplGroup = {
    name?: unknown;
    // Accept both `isRequired` (canonical) and `required` (UI alias) so legacy
    // templates authored in the modifier-builder UI keep their required-group intent.
    isRequired?: unknown;
    required?: unknown;
    minSelections?: unknown;
    min?: unknown;
    maxSelections?: unknown;
    max?: unknown;
    options?: unknown;
  };
  const groups = Array.isArray(tpl.groups) ? (tpl.groups as TplGroup[]) : [];

  let createdGroups = 0;
  let createdOptions = 0;
  for (const itemId of targetIds) {
    if (replace) {
      const existingGroups = await db.select({ id: modifierGroupsTable.id }).from(modifierGroupsTable).where(eq(modifierGroupsTable.menuItemId, itemId));
      const gIds = existingGroups.map((g) => g.id);
      if (gIds.length > 0) {
        await db.delete(modifiersTable).where(inArray(modifiersTable.groupId, gIds));
        await db.delete(modifierGroupsTable).where(inArray(modifierGroupsTable.id, gIds));
      }
    }
    for (const g of groups) {
      const name = String(g.name ?? "").trim();
      if (!name) continue;
      const requiredFlag = g.isRequired ?? g.required;
      const minVal = g.minSelections ?? g.min;
      const maxVal = g.maxSelections ?? g.max;
      const [grp] = await db
        .insert(modifierGroupsTable)
        .values({
          menuItemId: itemId,
          name: name.slice(0, 120),
          isRequired: !!requiredFlag,
          minSelections: Number.isFinite(Number(minVal)) ? Number(minVal) : 0,
          maxSelections: Number.isFinite(Number(maxVal)) ? Number(maxVal) : 1,
        })
        .returning();
      createdGroups += 1;
      const opts = Array.isArray(g.options) ? (g.options as TplOption[]) : [];
      const optRows = opts
        .map((o) => ({
          groupId: grp.id,
          name: String(o.name ?? "").trim().slice(0, 120),
          price: o.price != null ? String(o.price) : "0.00",
          isDefault: !!o.isDefault,
        }))
        .filter((o) => o.name);
      if (optRows.length > 0) {
        await db.insert(modifiersTable).values(optRows);
        createdOptions += optRows.length;
      }
    }
  }

  await recordAuditLog({
    req, module: "menu_intelligence", action: "modifier_template.applied",
    entity: "menu_modifier_template", entityId: id, restaurantId,
    newValue: { menuItemIds: targetIds, mode: replace ? "replace" : "append", createdGroups, createdOptions },
  });
  res.json({ ok: true, appliedTo: targetIds.length, createdGroups, createdOptions });
});

router.delete("/restaurants/:restaurantId/menu-intel/modifier-templates/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db
    .delete(modifierTemplatesTable)
    .where(and(eq(modifierTemplatesTable.id, id), eq(modifierTemplatesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "menu_intelligence", action: "modifier_template.deleted", entity: "menu_modifier_template", entityId: id, restaurantId, oldValue: row });
  res.json({ ok: true });
});

// ─── 5. Customer Taste Profiles ───────────────────────────────────
router.use(
  "/restaurants/:restaurantId/menu-intel/taste-profiles",
  ownerManagerStaff,
  validateRestaurantAccess,
  requirePlanFeature("menu_taste_profiles"),
);

router.get("/restaurants/:restaurantId/menu-intel/taste-profiles", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select({
      profile: customerTasteProfilesTable,
      customerName: customersTable.name,
      customerPhone: customersTable.phone,
    })
    .from(customerTasteProfilesTable)
    .leftJoin(
      customersTable,
      and(
        eq(customersTable.id, customerTasteProfilesTable.customerId),
        eq(customersTable.restaurantId, customerTasteProfilesTable.restaurantId),
      ),
    )
    .where(eq(customerTasteProfilesTable.restaurantId, restaurantId))
    .orderBy(desc(customerTasteProfilesTable.updatedAt))
    .limit(200);
  res.json({ data: rows });
});

router.put("/restaurants/:restaurantId/menu-intel/taste-profiles/:customerId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.customerId);
  // Tenant guard: the customer must belong to this restaurant. Without this,
  // an authorized user could attach a foreign customerId and the GET would
  // (previously) leak that customer's name + phone via the join.
  const [cust] = await db
    .select({ id: customersTable.id })
    .from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!cust) return void res.status(404).json({ error: "Customer not found" });
  const payload = {
    restaurantId,
    customerId,
    spicyTolerance: num(req.body?.spicyTolerance),
    sweetPreference: num(req.body?.sweetPreference),
    preferredCuisines: Array.isArray(req.body?.preferredCuisines) ? req.body.preferredCuisines.map(String) : [],
    dietary: Array.isArray(req.body?.dietary) ? req.body.dietary.map(String) : [],
    allergens: Array.isArray(req.body?.allergens) ? req.body.allergens.map(String) : [],
    dislikedIngredients: Array.isArray(req.body?.dislikedIngredients) ? req.body.dislikedIngredients.map(String) : [],
    favoriteItemIds: Array.isArray(req.body?.favoriteItemIds) ? req.body.favoriteItemIds.map(Number).filter(Boolean) : [],
    notes: trim(req.body?.notes),
    updatedBy: req.user?.sub ?? null,
    updatedAt: new Date(),
  };
  const [existing] = await db
    .select()
    .from(customerTasteProfilesTable)
    .where(and(eq(customerTasteProfilesTable.restaurantId, restaurantId), eq(customerTasteProfilesTable.customerId, customerId)));
  let row;
  if (existing) {
    [row] = await db
      .update(customerTasteProfilesTable)
      .set(payload)
      .where(eq(customerTasteProfilesTable.id, existing.id))
      .returning();
  } else {
    [row] = await db.insert(customerTasteProfilesTable).values(payload).returning();
  }
  await recordAuditLog({ req, module: "menu_intelligence", action: "taste_profile.upserted", entity: "menu_taste_profile", entityId: row.id, restaurantId, newValue: payload });
  res.json(row);
});

// ─── 6. Group Ordering QR + 7. Split Cart ─────────────────────────
router.use(
  "/restaurants/:restaurantId/menu-intel/group-sessions",
  ownerManagerStaff,
  validateRestaurantAccess,
  requirePlanFeature("menu_group_qr"),
);

router.get("/restaurants/:restaurantId/menu-intel/group-sessions", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(menuGroupSessionsTable)
    .where(eq(menuGroupSessionsTable.restaurantId, restaurantId))
    .orderBy(desc(menuGroupSessionsTable.createdAt))
    .limit(100);
  res.json({ data: rows });
});

router.post("/restaurants/:restaurantId/menu-intel/group-sessions", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const [row] = await db
    .insert(menuGroupSessionsTable)
    .values({
      restaurantId,
      tableId: num(req.body?.tableId),
      code,
      splitMode: req.body?.splitMode === "split" ? "split" : "single",
    })
    .returning();
  await recordAuditLog({ req, module: "menu_intelligence", action: "group_session.created", entity: "menu_group_qr_session", entityId: row.id, restaurantId, newValue: row });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/menu-intel/group-sessions/:id/close", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db
    .update(menuGroupSessionsTable)
    .set({ status: "checked_out", closedAt: new Date() })
    .where(and(eq(menuGroupSessionsTable.id, id), eq(menuGroupSessionsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "menu_intelligence", action: "group_session.closed", entity: "menu_group_qr_session", entityId: id, restaurantId });
  res.json(row);
});

// ─── 8. Menu Item Lifecycle ───────────────────────────────────────
router.use(
  "/restaurants/:restaurantId/menu-intel/lifecycle",
  ownerManager,
  validateRestaurantAccess,
  requirePlanFeature("menu_lifecycle"),
);

router.get("/restaurants/:restaurantId/menu-intel/lifecycle", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(menuItemLifecycleTable)
    .where(eq(menuItemLifecycleTable.restaurantId, restaurantId))
    .orderBy(desc(menuItemLifecycleTable.createdAt))
    .limit(200);
  res.json({ data: rows });
});

const LIFECYCLE_STATES = ["draft", "testing", "active", "bestseller", "declining", "discontinued"] as const;
type LifecycleState = (typeof LIFECYCLE_STATES)[number];

router.post("/restaurants/:restaurantId/menu-intel/lifecycle", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const menuItemId = num(req.body?.menuItemId);
  const toState = trim(req.body?.toState);
  if (!menuItemId || !toState) return void res.status(400).json({ error: "menuItemId and toState required" });
  if (!LIFECYCLE_STATES.includes(toState as LifecycleState)) return void res.status(400).json({ error: "invalid state" });
  if (!(await menuItemBelongsTo(restaurantId, menuItemId))) return void res.status(404).json({ error: "Menu item not found" });

  const [prev] = await db
    .select()
    .from(menuItemLifecycleTable)
    .where(and(eq(menuItemLifecycleTable.restaurantId, restaurantId), eq(menuItemLifecycleTable.menuItemId, menuItemId)))
    .orderBy(desc(menuItemLifecycleTable.createdAt))
    .limit(1);

  const [row] = await db
    .insert(menuItemLifecycleTable)
    .values({
      restaurantId,
      menuItemId,
      fromState: prev?.toState ?? null,
      toState,
      reason: trim(req.body?.reason),
      changedBy: req.user?.sub ?? null,
    })
    .returning();

  // Sync availability with lifecycle state: discontinued items go offline, all other
  // states (draft/testing/active/bestseller/declining) remain visible/orderable.
  if (toState === "discontinued") {
    await db.update(menuItemsTable).set({ isAvailable: false, updatedAt: new Date() }).where(eq(menuItemsTable.id, menuItemId));
  } else if (toState === "active" || toState === "bestseller" || toState === "testing") {
    await db.update(menuItemsTable).set({ isAvailable: true, updatedAt: new Date() }).where(eq(menuItemsTable.id, menuItemId));
  }

  await recordAuditLog({ req, module: "menu_intelligence", action: "lifecycle.transition", entity: "menu_lifecycle_transition", entityId: row.id, restaurantId, newValue: row });
  res.status(201).json(row);
});

// Auto-classify items into bestseller/declining/active based on rolling 30-day sales
// vs the previous 30-day window. Idempotent — recommended states only; nothing is
// written if the recommendation matches the current state. Triggerable from UI cron.
router.post("/restaurants/:restaurantId/menu-intel/lifecycle/auto-classify", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const now = Date.now();
  const since30 = new Date(now - 30 * 86400_000);
  const since60 = new Date(now - 60 * 86400_000);

  const last30 = await db
    .select({ menuItemId: orderItemsTable.menuItemId, qty: sql<number>`coalesce(sum(${orderItemsTable.quantity}), 0)::int` })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
    .where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, since30)))
    .groupBy(orderItemsTable.menuItemId);
  const prev30 = await db
    .select({ menuItemId: orderItemsTable.menuItemId, qty: sql<number>`coalesce(sum(${orderItemsTable.quantity}), 0)::int` })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
    .where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, since60), sql`${ordersTable.createdAt} < ${since30}`))
    .groupBy(orderItemsTable.menuItemId);

  const cur = new Map(last30.map((r) => [r.menuItemId, r.qty]));
  const previousMap = new Map(prev30.map((r) => [r.menuItemId, r.qty]));
  const totals = [...cur.values()].sort((a, b) => b - a);
  const top10Threshold = totals[Math.max(0, Math.floor(totals.length * 0.1) - 1)] ?? Infinity;

  const items = await db
    .select({ id: menuItemsTable.id })
    .from(menuItemsTable)
    .where(eq(menuItemsTable.restaurantId, restaurantId));

  // Get current lifecycle state per item.
  const latestStates = await db
    .select({
      menuItemId: menuItemLifecycleTable.menuItemId,
      toState: menuItemLifecycleTable.toState,
      createdAt: menuItemLifecycleTable.createdAt,
    })
    .from(menuItemLifecycleTable)
    .where(eq(menuItemLifecycleTable.restaurantId, restaurantId))
    .orderBy(desc(menuItemLifecycleTable.createdAt));
  const stateMap = new Map<number, string>();
  for (const r of latestStates) if (!stateMap.has(r.menuItemId)) stateMap.set(r.menuItemId, r.toState);

  const transitions: Array<{ menuItemId: number; from: string | null; to: LifecycleState; reason: string }> = [];
  for (const it of items) {
    const curQty = cur.get(it.id) ?? 0;
    const prevQty = previousMap.get(it.id) ?? 0;
    const state = (stateMap.get(it.id) ?? "active") as LifecycleState;
    if (state === "discontinued" || state === "draft" || state === "testing") continue;
    let target: LifecycleState | null = null;
    let reason = "";
    if (curQty >= top10Threshold && curQty > 0) {
      target = "bestseller";
      reason = `Top 10% by 30d volume (${curQty} units)`;
    } else if (prevQty > 0 && curQty < prevQty * 0.5) {
      target = "declining";
      reason = `30d sales down ${Math.round((1 - curQty / prevQty) * 100)}% vs prior 30d`;
    } else if (state !== "active" && curQty > 0) {
      target = "active";
      reason = "Healthy sales — back to active";
    }
    if (target && target !== state) {
      transitions.push({ menuItemId: it.id, from: state, to: target, reason });
    }
  }

  if (transitions.length > 0) {
    await db.insert(menuItemLifecycleTable).values(
      transitions.map((t) => ({
        restaurantId,
        menuItemId: t.menuItemId,
        fromState: t.from,
        toState: t.to,
        reason: t.reason,
        changedBy: null,
      })),
    );
    await recordAuditLog({
      req, module: "menu_intelligence", action: "lifecycle.auto_classified",
      entity: "menu_lifecycle_transition", entityId: 0, restaurantId,
      newValue: { count: transitions.length, transitions },
    });
  }
  res.json({ ok: true, transitions });
});

// ─── 9. New Launch Tracker ────────────────────────────────────────
router.use(
  "/restaurants/:restaurantId/menu-intel/launches",
  ownerManager,
  validateRestaurantAccess,
  requirePlanFeature("menu_launch_tracker"),
);

router.get("/restaurants/:restaurantId/menu-intel/launches", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const launches = await db
    .select()
    .from(menuItemLaunchesTable)
    .where(eq(menuItemLaunchesTable.restaurantId, restaurantId))
    .orderBy(desc(menuItemLaunchesTable.launchedAt));

  const ids = launches.map((l) => l.menuItemId);
  // Rolling window rollups (7d / 15d / 30d) of orders, revenue, repeat-purchase
  // count and unique customers. These are the KPI set used on the launch tracker.
  type Bucket = { orders: number; revenue: string; uniqueCustomers: number; repeatPurchases: number };
  const empty: Bucket = { orders: 0, revenue: "0", uniqueCustomers: 0, repeatPurchases: 0 };
  const windows: Array<7 | 15 | 30> = [7, 15, 30];
  const bucketByItem = new Map<number, Record<7 | 15 | 30, Bucket>>();
  for (const id of ids) bucketByItem.set(id, { 7: empty, 15: empty, 30: empty });

  if (ids.length > 0) {
    for (const days of windows) {
      const since = new Date(Date.now() - days * 86400_000);
      const rows = await db
        .select({
          menuItemId: orderItemsTable.menuItemId,
          orders: sql<number>`count(*)::int`,
          revenue: sql<string>`coalesce(sum(${orderItemsTable.totalPrice}), 0)`,
          uniqueCustomers: sql<number>`count(distinct ${ordersTable.customerId})::int`,
          repeatPurchases: sql<number>`(count(*) - count(distinct ${ordersTable.customerId}))::int`,
        })
        .from(orderItemsTable)
        .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
        .where(
          and(
            eq(ordersTable.restaurantId, restaurantId),
            inArray(orderItemsTable.menuItemId, ids),
            gte(ordersTable.createdAt, since),
          ),
        )
        .groupBy(orderItemsTable.menuItemId);
      for (const r of rows) {
        const b = bucketByItem.get(r.menuItemId);
        if (b) b[days] = { orders: r.orders, revenue: r.revenue, uniqueCustomers: r.uniqueCustomers, repeatPurchases: Math.max(0, r.repeatPurchases) };
      }
    }
  }

  res.json({
    data: launches.map((l) => {
      const b = bucketByItem.get(l.menuItemId) ?? { 7: empty, 15: empty, 30: empty };
      const actualOrders = b[30].orders;
      const actualRevenue = b[30].revenue;
      const target = l.targetOrders ?? 0;
      const targetRevenue = Number(l.targetRevenue ?? 0);
      const orderProgress = target > 0 ? actualOrders / target : null;
      const revenueProgress = targetRevenue > 0 ? Number(actualRevenue) / targetRevenue : null;
      return {
        ...l,
        rollups: { d7: b[7], d15: b[15], d30: b[30] },
        actualOrders,
        actualRevenue,
        orderProgress,
        revenueProgress,
        forecastVariance: revenueProgress != null ? revenueProgress - 1 : null,
      };
    }),
  });
});

router.post("/restaurants/:restaurantId/menu-intel/launches", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const menuItemId = num(req.body?.menuItemId);
  if (!menuItemId) return void res.status(400).json({ error: "menuItemId required" });
  if (!(await menuItemBelongsTo(restaurantId, menuItemId))) {
    return void res.status(404).json({ error: "Menu item not found" });
  }
  const [row] = await db
    .insert(menuItemLaunchesTable)
    .values({
      restaurantId,
      menuItemId,
      targetOrders: num(req.body?.targetOrders),
      targetRevenue: req.body?.targetRevenue != null ? String(req.body.targetRevenue) : null,
      trackingWindowDays: num(req.body?.trackingWindowDays) ?? 30,
      notes: trim(req.body?.notes),
      createdBy: req.user?.sub ?? null,
    })
    .returning();
  await recordAuditLog({ req, module: "menu_intelligence", action: "launch.created", entity: "menu_launch", entityId: row.id, restaurantId, newValue: row });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/menu-intel/launches/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["status", "notes"]) if (k in (req.body ?? {})) patch[k] = trim((req.body as Record<string, unknown>)[k]);
  if ("targetOrders" in (req.body ?? {})) patch.targetOrders = num(req.body.targetOrders);
  if ("targetRevenue" in (req.body ?? {})) patch.targetRevenue = req.body.targetRevenue != null ? String(req.body.targetRevenue) : null;
  const [row] = await db
    .update(menuItemLaunchesTable)
    .set(patch)
    .where(and(eq(menuItemLaunchesTable.id, id), eq(menuItemLaunchesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "menu_intelligence", action: "launch.updated", entity: "menu_launch", entityId: id, restaurantId, newValue: patch });
  res.json(row);
});

// ─── 10. Menu Photo Approval ──────────────────────────────────────
router.use(
  "/restaurants/:restaurantId/menu-intel/photo-submissions",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("menu_photo_approval"),
);

router.get("/restaurants/:restaurantId/menu-intel/photo-submissions", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = trim(req.query.status as string);
  const where = status
    ? and(eq(menuPhotoSubmissionsTable.restaurantId, restaurantId), eq(menuPhotoSubmissionsTable.status, status))
    : eq(menuPhotoSubmissionsTable.restaurantId, restaurantId);
  const rows = await db
    .select()
    .from(menuPhotoSubmissionsTable)
    .where(where)
    .orderBy(desc(menuPhotoSubmissionsTable.createdAt))
    .limit(200);
  res.json({ data: rows });
});

router.post("/restaurants/:restaurantId/menu-intel/photo-submissions", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const imageUrl = trim(req.body?.imageUrl);
  if (!imageUrl) return void res.status(400).json({ error: "imageUrl required" });
  const menuItemId = num(req.body?.menuItemId);
  // If a menuItemId is provided, enforce that it belongs to this restaurant so an
  // approval cannot later overwrite the image of another tenant's menu item.
  if (menuItemId != null && !(await menuItemBelongsTo(restaurantId, menuItemId))) {
    return void res.status(404).json({ error: "Menu item not found" });
  }
  const [row] = await db
    .insert(menuPhotoSubmissionsTable)
    .values({
      restaurantId,
      menuItemId,
      imageUrl,
      caption: trim(req.body?.caption),
      submittedBy: req.user?.sub ?? null,
    })
    .returning();
  await recordAuditLog({ req, module: "menu_intelligence", action: "photo.submitted", entity: "menu_photo_approval", entityId: row.id, restaurantId, newValue: row });
  res.status(201).json(row);
});

router.post("/restaurants/:restaurantId/menu-intel/photo-submissions/:id/review", ownerManager, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const decision = trim(req.body?.decision);
  if (decision !== "approved" && decision !== "rejected") {
    return void res.status(400).json({ error: "decision must be approved or rejected" });
  }
  const [row] = await db
    .update(menuPhotoSubmissionsTable)
    .set({
      status: decision,
      reviewedBy: req.user?.sub ?? null,
      reviewedAt: new Date(),
      reviewNotes: trim(req.body?.reviewNotes),
    })
    .where(and(eq(menuPhotoSubmissionsTable.id, id), eq(menuPhotoSubmissionsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  if (decision === "approved" && row.menuItemId) {
    // Defense-in-depth: only update the menu item image if it still belongs to
    // this restaurant. The submission insert already enforces this, but a future
    // refactor or a row migrated across tenants must not be able to leak through.
    await db
      .update(menuItemsTable)
      .set({ imageUrl: row.imageUrl, updatedAt: new Date() })
      .where(and(eq(menuItemsTable.id, row.menuItemId), eq(menuItemsTable.restaurantId, restaurantId)));
  }
  await recordAuditLog({ req, module: "menu_intelligence", action: `photo.${decision}`, entity: "menu_photo_approval", entityId: id, restaurantId, newValue: row });
  res.json(row);
});

// ─── 11. Brand Asset Library ──────────────────────────────────────
router.use(
  "/restaurants/:restaurantId/menu-intel/brand-assets",
  ownerManager,
  validateRestaurantAccess,
  requirePlanFeature("menu_brand_assets"),
);

router.get("/restaurants/:restaurantId/menu-intel/brand-assets", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const search = trim(req.query.q as string);
  const kindFilter = trim(req.query.kind as string);
  const tagFilter = trim(req.query.tag as string);
  const where = [eq(brandAssetsTable.restaurantId, restaurantId)];
  if (kindFilter) where.push(eq(brandAssetsTable.kind, kindFilter));
  if (search) where.push(sql`${brandAssetsTable.name} ILIKE ${"%" + search + "%"}`);
  if (tagFilter) where.push(sql`${tagFilter} = ANY(${brandAssetsTable.tags})`);
  const rows = await db
    .select()
    .from(brandAssetsTable)
    .where(and(...where))
    .orderBy(desc(brandAssetsTable.createdAt));
  res.json({ data: rows });
});

// Resolve a brand asset download: returns the signed/public file URL plus a name
// and records an audit-log entry so usage is traceable.
router.post("/restaurants/:restaurantId/menu-intel/brand-assets/:id/download", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db
    .select()
    .from(brandAssetsTable)
    .where(and(eq(brandAssetsTable.id, id), eq(brandAssetsTable.restaurantId, restaurantId)));
  if (!row || !row.fileUrl) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "menu_intelligence", action: "brand_asset.downloaded", entity: "brand_asset", entityId: id, restaurantId });
  res.json({ url: row.fileUrl, name: row.name });
});

router.post("/restaurants/:restaurantId/menu-intel/brand-assets", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const name = trim(req.body?.name);
  const kind = trim(req.body?.kind);
  if (!name || !kind) return void res.status(400).json({ error: "name and kind required" });
  const [row] = await db
    .insert(brandAssetsTable)
    .values({
      restaurantId,
      name,
      kind,
      fileUrl: trim(req.body?.fileUrl),
      thumbnailUrl: trim(req.body?.thumbnailUrl),
      meta: req.body?.meta ?? null,
      tags: Array.isArray(req.body?.tags) ? req.body.tags.map(String) : [],
      uploadedBy: req.user?.sub ?? null,
    })
    .returning();
  await recordAuditLog({ req, module: "menu_intelligence", action: "brand_asset.created", entity: "brand_asset", entityId: row.id, restaurantId, newValue: row });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/menu-intel/brand-assets/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["name", "kind", "fileUrl", "thumbnailUrl"]) if (k in (req.body ?? {})) patch[k] = trim((req.body as Record<string, unknown>)[k]);
  if ("meta" in (req.body ?? {})) patch.meta = req.body.meta;
  if (Array.isArray(req.body?.tags)) patch.tags = req.body.tags.map(String);
  const [row] = await db
    .update(brandAssetsTable)
    .set(patch)
    .where(and(eq(brandAssetsTable.id, id), eq(brandAssetsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "menu_intelligence", action: "brand_asset.updated", entity: "brand_asset", entityId: id, restaurantId, newValue: patch });
  res.json(row);
});

router.delete("/restaurants/:restaurantId/menu-intel/brand-assets/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db
    .delete(brandAssetsTable)
    .where(and(eq(brandAssetsTable.id, id), eq(brandAssetsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "menu_intelligence", action: "brand_asset.deleted", entity: "brand_asset", entityId: id, restaurantId, oldValue: row });
  res.json({ ok: true });
});

export default router;
