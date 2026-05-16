ALTER TABLE "customer_feedback" ADD COLUMN "selected_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_feedback" ADD COLUMN "ai_draft_text" text;--> statement-breakpoint
ALTER TABLE "customer_feedback" ADD COLUMN "ai_draft_request_log_id" integer;--> statement-breakpoint
ALTER TABLE "customer_feedback" ADD COLUMN "copied_draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_feedback" ADD COLUMN "google_redirected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_qrs" ADD COLUMN "ai_assist_enabled" boolean DEFAULT true NOT NULL;