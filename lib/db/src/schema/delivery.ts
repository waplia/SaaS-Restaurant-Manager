import { pgTable, text, serial, timestamp, integer, boolean, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

export const deliveryAssignmentsTable = pgTable("delivery_assignments", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  riderId: integer("rider_id").notNull().references(() => usersTable.id),
  status: text("status").notNull().default("assigned"),
  codAmount: decimal("cod_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  codCollected: boolean("cod_collected").notNull().default(false),
  codHandedIn: boolean("cod_handed_in").notNull().default(false),
  notes: text("notes"),
  assignedBy: integer("assigned_by").references(() => usersTable.id),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  pickedUpAt: timestamp("picked_up_at"),
  deliveredAt: timestamp("delivered_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const codHandoversTable = pgTable("cod_handovers", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  riderId: integer("rider_id").notNull().references(() => usersTable.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  notes: text("notes"),
  recordedBy: integer("recorded_by").references(() => usersTable.id),
  paymentId: integer("payment_id"),
  handedInAt: timestamp("handed_in_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDeliveryAssignmentSchema = createInsertSchema(deliveryAssignmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDeliveryAssignment = z.infer<typeof insertDeliveryAssignmentSchema>;
export type DeliveryAssignment = typeof deliveryAssignmentsTable.$inferSelect;

export const insertCodHandoverSchema = createInsertSchema(codHandoversTable).omit({ id: true, createdAt: true });
export type InsertCodHandover = z.infer<typeof insertCodHandoverSchema>;
export type CodHandover = typeof codHandoversTable.$inferSelect;
