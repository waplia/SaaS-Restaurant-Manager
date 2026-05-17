import { pgTable, text, serial, timestamp, integer, decimal, jsonb, index, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";
import { suppliersTable, purchaseOrdersTable, purchaseOrderItemsTable, inventoryItemsTable } from "./inventory";
import { expensesTable } from "./expenses";

/**
 * Vendor Invoice OCR (Task #427).
 *
 * A `vendor_invoices` row is created the moment an owner/manager uploads a
 * PDF/image. The OCR pass populates `extractedData` (free-form provider
 * payload) and `confidenceScores` (per-field 0..1). The reviewer can correct
 * any field, match the invoice to a purchase order, and finally approve it —
 * which spawns an `expense` row (vendor bill) AND batched stock increments
 * for any matched inventory items.
 *
 * `status` lifecycle: draft → matched → approved | rejected.
 */
export const VENDOR_INVOICE_STATUSES = ["draft", "matched", "approved", "rejected"] as const;
export type VendorInvoiceStatus = (typeof VENDOR_INVOICE_STATUSES)[number];

export const vendorInvoicesTable = pgTable("vendor_invoices", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id, { onDelete: "set null" }),
  expenseId: integer("expense_id").references(() => expensesTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date"),
  dueDate: date("due_date"),
  vendorName: text("vendor_name"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  taxAmount: decimal("tax_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  currency: text("currency").notNull().default("INR"),
  // Object-storage path of the uploaded source (PDF or image), used for re-display in the review pane.
  uploadObjectPath: text("upload_object_path").notNull(),
  uploadMimeType: text("upload_mime_type"),
  // Raw provider payload (parsed JSON), kept for audit / re-display alongside the file.
  extractedData: jsonb("extracted_data").$type<Record<string, unknown>>().notNull().default({}),
  // Per-field confidence (e.g. { vendor: 0.92, invoiceNumber: 0.78, total: 0.95 }).
  confidenceScores: jsonb("confidence_scores").$type<Record<string, number>>().notNull().default({}),
  // Set when at least one line has |unitPrice - poUnitPrice| / poUnitPrice > threshold.
  hasPriceVariance: text("has_price_variance").notNull().default("false"),
  rejectionReason: text("rejection_reason"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("vendor_invoices_restaurant_idx").on(t.restaurantId, t.createdAt),
  index("vendor_invoices_status_idx").on(t.restaurantId, t.status),
  index("vendor_invoices_po_idx").on(t.purchaseOrderId),
]);

export const vendorInvoiceLinesTable = pgTable("vendor_invoice_lines", {
  id: serial("id").primaryKey(),
  vendorInvoiceId: integer("vendor_invoice_id").notNull().references(() => vendorInvoicesTable.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull().default(0),
  description: text("description").notNull().default(""),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull().default("0.000"),
  unit: text("unit").notNull().default("unit"),
  unitPrice: decimal("unit_price", { precision: 12, scale: 4 }).notNull().default("0.0000"),
  lineTotal: decimal("line_total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  matchedInventoryItemId: integer("matched_inventory_item_id").references(() => inventoryItemsTable.id, { onDelete: "set null" }),
  matchedPoItemId: integer("matched_po_item_id").references(() => purchaseOrderItemsTable.id, { onDelete: "set null" }),
  // % difference vs PO unitPrice (signed). Null if no PO match.
  priceVariancePct: decimal("price_variance_pct", { precision: 8, scale: 2 }),
  confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull().default("0.000"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("vendor_invoice_lines_invoice_idx").on(t.vendorInvoiceId),
]);

export const insertVendorInvoiceSchema = createInsertSchema(vendorInvoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorInvoice = z.infer<typeof insertVendorInvoiceSchema>;
export type VendorInvoice = typeof vendorInvoicesTable.$inferSelect;

export const insertVendorInvoiceLineSchema = createInsertSchema(vendorInvoiceLinesTable).omit({ id: true, createdAt: true });
export type InsertVendorInvoiceLine = z.infer<typeof insertVendorInvoiceLineSchema>;
export type VendorInvoiceLine = typeof vendorInvoiceLinesTable.$inferSelect;
