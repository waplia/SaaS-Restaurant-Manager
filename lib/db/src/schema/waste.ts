import { pgTable, text, serial, timestamp, integer, boolean, decimal, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";
import { inventoryItemsTable, inventoryTransactionsTable } from "./inventory";

export const wasteReasonsTable = pgTable("waste_reasons", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  label: text("label").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("waste_reasons_rest_idx").on(t.restaurantId, t.sortOrder),
}));

export const wasteSettingsTable = pgTable("waste_settings", {
  restaurantId: integer("restaurant_id").primaryKey().references(() => restaurantsTable.id),
  approvalThreshold: decimal("approval_threshold", { precision: 12, scale: 2 }).notNull().default("0.00"),
  autoApproveBelowThreshold: boolean("auto_approve_below_threshold").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const wasteEntriesTable = pgTable("waste_entries", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id),
  quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  // wastage | spoilage | expired | overproduction | leftover
  wasteType: text("waste_type").notNull().default("wastage"),
  reasonId: integer("reason_id").references(() => wasteReasonsTable.id),
  reasonText: text("reason_text"),
  station: text("station"),
  // pending | approved | rejected | donated
  status: text("status").notNull().default("pending"),
  recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id),
  approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id),
  approvedAt: timestamp("approved_at"),
  rejectionNote: text("rejection_note"),
  costAtEntry: decimal("cost_at_entry", { precision: 10, scale: 2 }).notNull().default("0.00"),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull().default("0.00"),
  donationRecipient: text("donation_recipient"),
  donationPickupAt: timestamp("donation_pickup_at"),
  donationNote: text("donation_note"),
  photoUrl: text("photo_url"),
  note: text("note"),
  inventoryTransactionId: integer("inventory_transaction_id").references(() => inventoryTransactionsTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRestStatus: index("waste_entries_rest_status_idx").on(t.restaurantId, t.status, t.createdAt),
  byRestCreated: index("waste_entries_rest_created_idx").on(t.restaurantId, t.createdAt),
  byItem: index("waste_entries_item_idx").on(t.inventoryItemId),
}));

export const insertWasteReasonSchema = createInsertSchema(wasteReasonsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWasteReason = z.infer<typeof insertWasteReasonSchema>;
export type WasteReason = typeof wasteReasonsTable.$inferSelect;

export const insertWasteEntrySchema = createInsertSchema(wasteEntriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWasteEntry = z.infer<typeof insertWasteEntrySchema>;
export type WasteEntry = typeof wasteEntriesTable.$inferSelect;

export type WasteSettings = typeof wasteSettingsTable.$inferSelect;
