import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const reservationsTable = pgTable("reservations", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  tableId: integer("table_id").references(() => floorTablesTable.id),
  guestName: text("guest_name").notNull(),
  guestPhone: text("guest_phone"),
  guestEmail: text("guest_email"),
  partySize: integer("party_size").notNull().default(2),
  scheduledAt: timestamp("scheduled_at").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(90),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFloorTableSchema = createInsertSchema(floorTablesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFloorTable = z.infer<typeof insertFloorTableSchema>;
export type FloorTable = typeof floorTablesTable.$inferSelect;

export const insertReservationSchema = createInsertSchema(reservationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReservation = z.infer<typeof insertReservationSchema>;
export type Reservation = typeof reservationsTable.$inferSelect;
