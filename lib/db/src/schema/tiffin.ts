import { pgTable, text, serial, timestamp, integer, boolean, decimal, date, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { customersTable } from "./customers";
import { usersTable } from "./users";

export const tiffinPlansTable = pgTable("tiffin_plans", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  mealType: text("meal_type").notNull().default("lunch"),
  cuisine: text("cuisine").notNull().default("veg"),
  pricePerMeal: decimal("price_per_meal", { precision: 10, scale: 2 }).notNull(),
  monthlyPrice: decimal("monthly_price", { precision: 10, scale: 2 }).notNull(),
  trialAvailable: boolean("trial_available").notNull().default(false),
  trialPrice: decimal("trial_price", { precision: 10, scale: 2 }),
  daysOfWeek: text("days_of_week").notNull().default("1,2,3,4,5,6"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const tiffinSubscriptionsTable = pgTable("tiffin_subscriptions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  planId: integer("plan_id").notNull().references(() => tiffinPlansTable.id),
  status: text("status").notNull().default("active"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  pausedFrom: date("paused_from"),
  pausedTo: date("paused_to"),
  deliveryAddress: text("delivery_address").notNull(),
  routeId: integer("route_id"),
  routeStop: integer("route_stop"),
  preferredSlot: text("preferred_slot").notNull().default("lunch"),
  mealsPerDay: integer("meals_per_day").notNull().default(1),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const tiffinFamilyMembersTable = pgTable("tiffin_family_members", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  subscriptionId: integer("subscription_id").notNull().references(() => tiffinSubscriptionsTable.id),
  name: text("name").notNull(),
  relation: text("relation"),
  mealsPerDay: integer("meals_per_day").notNull().default(1),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tiffinRoutesTable = pgTable("tiffin_routes", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  riderId: integer("rider_id").references(() => usersTable.id),
  slot: text("slot").notNull().default("lunch"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tiffinDeliveriesTable = pgTable("tiffin_deliveries", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  subscriptionId: integer("subscription_id").notNull().references(() => tiffinSubscriptionsTable.id),
  routeId: integer("route_id").references(() => tiffinRoutesTable.id),
  riderId: integer("rider_id").references(() => usersTable.id),
  deliveryDate: date("delivery_date").notNull(),
  slot: text("slot").notNull().default("lunch"),
  status: text("status").notNull().default("scheduled"),
  mealsCount: integer("meals_count").notNull().default(1),
  skippedReason: text("skipped_reason"),
  attendanceMarkedAt: timestamp("attendance_marked_at"),
  attendanceMarkedBy: integer("attendance_marked_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("tiffin_deliveries_sub_date_slot").on(t.subscriptionId, t.deliveryDate, t.slot),
}));

export const tiffinInvoicesTable = pgTable("tiffin_invoices", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  subscriptionId: integer("subscription_id").notNull().references(() => tiffinSubscriptionsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  invoiceNumber: text("invoice_number").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  mealsDelivered: integer("meals_delivered").notNull().default(0),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  discount: decimal("discount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull().default("0.00"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  amountPaid: decimal("amount_paid", { precision: 10, scale: 2 }).notNull().default("0.00"),
  status: text("status").notNull().default("pending"),
  dueDate: date("due_date").notNull(),
  paidAt: timestamp("paid_at"),
  paymentMethod: text("payment_method"),
  reminderT3SentAt: timestamp("reminder_t3_sent_at"),
  reminderT0SentAt: timestamp("reminder_t0_sent_at"),
  reminderT2SentAt: timestamp("reminder_t2_sent_at"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTiffinPlanSchema = createInsertSchema(tiffinPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTiffinPlan = z.infer<typeof insertTiffinPlanSchema>;
export type TiffinPlan = typeof tiffinPlansTable.$inferSelect;

export const insertTiffinSubscriptionSchema = createInsertSchema(tiffinSubscriptionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTiffinSubscription = z.infer<typeof insertTiffinSubscriptionSchema>;
export type TiffinSubscription = typeof tiffinSubscriptionsTable.$inferSelect;

export const insertTiffinFamilyMemberSchema = createInsertSchema(tiffinFamilyMembersTable).omit({ id: true, createdAt: true });
export type InsertTiffinFamilyMember = z.infer<typeof insertTiffinFamilyMemberSchema>;
export type TiffinFamilyMember = typeof tiffinFamilyMembersTable.$inferSelect;

export const insertTiffinRouteSchema = createInsertSchema(tiffinRoutesTable).omit({ id: true, createdAt: true });
export type InsertTiffinRoute = z.infer<typeof insertTiffinRouteSchema>;
export type TiffinRoute = typeof tiffinRoutesTable.$inferSelect;

export const insertTiffinDeliverySchema = createInsertSchema(tiffinDeliveriesTable).omit({ id: true, createdAt: true });
export type InsertTiffinDelivery = z.infer<typeof insertTiffinDeliverySchema>;
export type TiffinDelivery = typeof tiffinDeliveriesTable.$inferSelect;

export const insertTiffinInvoiceSchema = createInsertSchema(tiffinInvoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTiffinInvoice = z.infer<typeof insertTiffinInvoiceSchema>;
export type TiffinInvoice = typeof tiffinInvoicesTable.$inferSelect;
