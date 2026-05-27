/**
 * Task #674 — Per-restaurant Bill Template library + channel routing.
 *
 * Eight system defaults ship with the server and are seeded lazily for each
 * restaurant the first time it loads the templates page (no global rows —
 * keeps cross-tenant overrides impossible). The restaurant_settings
 * `bill_channels` section stores the channel→template_id map; channels with
 * no explicit assignment fall back to a per-paper-size default.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, billTemplatesTable, restaurantSettingsTable } from "./db";
import type { BillTemplate, BillTemplateLayout } from "@workspace/db/schema";
import { BILL_CHANNELS, type BillChannel } from "@workspace/db/schema";

interface DefaultTemplate {
  key: string;
  name: string;
  description: string;
  paperSize: "thermal_58" | "thermal_80" | "a4" | "a5";
  layout: BillTemplateLayout;
}

/** Eight system defaults required by Task #674. */
export const SYSTEM_DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: "thermal_80",
    name: "Thermal 80mm",
    description: "Standard 80mm thermal receipt for in-store printing.",
    paperSize: "thermal_80",
    layout: {
      version: 1,
      title: "Receipt",
      showLogo: true,
      showGstin: true,
      showFssai: true,
      showModifiers: true,
      showItemNotes: true,
      showTaxBreakdown: true,
      showUpiQr: true,
      showStaff: true,
      showTableMeta: true,
      showCustomer: true,
      footerLines: ["Thank you for dining with us!"],
    },
  },
  {
    key: "thermal_58",
    name: "Thermal 58mm",
    description: "Narrower 58mm thermal receipt for compact printers.",
    paperSize: "thermal_58",
    layout: {
      version: 1,
      title: "Receipt",
      showLogo: false,
      showGstin: true,
      showFssai: true,
      showModifiers: true,
      showItemNotes: true,
      showTaxBreakdown: false,
      showUpiQr: true,
      showStaff: false,
      showTableMeta: true,
      showCustomer: true,
      footerLines: ["Thank you!"],
    },
  },
  {
    key: "a4_invoice",
    name: "A4 Invoice",
    description: "Full-page tax invoice for download / email.",
    paperSize: "a4",
    layout: {
      version: 1,
      title: "Tax Invoice",
      showLogo: true,
      showGstin: true,
      showFssai: true,
      showModifiers: true,
      showItemNotes: true,
      showTaxBreakdown: true,
      showUpiQr: false,
      showStaff: true,
      showTableMeta: true,
      showCustomer: true,
      accentColor: "#ea580c",
      footerLines: ["Thank you for your business!"],
      terms: "Goods once sold are not returnable. Subject to local jurisdiction.",
    },
  },
  {
    key: "compact_kot",
    name: "Compact KOT",
    description: "Kitchen Order Ticket — no prices, just items + modifiers.",
    paperSize: "thermal_80",
    layout: {
      version: 1,
      title: "Kitchen Order",
      isKot: true,
      showLogo: false,
      showGstin: false,
      showFssai: false,
      showModifiers: true,
      showItemNotes: true,
      showTaxBreakdown: false,
      showUpiQr: false,
      showStaff: false,
      showTableMeta: true,
      showCustomer: false,
    },
  },
  {
    key: "qr_order",
    name: "QR Customer Receipt",
    description: "Receipt shown when a customer scans the QR receipt link.",
    paperSize: "a5",
    layout: {
      version: 1,
      title: "Receipt",
      showLogo: true,
      showGstin: true,
      showFssai: true,
      showModifiers: true,
      showItemNotes: true,
      showTaxBreakdown: true,
      showUpiQr: true,
      showStaff: false,
      showTableMeta: true,
      showCustomer: true,
      accentColor: "#ea580c",
      footerLines: ["Tap to pay via UPI · Save this receipt"],
    },
  },
  {
    key: "delivery",
    name: "Delivery Slip",
    description: "Delivery slip with customer address + rider details.",
    paperSize: "thermal_80",
    layout: {
      version: 1,
      title: "Delivery Slip",
      showLogo: true,
      showGstin: false,
      showFssai: false,
      showModifiers: false,
      showItemNotes: true,
      showTaxBreakdown: false,
      showUpiQr: false,
      showStaff: false,
      showTableMeta: false,
      showCustomer: true,
      footerLines: ["Please rate your rider on the app."],
    },
  },
  {
    key: "gst_invoice",
    name: "GST Invoice",
    description: "GST-registered tax invoice with full tax breakdown.",
    paperSize: "a4",
    layout: {
      version: 1,
      title: "GST Tax Invoice",
      showLogo: true,
      showGstin: true,
      showFssai: true,
      showModifiers: true,
      showItemNotes: false,
      showTaxBreakdown: true,
      showUpiQr: false,
      showStaff: true,
      showTableMeta: true,
      showCustomer: true,
      accentColor: "#0f766e",
      terms: "This is a computer-generated invoice. GST as applicable under the GST Act.",
    },
  },
  {
    key: "non_gst_invoice",
    name: "Non-GST Bill",
    description: "Simple bill with no tax breakdown — for non-GST outlets.",
    paperSize: "a5",
    layout: {
      version: 1,
      title: "Bill of Supply",
      showLogo: true,
      showGstin: false,
      showFssai: true,
      showModifiers: true,
      showItemNotes: false,
      showTaxBreakdown: false,
      showUpiQr: true,
      showStaff: false,
      showTableMeta: true,
      showCustomer: true,
      accentColor: "#f59e0b",
      footerLines: ["Thank you, visit again!"],
    },
  },
];

/**
 * Per-channel default template keys, applied when the restaurant has no
 * explicit assignment yet. Centralised so the renderer + admin UI agree.
 */
export const CHANNEL_DEFAULT_KEYS: Record<BillChannel, string> = {
  web_pos: "thermal_80",
  pos_thermal: "thermal_80",
  desktop_pos: "thermal_80",
  mobile_waiter: "a4_invoice",
  mobile_share: "a4_invoice",
  qr_customer: "qr_order",
  a4_pdf: "a4_invoice",
  thermal_print: "thermal_80",
  whatsapp_share: "a4_invoice",
  email_share: "a4_invoice",
  kot: "compact_kot",
};

/**
 * Ensure system defaults exist for the restaurant. Idempotent — only inserts
 * missing keys, never overwrites edits. Returns the resulting template list.
 */
export async function ensureSeededTemplates(restaurantId: number): Promise<BillTemplate[]> {
  const existing = await db
    .select()
    .from(billTemplatesTable)
    .where(eq(billTemplatesTable.restaurantId, restaurantId));
  const haveKeys = new Set(existing.map(t => t.key));
  const missing = SYSTEM_DEFAULT_TEMPLATES.filter(d => !haveKeys.has(d.key));
  if (missing.length === 0) return existing;
  const inserted = await db
    .insert(billTemplatesTable)
    .values(
      missing.map(d => ({
        restaurantId,
        key: d.key,
        name: d.name,
        description: d.description,
        paperSize: d.paperSize,
        layout: d.layout,
        isSystem: true,
        isDefault: d.key === "thermal_80",
      })),
    )
    .returning();
  return [...existing, ...inserted];
}

interface ChannelAssignments {
  channels: Partial<Record<BillChannel, number>>;
}

const EMPTY_ASSIGNMENTS: ChannelAssignments = { channels: {} };

export async function getChannelAssignments(restaurantId: number): Promise<ChannelAssignments> {
  const [row] = await db
    .select()
    .from(restaurantSettingsTable)
    .where(
      and(
        eq(restaurantSettingsTable.restaurantId, restaurantId),
        eq(restaurantSettingsTable.section, "bill_channels"),
      ),
    );
  if (!row) return EMPTY_ASSIGNMENTS;
  const data = (row.data ?? {}) as Partial<ChannelAssignments>;
  return { channels: data.channels ?? {} };
}

export async function setChannelAssignments(
  restaurantId: number,
  patch: Partial<Record<BillChannel, number | null>>,
  updatedBy: number | null,
): Promise<ChannelAssignments> {
  const current = await getChannelAssignments(restaurantId);
  const next: Partial<Record<BillChannel, number>> = { ...current.channels };
  for (const [k, v] of Object.entries(patch)) {
    const ch = k as BillChannel;
    if (!BILL_CHANNELS.includes(ch)) continue;
    if (v == null) delete next[ch];
    else next[ch] = v;
  }
  const data = { channels: next };
  await db
    .insert(restaurantSettingsTable)
    .values({ restaurantId, section: "bill_channels", data, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
      set: { data, updatedBy, updatedAt: new Date() },
    });
  return data;
}

/**
 * Resolve the template for a given channel. Falls back through:
 *   explicit assignment → channel default key → first template → null.
 */
export async function resolveTemplateForChannel(
  restaurantId: number,
  channel: BillChannel,
): Promise<BillTemplate | null> {
  const templates = await ensureSeededTemplates(restaurantId);
  const assignments = await getChannelAssignments(restaurantId);
  const explicitId = assignments.channels[channel];
  if (explicitId) {
    const hit = templates.find(t => t.id === explicitId);
    if (hit) return hit;
  }
  const defaultKey = CHANNEL_DEFAULT_KEYS[channel] ?? "thermal_80";
  const byKey = templates.find(t => t.key === defaultKey);
  if (byKey) return byKey;
  return templates[0] ?? null;
}

/** Used by the public render endpoint to load a specific template by id. */
export async function getTemplateById(restaurantId: number, id: number): Promise<BillTemplate | null> {
  const [t] = await db
    .select()
    .from(billTemplatesTable)
    .where(and(eq(billTemplatesTable.id, id), eq(billTemplatesTable.restaurantId, restaurantId)));
  return t ?? null;
}

/** Helper used by tests — discover any orphan global rows so they don't leak. */
export async function listGlobalTemplates(): Promise<BillTemplate[]> {
  return db.select().from(billTemplatesTable).where(isNull(billTemplatesTable.restaurantId));
}
