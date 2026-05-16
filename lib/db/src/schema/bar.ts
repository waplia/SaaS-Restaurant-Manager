import { pgTable, text, serial, timestamp, integer, boolean, decimal, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";
import { menuItemsTable } from "./menu";
import { inventoryItemsTable } from "./inventory";
import { cashRegisterSessionsTable } from "./cash-register";

export const LIQUOR_CATEGORIES = ["whisky", "vodka", "rum", "gin", "tequila", "brandy", "wine", "beer", "liqueur", "other"] as const;
export type LiquorCategory = (typeof LIQUOR_CATEGORIES)[number];

export const VARIANT_KINDS = ["peg", "bottle", "shot", "glass", "pint", "pitcher"] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];

export const BARTENDER_SHIFT_STATUSES = ["open", "closed", "approved"] as const;
export type BartenderShiftStatus = (typeof BARTENDER_SHIFT_STATUSES)[number];

// One profile row per liquor SKU (inventory item). Tracks bottle-level stock
// so we can deduct ml-per-pour and roll into a settlement variance report.
export const liquorProfilesTable = pgTable("liquor_profiles", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id),
  liquorCategory: text("liquor_category").notNull().default("other"),
  bottleSizeMl: integer("bottle_size_ml").notNull().default(750),
  // Sealed bottles on hand. Decremented when a new bottle is opened.
  bottlesOnHand: integer("bottles_on_hand").notNull().default(0),
  // ml remaining in the currently-open bottle (0 if no bottle is open).
  openBottleMlRemaining: integer("open_bottle_ml_remaining").notNull().default(0),
  brand: text("brand"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  oneProfilePerInventoryItem: uniqueIndex("liquor_profiles_one_per_inventory_item").on(t.inventoryItemId),
}));

// Sale variants on a menu item — e.g. a Whisky item exposes "30 ml Peg",
// "60 ml Large", "Quarter (180 ml)", "Full (750 ml)" each with its own price.
// linkedInventoryItemId points to the bottle SKU to deduct from on sale.
export const menuItemVariantsTable = pgTable("menu_item_variants", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id),
  kind: text("kind").notNull().default("peg"),
  label: text("label").notNull(),
  mlPerSale: integer("ml_per_sale").notNull().default(0),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  linkedInventoryItemId: integer("linked_inventory_item_id").references(() => inventoryItemsTable.id),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byMenuItem: index("menu_item_variants_by_menu_item").on(t.menuItemId),
}));

// A bartender's working session. Linked to a cash register session so the
// settlement reconciles cash + tips + bottle variance together.
export const bartenderShiftsTable = pgTable("bartender_shifts", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  bartenderUserId: integer("bartender_user_id").notNull().references(() => usersTable.id),
  cashSessionId: integer("cash_session_id").references(() => cashRegisterSessionsTable.id),
  status: text("status").notNull().default("open"),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  approvedAt: timestamp("approved_at"),
  approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id),
  expectedCash: decimal("expected_cash", { precision: 12, scale: 2 }),
  countedCash: decimal("counted_cash", { precision: 12, scale: 2 }),
  cashVariance: decimal("cash_variance", { precision: 12, scale: 2 }),
  tipsTotal: decimal("tips_total", { precision: 12, scale: 2 }).default("0"),
  totalSales: decimal("total_sales", { precision: 12, scale: 2 }).default("0"),
  notes: text("notes"),
  closeNotes: text("close_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  // At most one OPEN bartender shift per (restaurant, bartender) at a time.
  oneOpenPerBartender: uniqueIndex("bartender_shifts_one_open_per_bartender")
    .on(t.restaurantId, t.bartenderUserId)
    .where(sql`${t.status} = 'open'`),
}));

// Opening + closing physical bottle counts per shift+SKU. Variance is the
// difference between (system expected) and (counted) at close time.
export const bartenderBottleCountsTable = pgTable("bartender_bottle_counts", {
  id: serial("id").primaryKey(),
  shiftId: integer("shift_id").notNull().references(() => bartenderShiftsTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id),
  phase: text("phase").notNull(), // 'opening' | 'closing'
  bottlesCount: integer("bottles_count").notNull().default(0),
  openBottleMl: integer("open_bottle_ml").notNull().default(0),
  expectedBottles: integer("expected_bottles"),
  expectedOpenBottleMl: integer("expected_open_bottle_ml"),
  varianceMl: integer("variance_ml"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  oneCountPerPhasePerSku: uniqueIndex("bartender_bottle_counts_unique").on(t.shiftId, t.inventoryItemId, t.phase),
}));

// Per-pour ledger. Lets the liquor report aggregate by category, brand,
// bartender, and shift without joining through orders for every query.
export const barSalesTable = pgTable("bar_sales", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  orderId: integer("order_id").notNull(),
  orderItemId: integer("order_item_id").notNull(),
  variantId: integer("variant_id").references(() => menuItemVariantsTable.id),
  menuItemId: integer("menu_item_id").references(() => menuItemsTable.id),
  inventoryItemId: integer("inventory_item_id").references(() => inventoryItemsTable.id),
  bartenderShiftId: integer("bartender_shift_id").references(() => bartenderShiftsTable.id),
  liquorCategory: text("liquor_category"),
  mlPoured: integer("ml_poured").notNull().default(0),
  qty: integer("qty").notNull().default(1),
  saleAmount: decimal("sale_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byShift: index("bar_sales_by_shift").on(t.bartenderShiftId),
  byRestaurant: index("bar_sales_by_restaurant").on(t.restaurantId, t.createdAt),
}));

export const insertLiquorProfileSchema = createInsertSchema(liquorProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLiquorProfile = z.infer<typeof insertLiquorProfileSchema>;
export type LiquorProfile = typeof liquorProfilesTable.$inferSelect;

export const insertMenuItemVariantSchema = createInsertSchema(menuItemVariantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMenuItemVariant = z.infer<typeof insertMenuItemVariantSchema>;
export type MenuItemVariant = typeof menuItemVariantsTable.$inferSelect;

export const insertBartenderShiftSchema = createInsertSchema(bartenderShiftsTable).omit({ id: true, createdAt: true });
export type InsertBartenderShift = z.infer<typeof insertBartenderShiftSchema>;
export type BartenderShift = typeof bartenderShiftsTable.$inferSelect;

export const insertBartenderBottleCountSchema = createInsertSchema(bartenderBottleCountsTable).omit({ id: true, createdAt: true });
export type InsertBartenderBottleCount = z.infer<typeof insertBartenderBottleCountSchema>;
export type BartenderBottleCount = typeof bartenderBottleCountsTable.$inferSelect;

export const insertBarSaleSchema = createInsertSchema(barSalesTable).omit({ id: true, createdAt: true });
export type InsertBarSale = z.infer<typeof insertBarSaleSchema>;
export type BarSale = typeof barSalesTable.$inferSelect;
