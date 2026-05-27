import { pgTable, text, serial, timestamp, integer, boolean, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";

/**
 * Task #674 — Unified bill templates.
 *
 * One row per template. A `restaurantId = null` row is a global system
 * default seeded by the api-server on first access; per-restaurant rows are
 * editable copies/overrides. The `key` field identifies a template across
 * surfaces (e.g. "thermal_80", "thermal_58", "a4_invoice", "compact_kot",
 * "qr_order", "delivery", "gst_invoice", "non_gst_invoice").
 *
 * Layout is captured in a versioned `layout` JSON so we can evolve the
 * renderer without database migrations. Channel routing (which template a
 * given surface uses) is stored separately on `restaurant_settings`
 * under section = "bill_channels" so the per-channel map is a single
 * key→template_id object.
 */
export const billTemplatesTable = pgTable(
  "bill_templates",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").references(() => restaurantsTable.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    paperSize: text("paper_size").notNull().default("thermal_80"),
    layout: jsonb("layout").$type<BillTemplateLayout>().notNull().default({} as BillTemplateLayout),
    isDefault: boolean("is_default").notNull().default(false),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  t => ({
    keyIdx: uniqueIndex("bill_templates_restaurant_key_idx").on(t.restaurantId, t.key),
  }),
);

export type BillTemplatePaperSize =
  | "thermal_58"
  | "thermal_80"
  | "a4"
  | "a5";

/**
 * Versioned layout structure. Bumping `version` lets the renderer migrate
 * old rows. All fields are optional with sensible defaults applied by the
 * renderer — older rows (e.g. `{}`) still render correctly.
 */
export interface BillTemplateLayout {
  version?: 1;
  /** Document title shown at the top — falls back to "Receipt"/"Tax Invoice". */
  title?: string;
  /** Free-text header lines (above the items table). */
  headerLines?: string[];
  /** Free-text footer lines (below the totals/QR block). */
  footerLines?: string[];
  /** Terms & conditions block printed at the very bottom in fine print. */
  terms?: string;
  /** Whether to show the restaurant logo at the top. */
  showLogo?: boolean;
  /** Whether to show GSTIN / FSSAI lines in the header. */
  showGstin?: boolean;
  showFssai?: boolean;
  /** Whether to show item modifiers / per-item notes. */
  showModifiers?: boolean;
  showItemNotes?: boolean;
  /** Whether the per-rate tax breakdown is shown. */
  showTaxBreakdown?: boolean;
  /** Whether the UPI Scan-to-Pay QR is rendered (final visibility still
   *  honours the restaurant-level `upi_print_qr_mode`). */
  showUpiQr?: boolean;
  /** Whether the cashier / waiter name is printed. */
  showStaff?: boolean;
  /** Whether the table label / order type meta row is printed. */
  showTableMeta?: boolean;
  /** Whether to show the customer's name / phone. */
  showCustomer?: boolean;
  /** Whether to print this as a KOT (kitchen ticket) — drops prices and
   *  totals, shows only item names + quantities + modifiers + notes. */
  isKot?: boolean;
  /** Brand accent color for the A4/A5 header bar (hex). Ignored on thermal. */
  accentColor?: string;
}

export const insertBillTemplateSchema = createInsertSchema(billTemplatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBillTemplate = z.infer<typeof insertBillTemplateSchema>;
export type BillTemplate = typeof billTemplatesTable.$inferSelect;

/**
 * Stable channel keys — the same channel name is referenced from the
 * restaurant_settings `bill_channels` map and from the render endpoint
 * `?channel=` query.
 */
export const BILL_CHANNELS = [
  "web_pos",
  "pos_thermal",
  "desktop_pos",
  "mobile_waiter",
  "mobile_share",
  "qr_customer",
  "a4_pdf",
  "thermal_print",
  "whatsapp_share",
  "email_share",
  "kot",
] as const;
export type BillChannel = (typeof BILL_CHANNELS)[number];
