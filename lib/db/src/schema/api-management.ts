import { pgTable, text, serial, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

/**
 * Singleton row (id=1) holding platform-wide API/Webhook configuration
 * controlled by super admins.
 */
export const apiGlobalSettingsTable = pgTable("api_global_settings", {
  id: integer("id").primaryKey().default(1),
  apiEnabled: boolean("api_enabled").notNull().default(true),
  defaultRateLimitPerMin: integer("default_rate_limit_per_min").notNull().default(60),
  webhookMaxAttempts: integer("webhook_max_attempts").notNull().default(5),
  webhookBaseDelaySec: integer("webhook_base_delay_sec").notNull().default(30),
  logRetentionDays: integer("log_retention_days").notNull().default(30),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const restaurantApiOverridesTable = pgTable("restaurant_api_overrides", {
  restaurantId: integer("restaurant_id")
    .primaryKey()
    .references(() => restaurantsTable.id, { onDelete: "cascade" }),
  rateLimitPerMin: integer("rate_limit_per_min"),
  /** Super-admin kill-switch: when true all API requests for this tenant are rejected with 503. */
  apiDisabled: boolean("api_disabled").notNull().default(false),
  apiDisabledReason: text("api_disabled_reason"),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ApiKeyEnvironment = "live" | "sandbox";

export const apiKeysTable = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hashedKey: text("hashed_key").notNull().unique(),
    /** "live" or "sandbox" — sandbox keys are intended for non-production traffic. */
    environment: text("environment").$type<ApiKeyEnvironment>().notNull().default("live"),
    /** Granted scopes; empty array = legacy full access (pre-scopes behaviour). */
    scopes: text("scopes").array().$type<string[]>().notNull().default([]),
    rateLimitPerMin: integer("rate_limit_per_min"), // optional per-key override
    lastUsedAt: timestamp("last_used_at"),
    /** If this key superseded an earlier rotated key, the previous key's id. */
    rotatedFromId: integer("rotated_from_id"),
    rotatedAt: timestamp("rotated_at"),
    revokedAt: timestamp("revoked_at"),
    revokedBy: integer("revoked_by").references(() => usersTable.id),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  t => ({
    byRestaurant: index("api_keys_restaurant_idx").on(t.restaurantId),
  }),
);

export const apiRequestLogsTable = pgTable(
  "api_request_logs",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
    apiKeyId: integer("api_key_id").references(() => apiKeysTable.id, { onDelete: "set null" }),
    endpoint: text("endpoint").notNull(),
    method: text("method").notNull(),
    statusCode: integer("status_code").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  t => ({
    byRestaurantTime: index("api_logs_restaurant_time_idx").on(t.restaurantId, t.createdAt),
    byTime: index("api_logs_time_idx").on(t.createdAt),
  }),
);

export type WebhookEventType =
  | "order.created"
  | "order.updated"
  | "order.completed"
  | "order.cancelled"
  | "payment.succeeded"
  | "payment.failed"
  | "menu.updated"
  | "reservation.created"
  | "customer.created";

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  "order.created",
  "order.updated",
  "order.completed",
  "order.cancelled",
  "payment.succeeded",
  "payment.failed",
  "menu.updated",
  "reservation.created",
  "customer.created",
];

export const webhookEndpointsTable = pgTable(
  "webhook_endpoints",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    events: text("events").array().$type<WebhookEventType[]>().notNull().default([]),
    secret: text("secret").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  t => ({
    byRestaurant: index("webhook_endpoints_restaurant_idx").on(t.restaurantId),
  }),
);

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "permanently_failed";

export const webhookDeliveriesTable = pgTable(
  "webhook_deliveries",
  {
    id: serial("id").primaryKey(),
    endpointId: integer("endpoint_id").notNull().references(() => webhookEndpointsTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    statusCode: integer("status_code"),
    error: text("error"),
    attempt: integer("attempt").notNull().default(0),
    status: text("status").$type<WebhookDeliveryStatus>().notNull().default("pending"),
    nextAttemptAt: timestamp("next_attempt_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at"),
  },
  t => ({
    byEndpoint: index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt),
    byStatus: index("webhook_deliveries_status_idx").on(t.status, t.nextAttemptAt),
    byRestaurant: index("webhook_deliveries_restaurant_idx").on(t.restaurantId, t.createdAt),
  }),
);

/**
 * OAuth Application placeholder. This is the stub model for a future third-party
 * OAuth 2.0 flow — only the metadata is implemented today; tokens and the auth
 * code exchange are out of scope for #434.
 */
export const oauthAppsTable = pgTable(
  "oauth_apps",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    clientId: text("client_id").notNull().unique(),
    /** SHA-256 of the client secret; full secret is shown once at creation. */
    clientSecretHash: text("client_secret_hash").notNull(),
    clientSecretPrefix: text("client_secret_prefix").notNull(),
    redirectUris: text("redirect_uris").array().$type<string[]>().notNull().default([]),
    scopes: text("scopes").array().$type<string[]>().notNull().default([]),
    homepageUrl: text("homepage_url"),
    status: text("status").$type<"draft" | "published" | "suspended">().notNull().default("draft"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  t => ({
    byRestaurant: index("oauth_apps_restaurant_idx").on(t.restaurantId),
  }),
);

export type ApiGlobalSettings = typeof apiGlobalSettingsTable.$inferSelect;
export type ApiKey = typeof apiKeysTable.$inferSelect;
export type ApiRequestLog = typeof apiRequestLogsTable.$inferSelect;
export type WebhookEndpoint = typeof webhookEndpointsTable.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveriesTable.$inferSelect;
export type OauthApp = typeof oauthAppsTable.$inferSelect;
export type RestaurantApiOverride = typeof restaurantApiOverridesTable.$inferSelect;
