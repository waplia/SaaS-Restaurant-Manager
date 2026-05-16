ALTER TABLE "customer_feedback" ADD COLUMN "session_token" text;
CREATE UNIQUE INDEX IF NOT EXISTS "customer_feedback_qr_session_idx" ON "customer_feedback" ("qr_id", "session_token") WHERE "session_token" IS NOT NULL;
