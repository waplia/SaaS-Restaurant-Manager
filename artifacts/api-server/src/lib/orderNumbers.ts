/**
 * Task #647 — Dual order numbering.
 *
 * Two numbers are minted for every order at creation time:
 *
 *   1. `orderDisplayNumber`  — short, per-outlet, per-business-day,
 *                              per-order-type ticket number that staff
 *                              and guests see and call out. e.g. "DN-023"
 *                              for the 23rd dine-in of the day, "TK-024"
 *                              for the 24th takeaway, etc. Resets at the
 *                              restaurant's business-day rollover.
 *
 *   2. `orderInternalNumber` — permanent, globally-unique audit id of the
 *                              form `KL-{outletCode}-YYYYMMDD-NNNNNN` that
 *                              appears on payments/exports/internal audit
 *                              trails. Never resets, never reused.
 *
 * The legacy `orderNumber` column is preserved (= internal number) so
 * existing webhooks, notifications, and reports keep working until every
 * call site is migrated.
 */

import { eq, and, sql } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderSequencesTable,
  branchesTable,
  restaurantsTable,
  restaurantSettingsTable,
} from "./db";

export const ORDER_NUMBERING_SECTION = "order-numbering";

// All seven recognised display prefixes. Anything not in this map
// (custom/cloud-kitchen order types) falls back to a generic prefix.
export const ORDER_TYPE_PREFIXES = {
  dine_in: "DN",
  takeaway: "TK",
  delivery: "DL",
  qr: "QR",
  reservation: "RS",
  tiffin: "TF",
  catering: "CT",
} as const;

const PREFIX_LABELS: Record<string, string> = {
  DN: "Dine-in",
  TK: "Takeaway",
  DL: "Delivery",
  QR: "QR",
  RS: "Reservation",
  TF: "Tiffin",
  CT: "Catering",
  OR: "Other",
};

export type OrderNumberingSettings = {
  enabled: boolean;
  showDisplayNumberToGuests: boolean;
  showInternalNumberInAudit: boolean;
  resetDaily: boolean;
  zeroPadDisplay: boolean;
  prefixes: Record<string, string>;
};

export const DEFAULT_ORDER_NUMBERING_SETTINGS: OrderNumberingSettings = {
  enabled: true,
  showDisplayNumberToGuests: true,
  showInternalNumberInAudit: true,
  resetDaily: true,
  zeroPadDisplay: true,
  // 6 owner-configurable toggles above + custom prefix map. All defaults
  // are ON so a fresh restaurant gets short numbers out of the box.
  prefixes: { ...ORDER_TYPE_PREFIXES },
};

export function prefixLabel(prefix: string): string {
  return PREFIX_LABELS[prefix] ?? prefix;
}

export function prefixForOrderType(
  orderType: string | null | undefined,
  overrides?: Record<string, string>,
): string {
  if (!orderType) return overrides?.dine_in ?? "DN";
  const map = overrides ?? ORDER_TYPE_PREFIXES;
  const hit = (map as Record<string, string>)[orderType];
  if (hit && /^[A-Z0-9]{2,6}$/.test(hit)) return hit;
  // Cloud-kitchen / custom types map to "OR" so they still get a sequence
  // without colliding with the seven canonical prefixes.
  return "OR";
}

export async function loadOrderNumberingSettings(
  restaurantId: number,
): Promise<OrderNumberingSettings> {
  const [row] = await db
    .select({ data: restaurantSettingsTable.data })
    .from(restaurantSettingsTable)
    .where(and(
      eq(restaurantSettingsTable.restaurantId, restaurantId),
      eq(restaurantSettingsTable.section, ORDER_NUMBERING_SECTION),
    ));
  const raw = (row?.data ?? {}) as Partial<OrderNumberingSettings>;
  return {
    ...DEFAULT_ORDER_NUMBERING_SETTINGS,
    ...raw,
    prefixes: { ...ORDER_TYPE_PREFIXES, ...(raw.prefixes ?? {}) },
  };
}

export async function seedDefaultOrderNumberingSettings(
  restaurantId: number,
  updatedByUserId: number | null = null,
): Promise<void> {
  await db
    .insert(restaurantSettingsTable)
    .values({
      restaurantId,
      section: ORDER_NUMBERING_SECTION,
      data: DEFAULT_ORDER_NUMBERING_SETTINGS,
      updatedBy: updatedByUserId,
    })
    .onConflictDoNothing({
      target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
    });
}

/**
 * Resolve the business-date string (`YYYY-MM-DD`) the order belongs to,
 * honouring the restaurant timezone when present. Falls back to
 * Asia/Kolkata (the default deployment timezone) when unset.
 */
export function businessDateFor(
  now: Date,
  timezone: string | null | undefined,
): string {
  const tz = timezone && timezone.trim().length > 0 ? timezone : "Asia/Kolkata";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    // en-CA already produces "YYYY-MM-DD"
    return parts;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function compactDate(businessDate: string): string {
  return businessDate.replace(/-/g, "");
}

function padSequence(seq: number, zeroPad: boolean): string {
  if (!zeroPad) return String(seq);
  return seq < 1000 ? String(seq).padStart(3, "0") : String(seq);
}

function deriveOutletCodeFromName(name: string | null | undefined): string {
  if (!name) return "MAIN";
  const cleaned = name.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!cleaned) return "MAIN";
  return cleaned.slice(0, 4) || "MAIN";
}

/**
 * Look up — or derive and persist — the outlet code for a branch. Falls
 * back to a restaurant-level code (first 4 letters of the slug/name) when
 * the order is not bound to a branch.
 */
export async function resolveOutletCode(
  restaurantId: number,
  branchId: number | null | undefined,
): Promise<{ outletCode: string; branchId: number }> {
  if (branchId != null) {
    const [b] = await db
      .select({ id: branchesTable.id, outletCode: branchesTable.outletCode, name: branchesTable.name })
      .from(branchesTable)
      .where(and(eq(branchesTable.id, branchId), eq(branchesTable.restaurantId, restaurantId)));
    if (b) {
      if (b.outletCode && b.outletCode.trim().length > 0) {
        return { outletCode: b.outletCode.toUpperCase(), branchId: b.id };
      }
      const derived = deriveOutletCodeFromName(b.name);
      await db.update(branchesTable).set({ outletCode: derived, updatedAt: new Date() })
        .where(eq(branchesTable.id, b.id));
      return { outletCode: derived, branchId: b.id };
    }
  }
  // No branch — derive from restaurant slug/name.
  const [r] = await db
    .select({ slug: restaurantsTable.slug, name: restaurantsTable.name })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  return { outletCode: deriveOutletCodeFromName(r?.slug ?? r?.name ?? "MAIN"), branchId: 0 };
}

export type MintedNumbers = {
  orderNumber: string;        // legacy column — set to internal id
  orderDisplayNumber: string;
  orderInternalNumber: string;
  dailySequence: number;
  orderTypePrefix: string;
  outletCode: string;
  businessDate: string;
  resolvedBranchId: number;   // sentinel 0 means "no branch"
};

/**
 * Atomically mint the next pair of numbers for an order. Safe under
 * concurrent inserts thanks to the unique index on
 * (restaurantId, branchId, businessDate, orderTypePrefix) and the
 * INSERT … ON CONFLICT … DO UPDATE RETURNING pattern, which serialises
 * the increment at the row level inside the active transaction.
 *
 * Caller is responsible for writing the returned fields onto the new
 * orders row (`ordersTable`). No other tables are touched.
 */
export async function mintOrderNumbers(opts: {
  restaurantId: number;
  branchId: number | null | undefined;
  orderType: string | null | undefined;
  now?: Date;
}): Promise<MintedNumbers> {
  const { restaurantId } = opts;
  const now = opts.now ?? new Date();

  const [restaurant] = await db
    .select({ timezone: restaurantsTable.timezone })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));

  const settings = await loadOrderNumberingSettings(restaurantId);
  const prefix = prefixForOrderType(opts.orderType, settings.prefixes);
  const { outletCode, branchId: resolvedBranchId } = await resolveOutletCode(restaurantId, opts.branchId);
  const businessDate = businessDateFor(now, restaurant?.timezone);

  // Atomic UPSERT — increment the per-outlet/day/type counter and return
  // the new value. The unique index guarantees no duplicates.
  const [seqRow] = await db
    .insert(orderSequencesTable)
    .values({
      restaurantId,
      branchId: resolvedBranchId,
      businessDate,
      orderTypePrefix: prefix,
      lastSequence: 1,
    })
    .onConflictDoUpdate({
      target: [
        orderSequencesTable.restaurantId,
        orderSequencesTable.branchId,
        orderSequencesTable.businessDate,
        orderSequencesTable.orderTypePrefix,
      ],
      set: {
        lastSequence: sql`${orderSequencesTable.lastSequence} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ lastSequence: orderSequencesTable.lastSequence });

  const sequence = Number(seqRow?.lastSequence ?? 1);
  const displayPrefix = settings.enabled ? prefix : "ORD";
  const orderDisplayNumber = `${displayPrefix}-${padSequence(sequence, settings.zeroPadDisplay)}`;

  // Internal number — 6-digit zero-padded counter scoped to the same
  // (outlet, business-day, type) bucket. The prefix segment MUST appear
  // in the internal id, otherwise DN-001 and TK-001 on the same day
  // would both serialise to `KL-{outlet}-{date}-000001` (collision).
  const internalSequence = String(sequence).padStart(6, "0");
  const orderInternalNumber = `KL-${outletCode}-${compactDate(businessDate)}-${prefix}-${internalSequence}`;

  return {
    orderNumber: orderInternalNumber,
    orderDisplayNumber,
    orderInternalNumber,
    dailySequence: sequence,
    orderTypePrefix: prefix,
    outletCode,
    businessDate,
    resolvedBranchId,
  };
}
