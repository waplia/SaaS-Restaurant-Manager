import { eq, and, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, orderDiscountsTable, restaurantSettingsTable } from "./db";

export type AppRoleKey = "owner" | "manager" | "cashier" | "waiter" | "kitchen" | "delivery_executive" | "accountant" | "staff";

// Per-role discount cap. `percent` and `amount` are *both* applied as ceilings:
// the discount must satisfy BOTH limits or it requires manager approval.
// `0` (or null) means "no cap from this dimension".
export interface RoleCap {
  percent: number; // 0 = unlimited
  amount: number;  // 0 = unlimited (rupees)
}

export interface SuspiciousDiscountConfig {
  // % of single-bill discount that triggers a flag (covered by detector too).
  perBillPercent: number;
  // Rupee amount per cashier per shift that triggers a flag.
  perShiftAmount: number;
  // Per-customer: if a phone hits this many discounted visits in window, flag.
  perCustomerMaxVisits: number;
  // Min discount % counted toward perCustomerMaxVisits.
  perCustomerVisitDiscountPct: number;
}

export interface DiscountsConfig {
  presetReasons: string[];
  thresholdPercent: number;
  thresholdAmount: number;
  hasManagerPin: boolean;
  managerPinHash: string | null;
  // OTP fallback when PIN is unavailable (or as the sole approval method).
  otpEnabled: boolean;
  // Per-role caps. Cashier/waiter typically tighter than manager.
  roleCaps: Partial<Record<AppRoleKey, RoleCap>>;
  // Suspicious-discount detector tuning.
  suspicious: SuspiciousDiscountConfig;
}

const DEFAULT_REASONS = [
  "Loyal customer",
  "Comp item",
  "Manager override",
  "Damaged / quality issue",
  "Promo / marketing",
  "Staff meal",
];

const DEFAULT_ROLE_CAPS: Partial<Record<AppRoleKey, RoleCap>> = {
  cashier: { percent: 10, amount: 200 },
  waiter:  { percent: 10, amount: 200 },
  manager: { percent: 30, amount: 1000 },
  // owner/super_admin have no cap by default — they bypass.
};

const DEFAULT_SUSPICIOUS: SuspiciousDiscountConfig = {
  perBillPercent: 50,
  perShiftAmount: 5000,
  perCustomerMaxVisits: 5,
  perCustomerVisitDiscountPct: 30,
};

interface RawDiscountsConfig {
  presetReasons?: unknown;
  thresholdPercent?: unknown;
  thresholdAmount?: unknown;
  managerPinHash?: unknown;
  otpEnabled?: unknown;
  roleCaps?: unknown;
  suspicious?: unknown;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseRoleCaps(v: unknown): Partial<Record<AppRoleKey, RoleCap>> {
  if (!v || typeof v !== "object") return DEFAULT_ROLE_CAPS;
  const out: Partial<Record<AppRoleKey, RoleCap>> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { percent?: unknown; amount?: unknown };
    out[k as AppRoleKey] = { percent: num(r.percent, 0), amount: num(r.amount, 0) };
  }
  // Fill defaults for any role not configured.
  for (const [k, def] of Object.entries(DEFAULT_ROLE_CAPS)) {
    if (!(k in out)) out[k as AppRoleKey] = def!;
  }
  return out;
}

function parseSuspicious(v: unknown): SuspiciousDiscountConfig {
  if (!v || typeof v !== "object") return DEFAULT_SUSPICIOUS;
  const r = v as Partial<SuspiciousDiscountConfig>;
  return {
    perBillPercent: num(r.perBillPercent, DEFAULT_SUSPICIOUS.perBillPercent),
    perShiftAmount: num(r.perShiftAmount, DEFAULT_SUSPICIOUS.perShiftAmount),
    perCustomerMaxVisits: num(r.perCustomerMaxVisits, DEFAULT_SUSPICIOUS.perCustomerMaxVisits),
    perCustomerVisitDiscountPct: num(r.perCustomerVisitDiscountPct, DEFAULT_SUSPICIOUS.perCustomerVisitDiscountPct),
  };
}

export async function loadDiscountsConfig(restaurantId: number): Promise<DiscountsConfig> {
  const [row] = await db.select().from(restaurantSettingsTable).where(and(
    eq(restaurantSettingsTable.restaurantId, restaurantId),
    eq(restaurantSettingsTable.section, "discounts"),
  ));
  const data = (row?.data ?? {}) as RawDiscountsConfig;
  const presetReasons = Array.isArray(data.presetReasons) && data.presetReasons.length > 0
    ? data.presetReasons.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    : DEFAULT_REASONS;
  const thresholdPercent = Number(data.thresholdPercent ?? 15);
  const thresholdAmount = Number(data.thresholdAmount ?? 500);
  const managerPinHash = typeof data.managerPinHash === "string" && data.managerPinHash.length > 0
    ? data.managerPinHash : null;
  return {
    presetReasons,
    thresholdPercent: isFinite(thresholdPercent) && thresholdPercent > 0 ? thresholdPercent : 15,
    thresholdAmount: isFinite(thresholdAmount) && thresholdAmount > 0 ? thresholdAmount : 500,
    hasManagerPin: !!managerPinHash,
    managerPinHash,
    otpEnabled: data.otpEnabled === true,
    roleCaps: parseRoleCaps(data.roleCaps),
    suspicious: parseSuspicious(data.suspicious),
  };
}

export function exceedsThreshold(amount: number, subtotal: number, cfg: DiscountsConfig): boolean {
  if (subtotal <= 0) return amount > 0; // any discount on an empty order needs approval
  const pct = (amount / subtotal) * 100;
  return pct >= cfg.thresholdPercent || amount >= cfg.thresholdAmount;
}

// Returns true when the requested discount exceeds the role's cap and so
// requires manager approval. owner/super_admin/manager (when manager has no
// cap configured) bypass this check.
export function exceedsRoleCap(role: string | undefined, isSuperAdmin: boolean, amount: number, subtotal: number, cfg: DiscountsConfig): boolean {
  if (isSuperAdmin || role === "owner") return false;
  const cap = cfg.roleCaps[role as AppRoleKey];
  if (!cap) return false;
  const pctCapHit = cap.percent > 0 && subtotal > 0 && (amount / subtotal) * 100 > cap.percent;
  const amtCapHit = cap.amount > 0 && amount > cap.amount;
  return pctCapHit || amtCapHit;
}

export async function verifyManagerPin(pin: string, cfg: DiscountsConfig): Promise<boolean> {
  if (!cfg.managerPinHash) return false;
  const candidate = String(pin ?? "").trim();
  if (!candidate) return false;
  return bcrypt.compare(candidate, cfg.managerPinHash);
}

export async function hashManagerPin(pin: string): Promise<string> {
  return bcrypt.hash(String(pin), 10);
}

export async function sumOrderDiscounts(orderId: number): Promise<number> {
  const [row] = await db.select({ total: sql<string>`COALESCE(SUM(${orderDiscountsTable.amount}), 0)` })
    .from(orderDiscountsTable).where(eq(orderDiscountsTable.orderId, orderId));
  return Number(row?.total ?? 0);
}

export async function listOrderDiscounts(orderId: number) {
  return db.select().from(orderDiscountsTable)
    .where(eq(orderDiscountsTable.orderId, orderId))
    .orderBy(orderDiscountsTable.createdAt);
}

export async function deleteOrderDiscountsByType(orderId: number, type: string): Promise<void> {
  await db.delete(orderDiscountsTable)
    .where(and(eq(orderDiscountsTable.orderId, orderId), eq(orderDiscountsTable.type, type)));
}

// ─── Defaults seeded on restaurant creation ──────────────────────────
//
// Every new restaurant gets a sensible set of cashier-facing discount
// reasons so the POS "Apply Discount" flow works on day one without the
// owner having to visit Settings → Discounts first. (Without preset
// reasons, the POS rejects every manual discount with a 422.)
//
// The seed is idempotent — if a discounts settings row already exists
// for the restaurant (e.g. owner already customised it), this is a no-op.
export const DEFAULT_DISCOUNT_PRESET_REASONS: readonly string[] = [
  "Loyal customer",
  "Comp item",
  "Manager override",
  "Damaged / quality issue",
  "Promo / marketing",
  "Staff meal",
];

export const DEFAULT_DISCOUNTS_CONFIG = {
  presetReasons: [...DEFAULT_DISCOUNT_PRESET_REASONS],
  thresholdPercent: 15,
  thresholdAmount: 500,
  otpEnabled: false,
  roleCaps: {
    cashier: { percent: 10, amount: 200 },
    waiter:  { percent: 10, amount: 200 },
    manager: { percent: 30, amount: 1000 },
  },
  suspicious: {
    perBillPercent: 50,
    perShiftAmount: 5000,
    perCustomerMaxVisits: 5,
    perCustomerVisitDiscountPct: 30,
  },
} as const;

type TxOrDb = typeof db;

/**
 * Seed the default `discounts` settings row for a brand-new restaurant.
 * Safe to call multiple times — uses INSERT … ON CONFLICT DO NOTHING on
 * (restaurantId, section) so an owner's existing customisations are
 * never overwritten.
 *
 * Pass a Drizzle transaction in `tx` to keep the seed inside the same
 * registration transaction; otherwise the default `db` handle is used.
 */
export async function seedDefaultDiscountSettings(
  restaurantId: number,
  updatedByUserId: number | null = null,
  tx: TxOrDb = db,
): Promise<void> {
  await tx
    .insert(restaurantSettingsTable)
    .values({
      restaurantId,
      section: "discounts",
      data: DEFAULT_DISCOUNTS_CONFIG,
      updatedBy: updatedByUserId,
    })
    .onConflictDoNothing({
      target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
    });
}
