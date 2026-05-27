/**
 * Task #647 — Dual order numbering.
 *
 * Two numbers are minted for every order at creation time:
 *
 *   1. `orderDisplayNumber`  — short, per-outlet, per-business-day,
 *                              per-order-type ticket number that staff
 *                              and guests see and call out. e.g. "DN-023"
 *                              for the 23rd dine-in of the day.
 *
 *   2. `orderInternalNumber` — permanent, globally-unique audit id of the
 *                              form `KL-R{restaurantId}-{outletCode}-YYYYMMDD-{PREFIX}-NNNNNN`.
 *                              The restaurantId + prefix segments make
 *                              collisions impossible across tenants, outlets,
 *                              and order types even on the same day.
 *
 * Atomicity is mandatory — the sequence increment MUST happen in the same
 * transaction as the order insert. All mint/seed helpers accept an
 * optional `tx` (Drizzle transaction handle) and fall back to the global
 * `db` only for non-transactional callers (background seeders).
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

// Drizzle transaction or the global db handle. Both expose the same
// insert/select/update API; mint must accept either.
type Executor = typeof db;

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

/**
 * The 6 owner-configurable toggles required by the task spec.
 * All default to ON / padding=3 so a fresh restaurant gets short
 * numbers out of the box.
 */
export type OrderNumberingSettings = {
  /** Reset counter at business-day rollover (off = single ever-growing counter per outlet/type). */
  dailyReset: boolean;
  /** Use per-type prefix (DN/TK/DL/…). Off = single shared "ORD" prefix for every order. */
  prefixByType: boolean;
  /** Zero-padding width for the display sequence: 3 → DN-023, 4 → DN-0023. */
  paddingDigits: 3 | 4;
  /** Include the table number on dine-in tickets/receipts alongside the ticket number. */
  includeTableNumberForDineIn: boolean;
  /** Include the originating counter code on the ticket (per-counter rollout is a follow-up). */
  includeCounterCode: boolean;
  /** Scope the sequence per outlet/branch (on) or share one counter across the whole restaurant (off). */
  outletWiseSequence: boolean;
  /** Per-type prefix overrides — owner can rename DN → DI etc. */
  prefixes: Record<string, string>;
};

export const DEFAULT_ORDER_NUMBERING_SETTINGS: OrderNumberingSettings = {
  dailyReset: true,
  prefixByType: true,
  paddingDigits: 3,
  includeTableNumberForDineIn: true,
  includeCounterCode: true,
  outletWiseSequence: true,
  prefixes: { ...ORDER_TYPE_PREFIXES },
};

export function prefixLabel(prefix: string): string {
  return PREFIX_LABELS[prefix] ?? prefix;
}

export function prefixForOrderType(
  orderType: string | null | undefined,
  overrides: Record<string, string> | undefined,
  prefixByType: boolean,
): string {
  if (!prefixByType) return "ORD";
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
  exec: Executor = db,
): Promise<OrderNumberingSettings> {
  const [row] = await exec
    .select({ data: restaurantSettingsTable.data })
    .from(restaurantSettingsTable)
    .where(and(
      eq(restaurantSettingsTable.restaurantId, restaurantId),
      eq(restaurantSettingsTable.section, ORDER_NUMBERING_SECTION),
    ));
  const raw = (row?.data ?? {}) as Partial<OrderNumberingSettings> & { enabled?: boolean };
  // Backward-compat: earlier rev shipped slightly different keys; coerce
  // them so existing rows still produce sensible numbers.
  const padding = raw.paddingDigits === 4 ? 4 : 3;
  return {
    ...DEFAULT_ORDER_NUMBERING_SETTINGS,
    ...raw,
    paddingDigits: padding,
    prefixes: { ...ORDER_TYPE_PREFIXES, ...(raw.prefixes ?? {}) },
  };
}

export async function seedDefaultOrderNumberingSettings(
  restaurantId: number,
  updatedByUserId: number | null = null,
  exec: Executor = db,
): Promise<void> {
  await exec
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
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function compactDate(businessDate: string): string {
  return businessDate.replace(/-/g, "");
}

function padSequence(seq: number, paddingDigits: 3 | 4): string {
  return String(seq).padStart(paddingDigits, "0");
}

/**
 * Outlet codes must be uppercase alphanumeric, 3–6 chars. Derive from
 * a name when not set; clamp to the valid range. Pads short names with
 * "X" so e.g. "AB" → "ABX" instead of returning an invalid 2-char code.
 */
export function normalizeOutletCode(raw: string | null | undefined, fallbackName?: string | null): string {
  const candidate = (raw && raw.trim().length > 0 ? raw : fallbackName ?? "").toUpperCase();
  const cleaned = candidate.replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "MAIN";
  if (cleaned.length < 3) return (cleaned + "XXX").slice(0, 3);
  return cleaned.slice(0, 6);
}

/**
 * Derive a JPR01-style base code from a branch name: take the initials
 * of the first three words (or letters of the first word) and uppercase.
 */
function deriveBaseFromName(name: string | null | undefined): string {
  const cleaned = (name ?? "").trim();
  if (!cleaned) return "OUT";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 3).map(w => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "OUT";
  }
  return cleaned.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "") || "OUT";
}

/**
 * Pick a unique-per-restaurant outlet code given a desired base. Tries
 * `BASE`, `BASE01`, `BASE02`, … until it finds one no other branch in
 * the restaurant is using. Always returns a 3–6 char uppercase code.
 */
async function pickUniqueOutletCode(
  restaurantId: number,
  baseRaw: string,
  excludeBranchId: number | null,
  exec: Executor,
): Promise<string> {
  const base = normalizeOutletCode(baseRaw, "OUT");
  const trunkLen = Math.min(4, Math.max(2, base.length));
  const trunk = base.slice(0, trunkLen);
  const rows = await exec
    .select({ id: branchesTable.id, outletCode: branchesTable.outletCode })
    .from(branchesTable)
    .where(eq(branchesTable.restaurantId, restaurantId));
  const taken = new Set(
    rows
      .filter(r => excludeBranchId == null || r.id !== excludeBranchId)
      .map(r => (r.outletCode ?? "").toUpperCase())
      .filter(Boolean),
  );
  if (!taken.has(base)) return base;
  for (let i = 1; i <= 99; i++) {
    const candidate = `${trunk}${String(i).padStart(2, "0")}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 99+ branches under the same trunk is astronomically unlikely. Append
  // the branch id as a last resort so we still return a unique value.
  return `${trunk}${(excludeBranchId ?? Date.now()).toString(36).toUpperCase().slice(-3)}`.slice(0, 6);
}

/**
 * Look up — or derive and persist — the outlet code for a branch. Falls
 * back to a restaurant-level code (derived from slug/name) when the order
 * is not bound to a branch. Honours `outletWiseSequence=false` by always
 * returning the restaurant-level code so the sequence collapses to one
 * shared counter.
 *
 * When a branch has a missing/invalid/colliding outlet code, this picks
 * a fresh JPR01-style unique code (per restaurant) and persists it so
 * subsequent orders are deterministic.
 */
export async function resolveOutletCode(
  restaurantId: number,
  branchId: number | null | undefined,
  outletWise: boolean,
  exec: Executor = db,
): Promise<{ outletCode: string; branchId: number }> {
  if (outletWise && branchId != null) {
    const [b] = await exec
      .select({ id: branchesTable.id, outletCode: branchesTable.outletCode, name: branchesTable.name })
      .from(branchesTable)
      .where(and(eq(branchesTable.id, branchId), eq(branchesTable.restaurantId, restaurantId)));
    if (b) {
      const stored = (b.outletCode ?? "").toUpperCase();
      // Valid + globally unique-per-restaurant? Reuse as-is.
      if (/^[A-Z0-9]{3,6}$/.test(stored)) {
        const dupes = await exec
          .select({ id: branchesTable.id })
          .from(branchesTable)
          .where(and(
            eq(branchesTable.restaurantId, restaurantId),
            eq(branchesTable.outletCode, stored),
          ));
        if (dupes.length <= 1) return { outletCode: stored, branchId: b.id };
      }
      // Need a fresh unique code derived from the branch name.
      const base = deriveBaseFromName(b.name);
      const chosen = await pickUniqueOutletCode(restaurantId, base, b.id, exec);
      await exec.update(branchesTable).set({ outletCode: chosen, updatedAt: new Date() })
        .where(eq(branchesTable.id, b.id));
      return { outletCode: chosen, branchId: b.id };
    }
  }
  const [r] = await exec
    .select({ slug: restaurantsTable.slug, name: restaurantsTable.name })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  return { outletCode: normalizeOutletCode(null, r?.slug ?? r?.name ?? "MAIN"), branchId: 0 };
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
 * Atomically mint the next pair of numbers for an order.
 *
 * Safety:
 *   - The unique index on `order_sequences(restaurantId, branchId,
 *     businessDate, orderTypePrefix)` plus the INSERT … ON CONFLICT …
 *     DO UPDATE RETURNING serialises the increment at the row level.
 *   - When called from inside a transaction (`exec: tx`), the sequence
 *     increment lives in the same transaction as the order insert, so
 *     a rollback releases the reservation.
 *   - When `dailyReset=false`, businessDate is folded to a sentinel
 *     ("ALL") so the same counter row is bumped every day.
 *   - When `outletWiseSequence=false`, branchId is forced to 0 so all
 *     outlets share a single counter row per type/day.
 */
export async function mintOrderNumbers(opts: {
  restaurantId: number;
  branchId: number | null | undefined;
  orderType: string | null | undefined;
  now?: Date;
  exec?: Executor;
}): Promise<MintedNumbers> {
  const { restaurantId } = opts;
  const exec = opts.exec ?? db;
  const now = opts.now ?? new Date();

  const [restaurant] = await exec
    .select({ timezone: restaurantsTable.timezone })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));

  const settings = await loadOrderNumberingSettings(restaurantId, exec);
  const prefix = prefixForOrderType(opts.orderType, settings.prefixes, settings.prefixByType);
  const { outletCode, branchId: resolvedBranchId } = await resolveOutletCode(
    restaurantId, opts.branchId, settings.outletWiseSequence, exec,
  );
  const trueBusinessDate = businessDateFor(now, restaurant?.timezone);
  // Sequence key when dailyReset is OFF folds to the sentinel "1970-01-01"
  // so the same counter row is bumped on every insert (per outlet/type).
  // The order row still gets the real businessDate for reporting.
  const sequenceDate = settings.dailyReset ? trueBusinessDate : "1970-01-01";

  const [seqRow] = await exec
    .insert(orderSequencesTable)
    .values({
      restaurantId,
      branchId: resolvedBranchId,
      businessDate: sequenceDate,
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
  const orderDisplayNumber = `${prefix}-${padSequence(sequence, settings.paddingDigits)}`;

  // Internal number — restaurantId, outletCode, prefix, and a 6-digit
  // zero-padded sequence together make collisions impossible across
  // tenants, outlets, types, and time. The unique constraint on
  // (restaurantId, branchId, businessDate, prefix) at the sequence
  // table is the real safety net; this format is the human-readable
  // serialisation of that uniqueness.
  const internalSequence = String(sequence).padStart(6, "0");
  const orderInternalNumber =
    `KL-R${restaurantId}-${outletCode}-${compactDate(trueBusinessDate)}-${prefix}-${internalSequence}`;

  return {
    orderNumber: orderInternalNumber,
    orderDisplayNumber,
    orderInternalNumber,
    dailySequence: sequence,
    orderTypePrefix: prefix,
    outletCode,
    businessDate: trueBusinessDate,
    resolvedBranchId,
  };
}

/**
 * Pure helper for live previews on the settings page (no DB I/O).
 * Renders what a display number would look like at sequence=23 / 7.
 */
export function previewDisplayNumber(
  orderType: string,
  settings: OrderNumberingSettings,
  sequence = 23,
): string {
  const prefix = prefixForOrderType(orderType, settings.prefixes, settings.prefixByType);
  return `${prefix}-${padSequence(sequence, settings.paddingDigits)}`;
}
