CREATE TABLE IF NOT EXISTS "fraud_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"detector" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"subject_user_id" integer,
	"subject_role" text,
	"entity_type" text,
	"entity_id" integer,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"score" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"threshold" numeric(10, 2),
	"observed_value" numeric(14, 2),
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_summary" text,
	"ai_summary_fallback" boolean DEFAULT false NOT NULL,
	"dedupe_key" text NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fraud_detector_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"detector" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"threshold" numeric(14, 2),
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fraud_detector_settings" ADD CONSTRAINT "fraud_detector_settings_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fraud_alerts_restaurant_status_idx" ON "fraud_alerts" ("restaurant_id","status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fraud_alerts_detector_idx" ON "fraud_alerts" ("restaurant_id","detector","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fraud_alerts_dedupe_ux" ON "fraud_alerts" ("restaurant_id","dedupe_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fraud_detector_settings_restaurant_detector_ux" ON "fraud_detector_settings" ("restaurant_id","detector");
