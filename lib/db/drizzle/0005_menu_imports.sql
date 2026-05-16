CREATE TABLE "ai_menu_import_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" integer NOT NULL,
	"restaurant_id" integer NOT NULL,
	"row_index" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"structured" jsonb NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '0.800' NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"duplicate_match_id" integer,
	"menu_item_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"saved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ai_menu_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"tenant_id" integer,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"file_name" text,
	"file_ref" text,
	"source_url" text,
	"source_text_preview" text,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"saved_item_count" integer DEFAULT 0 NOT NULL,
	"needs_review_count" integer DEFAULT 0 NOT NULL,
	"estimated_credits" integer DEFAULT 0 NOT NULL,
	"actual_credits" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"summary" jsonb DEFAULT '{}'::jsonb,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"saved_at" timestamp,
	"rolled_back_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ai_menu_import_items" ADD CONSTRAINT "ai_menu_import_items_import_id_ai_menu_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."ai_menu_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_menu_import_items" ADD CONSTRAINT "ai_menu_import_items_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_menu_import_items" ADD CONSTRAINT "ai_menu_import_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_menu_imports" ADD CONSTRAINT "ai_menu_imports_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_menu_imports" ADD CONSTRAINT "ai_menu_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_menu_imports" ADD CONSTRAINT "ai_menu_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_menu_import_items_import_idx" ON "ai_menu_import_items" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "ai_menu_import_items_menu_item_idx" ON "ai_menu_import_items" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX "ai_menu_imports_restaurant_idx" ON "ai_menu_imports" USING btree ("restaurant_id","created_at");