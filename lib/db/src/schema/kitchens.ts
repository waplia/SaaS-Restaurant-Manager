import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";

export const kitchensTable = pgTable("kitchens", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  printerName: text("printer_name"),
  paperSize: text("paper_size").notNull().default("thermal-80mm"),
  autoPrint: boolean("auto_print").notNull().default(false),
  printerTarget: text("printer_target").notNull().default("browser"),
  isActive: boolean("is_active").notNull().default(true),
  // When true, this station is a Bar (BOT — Bar Order Ticket) instead of a
  // food kitchen (KOT). Tickets routed here render in the bar queue.
  isBar: boolean("is_bar").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertKitchenSchema = createInsertSchema(kitchensTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKitchen = z.infer<typeof insertKitchenSchema>;
export type Kitchen = typeof kitchensTable.$inferSelect;
