import { pgTable, text, integer, timestamp, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";

export const restaurantSettingsTable = pgTable(
  "restaurant_settings",
  {
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    section: text("section").notNull(),
    data: jsonb("data").notNull().default({}),
    updatedBy: integer("updated_by"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  t => ({
    pk: primaryKey({ columns: [t.restaurantId, t.section] }),
  }),
);

export type RestaurantSetting = typeof restaurantSettingsTable.$inferSelect;
export type InsertRestaurantSetting = typeof restaurantSettingsTable.$inferInsert;
