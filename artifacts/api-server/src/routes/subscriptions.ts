import { Router } from "express";
import Stripe from "stripe";
import { eq, and, count } from "drizzle-orm";
import { db, tenantsTable, subscriptionPlansTable, usersTable, restaurantsTable, floorTablesTable, menuItemsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
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
  const [staffCount, tableCount, menuItemCount] = await Promise.all([
    db.select({ count: count() }).from(usersTable).where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true))),
    db.select({ count: count() }).from(floorTablesTable).where(and(eq(floorTablesTable.restaurantId, restaurantId), eq(floorTablesTable.isActive, true))),
    db.select({ count: count() }).from(menuItemsTable).where(and(eq(menuItemsTable.restaurantId, restaurantId), eq(menuItemsTable.isAvailable, true))),
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
  });
});

router.post("/restaurants/:restaurantId/subscription/create-checkout", requireRole("owner", "super_admin"), async (req, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });

  const { planId, successUrl, cancelUrl } = req.body as { planId: number; successUrl: string; cancelUrl: string };

  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  if (!plan) return void res.status(404).json({ error: "Plan not found" });

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return void res.status(404).json({ error: "Tenant not found" });

  const stripe = getStripe();
  if (!stripe) {
    return void res.json({
      url: successUrl + `?mock=1&planId=${planId}`,
      mock: true,
      message: "Stripe not configured — using mock checkout",
    });
  }

  let customerId = tenant.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ name: tenant.name, metadata: { tenantId: String(tenantId) } });
    customerId = customer.id;
    await db.update(tenantsTable).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(tenantsTable.id, tenantId));
  }

  const planPrice = Number(plan.price);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    mode: "subscription",
    line_items: [{
      price_data: {
        currency: "inr",
        product_data: { name: plan.name, description: (plan.features ?? []).join(", ") },
        unit_amount: Math.round(planPrice * 100),
        recurring: { interval: plan.billingPeriod === "yearly" ? "year" : "month" },
      },
      quantity: 1,
    }],
    metadata: { tenantId: String(tenantId), planId: String(planId) },
    success_url: successUrl + "?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: cancelUrl,
  });

  res.json({ url: session.url, sessionId: session.id });
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
  if (getStripe()) {
    return void res.status(403).json({ error: "Stripe is configured — use the checkout flow instead of mock-activate." });
  }
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  const { planId } = req.body as { planId: number };
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  if (!plan) return void res.status(404).json({ error: "Plan not found" });
  const now = new Date();
  const endsAt = new Date(now);
  endsAt.setMonth(endsAt.getMonth() + 1);
  await db.update(tenantsTable).set({
    planId,
    planStatus: "active",
    subscriptionStartedAt: now,
    subscriptionEndsAt: endsAt,
    updatedAt: now,
  }).where(eq(tenantsTable.id, tenantId));
  res.json({ success: true, planStatus: "active" });
});

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
    }

    res.json({ received: true });
  });
  return webhookRouter;
}

export default router;
