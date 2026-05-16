CREATE TABLE "ai_chat_conversations" (
"id" serial PRIMARY KEY NOT NULL,
"tenant_id" integer NOT NULL,
"restaurant_id" integer,
"user_id" integer NOT NULL,
"title" text DEFAULT 'New conversation' NOT NULL,
"created_at" timestamp DEFAULT now() NOT NULL,
"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat_messages" (
"id" serial PRIMARY KEY NOT NULL,
"conversation_id" integer NOT NULL,
"role" text NOT NULL,
"content" text NOT NULL,
"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
"tokens_in" integer DEFAULT 0 NOT NULL,
"tokens_out" integer DEFAULT 0 NOT NULL,
"credits_charged" integer DEFAULT 0 NOT NULL,
"request_log_id" integer,
"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_chat_conversations" ADD CONSTRAINT "ai_chat_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_conversations" ADD CONSTRAINT "ai_chat_conversations_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_conversations" ADD CONSTRAINT "ai_chat_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_conversation_id_ai_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_chat_conversations_user_idx" ON "ai_chat_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_chat_conversations_tenant_idx" ON "ai_chat_conversations" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_chat_messages_convo_idx" ON "ai_chat_messages" USING btree ("conversation_id","created_at");
