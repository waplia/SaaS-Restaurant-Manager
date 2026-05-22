-- Task #599: thermal printer registry + print queue.
-- Adds two new tables; both have FKs to existing restaurants/branches/
-- kitchens/orders. All references use ON DELETE SET NULL for optional
-- relationships and CASCADE-safe inserts. Indexes mirror the access
-- patterns in artifacts/api-server/src/routes/printers.ts.

CREATE TABLE IF NOT EXISTS "printers" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id"),
  "branch_id" integer REFERENCES "branches"("id") ON DELETE SET NULL,
  "kitchen_id" integer REFERENCES "kitchens"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "connection_type" text NOT NULL,
  "role" text NOT NULL,
  "paper_size" text NOT NULL DEFAULT '80mm',
  "connection" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_default" boolean NOT NULL DEFAULT false,
  "auto_print" boolean NOT NULL DEFAULT false,
  "enabled" boolean NOT NULL DEFAULT true,
  "copies" integer NOT NULL DEFAULT 1,
  "characters_per_line" integer NOT NULL DEFAULT 48,
  "feed_lines" integer NOT NULL DEFAULT 3,
  "cut_paper" boolean NOT NULL DEFAULT true,
  "cash_drawer_kick" boolean NOT NULL DEFAULT false,
  "buzzer" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'unknown',
  "last_test_at" timestamp,
  "last_test_error" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "deleted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "printers_restaurant_idx" ON "printers" ("restaurant_id");
CREATE INDEX IF NOT EXISTS "printers_branch_idx" ON "printers" ("branch_id");
CREATE INDEX IF NOT EXISTS "printers_kitchen_idx" ON "printers" ("kitchen_id");
CREATE INDEX IF NOT EXISTS "printers_role_idx" ON "printers" ("restaurant_id", "role");

CREATE TABLE IF NOT EXISTS "print_jobs" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id"),
  "branch_id" integer REFERENCES "branches"("id") ON DELETE SET NULL,
  "printer_id" integer REFERENCES "printers"("id") ON DELETE SET NULL,
  "print_type" text NOT NULL,
  "order_id" integer REFERENCES "orders"("id") ON DELETE SET NULL,
  "invoice_number" text,
  "kot_number" text,
  "kitchen_id" integer REFERENCES "kitchens"("id") ON DELETE SET NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'queued',
  "error" text,
  "retry_count" integer NOT NULL DEFAULT 0,
  "max_retries" integer NOT NULL DEFAULT 3,
  "copies" integer NOT NULL DEFAULT 1,
  "copies_printed" integer NOT NULL DEFAULT 0,
  "dedupe_key" text,
  "requested_by" integer,
  "requested_by_name" text,
  "queued_at" timestamp NOT NULL DEFAULT now(),
  "started_at" timestamp,
  "completed_at" timestamp,
  "next_attempt_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "print_jobs_restaurant_idx" ON "print_jobs" ("restaurant_id", "created_at");
CREATE INDEX IF NOT EXISTS "print_jobs_printer_idx" ON "print_jobs" ("printer_id");
CREATE INDEX IF NOT EXISTS "print_jobs_status_idx" ON "print_jobs" ("restaurant_id", "status");
CREATE INDEX IF NOT EXISTS "print_jobs_dedupe_idx" ON "print_jobs" ("restaurant_id", "dedupe_key");
