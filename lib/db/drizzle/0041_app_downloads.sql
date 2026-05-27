CREATE TABLE IF NOT EXISTS "app_downloads" (
  "id" serial PRIMARY KEY,
  "platform" text NOT NULL,
  "app_name" text NOT NULL,
  "description" text,
  "version" text NOT NULL,
  "build_number" text,
  "release_date" date,
  "status" text NOT NULL DEFAULT 'available',
  "download_type" text NOT NULL DEFAULT 'uploaded_file',
  "download_url" text,
  "uploaded_file_url" text,
  "file_size" bigint,
  "icon_url" text,
  "minimum_os_version" text,
  "system_requirements" text,
  "release_notes" text,
  "installation_guide" text,
  "is_latest" boolean NOT NULL DEFAULT false,
  "is_visible" boolean NOT NULL DEFAULT true,
  "force_update" boolean NOT NULL DEFAULT false,
  "recommended_update" boolean NOT NULL DEFAULT false,
  "allowed_plans_json" jsonb,
  "allowed_restaurants_json" jsonb,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "app_downloads_platform_idx" ON "app_downloads" ("platform", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "app_downloads_latest_per_platform" ON "app_downloads" ("platform") WHERE "is_latest" = true;

CREATE TABLE IF NOT EXISTS "app_download_logs" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer REFERENCES "restaurants"("id") ON DELETE SET NULL,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "app_download_id" integer REFERENCES "app_downloads"("id") ON DELETE SET NULL,
  "platform" text NOT NULL,
  "action" text NOT NULL,
  "version" text,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "app_download_logs_download_idx" ON "app_download_logs" ("app_download_id", "created_at");
CREATE INDEX IF NOT EXISTS "app_download_logs_platform_idx" ON "app_download_logs" ("platform", "created_at");
CREATE INDEX IF NOT EXISTS "app_download_logs_restaurant_idx" ON "app_download_logs" ("restaurant_id", "created_at");
