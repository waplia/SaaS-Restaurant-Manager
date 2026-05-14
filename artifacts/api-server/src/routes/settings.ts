import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, restaurantSettingsTable } from "../lib/db";
import { requireRole, type AppRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

// Allow-list of section keys with role gates and default value shapes.
// Owner-only sections cover sensitive/financial/security configuration.
// Manager+ sections cover operational and customer-facing configuration.
const OWNER_ONLY = new Set([
  "general", "email", "payment", "billing", "roles", "ai", "theme",
  "currencies", "taxes", "loyalty",
]);

const ALL_SECTIONS = new Set([
  "general", "app", "shifts", "open-close", "branch", "currencies",
  "email", "taxes", "payment", "theme", "roles", "billing",
  "reservation", "about-us", "customer-site", "receipt", "printer",
  "downloads", "menu-image", "delivery", "allergens", "kot",
  "cancellation-reasons", "order-settings", "refund-reasons",
  "ai", "kiosk", "loyalty",
]);

function rolesForSection(section: string): AppRole[] {
  if (OWNER_ONLY.has(section)) return ["owner", "super_admin"];
  return ["owner", "manager", "super_admin"];
}

function canAccessSection(req: { user?: { role?: string; isSuperAdmin?: boolean } }, section: string): boolean {
  if (req.user?.isSuperAdmin) return true;
  const allowed = rolesForSection(section);
  return allowed.includes(req.user?.role as AppRole);
}

router.use(
  "/restaurants/:restaurantId/settings",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

// Bulk fetch — managers only see sections they're allowed to read.
router.get("/restaurants/:restaurantId/settings", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(restaurantSettingsTable)
    .where(eq(restaurantSettingsTable.restaurantId, restaurantId));
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (canAccessSection(req, r.section)) out[r.section] = r.data;
  }
  res.json(out);
});

router.get("/restaurants/:restaurantId/settings/:section", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const section = String(req.params.section);
  if (!ALL_SECTIONS.has(section)) return void res.status(404).json({ error: "Unknown section" });
  if (!canAccessSection(req, section)) {
    return void res.status(403).json({ error: "Insufficient permissions for this section" });
  }

  const [row] = await db
    .select()
    .from(restaurantSettingsTable)
    .where(and(
      eq(restaurantSettingsTable.restaurantId, restaurantId),
      eq(restaurantSettingsTable.section, section),
    ));
  res.json({ section, data: row?.data ?? {}, updatedAt: row?.updatedAt ?? null });
});

router.put("/restaurants/:restaurantId/settings/:section", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const section = String(req.params.section);
  if (!ALL_SECTIONS.has(section)) return void res.status(404).json({ error: "Unknown section" });
  if (!canAccessSection(req, section)) {
    return void res.status(403).json({ error: "Insufficient permissions for this section" });
  }

  const data = (req.body && typeof req.body === "object" && req.body.data !== undefined)
    ? req.body.data
    : req.body;
  if (data === null || typeof data !== "object") {
    return void res.status(400).json({ error: "data must be an object" });
  }

  // Atomic upsert — full-document replacement is the documented contract;
  // clients must always send the merged section payload.
  const [row] = await db
    .insert(restaurantSettingsTable)
    .values({ restaurantId, section, data, updatedBy: req.user!.sub })
    .onConflictDoUpdate({
      target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
      set: { data, updatedBy: req.user!.sub, updatedAt: new Date() },
    })
    .returning();
  res.json({ section, data: row.data, updatedAt: row.updatedAt });
});

export default router;
