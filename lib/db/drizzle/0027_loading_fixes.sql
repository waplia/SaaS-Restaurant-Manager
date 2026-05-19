-- Backfill columns/tables that schema files reference but were never migrated.
-- All statements are idempotent so this is safe to re-run.

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "is_blacklisted" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "blacklist_reason" text;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "blacklisted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "blacklisted_by_user_id" integer;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "allergies" text;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "preferred_table_id" integer;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "email_marketing_opt_in" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "email_marketing_opt_in_source" text;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "email_marketing_opt_in_at" timestamp;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "email_unsubscribed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "email_unsubscribed_at" timestamp;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "email_sequence_enrollments" (
  "id" serial PRIMARY KEY NOT NULL,
  "sequence_id" integer NOT NULL,
  "tenant_id" integer,
  "recipient_email" text NOT NULL,
  "recipient_name" text,
  "context" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "current_step" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "stop_reason" text,
  "next_run_at" timestamp DEFAULT now() NOT NULL,
  "last_run_at" timestamp,
  "enrolled_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sequence_enrollments_seq_idx" ON "email_sequence_enrollments" ("sequence_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sequence_enrollments_next_idx" ON "email_sequence_enrollments" ("next_run_at","status");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "email_sequence_enrollments" ADD CONSTRAINT "email_sequence_enrollments_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "email_sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "email_sequence_enrollments" ADD CONSTRAINT "email_sequence_enrollments_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "complaint_escalation_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "level1_minutes" integer DEFAULT 30 NOT NULL,
  "level2_minutes" integer DEFAULT 120 NOT NULL,
  "level3_minutes" integer DEFAULT 360 NOT NULL,
  "notify_managers" boolean DEFAULT true NOT NULL,
  "notify_owners" boolean DEFAULT true NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "complaint_escalation_rules_restaurant_idx" ON "complaint_escalation_rules" ("restaurant_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "complaint_escalation_rules" ADD CONSTRAINT "complaint_escalation_rules_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "cart_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "branch_id" integer,
  "session_token" text NOT NULL,
  "channel" text DEFAULT 'qr' NOT NULL,
  "table_id" integer,
  "customer_id" integer,
  "customer_phone" text,
  "customer_name" text,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "subtotal" numeric(10,2) DEFAULT '0.00' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "order_id" integer,
  "recovery_opt_in" boolean DEFAULT false NOT NULL,
  "last_activity_at" timestamp DEFAULT now() NOT NULL,
  "abandoned_at" timestamp,
  "converted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cart_sessions_restaurant_idx" ON "cart_sessions" ("restaurant_id","status","last_activity_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cart_sessions_token_idx" ON "cart_sessions" ("restaurant_id","session_token");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cart_sessions" ADD CONSTRAINT "cart_sessions_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cart_sessions" ADD CONSTRAINT "cart_sessions_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cart_sessions" ADD CONSTRAINT "cart_sessions_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cart_sessions" ADD CONSTRAINT "cart_sessions_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;
