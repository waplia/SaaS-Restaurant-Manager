CREATE TABLE "customer_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"branch_id" integer,
	"qr_id" integer,
	"rating" integer NOT NULL,
	"category" text,
	"comment" text,
	"customer_name" text,
	"customer_phone" text,
	"source" text DEFAULT 'qr' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"author_name" text,
	"rating" integer,
	"body" text NOT NULL,
	"posted_at" timestamp,
	"sentiment" text,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_recovery_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"feedback_id" integer,
	"external_review_id" integer,
	"category" text,
	"sentiment" text,
	"ai_summary" text,
	"suggested_response" text,
	"suggested_compensation" text,
	"status" text DEFAULT 'new' NOT NULL,
	"assigned_to" integer,
	"resolution_notes" text,
	"resolved_at" timestamp,
	"resolved_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_qr_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"qr_id" integer NOT NULL,
	"restaurant_id" integer NOT NULL,
	"event" text NOT NULL,
	"rating" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_qrs" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"branch_id" integer,
	"qr_code" text NOT NULL,
	"title" text DEFAULT 'How was your experience?' NOT NULL,
	"custom_message" text,
	"thank_you_message" text DEFAULT 'Thanks for your feedback!' NOT NULL,
	"negative_feedback_message" text DEFAULT 'Sorry to hear that. We''d love a chance to make it right.' NOT NULL,
	"google_review_url" text,
	"google_place_id" text,
	"positive_threshold" integer DEFAULT 4 NOT NULL,
	"show_google_button_on_negative" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_qrs_qr_code_unique" UNIQUE("qr_code")
);
--> statement-breakpoint
CREATE TABLE "review_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_review_id" integer,
	"restaurant_id" integer NOT NULL,
	"review_snapshot" text,
	"tone" text DEFAULT 'professional' NOT NULL,
	"draft_reply" text NOT NULL,
	"final_reply" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"posted_at" timestamp,
	"posted_by" integer,
	"posted_to" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_qr_id_review_qrs_id_fk" FOREIGN KEY ("qr_id") REFERENCES "public"."review_qrs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_reviews" ADD CONSTRAINT "external_reviews_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_recovery_tasks" ADD CONSTRAINT "feedback_recovery_tasks_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_recovery_tasks" ADD CONSTRAINT "feedback_recovery_tasks_feedback_id_customer_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."customer_feedback"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_recovery_tasks" ADD CONSTRAINT "feedback_recovery_tasks_external_review_id_external_reviews_id_fk" FOREIGN KEY ("external_review_id") REFERENCES "public"."external_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_recovery_tasks" ADD CONSTRAINT "feedback_recovery_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_recovery_tasks" ADD CONSTRAINT "feedback_recovery_tasks_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_qr_scans" ADD CONSTRAINT "review_qr_scans_qr_id_review_qrs_id_fk" FOREIGN KEY ("qr_id") REFERENCES "public"."review_qrs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_qr_scans" ADD CONSTRAINT "review_qr_scans_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_qrs" ADD CONSTRAINT "review_qrs_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_qrs" ADD CONSTRAINT "review_qrs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_external_review_id_external_reviews_id_fk" FOREIGN KEY ("external_review_id") REFERENCES "public"."external_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_feedback_restaurant_idx" ON "customer_feedback" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_feedback_rating_idx" ON "customer_feedback" USING btree ("restaurant_id","rating");--> statement-breakpoint
CREATE INDEX "external_reviews_restaurant_idx" ON "external_reviews" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_reviews_external_idx" ON "external_reviews" USING btree ("restaurant_id","source","external_id");--> statement-breakpoint
CREATE INDEX "feedback_recovery_tasks_restaurant_idx" ON "feedback_recovery_tasks" USING btree ("restaurant_id","status");--> statement-breakpoint
CREATE INDEX "review_qr_scans_qr_idx" ON "review_qr_scans" USING btree ("qr_id","created_at");--> statement-breakpoint
CREATE INDEX "review_qr_scans_restaurant_idx" ON "review_qr_scans" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "review_qrs_restaurant_idx" ON "review_qrs" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "review_replies_restaurant_idx" ON "review_replies" USING btree ("restaurant_id","created_at");