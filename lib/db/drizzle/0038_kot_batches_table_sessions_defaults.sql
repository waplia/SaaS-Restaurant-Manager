-- Task #601 follow-up: when kot_batches and table_sessions were added the
-- created_at / updated_at columns were marked NOT NULL but never received
-- the `DEFAULT now()` clause that the Drizzle schema declares. Every insert
-- in runningOrder.ts uses `default` for those timestamps (relying on the
-- DB), so every POST /orders / send-to-kitchen call now fails with
--   "null value in column \"created_at\" of relation \"kot_batches\""
-- This migration backfills the missing defaults. Idempotent.

ALTER TABLE "kot_batches" ALTER COLUMN "created_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "kot_batches" ALTER COLUMN "updated_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "table_sessions" ALTER COLUMN "created_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "table_sessions" ALTER COLUMN "updated_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "table_sessions" ALTER COLUMN "started_at" SET DEFAULT now();
--> statement-breakpoint
-- T601 also added order_items.added_at as NOT NULL .defaultNow() in the
-- Drizzle schema. Some environments may have the column without the
-- DB-level default (depending on schema-sync history), so defensively
-- backfill it here. Safe no-op if the default already matches.
ALTER TABLE "order_items" ALTER COLUMN "added_at" SET DEFAULT now();
