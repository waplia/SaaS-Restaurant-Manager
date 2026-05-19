import { pgTable, serial, integer, text, timestamp, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";
import { restaurantsTable } from "./restaurants";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { usersTable } from "./users";

export type WebPushSubscriptionStatus = "active" | "unsubscribed" | "expired" | "failed";
export type WebPushAudience = "customers" | "staff" | "diners_only" | "marketing_opted_in";
export type WebPushCampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";

/**
 * Browser Web Push subscriptions. Created from QR menu, customer wallet,
 * marketing site, restaurant-admin staff PWA, or super-admin shell. A single
 * endpoint identifies a browser+origin globally; we upsert by endpoint.
 *
 * Consent is split into transactional (`orderUpdatesOptIn`) and marketing
 * (`marketingOptIn`) — the customer must opt in to each separately. The
 * `audience` field declares the surface ("customers" for the QR-menu/wallet,
 * "staff" for restaurant-admin/super-admin staff devices).
 */
export const webPushSubscriptionsTable = pgTable(
  "web_push_subscriptions",
  {
    id: serial("id").primaryKey(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    audience: text("audience").$type<WebPushAudience>().notNull().default("customers"),
    status: text("status").$type<WebPushSubscriptionStatus>().notNull().default("active"),
    tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
    orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
    tableId: integer("table_id"),
    orderUpdatesOptIn: boolean("order_updates_opt_in").notNull().default(true),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    userAgent: text("user_agent"),
    browser: text("browser"),
    device: text("device"),
    locale: text("locale"),
    failureCount: integer("failure_count").notNull().default(0),
    lastFailureAt: timestamp("last_failure_at"),
    lastFailureReason: text("last_failure_reason"),
    lastSentAt: timestamp("last_sent_at"),
    unsubscribedAt: timestamp("unsubscribed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("web_push_subscriptions_endpoint_idx").on(t.endpoint),
    index("web_push_subscriptions_order_idx").on(t.orderId),
    index("web_push_subscriptions_restaurant_idx").on(t.restaurantId),
    index("web_push_subscriptions_customer_idx").on(t.customerId),
    index("web_push_subscriptions_status_idx").on(t.status),
  ],
);

/**
 * Per-restaurant Web Push controls. One row per restaurant (upserted lazily).
 * Restaurant admins flip per-feature toggles and set safe-send caps; they
 * never see or set provider credentials (those live on app_settings and
 * are owned by super-admin only).
 *
 * `features` is a free-form JSON map of feature keys → boolean. Known keys
 * (rendered in the UI in this order):
 *   order_updates, marketing, review_requests, loyalty, staff_alerts,
 *   ai_insights, support, reservations
 */
export const webPushSettingsTable = pgTable(
  "web_push_settings",
  {
    restaurantId: integer("restaurant_id").primaryKey().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    features: jsonb("features").$type<Record<string, boolean>>().notNull().default({}),
    quietHoursStart: text("quiet_hours_start"),
    quietHoursEnd: text("quiet_hours_end"),
    dailyCap: integer("daily_cap"),
    monthlyCap: integer("monthly_cap"),
    perCustomerDailyCap: integer("per_customer_daily_cap").notNull().default(3),
    minCampaignGapMinutes: integer("min_campaign_gap_minutes").notNull().default(60),
    allowRichImages: boolean("allow_rich_images").notNull().default(true),
    requireMarketingOptIn: boolean("require_marketing_opt_in").notNull().default(true),
    defaultClickUrl: text("default_click_url"),
    lastTestAt: timestamp("last_test_at"),
    lastTestStatus: text("last_test_status"),
    lastTestError: text("last_test_error"),
    updatedBy: integer("updated_by").references(() => usersTable.id),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);

/**
 * Per-restaurant notification templates for transactional + marketing pushes.
 * `eventKey` ties a template to a lifecycle hook (e.g. "order.accepted",
 * "loyalty.coupon_expiring"). The sender picks the active template by
 * (restaurantId, eventKey, isActive=true).
 */
export const webPushTemplatesTable = pgTable(
  "web_push_templates",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    iconUrl: text("icon_url"),
    imageUrl: text("image_url"),
    clickUrl: text("click_url"),
    variables: jsonb("variables").$type<string[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("web_push_templates_restaurant_event_idx").on(t.restaurantId, t.eventKey)],
);

/**
 * Marketing campaigns built and sent by restaurant admins from Growth
 * Engine. Targets are a JSON segment definition; the sender resolves the
 * audience at dispatch time. Analytics live on this row + per-recipient
 * rows in `web_push_campaign_recipients`.
 */
export const webPushCampaignsTable = pgTable(
  "web_push_campaigns",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    iconUrl: text("icon_url"),
    imageUrl: text("image_url"),
    clickUrl: text("click_url"),
    templateId: integer("template_id").references(() => webPushTemplatesTable.id, { onDelete: "set null" }),
    segment: jsonb("segment").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<WebPushCampaignStatus>().notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at"),
    sentAt: timestamp("sent_at"),
    targetedCount: integer("targeted_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    clickedCount: integer("clicked_count").notNull().default(0),
    unsubscribedCount: integer("unsubscribed_count").notNull().default(0),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("web_push_campaigns_restaurant_idx").on(t.restaurantId)],
);

export const webPushCampaignRecipientsTable = pgTable(
  "web_push_campaign_recipients",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id").notNull().references(() => webPushCampaignsTable.id, { onDelete: "cascade" }),
    subscriptionId: integer("subscription_id").references(() => webPushSubscriptionsTable.id, { onDelete: "set null" }),
    status: text("status").notNull().default("queued"),
    error: text("error"),
    sentAt: timestamp("sent_at"),
    clickedAt: timestamp("clicked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("web_push_campaign_recipients_campaign_idx").on(t.campaignId)],
);

/**
 * Every Web Push send attempt — transactional or marketing — writes one
 * row here. Powers per-restaurant usage, super-admin platform reports,
 * cap enforcement, and frequency rules.
 */
export const webPushLogsTable = pgTable(
  "web_push_logs",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
    tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
    subscriptionId: integer("subscription_id").references(() => webPushSubscriptionsTable.id, { onDelete: "set null" }),
    customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
    campaignId: integer("campaign_id").references(() => webPushCampaignsTable.id, { onDelete: "set null" }),
    eventKey: text("event_key"),
    category: text("category").notNull().default("transactional"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    clickUrl: text("click_url"),
    status: text("status").notNull(),
    error: text("error"),
    provider: text("provider"),
    clickedAt: timestamp("clicked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("web_push_logs_restaurant_idx").on(t.restaurantId),
    index("web_push_logs_created_idx").on(t.createdAt),
    index("web_push_logs_category_idx").on(t.category),
  ],
);

export type WebPushSubscription = typeof webPushSubscriptionsTable.$inferSelect;
export type InsertWebPushSubscription = typeof webPushSubscriptionsTable.$inferInsert;
export type WebPushSetting = typeof webPushSettingsTable.$inferSelect;
export type WebPushTemplate = typeof webPushTemplatesTable.$inferSelect;
export type WebPushCampaign = typeof webPushCampaignsTable.$inferSelect;
export type WebPushCampaignRecipient = typeof webPushCampaignRecipientsTable.$inferSelect;
export type WebPushLog = typeof webPushLogsTable.$inferSelect;

/** Catalogue of known feature toggles surfaced in the restaurant settings UI. */
export const WEB_PUSH_FEATURE_KEYS = [
  { key: "order_updates", label: "Order status updates", description: "Accepted, preparing, ready, served, takeaway/delivery updates." },
  { key: "reservations", label: "Reservation alerts", description: "Booking confirmations and reminders to diners." },
  { key: "review_requests", label: "Review requests", description: "Post-order nudge asking for a rating and review." },
  { key: "loyalty", label: "Loyalty & coupon alerts", description: "Points earned, coupon issued, coupon about to expire." },
  { key: "marketing", label: "Marketing pushes", description: "Promotions and announcements (requires marketing opt-in)." },
  { key: "staff_alerts", label: "Staff web alerts", description: "Push alerts to logged-in restaurant staff on web." },
  { key: "ai_insights", label: "AI insight digests", description: "Push when a new AI insight is ready." },
  { key: "support", label: "Support ticket updates", description: "Replies and status changes on support tickets." },
] as const;

/** Catalogue of templated transactional events. The sender picks an active template by (restaurantId, eventKey). */
export const WEB_PUSH_EVENT_KEYS = [
  "order.accepted", "order.preparing", "order.ready", "order.served",
  "order.takeaway_ready", "order.delivery_update",
  "reservation.confirmed", "reservation.reminder",
  "review.request",
  "loyalty.points_earned", "loyalty.coupon_issued", "loyalty.coupon_expiring",
  "loyalty.birthday", "loyalty.winback", "loyalty.festival", "loyalty.new_item",
  "staff.alert", "inventory.low_stock",
  "ai.insight", "support.update", "system.announcement",
] as const;
export type WebPushEventKey = (typeof WEB_PUSH_EVENT_KEYS)[number];
