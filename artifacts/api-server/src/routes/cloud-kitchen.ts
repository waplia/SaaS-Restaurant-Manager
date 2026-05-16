import { Router } from "express";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  brandsTable,
  brandMenuLinksTable,
  packagingItemsTable,
  itemPackagingRequirementsTable,
  orderThrottleRulesTable,
  brandSlaTargetsTable,
  branchesTable,
  ordersTable,
  orderItemsTable,
  kitchenTicketsTable,
  menuItemsTable,
  recipeMappingsTable,
  inventoryItemsTable,
  ORDER_CHANNELS,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { requirePlanFeature } from "../middleware/planFeature";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use(
  "/restaurants/:restaurantId/cloud-kitchen",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("cloud_kitchen"),
);

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "brand";
}

/**
 * Verify that the given branch belongs to the restaurant AND has Cloud Kitchen
 * mode enabled. Returns a friendly error string if not, or null on success.
 * Pass `branchId === null` (brand spans all branches) → require ANY branch enabled.
 */
async function assertBranchCkEnabled(restaurantId: number, branchId: number | null): Promise<string | null> {
  if (branchId == null) {
    const enabled = await db.select({ id: branchesTable.id }).from(branchesTable).where(and(
      eq(branchesTable.restaurantId, restaurantId),
      eq(branchesTable.cloudKitchenEnabled, true),
    )).limit(1);
    return enabled.length > 0 ? null : "Enable Cloud Kitchen mode on at least one branch first.";
  }
  const [b] = await db.select({ id: branchesTable.id, ck: branchesTable.cloudKitchenEnabled })
    .from(branchesTable)
    .where(and(eq(branchesTable.id, branchId), eq(branchesTable.restaurantId, restaurantId)));
  if (!b) return "Branch not found in this restaurant.";
  if (!b.ck) return "Cloud Kitchen mode is not enabled for this branch.";
  return null;
}

async function getBrandScoped(restaurantId: number, brandId: number) {
  const [b] = await db.select().from(brandsTable).where(and(
    eq(brandsTable.id, brandId), eq(brandsTable.restaurantId, restaurantId),
  ));
  return b ?? null;
}

// ───────────────────── Branch toggle ─────────────────────

router.get("/restaurants/:restaurantId/cloud-kitchen/branches", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select({
    id: branchesTable.id,
    name: branchesTable.name,
    cloudKitchenEnabled: branchesTable.cloudKitchenEnabled,
    isActive: branchesTable.isActive,
  }).from(branchesTable).where(eq(branchesTable.restaurantId, restaurantId));
  res.json(rows);
});

router.patch(
  "/restaurants/:restaurantId/cloud-kitchen/branches/:branchId",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const { cloudKitchenEnabled } = req.body as { cloudKitchenEnabled?: boolean };
    if (typeof cloudKitchenEnabled !== "boolean") {
      return void res.status(400).json({ error: "cloudKitchenEnabled boolean required" });
    }
    const [b] = await db.update(branchesTable)
      .set({ cloudKitchenEnabled, updatedAt: new Date() })
      .where(and(eq(branchesTable.id, branchId), eq(branchesTable.restaurantId, restaurantId)))
      .returning();
    if (!b) return void res.status(404).json({ error: "Branch not found" });
    res.json(b);
  },
);

// ───────────────────── Channels (catalogue) ─────────────────────

router.get("/restaurants/:restaurantId/cloud-kitchen/channels", async (_req, res) => {
  res.json(ORDER_CHANNELS.map(k => ({ key: k, label: k.replace(/_/g, " ") })));
});

// ───────────────────── Brands CRUD ─────────────────────

router.get("/restaurants/:restaurantId/cloud-kitchen/brands", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(brandsTable).where(eq(brandsTable.restaurantId, restaurantId)).orderBy(brandsTable.name);
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/cloud-kitchen/brands",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { name, branchId, logoUrl, primaryColor, fssaiNumber, gstNumber, channelConfig, slug } = req.body as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) return void res.status(400).json({ error: "name required" });
    const branchIdNum = typeof branchId === "number" ? branchId : null;
    const ckErr = await assertBranchCkEnabled(restaurantId, branchIdNum);
    if (ckErr) return void res.status(400).json({ error: ckErr });
    const finalSlug = typeof slug === "string" && slug.trim() ? slugify(slug) : slugify(name);
    try {
      const [b] = await db.insert(brandsTable).values({
        restaurantId,
        branchId: branchIdNum,
        name: name.trim(),
        slug: finalSlug,
        logoUrl: typeof logoUrl === "string" ? logoUrl : null,
        primaryColor: typeof primaryColor === "string" ? primaryColor : "#f97316",
        fssaiNumber: typeof fssaiNumber === "string" ? fssaiNumber : null,
        gstNumber: typeof gstNumber === "string" ? gstNumber : null,
        channelConfig: (channelConfig && typeof channelConfig === "object" ? channelConfig : {}) as Record<string, { externalId?: string; commissionPct?: number; enabled?: boolean }>,
      }).returning();
      res.status(201).json(b);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "insert failed";
      if (/unique/i.test(msg)) return void res.status(409).json({ error: "Brand slug already exists" });
      res.status(500).json({ error: msg });
    }
  },
);

router.patch(
  "/restaurants/:restaurantId/cloud-kitchen/brands/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;
    const update: Partial<typeof brandsTable.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.name === "string") update.name = body.name.trim();
    if (typeof body.slug === "string") update.slug = slugify(body.slug);
    if (typeof body.branchId === "number" || body.branchId === null) {
      const ckErr = await assertBranchCkEnabled(restaurantId, body.branchId as number | null);
      if (ckErr) return void res.status(400).json({ error: ckErr });
      update.branchId = body.branchId as number | null;
    }
    if (typeof body.logoUrl === "string" || body.logoUrl === null) update.logoUrl = body.logoUrl as string | null;
    if (typeof body.primaryColor === "string") update.primaryColor = body.primaryColor;
    if (typeof body.fssaiNumber === "string" || body.fssaiNumber === null) update.fssaiNumber = body.fssaiNumber as string | null;
    if (typeof body.gstNumber === "string" || body.gstNumber === null) update.gstNumber = body.gstNumber as string | null;
    if (typeof body.isActive === "boolean") update.isActive = body.isActive;
    if (body.channelConfig && typeof body.channelConfig === "object") update.channelConfig = body.channelConfig as Record<string, { externalId?: string; commissionPct?: number; enabled?: boolean }>;
    const [b] = await db.update(brandsTable)
      .set(update)
      .where(and(eq(brandsTable.id, id), eq(brandsTable.restaurantId, restaurantId)))
      .returning();
    if (!b) return void res.status(404).json({ error: "Not found" });
    res.json(b);
  },
);

router.delete(
  "/restaurants/:restaurantId/cloud-kitchen/brands/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    await db.delete(brandsTable).where(and(eq(brandsTable.id, id), eq(brandsTable.restaurantId, restaurantId)));
    res.json({ ok: true });
  },
);

// ───────────────────── Brand menu links / pricing overrides ─────────────────────

router.get("/restaurants/:restaurantId/cloud-kitchen/brands/:id/menu", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const brandId = Number(req.params.id);
  const rows = await db.select({
    link: brandMenuLinksTable,
    item: menuItemsTable,
  }).from(brandMenuLinksTable)
    .innerJoin(menuItemsTable, eq(menuItemsTable.id, brandMenuLinksTable.menuItemId))
    .where(and(eq(brandMenuLinksTable.brandId, brandId), eq(brandMenuLinksTable.restaurantId, restaurantId)));
  res.json(rows.map(r => ({ ...r.link, item: r.item })));
});

router.put(
  "/restaurants/:restaurantId/cloud-kitchen/brands/:id/menu",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const brandId = Number(req.params.id);
    const links = (req.body?.links ?? []) as Array<{
      menuItemId: number; priceOverride?: string | null; taxRateOverride?: string | null; isAvailable?: boolean;
    }>;
    if (!Array.isArray(links)) return void res.status(400).json({ error: "links array required" });
    const [brand] = await db.select().from(brandsTable).where(and(eq(brandsTable.id, brandId), eq(brandsTable.restaurantId, restaurantId)));
    if (!brand) return void res.status(404).json({ error: "Brand not found" });

    await db.delete(brandMenuLinksTable).where(and(eq(brandMenuLinksTable.brandId, brandId), eq(brandMenuLinksTable.restaurantId, restaurantId)));
    if (links.length > 0) {
      await db.insert(brandMenuLinksTable).values(links.map(l => ({
        brandId,
        restaurantId,
        menuItemId: Number(l.menuItemId),
        priceOverride: l.priceOverride ?? null,
        taxRateOverride: l.taxRateOverride ?? null,
        isAvailable: l.isAvailable !== false,
      })));
    }
    res.json({ ok: true, count: links.length });
  },
);

// ───────────────────── Packaging items ─────────────────────

router.get("/restaurants/:restaurantId/cloud-kitchen/packaging", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(packagingItemsTable).where(eq(packagingItemsTable.restaurantId, restaurantId)).orderBy(packagingItemsTable.name);
  res.json(rows.map(r => ({
    ...r,
    isLow: Number(r.currentStock) <= Number(r.minStockLevel),
  })));
});

router.post(
  "/restaurants/:restaurantId/cloud-kitchen/packaging",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { name, unit, currentStock, minStockLevel, costPerUnit } = req.body as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) return void res.status(400).json({ error: "name required" });
    const [r] = await db.insert(packagingItemsTable).values({
      restaurantId,
      name: name.trim(),
      unit: typeof unit === "string" ? unit : "piece",
      currentStock: currentStock != null ? String(currentStock) : "0.000",
      minStockLevel: minStockLevel != null ? String(minStockLevel) : "0.000",
      costPerUnit: costPerUnit != null ? String(costPerUnit) : "0.00",
    }).returning();
    res.status(201).json(r);
  },
);

router.patch(
  "/restaurants/:restaurantId/cloud-kitchen/packaging/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;
    const update: Partial<typeof packagingItemsTable.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.name === "string") update.name = body.name.trim();
    if (typeof body.unit === "string") update.unit = body.unit;
    if (body.currentStock != null) update.currentStock = String(body.currentStock);
    if (body.minStockLevel != null) update.minStockLevel = String(body.minStockLevel);
    if (body.costPerUnit != null) update.costPerUnit = String(body.costPerUnit);
    if (typeof body.isActive === "boolean") update.isActive = body.isActive;
    const [r] = await db.update(packagingItemsTable).set(update)
      .where(and(eq(packagingItemsTable.id, id), eq(packagingItemsTable.restaurantId, restaurantId)))
      .returning();
    if (!r) return void res.status(404).json({ error: "Not found" });
    res.json(r);
  },
);

router.delete(
  "/restaurants/:restaurantId/cloud-kitchen/packaging/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    await db.delete(packagingItemsTable).where(and(eq(packagingItemsTable.id, id), eq(packagingItemsTable.restaurantId, restaurantId)));
    res.json({ ok: true });
  },
);

// Item packaging requirements
router.get("/restaurants/:restaurantId/cloud-kitchen/items/:itemId/packaging", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.itemId);
  const rows = await db.select().from(itemPackagingRequirementsTable).where(
    and(eq(itemPackagingRequirementsTable.menuItemId, itemId), eq(itemPackagingRequirementsTable.restaurantId, restaurantId)),
  );
  res.json(rows);
});

router.put(
  "/restaurants/:restaurantId/cloud-kitchen/items/:itemId/packaging",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const itemId = Number(req.params.itemId);
    const reqs = (req.body?.requirements ?? []) as Array<{ packagingItemId: number; quantity: number | string }>;
    if (!Array.isArray(reqs)) return void res.status(400).json({ error: "requirements array required" });

    // Tenant isolation: menu item must belong to restaurant
    const [mi] = await db.select({ id: menuItemsTable.id }).from(menuItemsTable).where(and(
      eq(menuItemsTable.id, itemId), eq(menuItemsTable.restaurantId, restaurantId),
    ));
    if (!mi) return void res.status(404).json({ error: "Menu item not found in this restaurant" });

    // Tenant isolation: every packagingItemId must belong to the same restaurant
    const requestedPkgIds = Array.from(new Set(reqs.map(r => Number(r.packagingItemId))));
    if (requestedPkgIds.length > 0) {
      const owned = await db.select({ id: packagingItemsTable.id }).from(packagingItemsTable).where(and(
        inArray(packagingItemsTable.id, requestedPkgIds),
        eq(packagingItemsTable.restaurantId, restaurantId),
      ));
      if (owned.length !== requestedPkgIds.length) {
        return void res.status(400).json({ error: "One or more packaging items don't belong to this restaurant" });
      }
    }

    await db.delete(itemPackagingRequirementsTable).where(
      and(eq(itemPackagingRequirementsTable.menuItemId, itemId), eq(itemPackagingRequirementsTable.restaurantId, restaurantId)),
    );
    if (reqs.length > 0) {
      await db.insert(itemPackagingRequirementsTable).values(reqs.map(r => ({
        restaurantId,
        menuItemId: itemId,
        packagingItemId: Number(r.packagingItemId),
        quantity: String(r.quantity ?? "1"),
      })));
    }
    res.json({ ok: true });
  },
);

// ───────────────────── Throttle rules ─────────────────────

router.get("/restaurants/:restaurantId/cloud-kitchen/throttle", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(orderThrottleRulesTable).where(eq(orderThrottleRulesTable.restaurantId, restaurantId));
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/cloud-kitchen/throttle",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { brandId, channelKey, isPaused, pauseMinutes, maxOrdersPerHour, note } = req.body as Record<string, unknown>;
    const pauseUntil = isPaused && typeof pauseMinutes === "number" && pauseMinutes > 0
      ? new Date(Date.now() + pauseMinutes * 60_000) : null;

    const existing = await db.select().from(orderThrottleRulesTable).where(and(
      eq(orderThrottleRulesTable.restaurantId, restaurantId),
      brandId != null ? eq(orderThrottleRulesTable.brandId, Number(brandId)) : sql`brand_id IS NULL`,
      typeof channelKey === "string" ? eq(orderThrottleRulesTable.channelKey, channelKey) : sql`channel_key IS NULL`,
    ));

    if (existing.length > 0) {
      const [r] = await db.update(orderThrottleRulesTable).set({
        isPaused: Boolean(isPaused),
        pauseUntil,
        maxOrdersPerHour: typeof maxOrdersPerHour === "number" ? maxOrdersPerHour : null,
        note: typeof note === "string" ? note : null,
        updatedAt: new Date(),
      }).where(eq(orderThrottleRulesTable.id, existing[0].id)).returning();
      return void res.json(r);
    }

    const [r] = await db.insert(orderThrottleRulesTable).values({
      restaurantId,
      brandId: brandId != null ? Number(brandId) : null,
      channelKey: typeof channelKey === "string" ? channelKey : null,
      isPaused: Boolean(isPaused),
      pauseUntil,
      maxOrdersPerHour: typeof maxOrdersPerHour === "number" ? maxOrdersPerHour : null,
      note: typeof note === "string" ? note : null,
    }).returning();
    res.status(201).json(r);
  },
);

router.delete(
  "/restaurants/:restaurantId/cloud-kitchen/throttle/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    await db.delete(orderThrottleRulesTable).where(and(
      eq(orderThrottleRulesTable.id, id), eq(orderThrottleRulesTable.restaurantId, restaurantId),
    ));
    res.json({ ok: true });
  },
);

// Check throttle (utility — also exported below for use in orders intake)
export async function checkThrottle(
  restaurantId: number,
  brandId: number | null,
  channelKey: string | null,
): Promise<{ allowed: boolean; reason?: string }> {
  const rules = await db.select().from(orderThrottleRulesTable).where(eq(orderThrottleRulesTable.restaurantId, restaurantId));
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600_000);

  // Match most-specific first (brand+channel) then brand-only, then channel-only, then global
  const candidates = rules.filter(r =>
    (r.brandId === brandId || r.brandId === null) &&
    (r.channelKey === channelKey || r.channelKey === null),
  );
  for (const r of candidates) {
    const paused = r.isPaused && (!r.pauseUntil || r.pauseUntil > now);
    if (paused) return { allowed: false, reason: r.note ?? "Orders are paused for this brand/channel" };
    if (r.maxOrdersPerHour && r.maxOrdersPerHour > 0) {
      const conds = [eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, oneHourAgo)];
      if (r.brandId != null) conds.push(eq(ordersTable.brandId, r.brandId));
      if (r.channelKey) conds.push(eq(ordersTable.channelKey, r.channelKey));
      const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(and(...conds));
      if (Number(c) >= r.maxOrdersPerHour) {
        return { allowed: false, reason: `Rate limit reached (${r.maxOrdersPerHour}/hr)` };
      }
    }
  }
  return { allowed: true };
}

// ───────────────────── SLA targets ─────────────────────

router.get("/restaurants/:restaurantId/cloud-kitchen/sla", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(brandSlaTargetsTable).where(eq(brandSlaTargetsTable.restaurantId, restaurantId));
  res.json(rows);
});

router.put(
  "/restaurants/:restaurantId/cloud-kitchen/sla",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { brandId, channelKey, prepMinutes, handoverMinutes } = req.body as Record<string, unknown>;
    if (typeof brandId !== "number" || typeof channelKey !== "string") {
      return void res.status(400).json({ error: "brandId and channelKey required" });
    }
    const existing = await db.select().from(brandSlaTargetsTable).where(and(
      eq(brandSlaTargetsTable.brandId, brandId), eq(brandSlaTargetsTable.channelKey, channelKey),
    ));
    if (existing.length > 0) {
      const [r] = await db.update(brandSlaTargetsTable).set({
        prepMinutes: typeof prepMinutes === "number" ? prepMinutes : existing[0].prepMinutes,
        handoverMinutes: typeof handoverMinutes === "number" ? handoverMinutes : existing[0].handoverMinutes,
        updatedAt: new Date(),
      }).where(eq(brandSlaTargetsTable.id, existing[0].id)).returning();
      return void res.json(r);
    }
    const [r] = await db.insert(brandSlaTargetsTable).values({
      restaurantId, brandId, channelKey,
      prepMinutes: typeof prepMinutes === "number" ? prepMinutes : 20,
      handoverMinutes: typeof handoverMinutes === "number" ? handoverMinutes : 10,
    }).returning();
    res.status(201).json(r);
  },
);

// ───────────────────── Aggregator webhook stub ─────────────────────

router.post("/restaurants/:restaurantId/cloud-kitchen/aggregator-webhook", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const payload = req.body as Record<string, unknown>;
  // Stub — store as a JSON note on a synthetic order is out of scope. For now,
  // log and acknowledge so external aggregators can be hooked up later.
  console.log("[cloud-kitchen] aggregator webhook", { restaurantId, payload });
  res.json({ ok: true, received: true, restaurantId });
});

// ───────────────────── Multi-channel orders view ─────────────────────

router.get("/restaurants/:restaurantId/cloud-kitchen/orders", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const brandId = req.query.brandId ? Number(req.query.brandId) : null;
  const channelKey = req.query.channelKey ? String(req.query.channelKey) : null;
  const status = req.query.status ? String(req.query.status) : null;

  const conds = [eq(ordersTable.restaurantId, restaurantId)];
  if (brandId) conds.push(eq(ordersTable.brandId, brandId));
  if (channelKey) conds.push(eq(ordersTable.channelKey, channelKey));
  if (status) conds.push(eq(ordersTable.status, status));
  // Last 24h to keep this snappy
  conds.push(gte(ordersTable.createdAt, new Date(Date.now() - 86_400_000)));

  const rows = await db.select().from(ordersTable).where(and(...conds)).orderBy(desc(ordersTable.createdAt)).limit(200);

  const orderIds = rows.map(r => r.id);
  const items = orderIds.length === 0 ? [] : await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds));
  const itemMap = new Map<number, typeof items>();
  for (const it of items) {
    const arr = itemMap.get(it.orderId) ?? [];
    arr.push(it);
    itemMap.set(it.orderId, arr);
  }

  res.json(rows.map(o => ({
    ...o,
    items: itemMap.get(o.id) ?? [],
    slaCountdownSec: o.slaTargetAt ? Math.round((new Date(o.slaTargetAt).getTime() - Date.now()) / 1000) : null,
  })));
});

// ───────────────────── Manual cloud-kitchen order intake ─────────────────────

router.post(
  "/restaurants/:restaurantId/cloud-kitchen/orders",
  requireRole("owner", "manager", "waiter", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const {
      brandId, channelKey, channelExternalOrderId,
      items, customerName, customerPhone, notes,
    } = req.body as {
      brandId: number; channelKey: string; channelExternalOrderId?: string;
      items: Array<{ menuItemId: number; quantity: number; notes?: string }>;
      customerName?: string; customerPhone?: string; notes?: string;
    };
    if (!brandId || !channelKey || !Array.isArray(items) || items.length === 0) {
      return void res.status(400).json({ error: "brandId, channelKey, items required" });
    }
    if (!ORDER_CHANNELS.includes(channelKey as typeof ORDER_CHANNELS[number])) {
      return void res.status(400).json({ error: "invalid channelKey" });
    }

    const brand = await getBrandScoped(restaurantId, brandId);
    if (!brand) return void res.status(404).json({ error: "Brand not found" });

    const ckErr = await assertBranchCkEnabled(restaurantId, brand.branchId);
    if (ckErr) return void res.status(400).json({ error: ckErr });

    const throttle = await checkThrottle(restaurantId, brandId, channelKey);
    if (!throttle.allowed) return void res.status(429).json({ error: throttle.reason ?? "Throttled" });

    // Resolve menu items, ENFORCING that each item is linked + available for this brand
    const itemIds = items.map(i => Number(i.menuItemId));
    const menuRows = await db.select().from(menuItemsTable).where(and(
      inArray(menuItemsTable.id, itemIds), eq(menuItemsTable.restaurantId, restaurantId),
    ));
    const linkRows = await db.select().from(brandMenuLinksTable).where(and(
      eq(brandMenuLinksTable.brandId, brandId),
      eq(brandMenuLinksTable.restaurantId, restaurantId),
      inArray(brandMenuLinksTable.menuItemId, itemIds),
    ));
    const menuMap = new Map(menuRows.map(m => [m.id, m]));
    const linkMap = new Map(linkRows.map(l => [l.menuItemId, l]));

    let subtotal = 0;
    let taxAmount = 0;
    const orderItemsToInsert: Array<{
      menuItemId: number; menuItemName: string; quantity: number; unitPrice: string; totalPrice: string; notes: string | null;
    }> = [];
    for (const it of items) {
      const m = menuMap.get(Number(it.menuItemId));
      if (!m) return void res.status(400).json({ error: `Menu item ${it.menuItemId} not found` });
      const link = linkMap.get(m.id);
      if (!link || !link.isAvailable) {
        return void res.status(400).json({ error: `${m.name} isn't available for ${brand.name}` });
      }
      const price = Number(link.priceOverride ?? m.price);
      const taxRate = Number(link.taxRateOverride ?? m.taxRate ?? 0);
      const lineTotal = price * Number(it.quantity);
      subtotal += lineTotal;
      taxAmount += lineTotal * (taxRate / 100);
      orderItemsToInsert.push({
        menuItemId: m.id, menuItemName: m.name, quantity: Number(it.quantity),
        unitPrice: price.toFixed(2), totalPrice: lineTotal.toFixed(2),
        notes: it.notes ?? null,
      });
    }

    // Packaging snapshot + deduction (restaurant-scoped reads)
    const reqs = await db.select().from(itemPackagingRequirementsTable).where(and(
      eq(itemPackagingRequirementsTable.restaurantId, restaurantId),
      inArray(itemPackagingRequirementsTable.menuItemId, itemIds),
    ));
    const pkgIds = Array.from(new Set(reqs.map(r => r.packagingItemId)));
    const pkgs = pkgIds.length === 0 ? [] : await db.select().from(packagingItemsTable).where(and(
      inArray(packagingItemsTable.id, pkgIds),
      eq(packagingItemsTable.restaurantId, restaurantId),
    ));
    const pkgMap = new Map(pkgs.map(p => [p.id, p]));
    const pkgUsage = new Map<number, number>();
    for (const r of reqs) {
      const it = items.find(i => Number(i.menuItemId) === r.menuItemId);
      if (!it) continue;
      pkgUsage.set(r.packagingItemId, (pkgUsage.get(r.packagingItemId) ?? 0) + Number(r.quantity) * Number(it.quantity));
    }
    const packagingSnapshot: Array<{ packagingItemId: number; name: string; quantity: number; costPerUnit: string }> = [];
    for (const [pkgId, qty] of pkgUsage) {
      const p = pkgMap.get(pkgId);
      if (!p) continue;
      packagingSnapshot.push({ packagingItemId: pkgId, name: p.name, quantity: qty, costPerUnit: p.costPerUnit });
    }

    // SLA target
    const [sla] = await db.select().from(brandSlaTargetsTable).where(and(
      eq(brandSlaTargetsTable.brandId, brandId), eq(brandSlaTargetsTable.channelKey, channelKey),
    ));
    const slaMinutes = sla ? sla.prepMinutes + sla.handoverMinutes : 30;
    const slaTargetAt = new Date(Date.now() + slaMinutes * 60_000);

    const channelCfg = brand.channelConfig?.[channelKey] ?? {};
    const commissionPct = typeof channelCfg.commissionPct === "number" ? channelCfg.commissionPct.toFixed(2) : null;
    const total = subtotal + taxAmount;
    const orderNumber = `CK-${brand.slug.toUpperCase().slice(0, 4)}-${Date.now().toString().slice(-6)}`;

    const [order] = await db.insert(ordersTable).values({
      restaurantId,
      orderNumber,
      orderType: channelKey === "dine_in" ? "dine_in" : channelKey === "takeaway" ? "takeaway" : "delivery",
      status: "pending",
      paymentStatus: "unpaid",
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      totalAmount: total.toFixed(2),
      notes: notes ?? null,
      customerName: customerName ?? null,
      customerPhone: customerPhone ?? null,
      brandId,
      channelKey,
      channelExternalOrderId: channelExternalOrderId ?? null,
      channelCommissionPct: commissionPct,
      packagingSnapshot,
      slaTargetAt,
    }).returning();

    if (orderItemsToInsert.length > 0) {
      await db.insert(orderItemsTable).values(orderItemsToInsert.map(oi => ({ ...oi, orderId: order.id })));
    }

    // Deduct packaging stock
    for (const [pkgId, qty] of pkgUsage) {
      await db.update(packagingItemsTable).set({
        currentStock: sql`${packagingItemsTable.currentStock} - ${qty}`,
        updatedAt: new Date(),
      }).where(and(eq(packagingItemsTable.id, pkgId), eq(packagingItemsTable.restaurantId, restaurantId)));
    }

    // Auto-create kitchen ticket tagged with brand + channel
    const pkgNote = packagingSnapshot.map(p => `${p.name}×${p.quantity}`).join(", ");
    await db.insert(kitchenTicketsTable).values({
      orderId: order.id,
      restaurantId,
      status: "new",
      brandId,
      channelKey,
      packagingNotes: pkgNote || null,
      expectedPrepMinutes: sla?.prepMinutes ?? 20,
      expectedReadyAt: new Date(Date.now() + (sla?.prepMinutes ?? 20) * 60_000),
    });

    res.status(201).json(order);
  },
);

// ───────────────────── Brand Performance Dashboard ─────────────────────

router.get("/restaurants/:restaurantId/cloud-kitchen/dashboard", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const fromStr = req.query.from ? String(req.query.from) : null;
  const toStr = req.query.to ? String(req.query.to) : null;
  const to = toStr ? new Date(toStr) : new Date();
  const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 30 * 86_400_000);

  const brands = await db.select().from(brandsTable).where(eq(brandsTable.restaurantId, restaurantId));
  const orders = await db.select().from(ordersTable).where(and(
    eq(ordersTable.restaurantId, restaurantId),
    gte(ordersTable.createdAt, from),
    lte(ordersTable.createdAt, to),
  ));
  const orderIds = orders.map(o => o.id);
  const items = orderIds.length === 0 ? [] : await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds));
  const tickets = orderIds.length === 0 ? [] : await db.select().from(kitchenTicketsTable).where(inArray(kitchenTicketsTable.orderId, orderIds));
  const ticketByOrder = new Map(tickets.map(t => [t.orderId, t]));

  // Recipe ingredient cost lookup (shared inventory)
  const menuItemIds = Array.from(new Set(items.map(i => i.menuItemId)));
  const recipes = menuItemIds.length === 0 ? [] : await db.select().from(recipeMappingsTable).where(and(
    eq(recipeMappingsTable.restaurantId, restaurantId), inArray(recipeMappingsTable.menuItemId, menuItemIds),
  ));
  const invIds = Array.from(new Set(recipes.map(r => r.inventoryItemId)));
  const inv = invIds.length === 0 ? [] : await db.select().from(inventoryItemsTable).where(inArray(inventoryItemsTable.id, invIds));
  const invMap = new Map(inv.map(i => [i.id, i]));
  const ingredientCostPerItem = new Map<number, number>();
  for (const r of recipes) {
    const i = invMap.get(r.inventoryItemId);
    if (!i) continue;
    ingredientCostPerItem.set(r.menuItemId, (ingredientCostPerItem.get(r.menuItemId) ?? 0) + Number(r.quantity) * Number(i.costPerUnit));
  }

  const itemsByOrder = new Map<number, typeof items>();
  for (const it of items) {
    const arr = itemsByOrder.get(it.orderId) ?? [];
    arr.push(it);
    itemsByOrder.set(it.orderId, arr);
  }

  type BrandAgg = {
    brandId: number | null; brandName: string; brandColor: string | null;
    revenue: number; orders: number; aov: number;
    ingredientCost: number; packagingCost: number; commissionCost: number; discounts: number;
    grossProfit: number;
    prepSumMs: number; prepCount: number; slaBreaches: number;
    channelMix: Record<string, number>;
    topItems: Map<number, { name: string; qty: number; revenue: number }>;
  };
  const agg = new Map<number | null, BrandAgg>();
  const brandMap = new Map(brands.map(b => [b.id, b]));

  for (const o of orders) {
    const bid = o.brandId ?? null;
    const brand = bid != null ? brandMap.get(bid) : null;
    let a = agg.get(bid);
    if (!a) {
      a = {
        brandId: bid, brandName: brand?.name ?? "Unbranded", brandColor: brand?.primaryColor ?? null,
        revenue: 0, orders: 0, aov: 0,
        ingredientCost: 0, packagingCost: 0, commissionCost: 0, discounts: 0,
        grossProfit: 0, prepSumMs: 0, prepCount: 0, slaBreaches: 0,
        channelMix: {},
        topItems: new Map(),
      };
      agg.set(bid, a);
    }
    const rev = Number(o.totalAmount);
    a.revenue += rev;
    a.orders++;
    a.discounts += Number(o.discountAmount);
    if (o.channelCommissionPct) a.commissionCost += rev * Number(o.channelCommissionPct) / 100;
    const ch = o.channelKey ?? "unknown";
    a.channelMix[ch] = (a.channelMix[ch] ?? 0) + rev;
    if (o.packagingSnapshot) {
      for (const p of o.packagingSnapshot) {
        a.packagingCost += Number(p.quantity) * Number(p.costPerUnit);
      }
    }
    const its = itemsByOrder.get(o.id) ?? [];
    for (const it of its) {
      const cost = ingredientCostPerItem.get(it.menuItemId) ?? 0;
      a.ingredientCost += cost * Number(it.quantity);
      const ti = a.topItems.get(it.menuItemId) ?? { name: it.menuItemName, qty: 0, revenue: 0 };
      ti.qty += Number(it.quantity);
      ti.revenue += Number(it.totalPrice);
      a.topItems.set(it.menuItemId, ti);
    }
    const ticket = ticketByOrder.get(o.id);
    if (ticket?.completedAt) {
      const start = ticket.startedAt ? new Date(ticket.startedAt).getTime() : new Date(ticket.createdAt).getTime();
      a.prepSumMs += new Date(ticket.completedAt).getTime() - start;
      a.prepCount++;
    }
    if (o.slaTargetAt) {
      const completedAt = ticket?.completedAt ? new Date(ticket.completedAt) : null;
      if (completedAt && completedAt > new Date(o.slaTargetAt)) a.slaBreaches++;
      else if (!completedAt && new Date(o.slaTargetAt) < new Date() && o.status !== "completed" && o.status !== "cancelled") a.slaBreaches++;
    }
  }

  const brandsResult = Array.from(agg.values()).map(a => {
    a.aov = a.orders > 0 ? a.revenue / a.orders : 0;
    a.grossProfit = a.revenue - a.ingredientCost - a.packagingCost - a.commissionCost - a.discounts;
    return {
      brandId: a.brandId,
      brandName: a.brandName,
      brandColor: a.brandColor,
      revenue: a.revenue.toFixed(2),
      orders: a.orders,
      aov: a.aov.toFixed(2),
      ingredientCost: a.ingredientCost.toFixed(2),
      packagingCost: a.packagingCost.toFixed(2),
      commissionCost: a.commissionCost.toFixed(2),
      discounts: a.discounts.toFixed(2),
      grossProfit: a.grossProfit.toFixed(2),
      avgPrepMinutes: a.prepCount > 0 ? Number(((a.prepSumMs / a.prepCount) / 60_000).toFixed(1)) : null,
      slaBreaches: a.slaBreaches,
      slaBreachPct: a.orders > 0 ? Number(((a.slaBreaches / a.orders) * 100).toFixed(1)) : 0,
      channelMix: Object.entries(a.channelMix).map(([channel, revenue]) => ({ channel, revenue: revenue.toFixed(2) })),
      topItems: Array.from(a.topItems.values()).sort((x, y) => y.qty - x.qty).slice(0, 5).map(t => ({ ...t, revenue: t.revenue.toFixed(2) })),
    };
  }).sort((a, b) => Number(b.revenue) - Number(a.revenue));

  // Consolidated totals
  const totalRevenue = brandsResult.reduce((s, b) => s + Number(b.revenue), 0);
  const totalOrders = brandsResult.reduce((s, b) => s + b.orders, 0);
  const totalProfit = brandsResult.reduce((s, b) => s + Number(b.grossProfit), 0);
  const totalSlaBreaches = brandsResult.reduce((s, b) => s + b.slaBreaches, 0);

  res.json({
    window: { from: from.toISOString(), to: to.toISOString() },
    consolidated: {
      revenue: totalRevenue.toFixed(2),
      orders: totalOrders,
      aov: totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : "0.00",
      grossProfit: totalProfit.toFixed(2),
      slaBreaches: totalSlaBreaches,
      slaBreachPct: totalOrders > 0 ? Number(((totalSlaBreaches / totalOrders) * 100).toFixed(1)) : 0,
    },
    brands: brandsResult,
  });
});

export default router;
