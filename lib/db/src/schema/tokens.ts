import { pgTable, text, serial, timestamp, integer, date, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable, branchesTable } from "./restaurants";
import { ordersTable } from "./orders";

export const orderTokensTable = pgTable("order_tokens", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  branchId: integer("branch_id").references(() => branchesTable.id),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  token: text("token").notNull(),
  number: integer("number").notNull(),
  counter: integer("counter").notNull().default(1),
  status: text("status").notNull().default("waiting"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  orderType: text("order_type").notNull().default("dine_in"),
  scopeDate: date("scope_date").notNull(),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  readyAt: timestamp("ready_at"),
  servedAt: timestamp("served_at"),
  recalledAt: timestamp("recalled_at"),
  recalledCount: integer("recalled_count").notNull().default(0),
  cancelledAt: timestamp("cancelled_at"),
  notifiedReadyAt: timestamp("notified_ready_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRestaurantDate: index("order_tokens_restaurant_date_idx").on(t.restaurantId, t.scopeDate),
  byBranchDate: index("order_tokens_branch_date_idx").on(t.branchId, t.scopeDate),
  byOrder: uniqueIndex("order_tokens_order_uq").on(t.orderId),
  byStatus: index("order_tokens_status_idx").on(t.restaurantId, t.status),
}));

export const insertOrderTokenSchema = createInsertSchema(orderTokensTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrderToken = z.infer<typeof insertOrderTokenSchema>;
export type OrderToken = typeof orderTokensTable.$inferSelect;
