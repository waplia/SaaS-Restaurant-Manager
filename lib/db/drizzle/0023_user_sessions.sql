CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "jti" text NOT NULL,
  "device_label" text,
  "ip" text,
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp,
  CONSTRAINT "user_sessions_jti_unique" UNIQUE("jti")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_sessions_user_idx" ON "user_sessions" ("user_id");
