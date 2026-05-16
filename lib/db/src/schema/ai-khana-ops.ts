import { pgTable, serial, integer, text, timestamp, jsonb, decimal, index } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";
import { menuItemsTable } from "./menu";
import { purchaseOrdersTable } from "./inventory";

export const aiInventorySuggestionsTable = pgTable(
  "ai_inventory_suggestions",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    inputsHash: text("inputs_hash").notNull(),
    payload: jsonb("payload").notNull(),
    confidence: decimal("confidence", { precision: 5, scale: 2 }),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id, { onDelete: "set null" }),
    requestLogId: integer("request_log_id"),
    generatedBy: integer("generated_by").references(() => usersTable.id),
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_inventory_suggestions_rest_idx").on(t.restaurantId, t.status, t.generatedAt),
  ],
);

export const aiForecastsTable = pgTable(
  "ai_forecasts",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    horizonDays: integer("horizon_days").notNull().default(7),
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
    index("ai_forecasts_rest_idx").on(t.restaurantId, t.status, t.generatedAt),
  ],
);

export const aiRecipeCostSnapshotsTable = pgTable(
  "ai_recipe_cost_snapshots",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id, { onDelete: "cascade" }),
    inputsHash: text("inputs_hash").notNull(),
    currentCogs: decimal("current_cogs", { precision: 10, scale: 2 }),
    currentPrice: decimal("current_price", { precision: 10, scale: 2 }),
    suggestedPrice: decimal("suggested_price", { precision: 10, scale: 2 }),
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
    index("ai_recipe_cost_snapshots_item_idx").on(t.menuItemId, t.status, t.generatedAt),
    index("ai_recipe_cost_snapshots_rest_idx").on(t.restaurantId, t.status, t.generatedAt),
  ],
);

export type AiInventorySuggestion = typeof aiInventorySuggestionsTable.$inferSelect;
export type AiForecast = typeof aiForecastsTable.$inferSelect;
export type AiRecipeCostSnapshot = typeof aiRecipeCostSnapshotsTable.$inferSelect;
