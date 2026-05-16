import { pgTable, text, serial, timestamp, integer, boolean, decimal, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { kitchensTable } from "./kitchens";

export const menusTable = pgTable("menus", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  availableFrom: text("available_from").default("00:00"),
  availableTo: text("available_to").default("23:59"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const menuCategoriesTable = pgTable("menu_categories", {
  id: serial("id").primaryKey(),
  menuId: integer("menu_id").notNull().references(() => menusTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const menuItemsTable = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull().references(() => menuCategoriesTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  sku: text("sku"),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }),
  imageUrl: text("image_url"),
  isVeg: boolean("is_veg").default(true),
  isAvailable: boolean("is_available").notNull().default(true),
  preparationTime: integer("preparation_time").default(15),
  calories: integer("calories"),
  proteinG: decimal("protein_g", { precision: 6, scale: 2 }),
  fatG: decimal("fat_g", { precision: 6, scale: 2 }),
  carbsG: decimal("carbs_g", { precision: 6, scale: 2 }),
  containsDairy: boolean("contains_dairy"),
  containsNuts: boolean("contains_nuts"),
  containsGluten: boolean("contains_gluten"),
  isVegan: boolean("is_vegan"),
  isJain: boolean("is_jain"),
  spicyLevel: integer("spicy_level"),
  nutritionAiMeta: jsonb("nutrition_ai_meta"),
  sortOrder: integer("sort_order").notNull().default(0),
  tags: text("tags").array().default([]),
  allergens: text("allergens").array().default([]),
  kitchenId: integer("kitchen_id").references(() => kitchensTable.id),
  shelfLifeHours: integer("shelf_life_hours"),
  expiryAlertHours: integer("expiry_alert_hours"),
  isCake: boolean("is_cake").notNull().default(false),
  isCustomizable: boolean("is_customizable").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const modifierGroupsTable = pgTable("modifier_groups", {
  id: serial("id").primaryKey(),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id),
  name: text("name").notNull(),
  isRequired: boolean("is_required").default(false),
  minSelections: integer("min_selections").default(0),
  maxSelections: integer("max_selections").default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const modifiersTable = pgTable("modifiers", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => modifierGroupsTable.id),
  name: text("name").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull().default("0.00"),
  isDefault: boolean("is_default").default(false),
  isAvailable: boolean("is_available").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMenuSchema = createInsertSchema(menusTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMenu = z.infer<typeof insertMenuSchema>;
export type Menu = typeof menusTable.$inferSelect;

export const insertMenuCategorySchema = createInsertSchema(menuCategoriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMenuCategory = z.infer<typeof insertMenuCategorySchema>;
export type MenuCategory = typeof menuCategoriesTable.$inferSelect;

export const insertMenuItemSchema = createInsertSchema(menuItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;
export type MenuItem = typeof menuItemsTable.$inferSelect;

export const insertModifierGroupSchema = createInsertSchema(modifierGroupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertModifierGroup = z.infer<typeof insertModifierGroupSchema>;
export type ModifierGroup = typeof modifierGroupsTable.$inferSelect;

export const insertModifierSchema = createInsertSchema(modifiersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertModifier = z.infer<typeof insertModifierSchema>;
export type Modifier = typeof modifiersTable.$inferSelect;
