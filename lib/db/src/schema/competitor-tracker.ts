import { pgTable, text, serial, timestamp, integer, boolean, decimal, uniqueIndex } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { menuItemsTable } from "./menu";

export const competitorsTable = pgTable("competitors", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  area: text("area"),
  cuisine: text("cuisine"),
  notes: text("notes"),
  lastRefreshedAt: timestamp("last_refreshed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const competitorMenuLinksTable = pgTable("competitor_menu_links", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").notNull().references(() => competitorsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const competitorItemsTable = pgTable("competitor_items", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").notNull().references(() => competitorsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  price: decimal("price", { precision: 10, scale: 2 }),
  description: text("description"),
  offer: text("offer"),
  notes: text("notes"),
  isNew: boolean("is_new").notNull().default(false),
  noticedAt: timestamp("noticed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const competitorItemLinksTable = pgTable(
  "competitor_item_links",
  {
    id: serial("id").primaryKey(),
    competitorItemId: integer("competitor_item_id").notNull().references(() => competitorItemsTable.id, { onDelete: "cascade" }),
    menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("competitor_item_link_unique").on(t.competitorItemId),
  ],
);

export type Competitor = typeof competitorsTable.$inferSelect;
export type CompetitorMenuLink = typeof competitorMenuLinksTable.$inferSelect;
export type CompetitorItem = typeof competitorItemsTable.$inferSelect;
export type CompetitorItemLink = typeof competitorItemLinksTable.$inferSelect;
