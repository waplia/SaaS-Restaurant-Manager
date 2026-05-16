CREATE TABLE "ai_upsell_events" (
        "id" serial PRIMARY KEY NOT NULL,
        "restaurant_id" integer NOT NULL,
        "rule_id" integer,
        "order_id" integer,
        "menu_item_id" integer,
        "channel" text NOT NULL,
        "event_type" text NOT NULL,
        "revenue" numeric(10, 2) DEFAULT '0' NOT NULL,
        "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_upsell_rules" (
        "id" serial PRIMARY KEY NOT NULL,
        "restaurant_id" integer NOT NULL,
        "branch_id" integer,
        "name" text NOT NULL,
        "channel" text DEFAULT 'both' NOT NULL,
        "priority" integer DEFAULT 50 NOT NULL,
        "is_enabled" boolean DEFAULT true NOT NULL,
        "trigger_type" text NOT NULL,
        "trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "suggested_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "message" text,
        "source" text DEFAULT 'manual' NOT NULL,
        "suggestion_id" integer,
        "created_by" integer,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_upsell_suggestions" (
        "id" serial PRIMARY KEY NOT NULL,
        "restaurant_id" integer NOT NULL,
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
ALTER TABLE "ai_upsell_events" ADD CONSTRAINT "ai_upsell_events_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_upsell_events" ADD CONSTRAINT "ai_upsell_events_rule_id_ai_upsell_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."ai_upsell_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_upsell_events" ADD CONSTRAINT "ai_upsell_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_upsell_events" ADD CONSTRAINT "ai_upsell_events_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_upsell_rules" ADD CONSTRAINT "ai_upsell_rules_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_upsell_rules" ADD CONSTRAINT "ai_upsell_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_upsell_rules" ADD CONSTRAINT "ai_upsell_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_upsell_suggestions" ADD CONSTRAINT "ai_upsell_suggestions_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_upsell_suggestions" ADD CONSTRAINT "ai_upsell_suggestions_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_upsell_events_rest_idx" ON "ai_upsell_events" USING btree ("restaurant_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "ai_upsell_events_rule_idx" ON "ai_upsell_events" USING btree ("rule_id","event_type");--> statement-breakpoint
CREATE INDEX "ai_upsell_rules_rest_idx" ON "ai_upsell_rules" USING btree ("restaurant_id","is_enabled","priority");--> statement-breakpoint
CREATE INDEX "ai_upsell_rules_branch_idx" ON "ai_upsell_rules" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "ai_upsell_suggestions_rest_idx" ON "ai_upsell_suggestions" USING btree ("restaurant_id","status","generated_at");