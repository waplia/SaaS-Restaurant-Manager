-- Operations Intelligence pack (Task #366) — 13 tables.
-- Reproducible migration to create all ops tables on a fresh environment.

CREATE TABLE IF NOT EXISTS "panic_alerts" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "message" text,
  "status" text DEFAULT 'open' NOT NULL,
  "raised_by_user_id" integer REFERENCES "users"("id"),
  "raised_at" timestamp DEFAULT now() NOT NULL,
  "acknowledged_at" timestamp,
  "acknowledged_by_user_id" integer REFERENCES "users"("id"),
  "resolved_at" timestamp,
  "resolved_by_user_id" integer REFERENCES "users"("id"),
  "notes" text
);
CREATE INDEX IF NOT EXISTS "panic_alerts_restaurant_idx" ON "panic_alerts" ("restaurant_id","raised_at");
CREATE INDEX IF NOT EXISTS "panic_alerts_status_idx" ON "panic_alerts" ("restaurant_id","status");

CREATE TABLE IF NOT EXISTS "manager_handovers" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "shift_id" integer,
  "from_user_id" integer REFERENCES "users"("id"),
  "to_user_id" integer REFERENCES "users"("id"),
  "cash_issue" text,
  "stock_issue" text,
  "staff_issue" text,
  "pending_orders" text,
  "complaints" text,
  "tomorrow_tasks" text,
  "notes" text,
  "submitted_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "manager_handovers_restaurant_idx" ON "manager_handovers" ("restaurant_id","submitted_at");

CREATE TABLE IF NOT EXISTS "morning_briefings" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "for_date" text NOT NULL,
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "morning_briefings_restaurant_idx" ON "morning_briefings" ("restaurant_id","for_date");

CREATE TABLE IF NOT EXISTS "closing_checklist_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "enforce_on_close" boolean DEFAULT true NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "closing_checklist_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "template_id" integer REFERENCES "closing_checklist_templates"("id"),
  "session_id" integer,
  "completed_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "submitted_by_user_id" integer REFERENCES "users"("id"),
  "submitted_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "closing_checklist_runs_restaurant_idx" ON "closing_checklist_runs" ("restaurant_id","submitted_at");

CREATE TABLE IF NOT EXISTS "timeline_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "entity" text,
  "entity_id" integer,
  "summary" text NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id"),
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "occurred_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "timeline_events_restaurant_idx" ON "timeline_events" ("restaurant_id","occurred_at");
CREATE INDEX IF NOT EXISTS "timeline_events_entity_idx" ON "timeline_events" ("restaurant_id","entity","entity_id");

CREATE TABLE IF NOT EXISTS "ops_approvals" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "amount" numeric(12,2),
  "payload" jsonb DEFAULT '{}'::jsonb,
  "status" text DEFAULT 'pending' NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id"),
  "requested_at" timestamp DEFAULT now() NOT NULL,
  "decided_by_user_id" integer REFERENCES "users"("id"),
  "decided_at" timestamp,
  "decision_comment" text
);
CREATE INDEX IF NOT EXISTS "ops_approvals_restaurant_idx" ON "ops_approvals" ("restaurant_id","status","requested_at");

CREATE TABLE IF NOT EXISTS "incidents" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "severity" text DEFAULT 'medium' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "assignee_user_id" integer REFERENCES "users"("id"),
  "reported_by_user_id" integer REFERENCES "users"("id"),
  "resolution_notes" text,
  "reported_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp
);
CREATE INDEX IF NOT EXISTS "incidents_restaurant_idx" ON "incidents" ("restaurant_id","status","reported_at");

CREATE TABLE IF NOT EXISTS "cleaning_proofs" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "area" text NOT NULL,
  "before_url" text,
  "after_url" text,
  "notes" text,
  "submitted_by_user_id" integer REFERENCES "users"("id"),
  "submitted_at" timestamp DEFAULT now() NOT NULL,
  "reviewed_by_user_id" integer REFERENCES "users"("id"),
  "reviewed_at" timestamp,
  "status" text DEFAULT 'submitted' NOT NULL,
  "review_comment" text
);
CREATE INDEX IF NOT EXISTS "cleaning_proofs_restaurant_idx" ON "cleaning_proofs" ("restaurant_id","submitted_at");

CREATE TABLE IF NOT EXISTS "temperature_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "device_label" text NOT NULL,
  "location" text,
  "temp_celsius" numeric(6,2) NOT NULL,
  "min_threshold" numeric(6,2),
  "max_threshold" numeric(6,2),
  "source" text DEFAULT 'manual' NOT NULL,
  "reading_at" timestamp DEFAULT now() NOT NULL,
  "recorded_by_user_id" integer REFERENCES "users"("id"),
  "alert_sent" boolean DEFAULT false NOT NULL,
  "notes" text
);
CREATE INDEX IF NOT EXISTS "temperature_logs_restaurant_idx" ON "temperature_logs" ("restaurant_id","reading_at");

CREATE TABLE IF NOT EXISTS "equipment_register" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "type" text,
  "location" text,
  "serial_number" text,
  "vendor" text,
  "purchase_date" text,
  "amc_expires_at" text,
  "next_service_at" text,
  "status" text DEFAULT 'operational' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "equipment_register_restaurant_idx" ON "equipment_register" ("restaurant_id");

CREATE TABLE IF NOT EXISTS "equipment_maintenance_records" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "equipment_id" integer NOT NULL REFERENCES "equipment_register"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "cost" numeric(12,2) DEFAULT '0',
  "vendor" text,
  "performed_at" timestamp DEFAULT now() NOT NULL,
  "notes" text,
  "recorded_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "equipment_maint_equipment_idx" ON "equipment_maintenance_records" ("equipment_id","performed_at");

CREATE TABLE IF NOT EXISTS "service_timer_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "order_id" integer NOT NULL,
  "stage" text NOT NULL,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "duration_ms" integer
);
CREATE INDEX IF NOT EXISTS "service_timer_events_order_idx" ON "service_timer_events" ("order_id","occurred_at");
CREATE INDEX IF NOT EXISTS "service_timer_events_restaurant_idx" ON "service_timer_events" ("restaurant_id","occurred_at");
