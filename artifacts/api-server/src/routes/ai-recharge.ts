/**
 * Tenant-facing endpoints for the Khana AI credit wallet:
 *   - GET  /ai/wallet                          — flat balance summary
 *   - GET  /ai/recharge-packages               — public list of active packs
 *   - POST /ai/recharge/create-razorpay-order  — start a Razorpay recharge
 *   - POST /ai/recharge/razorpay-confirm       — verify + apply
 *   - POST /ai/recharge/create-cashfree-order  — start a Cashfree recharge
 *   - POST /ai/recharge/cashfree-confirm       — verify + apply
 *   - POST /ai/recharge/mock                   — instant recharge (non-prod only)
 *
 * Every recharge flow writes a row into `ai_credit_recharges` (status=pending)
 * up-front so the gateway round-trip is always linked to a payment record.
 * The returned `rechargeId` is what the client passes to confirm; we look it
 * up by id to settle, so we cannot apply credits without a valid recharge row.
 */
import { Router, type Request, type Response } from "express";
import { eq, asc, and, sql } from "drizzle-orm";
import {
  db,
  aiRechargePackagesTable,
  aiCreditRechargesTable,
  subscriptionPlansTable,
  tenantsTable,
  isFeatureEnabled,
} from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
import { getEffectiveRazorpayConfig, getEffectiveCashfreeConfig, getEnabledManualMethods } from "../lib/paymentSettings";
import { recordAuditLog } from "../lib/audit";
import { createRazorpayOrder, fetchRazorpayOrder, verifyRazorpayPaymentSignature } from "../lib/razorpay";
import { createCashfreeOrder, fetchCashfreeOrder } from "../lib/cashfree";
import { getOrCreateWallet, summarizeWallet, applyRecharge, applyRechargeOnHandle, listTransactions } from "../lib/aiCredits";
import { logger } from "../lib/logger";

const router = Router();

// ─── Read-side ───────────────────────────────────────────────────────────────

router.get("/ai/recharge-packages", async (_req, res) => {
  const rows = await db.select().from(aiRechargePackagesTable)
    .where(eq(aiRechargePackagesTable.isActive, true))
    .orderBy(asc(aiRechargePackagesTable.sortOrder), asc(aiRechargePackagesTable.price));
  res.json(rows.filter(r => r.showToRestaurants));
});

router.get("/ai/wallet", async (req: Request, res: Response) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const [tenant] = await db.select({
    planId: tenantsTable.planId,
    planAiEnabled: subscriptionPlansTable.aiEnabled,
    planMonthlyIncluded: subscriptionPlansTable.aiMonthlyIncludedCredits,
    planFeatureFlags: subscriptionPlansTable.featureFlags,
  }).from(tenantsTable)
    .leftJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, tenantsTable.planId))
    .where(eq(tenantsTable.id, tenantId));
  // Khana AI module access is gated on the new `khana_ai_enabled` plan
  // feature flag — same key the backend routes enforce — so the sidebar
  // and pages have a single, consistent source of truth.
  const planKhanaAiEnabled = isFeatureEnabled(tenant?.planFeatureFlags ?? null, "khana_ai_enabled");
  const planKhanaAiInsightsEnabled = isFeatureEnabled(tenant?.planFeatureFlags ?? null, "khana_ai_insights_enabled");
  const wallet = await getOrCreateWallet(tenantId);
  const b = summarizeWallet(wallet);
  const transactions = await listTransactions(wallet.id, 25);
  res.json({
    walletId: wallet.id,
    balance: b.available,
    monthlyBalance: b.monthly,
    purchasedBalance: b.purchased,
    bonusBalance: b.bonus,
    reservedCredits: b.reserved,
    lifetimeCreditsUsed: b.used,
    isBlocked: b.isBlocked,
    purchasedExpiresAt: b.purchasedExpiresAt,
    planAiEnabled: planKhanaAiEnabled,
    planKhanaAiEnabled,
    planKhanaAiInsightsEnabled,
    planMonthlyIncluded: tenant?.planMonthlyIncluded ?? 0,
    transactions,
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadActivePackage(packageId: number) {
  const [pkg] = await db.select().from(aiRechargePackagesTable).where(eq(aiRechargePackagesTable.id, packageId));
  if (!pkg || !pkg.isActive) return null;
  return pkg;
}

/**
 * Insert a pending row into ai_credit_recharges. Returns the row id which the
 * client then echoes back on confirm. Throws if the insert fails — without a
 * payment row we refuse to start the gateway round-trip.
 */
async function createPendingRechargeRow(opts: {
  tenantId: number; packageId: number;
  provider: "razorpay" | "cashfree" | "manual" | "mock";
  amount: string; currency: string;
  createdBy?: number | null;
}): Promise<number> {
  const [row] = await db.insert(aiCreditRechargesTable).values({
    tenantId: opts.tenantId,
    packageId: opts.packageId,
    provider: opts.provider,
    amount: opts.amount,
    currency: opts.currency,
    status: "pending",
    createdBy: opts.createdBy ?? null,
  }).returning({ id: aiCreditRechargesTable.id });
  return row.id;
}

async function markRechargeFailed(rechargeId: number, reason: string) {
  await db.update(aiCreditRechargesTable).set({
    status: "failed", failureReason: reason, updatedAt: new Date(),
  }).where(eq(aiCreditRechargesTable.id, rechargeId));
}

type SettleOutcome =
  | { kind: "succeeded"; creditsAdded: number; bonusAdded: number }
  | { kind: "idempotent" }
  | { kind: "not_found" }
  | { kind: "bad_state"; status: string }
  | { kind: "duplicate_external_ref" };

/**
 * Atomically settle a pending recharge:
 *   1. Lock the recharge row FOR UPDATE inside a transaction.
 *   2. Refuse if missing / wrong tenant / already final.
 *   3. Bind it to the gateway external_ref AND credit the wallet inside the
 *      *same* transaction. The unique index on (provider, external_ref)
 *      guarantees the same gateway order can never settle two recharge rows
 *      — the second commit raises 23505 and the whole tx (incl. credits)
 *      rolls back.
 *
 * This eliminates the replay window that existed when crediting happened
 * before the unique-ref binding.
 */
async function settleRecharge(opts: {
  rechargeId: number;
  tenantId: number;
  externalRef: string;
  notes: string;
}): Promise<SettleOutcome> {
  try {
    return await db.transaction(async (tx) => {
      const [recharge] = await tx.execute(sql`
        SELECT id, tenant_id AS "tenantId", package_id AS "packageId", status
        FROM ${aiCreditRechargesTable}
        WHERE id = ${opts.rechargeId} AND tenant_id = ${opts.tenantId}
        FOR UPDATE
      `).then(r => (r as unknown as { rows: Array<{ id: number; tenantId: number; packageId: number; status: string }> }).rows);

      if (!recharge) return { kind: "not_found" } as const;
      if (recharge.status === "succeeded") return { kind: "idempotent" } as const;
      if (recharge.status !== "pending") return { kind: "bad_state", status: recharge.status } as const;

      // Credit the wallet first; if anything fails the tx rolls back and no
      // ai_credit_recharges row is marked succeeded (still pending → safe to retry).
      const result = await applyRechargeOnHandle(tx, {
        tenantId: opts.tenantId,
        packageId: recharge.packageId,
        paymentId: opts.rechargeId,
        notes: opts.notes,
      });

      // Bind external_ref and mark succeeded. The unique index on
      // (provider, external_ref) is what guarantees a gateway order can only
      // settle one recharge row.
      await tx.update(aiCreditRechargesTable).set({
        status: "succeeded",
        externalRef: opts.externalRef,
        creditsGranted: result.creditsAdded,
        bonusGranted: result.bonusAdded,
        updatedAt: new Date(),
      }).where(eq(aiCreditRechargesTable.id, opts.rechargeId));

      return { kind: "succeeded", creditsAdded: result.creditsAdded, bonusAdded: result.bonusAdded } as const;
    });
  } catch (err) {
    // Postgres unique_violation on the (provider, external_ref) index → another
    // recharge row already claimed this gateway order. Whole tx is rolled back.
    if ((err as { code?: string })?.code === "23505") {
      return { kind: "duplicate_external_ref" } as const;
    }
    throw err;
  }
}

// ─── Razorpay recharge ───────────────────────────────────────────────────────

router.post("/ai/recharge/create-razorpay-order", requireRole("owner", "super_admin"), async (req: Request, res: Response) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const pkg = await loadActivePackage(Number(req.body?.packageId));
  if (!pkg) return void res.status(404).json({ error: "Recharge package not found" });

  const { enabled, config } = await getEffectiveRazorpayConfig();
  if (!enabled || !config) return void res.status(400).json({ error: "Razorpay is not configured" });

  const currency = (pkg.currency ?? "INR").toUpperCase();
  const rechargeId = await createPendingRechargeRow({
    tenantId, packageId: pkg.id, provider: "razorpay",
    amount: String(pkg.price), currency, createdBy: req.user?.sub ?? null,
  });
  const receipt = `kr_${tenantId}_${pkg.id}_${rechargeId}`;
  try {
    const order = await createRazorpayOrder(config, {
      receipt,
      amount: Number(pkg.price),
      currency,
      notes: { tenantId: String(tenantId), packageId: String(pkg.id), kind: "ai_recharge", rechargeId: String(rechargeId) },
    });
    res.json({
      rechargeId, orderId: order.id, key: config.keyId,
      amount: order.amount, currency: order.currency, receipt,
      package: { id: pkg.id, name: pkg.name, credits: pkg.credits, bonusCredits: pkg.bonusCredits },
    });
  } catch (err) {
    logger.error({ err }, "Failed to create Razorpay recharge order");
    await markRechargeFailed(rechargeId, "gateway_create_order_failed");
    res.status(502).json({ error: "Failed to create Razorpay order. Please try again." });
  }
});

router.post("/ai/recharge/razorpay-confirm", requireRole("owner", "super_admin"), async (req: Request, res: Response) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const { orderId, paymentId, signature, rechargeId } = req.body as { orderId: string; paymentId: string; signature: string; rechargeId?: number };
  if (!orderId || !paymentId || !signature) return void res.status(400).json({ error: "orderId, paymentId, signature required" });
  if (!rechargeId) return void res.status(400).json({ error: "rechargeId required" });

  const { config } = await getEffectiveRazorpayConfig();
  if (!config) return void res.status(400).json({ error: "Razorpay not configured" });
  if (!verifyRazorpayPaymentSignature(config, orderId, paymentId, signature)) {
    return void res.status(400).json({ error: "Invalid Razorpay signature" });
  }

  const order = await fetchRazorpayOrder(config, orderId);
  if (order.status !== "paid" && order.amount_paid < order.amount) {
    return void res.json({ activated: false, status: order.status });
  }

  const outcome = await settleRecharge({
    rechargeId: Number(rechargeId), tenantId,
    externalRef: `rzp_recharge_${orderId}`,
    notes: `Razorpay recharge ${orderId}`,
  });
  if (outcome.kind === "not_found") return void res.status(404).json({ error: "Recharge not found for this tenant" });
  if (outcome.kind === "idempotent") return void res.json({ activated: true, idempotent: true });
  if (outcome.kind === "bad_state") return void res.status(409).json({ error: `Recharge is ${outcome.status}` });
  if (outcome.kind === "duplicate_external_ref") return void res.status(409).json({ error: "This payment has already been used to settle a different recharge." });
  res.json({ activated: true, creditsAdded: outcome.creditsAdded, bonusAdded: outcome.bonusAdded });
});

// ─── Cashfree recharge ───────────────────────────────────────────────────────

router.post("/ai/recharge/create-cashfree-order", requireRole("owner", "super_admin"), async (req: Request, res: Response) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const pkg = await loadActivePackage(Number(req.body?.packageId));
  if (!pkg) return void res.status(404).json({ error: "Recharge package not found" });

  const { enabled, config } = await getEffectiveCashfreeConfig();
  if (!enabled || !config) return void res.status(400).json({ error: "Cashfree is not configured" });

  const currency = (pkg.currency ?? "INR").toUpperCase();
  const rechargeId = await createPendingRechargeRow({
    tenantId, packageId: pkg.id, provider: "cashfree",
    amount: String(pkg.price), currency, createdBy: req.user?.sub ?? null,
  });
  const orderId = `kr_cf_${tenantId}_${pkg.id}_${rechargeId}`;
  const customerEmail = req.user?.email ?? `tenant${tenantId}@khana.local`;
  const customerPhone = "9999999999";
  const returnUrl = String(req.body?.returnUrl ?? `${req.protocol}://${req.get("host")}/app/subscription`);
  try {
    const order = await createCashfreeOrder(config, {
      orderId, amount: Number(pkg.price), currency,
      customerId: `tenant_${tenantId}`,
      customerName: req.user?.name ?? `Tenant ${tenantId}`,
      customerEmail, customerPhone, returnUrl,
      notes: { tenantId: String(tenantId), packageId: String(pkg.id), kind: "ai_recharge", rechargeId: String(rechargeId) },
    });
    res.json({
      rechargeId, orderId: order.order_id, paymentSessionId: order.payment_session_id,
      amount: pkg.price, currency,
      package: { id: pkg.id, name: pkg.name, credits: pkg.credits, bonusCredits: pkg.bonusCredits },
    });
  } catch (err) {
    logger.error({ err }, "Failed to create Cashfree recharge order");
    await markRechargeFailed(rechargeId, "gateway_create_order_failed");
    res.status(502).json({ error: "Failed to create Cashfree order. Please try again." });
  }
});

router.post("/ai/recharge/cashfree-confirm", requireRole("owner", "super_admin"), async (req: Request, res: Response) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const { orderId, rechargeId } = req.body as { orderId: string; rechargeId?: number };
  if (!orderId) return void res.status(400).json({ error: "orderId required" });
  if (!rechargeId) return void res.status(400).json({ error: "rechargeId required" });

  const { config } = await getEffectiveCashfreeConfig();
  if (!config) return void res.status(400).json({ error: "Cashfree not configured" });

  const order = await fetchCashfreeOrder(config, orderId);
  if (order.order_status !== "PAID") return void res.json({ activated: false, status: order.order_status });

  const outcome = await settleRecharge({
    rechargeId: Number(rechargeId), tenantId,
    externalRef: `cf_recharge_${orderId}`,
    notes: `Cashfree recharge ${orderId}`,
  });
  if (outcome.kind === "not_found") return void res.status(404).json({ error: "Recharge not found for this tenant" });
  if (outcome.kind === "idempotent") return void res.json({ activated: true, idempotent: true });
  if (outcome.kind === "bad_state") return void res.status(409).json({ error: `Recharge is ${outcome.status}` });
  if (outcome.kind === "duplicate_external_ref") return void res.status(409).json({ error: "This payment has already been used to settle a different recharge." });
  res.json({ activated: true, creditsAdded: outcome.creditsAdded, bonusAdded: outcome.bonusAdded });
});

// ─── Manual bank/UPI recharge (mirrors subscription manual flow) ─────────────

/**
 * Tenant submits a manual bank/UPI payment for an AI recharge package.
 * Creates a `pending` ai_credit_recharges row with provider="manual" so the
 * super-admin can approve it via /admin/ai/recharges/:id/approve, which
 * routes through the same settleRecharge() that the online providers use.
 * Reuses getEnabledManualMethods() so only methods the super-admin has
 * actually configured (and INR-priced packages) are accepted.
 */
router.post("/ai/recharge/manual", requireRole("owner", "super_admin"), async (req: Request, res: Response) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const { packageId, method, reference, note, amount } = req.body as {
    packageId?: number; method?: string; reference?: string; note?: string; amount?: number | string;
  };
  if (!packageId) return void res.status(400).json({ error: "packageId required" });
  if (method !== "bank" && method !== "upi") {
    return void res.status(400).json({ error: "method must be 'bank' or 'upi'" });
  }
  const pkg = await loadActivePackage(Number(packageId));
  if (!pkg) return void res.status(404).json({ error: "Recharge package not found" });
  if ((pkg.currency ?? "INR").toUpperCase() !== "INR") {
    return void res.status(400).json({ error: "Manual bank/UPI recharges are INR only. Please use an online provider." });
  }
  const manual = await getEnabledManualMethods();
  if ((method === "bank" && !manual.bank.enabled) || (method === "upi" && !manual.upi.enabled)) {
    return void res.status(400).json({ error: `${method.toUpperCase()} payments are not enabled` });
  }
  // Prevent multiple pending manual recharges from the same tenant.
  const [pending] = await db.select({ id: aiCreditRechargesTable.id }).from(aiCreditRechargesTable)
    .where(and(
      eq(aiCreditRechargesTable.tenantId, tenantId),
      eq(aiCreditRechargesTable.provider, "manual"),
      eq(aiCreditRechargesTable.status, "pending"),
    ));
  if (pending) {
    return void res.status(409).json({ error: "You already have a pending manual recharge under review." });
  }
  let finalAmount = String(pkg.price);
  if (amount !== undefined && amount !== "") {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) return void res.status(400).json({ error: "Invalid amount" });
    finalAmount = n.toFixed(2);
  }
  const rechargeId = await createPendingRechargeRow({
    tenantId, packageId: pkg.id, provider: "manual",
    amount: finalAmount, currency: pkg.currency, createdBy: req.user?.sub ?? null,
  });
  await db.update(aiCreditRechargesTable).set({
    notes: JSON.stringify({ method, reference: reference ?? null, note: note ?? null }),
  }).where(eq(aiCreditRechargesTable.id, rechargeId));
  await recordAuditLog({
    req, module: "ai_credits", action: "manual_recharge.submit",
    entity: "ai_credit_recharge", entityId: rechargeId,
    newValue: { tenantId, packageId: pkg.id, method, reference: reference ?? null, amount: finalAmount },
  });
  res.status(201).json({ rechargeId, status: "pending" });
});

router.get("/ai/recharge/manual", requireRole("owner", "manager", "super_admin"), async (req: Request, res: Response) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const rows = await db.select().from(aiCreditRechargesTable)
    .where(and(eq(aiCreditRechargesTable.tenantId, tenantId), eq(aiCreditRechargesTable.provider, "manual")))
    .orderBy(asc(aiCreditRechargesTable.id));
  res.json({ data: rows });
});

// ─── Super-admin: approve / reject pending manual recharges ──────────────────

router.get("/admin/ai/recharges/pending", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(aiCreditRechargesTable)
    .where(and(eq(aiCreditRechargesTable.provider, "manual"), eq(aiCreditRechargesTable.status, "pending")))
    .orderBy(asc(aiCreditRechargesTable.id));
  res.json({ data: rows });
});

router.post("/admin/ai/recharges/:id/approve", requireSuperAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(aiCreditRechargesTable).where(eq(aiCreditRechargesTable.id, id));
  if (!row) return void res.status(404).json({ error: "Recharge not found" });
  if (row.provider !== "manual") return void res.status(400).json({ error: "Only manual recharges can be approved here" });
  const outcome = await settleRecharge({
    rechargeId: id, tenantId: row.tenantId,
    externalRef: `manual_${id}_approved_${Date.now()}`,
    notes: `Approved by super-admin ${req.user?.sub ?? ""}`.trim(),
  });
  if (outcome.kind === "not_found") return void res.status(404).json({ error: "Recharge not found" });
  if (outcome.kind === "idempotent") return void res.json({ activated: true, idempotent: true });
  if (outcome.kind === "bad_state") return void res.status(409).json({ error: `Recharge is ${outcome.status}` });
  if (outcome.kind === "duplicate_external_ref") return void res.status(409).json({ error: "Duplicate external ref" });
  await recordAuditLog({
    req, module: "ai_credits", action: "manual_recharge.approve",
    entity: "ai_credit_recharge", entityId: id,
    newValue: { creditsAdded: outcome.creditsAdded, bonusAdded: outcome.bonusAdded },
  });
  res.json({ activated: true, creditsAdded: outcome.creditsAdded, bonusAdded: outcome.bonusAdded });
});

router.post("/admin/ai/recharges/:id/reject", requireSuperAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const reason = String((req.body as { reason?: string })?.reason ?? "Rejected by super-admin");
  const [row] = await db.select().from(aiCreditRechargesTable).where(eq(aiCreditRechargesTable.id, id));
  if (!row) return void res.status(404).json({ error: "Recharge not found" });
  if (row.status !== "pending") return void res.status(409).json({ error: `Recharge is ${row.status}` });
  await markRechargeFailed(id, reason);
  await recordAuditLog({
    req, module: "ai_credits", action: "manual_recharge.reject",
    entity: "ai_credit_recharge", entityId: id, newValue: { reason },
  });
  res.json({ ok: true });
});

// ─── Mock recharge (non-production only) ─────────────────────────────────────

router.post("/ai/recharge/mock", requireRole("owner", "super_admin"), async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    return void res.status(403).json({ error: "Mock recharge is disabled in production." });
  }
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const packageId = Number(req.body?.packageId);
  if (!packageId) return void res.status(400).json({ error: "packageId required" });
  const pkg = await loadActivePackage(packageId);
  if (!pkg) return void res.status(404).json({ error: "Recharge package not found" });

  const rechargeId = await createPendingRechargeRow({
    tenantId, packageId, provider: "mock",
    amount: String(pkg.price), currency: pkg.currency, createdBy: req.user?.sub ?? null,
  });
  const outcome = await settleRecharge({
    rechargeId, tenantId,
    externalRef: `mock_${rechargeId}`,
    notes: "Mock recharge (non-prod)",
  });
  if (outcome.kind !== "succeeded") {
    return void res.status(500).json({ error: `Mock recharge settlement failed: ${outcome.kind}` });
  }
  res.json({ activated: true, mock: true, rechargeId, creditsAdded: outcome.creditsAdded, bonusAdded: outcome.bonusAdded });
});

export default router;
