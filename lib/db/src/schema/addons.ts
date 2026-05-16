import { pgTable, text, serial, timestamp, integer, boolean, decimal, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable } from "./tenants";

export const addonsTable = pgTable("addons", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  longDescription: text("long_description").notNull().default(""),
  icon: text("icon").notNull().default("Package"),
  category: text("category").notNull().default("growth"),
  pricing: jsonb("pricing").$type<{
    mode: "free" | "monthly" | "yearly" | "monthly_yearly" | "one_off";
    monthlyPrice?: number;
    yearlyPrice?: number;
    oneOffPrice?: number;
    currency?: string;
  }>().notNull().default({ mode: "free" }),
  trialDays: integer("trial_days").notNull().default(0),
  includedInPlanIds: integer("included_in_plan_ids").array().notNull().default(sql`ARRAY[]::integer[]`),
  eligiblePlanIds: integer("eligible_plan_ids").array().notNull().default(sql`ARRAY[]::integer[]`),
  featureFlags: text("feature_flags").array().notNull().default(sql`ARRAY[]::text[]`),
  comingSoon: boolean("coming_soon").notNull().default(false),
  isEnabled: boolean("is_enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  keyIdx: uniqueIndex("addons_key_idx").on(t.key),
}));

export const tenantAddonsTable = pgTable("tenant_addons", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  addonId: integer("addon_id").notNull().references(() => addonsTable.id, { onDelete: "cascade" }),
  addonKey: text("addon_key").notNull(),
  status: text("status").notNull().default("active"), // trial | active | cancelled | expired
  source: text("source").notNull().default("self"),  // self | admin | included_in_plan | comp
  billingCycle: text("billing_cycle"),               // monthly | yearly | one_off | null
  pricePaid: decimal("price_paid", { precision: 12, scale: 2 }),
  currency: text("currency"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  trialEndsAt: timestamp("trial_ends_at"),
  currentPeriodEndsAt: timestamp("current_period_ends_at"),
  cancelledAt: timestamp("cancelled_at"),
  lastPaymentRef: text("last_payment_ref"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  tenantAddonIdx: uniqueIndex("tenant_addons_tenant_addon_idx").on(t.tenantId, t.addonId),
  tenantIdx: index("tenant_addons_tenant_idx").on(t.tenantId),
  statusIdx: index("tenant_addons_status_idx").on(t.status),
}));

export const addonEventsTable = pgTable("addon_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  addonId: integer("addon_id").references(() => addonsTable.id, { onDelete: "set null" }),
  addonKey: text("addon_key").notNull(),
  eventType: text("event_type").notNull(),
  // install | uninstall | trial_start | trial_end | trial_converted | activate
  // | deactivate | payment | admin_override | comp | extend_trial | catalogue_disabled
  source: text("source").notNull().default("system"), // self | admin | system | webhook
  actorUserId: integer("actor_user_id"),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  currency: text("currency"),
  paymentRef: text("payment_ref"),
  notes: text("notes"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: index("addon_events_tenant_idx").on(t.tenantId, t.createdAt),
  addonIdx: index("addon_events_addon_idx").on(t.addonKey, t.createdAt),
  typeIdx: index("addon_events_type_idx").on(t.eventType, t.createdAt),
}));

export type Addon = typeof addonsTable.$inferSelect;
export type TenantAddon = typeof tenantAddonsTable.$inferSelect;
export type AddonEvent = typeof addonEventsTable.$inferSelect;
