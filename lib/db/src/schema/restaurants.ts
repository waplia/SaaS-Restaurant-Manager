import { pgTable, text, serial, timestamp, integer, boolean, decimal } from "drizzle-orm/pg-core";
// Payment methods accepted at billing — stored as a string[] so the bill UI can
// hide unused tenders. Defaults cover the typical Indian dine-in setup.
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const restaurantsTable = pgTable("restaurants", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  country: text("country").default("IN"),
  timezone: text("timezone").default("Asia/Kolkata"),
  currency: text("currency").default("INR"),
  logoUrl: text("logo_url"),
  coverImageUrl: text("cover_image_url"),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).default("5.00"),
  serviceCharge: decimal("service_charge", { precision: 5, scale: 2 }).default("0.00"),
  isActive: boolean("is_active").notNull().default(true),
  openingTime: text("opening_time").default("09:00"),
  closingTime: text("closing_time").default("22:00"),
  autoReorderEnabled: boolean("auto_reorder_enabled").notNull().default(true),
  autoReorderCron: text("auto_reorder_cron").default("0 6 * * *"),
  enableVoiceOrdering: boolean("enable_voice_ordering").notNull().default(false),
  bakeryModeEnabled: boolean("bakery_mode_enabled").notNull().default(false),
  bakeryDefaultShelfLifeHours: integer("bakery_default_shelf_life_hours").notNull().default(24),
  bakeryExpiryAlertHours: integer("bakery_expiry_alert_hours").notNull().default(6),
  bakeryBookingAlertHours: integer("bakery_booking_alert_hours").notNull().default(24),
  acceptedPaymentMethods: text("accepted_payment_methods").array().notNull().default(["cash", "upi", "card"]),
  whatsappMonthlyLimitOverride: integer("whatsapp_monthly_limit_override"),
  googleReviewLink: text("google_review_link"),
  // When true, this outlet runs in "Hotel Restaurant Mode" — POS exposes
  // room/guest pickers, room-charge settlement, and folio rollups.
  isHotelMode: boolean("is_hotel_mode").notNull().default(false),
  // Bar / Pub mode — gates liquor SKUs, peg/bottle variants, bartender
  // settlement, bar KOTs, and the liquor report.
  //   'restaurant' — default food-service mode; bar features hidden.
  //   'bar'        — bar-only outlet; food workflows still available.
  //   'hybrid'     — restaurant + bar (kitchen + bar stations).
  serviceMode: text("service_mode").notNull().default("restaurant"),
  // Canteen mode (Task #203) — when true, the canteen module is available
  // (students, ID-card QR wallets, parent dashboard, counter POS).
  canteenModeEnabled: boolean("canteen_mode_enabled").notNull().default(false),
  // Default daily spending cap for students (paise). 0 = no cap.
  canteenDefaultDailyCap: integer("canteen_default_daily_cap").notNull().default(0),
  // Default low-balance alert threshold (paise).
  canteenLowBalanceThreshold: integer("canteen_low_balance_threshold").notNull().default(5000),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const branchesTable = pgTable("branches", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  isMain: boolean("is_main").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  cloudKitchenEnabled: boolean("cloud_kitchen_enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRestaurantSchema = createInsertSchema(restaurantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRestaurant = z.infer<typeof insertRestaurantSchema>;
export type Restaurant = typeof restaurantsTable.$inferSelect;

export const insertBranchSchema = createInsertSchema(branchesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBranch = z.infer<typeof insertBranchSchema>;
export type Branch = typeof branchesTable.$inferSelect;
