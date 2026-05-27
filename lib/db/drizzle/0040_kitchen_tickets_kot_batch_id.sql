ALTER TABLE "kitchen_tickets" ADD COLUMN IF NOT EXISTS "kot_batch_id" integer;
CREATE INDEX IF NOT EXISTS "kitchen_tickets_kot_batch_idx" ON "kitchen_tickets" ("kot_batch_id");
