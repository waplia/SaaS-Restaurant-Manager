/**
 * Canteen module (Task #203) — schools/colleges canteen.
 *
 * A canteen is a special operating mode for a restaurant tenant where
 * students are the customers, ID-card QRs identify them, and parents
 * pre-fund a stored-value wallet. Counter staff scan QR → see balance,
 * daily caps, and item restrictions, then debit the wallet on sale.
 *
 * Money is stored as integer minor units (paise) on `studentsTable.balance`
 * and per-row in the ledger. All atomic mutations live in `routes/canteen.ts`.
 */
import {
  pgTable, text, serial, timestamp, integer, boolean, bigint, jsonb,
  uniqueIndex, index, date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";
import { menuItemsTable, menuCategoriesTable } from "./menu";

export const studentsTable = pgTable("canteen_students", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  studentCode: text("student_code").notNull(), // school enrollment id
  qrToken: text("qr_token").notNull(),         // printed on ID card
  name: text("name").notNull(),
  className: text("class_name"),
  section: text("section"),
  rollNumber: text("roll_number"),
  photoUrl: text("photo_url"),
  // Stored-value balance in paise. Mutated only via student_wallet_txns rows.
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  lifetimeIn: bigint("lifetime_in", { mode: "number" }).notNull().default(0),
  lifetimeOut: bigint("lifetime_out", { mode: "number" }).notNull().default(0),
  // Per-student daily spending cap override (paise). NULL → use restaurant default.
  dailyCap: bigint("daily_cap", { mode: "number" }),
  // Per-student low-balance alert threshold (paise). NULL → use restaurant default.
  lowBalanceThreshold: bigint("low_balance_threshold", { mode: "number" }),
  isActive: boolean("is_active").notNull().default(true),
  isFrozen: boolean("is_frozen").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  qrUniq: uniqueIndex("canteen_students_qr_uniq").on(t.qrToken),
  codeUniq: uniqueIndex("canteen_students_code_uniq").on(t.restaurantId, t.studentCode),
  restaurantIdx: index("canteen_students_restaurant_idx").on(t.restaurantId),
}));

export const studentGuardiansTable = pgTable("canteen_student_guardians", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  // Optional link to a user account so the guardian can log in (role=parent).
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  relation: text("relation"),
  phone: text("phone"),
  email: text("email"),
  // Magic-link token: lets a parent view their student's dashboard without an
  // account (we send a link via email/SMS/WhatsApp). Rotatable.
  parentToken: text("parent_token").notNull(),
  // Notification preferences.
  notifyEmail: boolean("notify_email").notNull().default(true),
  notifySms: boolean("notify_sms").notNull().default(true),
  notifyWhatsapp: boolean("notify_whatsapp").notNull().default(false),
  isPrimary: boolean("is_primary").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  studentIdx: index("canteen_guardian_student_idx").on(t.studentId),
  tokenUniq: uniqueIndex("canteen_guardian_token_uniq").on(t.parentToken),
  userIdx: index("canteen_guardian_user_idx").on(t.userId),
}));

export const studentWalletTxnsTable = pgTable("canteen_student_wallet_txns", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // credit | debit
  amount: bigint("amount", { mode: "number" }).notNull(),
  type: text("type").notNull(),
  // top_up | order_payment | refund | adjustment | meal_plan_charge
  channel: text("channel"),
  // cash | upi | gateway | razorpay | cashfree | stripe | manual
  externalRef: text("external_ref"),
  referenceType: text("reference_type"),
  referenceId: integer("reference_id"),
  openingBalance: bigint("opening_balance", { mode: "number" }).notNull(),
  closingBalance: bigint("closing_balance", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  studentIdx: index("canteen_wtxn_student_idx").on(t.studentId, t.createdAt),
  restaurantIdx: index("canteen_wtxn_restaurant_idx").on(t.restaurantId, t.createdAt),
  idemUniq: uniqueIndex("canteen_wtxn_idempotency_idx").on(t.studentId, t.idempotencyKey),
}));

// Restriction list — items or whole categories that a specific student
// is NOT allowed to buy (e.g. allergy, parent/school policy). One row per
// banned target.
export const studentRestrictionsTable = pgTable("canteen_student_restrictions", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),       // item | category
  menuItemId: integer("menu_item_id").references(() => menuItemsTable.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").references(() => menuCategoriesTable.id, { onDelete: "cascade" }),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  studentIdx: index("canteen_restr_student_idx").on(t.studentId),
}));

// Restaurant-wide item restrictions (e.g. ban junk food across the canteen).
export const canteenItemRestrictionsTable = pgTable("canteen_item_restrictions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(), // item | category
  menuItemId: integer("menu_item_id").references(() => menuItemsTable.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").references(() => menuCategoriesTable.id, { onDelete: "cascade" }),
  // Optional class-level scoping: if set, only students in this className
  // are blocked. NULL = applies to all students.
  appliesToClass: text("applies_to_class"),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const canteenMealPlansTable = pgTable("canteen_meal_plans", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // Daily allowance (paise) charged per active day from the wallet.
  dailyAllowance: bigint("daily_allowance", { mode: "number" }).notNull().default(0),
  // Monthly subscription price (paise). When set, parent pays this and gets
  // free meals up to dailyAllowance per day.
  monthlyPrice: bigint("monthly_price", { mode: "number" }).notNull().default(0),
  daysOfWeek: text("days_of_week").notNull().default("1,2,3,4,5"),
  mealType: text("meal_type").notNull().default("lunch"), // breakfast | lunch | snacks | dinner
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const canteenMealPlanSubsTable = pgTable("canteen_meal_plan_subscriptions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  planId: integer("plan_id").notNull().references(() => canteenMealPlansTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"), // active | paused | cancelled
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  studentIdx: index("canteen_mps_student_idx").on(t.studentId, t.status),
}));

export const canteenOrdersTable = pgTable("canteen_orders", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  orderNumber: text("order_number").notNull(),
  total: bigint("total", { mode: "number" }).notNull(),
  paymentSource: text("payment_source").notNull().default("wallet"), // wallet | cash | meal_plan
  walletTxnId: integer("wallet_txn_id").references(() => studentWalletTxnsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("completed"), // completed | refunded | cancelled
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  counterName: text("counter_name"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  studentIdx: index("canteen_orders_student_idx").on(t.studentId, t.createdAt),
  restaurantIdx: index("canteen_orders_restaurant_idx").on(t.restaurantId, t.createdAt),
  numberUniq: uniqueIndex("canteen_orders_number_uniq").on(t.restaurantId, t.orderNumber),
}));

export const canteenOrderItemsTable = pgTable("canteen_order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => canteenOrdersTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  menuItemId: integer("menu_item_id").references(() => menuItemsTable.id, { onDelete: "set null" }),
  itemName: text("item_name").notNull(),
  unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  lineTotal: bigint("line_total", { mode: "number" }).notNull(),
}, t => ({
  orderIdx: index("canteen_oi_order_idx").on(t.orderId),
}));

// ─── Zod insert schemas / inferred types ──────────────────────────────────

export const insertStudentSchema = createInsertSchema(studentsTable).omit({
  id: true, balance: true, lifetimeIn: true, lifetimeOut: true,
  qrToken: true, createdAt: true, updatedAt: true,
});
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Student = typeof studentsTable.$inferSelect;

export const insertGuardianSchema = createInsertSchema(studentGuardiansTable).omit({
  id: true, parentToken: true, createdAt: true,
});
export type InsertGuardian = z.infer<typeof insertGuardianSchema>;
export type StudentGuardian = typeof studentGuardiansTable.$inferSelect;

export const insertCanteenMealPlanSchema = createInsertSchema(canteenMealPlansTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertCanteenMealPlan = z.infer<typeof insertCanteenMealPlanSchema>;
export type CanteenMealPlan = typeof canteenMealPlansTable.$inferSelect;

export type CanteenOrder = typeof canteenOrdersTable.$inferSelect;
export type CanteenOrderItem = typeof canteenOrderItemsTable.$inferSelect;
export type StudentWalletTxn = typeof studentWalletTxnsTable.$inferSelect;
