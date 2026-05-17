import { pgTable, text, serial, timestamp, integer, boolean, decimal, date, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  totalOrders: integer("total_orders").notNull().default(0),
  totalSpent: decimal("total_spent", { precision: 10, scale: 2 }).notNull().default("0.00"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  isVip: boolean("is_vip").notNull().default(false),
  isBlacklisted: boolean("is_blacklisted").notNull().default(false),
  blacklistReason: text("blacklist_reason"),
  blacklistedAt: timestamp("blacklisted_at"),
  blacklistedByUserId: integer("blacklisted_by_user_id"),
  dateOfBirth: text("date_of_birth"),
  noShowCount: integer("no_show_count").notNull().default(0),
  lastNoShowAt: timestamp("last_no_show_at"),
  // Task #431 — guest CRM upgrade
  allergies: text("allergies"),
  preferredTableId: integer("preferred_table_id"),
  // Task #209 — CRM upgrade: contact preferences, milestones, derived activity.
  birthday: date("birthday"),
  anniversary: date("anniversary"),
  preferredChannel: text("preferred_channel").notNull().default("none"), // whatsapp | sms | email | call | none
  whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
  whatsappOptInAt: timestamp("whatsapp_opt_in_at"),
  whatsappOptInSource: text("whatsapp_opt_in_source"),
  firstOrderAt: timestamp("first_order_at"),
  lastVisitAt: timestamp("last_visit_at"),
  // Task #414 — Email Center: per-customer marketing consent for email.
  emailMarketingOptIn: boolean("email_marketing_opt_in").notNull().default(false),
  emailMarketingOptInSource: text("email_marketing_opt_in_source"),
  emailMarketingOptInAt: timestamp("email_marketing_opt_in_at"),
  emailUnsubscribed: boolean("email_unsubscribed").notNull().default(false),
  emailUnsubscribedAt: timestamp("email_unsubscribed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Task #209 — restaurant-scoped tag dictionary so tags autocomplete from
// previously-used values and don't leak across restaurants.
export const customerTagsTable = pgTable("customer_tags", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("customer_tags_restaurant_name_idx").on(t.restaurantId, t.name),
}));

export const customerTagAssignmentsTable = pgTable("customer_tag_assignments", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  tagId: integer("tag_id").notNull().references(() => customerTagsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("customer_tag_assignments_uniq_idx").on(t.customerId, t.tagId),
  byCustomer: index("customer_tag_assignments_customer_idx").on(t.customerId),
  byTag: index("customer_tag_assignments_tag_idx").on(t.tagId),
}));

// Append-only timestamped notes log (replaces single notes column for new writes).
export const customerNotesTable = pgTable("customer_notes", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  authorUserId: integer("author_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byCustomer: index("customer_notes_customer_idx").on(t.customerId, t.createdAt),
}));

export const customerComplaintsTable = pgTable("customer_complaints", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("in_person"), // in_person | phone | whatsapp | email | review
  summary: text("summary").notNull(),
  details: text("details"),
  status: text("status").notNull().default("open"), // open | in_progress | resolved
  handledByUserId: integer("handled_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at"),
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byCustomer: index("customer_complaints_customer_idx").on(t.customerId, t.createdAt),
  byStatus: index("customer_complaints_restaurant_status_idx").on(t.restaurantId, t.status),
}));

export const insertCustomerTagSchema = createInsertSchema(customerTagsTable).omit({ id: true, createdAt: true });
export type CustomerTag = typeof customerTagsTable.$inferSelect;
export type CustomerTagAssignment = typeof customerTagAssignmentsTable.$inferSelect;

export const insertCustomerNoteSchema = createInsertSchema(customerNotesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type CustomerNote = typeof customerNotesTable.$inferSelect;

export const insertCustomerComplaintSchema = createInsertSchema(customerComplaintsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type CustomerComplaint = typeof customerComplaintsTable.$inferSelect;

export const loyaltyPointsTable = pgTable("loyalty_points", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  balance: integer("balance").notNull().default(0),
  lifetimeEarned: integer("lifetime_earned").notNull().default(0),
  lifetimeRedeemed: integer("lifetime_redeemed").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const loyaltyTransactionsTable = pgTable("loyalty_transactions", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  points: integer("points").notNull(),
  type: text("type").notNull().default("earn"),
  reason: text("reason"),
  orderId: integer("order_id"),
  expiresAt: timestamp("expires_at"),
  expiredAt: timestamp("expired_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const couponsTable = pgTable("coupons", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  code: text("code").notNull(),
  discountType: text("discount_type").notNull().default("percentage"),
  discountValue: decimal("discount_value", { precision: 10, scale: 2 }).notNull(),
  minOrderAmount: decimal("min_order_amount", { precision: 10, scale: 2 }).default("0.00"),
  maxDiscountAmount: decimal("max_discount_amount", { precision: 10, scale: 2 }),
  usageLimit: integer("usage_limit"),
  usageCount: integer("usage_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  validFrom: timestamp("valid_from").notNull().defaultNow(),
  validTo: timestamp("valid_to"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const customerAddressesTable = pgTable("customer_addresses", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  label: text("label").notNull().default("Home"),
  address: text("address").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCustomerAddressSchema = createInsertSchema(customerAddressesTable).omit({ id: true, createdAt: true });
export type InsertCustomerAddress = z.infer<typeof insertCustomerAddressSchema>;
export type CustomerAddress = typeof customerAddressesTable.$inferSelect;

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  entityId: integer("entity_id"),
  entityType: text("entity_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLoyaltyPointsSchema = createInsertSchema(loyaltyPointsTable).omit({ id: true, updatedAt: true });
export type InsertLoyaltyPoints = z.infer<typeof insertLoyaltyPointsSchema>;
export type LoyaltyPoints = typeof loyaltyPointsTable.$inferSelect;

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;

export const insertLoyaltyTransactionSchema = createInsertSchema(loyaltyTransactionsTable).omit({ id: true, createdAt: true });
export type InsertLoyaltyTransaction = z.infer<typeof insertLoyaltyTransactionSchema>;
export type LoyaltyTransaction = typeof loyaltyTransactionsTable.$inferSelect;

export const insertCouponSchema = createInsertSchema(couponsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCoupon = z.infer<typeof insertCouponSchema>;
export type Coupon = typeof couponsTable.$inferSelect;

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
