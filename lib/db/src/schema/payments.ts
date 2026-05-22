import { pgTable, text, serial, timestamp, integer, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";
import { devicesTable } from "./devices";

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
  // Optional terminal/device tagging for card-present payments — populated by
  // the terminal pay path so reports can break revenue down by device.
  deviceId: integer("device_id").references(() => devicesTable.id, { onDelete: "set null" }),
  terminalProvider: text("terminal_provider"),
  terminalRefId: text("terminal_ref_id"),
  // Task #587 — payment categorisation. These mirror the `payment_methods`
  // taxonomy so reports/exports can pivot the ledger by Offline vs Online or
  // by source (counter cash vs. own gateway vs. manual UPI) without parsing
  // free-text `method`. Nullable for legacy rows; the data migration backfills
  // them from `method` on a best-effort basis.
  //   paymentCategory: "offline" | "online"
  //   paymentSource:   one of PaymentMethodType (cash, counter_card,
  //                    counter_upi, platform_gateway, own_gateway, manual_upi, …)
  //   gatewayCode:     when the source is platform_gateway / own_gateway,
  //                    the named gateway (razorpay | cashfree | stripe | …)
  paymentCategory: text("payment_category"),
  paymentSource: text("payment_source"),
  gatewayCode: text("gateway_code"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
