/**
 * Task #587 — Offline vs Online payment refactor.
 *
 * Three tables that together replace the old free-text mix of payment modes
 * with a clean per-restaurant categorisation:
 *
 *   payment_methods             — list of methods enabled for a restaurant,
 *                                  each tagged with category (offline|online)
 *                                  + type (cash | counter_card | counter_upi |
 *                                  cod | bank_transfer | pay_later |
 *                                  pay_at_counter | platform_gateway |
 *                                  own_gateway | manual_upi).
 *   restaurant_payment_settings — one row per restaurant: which offline/online
 *                                  groups are on, which online source the
 *                                  customer should be routed through.
 *   manual_upi_settings         — Restaurant Own Manual UPI configuration:
 *                                  UPI ID/VPA, merchant name, QR/intent flags,
 *                                  UTR + screenshot capture rules.
 *
 * The customer-checkout endpoint collapses all of this into the two
 * top-level choices the diner actually sees (`pay_at_counter` +
 * a list of enabled online methods).
 *
 * Offline modes are NEVER exposed to the customer at QR / online checkout —
 * they're only visible to staff in the POS counter flow.
 */
import { pgTable, text, serial, integer, boolean, timestamp, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";

/** category + type taxonomy */
export const PAYMENT_CATEGORIES = ["offline", "online"] as const;
export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];

export const OFFLINE_PAYMENT_TYPES = [
  "cash",
  "counter_card",
  "counter_upi",
  "cod",
  "bank_transfer",
  "pay_later",
  "pay_at_counter",
] as const;
export const ONLINE_PAYMENT_TYPES = [
  "platform_gateway",
  "own_gateway",
  "manual_upi",
] as const;
export type OfflinePaymentType = (typeof OFFLINE_PAYMENT_TYPES)[number];
export type OnlinePaymentType = (typeof ONLINE_PAYMENT_TYPES)[number];
export type PaymentMethodType = OfflinePaymentType | OnlinePaymentType;

/** which online source customers are routed through when they pick Pay Online */
export const ONLINE_PAYMENT_SOURCES = [
  "platform_gateway",
  "own_gateway",
  "manual_upi",
  "mixed",
] as const;
export type OnlinePaymentSource = (typeof ONLINE_PAYMENT_SOURCES)[number];

/**
 * Per-restaurant enabled methods. Each row is one method; UI groups them by
 * `category`. Soft-delete via `isEnabled=false` rather than DELETE so audit
 * history of past changes is preserved.
 */
export const paymentMethodsTable = pgTable("payment_methods", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // offline | online
  type: text("type").notNull(),         // see PaymentMethodType
  label: text("label"),                  // optional human override (e.g. "Card machine — counter 2")
  isEnabled: boolean("is_enabled").notNull().default(true),
  gatewayCode: text("gateway_code"),     // razorpay | cashfree | stripe | phonepe | payu | paytm | … (only for online rows that route through a named gateway)
  sortOrder: integer("sort_order").notNull().default(0),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  uqRestaurantType: uniqueIndex("payment_methods_uq_restaurant_type").on(t.restaurantId, t.category, t.type, t.gatewayCode),
  restaurantIdx: index("payment_methods_restaurant_idx").on(t.restaurantId),
}));

/**
 * Singleton-per-restaurant settings row controlling the top-level Offline /
 * Online toggles and which online source the checkout endpoint should
 * advertise. `online_payment_source` mirrors the admin's grouping decision:
 *   platform_gateway — restaurant uses the platform-managed gateways only
 *   own_gateway      — restaurant has its own Razorpay/Cashfree/Stripe keys
 *   manual_upi       — restaurant only takes Manual UPI online
 *   mixed            — any combination of the above
 */
export const restaurantPaymentSettingsTable = pgTable("restaurant_payment_settings", {
  restaurantId: integer("restaurant_id").primaryKey().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  offlineEnabled: boolean("offline_enabled").notNull().default(true),
  onlineEnabled: boolean("online_enabled").notNull().default(false),
  onlinePaymentSource: text("online_payment_source").notNull().default("platform_gateway"),
  // Convenience: which top-level option is the customer's default when both
  // are available. Customers can still pick either; this just preselects
  // the radio on first paint.
  defaultCustomerChoice: text("default_customer_choice").notNull().default("pay_at_counter"),
  updatedBy: integer("updated_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Restaurant's own Manual UPI configuration. Lives under
 * "Online > Restaurant Own Payment Method" (not offline, not a platform gateway).
 *
 * `upiId` is sensitive enough to keep behind a getter (callers should never
 * dump this raw to logs). Verification rules — require UTR? allow optional
 * screenshot? auto-confirm under amount X? — live here so admins can tune
 * without code changes.
 */
export const manualUpiSettingsTable = pgTable("manual_upi_settings", {
  restaurantId: integer("restaurant_id").primaryKey().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  // `upi_id` kept for backward compatibility but new writes go to the
  // encrypted-at-rest columns below (AES-256-GCM via aiEncryption.ts). The
  // app-layer code prefers cipher when present and only falls back to the
  // plaintext column for rows seeded before encryption was wired up.
  upiId: text("upi_id"),                     // legacy / fallback; do not write going forward
  upiIdCipher: text("upi_id_cipher"),        // base64 AES-256-GCM cipher text
  upiIdIv: text("upi_id_iv"),                // base64 12-byte IV
  upiIdTag: text("upi_id_tag"),              // base64 16-byte auth tag
  merchantName: text("merchant_name"),
  enableDynamicQr: boolean("enable_dynamic_qr").notNull().default(true),
  enableStaticQr: boolean("enable_static_qr").notNull().default(false),
  staticQrUrl: text("static_qr_url"),
  enableIntentLink: boolean("enable_intent_link").notNull().default(true),
  enableCopyUpiId: boolean("enable_copy_upi_id").notNull().default(true),
  requireUtr: boolean("require_utr").notNull().default(true),
  allowScreenshotUpload: boolean("allow_screenshot_upload").notNull().default(true),
  autoConfirmUnderAmount: integer("auto_confirm_under_amount"), // in minor units (paise); null = never auto-confirm
  notes: text("notes"),
  updatedBy: integer("updated_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PaymentMethod = typeof paymentMethodsTable.$inferSelect;
export type InsertPaymentMethod = typeof paymentMethodsTable.$inferInsert;
export type RestaurantPaymentSettings = typeof restaurantPaymentSettingsTable.$inferSelect;
export type ManualUpiSettings = typeof manualUpiSettingsTable.$inferSelect;
