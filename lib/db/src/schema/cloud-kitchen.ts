import { pgTable, text, serial, timestamp, integer, boolean, decimal, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable, branchesTable } from "./restaurants";
import { menuItemsTable } from "./menu";

export const ORDER_CHANNELS = [
  "dine_in",
  "takeaway",
  "own_delivery",
  "swiggy",
  "zomato",
  "custom",
] as const;
export type OrderChannel = typeof ORDER_CHANNELS[number];

export const brandsTable = pgTable(
  "brands",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logoUrl: text("logo_url"),
    primaryColor: text("primary_color").default("#f97316"),
    fssaiNumber: text("fssai_number"),
    gstNumber: text("gst_number"),
    // { dine_in: { externalId, commissionPct, enabled }, swiggy: {...}, ... }
    channelConfig: jsonb("channel_config").$type<Record<string, { externalId?: string; commissionPct?: number; enabled?: boolean }>>().notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("brands_restaurant_slug_idx").on(t.restaurantId, t.slug),
    index("brands_restaurant_idx").on(t.restaurantId),
  ],
);

export const brandMenuLinksTable = pgTable(
  "brand_menu_links",
  {
    id: serial("id").primaryKey(),
    brandId: integer("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id, { onDelete: "cascade" }),
    priceOverride: decimal("price_override", { precision: 10, scale: 2 }),
    taxRateOverride: decimal("tax_rate_override", { precision: 5, scale: 2 }),
    isAvailable: boolean("is_available").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("brand_menu_links_brand_item_idx").on(t.brandId, t.menuItemId),
    index("brand_menu_links_restaurant_idx").on(t.restaurantId),
  ],
);

export const packagingItemsTable = pgTable(
  "packaging_items",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("piece"),
    currentStock: decimal("current_stock", { precision: 10, scale: 3 }).notNull().default("0.000"),
    minStockLevel: decimal("min_stock_level", { precision: 10, scale: 3 }).notNull().default("0.000"),
    costPerUnit: decimal("cost_per_unit", { precision: 10, scale: 2 }).notNull().default("0.00"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("packaging_items_restaurant_idx").on(t.restaurantId)],
);

export const itemPackagingRequirementsTable = pgTable(
  "item_packaging_requirements",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id, { onDelete: "cascade" }),
    packagingItemId: integer("packaging_item_id").notNull().references(() => packagingItemsTable.id, { onDelete: "cascade" }),
    quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull().default("1.000"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("item_packaging_req_item_pkg_idx").on(t.menuItemId, t.packagingItemId),
  ],
);

export const orderThrottleRulesTable = pgTable(
  "order_throttle_rules",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    brandId: integer("brand_id").references(() => brandsTable.id, { onDelete: "cascade" }),
    channelKey: text("channel_key"),
    isPaused: boolean("is_paused").notNull().default(false),
    pauseUntil: timestamp("pause_until"),
    maxOrdersPerHour: integer("max_orders_per_hour"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("order_throttle_rules_brand_channel_idx").on(t.restaurantId, t.brandId, t.channelKey),
  ],
);

export const brandSlaTargetsTable = pgTable(
  "brand_sla_targets",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    brandId: integer("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
    channelKey: text("channel_key").notNull(),
    prepMinutes: integer("prep_minutes").notNull().default(20),
    handoverMinutes: integer("handover_minutes").notNull().default(10),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("brand_sla_targets_brand_channel_idx").on(t.brandId, t.channelKey),
  ],
);

export const insertBrandSchema = createInsertSchema(brandsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBrand = z.infer<typeof insertBrandSchema>;
export type Brand = typeof brandsTable.$inferSelect;

export const insertBrandMenuLinkSchema = createInsertSchema(brandMenuLinksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBrandMenuLink = z.infer<typeof insertBrandMenuLinkSchema>;
export type BrandMenuLink = typeof brandMenuLinksTable.$inferSelect;

export const insertPackagingItemSchema = createInsertSchema(packagingItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPackagingItem = z.infer<typeof insertPackagingItemSchema>;
export type PackagingItem = typeof packagingItemsTable.$inferSelect;

export const insertItemPackagingRequirementSchema = createInsertSchema(itemPackagingRequirementsTable).omit({ id: true, createdAt: true });
export type InsertItemPackagingRequirement = z.infer<typeof insertItemPackagingRequirementSchema>;
export type ItemPackagingRequirement = typeof itemPackagingRequirementsTable.$inferSelect;

export const insertOrderThrottleRuleSchema = createInsertSchema(orderThrottleRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrderThrottleRule = z.infer<typeof insertOrderThrottleRuleSchema>;
export type OrderThrottleRule = typeof orderThrottleRulesTable.$inferSelect;

export const insertBrandSlaTargetSchema = createInsertSchema(brandSlaTargetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBrandSlaTarget = z.infer<typeof insertBrandSlaTargetSchema>;
export type BrandSlaTarget = typeof brandSlaTargetsTable.$inferSelect;
