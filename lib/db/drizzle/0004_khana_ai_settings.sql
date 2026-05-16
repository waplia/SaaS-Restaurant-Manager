CREATE TABLE "restaurant_ai_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"default_tone" text DEFAULT 'simple' NOT NULL,
	"default_language" text DEFAULT 'en' NOT NULL,
	"default_length" text DEFAULT 'short' NOT NULL,
	"require_approval_for_descriptions" boolean DEFAULT false NOT NULL,
	"require_approval_for_images" boolean DEFAULT true NOT NULL,
	"feature_toggles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restaurant_ai_settings" ADD CONSTRAINT "restaurant_ai_settings_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_ai_settings_restaurant_idx" ON "restaurant_ai_settings" USING btree ("restaurant_id");