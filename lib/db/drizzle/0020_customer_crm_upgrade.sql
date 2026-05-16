-- Task #209 — Customer CRM upgrade
-- Adds milestones, contact preferences, WhatsApp consent metadata, derived
-- activity timestamps, and four supporting tables (tags, tag assignments,
-- timestamped notes log, complaints).

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "is_vip" boolean DEFAULT false NOT NULL;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "no_show_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "last_no_show_at" timestamp;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "birthday" date;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "anniversary" date;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "preferred_channel" text DEFAULT 'none' NOT NULL;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "whatsapp_opt_in" boolean DEFAULT false NOT NULL;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "whatsapp_opt_in_at" timestamp;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "whatsapp_opt_in_source" text;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "first_order_at" timestamp;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "last_visit_at" timestamp;

CREATE TABLE IF NOT EXISTS "customer_tags" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_restaurant_id_restaurants_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "customer_tags_restaurant_name_idx" ON "customer_tags" ("restaurant_id", "name");

CREATE TABLE IF NOT EXISTS "customer_tag_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "customer_id" integer NOT NULL,
  "tag_id" integer NOT NULL,
  "restaurant_id" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "customer_tag_assignments" ADD CONSTRAINT "customer_tag_assignments_customer_id_customers_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "customer_tag_assignments" ADD CONSTRAINT "customer_tag_assignments_tag_id_customer_tags_id_fk"
    FOREIGN KEY ("tag_id") REFERENCES "customer_tags"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "customer_tag_assignments" ADD CONSTRAINT "customer_tag_assignments_restaurant_id_restaurants_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "customer_tag_assignments_uniq_idx" ON "customer_tag_assignments" ("customer_id", "tag_id");
CREATE INDEX IF NOT EXISTS "customer_tag_assignments_customer_idx" ON "customer_tag_assignments" ("customer_id");
CREATE INDEX IF NOT EXISTS "customer_tag_assignments_tag_idx" ON "customer_tag_assignments" ("tag_id");

CREATE TABLE IF NOT EXISTS "customer_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "customer_id" integer NOT NULL,
  "restaurant_id" integer NOT NULL,
  "author_user_id" integer,
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_customers_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_restaurant_id_restaurants_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_user_id_users_id_fk"
    FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "customer_notes_customer_idx" ON "customer_notes" ("customer_id", "created_at");

CREATE TABLE IF NOT EXISTS "customer_complaints" (
  "id" serial PRIMARY KEY NOT NULL,
  "customer_id" integer NOT NULL,
  "restaurant_id" integer NOT NULL,
  "channel" text DEFAULT 'in_person' NOT NULL,
  "summary" text NOT NULL,
  "details" text,
  "status" text DEFAULT 'open' NOT NULL,
  "handled_by_user_id" integer,
  "resolved_at" timestamp,
  "resolution_notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "customer_complaints" ADD CONSTRAINT "customer_complaints_customer_id_customers_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "customer_complaints" ADD CONSTRAINT "customer_complaints_restaurant_id_restaurants_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "customer_complaints" ADD CONSTRAINT "customer_complaints_handled_by_user_id_users_id_fk"
    FOREIGN KEY ("handled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "customer_complaints_customer_idx" ON "customer_complaints" ("customer_id", "created_at");
CREATE INDEX IF NOT EXISTS "customer_complaints_restaurant_status_idx" ON "customer_complaints" ("restaurant_id", "status");
