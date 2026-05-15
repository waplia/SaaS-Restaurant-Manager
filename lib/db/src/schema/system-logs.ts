import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";

export type SystemLogCategory =
  | "app_error"
  | "exception"
  | "api_error"
  | "payment_webhook"
  | "job_failure";

export type SystemLogLevel = "info" | "warn" | "error" | "fatal";
export type SystemLogStatus = "success" | "failed" | "skipped";

export const systemLogsTable = pgTable("system_logs", {
  id: serial("id").primaryKey(),
  category: text("category").$type<SystemLogCategory>().notNull(),
  level: text("level").$type<SystemLogLevel>().notNull().default("info"),
  status: text("status").$type<SystemLogStatus>().notNull().default("failed"),
  message: text("message").notNull(),
  source: text("source"),
  route: text("route"),
  method: text("method"),
  statusCode: integer("status_code"),
  tenantId: integer("tenant_id"),
  userId: integer("user_id"),
  jobName: text("job_name"),
  payload: jsonb("payload"),
  stack: text("stack"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byCategoryCreated: index("system_logs_category_created_idx").on(t.category, t.createdAt),
  byCreated: index("system_logs_created_idx").on(t.createdAt),
}));

export type SystemLog = typeof systemLogsTable.$inferSelect;
export type InsertSystemLog = typeof systemLogsTable.$inferInsert;
