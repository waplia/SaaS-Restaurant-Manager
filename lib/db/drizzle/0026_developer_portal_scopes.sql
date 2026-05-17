-- Developer Portal (Task #434) — scoped API keys, sandbox/live environments,
-- key rotation metadata, per-tenant kill-switch, and OAuth app placeholders.
-- Idempotent: every statement guarded by IF NOT EXISTS so re-runs are safe.

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "environment" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "scopes" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "rotated_from_id" integer;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "rotated_at" timestamp;--> statement-breakpoint

ALTER TABLE "restaurant_api_overrides" ADD COLUMN IF NOT EXISTS "api_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_api_overrides" ADD COLUMN IF NOT EXISTS "api_disabled_reason" text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "oauth_apps" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "client_id" text NOT NULL,
  "client_secret_hash" text NOT NULL,
  "client_secret_prefix" text NOT NULL,
  "redirect_uris" text[] DEFAULT '{}' NOT NULL,
  "scopes" text[] DEFAULT '{}' NOT NULL,
  "homepage_url" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_apps_client_id_unique" UNIQUE("client_id")
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "oauth_apps" ADD CONSTRAINT "oauth_apps_restaurant_id_restaurants_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "oauth_apps" ADD CONSTRAINT "oauth_apps_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "oauth_apps_restaurant_idx" ON "oauth_apps" ("restaurant_id");
