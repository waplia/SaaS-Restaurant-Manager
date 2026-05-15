import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  tenantsTable,
  restaurantsTable,
  branchesTable,
  kitchensTable,
  menusTable,
  menuCategoriesTable,
  menuItemsTable,
  floorTablesTable,
  usersTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";

const router = Router();

const STEPS = [
  "profile",
  "branch",
  "kitchen",
  "menu_categories",
  "menu_items",
  "tables",
  "staff",
  "payment",
  "go_live",
] as const;
type StepId = (typeof STEPS)[number];

const SKIPPABLE = new Set<StepId>(["branch", "staff", "payment"]);

async function ensureDefaultMenu(restaurantId: number): Promise<number> {
  const [existing] = await db
    .select({ id: menusTable.id })
    .from(menusTable)
    .where(eq(menusTable.restaurantId, restaurantId))
    .orderBy(menusTable.id)
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(menusTable)
    .values({ restaurantId, name: "Main Menu", description: "Default menu" })
    .returning({ id: menusTable.id });
  return created.id;
}

async function buildState(tenantId: number, restaurantId: number) {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));

  const defaultMenuId = await ensureDefaultMenu(restaurantId);

  const [{ count: branchCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(branchesTable)
    .where(eq(branchesTable.restaurantId, restaurantId));
  const [{ count: kitchenCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(kitchensTable)
    .where(eq(kitchensTable.restaurantId, restaurantId));
  const [{ count: categoryCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(menuCategoriesTable)
    .where(eq(menuCategoriesTable.restaurantId, restaurantId));
  const [{ count: itemCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(menuItemsTable)
    .where(eq(menuItemsTable.restaurantId, restaurantId));
  const [{ count: tableCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(floorTablesTable)
    .where(eq(floorTablesTable.restaurantId, restaurantId));
  const [{ count: staffCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(eq(usersTable.restaurantId, restaurantId));

  const profileComplete = !!(restaurant?.phone && restaurant?.address && restaurant?.city);
  const skipped = new Set(tenant?.onboardingSkippedSteps ?? []);

  const completed: Record<StepId, boolean> = {
    profile: profileComplete,
    branch: branchCount > 0 || skipped.has("branch"),
    kitchen: kitchenCount > 0,
    menu_categories: categoryCount > 0,
    menu_items: itemCount > 0,
    tables: tableCount > 0,
    staff: staffCount > 1 || skipped.has("staff"),
    payment: skipped.has("payment") || !!(restaurant && Number(restaurant.taxRate) > 0),
    go_live: !!tenant?.onboardingCompletedAt,
  };

  return {
    isOnboarded: !!tenant?.onboardingCompletedAt,
    completedAt: tenant?.onboardingCompletedAt ?? null,
    skippedSteps: Array.from(skipped),
    defaultMenuId,
    counts: {
      branches: branchCount,
      kitchens: kitchenCount,
      categories: categoryCount,
      items: itemCount,
      tables: tableCount,
      staff: staffCount,
    },
    steps: STEPS.map((id) => ({
      id,
      completed: completed[id],
      skipped: skipped.has(id),
      skippable: SKIPPABLE.has(id),
    })),
  };
}

router.get("/onboarding/state", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const user = req.user!;
  if (!user.tenantId || !user.restaurantId) {
    return void res.status(400).json({ error: "User is not associated with a restaurant" });
  }
  const state = await buildState(user.tenantId, user.restaurantId);
  res.json(state);
});

async function skipStep(tenantId: number, step: StepId) {
  const [tenant] = await db.select({ skipped: tenantsTable.onboardingSkippedSteps })
    .from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const next = Array.from(new Set([...(tenant?.skipped ?? []), step]));
  await db.update(tenantsTable)
    .set({ onboardingSkippedSteps: next, updatedAt: new Date() })
    .where(eq(tenantsTable.id, tenantId));
  return next;
}

router.post("/onboarding/skip", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const user = req.user!;
  if (!user.tenantId) return void res.status(400).json({ error: "No tenant" });
  const step = String(req.body?.step ?? "") as StepId;
  if (!SKIPPABLE.has(step)) return void res.status(400).json({ error: "Step is not skippable" });
  const next = await skipStep(user.tenantId, step);
  res.json({ ok: true, skippedSteps: next });
});

router.post("/onboarding/complete", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const user = req.user!;
  if (!user.tenantId || !user.restaurantId) return void res.status(400).json({ error: "No tenant" });

  const state = await buildState(user.tenantId, user.restaurantId);
  // `go_live` is the terminal action being executed by this very call —
  // exclude it from prerequisites so completion is actually reachable.
  const blocking = state.steps.filter(s => !s.completed && !s.skippable && s.id !== "go_live");
  if (blocking.length > 0) {
    return void res.status(400).json({
      error: `Cannot complete onboarding — please finish: ${blocking.map(s => s.id).join(", ")}`,
      blocking: blocking.map(s => s.id),
    });
  }
  await db.update(tenantsTable)
    .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
    .where(eq(tenantsTable.id, user.tenantId));
  res.json({ ok: true, completedAt: new Date().toISOString() });
});

// Unified PATCH /onboarding/state — accepts { skip?: StepId, complete?: true }
// Mirrors the per-action endpoints above but matches the single-state contract
// described in the task spec.
router.patch("/onboarding/state", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const user = req.user!;
  if (!user.tenantId || !user.restaurantId) return void res.status(400).json({ error: "No tenant" });
  const body = (req.body ?? {}) as { skip?: string; complete?: boolean };

  if (body.skip) {
    const step = body.skip as StepId;
    if (!SKIPPABLE.has(step)) return void res.status(400).json({ error: "Step is not skippable" });
    await skipStep(user.tenantId, step);
  }

  if (body.complete) {
    const state = await buildState(user.tenantId, user.restaurantId);
    const blocking = state.steps.filter(s => !s.completed && !s.skippable && s.id !== "go_live");
    if (blocking.length > 0) {
      return void res.status(400).json({
        error: `Cannot complete onboarding — please finish: ${blocking.map(s => s.id).join(", ")}`,
        blocking: blocking.map(s => s.id),
      });
    }
    await db.update(tenantsTable)
      .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(tenantsTable.id, user.tenantId));
  }

  const next = await buildState(user.tenantId, user.restaurantId);
  res.json(next);
});

export default router;
