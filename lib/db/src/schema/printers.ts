import {
  pgTable, text, serial, integer, boolean, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable, branchesTable } from "./restaurants";
import { kitchensTable } from "./kitchens";
import { ordersTable } from "./orders";

export type PrinterConnection = "bluetooth" | "usb" | "lan" | "browser" | "system";
export type PrinterRole = "bill" | "kot" | "token" | "bar" | "kitchen";
export type PrinterPaperSize = "58mm" | "80mm";

export const printersTable = pgTable(
  "printers",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    kitchenId: integer("kitchen_id").references(() => kitchensTable.id, { onDelete: "set null" }),

    name: text("name").notNull(),
    connectionType: text("connection_type").$type<PrinterConnection>().notNull(),
    role: text("role").$type<PrinterRole>().notNull(),
    paperSize: text("paper_size").$type<PrinterPaperSize>().notNull().default("80mm"),

    // Connection params (vary by type):
    //   bluetooth: { address, deviceName }
    //   usb:       { vendorId, productId, deviceName }
    //   lan:       { host, port }
    //   browser:   {}
    connection: jsonb("connection").$type<Record<string, unknown>>().notNull().default({}),

    isDefault: boolean("is_default").notNull().default(false),
    autoPrint: boolean("auto_print").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),

    copies: integer("copies").notNull().default(1),
    charactersPerLine: integer("characters_per_line").notNull().default(48),
    feedLines: integer("feed_lines").notNull().default(3),
    cutPaper: boolean("cut_paper").notNull().default(true),
    cashDrawerKick: boolean("cash_drawer_kick").notNull().default(false),
    buzzer: boolean("buzzer").notNull().default(false),

    // Most recent status set by mobile/admin clients
    status: text("status").notNull().default("unknown"), // unknown|connected|disconnected|permission_required|test_passed|test_failed|offline
    lastTestAt: timestamp("last_test_at"),
    lastTestError: text("last_test_error"),

    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("printers_restaurant_idx").on(t.restaurantId),
    index("printers_branch_idx").on(t.branchId),
    index("printers_kitchen_idx").on(t.kitchenId),
    index("printers_role_idx").on(t.restaurantId, t.role),
  ],
);

export type PrintJobStatus =
  | "queued" | "printing" | "printed" | "failed" | "retrying" | "cancelled";

export type PrintJobType =
  | "bill" | "kot" | "token" | "reprint_bill" | "reprint_kot"
  | "cancelled_kot" | "modified_kot" | "test";

export const printJobsTable = pgTable(
  "print_jobs",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    printerId: integer("printer_id").references(() => printersTable.id, { onDelete: "set null" }),

    printType: text("print_type").$type<PrintJobType>().notNull(),
    orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
    invoiceNumber: text("invoice_number"),
    kotNumber: text("kot_number"),
    kitchenId: integer("kitchen_id").references(() => kitchensTable.id, { onDelete: "set null" }),

    // The typed payload we want printed; renderer turns it into ESC/POS bytes
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),

    status: text("status").$type<PrintJobStatus>().notNull().default("queued"),
    error: text("error"),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    copies: integer("copies").notNull().default(1),
    copiesPrinted: integer("copies_printed").notNull().default(0),
    // Idempotency key for duplicate-print protection
    dedupeKey: text("dedupe_key"),

    requestedBy: integer("requested_by"),
    requestedByName: text("requested_by_name"),

    queuedAt: timestamp("queued_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    nextAttemptAt: timestamp("next_attempt_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("print_jobs_restaurant_idx").on(t.restaurantId, t.createdAt),
    index("print_jobs_printer_idx").on(t.printerId),
    index("print_jobs_status_idx").on(t.restaurantId, t.status),
    index("print_jobs_dedupe_idx").on(t.restaurantId, t.dedupeKey),
  ],
);

export const insertPrinterSchema = createInsertSchema(printersTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertPrinter = z.infer<typeof insertPrinterSchema>;
export type Printer = typeof printersTable.$inferSelect;
export type PrintJob = typeof printJobsTable.$inferSelect;

export const PRINTER_ROLES: PrinterRole[] = ["bill", "kot", "token", "bar", "kitchen"];
export const PRINTER_CONNECTIONS: PrinterConnection[] = ["bluetooth", "usb", "lan", "browser", "system"];
export const PRINTER_PAPER_SIZES: PrinterPaperSize[] = ["58mm", "80mm"];
export const PRINT_JOB_STATUSES: PrintJobStatus[] = [
  "queued", "printing", "printed", "failed", "retrying", "cancelled",
];
export const PRINT_JOB_TYPES: PrintJobType[] = [
  "bill", "kot", "token", "reprint_bill", "reprint_kot",
  "cancelled_kot", "modified_kot", "test",
];
