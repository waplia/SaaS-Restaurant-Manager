import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex, index, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const ACCOUNTING_TARGETS = [
  "tally",
  "zoho_books",
  "quickbooks",
  "busy",
  "marg",
  "vyapar",
  "gst",
  "excel",
  "api",
] as const;
export type AccountingTarget = (typeof ACCOUNTING_TARGETS)[number];

export const ACCOUNTING_DATASETS = ["sales", "expense", "purchase"] as const;
export type AccountingDataset = (typeof ACCOUNTING_DATASETS)[number];

export const ACCOUNTING_FORMATS = ["xml", "csv", "iif", "xlsx", "json"] as const;
export type AccountingFormat = (typeof ACCOUNTING_FORMATS)[number];

export const ACCOUNTING_RUN_STATUSES = ["pending", "running", "succeeded", "failed", "configuration_required"] as const;
export type AccountingRunStatus = (typeof ACCOUNTING_RUN_STATUSES)[number];

export const accountingConnectionsTable = pgTable(
  "accounting_connections",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    target: text("target").$type<AccountingTarget>().notNull(),
    status: text("status").notNull().default("not_configured"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastTestedAt: timestamp("last_tested_at"),
    lastTestResult: text("last_test_result"),
    updatedBy: integer("updated_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("accounting_connections_restaurant_target_uniq").on(t.restaurantId, t.target),
  }),
);

export const accountingTaxMappingsTable = pgTable(
  "accounting_tax_mappings",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    target: text("target").$type<AccountingTarget>().notNull(),
    sourceCode: text("source_code").notNull(),
    targetCode: text("target_code").notNull(),
    label: text("label"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("accounting_tax_mappings_uniq").on(t.restaurantId, t.target, t.sourceCode),
  }),
);

export const accountingLedgerMappingsTable = pgTable(
  "accounting_ledger_mappings",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    target: text("target").$type<AccountingTarget>().notNull(),
    sourceLedger: text("source_ledger").notNull(),
    targetLedger: text("target_ledger").notNull(),
    notes: text("notes"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("accounting_ledger_mappings_uniq").on(t.restaurantId, t.target, t.sourceLedger),
  }),
);

export const accountingAccountMappingsTable = pgTable(
  "accounting_account_mappings",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    target: text("target").$type<AccountingTarget>().notNull(),
    partyType: text("party_type").notNull(),
    partyKey: text("party_key").notNull(),
    targetAccount: text("target_account").notNull(),
    notes: text("notes"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("accounting_account_mappings_uniq").on(t.restaurantId, t.target, t.partyType, t.partyKey),
  }),
);

export const accountingExportRunsTable = pgTable(
  "accounting_export_runs",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    target: text("target").$type<AccountingTarget>().notNull(),
    dataset: text("dataset").$type<AccountingDataset>().notNull(),
    format: text("format").$type<AccountingFormat>().notNull(),
    dateFrom: date("date_from").notNull(),
    dateTo: date("date_to").notNull(),
    status: text("status").$type<AccountingRunStatus>().notNull().default("pending"),
    fileUrl: text("file_url"),
    fileName: text("file_name"),
    rowCount: integer("row_count").notNull().default(0),
    pushMode: text("push_mode").notNull().default("file"),
    pushResponse: jsonb("push_response").$type<Record<string, unknown> | null>(),
    error: text("error"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    createdBy: integer("created_by").references(() => usersTable.id),
  },
  (t) => ({
    byRestaurant: index("accounting_export_runs_restaurant_idx").on(t.restaurantId, t.startedAt),
  }),
);

export const insertAccountingConnectionSchema = createInsertSchema(accountingConnectionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAccountingConnection = z.infer<typeof insertAccountingConnectionSchema>;
export type AccountingConnection = typeof accountingConnectionsTable.$inferSelect;

export type AccountingTaxMapping = typeof accountingTaxMappingsTable.$inferSelect;
export type AccountingLedgerMapping = typeof accountingLedgerMappingsTable.$inferSelect;
export type AccountingAccountMapping = typeof accountingAccountMappingsTable.$inferSelect;
export type AccountingExportRun = typeof accountingExportRunsTable.$inferSelect;
