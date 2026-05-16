import {
  pgTable, serial, integer, text, timestamp, jsonb, decimal, date, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const aiSalesInsightsTable = pgTable(
  "ai_sales_insights",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    category: text("category").notNull(),
    title: text("title").notNull(),
    explanation: text("explanation").notNull(),
    suggestedAction: text("suggested_action"),
    impact: text("impact").notNull().default("medium"),
    targetModule: text("target_module"),
    targetId: integer("target_id"),
    targetUrl: text("target_url"),
    supportingMetrics: jsonb("supporting_metrics").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("active"),
    confidence: decimal("confidence", { precision: 5, scale: 2 }),
    notes: text("notes"),
    requestLogId: integer("request_log_id"),
    generatedBy: integer("generated_by").references(() => usersTable.id, { onDelete: "set null" }),
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_sales_insights_rest_status_idx").on(t.restaurantId, t.status, t.generatedAt),
    index("ai_sales_insights_category_idx").on(t.restaurantId, t.category, t.generatedAt),
  ],
);

export const aiInsightDailyAllowanceTable = pgTable(
  "ai_insight_daily_allowance",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    day: date("day").notNull(),
    used: integer("used").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ai_insight_daily_allowance_uniq").on(t.tenantId, t.restaurantId, t.day),
  ],
);

export type AiSalesInsight = typeof aiSalesInsightsTable.$inferSelect;
export type AiInsightDailyAllowance = typeof aiInsightDailyAllowanceTable.$inferSelect;
