CREATE TABLE IF NOT EXISTS "web_push_subscriptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "order_id" integer,
  "restaurant_id" integer,
  "table_id" integer,
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_sent_at" timestamp,
  CONSTRAINT "web_push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);

DO $$ BEGIN
  ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "web_push_subscriptions_order_id_idx" ON "web_push_subscriptions" ("order_id");
CREATE INDEX IF NOT EXISTS "web_push_subscriptions_restaurant_id_idx" ON "web_push_subscriptions" ("restaurant_id");

ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "web_push_public_key" text;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "web_push_private_key" text;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "web_push_subject" text;
