-- Advanced Growth, Delivery & Staff pack (Task #370)

CREATE TABLE IF NOT EXISTS "customer_geo_points" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "customer_id" integer,
  "label" text,
  "lat" numeric(9, 6) NOT NULL,
  "lng" numeric(9, 6) NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_geo_points_rest_idx" ON "customer_geo_points" ("restaurant_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "customer_geo_points" ADD CONSTRAINT "customer_geo_points_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "customer_geo_points" ADD CONSTRAINT "customer_geo_points_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "festival_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer,
  "name" text NOT NULL,
  "event_date" date NOT NULL,
  "region" text,
  "category" text,
  "suggested_campaign" text,
  "is_dismissed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "festival_events_date_idx" ON "festival_events" ("event_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "festival_events_rest_idx" ON "festival_events" ("restaurant_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "festival_events" ADD CONSTRAINT "festival_events_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "offer_conflict_checks" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "run_by" integer,
  "conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "conflict_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_conflict_checks_rest_idx" ON "offer_conflict_checks" ("restaurant_id", "created_at");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "offer_conflict_checks" ADD CONSTRAINT "offer_conflict_checks_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "offer_conflict_checks" ADD CONSTRAINT "offer_conflict_checks_run_by_fk" FOREIGN KEY ("run_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "margin_floors" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "scope" text DEFAULT 'global' NOT NULL,
  "scope_id" integer,
  "min_margin_pct" numeric(5, 2) NOT NULL,
  "action" text DEFAULT 'warn' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "margin_floors_rest_idx" ON "margin_floors" ("restaurant_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "margin_floors" ADD CONSTRAINT "margin_floors_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "upsell_script_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "waiter_user_id" integer,
  "order_id" integer,
  "script_key" text NOT NULL,
  "suggested_item" text,
  "outcome" text NOT NULL,
  "amount_rupees" numeric(10, 2) DEFAULT '0.00',
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upsell_script_events_rest_idx" ON "upsell_script_events" ("restaurant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upsell_script_events_waiter_idx" ON "upsell_script_events" ("waiter_user_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "upsell_script_events" ADD CONSTRAINT "upsell_script_events_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "takeaway_queue_tickets" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "customer_name" text NOT NULL,
  "phone" text,
  "party_size" integer DEFAULT 1 NOT NULL,
  "ticket_number" integer NOT NULL,
  "status" text DEFAULT 'waiting' NOT NULL,
  "estimated_minutes" integer DEFAULT 15 NOT NULL,
  "notes" text,
  "notified_at" timestamp,
  "fulfilled_at" timestamp,
  "cancelled_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "takeaway_queue_rest_idx" ON "takeaway_queue_tickets" ("restaurant_id", "status");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "takeaway_queue_tickets" ADD CONSTRAINT "takeaway_queue_tickets_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "preorder_slots" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "slot_date" date NOT NULL,
  "start_minutes" integer NOT NULL,
  "end_minutes" integer NOT NULL,
  "capacity" integer DEFAULT 10 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preorder_slots_rest_date_idx" ON "preorder_slots" ("restaurant_id", "slot_date");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "preorder_slots" ADD CONSTRAINT "preorder_slots_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "preorder_bookings" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "slot_id" integer NOT NULL,
  "customer_name" text NOT NULL,
  "phone" text,
  "order_id" integer,
  "status" text DEFAULT 'confirmed' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preorder_bookings_rest_idx" ON "preorder_bookings" ("restaurant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preorder_bookings_slot_idx" ON "preorder_bookings" ("slot_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "preorder_bookings" ADD CONSTRAINT "preorder_bookings_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "preorder_bookings" ADD CONSTRAINT "preorder_bookings_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "preorder_slots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "delivery_zones" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "name" text NOT NULL,
  "pincodes" text,
  "base_fee_rupees" numeric(10, 2) DEFAULT '0.00' NOT NULL,
  "min_order_rupees" numeric(10, 2) DEFAULT '0.00' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_zones_rest_idx" ON "delivery_zones" ("restaurant_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "delivery_zone_metrics" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "zone_id" integer NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "order_count" integer DEFAULT 0 NOT NULL,
  "revenue_rupees" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "cost_rupees" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "profit_rupees" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_zone_metrics_zone_idx" ON "delivery_zone_metrics" ("zone_id", "period_start");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "delivery_zone_metrics" ADD CONSTRAINT "delivery_zone_metrics_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "delivery_zone_metrics" ADD CONSTRAINT "delivery_zone_metrics_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "delivery_zones"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "table_metrics_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "table_id" integer NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "revenue_rupees" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "cover_count" integer DEFAULT 0 NOT NULL,
  "avg_turn_minutes" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "table_metrics_snapshots_rest_idx" ON "table_metrics_snapshots" ("restaurant_id", "period_start");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "table_metrics_snapshots" ADD CONSTRAINT "table_metrics_snapshots_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "table_metrics_snapshots" ADD CONSTRAINT "table_metrics_snapshots_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "floor_tables"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tip_split_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "role" text NOT NULL,
  "share_pct" numeric(5, 2) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tip_split_rules_rest_role_uq" ON "tip_split_rules" ("restaurant_id", "role");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tip_split_rules" ADD CONSTRAINT "tip_split_rules_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tip_pools" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "total_rupees" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "distributed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tip_pools_rest_idx" ON "tip_pools" ("restaurant_id", "period_start");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tip_pools" ADD CONSTRAINT "tip_pools_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tip_pool_entries" (
  "id" serial PRIMARY KEY NOT NULL,
  "pool_id" integer NOT NULL,
  "restaurant_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "share_pct" numeric(5, 2) NOT NULL,
  "amount_rupees" numeric(10, 2) DEFAULT '0.00' NOT NULL,
  "payroll_item_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tip_pool_entries_pool_idx" ON "tip_pool_entries" ("pool_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tip_pool_entries" ADD CONSTRAINT "tip_pool_entries_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "tip_pools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tip_pool_entries" ADD CONSTRAINT "tip_pool_entries_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tip_pool_entries" ADD CONSTRAINT "tip_pool_entries_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- Link delivery assignments to zones so per-zone profitability rollups can
-- compute correctly. Nullable so untagged assignments (legacy) are ignored.
DO $$ BEGIN
  ALTER TABLE "delivery_assignments" ADD COLUMN "zone_id" integer;
EXCEPTION WHEN duplicate_column THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "delivery_zones"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_assignments_zone_idx" ON "delivery_assignments" ("zone_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "leaderboard_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "period_key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leaderboard_snapshots_rest_idx" ON "leaderboard_snapshots" ("restaurant_id", "captured_at");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
