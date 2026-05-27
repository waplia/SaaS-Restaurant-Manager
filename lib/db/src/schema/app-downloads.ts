import { pgTable, serial, integer, text, boolean, timestamp, jsonb, bigint, date, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { restaurantsTable } from "./restaurants";

export type AppDownloadPlatform = "android" | "ios" | "windows" | "macos" | "web";
export type AppDownloadStatus = "available" | "coming_soon" | "deprecated" | "archived";
export type AppDownloadType = "uploaded_file" | "external_link" | "store_link";
export type AppDownloadLogAction = "viewed" | "downloaded" | "opened_guide";

export const appDownloadsTable = pgTable("app_downloads", {
  id: serial("id").primaryKey(),
  platform: text("platform").$type<AppDownloadPlatform>().notNull(),
  appName: text("app_name").notNull(),
  description: text("description"),
  version: text("version").notNull(),
  buildNumber: text("build_number"),
  releaseDate: date("release_date"),
  status: text("status").$type<AppDownloadStatus>().notNull().default("available"),
  downloadType: text("download_type").$type<AppDownloadType>().notNull().default("uploaded_file"),
  downloadUrl: text("download_url"),
  uploadedFileUrl: text("uploaded_file_url"),
  fileSize: bigint("file_size", { mode: "number" }),
  iconUrl: text("icon_url"),
  minimumOsVersion: text("minimum_os_version"),
  systemRequirements: text("system_requirements"),
  releaseNotes: text("release_notes"),
  installationGuide: text("installation_guide"),
  isLatest: boolean("is_latest").notNull().default(false),
  isVisible: boolean("is_visible").notNull().default(true),
  forceUpdate: boolean("force_update").notNull().default(false),
  recommendedUpdate: boolean("recommended_update").notNull().default(false),
  allowedPlansJson: jsonb("allowed_plans_json").$type<number[] | null>().default(sql`null`),
  allowedRestaurantsJson: jsonb("allowed_restaurants_json").$type<number[] | null>().default(sql`null`),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byPlatform: index("app_downloads_platform_idx").on(t.platform, t.status),
  latestPerPlatform: uniqueIndex("app_downloads_latest_per_platform").on(t.platform).where(sql`is_latest = true`),
}));

export const appDownloadLogsTable = pgTable("app_download_logs", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  appDownloadId: integer("app_download_id").references(() => appDownloadsTable.id, { onDelete: "set null" }),
  platform: text("platform").$type<AppDownloadPlatform>().notNull(),
  action: text("action").$type<AppDownloadLogAction>().notNull(),
  version: text("version"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byDownload: index("app_download_logs_download_idx").on(t.appDownloadId, t.createdAt),
  byPlatform: index("app_download_logs_platform_idx").on(t.platform, t.createdAt),
  byRestaurant: index("app_download_logs_restaurant_idx").on(t.restaurantId, t.createdAt),
}));
