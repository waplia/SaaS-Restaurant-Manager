-- Task #436 — Support SLA & Emergency Support
-- Idempotent migration: per-plan SLA tiers, POS emergency tickets,
-- callback requests, breach escalation matrix, public status page,
-- satisfaction ratings.

-- Extend support_tickets with emergency / escalation / CSAT columns.
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "is_emergency" boolean NOT NULL DEFAULT false;
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "escalation_level" integer NOT NULL DEFAULT 0;
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "last_escalated_at" timestamp;
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "first_response_breach_notified_at" timestamp;
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "resolution_breach_notified_at" timestamp;
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "satisfaction_rating" integer;
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "satisfaction_comment" text;
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "satisfaction_at" timestamp;

-- Extend SLA settings with escalation matrix + tier config + status page.
ALTER TABLE "support_sla_settings" ADD COLUMN IF NOT EXISTS "escalation_matrix" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "support_sla_settings" ADD COLUMN IF NOT EXISTS "tier_config" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "support_sla_settings" ADD COLUMN IF NOT EXISTS "live_chat_url" text;
ALTER TABLE "support_sla_settings" ADD COLUMN IF NOT EXISTS "status_page_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "support_sla_settings" ADD COLUMN IF NOT EXISTS "status_page_title" text NOT NULL DEFAULT 'System Status';
ALTER TABLE "support_sla_settings" ADD COLUMN IF NOT EXISTS "status_page_description" text NOT NULL DEFAULT 'Current status of all TableTrack services.';

-- Phone callback queue.
CREATE TABLE IF NOT EXISTS "support_callback_requests" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "requester_id" integer REFERENCES "users"("id"),
  "requester_name" text,
  "phone" text NOT NULL,
  "preferred_time" text,
  "topic" text,
  "notes" text,
  "status" text NOT NULL DEFAULT 'pending',
  "handler_id" integer REFERENCES "users"("id"),
  "handler_note" text,
  "acknowledged_at" timestamp,
  "completed_at" timestamp,
  "ticket_id" integer REFERENCES "support_tickets"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "support_callback_requests_tenant_idx"
  ON "support_callback_requests"("tenant_id");
CREATE INDEX IF NOT EXISTS "support_callback_requests_status_idx"
  ON "support_callback_requests"("status");

-- Public status-page incidents.
CREATE TABLE IF NOT EXISTS "support_incidents" (
  "id" serial PRIMARY KEY,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "status" text NOT NULL DEFAULT 'investigating',
  "severity" text NOT NULL DEFAULT 'minor',
  "affected_components" text[] NOT NULL DEFAULT '{}',
  "started_at" timestamp NOT NULL DEFAULT now(),
  "resolved_at" timestamp,
  "created_by" integer REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "support_incidents_status_idx"
  ON "support_incidents"("status");
CREATE INDEX IF NOT EXISTS "support_incidents_started_at_idx"
  ON "support_incidents"("started_at" DESC);

CREATE TABLE IF NOT EXISTS "support_incident_updates" (
  "id" serial PRIMARY KEY,
  "incident_id" integer NOT NULL REFERENCES "support_incidents"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "body" text NOT NULL,
  "created_by" integer REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "support_incident_updates_incident_idx"
  ON "support_incident_updates"("incident_id", "created_at" DESC);

-- Code review follow-up: add isPublished gate for incidents (status page draft support).
ALTER TABLE "support_incidents" ADD COLUMN IF NOT EXISTS "is_published" boolean NOT NULL DEFAULT true;
