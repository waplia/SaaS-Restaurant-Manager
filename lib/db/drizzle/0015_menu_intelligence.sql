CREATE TABLE IF NOT EXISTS "menu_item_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"menu_item_id" integer,
	"session_id" text,
	"table_id" integer,
	"event_type" text NOT NULL,
	"variant_key" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menu_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"query" text NOT NULL,
	"normalized_query" text NOT NULL,
	"results_count" integer DEFAULT 0 NOT NULL,
	"session_id" text,
	"table_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menu_ab_experiments" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"menu_item_id" integer NOT NULL,
	"name" text NOT NULL,
	"hypothesis" text,
	"variant_a_name" text DEFAULT 'Control' NOT NULL,
	"variant_b_name" text DEFAULT 'Variant B' NOT NULL,
	"variant_a_price" numeric(10, 2),
	"variant_b_price" numeric(10, 2),
	"variant_a_description" text,
	"variant_b_description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"started_at" timestamp,
	"ended_at" timestamp,
	"winner_variant" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menu_ab_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"experiment_id" integer NOT NULL,
	"session_id" text NOT NULL,
	"variant" text NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"revenue" numeric(10, 2) DEFAULT '0' NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "modifier_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_taste_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"spicy_tolerance" integer,
	"sweet_preference" integer,
	"preferred_cuisines" text[] DEFAULT '{}'::text[],
	"dietary" text[] DEFAULT '{}'::text[],
	"allergens" text[] DEFAULT '{}'::text[],
	"disliked_ingredients" text[] DEFAULT '{}'::text[],
	"favorite_item_ids" integer[] DEFAULT '{}'::integer[],
	"notes" text,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menu_group_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"table_id" integer,
	"code" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"split_mode" text DEFAULT 'single' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	CONSTRAINT "menu_group_sessions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menu_group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"guest_name" text NOT NULL,
	"guest_key" text NOT NULL,
	"is_host" boolean DEFAULT false NOT NULL,
	"cart" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menu_item_lifecycle_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"menu_item_id" integer NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"reason" text,
	"changed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menu_item_launches" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"menu_item_id" integer NOT NULL,
	"launched_at" timestamp DEFAULT now() NOT NULL,
	"target_orders" integer,
	"target_revenue" numeric(10, 2),
	"tracking_window_days" integer DEFAULT 30 NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menu_photo_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"menu_item_id" integer,
	"image_url" text NOT NULL,
	"caption" text,
	"submitted_by" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"file_url" text,
	"thumbnail_url" text,
	"meta" jsonb,
	"tags" text[] DEFAULT '{}'::text[],
	"uploaded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_item_events" ADD CONSTRAINT "menu_item_events_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_item_events" ADD CONSTRAINT "menu_item_events_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_searches" ADD CONSTRAINT "menu_searches_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_ab_experiments" ADD CONSTRAINT "menu_ab_experiments_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_ab_experiments" ADD CONSTRAINT "menu_ab_experiments_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_ab_experiments" ADD CONSTRAINT "menu_ab_experiments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_ab_assignments" ADD CONSTRAINT "menu_ab_assignments_experiment_id_menu_ab_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."menu_ab_experiments"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "modifier_templates" ADD CONSTRAINT "modifier_templates_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "modifier_templates" ADD CONSTRAINT "modifier_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "customer_taste_profiles" ADD CONSTRAINT "customer_taste_profiles_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "customer_taste_profiles" ADD CONSTRAINT "customer_taste_profiles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "customer_taste_profiles" ADD CONSTRAINT "customer_taste_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_group_sessions" ADD CONSTRAINT "menu_group_sessions_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_group_members" ADD CONSTRAINT "menu_group_members_session_id_menu_group_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."menu_group_sessions"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_item_lifecycle_history" ADD CONSTRAINT "menu_item_lifecycle_history_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_item_lifecycle_history" ADD CONSTRAINT "menu_item_lifecycle_history_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_item_lifecycle_history" ADD CONSTRAINT "menu_item_lifecycle_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_item_launches" ADD CONSTRAINT "menu_item_launches_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_item_launches" ADD CONSTRAINT "menu_item_launches_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_item_launches" ADD CONSTRAINT "menu_item_launches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_photo_submissions" ADD CONSTRAINT "menu_photo_submissions_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_photo_submissions" ADD CONSTRAINT "menu_photo_submissions_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_photo_submissions" ADD CONSTRAINT "menu_photo_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "menu_photo_submissions" ADD CONSTRAINT "menu_photo_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "menu_item_events_restaurant_idx" ON "menu_item_events" ("restaurant_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "menu_item_events_item_idx" ON "menu_item_events" ("menu_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "menu_searches_restaurant_idx" ON "menu_searches" ("restaurant_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "menu_searches_norm_idx" ON "menu_searches" ("normalized_query");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "menu_ab_assign_exp_sess_idx" ON "menu_ab_assignments" ("experiment_id","session_id");
