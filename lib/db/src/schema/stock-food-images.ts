import { pgTable, serial, text, boolean, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const stockFoodImagesTable = pgTable("stock_food_images", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  cuisine: text("cuisine"),
  category: text("category"),
  imageUrl: text("image_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  aliases: text("aliases").array().notNull().default([]),
  tags: text("tags").array().notNull().default([]),
  isVeg: boolean("is_veg").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  attribution: text("attribution"),
  source: text("source").notNull().default("seed"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  slugIdx: uniqueIndex("stock_food_images_slug_idx").on(t.slug),
  activeIdx: index("stock_food_images_active_idx").on(t.isActive),
}));

export const insertStockFoodImageSchema = createInsertSchema(stockFoodImagesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertStockFoodImage = z.infer<typeof insertStockFoodImageSchema>;
export type StockFoodImage = typeof stockFoodImagesTable.$inferSelect;
