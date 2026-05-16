import { pgTable, serial, integer, text, boolean, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";

export const restaurantAiSettingsTable = pgTable(
  "restaurant_ai_settings",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    defaultTone: text("default_tone").notNull().default("simple"),
    defaultLanguage: text("default_language").notNull().default("en"),
    defaultLength: text("default_length").notNull().default("short"),
    requireApprovalForDescriptions: boolean("require_approval_for_descriptions").notNull().default(false),
    requireApprovalForImages: boolean("require_approval_for_images").notNull().default(true),
    expiryWindowDays: integer("expiry_window_days").notNull().default(7),
    featureToggles: jsonb("feature_toggles").$type<Record<string, boolean>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("restaurant_ai_settings_restaurant_idx").on(t.restaurantId),
  ],
);

export type RestaurantAiSettings = typeof restaurantAiSettingsTable.$inferSelect;
