import { pgTable, text, serial, timestamp, integer, boolean, decimal, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  isActive: boolean("is_active").notNull().default(true),
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
