CREATE TABLE IF NOT EXISTS "vendor_invoices" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "supplier_id" integer,
  "purchase_order_id" integer,
  "expense_id" integer,
  "status" text DEFAULT 'draft' NOT NULL,
  "invoice_number" text,
  "invoice_date" date,
  "due_date" date,
  "vendor_name" text,
  "total_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "tax_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "currency" text DEFAULT 'INR' NOT NULL,
  "upload_object_path" text NOT NULL,
  "upload_mime_type" text,
  "extracted_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "confidence_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "has_price_variance" text DEFAULT 'false' NOT NULL,
  "rejection_reason" text,
  "notes" text,
  "created_by" integer,
  "approved_by" integer,
  "approved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_invoice_lines" (
  "id" serial PRIMARY KEY NOT NULL,
  "vendor_invoice_id" integer NOT NULL,
  "line_number" integer DEFAULT 0 NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "quantity" numeric(12, 3) DEFAULT '0.000' NOT NULL,
  "unit" text DEFAULT 'unit' NOT NULL,
  "unit_price" numeric(12, 4) DEFAULT '0.0000' NOT NULL,
  "line_total" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "matched_inventory_item_id" integer,
  "matched_po_item_id" integer,
  "price_variance_pct" numeric(8, 2),
  "confidence" numeric(4, 3) DEFAULT '0.000' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vendor_invoice_lines" ADD CONSTRAINT "vendor_invoice_lines_vendor_invoice_id_vendor_invoices_id_fk" FOREIGN KEY ("vendor_invoice_id") REFERENCES "public"."vendor_invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vendor_invoice_lines" ADD CONSTRAINT "vendor_invoice_lines_matched_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("matched_inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vendor_invoice_lines" ADD CONSTRAINT "vendor_invoice_lines_matched_po_item_id_purchase_order_items_id_fk" FOREIGN KEY ("matched_po_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_invoices_restaurant_idx" ON "vendor_invoices" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_invoices_status_idx" ON "vendor_invoices" USING btree ("restaurant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_invoices_po_idx" ON "vendor_invoices" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_invoice_lines_invoice_idx" ON "vendor_invoice_lines" USING btree ("vendor_invoice_id");
