CREATE TABLE "inventory_item_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"inventory_item_id" integer NOT NULL,
	"batch_number" text,
	"quantity_received" numeric(10, 3) DEFAULT '0.000' NOT NULL,
	"quantity_remaining" numeric(10, 3) DEFAULT '0.000' NOT NULL,
	"expiry_date" timestamp,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"purchase_order_id" integer,
	"purchase_order_item_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restaurant_ai_settings" ADD COLUMN IF NOT EXISTS "expiry_window_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_item_batches" ADD CONSTRAINT "inventory_item_batches_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_batches" ADD CONSTRAINT "inventory_item_batches_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_batches" ADD CONSTRAINT "inventory_item_batches_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_batches" ADD CONSTRAINT "inventory_item_batches_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_batches_item_expiry_idx" ON "inventory_item_batches" USING btree ("inventory_item_id","expiry_date");--> statement-breakpoint
CREATE INDEX "inventory_batches_rest_idx" ON "inventory_item_batches" USING btree ("restaurant_id","expiry_date");
