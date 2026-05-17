import { pgTable, text, serial, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable, branchesTable } from "./restaurants";
import { kitchensTable } from "./kitchens";
import { usersTable } from "./users";

export type DeviceType =
  | "thermal_printer"
  | "kot_printer"
  | "kitchen_display"
  | "customer_display"
  | "barcode_scanner"
  | "qr_scanner"
  | "cash_drawer"
  | "biometric"
  | "android_pos"
  | "tablet_menu"
  | "self_kiosk"
  | "token_display";

export type DeviceStatus = "online" | "offline" | "error" | "pairing";

export const devicesTable = pgTable(
  "devices",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    kitchenId: integer("kitchen_id").references(() => kitchensTable.id, { onDelete: "set null" }),
    type: text("type").$type<DeviceType>().notNull(),
    name: text("name").notNull(),
    status: text("status").$type<DeviceStatus>().notNull().default("pairing"),
    lastSeenAt: timestamp("last_seen_at"),
    firmwareVersion: text("firmware_version"),
    appVersion: text("app_version"),
    registrationToken: text("registration_token").unique(),
    pairedAt: timestamp("paired_at"),
    paperSize: text("paper_size"),
    consecutiveErrors: integer("consecutive_errors").notNull().default(0),
    assignedUserId: integer("assigned_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    isHandheld: boolean("is_handheld").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("devices_restaurant_idx").on(t.restaurantId),
    index("devices_branch_idx").on(t.branchId),
    index("devices_kitchen_idx").on(t.kitchenId),
    index("devices_assigned_user_idx").on(t.assignedUserId),
  ],
);

export const deviceLogsTable = pgTable(
  "device_logs",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("device_id").notNull().references(() => devicesTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    eventType: text("event_type").notNull(),
    message: text("message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    source: text("source"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("device_logs_device_idx").on(t.deviceId, t.createdAt),
    index("device_logs_restaurant_idx").on(t.restaurantId, t.createdAt),
  ],
);

export const deviceRoutingRulesTable = pgTable(
  "device_routing_rules",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "cascade" }),
    deviceId: integer("device_id").notNull().references(() => devicesTable.id, { onDelete: "cascade" }),
    categoryId: integer("category_id"),
    kitchenId: integer("kitchen_id").references(() => kitchensTable.id, { onDelete: "cascade" }),
    orderType: text("order_type"),
    isDefaultReceipt: boolean("is_default_receipt").notNull().default(false),
    priority: integer("priority").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("device_routing_restaurant_idx").on(t.restaurantId),
    index("device_routing_device_idx").on(t.deviceId),
  ],
);

export const deviceStationMappingsTable = pgTable(
  "device_station_mappings",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("device_id").notNull().references(() => devicesTable.id, { onDelete: "cascade" }),
    kitchenId: integer("kitchen_id").notNull().references(() => kitchensTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("device_station_device_idx").on(t.deviceId),
    index("device_station_kitchen_idx").on(t.kitchenId),
  ],
);

export const deviceSyncStateTable = pgTable("device_sync_state", {
  id: serial("id").primaryKey(),
  deviceId: integer("device_id").notNull().unique().references(() => devicesTable.id, { onDelete: "cascade" }),
  lastSyncAt: timestamp("last_sync_at"),
  pendingCount: integer("pending_count").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDeviceSchema = createInsertSchema(devicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDevice = z.infer<typeof insertDeviceSchema>;
export type Device = typeof devicesTable.$inferSelect;
export type DeviceLog = typeof deviceLogsTable.$inferSelect;
export type DeviceRoutingRule = typeof deviceRoutingRulesTable.$inferSelect;
export type DeviceStationMapping = typeof deviceStationMappingsTable.$inferSelect;
export type DeviceSyncState = typeof deviceSyncStateTable.$inferSelect;

export const PRINTER_TYPES: DeviceType[] = ["thermal_printer", "kot_printer"];
export const OFFLINE_CAPABLE_TYPES: DeviceType[] = ["android_pos", "tablet_menu", "self_kiosk"];
