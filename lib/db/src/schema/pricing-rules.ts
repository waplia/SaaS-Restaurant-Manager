import { pgTable, serial, integer, text, decimal, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable, branchesTable } from "./restaurants";
import { menuItemsTable, menuCategoriesTable } from "./menu";
import { orderItemsTable } from "./orders";
import { usersTable } from "./users";

// Dynamic pricing rules. A single table covers happy hour, lunch special,
// weekend, delivery-only (channel), outlet-specific, customer group and
// event/date-range — they're all configurations of the same engine.
//
// Scope semantics:
//   scopeKind = 'all' | 'category' | 'item'
//   scopeIds  = [] for 'all', list of categoryIds or menuItemIds otherwise
//
// Adjustment semantics:
//   adjustmentKind = 'percent_off' | 'percent_up' | 'flat_off' | 'fixed_price'
//   adjustmentValue carries the magnitude (percent 0-100, or rupee amount)
//
// Targeting:
//   channels       = empty array means "any channel"; else subset of
//                    ['dine_in','takeaway','delivery']
//   branchIds      = empty array means "any outlet"; else list of branch ids
//   customerGroups = empty array means "any customer"; else subset of
//                    ['guest','regular','vip','loyalty_silver',
//                     'loyalty_gold','loyalty_platinum']
//   daysOfWeek     = empty array means "any day"; else subset of [0..6]
//                    (0 = Sunday, in restaurant timezone)
//   startTime/endTime: HH:MM strings (restaurant timezone). When endTime <
//                    startTime the window crosses midnight.
//   startDate/endDate: optional inclusive calendar bounds.
export const pricingRulesTable = pgTable(
  "pricing_rules",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ruleType: text("rule_type").notNull(), // happy_hour | lunch_special | weekend | delivery_only | outlet | customer_group | event | time_of_day | day_of_week | custom
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    priority: integer("priority").notNull().default(100),

    scopeKind: text("scope_kind").notNull().default("all"), // all | category | item
    scopeIds: jsonb("scope_ids").$type<number[]>().notNull().default([]),

    adjustmentKind: text("adjustment_kind").notNull(), // percent_off | percent_up | flat_off | fixed_price
    adjustmentValue: decimal("adjustment_value", { precision: 10, scale: 2 }).notNull().default("0.00"),

    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    daysOfWeek: jsonb("days_of_week").$type<number[]>().notNull().default([]),
    startTime: text("start_time"), // "HH:MM"
    endTime: text("end_time"),

    channels: jsonb("channels").$type<string[]>().notNull().default([]),
    branchIds: jsonb("branch_ids").$type<number[]>().notNull().default([]),
    customerGroups: jsonb("customer_groups").$type<string[]>().notNull().default([]),

    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("pricing_rules_restaurant_idx").on(t.restaurantId, t.isActive),
  ],
);

// Records which rule produced the unit price on a given order item.
// Persisted so receipts and reports can show "Happy Hour −20%" next to the
// affected line, and so historical orders aren't rewritten when a rule is
// later edited.
export const pricingRuleApplicationsTable = pgTable(
  "pricing_rule_applications",
  {
    id: serial("id").primaryKey(),
    orderItemId: integer("order_item_id").notNull().references(() => orderItemsTable.id, { onDelete: "cascade" }),
    pricingRuleId: integer("pricing_rule_id").references(() => pricingRulesTable.id, { onDelete: "set null" }),
    ruleName: text("rule_name").notNull(),
    ruleType: text("rule_type").notNull(),
    originalUnitPrice: decimal("original_unit_price", { precision: 10, scale: 2 }).notNull(),
    adjustedUnitPrice: decimal("adjusted_unit_price", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("pricing_rule_applications_order_item_idx").on(t.orderItemId),
    index("pricing_rule_applications_rule_idx").on(t.pricingRuleId),
  ],
);

// Reference branchesTable (declared in restaurants.ts) to silence unused
// import warnings when consumers do not pull it directly.
export const _pricingRulesUsesBranches = branchesTable;
export const _pricingRulesUsesCategories = menuCategoriesTable;
export const _pricingRulesUsesMenuItems = menuItemsTable;

export const insertPricingRuleSchema = createInsertSchema(pricingRulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPricingRule = z.infer<typeof insertPricingRuleSchema>;
export type PricingRule = typeof pricingRulesTable.$inferSelect;

export const insertPricingRuleApplicationSchema = createInsertSchema(pricingRuleApplicationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPricingRuleApplication = z.infer<typeof insertPricingRuleApplicationSchema>;
export type PricingRuleApplication = typeof pricingRuleApplicationsTable.$inferSelect;
