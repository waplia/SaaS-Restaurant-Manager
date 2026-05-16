import { pgTable, serial, integer, text, timestamp, decimal, jsonb, index } from "drizzle-orm/pg-core";
import { restaurantsTable, branchesTable } from "./restaurants";
import { tenantsTable } from "./tenants";

export const restaurantHealthScoresTable = pgTable(
  "restaurant_health_scores",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    snapshotDate: timestamp("snapshot_date").notNull(),
    overallScore: decimal("overall_score", { precision: 5, scale: 2 }).notNull(),
    band: text("band").notNull(),
    subScores: jsonb("sub_scores").$type<Record<string, number | null>>().notNull().default({}),
    weights: jsonb("weights").$type<Record<string, number>>().notNull().default({}),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
    suggestions: jsonb("suggestions").$type<Array<{ key: string; title: string; detail: string }>>().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("rhs_restaurant_date_idx").on(t.restaurantId, t.snapshotDate),
    index("rhs_tenant_date_idx").on(t.tenantId, t.snapshotDate),
    index("rhs_branch_date_idx").on(t.branchId, t.snapshotDate),
  ],
);

export type RestaurantHealthScore = typeof restaurantHealthScoresTable.$inferSelect;
export type InsertRestaurantHealthScore = typeof restaurantHealthScoresTable.$inferInsert;
