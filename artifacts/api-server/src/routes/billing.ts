import { Router, type Request, type Response } from "express";
import { eq, desc, and } from "drizzle-orm";
import {
  db, paymentMethodSettingsTable, manualPaymentRequestsTable, subscriptionPaymentsTable,
  tenantsTable, subscriptionPlansTable, usersTable, auditLogsTable,
  notificationsTable, restaurantsTable,
} from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
import { sendLifecycleSms } from "../lib/smsSender";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  type ProviderKey, listProviderRows, getProviderRow, upsertProvider, maskConfig,
  getEffectiveCashfreeConfig, getEffectiveRazorpayConfig, getEnabledManualMethods,
} from "../lib/paymentSettings";
import {
  createRazorpayOrder, fetchRazorpayOrder, verifyRazorpayPaymentSignature, verifyRazorpayWebhook,
} from "../lib/razorpay";
import { logger } from "../lib/logger";

const router = Router();

const PROVIDERS: ProviderKey[] = ["cashfree", "razorpay", "bank", "upi"];

function isProvider(s: string): s is ProviderKey {
  return (PROVIDERS as string[]).includes(s);
}

// ─── Super-admin: payment-method settings ────────────────────────
router.get("/admin/payment-methods", requireSuperAdmin, async (_req, res) => {
  const rows = await listProviderRows();
  const map = new Map(rows.map(r => [r.provider, r]));
  const out = PROVIDERS.map(p => {
    const r = map.get(p);
    return {
      provider: p,
      isEnabled: !!r?.isEnabled,
      isDefault: !!r?.isDefault,
      config: maskConfig(p, r?.config ?? {}),
      updatedAt: r?.updatedAt ?? null,
    };
  });
  res.json({ providers: out });
});

router.put("/admin/payment-methods/:provider", requireSuperAdmin, async (req, res) => {
  const provider = String(req.params.provider ?? "");
  if (!isProvider(provider)) return void res.status(400).json({ error: "Unknown provider" });
  const { isEnabled, isDefault, config } = req.body as { isEnabled?: boolean; isDefault?: boolean; config?: Record<string, unknown> };
  if ((provider === "bank" || provider === "upi") && isDefault) {
    return void res.status(400).json({ error: "Manual methods cannot be marked default" });
  }
  const row = await upsertProvider(provider, { isEnabled, isDefault, config }, req.user?.id);
  res.json({
    provider: row.provider,
    isEnabled: row.isEnabled,
    isDefault: row.isDefault,
    config: maskConfig(row.provider, row.config),
    updatedAt: row.updatedAt,
  });
});

// ─── Tenant-facing: enabled methods (no secrets) ─────────────────
router.get("/restaurants/:restaurantId/billing/methods", requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const [cashfree, razorpay, manual] = await Promise.all([
    getEffectiveCashfreeConfig(),
    getEffectiveRazorpayConfig(),
    getEnabledManualMethods(),
  ]);

  // Determine which online provider is the default. If neither row exists in DB
  // but cashfree env creds are set, treat cashfree as default for backward compat.
  let defaultOnline: "cashfree" | "razorpay" | null = null;
  if (cashfree.enabled && cashfree.isDefault) defaultOnline = "cashfree";
  else if (razorpay.enabled && razorpay.isDefault) defaultOnline = "razorpay";
  else if (cashfree.enabled) defaultOnline = "cashfree";
  else if (razorpay.enabled) defaultOnline = "razorpay";

  // Fetch the tenant's most recent manual request (any status) so the UI can
  // surface pending review state, approvals, and rejections (with reason +
  // resubmit affordance).
  const [latest] = await db.select().from(manualPaymentRequestsTable)
    .where(eq(manualPaymentRequestsTable.tenantId, tenantId))
    .orderBy(desc(manualPaymentRequestsTable.createdAt))
    .limit(1);

  // Stripe is configured at the platform level via env var (legacy path).
  const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);

  res.json({
    online: {
      cashfree: { enabled: cashfree.enabled },
      razorpay: { enabled: razorpay.enabled, keyId: razorpay.config?.keyId ?? null },
      stripe:   { enabled: stripeEnabled },
      default: defaultOnline,
    },
    manual: {
      bank: manual.bank.enabled ? { enabled: true, ...manual.bank.config } : { enabled: false },
      upi: manual.upi.enabled ? { enabled: true, ...manual.upi.config } : { enabled: false },
    },
    latestManual: latest ? {
      id: latest.id,
      planId: latest.planId,
      method: latest.method,
      amount: latest.amount,
      currency: latest.currency,
      reference: latest.reference,
      proofUrl: latest.proofUrl,
      note: latest.note,
      status: latest.status,
      reviewerNote: latest.reviewerNote,
      submittedAt: latest.createdAt.toISOString(),
      reviewedAt: latest.reviewedAt ? latest.reviewedAt.toISOString() : null,
    } : null,
    pendingManual: latest && latest.status === "pending" ? {
      id: latest.id,
      planId: latest.planId,
      method: latest.method,
      amount: latest.amount,
      status: latest.status,
      submittedAt: latest.createdAt.toISOString(),
    } : null,
  });
});

// ─── Razorpay: create order ──────────────────────────────────────
router.post("/restaurants/:restaurantId/subscription/create-razorpay-order", requireRole("owner", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const { planId } = req.body as { planId: number };
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  if (!plan) return void res.status(404).json({ error: "Plan not found" });

  const { enabled, config } = await getEffectiveRazorpayConfig();
  if (!enabled || !config) {
    return void res.status(400).json({ error: "Razorpay is not configured" });
  }

  const receipt = `kl_${tenantId}_${planId}_${Date.now()}`;
  try {
    const order = await createRazorpayOrder(config, {
      receipt,
      amount: Number(plan.price),
      currency: (plan.currency ?? "INR").toUpperCase(),
      notes: { tenantId: String(tenantId), planId: String(planId) },
    });
    res.json({ orderId: order.id, receipt, amount: order.amount, currency: order.currency, keyId: config.keyId });
  } catch (err) {
    logger.error({ err }, "Failed to create Razorpay order");
    res.status(502).json({ error: "Failed to create Razorpay order. Please try again or use a different payment method." });
  }
});

async function activateForTenant(
  tenantId: number,
  planId: number,
  externalRef: string,
  opts: { provider: "cashfree" | "razorpay" | "stripe" | "bank" | "upi" | "mock"; amount?: string; currency?: string; manualRequestId?: number } = { provider: "mock" },
): Promise<void> {
  // Idempotency guard: webhooks retry, and confirm + webhook can both fire for
  // the same order. We dedupe by externalRef so a single payment never extends
  // the subscription twice or creates duplicate billing-history rows.
  const [already] = await db.select({ id: subscriptionPaymentsTable.id })
    .from(subscriptionPaymentsTable)
    .where(eq(subscriptionPaymentsTable.externalRef, externalRef));
  if (already) return;

  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  const [existing] = await db.select({
    endsAt: tenantsTable.subscriptionEndsAt,
    currentPlanId: tenantsTable.planId,
    status: tenantsTable.planStatus,
  }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));

  const now = new Date();
  // Extend from the existing end date when renewing the same plan early —
  // otherwise (new plan, expired, or first activation) start the new term now.
  const sameActivePlan = existing?.currentPlanId === planId
    && existing?.status === "active"
    && existing?.endsAt
    && new Date(existing.endsAt).getTime() > now.getTime();
  const periodStart = sameActivePlan ? new Date(existing!.endsAt!) : now;
  const endsAt = new Date(periodStart);
  if (plan?.billingPeriod === "yearly") endsAt.setFullYear(endsAt.getFullYear() + 1);
  else endsAt.setMonth(endsAt.getMonth() + 1);

  await db.update(tenantsTable).set({
    planId,
    planStatus: "active",
    cashfreeSubscriptionId: externalRef,
    subscriptionStartedAt: sameActivePlan ? (existing!.endsAt ?? now) : now,
    subscriptionEndsAt: endsAt,
    updatedAt: now,
  }).where(eq(tenantsTable.id, tenantId));

  // Persist a payment record for billing history (mirrors what online success would write).
  await db.insert(subscriptionPaymentsTable).values({
    tenantId,
    planId,
    amount: opts.amount ?? String(plan?.price ?? "0"),
    currency: (opts.currency ?? plan?.currency ?? "INR").toUpperCase(),
    provider: opts.provider,
    externalRef,
    manualRequestId: opts.manualRequestId ?? null,
    periodStart,
    periodEnd: endsAt,
    status: "succeeded",
  });

  // Lifecycle SMS — payment received + subscription activated. Best-effort.
  const amountStr = opts.amount ?? String(plan?.price ?? "0");
  const currency = (opts.currency ?? plan?.currency ?? "INR").toUpperCase();
  const planName = plan?.name ?? "your plan";
  const endsAtStr = endsAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  void sendLifecycleSms({
    tenantId,
    eventKey: "payment_received",
    variables: { amount: amountStr, currency, plan: planName, ref: externalRef },
  });
  void sendLifecycleSms({
    tenantId,
    eventKey: "subscription_activated",
    variables: { plan: planName, endsAt: endsAtStr, amount: amountStr, currency },
  });
}

/**
 * Fan-out an in-app notification to every restaurant of a tenant. The
 * notifications table is restaurant-scoped, so tenant-wide messages are
 * mirrored to each branch's dashboard.
 */
async function notifyTenant(tenantId: number, type: string, title: string, message: string, entityId?: number) {
  const restaurants = await db.select({ id: restaurantsTable.id })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.tenantId, tenantId));
  if (restaurants.length === 0) return;
  await db.insert(notificationsTable).values(
    restaurants.map(r => ({
      restaurantId: r.id,
      type,
      title,
      message,
      entityId: entityId ?? null,
      entityType: "manual_payment_request",
    })),
  );
}

router.post("/restaurants/:restaurantId/subscription/razorpay-confirm", requireRole("owner", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const { orderId, paymentId, signature } = req.body as { orderId: string; paymentId: string; signature: string };
  if (!orderId || !paymentId || !signature) return void res.status(400).json({ error: "orderId, paymentId, signature required" });

  const { config } = await getEffectiveRazorpayConfig();
  if (!config) return void res.status(400).json({ error: "Razorpay not configured" });
  if (!verifyRazorpayPaymentSignature(config, orderId, paymentId, signature)) {
    return void res.status(400).json({ error: "Invalid Razorpay signature" });
  }
  // Re-fetch the order to recover tenantId/planId from receipt and confirm status.
  let order;
  try {
    order = await fetchRazorpayOrder(config, orderId);
  } catch (err) {
    logger.error({ err }, "razorpay-confirm fetch failed");
    return void res.status(502).json({ error: "Could not verify Razorpay order" });
  }
  const m = /^kl_(\d+)_(\d+)_/.exec(order.receipt ?? "");
  if (!m) return void res.status(400).json({ error: "Order receipt is malformed" });
  const orderTenantId = Number(m[1]);
  const orderPlanId = Number(m[2]);
  if (orderTenantId !== tenantId) return void res.status(403).json({ error: "This order does not belong to your tenant." });
  if (order.status !== "paid" && order.amount_paid < order.amount) {
    return void res.json({ activated: false, status: order.status });
  }
  await activateForTenant(orderTenantId, orderPlanId, `rzp_${orderId}`, {
    provider: "razorpay",
    amount: typeof order.amount === "number" ? (order.amount / 100).toFixed(2) : undefined,
    currency: typeof order.currency === "string" ? order.currency : undefined,
  });
  res.json({ activated: true });
});

export function createRazorpayWebhookRouter(): Router {
  const r = Router();
  r.post("/razorpay/webhook", async (req: Request, res: Response) => {
    const { config } = await getEffectiveRazorpayConfig();
    if (!config?.webhookSecret) return void res.status(200).json({ received: true });
    const raw = req.body instanceof Buffer ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const sig = req.headers["x-razorpay-signature"] as string | undefined;
    if (!verifyRazorpayWebhook(raw, sig, config.webhookSecret)) {
      return void res.status(401).json({ error: "Invalid Razorpay signature" });
    }
    let event: { event?: string; payload?: { payment?: { entity?: { order_id?: string; status?: string } }; order?: { entity?: { id?: string; receipt?: string; status?: string; amount?: number; amount_paid?: number } } } };
    try { event = JSON.parse(raw); } catch { return void res.status(400).json({ error: "Invalid JSON" }); }
    try {
      const orderId = event.payload?.order?.entity?.id ?? event.payload?.payment?.entity?.order_id;
      const isSuccess = event.event === "payment.captured" || event.event === "order.paid";
      if (orderId && isSuccess) {
        const order = await fetchRazorpayOrder(config, orderId);
        const m = /^kl_(\d+)_(\d+)_/.exec(order.receipt ?? "");
        if (m) await activateForTenant(Number(m[1]), Number(m[2]), `rzp_${orderId}`, {
          provider: "razorpay",
          amount: typeof order.amount === "number" ? (order.amount / 100).toFixed(2) : undefined,
          currency: typeof order.currency === "string" ? order.currency : undefined,
        });
      }
    } catch (err) {
      logger.error({ err }, "Razorpay webhook processing error");
      return void res.status(500).json({ error: "Webhook handler failed — will retry" });
    }
    res.json({ received: true });
  });
  return r;
}

// ─── Tenant: submit a manual payment ─────────────────────────────
router.post("/restaurants/:restaurantId/subscription/manual-payment", requireRole("owner", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const { planId, method, reference, proofUrl, note, amount } = req.body as {
    planId: number; method: string; reference?: string; proofUrl?: string; note?: string; amount?: number | string;
  };
  if (!planId || (method !== "bank" && method !== "upi")) {
    return void res.status(400).json({ error: "planId and method (bank|upi) are required" });
  }
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  if (!plan) return void res.status(404).json({ error: "Plan not found" });

  const manual = await getEnabledManualMethods();
  if ((method === "bank" && !manual.bank.enabled) || (method === "upi" && !manual.upi.enabled)) {
    return void res.status(400).json({ error: `${method.toUpperCase()} payments are not enabled` });
  }

  // Manual bank/UPI methods are India-only — they settle in INR. Tenants on a
  // non-INR plan must use an online provider that supports their currency.
  const planCurrency = (plan.currency ?? "INR").toUpperCase();
  if (planCurrency !== "INR") {
    return void res.status(400).json({ error: "Manual bank/UPI payments are only available for INR-priced plans. Please use an online provider." });
  }

  // Prevent multiple pending requests piling up. Rejected/approved are fine —
  // the tenant must be allowed to resubmit after a rejection.
  const [pending] = await db.select({ id: manualPaymentRequestsTable.id }).from(manualPaymentRequestsTable)
    .where(and(eq(manualPaymentRequestsTable.tenantId, tenantId), eq(manualPaymentRequestsTable.status, "pending")));
  if (pending) {
    return void res.status(409).json({ error: "You already have a pending manual payment under review." });
  }

  // Tenants may declare an amount they actually paid (must be > 0). It still
  // gets reviewed; if it doesn't match plan price the admin can reject.
  let finalAmount = String(plan.price);
  if (amount !== undefined && amount !== "") {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      return void res.status(400).json({ error: "Invalid amount" });
    }
    finalAmount = n.toFixed(2);
  }

  const [created] = await db.insert(manualPaymentRequestsTable).values({
    tenantId,
    planId,
    amount: finalAmount,
    currency: (plan.currency ?? "INR").toUpperCase(),
    method,
    reference: reference ?? null,
    proofUrl: proofUrl ?? null,
    note: note ?? null,
    status: "pending",
    submittedBy: req.user?.id ?? null,
  }).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "manual_payment.submitted",
    entity: "manual_payment_request",
    entityId: created.id,
    details: `tenant=${tenantId} plan=${planId} method=${method}`,
  });

  res.status(201).json({ id: created.id, status: created.status });
});

router.get("/restaurants/:restaurantId/subscription/manual-payments", requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const rows = await db.select().from(manualPaymentRequestsTable)
    .where(eq(manualPaymentRequestsTable.tenantId, tenantId))
    .orderBy(desc(manualPaymentRequestsTable.createdAt))
    .limit(20);
  res.json({ data: rows });
});

// ─── Super admin: manual payment approvals ───────────────────────
router.get("/admin/manual-payments", requireSuperAdmin, async (req, res) => {
  const status = (req.query.status as string | undefined) ?? "pending";
  const rows = await db.select({
    id: manualPaymentRequestsTable.id,
    tenantId: manualPaymentRequestsTable.tenantId,
    tenantName: tenantsTable.name,
    planId: manualPaymentRequestsTable.planId,
    planName: subscriptionPlansTable.name,
    amount: manualPaymentRequestsTable.amount,
    currency: manualPaymentRequestsTable.currency,
    method: manualPaymentRequestsTable.method,
    reference: manualPaymentRequestsTable.reference,
    proofUrl: manualPaymentRequestsTable.proofUrl,
    note: manualPaymentRequestsTable.note,
    status: manualPaymentRequestsTable.status,
    reviewerNote: manualPaymentRequestsTable.reviewerNote,
    reviewedBy: manualPaymentRequestsTable.reviewedBy,
    reviewedAt: manualPaymentRequestsTable.reviewedAt,
    submittedBy: manualPaymentRequestsTable.submittedBy,
    submittedByName: usersTable.name,
    createdAt: manualPaymentRequestsTable.createdAt,
  })
    .from(manualPaymentRequestsTable)
    .leftJoin(tenantsTable, eq(tenantsTable.id, manualPaymentRequestsTable.tenantId))
    .leftJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, manualPaymentRequestsTable.planId))
    .leftJoin(usersTable, eq(usersTable.id, manualPaymentRequestsTable.submittedBy))
    .where(status === "all" ? undefined : eq(manualPaymentRequestsTable.status, status))
    .orderBy(desc(manualPaymentRequestsTable.createdAt))
    .limit(100);
  res.json({ data: rows });
});

router.post("/admin/manual-payments/:id/approve", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const [reqRow] = await db.select().from(manualPaymentRequestsTable).where(eq(manualPaymentRequestsTable.id, id));
  if (!reqRow) return void res.status(404).json({ error: "Request not found" });
  if (reqRow.status !== "pending") return void res.status(400).json({ error: `Request is already ${reqRow.status}` });
  const { note } = (req.body ?? {}) as { note?: string };

  await activateForTenant(reqRow.tenantId, reqRow.planId, `manual_${reqRow.method}_${reqRow.id}`, {
    provider: reqRow.method === "bank" ? "bank" : "upi",
    amount: String(reqRow.amount),
    currency: reqRow.currency,
    manualRequestId: reqRow.id,
  });
  await db.update(manualPaymentRequestsTable).set({
    status: "approved",
    reviewerNote: note ?? null,
    reviewedBy: req.user?.id ?? null,
    reviewedAt: new Date(),
  }).where(eq(manualPaymentRequestsTable.id, id));

  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "manual_payment.approved",
    entity: "manual_payment_request",
    entityId: id,
    details: `tenant=${reqRow.tenantId} plan=${reqRow.planId} method=${reqRow.method}`,
  });

  await notifyTenant(
    reqRow.tenantId,
    "subscription.payment_approved",
    "Payment approved",
    `Your ${reqRow.method.toUpperCase()} payment of ${reqRow.currency} ${reqRow.amount} has been approved and your subscription is now active.`,
    id,
  );
  res.json({ ok: true });
});

router.post("/admin/manual-payments/:id/reject", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = (req.body ?? {}) as { reason?: string };
  if (!reason) return void res.status(400).json({ error: "reason is required" });
  const [reqRow] = await db.select().from(manualPaymentRequestsTable).where(eq(manualPaymentRequestsTable.id, id));
  if (!reqRow) return void res.status(404).json({ error: "Request not found" });
  if (reqRow.status !== "pending") return void res.status(400).json({ error: `Request is already ${reqRow.status}` });

  await db.update(manualPaymentRequestsTable).set({
    status: "rejected",
    reviewerNote: reason,
    reviewedBy: req.user?.id ?? null,
    reviewedAt: new Date(),
  }).where(eq(manualPaymentRequestsTable.id, id));

  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "manual_payment.rejected",
    entity: "manual_payment_request",
    entityId: id,
    details: `tenant=${reqRow.tenantId} reason=${reason}`,
  });

  await notifyTenant(
    reqRow.tenantId,
    "subscription.payment_rejected",
    "Payment rejected",
    `Your ${reqRow.method.toUpperCase()} payment of ${reqRow.currency} ${reqRow.amount} was rejected. Reason: ${reason}. You can resubmit with corrected details from the Subscription page.`,
    id,
  );
  res.json({ ok: true });
});

// Helper export so the existing subscriptions router can reuse the
// "is cashfree configured?" calculation without duplicating the SQL.
export { getEffectiveCashfreeConfig, getEffectiveRazorpayConfig } from "../lib/paymentSettings";

export default router;
