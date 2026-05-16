import { pgTable, text, serial, timestamp, integer, jsonb, boolean, decimal, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const fraudAlertsTable = pgTable("fraud_alerts", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  detector: text("detector").notNull(),
  severity: text("severity").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  subjectUserId: integer("subject_user_id").references(() => usersTable.id),
  subjectRole: text("subject_role"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  score: decimal("score", { precision: 10, scale: 2 }).notNull().default("0.00"),
  threshold: decimal("threshold", { precision: 10, scale: 2 }),
  observedValue: decimal("observed_value", { precision: 14, scale: 2 }),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  aiSummary: text("ai_summary"),
  aiSummaryFallback: boolean("ai_summary_fallback").notNull().default(false),
  dedupeKey: text("dedupe_key").notNull(),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  restaurantStatusIdx: index("fraud_alerts_restaurant_status_idx").on(t.restaurantId, t.status, t.createdAt),
  detectorIdx: index("fraud_alerts_detector_idx").on(t.restaurantId, t.detector, t.createdAt),
  dedupeUx: uniqueIndex("fraud_alerts_dedupe_ux").on(t.restaurantId, t.dedupeKey),
}));

export const fraudDetectorSettingsTable = pgTable("fraud_detector_settings", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  detector: text("detector").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  threshold: decimal("threshold", { precision: 14, scale: 2 }),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  restaurantDetectorUx: uniqueIndex("fraud_detector_settings_restaurant_detector_ux").on(t.restaurantId, t.detector),
}));

export const insertFraudAlertSchema = createInsertSchema(fraudAlertsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFraudAlert = z.infer<typeof insertFraudAlertSchema>;
export type FraudAlert = typeof fraudAlertsTable.$inferSelect;

export const insertFraudDetectorSettingSchema = createInsertSchema(fraudDetectorSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFraudDetectorSetting = z.infer<typeof insertFraudDetectorSettingSchema>;
export type FraudDetectorSetting = typeof fraudDetectorSettingsTable.$inferSelect;

export const FRAUD_DETECTORS = [
  "excessive_discounts",
  "void_bills",
  "cancelled_kots",
  "refund_abuse",
  "cash_mismatch",
  "manual_attendance_edits",
  "inventory_mismatch",
  "unusual_free_items",
  "coupon_abuse",
  "suspicious_discount",
] as const;
export type FraudDetector = typeof FRAUD_DETECTORS[number];

export const FRAUD_DETECTOR_DEFAULTS: Record<FraudDetector, { threshold: string; config: Record<string, unknown> }> = {
  excessive_discounts: { threshold: "20", config: { windowHours: 24, minOrders: 3 } },
  void_bills: { threshold: "3", config: { windowHours: 24 } },
  cancelled_kots: { threshold: "5", config: { windowHours: 24 } },
  refund_abuse: { threshold: "3", config: { windowDays: 7 } },
  cash_mismatch: { threshold: "500", config: {} },
  manual_attendance_edits: { threshold: "5", config: { windowDays: 7 } },
  inventory_mismatch: { threshold: "15", config: {} },
  unusual_free_items: { threshold: "3", config: { windowHours: 24 } },
  // Same coupon redeemed by the same customer (phone) >= threshold times in window.
  coupon_abuse: { threshold: "3", config: { windowDays: 7 } },
  // Single bill discount % > threshold (default 50%); also fires when the same
  // customer phone has reached the per-customer max-discount visit count.
  suspicious_discount: { threshold: "50", config: { windowDays: 7, perCustomerMaxVisits: 5, perCustomerVisitDiscountPct: 30 } },
};
