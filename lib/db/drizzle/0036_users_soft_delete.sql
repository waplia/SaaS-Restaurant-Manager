-- Soft-delete columns for `users` (Task #573, account self-deletion).
-- Both nullable + additive — safe to apply with active traffic.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deletion_reason" text;
