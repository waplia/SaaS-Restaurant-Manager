CREATE TABLE IF NOT EXISTS "feedback_wall_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "branch_id" integer,
  "feedback_id" integer,
  "external_review_id" integer,
  "source" text NOT NULL,
  "is_approved" boolean DEFAULT false NOT NULL,
  "is_featured" boolean DEFAULT false NOT NULL,
  "is_hidden" boolean DEFAULT false NOT NULL,
  "share_on_marketing" boolean DEFAULT false NOT NULL,
  "display_name_override" text,
  "approved_by" integer,
  "approved_at" timestamp,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_wall_items" ADD CONSTRAINT "feedback_wall_items_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_wall_items" ADD CONSTRAINT "feedback_wall_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_wall_items" ADD CONSTRAINT "feedback_wall_items_feedback_id_customer_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "customer_feedback"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_wall_items" ADD CONSTRAINT "feedback_wall_items_external_review_id_external_reviews_id_fk" FOREIGN KEY ("external_review_id") REFERENCES "external_reviews"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_wall_items" ADD CONSTRAINT "feedback_wall_items_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_wall_items_restaurant_idx" ON "feedback_wall_items" ("restaurant_id","is_approved");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feedback_wall_items_feedback_idx" ON "feedback_wall_items" ("feedback_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feedback_wall_items_external_idx" ON "feedback_wall_items" ("external_review_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_wall_items_marketing_idx" ON "feedback_wall_items" ("share_on_marketing","is_approved");
