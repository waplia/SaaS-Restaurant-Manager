-- 2Factor.in SMS / OTP provider integration (Task #532)
-- Adds verify-by-session OTP, message-type / purpose breakdown, provider
-- error codes, and raw provider response capture for the SMS logs.

ALTER TABLE "sms_logs" ADD COLUMN IF NOT EXISTS "provider_session_id" text;
ALTER TABLE "sms_logs" ADD COLUMN IF NOT EXISTS "purpose" text;
ALTER TABLE "sms_logs" ADD COLUMN IF NOT EXISTS "message_type" text;
ALTER TABLE "sms_logs" ADD COLUMN IF NOT EXISTS "cost_estimate" numeric(10,4);
ALTER TABLE "sms_logs" ADD COLUMN IF NOT EXISTS "error_code" text;
ALTER TABLE "sms_logs" ADD COLUMN IF NOT EXISTS "provider_response" jsonb;

CREATE INDEX IF NOT EXISTS "sms_logs_provider_type_idx" ON "sms_logs" ("provider_type");
CREATE INDEX IF NOT EXISTS "sms_logs_purpose_idx" ON "sms_logs" ("purpose");
CREATE INDEX IF NOT EXISTS "sms_logs_message_type_idx" ON "sms_logs" ("message_type");
