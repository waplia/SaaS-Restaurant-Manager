import { pgTable, text, serial, timestamp, integer, boolean, bigint, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export type BackupType = "db" | "files" | "full";
export type BackupDestination = "local" | "s3" | "dropbox" | "gdrive";
export type BackupStatus = "pending" | "running" | "completed" | "failed";

export const backupsTable = pgTable("backups", {
  id: serial("id").primaryKey(),
  type: text("type").$type<BackupType>().notNull(),
  destination: text("destination").$type<BackupDestination>().notNull().default("local"),
  filePath: text("file_path"),
  remoteKey: text("remote_key"),
  size: bigint("size", { mode: "number" }).notNull().default(0),
  status: text("status").$type<BackupStatus>().notNull().default("pending"),
  error: text("error"),
  source: text("source").notNull().default("manual"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type Backup = typeof backupsTable.$inferSelect;
export type InsertBackup = typeof backupsTable.$inferInsert;

export const backupScheduleTable = pgTable("backup_schedule", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  frequency: text("frequency").notNull().default("daily"),
  timeOfDay: text("time_of_day").notNull().default("02:00"),
  retentionCount: integer("retention_count").notNull().default(7),
  includes: text("includes").$type<BackupType>().notNull().default("full"),
  destination: text("destination").$type<BackupDestination>().notNull().default("local"),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BackupSchedule = typeof backupScheduleTable.$inferSelect;

export const systemSettingsTable = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default({}),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SystemSetting = typeof systemSettingsTable.$inferSelect;
