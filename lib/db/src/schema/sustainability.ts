import { pgTable, serial, integer, text, timestamp, decimal, jsonb, index, date, uniqueIndex } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { inventoryItemsTable } from "./inventory";

export const sustainabilityFoodWasteTable = pgTable(
  "sustainability_food_waste",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
    unit: text("unit").notNull().default("kg"),
    reason: text("reason"),
    inventoryItemId: integer("inventory_item_id").references(() => inventoryItemsTable.id, { onDelete: "set null" }),
    menuItemId: integer("menu_item_id"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("sus_food_waste_rest_date_idx").on(t.restaurantId, t.entryDate)],
);

export const sustainabilityPackagingTable = pgTable(
  "sustainability_packaging",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    type: text("type").notNull().default("plastic"),
    quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
    unit: text("unit").notNull().default("units"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("sus_packaging_rest_date_idx").on(t.restaurantId, t.entryDate)],
);

export const sustainabilityDonationsTable = pgTable(
  "sustainability_donations",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    recipient: text("recipient").notNull(),
    item: text("item").notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
    unit: text("unit").notNull().default("kg"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("sus_donations_rest_date_idx").on(t.restaurantId, t.entryDate)],
);

export const sustainabilityLocalVendorsTable = pgTable(
  "sustainability_local_vendors",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    vendorName: text("vendor_name").notNull(),
    supplierId: integer("supplier_id"),
    isLocal: integer("is_local").notNull().default(1),
    distanceKm: decimal("distance_km", { precision: 10, scale: 2 }),
    spend: decimal("spend", { precision: 12, scale: 2 }).notNull().default("0.00"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("sus_local_vendors_rest_date_idx").on(t.restaurantId, t.entryDate)],
);

export const sustainabilityReusablePackagingTable = pgTable(
  "sustainability_reusable_packaging",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    item: text("item").notNull(),
    inCirculation: integer("in_circulation").notNull().default(0),
    returns: integer("returns").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("sus_reusable_rest_date_idx").on(t.restaurantId, t.entryDate)],
);

export const sustainabilityEnergyTable = pgTable(
  "sustainability_energy",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    kwh: decimal("kwh", { precision: 12, scale: 3 }),
    note: text("note"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("sus_energy_rest_date_idx").on(t.restaurantId, t.entryDate)],
);

export const sustainabilityWaterTable = pgTable(
  "sustainability_water",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    liters: decimal("liters", { precision: 12, scale: 2 }),
    note: text("note"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("sus_water_rest_date_idx").on(t.restaurantId, t.entryDate)],
);

export const sustainabilityCarbonTable = pgTable(
  "sustainability_carbon",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    estimatedKg: decimal("estimated_kg", { precision: 12, scale: 3 }),
    manualOverrideKg: decimal("manual_override_kg", { precision: 12, scale: 3 }),
    note: text("note"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("sus_carbon_rest_date_idx").on(t.restaurantId, t.entryDate)],
);

export const sustainabilityMonthlyScoresTable = pgTable(
  "sustainability_monthly_scores",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    monthKey: text("month_key").notNull(),
    overallScore: decimal("overall_score", { precision: 5, scale: 2 }).notNull(),
    subScores: jsonb("sub_scores").$type<Record<string, number | null>>().notNull().default({}),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
    tips: jsonb("tips").$type<Array<{ key: string; title: string; detail: string }>>().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sus_monthly_rest_month_uniq").on(t.restaurantId, t.monthKey),
    index("sus_monthly_tenant_idx").on(t.tenantId, t.monthKey),
  ],
);

export type SustainabilityFoodWaste = typeof sustainabilityFoodWasteTable.$inferSelect;
export type SustainabilityPackaging = typeof sustainabilityPackagingTable.$inferSelect;
export type SustainabilityDonation = typeof sustainabilityDonationsTable.$inferSelect;
export type SustainabilityLocalVendor = typeof sustainabilityLocalVendorsTable.$inferSelect;
export type SustainabilityReusablePackaging = typeof sustainabilityReusablePackagingTable.$inferSelect;
export type SustainabilityEnergy = typeof sustainabilityEnergyTable.$inferSelect;
export type SustainabilityWater = typeof sustainabilityWaterTable.$inferSelect;
export type SustainabilityCarbon = typeof sustainabilityCarbonTable.$inferSelect;
export type SustainabilityMonthlyScore = typeof sustainabilityMonthlyScoresTable.$inferSelect;
