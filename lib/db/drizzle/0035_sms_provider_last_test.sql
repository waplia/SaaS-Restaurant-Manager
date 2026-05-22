-- Task #591 — Proper SMS provider setup in super-admin.
-- Record the outcome of the most recent "Send test" so the providers
-- table can show a Reachable / Last test failed / Not tested pill.

ALTER TABLE "sms_providers" ADD COLUMN IF NOT EXISTS "last_test_status" text;
ALTER TABLE "sms_providers" ADD COLUMN IF NOT EXISTS "last_test_error" text;
ALTER TABLE "sms_providers" ADD COLUMN IF NOT EXISTS "last_test_at" timestamp;
