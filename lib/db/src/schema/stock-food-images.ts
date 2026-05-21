import { pgTable, serial, text, boolean, integer, timestamp, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
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
  // Extended metadata — added 2026-05 with the Admin Food Image Library expansion.
  dietaryType: text("dietary_type"),   // veg | non-veg | vegan | jain | egg
  mealType: text("meal_type"),         // starter | main | dessert | drink | snack | breakfast | bread | rice | side
  spiceLevel: integer("spice_level"),  // 0..3
  provider: text("provider"),          // wikimedia | unsplash | openai | gemini | stable-diffusion | replicate | upload | manual
  model: text("model"),                // e.g. "gpt-image-1", "imagen-3"
  licenseStatus: text("license_status").notNull().default("unknown"), // approved | restricted | unknown
  isApproved: boolean("is_approved").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  usageCount: integer("usage_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  generationJobId: integer("generation_job_id"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  slugIdx: uniqueIndex("stock_food_images_slug_idx").on(t.slug),
  activeIdx: index("stock_food_images_active_idx").on(t.isActive),
  approvedIdx: index("stock_food_images_approved_idx").on(t.isApproved, t.isActive),
  featuredIdx: index("stock_food_images_featured_idx").on(t.isFeatured),
  usageIdx: index("stock_food_images_usage_idx").on(t.usageCount),
}));

export const insertStockFoodImageSchema = createInsertSchema(stockFoodImagesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertStockFoodImage = z.infer<typeof insertStockFoodImageSchema>;
export type StockFoodImage = typeof stockFoodImagesTable.$inferSelect;

/**
 * Bulk AI image generation jobs created by super-admins to seed the library
 * with provider-generated photos (e.g. "Generate 20 paneer dishes via gemini").
 * Items array stores per-dish status; results are written into stockFoodImagesTable
 * with generationJobId pointing back here.
 */
export const imageGenerationJobsTable = pgTable("image_generation_jobs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("pending"), // pending | running | completed | failed | cancelled
  provider: text("provider").notNull().default("openai"),
  model: text("model"),
  style: text("style"),
  prompt: text("prompt"),
  totalItems: integer("total_items").notNull().default(0),
  doneItems: integer("done_items").notNull().default(0),
  failedItems: integer("failed_items").notNull().default(0),
  items: jsonb("items").notNull().default([]),    // [{ name, cuisine, category, isVeg, status, stockImageId?, error? }]
  results: jsonb("results").notNull().default({}),
  errorMessage: text("error_message"),
  createdBy: integer("created_by"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  statusIdx: index("image_generation_jobs_status_idx").on(t.status),
  createdIdx: index("image_generation_jobs_created_idx").on(t.createdAt),
}));
export type ImageGenerationJob = typeof imageGenerationJobsTable.$inferSelect;

/**
 * Tracks which library image (if any) is attached to a given menu item.
 * Lets us count usage, surface "recently used by your restaurant", and
 * power the popular/featured lists in the picker.
 *
 * source: 'library' | 'ai_generated' | 'upload' | 'menu_import_ai' | 'reuse'
 */
export const restaurantMenuItemImagesTable = pgTable("restaurant_menu_item_images", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull(),
  menuItemId: integer("menu_item_id").notNull(),
  libraryImageId: integer("library_image_id"),
  imageUrl: text("image_url").notNull(),
  source: text("source").notNull().default("library"),
  attachedBy: integer("attached_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  restaurantIdx: index("restaurant_menu_item_images_restaurant_idx").on(t.restaurantId, t.createdAt),
  itemIdx: index("restaurant_menu_item_images_item_idx").on(t.menuItemId),
  libraryIdx: index("restaurant_menu_item_images_library_idx").on(t.libraryImageId),
}));
export type RestaurantMenuItemImage = typeof restaurantMenuItemImagesTable.$inferSelect;
