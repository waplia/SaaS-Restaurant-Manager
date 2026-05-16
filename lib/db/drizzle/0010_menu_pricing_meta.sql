CREATE TABLE IF NOT EXISTS "menu_item_pricing_meta" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "menu_item_id" integer NOT NULL,
  "competitor_price" numeric(10, 2),
  "waste_pct" numeric(5, 2),
  "overhead_pct" numeric(5, 2),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "menu_item_pricing_meta" ADD CONSTRAINT "menu_item_pricing_meta_restaurant_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "menu_item_pricing_meta" ADD CONSTRAINT "menu_item_pricing_meta_menu_item_id_fk"
    FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "menu_item_pricing_meta_item_idx" ON "menu_item_pricing_meta" ("menu_item_id");
