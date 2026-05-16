CREATE TABLE IF NOT EXISTS "devices" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "branch_id" integer,
  "kitchen_id" integer,
  "type" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'pairing' NOT NULL,
  "last_seen_at" timestamp,
  "firmware_version" text,
  "app_version" text,
  "registration_token" text UNIQUE,
  "paired_at" timestamp,
  "paper_size" text,
  "consecutive_errors" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "deleted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "device_id" integer NOT NULL,
  "restaurant_id" integer NOT NULL,
  "event_type" text NOT NULL,
  "message" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_routing_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "branch_id" integer,
  "device_id" integer NOT NULL,
  "category_id" integer,
  "kitchen_id" integer,
  "order_type" text,
  "is_default_receipt" boolean DEFAULT false NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_station_mappings" (
  "id" serial PRIMARY KEY NOT NULL,
  "device_id" integer NOT NULL,
  "kitchen_id" integer NOT NULL,
  "restaurant_id" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_sync_state" (
  "id" serial PRIMARY KEY NOT NULL,
  "device_id" integer NOT NULL UNIQUE,
  "last_sync_at" timestamp,
  "pending_count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "devices" ADD CONSTRAINT "devices_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "devices" ADD CONSTRAINT "devices_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "devices" ADD CONSTRAINT "devices_kitchen_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "device_logs" ADD CONSTRAINT "device_logs_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "device_logs" ADD CONSTRAINT "device_logs_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "device_routing_rules" ADD CONSTRAINT "drr_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "device_routing_rules" ADD CONSTRAINT "drr_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "device_routing_rules" ADD CONSTRAINT "drr_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "device_routing_rules" ADD CONSTRAINT "drr_kitchen_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "device_station_mappings" ADD CONSTRAINT "dsm_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "device_station_mappings" ADD CONSTRAINT "dsm_kitchen_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "device_station_mappings" ADD CONSTRAINT "dsm_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "device_sync_state" ADD CONSTRAINT "dss_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_restaurant_idx" ON "devices" ("restaurant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_branch_idx" ON "devices" ("branch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_kitchen_idx" ON "devices" ("kitchen_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_logs_device_idx" ON "device_logs" ("device_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_logs_restaurant_idx" ON "device_logs" ("restaurant_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_routing_restaurant_idx" ON "device_routing_rules" ("restaurant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_routing_device_idx" ON "device_routing_rules" ("device_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_station_device_idx" ON "device_station_mappings" ("device_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_station_kitchen_idx" ON "device_station_mappings" ("kitchen_id");
--> statement-breakpoint
-- Backfill: create a kot_printer device for every kitchen that already has a printer_name configured.
INSERT INTO "devices" ("restaurant_id", "kitchen_id", "type", "name", "status", "paper_size", "metadata", "paired_at")
SELECT
  k."restaurant_id",
  k."id",
  'kot_printer',
  COALESCE(NULLIF(k."printer_name", ''), k."name" || ' Printer'),
  'offline',
  k."paper_size",
  jsonb_build_object('migratedFromKitchenId', k."id", 'printerTarget', k."printer_target"),
  now()
FROM "kitchens" k
WHERE k."printer_name" IS NOT NULL AND k."printer_name" <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "devices" d
    WHERE d."kitchen_id" = k."id" AND d."type" = 'kot_printer' AND d."deleted_at" IS NULL
  );
--> statement-breakpoint
INSERT INTO "device_station_mappings" ("device_id", "kitchen_id", "restaurant_id")
SELECT d."id", d."kitchen_id", d."restaurant_id"
FROM "devices" d
WHERE d."type" = 'kot_printer'
  AND d."kitchen_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "device_station_mappings" m
    WHERE m."device_id" = d."id" AND m."kitchen_id" = d."kitchen_id"
  );
