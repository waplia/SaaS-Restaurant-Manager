import {
  pgTable, text, serial, timestamp, integer, boolean, decimal, jsonb, bigint,
  uniqueIndex, index, date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";
import { ordersTable } from "./orders";

// A Food Court is a venue (mall food court, office park, campus) where one
// owner runs the venue and many independent vendor restaurants sell from
// their own counters under a shared common-billing/token system.
export const foodCourtsTable = pgTable("food_courts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  ownerRestaurantId: integer("owner_restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  addressLine: text("address_line"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  gstin: text("gstin"),
  logoUrl: text("logo_url"),
  openingTime: text("opening_time"), // HH:MM
  closingTime: text("closing_time"),
  totalSeats: integer("total_seats").notNull().default(0),
  seatingMode: text("seating_mode").notNull().default("shared"), // shared | table_assigned
  defaultCommissionPct: decimal("default_commission_pct", { precision: 5, scale: 2 }).notNull().default("10.00"),
  defaultPlatformFee: decimal("default_platform_fee", { precision: 10, scale: 2 }).notNull().default("0.00"),
  packagingFee: decimal("packaging_fee", { precision: 10, scale: 2 }).notNull().default("0.00"),
  convenienceFee: decimal("convenience_fee", { precision: 10, scale: 2 }).notNull().default("0.00"),
  serviceChargePct: decimal("service_charge_pct", { precision: 5, scale: 2 }).notNull().default("0.00"),
  acceptedPaymentMethods: jsonb("accepted_payment_methods").$type<string[]>().notNull().default(["cash", "card", "upi", "gateway"]),
  tokenPrefix: text("token_prefix").notNull().default("FC"),
  partialPickup: boolean("partial_pickup").notNull().default(false),
  perVendorGstin: boolean("per_vendor_gstin").notNull().default(false),
  status: text("status").notNull().default("active"), // active | paused | archived
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("food_courts_tenant_idx").on(t.tenantId),
  slugUq: uniqueIndex("food_courts_tenant_slug_uq").on(t.tenantId, t.slug),
}));

// Links a vendor (restaurant) into a food court with commission rule and
// settlement details. A single restaurant can be a vendor in multiple food
// courts (rare, but supported).
export const foodCourtVendorsTable = pgTable("food_court_vendors", {
  id: serial("id").primaryKey(),
  foodCourtId: integer("food_court_id").notNull().references(() => foodCourtsTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  counterNumber: text("counter_number"),
  stallName: text("stall_name").notNull(),
  cuisineTags: jsonb("cuisine_tags").$type<string[]>().notNull().default([]),
  commissionType: text("commission_type").notNull().default("percentage"), // percentage | flat_per_order | tiered | combo
  commissionPct: decimal("commission_pct", { precision: 5, scale: 2 }).notNull().default("10.00"),
  flatFeePerOrder: decimal("flat_fee_per_order", { precision: 10, scale: 2 }).notNull().default("0.00"),
  tieredRules: jsonb("tiered_rules").$type<Array<{ uptoMonthlyRevenue: number; pct: number }>>().notNull().default([]),
  commissionVersion: integer("commission_version").notNull().default(1),
  settlementBankName: text("settlement_bank_name"),
  settlementAccountName: text("settlement_account_name"),
  settlementAccountNumber: text("settlement_account_number"),
  settlementIfsc: text("settlement_ifsc"),
  settlementUpiId: text("settlement_upi_id"),
  openingTime: text("opening_time"),
  closingTime: text("closing_time"),
  vendorGstin: text("vendor_gstin"),
  isActive: boolean("is_active").notNull().default(true),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  foodCourtIdx: index("fc_vendors_court_idx").on(t.foodCourtId),
  restaurantIdx: index("fc_vendors_restaurant_idx").on(t.restaurantId),
  uqCourtRestaurant: uniqueIndex("fc_vendors_court_restaurant_uq").on(t.foodCourtId, t.restaurantId),
}));

// Parent food court order — represents the customer-facing single bill that
// fans out to one sub-order per vendor (the regular ordersTable rows).
export const foodCourtOrdersTable = pgTable("food_court_orders", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  foodCourtId: integer("food_court_id").notNull().references(() => foodCourtsTable.id, { onDelete: "cascade" }),
  parentOrderNumber: text("parent_order_number").notNull(),
  tableNumber: text("table_number"),
  zoneName: text("zone_name"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull().default("0.00"),
  taxAmount: decimal("tax_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  serviceCharge: decimal("service_charge", { precision: 12, scale: 2 }).notNull().default("0.00"),
  packagingFee: decimal("packaging_fee", { precision: 12, scale: 2 }).notNull().default("0.00"),
  convenienceFee: decimal("convenience_fee", { precision: 12, scale: 2 }).notNull().default("0.00"),
  discountAmount: decimal("discount_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  paymentMethod: text("payment_method"), // cash | card | upi | gateway | split
  paymentStatus: text("payment_status").notNull().default("unpaid"), // unpaid | paid | refunded
  status: text("status").notNull().default("open"), // open | preparing | ready | completed | cancelled
  pickupMode: text("pickup_mode").notNull().default("all_ready"), // all_ready | partial
  token: text("token"),
  tokenNumber: integer("token_number"),
  cashierId: integer("cashier_id").references(() => usersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => ({
  foodCourtIdx: index("fc_orders_court_idx").on(t.foodCourtId, t.createdAt),
  parentNumberUq: uniqueIndex("fc_orders_parent_number_uq").on(t.foodCourtId, t.parentOrderNumber),
  tokenIdx: index("fc_orders_token_idx").on(t.foodCourtId, t.token),
}));

// Per-vendor split for a food court parent order. The actual kitchen/order
// row lives in `ordersTable` (linked via `subOrderId`) so existing kitchen,
// menu, items and KOT flows continue to work unchanged.
export const foodCourtSubOrdersTable = pgTable("food_court_sub_orders", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => foodCourtOrdersTable.id, { onDelete: "cascade" }),
  foodCourtId: integer("food_court_id").notNull().references(() => foodCourtsTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").notNull().references(() => foodCourtVendorsTable.id, { onDelete: "restrict" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "restrict" }),
  subOrderId: integer("sub_order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull().default("0.00"),
  taxAmount: decimal("tax_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  discountAmount: decimal("discount_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  paymentSplit: decimal("payment_split", { precision: 12, scale: 2 }).notNull().default("0.00"),
  commissionAmount: decimal("commission_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  commissionVersion: integer("commission_version").notNull().default(1),
  netPayable: decimal("net_payable", { precision: 12, scale: 2 }).notNull().default("0.00"),
  status: text("status").notNull().default("pending"), // pending | preparing | ready | served | cancelled | refunded
  readyAt: timestamp("ready_at"),
  servedAt: timestamp("served_at"),
  refundAmount: decimal("refund_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  settlementId: integer("settlement_id"),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  parentIdx: index("fc_sub_orders_parent_idx").on(t.parentId),
  vendorIdx: index("fc_sub_orders_vendor_idx").on(t.vendorId, t.createdAt),
  subOrderUq: uniqueIndex("fc_sub_orders_sub_order_uq").on(t.subOrderId),
  settlementIdx: index("fc_sub_orders_settlement_idx").on(t.settlementId),
}));

// Per-vendor daily settlement record. Money values are paise (bigint) to
// match the wallet/ledger convention.
export const foodCourtSettlementsTable = pgTable("food_court_settlements", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  foodCourtId: integer("food_court_id").notNull().references(() => foodCourtsTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").notNull().references(() => foodCourtVendorsTable.id, { onDelete: "restrict" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "restrict" }),
  settlementDate: date("settlement_date").notNull(),
  orderCount: integer("order_count").notNull().default(0),
  grossSales: bigint("gross_sales", { mode: "number" }).notNull().default(0),
  taxesCollected: bigint("taxes_collected", { mode: "number" }).notNull().default(0),
  discountsGiven: bigint("discounts_given", { mode: "number" }).notNull().default(0),
  refundsGiven: bigint("refunds_given", { mode: "number" }).notNull().default(0),
  surchargesRetained: bigint("surcharges_retained", { mode: "number" }).notNull().default(0),
  commissionAmount: bigint("commission_amount", { mode: "number" }).notNull().default(0),
  platformFee: bigint("platform_fee", { mode: "number" }).notNull().default(0),
  gatewayFee: bigint("gateway_fee", { mode: "number" }).notNull().default(0),
  netPayable: bigint("net_payable", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("draft"), // draft | finalised | paid | adjusted
  walletTransferGroupId: text("wallet_transfer_group_id"),
  paidAt: timestamp("paid_at"),
  adjustments: jsonb("adjustments").$type<Array<{ amount: number; reason: string; at: string; by?: number }>>().notNull().default([]),
  notes: text("notes"),
  generatedBy: integer("generated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uqVendorDay: uniqueIndex("fc_settlements_vendor_day_uq").on(t.vendorId, t.settlementDate),
  courtIdx: index("fc_settlements_court_idx").on(t.foodCourtId, t.settlementDate),
  tenantIdx: index("fc_settlements_tenant_idx").on(t.tenantId, t.settlementDate),
}));

export const insertFoodCourtSchema = createInsertSchema(foodCourtsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFoodCourt = z.infer<typeof insertFoodCourtSchema>;
export type FoodCourt = typeof foodCourtsTable.$inferSelect;

export const insertFoodCourtVendorSchema = createInsertSchema(foodCourtVendorsTable).omit({ id: true, createdAt: true, updatedAt: true, joinedAt: true });
export type InsertFoodCourtVendor = z.infer<typeof insertFoodCourtVendorSchema>;
export type FoodCourtVendor = typeof foodCourtVendorsTable.$inferSelect;

export type FoodCourtOrder = typeof foodCourtOrdersTable.$inferSelect;
export type FoodCourtSubOrder = typeof foodCourtSubOrdersTable.$inferSelect;
export type FoodCourtSettlement = typeof foodCourtSettlementsTable.$inferSelect;
