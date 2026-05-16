CREATE TABLE "ai_credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"type" text NOT NULL,
	"feature_slug" text,
	"credits" integer NOT NULL,
	"bucket" text,
	"balance_after" integer DEFAULT 0 NOT NULL,
	"reference_type" text,
	"reference_id" integer,
	"request_log_id" integer,
	"payment_id" integer,
	"recharge_package_id" integer,
	"created_by" integer,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_credit_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"monthly_included_credits" integer DEFAULT 0 NOT NULL,
	"purchased_credits" integer DEFAULT 0 NOT NULL,
	"bonus_credits" integer DEFAULT 0 NOT NULL,
	"reserved_credits" integer DEFAULT 0 NOT NULL,
	"used_credits" integer DEFAULT 0 NOT NULL,
	"purchased_expires_at" timestamp,
	"monthly_reset_at" timestamp,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"beta_features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_feature_credit_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"feature_slug" text NOT NULL,
	"scope_type" text DEFAULT 'global' NOT NULL,
	"scope_id" integer,
	"pricing_mode" text DEFAULT 'fixed' NOT NULL,
	"credits_per_unit" numeric(12, 4) DEFAULT '1' NOT NULL,
	"min_charge" integer DEFAULT 1 NOT NULL,
	"max_per_request" integer,
	"free_monthly_quota" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_monthly_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"plan_id" integer,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"credits_allocated" integer NOT NULL,
	"transaction_id" integer,
	"allocated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_recharge_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"credits" integer NOT NULL,
	"bonus_credits" integer DEFAULT 0 NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"validity_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"show_to_restaurants" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "ai_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "ai_monthly_included_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "ai_daily_request_cap" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "ai_per_feature_monthly_caps" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "ai_feature_toggles" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_wallet_id_ai_credit_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."ai_credit_wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_wallets" ADD CONSTRAINT "ai_credit_wallets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feature_credit_rules" ADD CONSTRAINT "ai_feature_credit_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_monthly_allocations" ADD CONSTRAINT "ai_monthly_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_monthly_allocations" ADD CONSTRAINT "ai_monthly_allocations_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recharge_packages" ADD CONSTRAINT "ai_recharge_packages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_credit_transactions_wallet_idx" ON "ai_credit_transactions" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_credit_transactions_tenant_idx" ON "ai_credit_transactions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_credit_transactions_feature_idx" ON "ai_credit_transactions" USING btree ("feature_slug","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_wallets_tenant_idx" ON "ai_credit_wallets" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_feature_credit_rules_scope_idx" ON "ai_feature_credit_rules" USING btree ("feature_slug","scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_monthly_allocations_tenant_period_idx" ON "ai_monthly_allocations" USING btree ("tenant_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_recharge_packages_slug_idx" ON "ai_recharge_packages" USING btree ("slug");