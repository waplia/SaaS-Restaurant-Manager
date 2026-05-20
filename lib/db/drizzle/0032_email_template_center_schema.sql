-- Task #533: Email Template Center parity (mirrors whatsapp_templates).
-- All changes are additive. Existing rows default to platform/approved so
-- previously-seeded templates remain visible & sendable.

ALTER TABLE "email_templates"
  ADD COLUMN IF NOT EXISTS "scope" text NOT NULL DEFAULT 'platform',
  ADD COLUMN IF NOT EXISTS "restaurant_id" integer,
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS "source_template_id" integer,
  ADD COLUMN IF NOT EXISTS "assigned_plans_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "assigned_restaurants_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "allow_restaurant_edit" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "created_by_super_admin" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "rejection_reason" text,
  ADD COLUMN IF NOT EXISTS "updated_by" integer;

DO $$ BEGIN
  ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_restaurant_id_restaurants_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;

-- Replace the plain unique on `key` with two partial uniques (scope-aware).
DO $$ BEGIN
  ALTER TABLE "email_templates" DROP CONSTRAINT IF EXISTS "email_templates_key_idx";
EXCEPTION WHEN undefined_object THEN null; END $$;

DROP INDEX IF EXISTS "email_templates_key_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_platform_key_idx"
  ON "email_templates" ("key")
  WHERE "scope" = 'platform' AND "restaurant_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_restaurant_key_idx"
  ON "email_templates" ("restaurant_id", "key")
  WHERE "scope" = 'restaurant' AND "restaurant_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "email_templates_scope_status_idx"
  ON "email_templates" ("scope", "status");

-- Internal-review audit (mirrors whatsapp_template_submissions).
CREATE TABLE IF NOT EXISTS "email_template_submissions" (
  "id" serial PRIMARY KEY NOT NULL,
  "template_id" integer NOT NULL,
  "attempt_type" text NOT NULL,
  "result_status" text NOT NULL,
  "request_payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "response_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_message" text,
  "triggered_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "email_template_submissions"
    ADD CONSTRAINT "email_template_submissions_template_id_email_templates_id_fk"
    FOREIGN KEY ("template_id") REFERENCES "email_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "email_template_submissions"
    ADD CONSTRAINT "email_template_submissions_triggered_by_users_id_fk"
    FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "email_template_submissions_template_idx"
  ON "email_template_submissions" ("template_id", "created_at");
