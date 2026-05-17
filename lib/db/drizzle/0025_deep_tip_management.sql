-- Task #421: Deep tip management
-- Adds tip capture at payment time, restaurant-level tip policy, pool/entry
-- enrichment for attribution and source tracking, post-payment adjustments,
-- and server cash declarations.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tip_amount" numeric(10,2) NOT NULL DEFAULT '0.00';
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "tip_amount" numeric(12,2) NOT NULL DEFAULT '0.00';
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "tip_policy" jsonb NOT NULL DEFAULT '{"enabled":true,"presets":[0,5,10,15,20],"customAllowed":true,"splitMethod":"role_weighted","allowCashDeclaration":true,"syncToPayroll":true}'::jsonb;

-- Tip pooling tables (created here if a prior environment never received the
-- original advanced_growth migration that defined them).
CREATE TABLE IF NOT EXISTS "tip_split_rules" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "share_pct" numeric(5,2) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "tip_split_rules_rest_role_uq" ON "tip_split_rules" ("restaurant_id", "role");

CREATE TABLE IF NOT EXISTS "tip_pools" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "total_rupees" numeric(12,2) NOT NULL DEFAULT '0.00',
  "status" text NOT NULL DEFAULT 'open',
  "split_method" text NOT NULL DEFAULT 'role_weighted',
  "distributed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
ALTER TABLE "tip_pools" ADD COLUMN IF NOT EXISTS "split_method" text NOT NULL DEFAULT 'role_weighted';
CREATE INDEX IF NOT EXISTS "tip_pools_rest_idx" ON "tip_pools" ("restaurant_id", "period_start");

CREATE TABLE IF NOT EXISTS "tip_pool_entries" (
  "id" serial PRIMARY KEY,
  "pool_id" integer NOT NULL REFERENCES "tip_pools"("id") ON DELETE CASCADE,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "share_pct" numeric(5,2) NOT NULL,
  "amount_rupees" numeric(10,2) NOT NULL DEFAULT '0.00',
  "payroll_item_id" integer,
  "source_type" text NOT NULL DEFAULT 'distribution',
  "source_order_id" integer,
  "source_shift_id" integer,
  "table_id" integer,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
ALTER TABLE "tip_pool_entries" ADD COLUMN IF NOT EXISTS "source_type" text NOT NULL DEFAULT 'distribution';
ALTER TABLE "tip_pool_entries" ADD COLUMN IF NOT EXISTS "source_order_id" integer;
ALTER TABLE "tip_pool_entries" ADD COLUMN IF NOT EXISTS "source_shift_id" integer;
ALTER TABLE "tip_pool_entries" ADD COLUMN IF NOT EXISTS "table_id" integer;
ALTER TABLE "tip_pool_entries" ADD COLUMN IF NOT EXISTS "notes" text;
CREATE INDEX IF NOT EXISTS "tip_pool_entries_pool_idx" ON "tip_pool_entries" ("pool_id");
CREATE INDEX IF NOT EXISTS "tip_pool_entries_user_idx" ON "tip_pool_entries" ("restaurant_id", "user_id", "created_at");

CREATE TABLE IF NOT EXISTS "tip_adjustments" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "entry_id" integer REFERENCES "tip_pool_entries"("id") ON DELETE CASCADE,
  "order_id" integer,
  "pool_id" integer,
  "user_id" integer REFERENCES "users"("id"),
  "previous_amount" numeric(10,2) NOT NULL DEFAULT '0.00',
  "new_amount" numeric(10,2) NOT NULL DEFAULT '0.00',
  "delta" numeric(10,2) NOT NULL DEFAULT '0.00',
  "reason" text NOT NULL,
  "adjusted_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tip_adjustments_rest_idx" ON "tip_adjustments" ("restaurant_id", "created_at");
CREATE INDEX IF NOT EXISTS "tip_adjustments_entry_idx" ON "tip_adjustments" ("entry_id");

CREATE TABLE IF NOT EXISTS "cash_tip_declarations" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "shift_id" integer,
  "shift_date" date NOT NULL,
  "amount_rupees" numeric(10,2) NOT NULL,
  "notes" text,
  "pool_entry_id" integer,
  "declared_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "cash_tip_declarations_rest_date_idx" ON "cash_tip_declarations" ("restaurant_id", "shift_date");
CREATE INDEX IF NOT EXISTS "cash_tip_declarations_user_idx" ON "cash_tip_declarations" ("user_id", "shift_date");
