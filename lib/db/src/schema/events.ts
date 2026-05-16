import { pgTable, text, serial, timestamp, integer, decimal, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";
import { customersTable } from "./customers";
import { staffTable } from "./staff";
import { paymentsTable } from "./payments";
import { ordersTable } from "./orders";

/**
 * Event / Banquet / Catering bookings.
 *
 * status lifecycle: quote → confirmed → in_progress → completed (with cancelled
 * as terminal at any point). "convert quote → invoice" is implemented as a
 * status transition quote→confirmed that locks totals and stamps `invoicedAt`.
 * An optional `invoiceOrderId` links to a row in `orders` for downstream
 * payment / reporting integration.
 */
export const eventBookingsTable = pgTable("event_bookings", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  bookingNumber: text("booking_number").notNull(),
  type: text("type").notNull().default("event"), // event | banquet | catering
  title: text("title").notNull(),
  customerId: integer("customer_id").references(() => customersTable.id),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  eventDate: timestamp("event_date").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(180),
  venue: text("venue"),
  guestCount: integer("guest_count").notNull().default(0),
  packageDetails: text("package_details"),
  notes: text("notes"),
  status: text("status").notNull().default("quote"), // quote|confirmed|in_progress|completed|cancelled
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull().default("0.00"),
  taxAmount: decimal("tax_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  discountAmount: decimal("discount_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  invoicedAt: timestamp("invoiced_at"),
  invoiceOrderId: integer("invoice_order_id").references(() => ordersTable.id),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("event_bookings_restaurant_id_idx").on(t.restaurantId),
  index("event_bookings_event_date_idx").on(t.eventDate),
  index("event_bookings_status_idx").on(t.status),
]);

export const eventBookingItemsTable = pgTable("event_booking_items", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => eventBookingsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("package"), // package | addon | service
  name: text("name").notNull(),
  description: text("description"),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull().default("0.00"),
  lineTotal: decimal("line_total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("event_booking_items_booking_id_idx").on(t.bookingId)]);

export const eventPaymentScheduleTable = pgTable("event_payment_schedule", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => eventBookingsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull().default("Milestone"),
  dueDate: timestamp("due_date").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"), // pending | paid | overdue
  paidAt: timestamp("paid_at"),
  paymentId: integer("payment_id").references(() => paymentsTable.id),
  remindersSentAt: timestamp("reminders_sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("event_payment_schedule_booking_id_idx").on(t.bookingId),
  index("event_payment_schedule_due_date_idx").on(t.dueDate),
]);

export const eventStaffAssignmentsTable = pgTable("event_staff_assignments", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => eventBookingsTable.id, { onDelete: "cascade" }),
  staffId: integer("staff_id").references(() => staffTable.id),
  staffName: text("staff_name").notNull(),
  role: text("role").notNull().default("server"), // server | chef | manager | host | bartender | other
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("event_staff_assignments_booking_id_idx").on(t.bookingId)]);

export const eventVendorRequirementsTable = pgTable("event_vendor_requirements", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => eventBookingsTable.id, { onDelete: "cascade" }),
  category: text("category").notNull().default("other"), // decor | flowers | av | photography | dj | rentals | other
  vendorName: text("vendor_name").notNull(),
  contactInfo: text("contact_info"),
  cost: decimal("cost", { precision: 12, scale: 2 }).default("0.00"),
  notes: text("notes"),
  status: text("status").notNull().default("pending"), // pending | confirmed | cancelled
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("event_vendor_requirements_booking_id_idx").on(t.bookingId)]);

export const eventChecklistItemsTable = pgTable("event_checklist_items", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => eventBookingsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  notes: text("notes"),
  completedAt: timestamp("completed_at"),
  completedBy: integer("completed_by").references(() => usersTable.id),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("event_checklist_items_booking_id_idx").on(t.bookingId)]);

export const eventStatusHistoryTable = pgTable("event_status_history", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => eventBookingsTable.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  changedBy: integer("changed_by").references(() => usersTable.id),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("event_status_history_booking_id_idx").on(t.bookingId)]);

export const insertEventBookingSchema = createInsertSchema(eventBookingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEventBooking = z.infer<typeof insertEventBookingSchema>;
export type EventBooking = typeof eventBookingsTable.$inferSelect;

export const insertEventBookingItemSchema = createInsertSchema(eventBookingItemsTable).omit({ id: true, createdAt: true });
export type InsertEventBookingItem = z.infer<typeof insertEventBookingItemSchema>;
export type EventBookingItem = typeof eventBookingItemsTable.$inferSelect;

export const insertEventPaymentScheduleSchema = createInsertSchema(eventPaymentScheduleTable).omit({ id: true, createdAt: true });
export type InsertEventPaymentSchedule = z.infer<typeof insertEventPaymentScheduleSchema>;
export type EventPaymentSchedule = typeof eventPaymentScheduleTable.$inferSelect;

export const insertEventStaffAssignmentSchema = createInsertSchema(eventStaffAssignmentsTable).omit({ id: true, createdAt: true });
export type InsertEventStaffAssignment = z.infer<typeof insertEventStaffAssignmentSchema>;
export type EventStaffAssignment = typeof eventStaffAssignmentsTable.$inferSelect;

export const insertEventVendorRequirementSchema = createInsertSchema(eventVendorRequirementsTable).omit({ id: true, createdAt: true });
export type InsertEventVendorRequirement = z.infer<typeof insertEventVendorRequirementSchema>;
export type EventVendorRequirement = typeof eventVendorRequirementsTable.$inferSelect;

export const insertEventChecklistItemSchema = createInsertSchema(eventChecklistItemsTable).omit({ id: true, createdAt: true });
export type InsertEventChecklistItem = z.infer<typeof insertEventChecklistItemSchema>;
export type EventChecklistItem = typeof eventChecklistItemsTable.$inferSelect;

export const insertEventStatusHistorySchema = createInsertSchema(eventStatusHistoryTable).omit({ id: true, createdAt: true });
export type InsertEventStatusHistory = z.infer<typeof insertEventStatusHistorySchema>;
export type EventStatusHistory = typeof eventStatusHistoryTable.$inferSelect;

export const EVENT_BOOKING_TYPES = ["event", "banquet", "catering"] as const;
export const EVENT_BOOKING_STATUSES = ["quote", "confirmed", "in_progress", "completed", "cancelled"] as const;
