-- Task #533: WhatsApp Template Center additive schema.
-- Brings migration files in line with whatsapp_templates columns + the
-- whatsapp_template_versions table + corrected partial-unique constraints.
-- All statements are idempotent so re-running is safe.

-- ─── whatsapp_templates: additive columns ─────────────────────────────────
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "meta_template_id" text;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "header_type" text DEFAULT 'none' NOT NULL;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "header_text" text;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "header_media_url" text;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "body_text" text;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "footer_text" text;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "buttons_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "variables_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "sample_values_json" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "allow_restaurant_edit" boolean DEFAULT false NOT NULL;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "assigned_plans_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "assigned_restaurants_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "meta_response_json" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "source_template_id" integer;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "created_by_super_admin" boolean DEFAULT false NOT NULL;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "created_by" integer;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "updated_by" integer;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

DO $$ BEGIN
  ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Replace broken nullable-composite unique with two partial uniques ────
-- Old index (scope, restaurant_id, name, language) allowed duplicates for
-- platform rows because restaurant_id IS NULL. Split per scope.
DROP INDEX IF EXISTS "whatsapp_templates_scope_name_lang_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_templates_platform_name_lang_idx"
  ON "whatsapp_templates" ("name", "language")
  WHERE "scope" = 'platform' AND "restaurant_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_templates_restaurant_name_lang_idx"
  ON "whatsapp_templates" ("restaurant_id", "name", "language")
  WHERE "scope" = 'restaurant' AND "restaurant_id" IS NOT NULL;

-- ─── whatsapp_template_versions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "whatsapp_template_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "template_id" integer NOT NULL,
  "version_number" integer NOT NULL,
  "name" text NOT NULL,
  "language" text NOT NULL,
  "category" text,
  "status" text NOT NULL,
  "header_type" text DEFAULT 'none' NOT NULL,
  "header_text" text,
  "header_media_url" text,
  "body_text" text,
  "footer_text" text,
  "buttons_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "variables_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sample_values_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "meta_response_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "change_note" text,
  "changed_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "whatsapp_template_versions" ADD CONSTRAINT "whatsapp_template_versions_template_id_whatsapp_templates_id_fk"
    FOREIGN KEY ("template_id") REFERENCES "public"."whatsapp_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_template_versions" ADD CONSTRAINT "whatsapp_template_versions_changed_by_users_id_fk"
    FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "whatsapp_template_versions_template_idx"
  ON "whatsapp_template_versions" ("template_id", "version_number");
