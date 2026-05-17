import { pgTable, text, serial, timestamp, integer, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  direction: text("direction").notNull(),
  method: text("method").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  // Portion of `amount` that represents a customer tip (already included in
  // amount). Lets the payments ledger separately report tip turnover without
  // double-counting the sale.
  tipAmount: decimal("tip_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  paymentDate: timestamp("payment_date").notNull().defaultNow(),
  partyType: text("party_type").notNull().default("other"),
  partyId: integer("party_id"),
  partyName: text("party_name"),
  referenceType: text("reference_type").notNull().default("manual"),
  referenceId: integer("reference_id"),
  notes: text("notes"),
  recordedBy: integer("recorded_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
