import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { floorTablesTable } from "./tables";
import { usersTable } from "./users";

export const waiterRequestsTable = pgTable("waiter_requests", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  tableId: integer("table_id").notNull().references(() => floorTablesTable.id),
  type: text("type").notNull(),
  note: text("note"),
  status: text("status").notNull().default("pending"),
  acknowledgedByUserId: integer("acknowledged_by_user_id").references(() => usersTable.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedByUserId: integer("resolved_by_user_id").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  restaurantStatusIdx: index("waiter_requests_restaurant_status_idx").on(t.restaurantId, t.status),
  restaurantCreatedIdx: index("waiter_requests_restaurant_created_idx").on(t.restaurantId, t.createdAt),
}));

export const insertWaiterRequestSchema = createInsertSchema(waiterRequestsTable).omit({
  id: true, createdAt: true, updatedAt: true, acknowledgedByUserId: true, acknowledgedAt: true, resolvedByUserId: true, resolvedAt: true,
});
export type InsertWaiterRequest = z.infer<typeof insertWaiterRequestSchema>;
export type WaiterRequest = typeof waiterRequestsTable.$inferSelect;
