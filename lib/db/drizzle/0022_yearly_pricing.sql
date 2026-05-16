-- Task #277 — Real yearly pricing per subscription plan + payment-provider price IDs.
--
-- Additive and idempotent. Adds:
--   * subscription_plans.yearly_price              — admin-set yearly price (overrides 16% derivation)
--   * subscription_plans.stripe_monthly_price_id   — Stripe preset price ID for monthly checkout
--   * subscription_plans.stripe_yearly_price_id    — Stripe preset price ID for yearly checkout
--   * subscription_plans.cashfree_monthly_plan_id  — Cashfree plan ID for monthly billing
--   * subscription_plans.cashfree_yearly_plan_id   — Cashfree plan ID for yearly billing
--   * manual_payment_requests.billing_period       — 'monthly' | 'yearly' chosen at request time
--
-- All ADDs use IF NOT EXISTS so re-running on an environment where columns
-- already exist (e.g. created via drizzle-kit push) is a no-op.

ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "yearly_price" numeric(10, 2);

ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "stripe_monthly_price_id" text;

ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "stripe_yearly_price_id" text;

ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "cashfree_monthly_plan_id" text;

ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "cashfree_yearly_plan_id" text;

ALTER TABLE "manual_payment_requests"
  ADD COLUMN IF NOT EXISTS "billing_period" text DEFAULT 'monthly' NOT NULL;
