-- Extend stock_food_images with richer metadata and approval/usage tracking.
ALTER TABLE "stock_food_images" ADD COLUMN IF NOT EXISTS "dietary_type" text;
ALTER TABLE "stock_food_images" ADD COLUMN IF NOT EXISTS "meal_type" text;
ALTER TABLE "stock_food_images" ADD COLUMN IF NOT EXISTS "spice_level" integer;
ALTER TABLE "stock_food_images" ADD COLUMN IF NOT EXISTS "provider" text;
ALTER TABLE "stock_food_images" ADD COLUMN IF NOT EXISTS "model" text;
ALTER TABLE "stock_food_images" ADD COLUMN IF NOT EXISTS "license_status" text NOT NULL DEFAULT 'unknown';
ALTER TABLE "stock_food_images" ADD COLUMN IF NOT EXISTS "is_approved" boolean NOT NULL DEFAULT true;
ALTER TABLE "stock_food_images" ADD COLUMN IF NOT EXISTS "is_featured" boolean NOT NULL DEFAULT false;
ALTER TABLE "stock_food_images" ADD COLUMN IF NOT EXISTS "usage_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "stock_food_images" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp;
ALTER TABLE "stock_food_images" ADD COLUMN IF NOT EXISTS "generation_job_id" integer;

-- Backfill provider for seeded Wikimedia rows so the UI shows accurate origin.
UPDATE "stock_food_images" SET "provider" = 'wikimedia', "license_status" = 'approved'
  WHERE "provider" IS NULL AND "source" = 'seed';
UPDATE "stock_food_images" SET "provider" = 'upload', "license_status" = 'approved'
  WHERE "provider" IS NULL AND "source" = 'manual';
UPDATE "stock_food_images" SET "provider" = 'bulk_import'
  WHERE "provider" IS NULL AND "source" = 'bulk_import';

CREATE INDEX IF NOT EXISTS "stock_food_images_approved_idx"
  ON "stock_food_images" ("is_approved", "is_active");
CREATE INDEX IF NOT EXISTS "stock_food_images_featured_idx"
  ON "stock_food_images" ("is_featured");
CREATE INDEX IF NOT EXISTS "stock_food_images_usage_idx"
  ON "stock_food_images" ("usage_count");

CREATE TABLE IF NOT EXISTS "image_generation_jobs" (
  "id" serial PRIMARY KEY,
  "status" text NOT NULL DEFAULT 'pending',
  "provider" text NOT NULL DEFAULT 'openai',
  "model" text,
  "style" text,
  "prompt" text,
  "total_items" integer NOT NULL DEFAULT 0,
  "done_items" integer NOT NULL DEFAULT 0,
  "failed_items" integer NOT NULL DEFAULT 0,
  "items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "results" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error_message" text,
  "created_by" integer,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "image_generation_jobs_status_idx"
  ON "image_generation_jobs" ("status");
CREATE INDEX IF NOT EXISTS "image_generation_jobs_created_idx"
  ON "image_generation_jobs" ("created_at");

CREATE TABLE IF NOT EXISTS "restaurant_menu_item_images" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer NOT NULL,
  "menu_item_id" integer NOT NULL,
  "library_image_id" integer,
  "image_url" text NOT NULL,
  "source" text NOT NULL DEFAULT 'library',
  "attached_by" integer,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "restaurant_menu_item_images_restaurant_idx"
  ON "restaurant_menu_item_images" ("restaurant_id", "created_at");
CREATE INDEX IF NOT EXISTS "restaurant_menu_item_images_item_idx"
  ON "restaurant_menu_item_images" ("menu_item_id");
CREATE INDEX IF NOT EXISTS "restaurant_menu_item_images_library_idx"
  ON "restaurant_menu_item_images" ("library_image_id");
