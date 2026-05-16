import { pgTable, text, serial, timestamp, integer, boolean, decimal, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";

export const floorTablesTable = pgTable("floor_tables", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  tableNumber: text("table_number").notNull(),
  capacity: integer("capacity").notNull().default(4),
  status: text("status").notNull().default("free"),
  positionX: integer("position_x").default(0),
  positionY: integer("position_y").default(0),
  shape: text("shape").default("square"),
  qrCode: text("qr_code"),
  isActive: boolean("is_active").notNull().default(true),
  needsCleaning: boolean("needs_cleaning").notNull().default(false),
  lastCleanedAt: timestamp("last_cleaned_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const reservationsTable = pgTable("reservations", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  tableId: integer("table_id").references(() => floorTablesTable.id),
  customerId: integer("customer_id"),
  guestName: text("guest_name").notNull(),
  guestPhone: text("guest_phone"),
  guestEmail: text("guest_email"),
  partySize: integer("party_size").notNull().default(2),
  scheduledAt: timestamp("scheduled_at").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(90),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  // Reservation & Waitlist module additions
  occasion: text("occasion"),               // birthday | anniversary | business | date | other
  occasionNotes: text("occasion_notes"),
  seatingNotes: text("seating_notes"),
  isVip: boolean("is_vip").notNull().default(false),
  depositAmount: decimal("deposit_amount", { precision: 10, scale: 2 }),
  depositStatus: text("deposit_status").notNull().default("none"), // none | required | pending | paid | refunded | waived
  depositPaymentRef: text("deposit_payment_ref"),
  gracePeriodMinutes: integer("grace_period_minutes").notNull().default(15),
  sourceChannel: text("source_channel").notNull().default("staff"), // staff | public | walkin | phone | mobile
  walkInArrivedAt: timestamp("walk_in_arrived_at"),
  estimatedWaitMinutes: integer("estimated_wait_minutes"),
  cleaningRequiredOnComplete: boolean("cleaning_required_on_complete").notNull().default(true),
  reminderSentAt: timestamp("reminder_sent_at"),
  noShowMarkedAt: timestamp("no_show_marked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  byRestaurantTime: index("reservations_restaurant_time_idx").on(t.restaurantId, t.scheduledAt),
  byStatus: index("reservations_status_idx").on(t.restaurantId, t.status),
}));

export const waitlistEntriesTable = pgTable("waitlist_entries", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id"),
  guestName: text("guest_name").notNull(),
  guestPhone: text("guest_phone"),
  partySize: integer("party_size").notNull().default(2),
  estimatedWaitMinutes: integer("estimated_wait_minutes"),
  quotedAt: timestamp("quoted_at").notNull().defaultNow(),
  status: text("status").notNull().default("waiting"), // waiting | notified | seated | cancelled | no_show
  notifiedAt: timestamp("notified_at"),
  seatedAt: timestamp("seated_at"),
  seatedTableId: integer("seated_table_id").references(() => floorTablesTable.id),
  reservationId: integer("reservation_id"),
  notes: text("notes"),
  occasion: text("occasion"),
  isVip: boolean("is_vip").notNull().default(false),
  sourceChannel: text("source_channel").notNull().default("staff"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  byRestaurantStatus: index("waitlist_restaurant_status_idx").on(t.restaurantId, t.status),
}));

export const insertFloorTableSchema = createInsertSchema(floorTablesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFloorTable = z.infer<typeof insertFloorTableSchema>;
export type FloorTable = typeof floorTablesTable.$inferSelect;

export const insertReservationSchema = createInsertSchema(reservationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReservation = z.infer<typeof insertReservationSchema>;
export type Reservation = typeof reservationsTable.$inferSelect;

export const insertWaitlistEntrySchema = createInsertSchema(waitlistEntriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWaitlistEntry = z.infer<typeof insertWaitlistEntrySchema>;
export type WaitlistEntry = typeof waitlistEntriesTable.$inferSelect;
