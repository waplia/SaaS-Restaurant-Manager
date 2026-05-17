import { pgTable, text, serial, timestamp, integer, boolean, decimal, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { customersTable } from "./customers";

// ─── Global customer identity (cross-restaurant) ──────────────────
// One row per real-world person (keyed by phone). Each restaurant's
// `customers` row is then linked to the same `customer_user_id` so we can
// roll up balances/visits across the network.
export const customerUsersTable = pgTable("customer_users", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  email: text("email"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  tokenVersion: integer("token_version").notNull().default(0),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqPhone: uniqueIndex("customer_users_phone_uniq").on(t.phone),
}));

// Link rows: a single customer_user can have a customers row at many
// restaurants (one per restaurant). Used to fan-out a wallet query.
export const customerUserLinksTable = pgTable("customer_user_links", {
  id: serial("id").primaryKey(),
  customerUserId: integer("customer_user_id").notNull().references(() => customerUsersTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqLink: uniqueIndex("customer_user_links_uniq").on(t.customerUserId, t.customerId),
  byRestaurant: index("customer_user_links_restaurant_idx").on(t.restaurantId),
  byCustomer: uniqueIndex("customer_user_links_customer_uniq").on(t.customerId),
}));

// Public/customer-side OTPs (separate from staff manager OTPs).
export const customerOtpsTable = pgTable("customer_otps", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull().default("sms"), // sms | email
  identifier: text("identifier").notNull(),          // phone or email
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byIdentifier: index("customer_otps_identifier_idx").on(t.identifier, t.createdAt),
}));

// ─── Loyalty network membership & rules (per restaurant) ───────────
export const loyaltyNetworkMembersTable = pgTable("loyalty_network_members", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"), // active | paused
  displayName: text("display_name"),                  // public name shown in customer wallet
  blurb: text("blurb"),                               // short description shown to customers
  allowCrossEarn: boolean("allow_cross_earn").notNull().default(true),
  allowCrossRedeem: boolean("allow_cross_redeem").notNull().default(true),
  // Limit: cross-redeem may cover at most N% of an order subtotal at another
  // network restaurant. 0..100. Stored as int for simplicity.
  crossRedeemMaxPct: integer("cross_redeem_max_pct").notNull().default(50),
  // Min order subtotal (₹) required before cross-redeem is allowed.
  crossRedeemMinOrder: decimal("cross_redeem_min_order", { precision: 10, scale: 2 }).notNull().default("0.00"),
  optedInAt: timestamp("opted_in_at").notNull().defaultNow(),
  optedOutAt: timestamp("opted_out_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqRestaurant: uniqueIndex("loyalty_network_members_restaurant_uniq").on(t.restaurantId),
}));

// Cross-restaurant ledger (placeholder — no real money movement).
// Records: a customer earned cashback at restaurant A and redeemed it at
// restaurant B. The settlement column is informational only.
export const loyaltyNetworkLedgerTable = pgTable("loyalty_network_ledger", {
  id: serial("id").primaryKey(),
  customerUserId: integer("customer_user_id").notNull().references(() => customerUsersTable.id, { onDelete: "cascade" }),
  fromRestaurantId: integer("from_restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  toRestaurantId: integer("to_restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),         // cross_redeem | cross_earn | settlement
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  reference: text("reference"),         // free-form (e.g. order #, voucher code)
  status: text("status").notNull().default("posted"), // posted | settled | reversed
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byCustomer: index("loyalty_network_ledger_customer_idx").on(t.customerUserId, t.createdAt),
  byRestaurant: index("loyalty_network_ledger_restaurant_idx").on(t.toRestaurantId, t.createdAt),
}));

export type CustomerUser = typeof customerUsersTable.$inferSelect;
export type CustomerUserLink = typeof customerUserLinksTable.$inferSelect;
export type CustomerOtp = typeof customerOtpsTable.$inferSelect;
export type LoyaltyNetworkMember = typeof loyaltyNetworkMembersTable.$inferSelect;
export type LoyaltyNetworkLedgerEntry = typeof loyaltyNetworkLedgerTable.$inferSelect;
