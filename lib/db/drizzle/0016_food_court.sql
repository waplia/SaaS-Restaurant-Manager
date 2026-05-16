CREATE TABLE IF NOT EXISTS "food_courts" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "owner_restaurant_id" integer,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "address_line" text,
  "city" text,
  "state" text,
  "pincode" text,
  "gstin" text,
  "logo_url" text,
  "opening_time" text,
  "closing_time" text,
  "total_seats" integer DEFAULT 0 NOT NULL,
  "seating_mode" text DEFAULT 'shared' NOT NULL,
  "default_commission_pct" numeric(5,2) DEFAULT '10.00' NOT NULL,
  "default_platform_fee" numeric(10,2) DEFAULT '0.00' NOT NULL,
  "packaging_fee" numeric(10,2) DEFAULT '0.00' NOT NULL,
  "convenience_fee" numeric(10,2) DEFAULT '0.00' NOT NULL,
  "service_charge_pct" numeric(5,2) DEFAULT '0.00' NOT NULL,
  "accepted_payment_methods" jsonb DEFAULT '["cash","card","upi","gateway"]'::jsonb NOT NULL,
  "token_prefix" text DEFAULT 'FC' NOT NULL,
  "partial_pickup" boolean DEFAULT false NOT NULL,
  "per_vendor_gstin" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food_courts" ADD CONSTRAINT "food_courts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_courts" ADD CONSTRAINT "food_courts_owner_restaurant_id_fkey" FOREIGN KEY ("owner_restaurant_id") REFERENCES "restaurants"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_courts" ADD CONSTRAINT "food_courts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_courts_tenant_idx" ON "food_courts" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_courts_tenant_slug_uq" ON "food_courts" ("tenant_id","slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_court_vendors" (
  "id" serial PRIMARY KEY NOT NULL,
  "food_court_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "restaurant_id" integer NOT NULL,
  "counter_number" text,
  "stall_name" text NOT NULL,
  "cuisine_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "commission_type" text DEFAULT 'percentage' NOT NULL,
  "commission_pct" numeric(5,2) DEFAULT '10.00' NOT NULL,
  "flat_fee_per_order" numeric(10,2) DEFAULT '0.00' NOT NULL,
  "tiered_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "commission_version" integer DEFAULT 1 NOT NULL,
  "settlement_bank_name" text,
  "settlement_account_name" text,
  "settlement_account_number" text,
  "settlement_ifsc" text,
  "settlement_upi_id" text,
  "opening_time" text,
  "closing_time" text,
  "vendor_gstin" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "joined_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food_court_vendors" ADD CONSTRAINT "food_court_vendors_food_court_id_fkey" FOREIGN KEY ("food_court_id") REFERENCES "food_courts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_court_vendors" ADD CONSTRAINT "food_court_vendors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_court_vendors" ADD CONSTRAINT "food_court_vendors_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fc_vendors_court_idx" ON "food_court_vendors" ("food_court_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fc_vendors_restaurant_idx" ON "food_court_vendors" ("restaurant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fc_vendors_court_restaurant_uq" ON "food_court_vendors" ("food_court_id","restaurant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_court_orders" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "food_court_id" integer NOT NULL,
  "parent_order_number" text NOT NULL,
  "table_number" text,
  "zone_name" text,
  "customer_name" text,
  "customer_phone" text,
  "subtotal" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "tax_amount" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "service_charge" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "packaging_fee" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "convenience_fee" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "discount_amount" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "total_amount" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "payment_method" text,
  "payment_status" text DEFAULT 'unpaid' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "pickup_mode" text DEFAULT 'all_ready' NOT NULL,
  "token" text,
  "token_number" integer,
  "cashier_id" integer,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "food_court_orders" ADD CONSTRAINT "food_court_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_court_orders" ADD CONSTRAINT "food_court_orders_food_court_id_fkey" FOREIGN KEY ("food_court_id") REFERENCES "food_courts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_court_orders" ADD CONSTRAINT "food_court_orders_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fc_orders_court_idx" ON "food_court_orders" ("food_court_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fc_orders_parent_number_uq" ON "food_court_orders" ("food_court_id","parent_order_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fc_orders_token_idx" ON "food_court_orders" ("food_court_id","token");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_court_sub_orders" (
  "id" serial PRIMARY KEY NOT NULL,
  "parent_id" integer NOT NULL,
  "food_court_id" integer NOT NULL,
  "vendor_id" integer NOT NULL,
  "restaurant_id" integer NOT NULL,
  "sub_order_id" integer NOT NULL,
  "subtotal" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "tax_amount" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "discount_amount" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "total_amount" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "payment_split" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "commission_amount" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "commission_version" integer DEFAULT 1 NOT NULL,
  "net_payable" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "ready_at" timestamp,
  "served_at" timestamp,
  "refund_amount" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "settlement_id" integer,
  "settled_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food_court_sub_orders" ADD CONSTRAINT "food_court_sub_orders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "food_court_orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_court_sub_orders" ADD CONSTRAINT "food_court_sub_orders_food_court_id_fkey" FOREIGN KEY ("food_court_id") REFERENCES "food_courts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_court_sub_orders" ADD CONSTRAINT "food_court_sub_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "food_court_vendors"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_court_sub_orders" ADD CONSTRAINT "food_court_sub_orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_court_sub_orders" ADD CONSTRAINT "food_court_sub_orders_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fc_sub_orders_parent_idx" ON "food_court_sub_orders" ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fc_sub_orders_vendor_idx" ON "food_court_sub_orders" ("vendor_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fc_sub_orders_sub_order_uq" ON "food_court_sub_orders" ("sub_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fc_sub_orders_settlement_idx" ON "food_court_sub_orders" ("settlement_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_court_settlements" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "food_court_id" integer NOT NULL,
  "vendor_id" integer NOT NULL,
  "restaurant_id" integer NOT NULL,
  "settlement_date" date NOT NULL,
  "order_count" integer DEFAULT 0 NOT NULL,
  "gross_sales" bigint DEFAULT 0 NOT NULL,
  "taxes_collected" bigint DEFAULT 0 NOT NULL,
  "discounts_given" bigint DEFAULT 0 NOT NULL,
  "refunds_given" bigint DEFAULT 0 NOT NULL,
  "surcharges_retained" bigint DEFAULT 0 NOT NULL,
  "commission_amount" bigint DEFAULT 0 NOT NULL,
  "platform_fee" bigint DEFAULT 0 NOT NULL,
  "gateway_fee" bigint DEFAULT 0 NOT NULL,
  "net_payable" bigint DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "wallet_transfer_group_id" text,
  "paid_at" timestamp,
  "adjustments" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "generated_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food_court_settlements" ADD CONSTRAINT "food_court_settlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_court_settlements" ADD CONSTRAINT "food_court_settlements_food_court_id_fkey" FOREIGN KEY ("food_court_id") REFERENCES "food_courts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_court_settlements" ADD CONSTRAINT "food_court_settlements_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "food_court_vendors"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_court_settlements" ADD CONSTRAINT "food_court_settlements_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "food_court_settlements" ADD CONSTRAINT "food_court_settlements_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fc_settlements_vendor_day_uq" ON "food_court_settlements" ("vendor_id","settlement_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fc_settlements_court_idx" ON "food_court_settlements" ("food_court_id","settlement_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fc_settlements_tenant_idx" ON "food_court_settlements" ("tenant_id","settlement_date");
