CREATE TABLE IF NOT EXISTS "whatsapp_template_submissions" (
  "id" serial PRIMARY KEY NOT NULL,
  "template_id" integer NOT NULL,
  "attempt_type" text NOT NULL,
  "result_status" text NOT NULL,
  "meta_template_id" text,
  "request_payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "response_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_message" text,
  "triggered_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "whatsapp_template_submissions" ADD CONSTRAINT "whatsapp_template_submissions_template_id_whatsapp_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "whatsapp_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_template_submissions" ADD CONSTRAINT "whatsapp_template_submissions_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_table THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "whatsapp_template_submissions_template_idx" ON "whatsapp_template_submissions" ("template_id", "created_at");
