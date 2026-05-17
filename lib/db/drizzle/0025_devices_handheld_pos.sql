-- Handheld POS (Task #419) — device-to-waiter assignment.
-- Adds columns to mark a device as handheld and bind it to a waiter so
-- per-device + per-waiter sales reports can join on the assignment.

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "assigned_user_id" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "is_handheld" boolean DEFAULT false NOT NULL;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "devices"
    ADD CONSTRAINT "devices_assigned_user_id_users_id_fk"
    FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "devices_assigned_user_idx" ON "devices" ("assigned_user_id");
