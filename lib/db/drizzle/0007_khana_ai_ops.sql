CREATE TABLE "ai_forecasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"horizon_days" integer DEFAULT 7 NOT NULL,
	"inputs_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"confidence" numeric(5, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"request_log_id" integer,
	"generated_by" integer,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_inventory_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"inputs_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"confidence" numeric(5, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"purchase_order_id" integer,
	"request_log_id" integer,
	"generated_by" integer,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_recipe_cost_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"menu_item_id" integer NOT NULL,
	"inputs_hash" text NOT NULL,
	"current_cogs" numeric(10, 2),
	"current_price" numeric(10, 2),
	"suggested_price" numeric(10, 2),
	"payload" jsonb NOT NULL,
	"confidence" numeric(5, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"request_log_id" integer,
	"generated_by" integer,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_forecasts" ADD CONSTRAINT "ai_forecasts_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_forecasts" ADD CONSTRAINT "ai_forecasts_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_inventory_suggestions" ADD CONSTRAINT "ai_inventory_suggestions_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_inventory_suggestions" ADD CONSTRAINT "ai_inventory_suggestions_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_inventory_suggestions" ADD CONSTRAINT "ai_inventory_suggestions_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recipe_cost_snapshots" ADD CONSTRAINT "ai_recipe_cost_snapshots_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recipe_cost_snapshots" ADD CONSTRAINT "ai_recipe_cost_snapshots_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recipe_cost_snapshots" ADD CONSTRAINT "ai_recipe_cost_snapshots_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_forecasts_rest_idx" ON "ai_forecasts" USING btree ("restaurant_id","status","generated_at");--> statement-breakpoint
CREATE INDEX "ai_inventory_suggestions_rest_idx" ON "ai_inventory_suggestions" USING btree ("restaurant_id","status","generated_at");--> statement-breakpoint
CREATE INDEX "ai_recipe_cost_snapshots_item_idx" ON "ai_recipe_cost_snapshots" USING btree ("menu_item_id","status","generated_at");--> statement-breakpoint
CREATE INDEX "ai_recipe_cost_snapshots_rest_idx" ON "ai_recipe_cost_snapshots" USING btree ("restaurant_id","status","generated_at");