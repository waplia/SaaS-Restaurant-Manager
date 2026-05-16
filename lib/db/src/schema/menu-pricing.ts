import { pgTable, serial, integer, decimal, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { menuItemsTable } from "./menu";

export const menuItemPricingMetaTable = pgTable(
  "menu_item_pricing_meta",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id, { onDelete: "cascade" }),
    competitorPrice: decimal("competitor_price", { precision: 10, scale: 2 }),
    wastePct: decimal("waste_pct", { precision: 5, scale: 2 }),
    overheadPct: decimal("overhead_pct", { precision: 5, scale: 2 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("menu_item_pricing_meta_item_idx").on(t.menuItemId),
  ],
);

export type MenuItemPricingMeta = typeof menuItemPricingMetaTable.$inferSelect;
