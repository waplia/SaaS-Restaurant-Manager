import { Router, type Request, type Response } from "express";
import { eq, desc, and } from "drizzle-orm";
import {
  db, paymentMethodSettingsTable, manualPaymentRequestsTable, subscriptionPaymentsTable,
  tenantsTable, subscriptionPlansTable, usersTable, auditLogsTable,
  notificationsTable, restaurantsTable, subscriptionCouponsTable,
} from "../lib/db";
import {
  validateCoupon, recordRedemption, snapshotCoupon, countPriorPayments, effectiveStatus,
} from "../lib/coupons";
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
import { sendByTemplateKey } from "../lib/emailSender";
import { recordAuditLog } from "../lib/audit";

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
  await recordAuditLog({
    req, module: "billing", action: "payment_method.update", entity: "payment_method",
    entityId: null, newValue: { provider: row.provider, isEnabled, isDefault, config },
  });
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
  const { planId, couponCode, billingPeriod: bodyPeriod } = req.body as {
    planId: number; couponCode?: string; billingPeriod?: "monthly" | "yearly";
  };
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  if (!plan) return void res.status(404).json({ error: "Plan not found" });

  const { enabled, config } = await getEffectiveRazorpayConfig();
  if (!enabled || !config) {
    return void res.status(400).json({ error: "Razorpay is not configured" });
  }

  // Resolve the chosen billing period and pick the matching list price.
  const period: "monthly" | "yearly" = bodyPeriod === "yearly" || bodyPeriod === "monthly"
    ? bodyPeriod : (plan.billingPeriod === "yearly" ? "yearly" : "monthly");
  const yearlyConfigured = plan.yearlyPrice != null && Number(plan.yearlyPrice) > 0;
  if (period === "yearly" && !yearlyConfigured && plan.billingPeriod !== "yearly") {
    return void res.status(400).json({ error: "This plan does not offer yearly billing." });
  }
  const listPrice = (period === "yearly" && yearlyConfigured) ? Number(plan.yearlyPrice) : Number(plan.price);

  // Resolve coupon (if any) so we charge the discounted amount.
  let amountToCharge = listPrice;
  let appliedCouponCode: string | null = null;
  if (couponCode) {
    const isFirst = (await countPriorPayments(tenantId, plan.id)) === 0;
    const r = await validateCoupon({ code: couponCode, tenantId, plan: { id: plan.id, price: String(listPrice) }, action: "payment", isFirstCycle: isFirst });
    if (!r.ok) return void res.status(400).json({ error: r.message, reason: r.reason });
    amountToCharge = r.resolved.effectiveAmount;
    appliedCouponCode = r.resolved.coupon.code;
  }

  // If a coupon zeros the price out, skip Razorpay entirely and activate now.
  if (amountToCharge <= 0) {
    const externalRef = `coupon_free_${tenantId}_${planId}_${Date.now()}`;
    await activateForTenant(tenantId, planId, externalRef, {
      provider: "razorpay", amount: "0.00", currency: (plan.currency ?? "INR").toUpperCase(),
      couponCode: appliedCouponCode, redeemedBy: req.user?.id ?? null,
      billingPeriod: period,
    });
    return void res.json({ orderId: null, activated: true, freeActivation: true, couponCode: appliedCouponCode });
  }

  const periodTag = period === "yearly" ? "y" : "m";
  const receipt = `kl_${tenantId}_${planId}_${periodTag}_${Date.now()}`;
  try {
    const order = await createRazorpayOrder(config, {
      receipt,
      amount: amountToCharge,
      currency: (plan.currency ?? "INR").toUpperCase(),
      notes: { tenantId: String(tenantId), planId: String(planId), ...(appliedCouponCode ? { couponCode: appliedCouponCode } : {}) },
    });
    res.json({ orderId: order.id, receipt, amount: order.amount, currency: order.currency, keyId: config.keyId, couponCode: appliedCouponCode });
  } catch (err) {
    logger.error({ err }, "Failed to create Razorpay order");
    res.status(502).json({ error: "Failed to create Razorpay order. Please try again or use a different payment method." });
  }
});

export async function activateForTenant(
  tenantId: number,
  planId: number,
  externalRef: string,
  opts: { provider: "cashfree" | "razorpay" | "stripe" | "bank" | "upi" | "mock"; amount?: string; currency?: string; manualRequestId?: number; couponCode?: string | null; redeemedBy?: number | null; billingPeriod?: "monthly" | "yearly" } = { provider: "mock" },
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
    lifetimeCouponId: tenantsTable.lifetimeCouponId,
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
  // Effective period: explicit caller choice > plan's default billingPeriod.
  const effectivePeriod: "monthly" | "yearly" =
    opts.billingPeriod ?? (plan?.billingPeriod === "yearly" ? "yearly" : "monthly");
  if (effectivePeriod === "yearly") endsAt.setFullYear(endsAt.getFullYear() + 1);
  else endsAt.setMonth(endsAt.getMonth() + 1);

  // Resolve the coupon to apply, if any. Order of precedence:
  //  1. Explicit code passed to this activation (one-shot codes, first-month, etc.)
  //  2. Tenant's persisted lifetime coupon (auto-reapplied on every renewal)
  // Effective list price for this activation: yearly when we're activating a
  // yearly term and the admin set a real one; otherwise the plan's stored
  // monthly price. Used both for coupon validation and amount derivation so
  // the two stay in lockstep.
  const effectiveListPrice = (effectivePeriod === "yearly" && plan?.yearlyPrice != null && Number(plan.yearlyPrice) > 0)
    ? Number(plan.yearlyPrice)
    : Number(plan?.price ?? 0);

  let resolved: Awaited<ReturnType<typeof validateCoupon>> | null = null;
  let couponApplied: { id: number; code: string; type: string; discountApplied: number } | null = null;
  const isFirstCycle = plan ? (await countPriorPayments(tenantId, planId)) === 0 : true;
  if (opts.couponCode && plan) {
    const r = await validateCoupon({
      code: opts.couponCode, tenantId, plan: { id: plan.id, price: String(effectiveListPrice) }, action: "payment", isFirstCycle,
    });
    if (r.ok) resolved = r;
    else logger.warn({ tenantId, planId, code: opts.couponCode, reason: r.reason }, "coupon failed validation at activation");
  } else if (existing?.lifetimeCouponId && plan) {
    const [c] = await db.select().from(subscriptionCouponsTable).where(eq(subscriptionCouponsTable.id, existing.lifetimeCouponId));
    if (c && c.discountType === "lifetime" && effectiveStatus(c) === "active") {
      const r = await validateCoupon({
        code: c.code, tenantId, plan: { id: plan.id, price: String(effectiveListPrice) }, action: "payment", isFirstCycle,
      });
      if (r.ok) resolved = r;
    }
  }

  // Compute final amount: prefer the caller's amount (what was actually charged)
  // but if not provided, derive from plan price minus discount.
  const planCurrency = (opts.currency ?? plan?.currency ?? "INR").toUpperCase();
  const planListPrice = effectiveListPrice;
  const baseAmount = opts.amount !== undefined ? Number(opts.amount) : planListPrice;
  const discountAmount = resolved?.ok ? resolved.resolved.discountAmount : 0;
  const finalAmount = (resolved?.ok && opts.amount === undefined)
    ? resolved.resolved.effectiveAmount.toFixed(2)
    : baseAmount.toFixed(2);

  await db.update(tenantsTable).set({
    planId,
    planStatus: "active",
    cashfreeSubscriptionId: externalRef,
    subscriptionStartedAt: sameActivePlan ? (existing!.endsAt ?? now) : now,
    subscriptionEndsAt: endsAt,
    // Persist (or clear+set) the lifetime coupon so future renewals reapply it.
    ...(resolved?.ok && resolved.resolved.persistOnTenant ? {
      lifetimeCouponId: resolved.resolved.coupon.id,
      lifetimeCouponSnapshot: snapshotCoupon(resolved.resolved.coupon) as unknown as Record<string, unknown>,
    } : {}),
    updatedAt: now,
  }).where(eq(tenantsTable.id, tenantId));

  // Persist a payment record for billing history (mirrors what online success would write).
  const [payment] = await db.insert(subscriptionPaymentsTable).values({
    tenantId,
    planId,
    amount: finalAmount,
    currency: planCurrency,
    provider: opts.provider,
    externalRef,
    manualRequestId: opts.manualRequestId ?? null,
    periodStart,
    periodEnd: endsAt,
    status: "succeeded",
    couponId: resolved?.ok ? resolved.resolved.coupon.id : null,
    discountApplied: resolved?.ok ? discountAmount.toFixed(2) : null,
    couponSnapshot: resolved?.ok ? (snapshotCoupon(resolved.resolved.coupon) as unknown as Record<string, unknown>) : null,
  }).returning({ id: subscriptionPaymentsTable.id });

  if (resolved?.ok) {
    await recordRedemption({
      coupon: resolved.resolved.coupon,
      tenantId,
      planId,
      paymentId: payment?.id ?? null,
      manualRequestId: opts.manualRequestId ?? null,
      discountApplied: discountAmount,
      context: opts.manualRequestId ? "manual_admin" : "payment",
      redeemedBy: opts.redeemedBy ?? null,
      metadata: { provider: opts.provider, externalRef },
    });
    couponApplied = { id: resolved.resolved.coupon.id, code: resolved.resolved.coupon.code, type: resolved.resolved.coupon.discountType, discountApplied: discountAmount };
    await db.insert(auditLogsTable).values({
      userId: opts.redeemedBy ?? null,
      action: "coupon.redeemed",
      entity: "coupon",
      entityId: resolved.resolved.coupon.id,
      details: `tenant=${tenantId} plan=${planId} code=${couponApplied.code} discount=${discountAmount.toFixed(2)} ${planCurrency}`,
    });
  }

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

  // Khana AI — credit the monthly allowance for the new subscription period.
  // Idempotent: skipped if this period was already allocated.
  try {
    const { creditMonthlyAllocation } = await import("../lib/aiCredits");
    // On plan activation, today is the start of the new renewal cycle —
    // creditMonthlyAllocation is idempotent on (tenantId, periodStart) so
    // calling it without `force` is safe and won't double-grant.
    await creditMonthlyAllocation(tenantId);
  } catch (err) {
    logger.warn({ err, tenantId }, "[ai-credits] failed to allocate monthly credits on activation");
  }
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
  const { orderId, paymentId, signature, couponCode } = req.body as { orderId: string; paymentId: string; signature: string; couponCode?: string };
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
  const m = /^kl_(\d+)_(\d+)(?:_([my]))?_/.exec(order.receipt ?? "");
  if (!m) return void res.status(400).json({ error: "Order receipt is malformed" });
  const orderTenantId = Number(m[1]);
  const orderPlanId = Number(m[2]);
  const orderPeriod: "monthly" | "yearly" | undefined =
    m[3] === "y" ? "yearly" : m[3] === "m" ? "monthly" : undefined;
  if (orderTenantId !== tenantId) return void res.status(403).json({ error: "This order does not belong to your tenant." });
  if (order.status !== "paid" && order.amount_paid < order.amount) {
    return void res.json({ activated: false, status: order.status });
  }
  // Recover the coupon code from the order notes (set during create-order) if
  // the client didn't echo it back. This makes the redemption resilient to
  // page refreshes between checkout and confirm.
  const orderCouponCode = couponCode
    ?? (order.notes && typeof (order.notes as Record<string, unknown>).couponCode === "string"
      ? String((order.notes as Record<string, unknown>).couponCode) : null);
  await activateForTenant(orderTenantId, orderPlanId, `rzp_${orderId}`, {
    provider: "razorpay",
    amount: typeof order.amount === "number" ? (order.amount / 100).toFixed(2) : undefined,
    currency: typeof order.currency === "string" ? order.currency : undefined,
    couponCode: orderCouponCode,
    redeemedBy: req.user?.id ?? null,
    billingPeriod: orderPeriod,
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
      const isFailed = event.event === "payment.failed";
      if (orderId && isSuccess) {
        const order = await fetchRazorpayOrder(config, orderId);
        const m = /^kl_(\d+)_(\d+)(?:_([my]))?_/.exec(order.receipt ?? "");
        const period: "monthly" | "yearly" | undefined =
          m?.[3] === "y" ? "yearly" : m?.[3] === "m" ? "monthly" : undefined;
        if (m) await activateForTenant(Number(m[1]), Number(m[2]), `rzp_${orderId}`, {
          provider: "razorpay",
          amount: typeof order.amount === "number" ? (order.amount / 100).toFixed(2) : undefined,
          currency: typeof order.currency === "string" ? order.currency : undefined,
          billingPeriod: period,
        });
      } else if (orderId && isFailed) {
        try {
          const order = await fetchRazorpayOrder(config, orderId);
          const m = /^kl_(\d+)_(\d+)(?:_[my])?_/.exec(order.receipt ?? "");
          if (m) {
            const tenantId = Number(m[1]);
            const owners = await db.select({ email: usersTable.email, name: usersTable.name })
              .from(usersTable).where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.role, "owner"), eq(usersTable.isActive, true)));
            const retryUrl = `${(process.env.PUBLIC_APP_URL ?? "https://khanalagao.app").replace(/\/$/, "")}/settings/subscription`;
            for (const o of owners) {
              if (!o.email) continue;
              await sendByTemplateKey("payment_failed", o.email, {
                name: o.name ?? "there",
                amount: typeof order.amount === "number" ? (order.amount / 100).toFixed(2) : "",
                currency: typeof order.currency === "string" ? order.currency : "INR",
                reason: "Payment was declined by the gateway",
                retryUrl,
                appName: "Khana Lagao",
              }, { tenantId });
            }
          }
        } catch (err) { logger.error({ err }, "Razorpay payment_failed email failed"); }
      }
    } catch (err) {
      logger.error({ err }, "Razorpay webhook processing error");
      const { recordSystemLog } = await import("../lib/systemLogs");
      await recordSystemLog({
        category: "payment_webhook", source: "razorpay", status: "failed", level: "error",
        message: `Razorpay webhook processing error: ${(err as Error).message}`, stack: (err as Error).stack ?? null,
        payload: { event: event.event }, route: "/api/razorpay/webhook", method: "POST", statusCode: 500,
      });
      return void res.status(500).json({ error: "Webhook handler failed — will retry" });
    }
    const { recordSystemLog } = await import("../lib/systemLogs");
    await recordSystemLog({
      category: "payment_webhook", source: "razorpay", status: "success", level: "info",
      message: `Razorpay webhook processed: ${event.event ?? "unknown"}`, payload: { event: event.event },
      route: "/api/razorpay/webhook", method: "POST", statusCode: 200,
    });
    res.json({ received: true });
  });
  return r;
}

// ─── Tenant: submit a manual payment ─────────────────────────────
router.post("/restaurants/:restaurantId/subscription/manual-payment", requireRole("owner", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const { planId, method, reference, proofUrl, note, amount, couponCode, billingPeriod: bodyPeriod } = req.body as {
    planId: number; method: string; reference?: string; proofUrl?: string; note?: string; amount?: number | string; couponCode?: string;
    billingPeriod?: "monthly" | "yearly";
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

  // Resolve the chosen billing period and pick the matching list price.
  const period: "monthly" | "yearly" = bodyPeriod === "yearly" || bodyPeriod === "monthly"
    ? bodyPeriod : (plan.billingPeriod === "yearly" ? "yearly" : "monthly");
  const yearlyConfigured = plan.yearlyPrice != null && Number(plan.yearlyPrice) > 0;
  if (period === "yearly" && !yearlyConfigured && plan.billingPeriod !== "yearly") {
    return void res.status(400).json({ error: "This plan does not offer yearly billing." });
  }
  const listPrice = (period === "yearly" && yearlyConfigured) ? Number(plan.yearlyPrice) : Number(plan.price);

  // If a coupon is supplied, validate it now and use the discounted price as
  // the default amount the tenant should pay. They can still override with a
  // declared amount, but the admin sees the coupon attached on review.
  let normalisedCoupon: string | null = null;
  let discountedPrice = listPrice;
  if (couponCode) {
    const isFirst = (await countPriorPayments(tenantId, plan.id)) === 0;
    const r = await validateCoupon({ code: couponCode, tenantId, plan: { id: plan.id, price: String(listPrice) }, action: "payment", isFirstCycle: isFirst });
    if (!r.ok) return void res.status(400).json({ error: r.message, reason: r.reason });
    normalisedCoupon = r.resolved.coupon.code;
    discountedPrice = r.resolved.effectiveAmount;
  }

  // Tenants may declare an amount they actually paid (must be >= 0). It still
  // gets reviewed; if it doesn't match plan price the admin can reject.
  let finalAmount = discountedPrice.toFixed(2);
  if (amount !== undefined && amount !== "") {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) {
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
    couponCode: normalisedCoupon,
    billingPeriod: period,
  }).returning();

  await recordAuditLog({
    req, module: "billing", action: "manual_payment.submit", entity: "manual_payment_request",
    entityId: created.id, restaurantId: Number(req.params.restaurantId),
    newValue: { tenantId, planId, method, reference: reference ?? null },
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
    couponCode: reqRow.couponCode ?? null,
    redeemedBy: req.user?.id ?? null,
    billingPeriod: reqRow.billingPeriod === "yearly" || reqRow.billingPeriod === "monthly"
      ? reqRow.billingPeriod : undefined,
  });
  await db.update(manualPaymentRequestsTable).set({
    status: "approved",
    reviewerNote: note ?? null,
    reviewedBy: req.user?.id ?? null,
    reviewedAt: new Date(),
  }).where(eq(manualPaymentRequestsTable.id, id));

  await recordAuditLog({
    req, module: "billing", action: "manual_payment.approve", entity: "manual_payment_request",
    entityId: id, newValue: { tenantId: reqRow.tenantId, planId: reqRow.planId, method: reqRow.method, note },
    details: `tenant=${reqRow.tenantId} plan=${reqRow.planId} method=${reqRow.method}`,
  });

  await notifyTenant(
    reqRow.tenantId,
    "subscription.payment_approved",
    "Payment approved",
    `Your ${reqRow.method.toUpperCase()} payment of ${reqRow.currency} ${reqRow.amount} has been approved and your subscription is now active.`,
    id,
  );

  const [owner] = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.tenantId, reqRow.tenantId), eq(usersTable.role, "owner")))
    .limit(1);
  const [plan] = await db.select({ name: subscriptionPlansTable.name })
    .from(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.id, reqRow.planId));
  if (owner?.email) {
    void sendByTemplateKey("payment_successful", owner.email, {
      name: owner.name,
      amount: String(reqRow.amount),
      currency: reqRow.currency,
      plan: plan?.name ?? "your plan",
      invoiceUrl: "",
    }, { tenantId: reqRow.tenantId });
    void sendByTemplateKey("subscription_activated", owner.email, {
      name: owner.name,
      plan: plan?.name ?? "your plan",
      renewsAt: "",
      appName: "Khana Lagao",
    }, { tenantId: reqRow.tenantId });
  }
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

  await recordAuditLog({
    req, module: "billing", action: "manual_payment.reject", entity: "manual_payment_request",
    entityId: id, newValue: { tenantId: reqRow.tenantId, reason },
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
