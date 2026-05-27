CREATE UNIQUE INDEX IF NOT EXISTS "order_sequences_outlet_day_type_unique"
  ON "order_sequences" ("restaurant_id", "branch_id", "business_date", "order_type_prefix");

ALTER TABLE "order_sequences" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "order_sequences" ALTER COLUMN "updated_at" SET DEFAULT now();
