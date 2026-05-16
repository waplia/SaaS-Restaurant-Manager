import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const aiChatConversationsTable = pgTable("ai_chat_conversations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New conversation"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  userIdx: index("ai_chat_conversations_user_idx").on(t.userId, t.updatedAt),
  tenantIdx: index("ai_chat_conversations_tenant_idx").on(t.tenantId, t.updatedAt),
}));

export const aiChatMessagesTable = pgTable("ai_chat_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => aiChatConversationsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant | tool
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls").$type<Array<{ name: string; args: Record<string, unknown>; result?: unknown }>>().notNull().default([]),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  creditsCharged: integer("credits_charged").notNull().default(0),
  requestLogId: integer("request_log_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  convoIdx: index("ai_chat_messages_convo_idx").on(t.conversationId, t.createdAt),
}));

export type AiChatConversation = typeof aiChatConversationsTable.$inferSelect;
export type AiChatMessage = typeof aiChatMessagesTable.$inferSelect;
