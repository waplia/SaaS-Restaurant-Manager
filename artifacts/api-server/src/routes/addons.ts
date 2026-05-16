/**
 * Tenant-facing Add-on Marketplace routes.
 *   GET    /addons                       - catalogue + per-tenant state
 *   GET    /addons/:key                  - single add-on detail
 *   POST   /addons/:key/install          - install free / activate after payment
 *   POST   /addons/:key/start-trial      - start a trial
 *   POST   /addons/:key/uninstall        - cancel
 *   POST   /addons/:key/confirm-payment  - manual-payment / mocked checkout confirmation
 *   GET    /addons/events                - event log for the calling tenant
 */
import { Router } from "express";
import { db, addonsTable, tenantAddonsTable } from "../lib/db";
import { eq, and, desc } from "drizzle-orm";
import {
  listTenantAddons, resolveAddonState, installAddon, startTrial, uninstallAddon,
  activatePaidAddon, listEvents, summarizeAddonUsage, AddonError,
} from "../lib/addons";
import { recordAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

const router = Router();

function tenantId(req: any): number | null {
  return req.user?.tenantId ?? null;
}

function handleAddonError(res: any, err: unknown) {
  if (err instanceof AddonError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "PLAN_INELIGIBLE" ? 402 : 400;
    res.status(status).json({ error: err.message, code: err.code });
    return true;
  }
  return false;
}

router.get("/addons", async (req, res) => {
  const tid = tenantId(req);
  if (!tid) { res.status(403).json({ error: "No tenant" }); return; }
  const states = await listTenantAddons(tid);
  res.json({ addons: states.map(s => ({
    key: s.addon.key,
    name: s.addon.name,
    description: s.addon.description,
    longDescription: s.addon.longDescription,
    icon: s.addon.icon,
    category: s.addon.category,
    pricing: s.addon.pricing,
    trialDays: s.addon.trialDays,
    comingSoon: s.addon.comingSoon,
    isEnabled: s.addon.isEnabled,
    featureFlags: s.addon.featureFlags,
    status: s.status,
    active: s.active,
    includedInPlan: s.includedInPlan,
    eligibleByPlan: s.eligibleByPlan,
    install: s.install ? {
      status: s.install.status,
      source: s.install.source,
      billingCycle: s.install.billingCycle,
      pricePaid: s.install.pricePaid,
      currency: s.install.currency,
      startedAt: s.install.startedAt,
      trialEndsAt: s.install.trialEndsAt,
      currentPeriodEndsAt: s.install.currentPeriodEndsAt,
      cancelledAt: s.install.cancelledAt,
    } : null,
  })) });
});

router.get("/addons/events", async (req, res) => {
  const tid = tenantId(req);
  if (!tid) { res.status(403).json({ error: "No tenant" }); return; }
  const events = await listEvents({ tenantId: tid, limit: Number(req.query.limit ?? 100) });
  res.json({ events });
});

router.get("/addons/:key", async (req, res) => {
  const tid = tenantId(req);
  if (!tid) { res.status(403).json({ error: "No tenant" }); return; }
  const state = await resolveAddonState(tid, req.params.key);
  if (!state) { res.status(404).json({ error: "Add-on not found" }); return; }
  const usage = state.active ? await summarizeAddonUsage(tid, req.params.key) : null;
  res.json({ ...state, usage });
});

router.post("/addons/:key/install", async (req, res) => {
  const tid = tenantId(req);
  if (!tid) { res.status(403).json({ error: "No tenant" }); return; }
  try {
    const row = await installAddon({ tenantId: tid, addonKey: req.params.key, source: "self", actorUserId: req.user?.sub ?? null });
    await recordAuditLog({ req, module: "addons", action: "install", entity: "addon", details: req.params.key });
    res.json({ install: row });
  } catch (err) {
    if (handleAddonError(res, err)) return;
    logger.error({ err }, "Add-on install failed");
    res.status(500).json({ error: "Install failed" });
  }
});

router.post("/addons/:key/start-trial", async (req, res) => {
  const tid = tenantId(req);
  if (!tid) { res.status(403).json({ error: "No tenant" }); return; }
  try {
    const row = await startTrial({ tenantId: tid, addonKey: req.params.key, source: "self", actorUserId: req.user?.sub ?? null });
    await recordAuditLog({ req, module: "addons", action: "trial_start", entity: "addon", details: req.params.key });
    res.json({ install: row });
  } catch (err) {
    if (handleAddonError(res, err)) return;
    logger.error({ err }, "Add-on trial failed");
    res.status(500).json({ error: "Trial failed" });
  }
});

router.post("/addons/:key/uninstall", async (req, res) => {
  const tid = tenantId(req);
  if (!tid) { res.status(403).json({ error: "No tenant" }); return; }
  try {
    const row = await uninstallAddon({ tenantId: tid, addonKey: req.params.key, source: "self", actorUserId: req.user?.sub ?? null, immediate: !!req.body?.immediate });
    await recordAuditLog({ req, module: "addons", action: "uninstall", entity: "addon", details: req.params.key });
    res.json({ install: row });
  } catch (err) {
    if (handleAddonError(res, err)) return;
    logger.error({ err }, "Add-on uninstall failed");
    res.status(500).json({ error: "Uninstall failed" });
  }
});

/**
 * Manual / mocked checkout confirmation. A real Razorpay/Cashfree webhook
 * would call activatePaidAddon directly. For now the tenant POSTs the cycle
 * & a fake paymentRef (e.g. "manual-<ts>") and we record a payment event.
 */
router.post("/addons/:key/confirm-payment", async (req, res) => {
  const tid = tenantId(req);
  if (!tid) { res.status(403).json({ error: "No tenant" }); return; }
  const cycle = req.body?.billingCycle === "yearly" ? "yearly" : req.body?.billingCycle === "one_off" ? "one_off" : "monthly";
  const paymentRef = String(req.body?.paymentRef ?? `manual-${Date.now()}`);
  const state = await resolveAddonState(tid, req.params.key);
  if (!state) { res.status(404).json({ error: "Add-on not found" }); return; }
  const price = cycle === "yearly" ? state.addon.pricing.yearlyPrice ?? 0
    : cycle === "one_off" ? state.addon.pricing.oneOffPrice ?? 0
    : state.addon.pricing.monthlyPrice ?? 0;
  try {
    const row = await activatePaidAddon({
      tenantId: tid, addonKey: req.params.key,
      billingCycle: cycle, amount: price,
      currency: state.addon.pricing.currency ?? "INR",
      paymentRef, source: "self", actorUserId: req.user?.sub ?? null,
    });
    await recordAuditLog({ req, module: "addons", action: "payment", entity: "addon", details: `${req.params.key} ${cycle} ${price}` });
    res.json({ install: row });
  } catch (err) {
    if (handleAddonError(res, err)) return;
    logger.error({ err }, "Add-on payment confirm failed");
    res.status(500).json({ error: "Payment confirmation failed" });
  }
});

export default router;
