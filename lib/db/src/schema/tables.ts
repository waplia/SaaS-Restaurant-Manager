import { pgTable, text, serial, timestamp, integer, boolean, decimal, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

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
  // Task #431 — server (waiter) assigned to take care of the table.
  serverId: integer("server_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  byRestaurantTime: index("reservations_restaurant_time_idx").on(t.restaurantId, t.scheduledAt),
  byStatus: index("reservations_status_idx").on(t.restaurantId, t.status),
}));

// Task #431 — Table-pacing rules. One row per restaurant, evaluated when a
// reservation is created or rescheduled. Limits the number of party-arrivals
// (covers) within a rolling slot to avoid overwhelming the kitchen/floor.
export const reservationPacingRulesTable = pgTable("reservation_pacing_rules", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }).unique(),
  enabled: boolean("enabled").notNull().default(false),
  slotMinutes: integer("slot_minutes").notNull().default(15),
  maxCovers: integer("max_covers").notNull().default(20),
  maxReservations: integer("max_reservations").notNull().default(6),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ReservationPacingRules = typeof reservationPacingRulesTable.$inferSelect;

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

// Task #601 — Table sessions for the running-order model. One row per
// "seating" at a dine-in table: opened when the first dine-in order is
// placed on a free table, closed after the final bill is paid and the table
// is freed. All KOT rounds and the single final bill for that seating roll
// up against this session.
export const tableSessionsTable = pgTable("table_sessions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  branchId: integer("branch_id"),
  tableId: integer("table_id").notNull().references(() => floorTablesTable.id),
  customerId: integer("customer_id"),
  waiterId: integer("waiter_id").references(() => usersTable.id),
  status: text("status").notNull().default("open"), // open | bill_generated | paid | closed | cancelled
  partySize: integer("party_size"),
  notes: text("notes"),
  // Guest-verification hold: where the session was opened from and when
  // a staff member verified the guest is present. When openedBy='qr' and
  // staffVerifiedAt is null, the first KOT round is held in
  // 'pending_acceptance' until a waiter taps Accept.
  openedBy: text("opened_by"), // 'staff' | 'qr' | null
  staffVerifiedAt: timestamp("staff_verified_at"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  billGeneratedAt: timestamp("bill_generated_at"),
  paidAt: timestamp("paid_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  byRestaurantTable: index("table_sessions_restaurant_table_idx").on(t.restaurantId, t.tableId, t.status),
}));

export type TableSession = typeof tableSessionsTable.$inferSelect;

export const insertFloorTableSchema = createInsertSchema(floorTablesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFloorTable = z.infer<typeof insertFloorTableSchema>;
export type FloorTable = typeof floorTablesTable.$inferSelect;

export const insertReservationSchema = createInsertSchema(reservationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReservation = z.infer<typeof insertReservationSchema>;
export type Reservation = typeof reservationsTable.$inferSelect;

export const insertWaitlistEntrySchema = createInsertSchema(waitlistEntriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWaitlistEntry = z.infer<typeof insertWaitlistEntrySchema>;
export type WaitlistEntry = typeof waitlistEntriesTable.$inferSelect;
