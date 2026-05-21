CREATE TABLE IF NOT EXISTS "stock_food_images" (
  "id" serial PRIMARY KEY,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "cuisine" text,
  "category" text,
  "image_url" text NOT NULL,
  "thumbnail_url" text,
  "aliases" text[] NOT NULL DEFAULT '{}',
  "tags" text[] NOT NULL DEFAULT '{}',
  "is_veg" boolean NOT NULL DEFAULT true,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "attribution" text,
  "source" text NOT NULL DEFAULT 'seed',
  "created_by" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "stock_food_images_slug_idx" ON "stock_food_images" ("slug");
CREATE INDEX IF NOT EXISTS "stock_food_images_active_idx" ON "stock_food_images" ("is_active");
