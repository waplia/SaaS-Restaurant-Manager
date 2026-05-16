CREATE TABLE IF NOT EXISTS "staff_task_areas" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "qr_token" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "staff_task_areas_qr_token_unique" UNIQUE("qr_token")
);

DO $$ BEGIN
  ALTER TABLE "staff_task_areas" ADD CONSTRAINT "staff_task_areas_restaurant_id_restaurants_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "staff_task_areas_restaurant_idx" ON "staff_task_areas" ("restaurant_id");

CREATE TABLE IF NOT EXISTS "staff_task_checklists" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "area_id" integer NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "photo_required" boolean DEFAULT false NOT NULL,
  "schedule_type" text DEFAULT 'none' NOT NULL,
  "interval_minutes" integer DEFAULT 120 NOT NULL,
  "times_per_day" integer DEFAULT 3 NOT NULL,
  "window_minutes" integer DEFAULT 60 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "staff_task_checklists" ADD CONSTRAINT "staff_task_checklists_restaurant_id_restaurants_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "staff_task_checklists" ADD CONSTRAINT "staff_task_checklists_area_id_staff_task_areas_id_fk"
    FOREIGN KEY ("area_id") REFERENCES "staff_task_areas"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "staff_task_checklists_restaurant_idx" ON "staff_task_checklists" ("restaurant_id");
CREATE INDEX IF NOT EXISTS "staff_task_checklists_area_idx" ON "staff_task_checklists" ("area_id");

CREATE TABLE IF NOT EXISTS "staff_task_submissions" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "area_id" integer NOT NULL,
  "checklist_id" integer NOT NULL,
  "staff_user_id" integer NOT NULL,
  "started_at" timestamp,
  "submitted_at" timestamp DEFAULT now() NOT NULL,
  "window_start" timestamp,
  "window_end" timestamp,
  "notes" text,
  "photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "staff_task_submissions" ADD CONSTRAINT "staff_task_submissions_restaurant_id_restaurants_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "staff_task_submissions" ADD CONSTRAINT "staff_task_submissions_area_id_staff_task_areas_id_fk"
    FOREIGN KEY ("area_id") REFERENCES "staff_task_areas"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "staff_task_submissions" ADD CONSTRAINT "staff_task_submissions_checklist_id_staff_task_checklists_id_fk"
    FOREIGN KEY ("checklist_id") REFERENCES "staff_task_checklists"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "staff_task_submissions" ADD CONSTRAINT "staff_task_submissions_staff_user_id_users_id_fk"
    FOREIGN KEY ("staff_user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "staff_task_submissions_restaurant_idx" ON "staff_task_submissions" ("restaurant_id", "submitted_at");
CREATE INDEX IF NOT EXISTS "staff_task_submissions_status_idx" ON "staff_task_submissions" ("restaurant_id", "status");
CREATE INDEX IF NOT EXISTS "staff_task_submissions_staff_idx" ON "staff_task_submissions" ("staff_user_id", "submitted_at");
CREATE INDEX IF NOT EXISTS "staff_task_submissions_window_idx" ON "staff_task_submissions" ("checklist_id", "window_start");

CREATE TABLE IF NOT EXISTS "staff_task_submission_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "submission_id" integer NOT NULL,
  "item_key" text NOT NULL,
  "item_label" text NOT NULL,
  "checked" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "staff_task_submission_items" ADD CONSTRAINT "staff_task_submission_items_submission_id_staff_task_submissions_id_fk"
    FOREIGN KEY ("submission_id") REFERENCES "staff_task_submissions"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "staff_task_submission_items_submission_idx" ON "staff_task_submission_items" ("submission_id");

CREATE TABLE IF NOT EXISTS "staff_task_verifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "submission_id" integer NOT NULL,
  "restaurant_id" integer NOT NULL,
  "manager_user_id" integer NOT NULL,
  "action" text NOT NULL,
  "comment" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "staff_task_verifications" ADD CONSTRAINT "staff_task_verifications_submission_id_staff_task_submissions_id_fk"
    FOREIGN KEY ("submission_id") REFERENCES "staff_task_submissions"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "staff_task_verifications" ADD CONSTRAINT "staff_task_verifications_restaurant_id_restaurants_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "staff_task_verifications" ADD CONSTRAINT "staff_task_verifications_manager_user_id_users_id_fk"
    FOREIGN KEY ("manager_user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "staff_task_verifications_submission_idx" ON "staff_task_verifications" ("submission_id");
CREATE INDEX IF NOT EXISTS "staff_task_verifications_restaurant_idx" ON "staff_task_verifications" ("restaurant_id", "created_at");

CREATE TABLE IF NOT EXISTS "staff_task_missed_windows" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "area_id" integer NOT NULL,
  "checklist_id" integer NOT NULL,
  "window_start" timestamp NOT NULL,
  "window_end" timestamp NOT NULL,
  "notified_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "staff_task_missed_windows" ADD CONSTRAINT "staff_task_missed_windows_restaurant_id_restaurants_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "staff_task_missed_windows" ADD CONSTRAINT "staff_task_missed_windows_area_id_staff_task_areas_id_fk"
    FOREIGN KEY ("area_id") REFERENCES "staff_task_areas"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "staff_task_missed_windows" ADD CONSTRAINT "staff_task_missed_windows_checklist_id_staff_task_checklists_id_fk"
    FOREIGN KEY ("checklist_id") REFERENCES "staff_task_checklists"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "staff_task_missed_windows_uniq_idx" ON "staff_task_missed_windows" ("checklist_id", "window_start");
CREATE INDEX IF NOT EXISTS "staff_task_missed_windows_restaurant_idx" ON "staff_task_missed_windows" ("restaurant_id", "window_start");
