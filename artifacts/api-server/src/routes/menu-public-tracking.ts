import { Router } from "express";
import { and, eq, sql, desc } from "drizzle-orm";
import { createHash } from "crypto";
import {
  db,
  restaurantsTable,
  menuItemEventsTable,
  menuSearchesTable,
  menuAbExperimentsTable,
  menuAbAssignmentsTable,
  menuGroupSessionsTable,
  menuGroupMembersTable,
  menuItemsTable,
  brandAssetsTable,
  tenantsTable,
  subscriptionPlansTable,
  isFeatureEnabled,
} from "../lib/db";

const router = Router();

async function resolveRestaurantBySlug(slug: string): Promise<number | null> {
  const [r] = await db
    .select({ id: restaurantsTable.id })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.slug, slug));
  return r?.id ?? null;
}

async function featureOn(restaurantId: number, key: string): Promise<boolean> {
  const [row] = await db
    .select({ planId: tenantsTable.planId })
    .from(restaurantsTable)
    .innerJoin(tenantsTable, eq(restaurantsTable.tenantId, tenantsTable.id))
    .where(eq(restaurantsTable.id, restaurantId));
  if (!row?.planId) return true;
  const [plan] = await db
    .select({ featureFlags: subscriptionPlansTable.featureFlags })
    .from(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.id, row.planId));
  if (!plan) return true;
  return isFeatureEnabled(plan.featureFlags, key);
}

function normalize(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, " ").slice(0, 200);
}

// ─── QR menu tracking (heatmap impressions, clicks, search) ───────
router.post("/public/restaurants/:slug/menu/track", async (req, res) => {
  const restaurantId = await resolveRestaurantBySlug(req.params.slug);
  if (!restaurantId) return void res.status(404).json({ error: "Not found" });
  const events: Array<{ menuItemId?: number; eventType?: string; variantKey?: string; sessionId?: string; tableId?: number; metadata?: unknown }> =
    Array.isArray(req.body?.events) ? req.body.events : [];
  if (events.length === 0) return void res.json({ ok: true, count: 0 });
  if (!(await featureOn(restaurantId, "menu_heatmap"))) return void res.json({ ok: true, count: 0 });

  const rows = events
    .filter((e) => e && typeof e.eventType === "string")
    .slice(0, 200)
    .map((e) => ({
      restaurantId,
      menuItemId: e.menuItemId ?? null,
      sessionId: e.sessionId ?? null,
      tableId: e.tableId ?? null,
      eventType: String(e.eventType).slice(0, 32),
      variantKey: e.variantKey ?? null,
      metadata: (e.metadata ?? null) as Record<string, unknown> | null,
    }));
  if (rows.length > 0) await db.insert(menuItemEventsTable).values(rows);
  res.json({ ok: true, count: rows.length });
});

router.post("/public/restaurants/:slug/menu/search", async (req, res) => {
  const restaurantId = await resolveRestaurantBySlug(req.params.slug);
  if (!restaurantId) return void res.status(404).json({ error: "Not found" });
  if (!(await featureOn(restaurantId, "menu_search_analytics"))) return void res.json({ ok: true });
  const query = String(req.body?.query ?? "").slice(0, 200);
  if (!query.trim()) return void res.status(400).json({ error: "query required" });
  await db.insert(menuSearchesTable).values({
    restaurantId,
    query,
    normalizedQuery: normalize(query),
    resultsCount: Number(req.body?.resultsCount ?? 0),
    sessionId: req.body?.sessionId ?? null,
    tableId: req.body?.tableId ?? null,
  });
  res.json({ ok: true });
});

// ─── QR A/B assignment ────────────────────────────────────────────
router.get("/public/restaurants/:slug/menu/ab/:experimentId", async (req, res) => {
  const restaurantId = await resolveRestaurantBySlug(req.params.slug);
  if (!restaurantId) return void res.status(404).json({ error: "Not found" });
  if (!(await featureOn(restaurantId, "menu_ab_tests"))) return void res.status(403).json({ error: "Feature off" });
  const experimentId = Number(req.params.experimentId);
  const sessionId = String(req.query.sessionId ?? "");
  if (!sessionId) return void res.status(400).json({ error: "sessionId required" });

  const [exp] = await db
    .select()
    .from(menuAbExperimentsTable)
    .where(and(eq(menuAbExperimentsTable.id, experimentId), eq(menuAbExperimentsTable.restaurantId, restaurantId)));
  if (!exp || exp.status !== "running") return void res.status(404).json({ error: "Experiment not running" });

  const hash = createHash("sha1").update(`${experimentId}:${sessionId}`).digest();
  const variant = hash[0] % 2 === 0 ? "a" : "b";

  const [existing] = await db
    .select()
    .from(menuAbAssignmentsTable)
    .where(and(eq(menuAbAssignmentsTable.experimentId, experimentId), eq(menuAbAssignmentsTable.sessionId, sessionId)));
  if (!existing) {
    await db.insert(menuAbAssignmentsTable).values({ experimentId, sessionId, variant });
  }
  res.json({ experimentId, variant, experiment: exp });
});

router.post("/public/restaurants/:slug/menu/ab/:experimentId/event", async (req, res) => {
  const restaurantId = await resolveRestaurantBySlug(req.params.slug);
  if (!restaurantId) return void res.status(404).json({ error: "Not found" });
  if (!(await featureOn(restaurantId, "menu_ab_tests"))) return void res.status(403).json({ error: "Feature off" });
  const experimentId = Number(req.params.experimentId);
  const sessionId = String(req.body?.sessionId ?? "");
  const kind = String(req.body?.kind ?? "");
  if (!sessionId || !["impression", "click", "order"].includes(kind)) {
    return void res.status(400).json({ error: "sessionId and kind required" });
  }
  // Verify experiment belongs to this restaurant AND is running, before mutating any counter.
  const [exp] = await db
    .select({ id: menuAbExperimentsTable.id, status: menuAbExperimentsTable.status })
    .from(menuAbExperimentsTable)
    .where(and(eq(menuAbExperimentsTable.id, experimentId), eq(menuAbExperimentsTable.restaurantId, restaurantId)));
  if (!exp || exp.status !== "running") return void res.status(404).json({ error: "Experiment not running" });

  // Ensure an assignment exists for this session before incrementing counters,
  // otherwise the UPDATE would no-op and we'd silently lose analytics.
  const [existing] = await db
    .select({ id: menuAbAssignmentsTable.id })
    .from(menuAbAssignmentsTable)
    .where(and(eq(menuAbAssignmentsTable.experimentId, experimentId), eq(menuAbAssignmentsTable.sessionId, sessionId)));
  if (!existing) {
    const hash = createHash("sha1").update(`${experimentId}:${sessionId}`).digest();
    const variant = hash[0] % 2 === 0 ? "a" : "b";
    await db.insert(menuAbAssignmentsTable).values({ experimentId, sessionId, variant });
  }

  const revenue = req.body?.revenue != null ? Number(req.body.revenue) : 0;
  const patch: Record<string, unknown> =
    kind === "impression"
      ? { impressions: sql`${menuAbAssignmentsTable.impressions} + 1` }
      : kind === "click"
        ? { clicks: sql`${menuAbAssignmentsTable.clicks} + 1` }
        : {
            orders: sql`${menuAbAssignmentsTable.orders} + 1`,
            revenue: sql`${menuAbAssignmentsTable.revenue} + ${revenue.toFixed(2)}`,
          };
  const updated = await db
    .update(menuAbAssignmentsTable)
    .set(patch)
    .where(and(eq(menuAbAssignmentsTable.experimentId, experimentId), eq(menuAbAssignmentsTable.sessionId, sessionId)))
    .returning({ id: menuAbAssignmentsTable.id });
  if (updated.length === 0) return void res.status(409).json({ error: "Could not record event" });
  res.json({ ok: true });
});

// ─── Group QR session join + member cart sync ─────────────────────
router.get("/public/menu-intel/group-sessions/:code", async (req, res) => {
  const [session] = await db
    .select()
    .from(menuGroupSessionsTable)
    .where(eq(menuGroupSessionsTable.code, req.params.code.toUpperCase()));
  if (!session) return void res.status(404).json({ error: "Session not found" });
  if (!(await featureOn(session.restaurantId, "menu_group_qr"))) return void res.status(403).json({ error: "Feature off" });
  const members = await db
    .select()
    .from(menuGroupMembersTable)
    .where(eq(menuGroupMembersTable.sessionId, session.id))
    .orderBy(desc(menuGroupMembersTable.joinedAt));
  res.json({ session, members });
});

router.post("/public/menu-intel/group-sessions/:code/join", async (req, res) => {
  const [session] = await db
    .select()
    .from(menuGroupSessionsTable)
    .where(eq(menuGroupSessionsTable.code, req.params.code.toUpperCase()));
  if (!session || session.status !== "open") return void res.status(404).json({ error: "Session not joinable" });
  const guestName = String(req.body?.guestName ?? "").trim();
  if (!guestName) return void res.status(400).json({ error: "guestName required" });
  const guestKey = createHash("sha1").update(`${session.id}:${guestName}:${Date.now()}`).digest("hex").slice(0, 16);
  const isFirst = !(await db.select({ id: menuGroupMembersTable.id }).from(menuGroupMembersTable).where(eq(menuGroupMembersTable.sessionId, session.id)).limit(1)).length;
  const [member] = await db
    .insert(menuGroupMembersTable)
    .values({ sessionId: session.id, guestName: guestName.slice(0, 80), guestKey, isHost: isFirst })
    .returning();
  res.status(201).json({ session, member });
});

router.patch("/public/menu-intel/group-sessions/:code/members/:guestKey/cart", async (req, res) => {
  const [session] = await db
    .select()
    .from(menuGroupSessionsTable)
    .where(eq(menuGroupSessionsTable.code, req.params.code.toUpperCase()));
  if (!session || session.status !== "open") return void res.status(404).json({ error: "Session not joinable" });
  const cart = Array.isArray(req.body?.cart) ? req.body.cart : [];
  const [member] = await db
    .update(menuGroupMembersTable)
    .set({ cart })
    .where(and(eq(menuGroupMembersTable.sessionId, session.id), eq(menuGroupMembersTable.guestKey, req.params.guestKey)))
    .returning();
  if (!member) return void res.status(404).json({ error: "Member not found" });
  res.json({ member });
});

// ─── Public guest photo submission (e.g. via QR) ──────────────────
// Routed through authenticated submissions only — staff submits via auth route.

// ─── Public read-only brand assets feed (for marketing site widgets)
router.get("/public/restaurants/:slug/brand-assets", async (req, res) => {
  const restaurantId = await resolveRestaurantBySlug(req.params.slug);
  if (!restaurantId) return void res.status(404).json({ error: "Not found" });
  if (!(await featureOn(restaurantId, "menu_brand_assets"))) return void res.status(403).json({ error: "Feature off" });
  const rows = await db
    .select()
    .from(brandAssetsTable)
    .where(eq(brandAssetsTable.restaurantId, restaurantId));
  res.json({ data: rows });
});

// Item menu lookup helpers for taste-profile UI on customer menu
router.get("/public/restaurants/:slug/menu-items-min", async (req, res) => {
  const restaurantId = await resolveRestaurantBySlug(req.params.slug);
  if (!restaurantId) return void res.status(404).json({ error: "Not found" });
  const rows = await db
    .select({ id: menuItemsTable.id, name: menuItemsTable.name, spicyLevel: menuItemsTable.spicyLevel, isVeg: menuItemsTable.isVeg, isVegan: menuItemsTable.isVegan, isJain: menuItemsTable.isJain, allergens: menuItemsTable.allergens })
    .from(menuItemsTable)
    .where(eq(menuItemsTable.restaurantId, restaurantId));
  res.json({ data: rows });
});

export default router;
