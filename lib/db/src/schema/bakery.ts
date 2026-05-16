import { pgTable, text, serial, timestamp, integer, boolean, decimal, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { menuItemsTable } from "./menu";
import { usersTable } from "./users";
import { kitchensTable } from "./kitchens";
import { customersTable } from "./customers";

export const PRODUCTION_PLAN_STATUSES = ["draft", "active", "completed", "cancelled"] as const;
export const PRODUCTION_PLAN_ITEM_STATUSES = ["planned", "in_progress", "done", "skipped"] as const;
export const FINISHED_BATCH_STATUSES = ["active", "depleted", "expired", "wasted"] as const;
export const WASTAGE_REASONS = ["expired", "damaged", "unsold", "sample", "other"] as const;
export const CAKE_BOOKING_STATUSES = ["new", "confirmed", "in_production", "ready", "delivered", "cancelled"] as const;

export const productionPlansTable = pgTable(
  "production_plans",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    planDate: timestamp("plan_date").notNull(),
    status: text("status").$type<typeof PRODUCTION_PLAN_STATUSES[number]>().notNull().default("draft"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("production_plans_rest_date_idx").on(t.restaurantId, t.planDate)],
);

export const productionPlanItemsTable = pgTable(
  "production_plan_items",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id),
    plannedQuantity: decimal("planned_quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
    producedQuantity: decimal("produced_quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
    status: text("status").$type<typeof PRODUCTION_PLAN_ITEM_STATUSES[number]>().notNull().default("planned"),
    assignedTo: integer("assigned_to").references(() => usersTable.id),
    kitchenId: integer("kitchen_id").references(() => kitchensTable.id),
    notes: text("notes"),
    bookingId: integer("booking_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("production_plan_items_plan_idx").on(t.planId)],
);

export const finishedGoodsBatchesTable = pgTable(
  "finished_goods_batches",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id),
    planItemId: integer("plan_item_id").references(() => productionPlanItemsTable.id, { onDelete: "set null" }),
    batchNumber: text("batch_number").notNull(),
    quantityProduced: decimal("quantity_produced", { precision: 10, scale: 3 }).notNull().default("0.000"),
    quantityRemaining: decimal("quantity_remaining", { precision: 10, scale: 3 }).notNull().default("0.000"),
    unitCost: decimal("unit_cost", { precision: 10, scale: 2 }).notNull().default("0.00"),
    producedAt: timestamp("produced_at").notNull().defaultNow(),
    expiryAt: timestamp("expiry_at"),
    storageLocation: text("storage_location"),
    status: text("status").$type<typeof FINISHED_BATCH_STATUSES[number]>().notNull().default("active"),
    producedBy: integer("produced_by").references(() => usersTable.id),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("finished_batches_item_expiry_idx").on(t.menuItemId, t.expiryAt),
    index("finished_batches_rest_status_idx").on(t.restaurantId, t.status),
  ],
);

export const finishedGoodsWastageTable = pgTable(
  "finished_goods_wastage",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    batchId: integer("batch_id").notNull().references(() => finishedGoodsBatchesTable.id, { onDelete: "cascade" }),
    menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id),
    quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
    reason: text("reason").$type<typeof WASTAGE_REASONS[number]>().notNull().default("expired"),
    notes: text("notes"),
    recordedBy: integer("recorded_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("finished_wastage_rest_idx").on(t.restaurantId, t.createdAt)],
);

export const cakeBookingsTable = pgTable(
  "cake_bookings",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    bookingNumber: text("booking_number").notNull(),
    customerId: integer("customer_id").references(() => customersTable.id),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    customerEmail: text("customer_email"),
    menuItemId: integer("menu_item_id").references(() => menuItemsTable.id),
    cakeName: text("cake_name").notNull(),
    sizeLabel: text("size_label"),
    flavor: text("flavor"),
    quantity: integer("quantity").notNull().default(1),
    designNotes: text("design_notes"),
    referenceImageUrl: text("reference_image_url"),
    deliveryAt: timestamp("delivery_at").notNull(),
    deliveryAddress: text("delivery_address"),
    isPickup: boolean("is_pickup").notNull().default(true),
    totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
    advanceAmount: decimal("advance_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
    paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
    advanceMethod: text("advance_method"),
    advanceReference: text("advance_reference"),
    status: text("status").$type<typeof CAKE_BOOKING_STATUSES[number]>().notNull().default("new"),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("cake_bookings_rest_delivery_idx").on(t.restaurantId, t.deliveryAt),
    index("cake_bookings_rest_status_idx").on(t.restaurantId, t.status),
  ],
);

export const insertProductionPlanSchema = createInsertSchema(productionPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type ProductionPlan = typeof productionPlansTable.$inferSelect;
export type InsertProductionPlan = z.infer<typeof insertProductionPlanSchema>;

export const insertProductionPlanItemSchema = createInsertSchema(productionPlanItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type ProductionPlanItem = typeof productionPlanItemsTable.$inferSelect;
export type InsertProductionPlanItem = z.infer<typeof insertProductionPlanItemSchema>;

export const insertFinishedGoodsBatchSchema = createInsertSchema(finishedGoodsBatchesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type FinishedGoodsBatch = typeof finishedGoodsBatchesTable.$inferSelect;
export type InsertFinishedGoodsBatch = z.infer<typeof insertFinishedGoodsBatchSchema>;

export const insertFinishedGoodsWastageSchema = createInsertSchema(finishedGoodsWastageTable).omit({ id: true, createdAt: true });
export type FinishedGoodsWastage = typeof finishedGoodsWastageTable.$inferSelect;
export type InsertFinishedGoodsWastage = z.infer<typeof insertFinishedGoodsWastageSchema>;

export const insertCakeBookingSchema = createInsertSchema(cakeBookingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type CakeBooking = typeof cakeBookingsTable.$inferSelect;
export type InsertCakeBooking = z.infer<typeof insertCakeBookingSchema>;
