import { pgTable, serial, integer, text, timestamp, jsonb, decimal, boolean, index } from "drizzle-orm/pg-core";
import { restaurantsTable, branchesTable } from "./restaurants";
import { usersTable } from "./users";
import { ordersTable } from "./orders";
import { menuItemsTable } from "./menu";

export const aiUpsellRulesTable = pgTable(
  "ai_upsell_rules",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    branchId: integer("branch_id").references(() => branchesTable.id),
    name: text("name").notNull(),
    channel: text("channel").notNull().default("both"),
    priority: integer("priority").notNull().default(50),
    isEnabled: boolean("is_enabled").notNull().default(true),
    triggerType: text("trigger_type").notNull(),
    triggerConfig: jsonb("trigger_config").notNull().default({}),
    suggestedItemIds: jsonb("suggested_item_ids").notNull().default([]),
    message: text("message"),
    source: text("source").notNull().default("manual"),
    suggestionId: integer("suggestion_id"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_upsell_rules_rest_idx").on(t.restaurantId, t.isEnabled, t.priority),
    index("ai_upsell_rules_branch_idx").on(t.branchId),
  ],
);

export const aiUpsellSuggestionsTable = pgTable(
  "ai_upsell_suggestions",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    inputsHash: text("inputs_hash").notNull(),
    payload: jsonb("payload").notNull(),
    confidence: decimal("confidence", { precision: 5, scale: 2 }),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    requestLogId: integer("request_log_id"),
    generatedBy: integer("generated_by").references(() => usersTable.id),
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_upsell_suggestions_rest_idx").on(t.restaurantId, t.status, t.generatedAt),
  ],
);

export const aiUpsellEventsTable = pgTable(
  "ai_upsell_events",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    ruleId: integer("rule_id").references(() => aiUpsellRulesTable.id, { onDelete: "set null" }),
    orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
    menuItemId: integer("menu_item_id").references(() => menuItemsTable.id, { onDelete: "set null" }),
    channel: text("channel").notNull(),
    eventType: text("event_type").notNull(),
    revenue: decimal("revenue", { precision: 10, scale: 2 }).notNull().default("0"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_upsell_events_rest_idx").on(t.restaurantId, t.eventType, t.createdAt),
    index("ai_upsell_events_rule_idx").on(t.ruleId, t.eventType),
  ],
);

export type AiUpsellRule = typeof aiUpsellRulesTable.$inferSelect;
export type AiUpsellSuggestion = typeof aiUpsellSuggestionsTable.$inferSelect;
export type AiUpsellEvent = typeof aiUpsellEventsTable.$inferSelect;
