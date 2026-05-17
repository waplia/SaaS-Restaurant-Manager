import { Router } from "express";
import Stripe from "stripe";
import { eq, and, count } from "drizzle-orm";
import { db, tenantsTable, subscriptionPlansTable, usersTable, floorTablesTable, menuItemsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  createCashfreeOrder, fetchCashfreeOrder, buildCheckoutUrl, verifyCashfreeWebhook,
} from "../lib/cashfree";
import { getEffectiveCashfreeConfig, getEffectiveRazorpayConfig } from "../lib/paymentSettings";
import { activateForTenant } from "./billing";
import { validateCoupon, countPriorPayments } from "../lib/coupons";
import { logger } from "../lib/logger";
import { recordSystemLog } from "../lib/systemLogs";
import type { Request, Response } from "express";

const router = Router();

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), validateRestaurantAccess);

router.get("/restaurants/:restaurantId/subscription", async (req, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return void res.status(404).json({ error: "Tenant not found" });

  let plan = null;
  if (tenant.planId) {
    const [p] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
    plan = p ?? null;
  }

  const plans = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.isActive, true)).orderBy(subscriptionPlansTable.price);

  const restaurantId = Number(req.params.restaurantId);
  const [staffCount, tableCount, menuItemCount, cashfree, razorpay] = await Promise.all([
    db.select({ count: count() }).from(usersTable).where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true))),
    db.select({ count: count() }).from(floorTablesTable).where(and(eq(floorTablesTable.restaurantId, restaurantId), eq(floorTablesTable.isActive, true))),
    db.select({ count: count() }).from(menuItemsTable).where(and(eq(menuItemsTable.restaurantId, restaurantId), eq(menuItemsTable.isAvailable, true))),
    getEffectiveCashfreeConfig(),
    getEffectiveRazorpayConfig(),
  ]);

  const now = new Date();
  const trialDaysLeft = tenant.trialEndsAt
    ? Math.max(0, Math.ceil((tenant.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : null;
  const isTrialExpired = tenant.planStatus === "trial" && tenant.trialEndsAt ? tenant.trialEndsAt < now : false;

  res.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      planStatus: tenant.planStatus,
      trialEndsAt: tenant.trialEndsAt,
      trialDaysLeft,
      isTrialExpired,
      stripeCustomerId: tenant.stripeCustomerId,
      stripeSubscriptionId: tenant.stripeSubscriptionId,
      cashfreeCustomerId: tenant.cashfreeCustomerId,
      cashfreeSubscriptionId: tenant.cashfreeSubscriptionId,
      subscriptionStartedAt: tenant.subscriptionStartedAt,
      subscriptionEndsAt: tenant.subscriptionEndsAt,
    },
    plan,
    plans,
    usage: {
      staffCount: staffCount[0]?.count ?? 0,
      tableCount: tableCount[0]?.count ?? 0,
      menuItemCount: menuItemCount[0]?.count ?? 0,
    },
    gateways: {
      stripe: !!getStripe(),
      cashfree: cashfree.enabled,
      razorpay: razorpay.enabled,
    },
  });
});

router.post("/restaurants/:restaurantId/subscription/create-checkout", requireRole("owner", "super_admin"), async (req, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });

  const { planId, successUrl, cancelUrl, billingPeriod: bodyPeriod } = req.body as {
    planId: number; successUrl: string; cancelUrl: string; billingPeriod?: "monthly" | "yearly";
  };

  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  if (!plan) return void res.status(404).json({ error: "Plan not found" });

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return void res.status(404).json({ error: "Tenant not found" });

  const stripe = getStripe();
  if (!stripe) {
    return void res.json({ url: null, mock: true, message: "Stripe not configured — using mock checkout" });
  }

  let customerId = tenant.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ name: tenant.name, metadata: { tenantId: String(tenantId) } });
    customerId = customer.id;
    await db.update(tenantsTable).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(tenantsTable.id, tenantId));
  }

  // Resolve the chosen billing period and the right amount/price ID for it.
  const period: "monthly" | "yearly" = bodyPeriod === "yearly" || bodyPeriod === "monthly"
    ? bodyPeriod
    : (plan.billingPeriod === "yearly" ? "yearly" : "monthly");
  const yearlyConfigured = plan.yearlyPrice != null && Number(plan.yearlyPrice) > 0;
  if (period === "yearly" && !yearlyConfigured && plan.billingPeriod !== "yearly") {
    return void res.status(400).json({ error: "This plan does not offer yearly billing." });
  }
  const presetPriceId = period === "yearly" ? plan.stripeYearlyPriceId : plan.stripeMonthlyPriceId;
  const stripeCurrency = (plan.currency ?? "INR").toLowerCase();

  const lineItems: Stripe.Checkout.SessionCreateParams["line_items"] = [
    presetPriceId
      ? { price: presetPriceId, quantity: 1 }
      : {
          price_data: {
            currency: stripeCurrency,
            product_data: { name: plan.name, description: (plan.features ?? []).join(", ") },
            unit_amount: Math.round(
              (period === "yearly" && yearlyConfigured
                ? Number(plan.yearlyPrice)
                : Number(plan.price)) * 100,
            ),
            recurring: { interval: period === "yearly" ? "year" : "month" },
          },
          quantity: 1,
        },
  ];

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    mode: "subscription",
    line_items: lineItems,
    metadata: { tenantId: String(tenantId), planId: String(planId), billingPeriod: period },
    success_url: successUrl + "?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: cancelUrl,
  });

  res.json({ url: session.url, sessionId: session.id });
});

router.post("/restaurants/:restaurantId/subscription/create-cashfree-order", requireRole("owner", "super_admin"), async (req, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });

  const { planId, successUrl, couponCode, billingPeriod: bodyPeriod } = req.body as {
    planId: number; successUrl: string; couponCode?: string; billingPeriod?: "monthly" | "yearly";
  };
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  if (!plan) return void res.status(404).json({ error: "Plan not found" });
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return void res.status(404).json({ error: "Tenant not found" });

  const { enabled, config } = await getEffectiveCashfreeConfig();
  if (!enabled || !config) {
    return void res.json({ url: null, mock: true, message: "Cashfree not configured — using mock checkout" });
  }

  // Resolve the chosen billing period and pick the matching list price.
  const period: "monthly" | "yearly" = bodyPeriod === "yearly" || bodyPeriod === "monthly"
    ? bodyPeriod : (plan.billingPeriod === "yearly" ? "yearly" : "monthly");
  const yearlyConfigured = plan.yearlyPrice != null && Number(plan.yearlyPrice) > 0;
  if (period === "yearly" && !yearlyConfigured && plan.billingPeriod !== "yearly") {
    return void res.status(400).json({ error: "This plan does not offer yearly billing." });
  }
  const listPrice = (period === "yearly" && yearlyConfigured) ? Number(plan.yearlyPrice) : Number(plan.price);

  // Validate the coupon now so we charge the discounted amount through Cashfree.
  let amountToCharge = listPrice;
  let appliedCouponCode: string | null = null;
  if (couponCode) {
    const isFirst = (await countPriorPayments(tenantId, plan.id)) === 0;
    const r = await validateCoupon({ code: couponCode, tenantId, plan: { id: plan.id, price: String(listPrice) }, action: "payment", isFirstCycle: isFirst });
    if (!r.ok) return void res.status(400).json({ error: r.message, reason: r.reason });
    amountToCharge = r.resolved.effectiveAmount;
    appliedCouponCode = r.resolved.coupon.code;
  }

  const [owner] = await db.select().from(usersTable)
    .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.role, "owner"), eq(usersTable.isActive, true)))
    .limit(1);

  // Encode the billing period into the order id so the webhook can recover it.
  const periodTag = period === "yearly" ? "y" : "m";
  const cfOrderId = `kl_${tenantId}_${planId}_${periodTag}_${Date.now()}`;
  const customerIdStr = tenant.cashfreeCustomerId ?? `tenant_${tenantId}`;

  // Coupon-zeroed payments skip Cashfree entirely and activate immediately.
  if (amountToCharge <= 0) {
    await activateForTenant(tenantId, planId, `coupon_free_${cfOrderId}`, {
      provider: "cashfree", amount: "0.00", currency: (plan.currency ?? "INR").toUpperCase(),
      couponCode: appliedCouponCode, redeemedBy: req.user?.id ?? null,
      billingPeriod: period,
    });
    return void res.json({ url: null, freeActivation: true, couponCode: appliedCouponCode });
  }

  try {
    const order = await createCashfreeOrder(config, {
      orderId: cfOrderId,
      amount: amountToCharge,
      currency: (plan.currency ?? "INR").toUpperCase(),
      customerId: customerIdStr,
      customerName: owner?.name ?? tenant.name,
      customerEmail: owner?.email ?? `tenant${tenantId}@khanalagao.app`,
      customerPhone: owner?.phone ?? "9999999999",
      returnUrl: successUrl,
      notes: { tenantId: String(tenantId), planId: String(planId), ...(appliedCouponCode ? { couponCode: appliedCouponCode } : {}) },
    });

    if (!tenant.cashfreeCustomerId) {
      await db.update(tenantsTable).set({ cashfreeCustomerId: customerIdStr, updatedAt: new Date() }).where(eq(tenantsTable.id, tenantId));
    }

    const url = order.payment_session_id ? buildCheckoutUrl(config, order.payment_session_id) : null;
    res.json({ url, orderId: cfOrderId, paymentSessionId: order.payment_session_id ?? null });
  } catch (err) {
    logger.error({ err }, "Failed to create Cashfree order");
    res.status(502).json({ error: "Failed to create Cashfree order. Please try again or use a different payment method." });
  }
});

router.post("/restaurants/:restaurantId/subscription/portal", requireRole("owner", "super_admin"), async (req, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant?.stripeCustomerId) {
    return void res.status(400).json({ error: "No Stripe customer on file. Please subscribe first." });
  }

  const stripe = getStripe();
  if (!stripe) return void res.json({ url: null, mock: true });

  const { returnUrl } = req.body as { returnUrl: string };
  const session = await stripe.billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: returnUrl,
  });

  res.json({ url: session.url });
});

router.post("/restaurants/:restaurantId/subscription/mock-activate", requireRole("owner", "super_admin"), async (req, res) => {
  const cf = await getEffectiveCashfreeConfig();
  const rzp = await getEffectiveRazorpayConfig();
  if (getStripe() || cf.enabled || rzp.enabled) {
    return void res.status(403).json({ error: "A payment gateway is configured — use the checkout flow instead of mock-activate." });
  }
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const { planId, couponCode, billingPeriod: bodyPeriod } = req.body as {
    planId: number; couponCode?: string; billingPeriod?: "monthly" | "yearly";
  };
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  if (!plan) return void res.status(404).json({ error: "Plan not found" });
  const period: "monthly" | "yearly" | undefined =
    bodyPeriod === "yearly" || bodyPeriod === "monthly" ? bodyPeriod : undefined;
  // Reuse the canonical activation path so coupon redemption, billing-history
  // rows, and lifecycle SMS all behave the same as a real provider.
  await activateForTenant(tenantId, planId, `mock_${tenantId}_${planId}_${Date.now()}`, {
    provider: "mock",
    couponCode: couponCode ?? null,
    redeemedBy: req.user?.id ?? null,
    billingPeriod: period,
  });
  res.json({ success: true, planStatus: "active" });
});

async function activateFromCashfreeOrder(cfOrderId: string, couponCode?: string | null): Promise<void> {
  // Order id pattern: kl_<tenantId>_<planId>[_<m|y>]_<timestamp>. The optional
  // 3rd segment encodes the billing period chosen at checkout; orders created
  // before that field was added will simply use the plan's default period.
  const m = /^kl_(\d+)_(\d+)(?:_([my]))?_/.exec(cfOrderId);
  if (!m) return;
  const period: "monthly" | "yearly" | undefined =
    m[3] === "y" ? "yearly" : m[3] === "m" ? "monthly" : undefined;
  await activateForTenant(Number(m[1]), Number(m[2]), `cf_${cfOrderId}`, {
    provider: "cashfree",
    couponCode: couponCode ?? null,
    billingPeriod: period,
  });
}

export function createStripeWebhookRouter(): Router {
  const webhookRouter = Router();
  webhookRouter.post("/stripe/webhook", async (req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) return void res.status(200).json({ received: true });

    const sig = req.headers["stripe-signature"] as string;
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret);
    } catch (err) {
      await recordSystemLog({
        category: "payment_webhook", source: "stripe", status: "failed", level: "error",
        message: `Stripe webhook signature error: ${String(err)}`, route: "/api/stripe/webhook", method: "POST", statusCode: 400,
      });
      return void res.status(400).json({ error: `Webhook signature error: ${String(err)}` });
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = Number(session.metadata?.tenantId);
        const planId = Number(session.metadata?.planId);
        if (tenantId && planId && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(String(session.subscription)) as unknown as { current_period_end?: number; metadata?: Record<string, string> };
          const endsAt = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
          await db.update(tenantsTable).set({
            planId,
            planStatus: "active",
            stripeSubscriptionId: String(session.subscription),
            subscriptionStartedAt: new Date(),
            subscriptionEndsAt: endsAt,
            updatedAt: new Date(),
          }).where(eq(tenantsTable.id, tenantId));
        }
      } else if (event.type === "invoice.paid") {
        const invoice = event.data.object as unknown as { subscription?: string | null; customer?: string | null };
        if (invoice.customer) {
          const sub = invoice.subscription
            ? await stripe.subscriptions.retrieve(String(invoice.subscription)) as unknown as { current_period_end?: number }
            : null;
          const endsAt = sub?.current_period_end ? new Date(sub.current_period_end * 1000) : null;
          await db.update(tenantsTable).set({
            planStatus: "active",
            subscriptionEndsAt: endsAt,
            updatedAt: new Date(),
          }).where(eq(tenantsTable.stripeCustomerId, String(invoice.customer)));
        }
      } else if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object as unknown as { customer?: string | null };
        if (sub.customer) {
          await db.update(tenantsTable).set({
            planStatus: "cancelled",
            stripeSubscriptionId: null,
            updatedAt: new Date(),
          }).where(eq(tenantsTable.stripeCustomerId, String(sub.customer)));
        }
      }
    } catch (err) {
      console.error("Webhook processing error:", err);
      await recordSystemLog({
        category: "payment_webhook", source: "stripe", status: "failed", level: "error",
        message: `Stripe webhook processing error (${event.type}): ${(err as Error).message}`,
        stack: (err as Error).stack ?? null, payload: { type: event.type }, route: "/api/stripe/webhook", method: "POST", statusCode: 500,
      });
      return void res.status(500).json({ error: "Webhook handler failed — will retry" });
    }

    await recordSystemLog({
      category: "payment_webhook", source: "stripe", status: "success", level: "info",
      message: `Stripe webhook processed: ${event.type}`, payload: { type: event.type, id: event.id },
      route: "/api/stripe/webhook", method: "POST", statusCode: 200,
    });
    res.json({ received: true });
  });
  return webhookRouter;
}

export function createCashfreeWebhookRouter(): Router {
  const webhookRouter = Router();
  webhookRouter.post("/cashfree/webhook", async (req: Request, res: Response) => {
    const { enabled, config } = await getEffectiveCashfreeConfig();
    if (!enabled || !config) return void res.status(200).json({ received: true });

    const raw = req.body instanceof Buffer ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const sig = req.headers["x-webhook-signature"] as string | undefined;
    const ts = req.headers["x-webhook-timestamp"] as string | undefined;

    if (!verifyCashfreeWebhook(config, raw, sig, ts)) {
      return void res.status(401).json({ error: "Invalid Cashfree webhook signature" });
    }

    let event: { type?: string; data?: { order?: { order_id?: string; order_status?: string }; payment?: { payment_status?: string } } };
    try {
      event = JSON.parse(raw);
    } catch {
      return void res.status(400).json({ error: "Invalid JSON" });
    }

    try {
      const orderId = event.data?.order?.order_id;
      const paymentStatus = event.data?.payment?.payment_status ?? event.data?.order?.order_status;
      const isSuccess = event.type === "PAYMENT_SUCCESS_WEBHOOK"
        || paymentStatus === "SUCCESS"
        || paymentStatus === "PAID";
      if (orderId && isSuccess) {
        // Best-effort: re-fetch the order so we can recover any couponCode
        // attached during create-order, then activate using the canonical path.
        let couponFromOrder: string | null = null;
        try {
          const order = await fetchCashfreeOrder(config, orderId);
          const notes = (order as { order_meta?: { notes?: Record<string, unknown> }; order_tags?: Record<string, unknown> }).order_meta?.notes
            ?? (order as { order_tags?: Record<string, unknown> }).order_tags
            ?? null;
          if (notes && typeof notes.couponCode === "string") couponFromOrder = notes.couponCode;
        } catch { /* fall through and activate without coupon */ }
        await activateFromCashfreeOrder(orderId, couponFromOrder);
      }
    } catch (err) {
      logger.error({ err }, "Cashfree webhook processing error");
      await recordSystemLog({
        category: "payment_webhook", source: "cashfree", status: "failed", level: "error",
        message: `Cashfree webhook processing error: ${(err as Error).message}`, stack: (err as Error).stack ?? null,
        payload: { type: event.type }, route: "/api/cashfree/webhook", method: "POST", statusCode: 500,
      });
      return void res.status(500).json({ error: "Webhook handler failed — will retry" });
    }

    await recordSystemLog({
      category: "payment_webhook", source: "cashfree", status: "success", level: "info",
      message: `Cashfree webhook processed: ${event.type ?? "unknown"}`, payload: { type: event.type },
      route: "/api/cashfree/webhook", method: "POST", statusCode: 200,
    });
    res.json({ received: true });
  });
  return webhookRouter;
}

// Public endpoint for confirming a Cashfree order from the success-redirect URL
// (in case the webhook hasn't arrived yet). Falls back to fetching from Cashfree.
router.post("/restaurants/:restaurantId/subscription/cashfree-confirm", requireRole("owner", "super_admin"), async (req, res) => {
  const { orderId } = req.body as { orderId: string };
  if (!orderId) return void res.status(400).json({ error: "orderId is required" });
  const callerTenantId = req.user?.tenantId;
  if (!callerTenantId) return void res.status(403).json({ error: "No tenant" });
  // Bind orderId to caller's tenant: format is kl_<tenantId>_<planId>_<ts>
  const m = /^kl_(\d+)_(\d+)_/.exec(orderId);
  if (!m || Number(m[1]) !== callerTenantId) {
    return void res.status(403).json({ error: "This order does not belong to your tenant." });
  }
  const { enabled, config } = await getEffectiveCashfreeConfig();
  if (!enabled || !config) return void res.json({ activated: false, mock: true });
  try {
    const order = await fetchCashfreeOrder(config, orderId);
    const cfStatus = (order.order_status ?? "").toUpperCase();
    if (cfStatus === "PAID" || cfStatus === "SUCCESS") {
      // Recover any couponCode attached during create-order so the redemption
      // is recorded on activation even if the webhook lost the race.
      const notes = (order as { order_meta?: { notes?: Record<string, unknown> }; order_tags?: Record<string, unknown> }).order_meta?.notes
        ?? (order as { order_tags?: Record<string, unknown> }).order_tags
        ?? null;
      const couponFromOrder = notes && typeof notes.couponCode === "string" ? notes.couponCode : null;
      await activateFromCashfreeOrder(orderId, couponFromOrder);
      return void res.json({ activated: true });
    }
    res.json({ activated: false, status: order.order_status });
  } catch (err) {
    logger.error({ err }, "cashfree-confirm failed");
    res.status(502).json({ error: "Could not verify Cashfree order" });
  }
});

export default router;
