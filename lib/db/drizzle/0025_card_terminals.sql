-- Physical card terminal integration (Task #420)
-- - Extends device_type enum with `card_terminal`
-- - Adds device_id / terminal_provider / terminal_ref_id columns to payments
--   so we can attribute card-present charges + refunds to a specific reader.

ALTER TYPE "device_type" ADD VALUE IF NOT EXISTS 'card_terminal';

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "device_id" integer,
  ADD COLUMN IF NOT EXISTS "terminal_provider" text,
  ADD COLUMN IF NOT EXISTS "terminal_ref_id" text;

CREATE INDEX IF NOT EXISTS "payments_device_id_idx"
  ON "payments" ("device_id");

CREATE INDEX IF NOT EXISTS "payments_terminal_ref_idx"
  ON "payments" ("restaurant_id", "terminal_ref_id");

DO $$ BEGIN
  ALTER TABLE "payments"
    ADD CONSTRAINT "payments_device_id_devices_id_fk"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
