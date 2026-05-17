import { pgTable, text, serial, timestamp, integer, boolean, decimal, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable, branchesTable } from "./restaurants";

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  isActive: boolean("is_active").notNull().default(true),
  // Supplier Network (Task #428): vendor catalog / RFQ extras.
  categoryTags: jsonb("category_tags").$type<string[]>().notNull().default([] as unknown as string[]),
  leadTimeDays: integer("lead_time_days"),
  minOrderValue: decimal("min_order_value", { precision: 12, scale: 2 }),
  paymentTerms: text("payment_terms"),
  reliabilityScore: decimal("reliability_score", { precision: 3, scale: 2 }),
  portalToken: text("portal_token"),
  isCatalogPublic: boolean("is_catalog_public").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const inventoryItemsTable = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  supplierId: integer("supplier_id").references(() => suppliersTable.id),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("kg"),
  currentStock: decimal("current_stock", { precision: 10, scale: 3 }).notNull().default("0.000"),
  minStockLevel: decimal("min_stock_level", { precision: 10, scale: 3 }).notNull().default("0.000"),
  parLevel: decimal("par_level", { precision: 10, scale: 3 }),
  reorderQuantity: decimal("reorder_quantity", { precision: 10, scale: 3 }),
  autoReorderEnabled: boolean("auto_reorder_enabled").notNull().default(true),
  costPerUnit: decimal("cost_per_unit", { precision: 10, scale: 2 }).notNull().default("0.00"),
  category: text("category").default("general"),
  // Inventory Control pack (Task #369): 'ingredient' | 'packaging' | 'condiment'.
  // Drives which UI surface lists the item and which deduction lane it follows.
  kind: text("kind").notNull().default("ingredient"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const inventoryTransactionsTable = pgTable("inventory_transactions", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => inventoryItemsTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  type: text("type").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull(),
  notes: text("notes"),
  referenceId: integer("reference_id"),
  referenceType: text("reference_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  supplierId: integer("supplier_id").references(() => suppliersTable.id),
  status: text("status").notNull().default("pending"),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  paidAmount: decimal("paid_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  notes: text("notes"),
  isAutoDrafted: boolean("is_auto_drafted").notNull().default(false),
  draftedAt: timestamp("drafted_at"),
  orderedAt: timestamp("ordered_at"),
  receivedAt: timestamp("received_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const purchaseOrderItemsTable = pgTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").references(() => inventoryItemsTable.id),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("kg"),
  quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
  costPerUnit: decimal("cost_per_unit", { precision: 10, scale: 2 }).notNull().default("0.00"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const inventoryStockTable = pgTable("inventory_stock", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => inventoryItemsTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
  reservedQuantity: decimal("reserved_quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
  lastCountedAt: timestamp("last_counted_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const recipeMappingsTable = pgTable("recipe_mappings", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  menuItemId: integer("menu_item_id").notNull(),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id),
  quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
  unit: text("unit").notNull().default("kg"),
  // Inventory Control pack (Task #369): mirror inventoryItemsTable.kind so
  // packaging & condiment recipes can be queried/edited per-feature without
  // joining the inventory table.
  kind: text("kind").notNull().default("ingredient"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRecipeMappingSchema = createInsertSchema(recipeMappingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRecipeMapping = z.infer<typeof insertRecipeMappingSchema>;
export type RecipeMapping = typeof recipeMappingsTable.$inferSelect;

export const insertInventoryStockSchema = createInsertSchema(inventoryStockTable).omit({ id: true, updatedAt: true });
export type InsertInventoryStock = z.infer<typeof insertInventoryStockSchema>;
export type InventoryStock = typeof inventoryStockTable.$inferSelect;

export const insertInventoryItemSchema = createInsertSchema(inventoryItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;

export const insertSupplierSchema = createInsertSchema(suppliersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliersTable.$inferSelect;

export const insertInventoryTransactionSchema = createInsertSchema(inventoryTransactionsTable).omit({ id: true, createdAt: true });
export type InsertInventoryTransaction = z.infer<typeof insertInventoryTransactionSchema>;
export type InventoryTransaction = typeof inventoryTransactionsTable.$inferSelect;

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;

export const insertPurchaseOrderItemSchema = createInsertSchema(purchaseOrderItemsTable).omit({ id: true, createdAt: true });
export type InsertPurchaseOrderItem = z.infer<typeof insertPurchaseOrderItemSchema>;
export type PurchaseOrderItem = typeof purchaseOrderItemsTable.$inferSelect;

/**
 * Per-batch tracking for inventory items. Captured on PO receive or manual
 * stock adjustments so the AI Inventory Assistant can flag items expiring
 * within a configurable window. `quantityRemaining` decrements FIFO from
 * earliest-expiring batch when stock is consumed/wasted.
 */
export const inventoryItemBatchesTable = pgTable(
  "inventory_item_batches",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id, { onDelete: "cascade" }),
    batchNumber: text("batch_number"),
    quantityReceived: decimal("quantity_received", { precision: 10, scale: 3 }).notNull().default("0.000"),
    quantityRemaining: decimal("quantity_remaining", { precision: 10, scale: 3 }).notNull().default("0.000"),
    expiryDate: timestamp("expiry_date"),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id, { onDelete: "set null" }),
    purchaseOrderItemId: integer("purchase_order_item_id").references(() => purchaseOrderItemsTable.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("inventory_batches_item_expiry_idx").on(t.inventoryItemId, t.expiryDate),
    index("inventory_batches_rest_idx").on(t.restaurantId, t.expiryDate),
  ],
);

export const insertInventoryItemBatchSchema = createInsertSchema(inventoryItemBatchesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryItemBatch = z.infer<typeof insertInventoryItemBatchSchema>;
export type InventoryItemBatch = typeof inventoryItemBatchesTable.$inferSelect;

// ────────────────────────────────────────────────────────────────────
// Inventory Control pack (Task #369)
// ────────────────────────────────────────────────────────────────────

export const RECIPE_MAPPING_KINDS = ["ingredient", "packaging", "condiment"] as const;
export type RecipeMappingKind = (typeof RECIPE_MAPPING_KINDS)[number];

export const RECIPE_VERSION_STATUSES = ["draft", "pending_approval", "approved", "active", "rejected", "archived"] as const;
export type RecipeVersionStatus = (typeof RECIPE_VERSION_STATUSES)[number];

export const TASTE_TEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type TasteTestStatus = (typeof TASTE_TEST_STATUSES)[number];

export const PORTION_DRIFT_SEVERITIES = ["info", "warning", "critical"] as const;
export type PortionDriftSeverity = (typeof PORTION_DRIFT_SEVERITIES)[number];

export const PORTION_DRIFT_STATUSES = ["open", "acknowledged", "resolved"] as const;
export type PortionDriftStatus = (typeof PORTION_DRIFT_STATUSES)[number];

/**
 * Versioned recipe snapshots. Each menu item can have many versions; at most
 * one row may be active per menu item. Drafts can be edited freely; once
 * pending_approval, only approve / reject are allowed. Activating a version
 * snapshots its lines into the live recipe_mappings rows (kind='ingredient'
 * only — packaging & condiment live in their own mappings).
 */
export const recipeVersionsTable = pgTable("recipe_versions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  menuItemId: integer("menu_item_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  status: text("status").notNull().default("draft"),
  isActive: boolean("is_active").notNull().default(false),
  totalCost: decimal("total_cost", { precision: 10, scale: 2 }).notNull().default("0.00"),
  notes: text("notes"),
  createdBy: integer("created_by"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  activatedAt: timestamp("activated_at"),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("recipe_versions_menu_item_idx").on(t.restaurantId, t.menuItemId, t.versionNumber),
  index("recipe_versions_active_idx").on(t.restaurantId, t.menuItemId, t.isActive),
]);

export const recipeVersionLinesTable = pgTable("recipe_version_lines", {
  id: serial("id").primaryKey(),
  versionId: integer("version_id").notNull().references(() => recipeVersionsTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id),
  quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
  unit: text("unit").notNull().default("kg"),
  costAtSnapshot: decimal("cost_at_snapshot", { precision: 10, scale: 2 }).notNull().default("0.00"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("recipe_version_lines_version_idx").on(t.versionId)]);

/**
 * Portion drift alerts: comparison of expected ingredient usage (= sum of
 * recipe quantity × units sold) vs actual decremented usage (= sum of
 * inventory_transactions of type='use') over a calendar window. Severity
 * derived from |driftPct|: <10 info, 10–25 warning, >25 critical.
 */
export const portionDriftEventsTable = pgTable("portion_drift_events", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  branchId: integer("branch_id").references(() => branchesTable.id),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  expectedQuantity: decimal("expected_quantity", { precision: 12, scale: 3 }).notNull().default("0.000"),
  actualQuantity: decimal("actual_quantity", { precision: 12, scale: 3 }).notNull().default("0.000"),
  driftPct: decimal("drift_pct", { precision: 8, scale: 2 }).notNull().default("0.00"),
  severity: text("severity").notNull().default("info"),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  acknowledgedBy: integer("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("portion_drift_restaurant_idx").on(t.restaurantId, t.createdAt),
  index("portion_drift_item_idx").on(t.inventoryItemId, t.createdAt),
]);

/**
 * Taste-test notes: chefs/managers log a tasting on a menu item (optionally
 * tied to a specific recipe version). A taste-test must be approved before
 * an associated draft recipe version can be activated. Surface in Reports
 * as a daily QA queue.
 */
export const tasteTestNotesTable = pgTable("taste_test_notes", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  branchId: integer("branch_id").references(() => branchesTable.id),
  menuItemId: integer("menu_item_id").notNull(),
  recipeVersionId: integer("recipe_version_id").references(() => recipeVersionsTable.id, { onDelete: "set null" }),
  tasterId: integer("taster_id"),
  tasterName: text("taster_name"),
  rating: integer("rating").notNull().default(3),
  appearance: integer("appearance"),
  aroma: integer("aroma"),
  taste: integer("taste"),
  texture: integer("texture"),
  temperature: integer("temperature"),
  notes: text("notes"),
  correctiveActions: text("corrective_actions"),
  status: text("status").notNull().default("pending"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  rejectedReason: text("rejected_reason"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("taste_test_restaurant_idx").on(t.restaurantId, t.createdAt),
  index("taste_test_menu_item_idx").on(t.menuItemId, t.createdAt),
  index("taste_test_status_idx").on(t.restaurantId, t.status),
]);

export const insertRecipeVersionSchema = createInsertSchema(recipeVersionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRecipeVersion = z.infer<typeof insertRecipeVersionSchema>;
export type RecipeVersion = typeof recipeVersionsTable.$inferSelect;

export const insertRecipeVersionLineSchema = createInsertSchema(recipeVersionLinesTable).omit({ id: true, createdAt: true });
export type InsertRecipeVersionLine = z.infer<typeof insertRecipeVersionLineSchema>;
export type RecipeVersionLine = typeof recipeVersionLinesTable.$inferSelect;

export const insertPortionDriftEventSchema = createInsertSchema(portionDriftEventsTable).omit({ id: true, createdAt: true });
export type InsertPortionDriftEvent = z.infer<typeof insertPortionDriftEventSchema>;
export type PortionDriftEvent = typeof portionDriftEventsTable.$inferSelect;

export const insertTasteTestNoteSchema = createInsertSchema(tasteTestNotesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTasteTestNote = z.infer<typeof insertTasteTestNoteSchema>;
export type TasteTestNote = typeof tasteTestNotesTable.$inferSelect;

// ────────────────────────────────────────────────────────────────────
// Supplier Catalog & Auto-Reorder Network (Task #428)
// ────────────────────────────────────────────────────────────────────

/**
 * Per-supplier catalog rows: each line is one product a vendor offers,
 * with its price, pack size, lead time, and availability. Optionally
 * linked to an inventory_item so the "best vendor" lookup can rank
 * vendors for a given stocked item.
 */
export const supplierCatalogItemsTable = pgTable("supplier_catalog_items", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").references(() => inventoryItemsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  sku: text("sku"),
  category: text("category"),
  unit: text("unit").notNull().default("kg"),
  packSize: decimal("pack_size", { precision: 10, scale: 3 }).notNull().default("1.000"),
  pricePerUnit: decimal("price_per_unit", { precision: 10, scale: 2 }).notNull().default("0.00"),
  minOrderQuantity: decimal("min_order_quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
  leadTimeDays: integer("lead_time_days"),
  isAvailable: boolean("is_available").notNull().default(true),
  notes: text("notes"),
  lastUpdatedAt: timestamp("last_updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("supplier_catalog_rest_idx").on(t.restaurantId, t.supplierId),
  index("supplier_catalog_item_idx").on(t.inventoryItemId),
]);

export const PURCHASE_REQUEST_STATUSES = ["draft", "sent", "quoted", "awarded", "closed", "cancelled"] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

/**
 * Bulk RFQ (request for quote). Restaurant compiles a list of items it
 * wants to source, broadcasts to multiple vendors, collects quotes, and
 * awards one (or splits per item).
 */
export const purchaseRequestsTable = pgTable("purchase_requests", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  title: text("title").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("draft"),
  neededBy: timestamp("needed_by"),
  createdBy: integer("created_by"),
  awardedQuoteId: integer("awarded_quote_id"),
  sentAt: timestamp("sent_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("purchase_requests_rest_idx").on(t.restaurantId, t.status),
]);

export const purchaseRequestItemsTable = pgTable("purchase_request_items", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => purchaseRequestsTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").references(() => inventoryItemsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("kg"),
  quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull().default("0.000"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Many-to-many: which vendors received this RFQ and where they're at. */
export const purchaseRequestSuppliersTable = pgTable("purchase_request_suppliers", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => purchaseRequestsTable.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  respondedAt: timestamp("responded_at"),
}, (t) => [
  index("purchase_request_suppliers_idx").on(t.requestId, t.supplierId),
]);

export const SUPPLIER_QUOTE_STATUSES = ["draft", "submitted", "accepted", "rejected"] as const;

/**
 * Vendor quote against an RFQ. Captured manually by the restaurant
 * (phone / WhatsApp reply) or by the vendor through the supplier portal
 * placeholder. One quote per (request, supplier).
 */
export const supplierQuotesTable = pgTable("supplier_quotes", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => purchaseRequestsTable.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("submitted"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  leadTimeDays: integer("lead_time_days"),
  notes: text("notes"),
  source: text("source").notNull().default("manual"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("supplier_quotes_request_idx").on(t.requestId),
]);

export const supplierQuoteItemsTable = pgTable("supplier_quote_items", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull().references(() => supplierQuotesTable.id, { onDelete: "cascade" }),
  requestItemId: integer("request_item_id").notNull().references(() => purchaseRequestItemsTable.id, { onDelete: "cascade" }),
  pricePerUnit: decimal("price_per_unit", { precision: 10, scale: 2 }).notNull().default("0.00"),
  available: boolean("available").notNull().default(true),
  alternativeName: text("alternative_name"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSupplierCatalogItemSchema = createInsertSchema(supplierCatalogItemsTable).omit({ id: true, createdAt: true, updatedAt: true, lastUpdatedAt: true });
export type InsertSupplierCatalogItem = z.infer<typeof insertSupplierCatalogItemSchema>;
export type SupplierCatalogItem = typeof supplierCatalogItemsTable.$inferSelect;

export const insertPurchaseRequestSchema = createInsertSchema(purchaseRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchaseRequest = z.infer<typeof insertPurchaseRequestSchema>;
export type PurchaseRequest = typeof purchaseRequestsTable.$inferSelect;

export type PurchaseRequestItem = typeof purchaseRequestItemsTable.$inferSelect;
export type PurchaseRequestSupplier = typeof purchaseRequestSuppliersTable.$inferSelect;
export type SupplierQuote = typeof supplierQuotesTable.$inferSelect;
export type SupplierQuoteItem = typeof supplierQuoteItemsTable.$inferSelect;
