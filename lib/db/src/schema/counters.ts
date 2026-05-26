/**
 * POS counters / workstations (Option B).
 *
 * A "counter" is a physical cash-register / POS workstation at an outlet —
 * the desk where a cashier takes orders. This is intentionally distinct
 * from `devicesTable` rows of type `card_terminal`, which model the
 * Stripe/Square card reader hardware that a counter *uses* to take card
 * payments. One counter can pair to zero or many card terminals.
 *
 * Each Khanalagao Desktop POS install claims one counter by writing its
 * stable `machineId` (a `local-<uuid>` minted on first launch) into the
 * `machineId` column. Reports, Z-reports, KOT headers, and per-counter
 * cash drawers reference `counterId`.
 */
import { pgTable, serial, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable, branchesTable } from "./restaurants";

export const countersTable = pgTable(
  "counters",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    /** Optional opaque ID written by the desktop POS on first claim
     *  (typically `local-<uuid>`). When set, this counter is "bound" to
     *  that machine and other installs cannot claim it without unbinding. */
    machineId: text("machine_id"),
    /** Free-form info shown in the admin (e.g. "MacBook Pro / Counter Lane 1"). */
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    /** Last time any desktop POS reported in as this counter. */
    lastSeenAt: timestamp("last_seen_at"),
    /** Last-known desktop POS app version for support ("1.3.0"). */
    appVersion: text("app_version"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("counters_restaurant_idx").on(t.restaurantId),
    index("counters_branch_idx").on(t.branchId),
    uniqueIndex("counters_machine_id_uniq").on(t.machineId),
  ],
);

export const insertCounterSchema = createInsertSchema(countersTable).omit({
  id: true, createdAt: true, updatedAt: true, deletedAt: true, lastSeenAt: true, appVersion: true, machineId: true,
});
export type InsertCounter = z.infer<typeof insertCounterSchema>;
export type Counter = typeof countersTable.$inferSelect;
