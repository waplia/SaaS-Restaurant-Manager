import { pgTable, serial, integer, text, timestamp, jsonb, boolean, decimal, index } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { tenantsTable } from "./tenants";
import { menuItemsTable } from "./menu";
import { usersTable } from "./users";

/**
 * One row per AI menu import attempt (PDF/image/Excel/CSV/URL/text/screenshot).
 * Status lifecycle: pending → processing → ready (preview ready, awaiting save)
 * → saved | partially_saved | failed | rolled_back.
 */
export const aiMenuImportsTable = pgTable(
  "ai_menu_imports",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    tenantId: integer("tenant_id").references(() => tenantsTable.id),
    source: text("source").notNull(),
    status: text("status").notNull().default("pending"),
    fileName: text("file_name"),
    fileRef: text("file_ref"),
    sourceUrl: text("source_url"),
    sourceTextPreview: text("source_text_preview"),
    totalRows: integer("total_rows").notNull().default(0),
    savedItemCount: integer("saved_item_count").notNull().default(0),
    needsReviewCount: integer("needs_review_count").notNull().default(0),
    estimatedCredits: integer("estimated_credits").notNull().default(0),
    actualCredits: integer("actual_credits").notNull().default(0),
    errorMessage: text("error_message"),
    summary: jsonb("summary").$type<Record<string, unknown>>().default({}),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    savedAt: timestamp("saved_at"),
    rolledBackAt: timestamp("rolled_back_at"),
  },
  (t) => [
    index("ai_menu_imports_restaurant_idx").on(t.restaurantId, t.createdAt),
  ],
);

/**
 * Draft rows produced by AI structuring. Kept after save so the import history
 * can show what was created and so rollback can find the linked menu items.
 */
export const aiMenuImportItemsTable = pgTable(
  "ai_menu_import_items",
  {
    id: serial("id").primaryKey(),
    importId: integer("import_id").notNull().references(() => aiMenuImportsTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    rowIndex: integer("row_index").notNull(),
    status: text("status").notNull().default("draft"),
    structured: jsonb("structured").$type<Record<string, unknown>>().notNull(),
    confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull().default("0.800"),
    needsReview: boolean("needs_review").notNull().default(false),
    duplicateMatchId: integer("duplicate_match_id"),
    menuItemId: integer("menu_item_id").references(() => menuItemsTable.id, { onDelete: "set null" }),
    // Tracks the per-item AI-photo backfill kicked off after save. Lives on
    // the draft row (rather than menu_items) so it survives rollback and
    // history pages can show a per-import "photos: 8/10" counter.
    // Values: queued | generating | done | failed | skipped_credits | skipped_no_storage
    imageStatus: text("image_status").notNull().default("queued"),
    imageError: text("image_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    savedAt: timestamp("saved_at"),
  },
  (t) => [
    index("ai_menu_import_items_import_idx").on(t.importId),
    index("ai_menu_import_items_menu_item_idx").on(t.menuItemId),
  ],
);

export type AiMenuImport = typeof aiMenuImportsTable.$inferSelect;
export type AiMenuImportItem = typeof aiMenuImportItemsTable.$inferSelect;
