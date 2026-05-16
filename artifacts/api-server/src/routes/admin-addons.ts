/**
 * Super-admin Add-on Marketplace controls.
 *   GET    /admin/addons                                 - catalogue + install counts
 *   PATCH  /admin/addons/:id                             - edit catalogue entry / kill switch
 *   GET    /admin/addons/events                          - global event log
 *   GET    /admin/tenants/:tenantId/addons               - per-tenant view
 *   POST   /admin/tenants/:tenantId/addons/:key/install  - admin install
 *   POST   /admin/tenants/:tenantId/addons/:key/extend   - extend trial by N days
 *   POST   /admin/tenants/:tenantId/addons/:key/comp     - comp N months
 *   POST   /admin/tenants/:tenantId/addons/:key/uninstall- force uninstall
 */
import { Router } from "express";
import { db, addonsTable, tenantAddonsTable } from "../lib/db";
import { eq, sql } from "drizzle-orm";
import { requireSuperAdmin } from "../middleware/authorize";
import {
  installAddon, startTrial, uninstallAddon, adminExtendTrial, adminComp,
  disableAddonGlobally, listEvents, listTenantAddons, AddonError,
} from "../lib/addons";
import { recordAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

const router = Router();

router.use("/admin/addons", requireSuperAdmin);
router.use("/admin/tenants/:tenantId/addons", requireSuperAdmin);

function handle(res: any, err: unknown, fallback = "Operation failed") {
  if (err instanceof AddonError) {
    res.status(err.code === "NOT_FOUND" ? 404 : 400).json({ error: err.message, code: err.code });
    return true;
  }
  logger.error({ err }, fallback);
  res.status(500).json({ error: fallback });
  return true;
}

router.get("/admin/addons", async (_req, res) => {
  const rows = await db.select({
    addon: addonsTable,
    activeInstalls: sql<number>`(select count(*)::int from tenant_addons ta where ta.addon_id = ${addonsTable.id} and ta.status in ('active','trial'))`,
    trialInstalls: sql<number>`(select count(*)::int from tenant_addons ta where ta.addon_id = ${addonsTable.id} and ta.status = 'trial')`,
    totalInstalls: sql<number>`(select count(*)::int from tenant_addons ta where ta.addon_id = ${addonsTable.id})`,
  }).from(addonsTable).orderBy(addonsTable.sortOrder, addonsTable.id);
  res.json({ addons: rows });
});

router.get("/admin/addons/events", async (req, res) => {
  const events = await listEvents({
    tenantId: req.query.tenantId ? Number(req.query.tenantId) : null,
    addonKey: req.query.addonKey ? String(req.query.addonKey) : null,
    eventType: req.query.eventType ? String(req.query.eventType) : null,
    limit: Number(req.query.limit ?? 200),
  });
  res.json({ events });
});

router.patch("/admin/addons/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const [existing] = await db.select().from(addonsTable).where(eq(addonsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Add-on not found" }); return; }

  const b = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.name === "string") updates.name = b.name;
  if (typeof b.description === "string") updates.description = b.description;
  if (typeof b.longDescription === "string") updates.longDescription = b.longDescription;
  if (typeof b.icon === "string") updates.icon = b.icon;
  if (typeof b.category === "string") updates.category = b.category;
  if (b.pricing && typeof b.pricing === "object") updates.pricing = b.pricing;
  if (Number.isFinite(Number(b.trialDays))) updates.trialDays = Number(b.trialDays);
  if (Array.isArray(b.includedInPlanIds)) updates.includedInPlanIds = b.includedInPlanIds.map(Number).filter(Number.isFinite);
  if (Array.isArray(b.eligiblePlanIds)) updates.eligiblePlanIds = b.eligiblePlanIds.map(Number).filter(Number.isFinite);
  if (Array.isArray(b.featureFlags)) updates.featureFlags = b.featureFlags.map(String);
  if (typeof b.comingSoon === "boolean") updates.comingSoon = b.comingSoon;
  if (typeof b.isEnabled === "boolean") updates.isEnabled = b.isEnabled;
  if (Number.isFinite(Number(b.sortOrder))) updates.sortOrder = Number(b.sortOrder);

  const [updated] = await db.update(addonsTable).set(updates).where(eq(addonsTable.id, id)).returning();

  // Kill-switch: if newly disabled, force-deactivate all live tenant installs.
  let killed = 0;
  if (existing.isEnabled && !updated.isEnabled) {
    killed = await disableAddonGlobally(id, req.user?.sub ?? null);
  }

  await recordAuditLog({
    req, module: "admin_addons", action: "update", entity: "addon", entityId: id,
    oldValue: existing, newValue: updated,
    details: killed > 0 ? `Disabled — force-uninstalled from ${killed} tenants` : null,
  });
  res.json({ addon: updated, killed });
});

router.get("/admin/tenants/:tenantId/addons", async (req, res) => {
  const tid = Number(req.params.tenantId);
  if (!Number.isFinite(tid)) { res.status(400).json({ error: "Bad tenant" }); return; }
  const states = await listTenantAddons(tid);
  res.json({ addons: states });
});

router.post("/admin/tenants/:tenantId/addons/:key/install", async (req, res) => {
  const tid = Number(req.params.tenantId);
  try {
    const trial = req.body?.startTrial === true;
    const row = trial
      ? await startTrial({ tenantId: tid, addonKey: req.params.key, source: "admin", actorUserId: req.user?.sub ?? null })
      : await installAddon({ tenantId: tid, addonKey: req.params.key, source: "admin", actorUserId: req.user?.sub ?? null });
    await recordAuditLog({ req, module: "admin_addons", action: trial ? "admin_trial" : "admin_install", entity: "addon", details: `tenant=${tid} ${req.params.key}` });
    res.json({ install: row });
  } catch (err) { handle(res, err, "Admin install failed"); }
});

router.post("/admin/tenants/:tenantId/addons/:key/extend", async (req, res) => {
  const tid = Number(req.params.tenantId);
  const days = Number(req.body?.days ?? 0);
  try {
    const row = await adminExtendTrial({ tenantId: tid, addonKey: req.params.key, days, actorUserId: req.user?.sub ?? null });
    await recordAuditLog({ req, module: "admin_addons", action: "extend_trial", entity: "addon", details: `tenant=${tid} ${req.params.key} +${days}d` });
    res.json({ install: row });
  } catch (err) { handle(res, err, "Extend trial failed"); }
});

router.post("/admin/tenants/:tenantId/addons/:key/comp", async (req, res) => {
  const tid = Number(req.params.tenantId);
  const months = Number(req.body?.months ?? 0);
  try {
    const row = await adminComp({ tenantId: tid, addonKey: req.params.key, months, actorUserId: req.user?.sub ?? null });
    await recordAuditLog({ req, module: "admin_addons", action: "comp", entity: "addon", details: `tenant=${tid} ${req.params.key} +${months}mo` });
    res.json({ install: row });
  } catch (err) { handle(res, err, "Comp failed"); }
});

router.post("/admin/tenants/:tenantId/addons/:key/uninstall", async (req, res) => {
  const tid = Number(req.params.tenantId);
  try {
    const row = await uninstallAddon({ tenantId: tid, addonKey: req.params.key, source: "admin", actorUserId: req.user?.sub ?? null, immediate: req.body?.immediate !== false });
    await recordAuditLog({ req, module: "admin_addons", action: "force_uninstall", entity: "addon", details: `tenant=${tid} ${req.params.key}` });
    res.json({ install: row });
  } catch (err) { handle(res, err, "Force uninstall failed"); }
});

export default router;
