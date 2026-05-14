import { pgTable, text, serial, timestamp, integer, decimal, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";
import { shiftsTable } from "./staff";

export const cashRegisterSessionsTable = pgTable("cash_register_sessions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  openedByUserId: integer("opened_by_user_id").notNull().references(() => usersTable.id),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedByUserId: integer("closed_by_user_id").references(() => usersTable.id),
  closedAt: timestamp("closed_at"),
  shiftId: integer("shift_id").references(() => shiftsTable.id),
  openingFloat: decimal("opening_float", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedCash: decimal("expected_cash", { precision: 12, scale: 2 }),
  actualCash: decimal("actual_cash", { precision: 12, scale: 2 }),
  overShort: decimal("over_short", { precision: 12, scale: 2 }),
  isBlindClose: boolean("is_blind_close").notNull().default(false),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  closeNotes: text("close_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  // Hard-enforce: at most one open session per restaurant at any time.
  oneOpenPerRestaurant: uniqueIndex("cash_register_one_open_per_restaurant")
    .on(t.restaurantId)
    .where(sql`${t.status} = 'open'`),
}));

export const cashMovementsTable = pgTable("cash_movements", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => cashRegisterSessionsTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  type: text("type").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  reason: text("reason"),
  referenceType: text("reference_type"),
  referenceId: integer("reference_id"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const cashDenominationCountsTable = pgTable("cash_denomination_counts", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => cashRegisterSessionsTable.id),
  phase: text("phase").notNull(),
  denomination: integer("denomination").notNull(),
  count: integer("count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCashRegisterSessionSchema = createInsertSchema(cashRegisterSessionsTable).omit({ id: true, createdAt: true });
export type InsertCashRegisterSession = z.infer<typeof insertCashRegisterSessionSchema>;
export type CashRegisterSession = typeof cashRegisterSessionsTable.$inferSelect;

export const insertCashMovementSchema = createInsertSchema(cashMovementsTable).omit({ id: true, createdAt: true });
export type InsertCashMovement = z.infer<typeof insertCashMovementSchema>;
export type CashMovement = typeof cashMovementsTable.$inferSelect;

export const insertCashDenominationCountSchema = createInsertSchema(cashDenominationCountsTable).omit({ id: true, createdAt: true });
export type InsertCashDenominationCount = z.infer<typeof insertCashDenominationCountSchema>;
export type CashDenominationCount = typeof cashDenominationCountsTable.$inferSelect;
