CREATE TABLE "ai_credit_recharges" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"package_id" integer NOT NULL,
	"provider" text NOT NULL,
	"external_ref" text,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"credits_granted" integer DEFAULT 0 NOT NULL,
	"bonus_granted" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"transaction_id" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_feature_credit_rules" ADD COLUMN "feature_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_feature_credit_rules" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "ai_feature_credit_rules" ADD COLUMN "unit_type" text DEFAULT 'request' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_recharge_packages" ADD COLUMN "is_featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_credit_recharges" ADD CONSTRAINT "ai_credit_recharges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_recharges" ADD CONSTRAINT "ai_credit_recharges_package_id_ai_recharge_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."ai_recharge_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_recharges" ADD CONSTRAINT "ai_credit_recharges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_credit_recharges_tenant_idx" ON "ai_credit_recharges" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_recharges_external_ref_idx" ON "ai_credit_recharges" USING btree ("provider","external_ref");