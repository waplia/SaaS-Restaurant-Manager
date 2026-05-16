CREATE TABLE "ai_insight_daily_allowance" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"restaurant_id" integer NOT NULL,
	"day" date NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_sales_insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"restaurant_id" integer NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"suggested_action" text,
	"impact" text DEFAULT 'medium' NOT NULL,
	"target_module" text,
	"target_id" integer,
	"target_url" text,
	"supporting_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"confidence" numeric(5, 2),
	"notes" text,
	"request_log_id" integer,
	"generated_by" integer,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_insight_daily_allowance" ADD CONSTRAINT "ai_insight_daily_allowance_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insight_daily_allowance" ADD CONSTRAINT "ai_insight_daily_allowance_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sales_insights" ADD CONSTRAINT "ai_sales_insights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sales_insights" ADD CONSTRAINT "ai_sales_insights_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sales_insights" ADD CONSTRAINT "ai_sales_insights_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_insight_daily_allowance_uniq" ON "ai_insight_daily_allowance" USING btree ("tenant_id","restaurant_id","day");--> statement-breakpoint
CREATE INDEX "ai_sales_insights_rest_status_idx" ON "ai_sales_insights" USING btree ("restaurant_id","status","generated_at");--> statement-breakpoint
CREATE INDEX "ai_sales_insights_category_idx" ON "ai_sales_insights" USING btree ("restaurant_id","category","generated_at");