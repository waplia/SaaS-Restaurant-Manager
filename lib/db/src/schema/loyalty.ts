import { pgTable, text, serial, timestamp, integer, boolean, decimal, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { customersTable } from "./customers";

export const loyaltyStampCardsTable = pgTable("loyalty_stamp_cards", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  cardKey: text("card_key").notNull(),
  stamps: integer("stamps").notNull().default(0),
  completions: integer("completions").notNull().default(0),
  lastStampedAt: timestamp("last_stamped_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("loyalty_stamp_cards_unique").on(t.restaurantId, t.customerId, t.cardKey),
}));

export const loyaltyCashbackWalletsTable = pgTable("loyalty_cashback_wallets", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  balance: decimal("balance", { precision: 10, scale: 2 }).notNull().default("0.00"),
  lifetimeIssued: decimal("lifetime_issued", { precision: 10, scale: 2 }).notNull().default("0.00"),
  lifetimeRedeemed: decimal("lifetime_redeemed", { precision: 10, scale: 2 }).notNull().default("0.00"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("loyalty_cashback_wallets_unique").on(t.restaurantId, t.customerId),
}));

export const loyaltyCashbackTxnsTable = pgTable("loyalty_cashback_txns", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  type: text("type").notNull(),
  reason: text("reason"),
  orderId: integer("order_id"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byCustomer: index("loyalty_cashback_txns_by_customer").on(t.restaurantId, t.customerId),
}));

export const loyaltyReferralCodesTable = pgTable("loyalty_referral_codes", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  code: text("code").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqCust: uniqueIndex("loyalty_referral_codes_customer").on(t.restaurantId, t.customerId),
  uniqCode: uniqueIndex("loyalty_referral_codes_code").on(t.restaurantId, t.code),
}));

export const loyaltyReferralsTable = pgTable("loyalty_referrals", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  referrerId: integer("referrer_id").notNull().references(() => customersTable.id),
  refereeId: integer("referee_id").notNull().references(() => customersTable.id),
  code: text("code").notNull(),
  status: text("status").notNull().default("pending"),
  rewardSummary: jsonb("reward_summary").$type<Record<string, unknown>>(),
  convertedAt: timestamp("converted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqRel: uniqueIndex("loyalty_referrals_unique").on(t.restaurantId, t.referrerId, t.refereeId),
}));

export const loyaltyMysteryGrantsTable = pgTable("loyalty_mystery_grants", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  rewardKey: text("reward_key").notNull(),
  rewardLabel: text("reward_label").notNull(),
  rewardData: jsonb("reward_data").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("granted"),
  revealedAt: timestamp("revealed_at"),
  redeemedAt: timestamp("redeemed_at"),
  expiresAt: timestamp("expires_at"),
  orderId: integer("order_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loyaltyStreakStateTable = pgTable("loyalty_streak_state", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  windowKind: text("window_kind").notNull().default("day"),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastVisitAt: timestamp("last_visit_at"),
  lastRewardedAt: timestamp("last_rewarded_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("loyalty_streak_state_unique").on(t.restaurantId, t.customerId),
}));

export const loyaltyMilestoneGrantsTable = pgTable("loyalty_milestone_grants", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  milestoneKey: text("milestone_key").notNull(),
  threshold: decimal("threshold", { precision: 12, scale: 2 }).notNull(),
  rewardSummary: jsonb("reward_summary").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("loyalty_milestone_grants_unique").on(t.restaurantId, t.customerId, t.milestoneKey),
}));

export const loyaltyBirthdayGrantsTable = pgTable("loyalty_birthday_grants", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  yearKey: text("year_key").notNull(),
  rewardSummary: jsonb("reward_summary").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("loyalty_birthday_grants_unique").on(t.restaurantId, t.customerId, t.yearKey),
}));

export const loyaltyFamilyGroupsTable = pgTable("loyalty_family_groups", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  primaryCustomerId: integer("primary_customer_id").notNull().references(() => customersTable.id),
  name: text("name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqPrimary: uniqueIndex("loyalty_family_groups_primary").on(t.restaurantId, t.primaryCustomerId),
}));

export const loyaltyFamilyMembersTable = pgTable("loyalty_family_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => loyaltyFamilyGroupsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqMember: uniqueIndex("loyalty_family_members_unique").on(t.restaurantId, t.customerId),
}));

export const loyaltyAuditLogTable = pgTable("loyalty_audit_log", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  actorId: integer("actor_id"),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("loyalty_audit_log_by_restaurant").on(t.restaurantId, t.createdAt),
}));

export type LoyaltyStampCard = typeof loyaltyStampCardsTable.$inferSelect;
export type LoyaltyCashbackWallet = typeof loyaltyCashbackWalletsTable.$inferSelect;
export type LoyaltyCashbackTxn = typeof loyaltyCashbackTxnsTable.$inferSelect;
export type LoyaltyReferralCode = typeof loyaltyReferralCodesTable.$inferSelect;
export type LoyaltyReferral = typeof loyaltyReferralsTable.$inferSelect;
export type LoyaltyMysteryGrant = typeof loyaltyMysteryGrantsTable.$inferSelect;
export type LoyaltyStreakState = typeof loyaltyStreakStateTable.$inferSelect;
export type LoyaltyMilestoneGrant = typeof loyaltyMilestoneGrantsTable.$inferSelect;
export type LoyaltyBirthdayGrant = typeof loyaltyBirthdayGrantsTable.$inferSelect;
export type LoyaltyFamilyGroup = typeof loyaltyFamilyGroupsTable.$inferSelect;
export type LoyaltyFamilyMember = typeof loyaltyFamilyMembersTable.$inferSelect;
export type LoyaltyAuditEntry = typeof loyaltyAuditLogTable.$inferSelect;
