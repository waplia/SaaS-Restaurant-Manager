// Resolves the effective UPI QR config for a printed bill.
//
// Two layers feed the resolver:
//   1. The restaurant defaults (`restaurants.upi_*`). These are the master
//      switches owners configure once.
//   2. Per-outlet overrides on `branches` for shops that want a different VPA
//      per location (e.g. franchised outlets). Only the override-eligible
//      fields are mirrored on the branch row.
//
// The `upiQrEnabled` field on branches is tri-state: `null` means "inherit
// from the restaurant", `true` / `false` are explicit overrides.

import { eq } from "drizzle-orm";
import { db, restaurantsTable, branchesTable } from "./db";

export interface BillUpiConfig {
  upiQrEnabled: boolean;
  upiId: string | null;
  upiMerchantName: string | null;
  upiQrLabel: string;
  showUpiQrOnBill: boolean;
  showUpiIdOnBill: boolean;
  upiPaymentNoteFormat: string;
  upiPrintQrMode: "all" | "unpaid" | "upi_online_only" | "hide_after_paid";
}

const DEFAULTS: BillUpiConfig = {
  upiQrEnabled: false,
  upiId: null,
  upiMerchantName: null,
  upiQrLabel: "Scan to Pay",
  showUpiQrOnBill: true,
  showUpiIdOnBill: false,
  upiPaymentNoteFormat: "Bill {orderNumber}",
  upiPrintQrMode: "all",
};

/**
 * Resolve the effective UPI bill-print configuration for `restaurantId`,
 * optionally narrowed by `branchId`. Branch values fall back to restaurant
 * values which in turn fall back to safe defaults so the caller never has
 * to deal with `null` booleans on print paths.
 */
export async function resolveBillUpiConfig(
  restaurantId: number,
  branchId?: number | null,
): Promise<BillUpiConfig> {
  const [r] = await db
    .select()
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  if (!r) return DEFAULTS;

  const rr = r as unknown as Record<string, unknown>;
  const restaurantCfg: BillUpiConfig = {
    upiQrEnabled: !!rr.upiQrEnabled,
    upiId: (rr.upiId as string | null) ?? null,
    upiMerchantName: (rr.upiMerchantName as string | null) ?? (r.name ?? null),
    upiQrLabel: (rr.upiQrLabel as string | null) ?? DEFAULTS.upiQrLabel,
    showUpiQrOnBill: rr.showUpiQrOnBill !== false,
    showUpiIdOnBill: !!rr.showUpiIdOnBill,
    upiPaymentNoteFormat: (rr.upiPaymentNoteFormat as string | null) ?? DEFAULTS.upiPaymentNoteFormat,
    upiPrintQrMode: ((rr.upiPrintQrMode as BillUpiConfig["upiPrintQrMode"]) ?? DEFAULTS.upiPrintQrMode),
  };

  if (!branchId) return restaurantCfg;

  const [b] = await db
    .select()
    .from(branchesTable)
    .where(eq(branchesTable.id, branchId));
  if (!b) return restaurantCfg;

  const bb = b as unknown as Record<string, unknown>;
  // Tri-state: null = inherit, boolean = override.
  const branchQrEnabled = bb.upiQrEnabled;
  return {
    ...restaurantCfg,
    upiQrEnabled:
      branchQrEnabled == null ? restaurantCfg.upiQrEnabled : !!branchQrEnabled,
    upiId: ((bb.upiId as string | null) ?? "").trim() || restaurantCfg.upiId,
    upiMerchantName:
      ((bb.upiMerchantName as string | null) ?? "").trim() || restaurantCfg.upiMerchantName,
  };
}
