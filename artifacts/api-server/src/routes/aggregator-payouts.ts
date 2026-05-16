/**
 * Delivery aggregator payout reconciliation (Task #148).
 *
 * Restaurants upload a payout CSV from Swiggy / Zomato / Uber Eats / generic,
 * we parse it, match every row to a local order, flag mismatches against the
 * configured agreement, and expose dashboards, claims, manual adjustments,
 * and CSV exports.
 *
 * Mounting:
 *   GET    /restaurants/:rid/aggregator-payouts/agreements
 *   PUT    /restaurants/:rid/aggregator-payouts/agreements/:aggregator
 *
 *   GET    /restaurants/:rid/aggregator-payouts/sheets
 *   POST   /restaurants/:rid/aggregator-payouts/sheets       (upload CSV body)
 *   GET    /restaurants/:rid/aggregator-payouts/sheets/:id
 *   GET    /restaurants/:rid/aggregator-payouts/sheets/:id/rows
 *   POST   /restaurants/:rid/aggregator-payouts/sheets/:id/rerun
 *
 *   GET    /restaurants/:rid/aggregator-payouts/dashboard?from=&to=&aggregator=
 *   GET    /restaurants/:rid/aggregator-payouts/commission-report?from=&to=&aggregator=
 *
 *   GET    /restaurants/:rid/aggregator-payouts/claims
 *   POST   /restaurants/:rid/aggregator-payouts/claims
 *   PATCH  /restaurants/:rid/aggregator-payouts/claims/:id
 *
 *   GET    /restaurants/:rid/aggregator-payouts/adjustments
 *   POST   /restaurants/:rid/aggregator-payouts/adjustments
 *
 *   GET    /restaurants/:rid/aggregator-payouts/exports/recon.csv?sheetId=
 *   GET    /restaurants/:rid/aggregator-payouts/exports/claims.csv?from=&to=
 */
import { Router } from "express";
import { eq, and, desc, gte, lte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  aggregatorAgreementsTable,
  aggregatorPayoutSheetsTable,
  aggregatorPayoutRowsTable,
  aggregatorReconResultsTable,
  aggregatorClaimsTable,
  aggregatorAdjustmentsTable,
  ordersTable,
  AGGREGATORS,
  AGGREGATOR_CLAIM_STATUSES,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { recordAuditLog } from "../lib/audit";

const router = Router();

const tid = (req: any) => Number(req.user!.tenantId);
const rid = (req: any) => Number(req.params.restaurantId);
const uid = (req: any) => Number(req.user?.sub ?? req.user?.id) || null;

const aggregatorEnum = z.enum(AGGREGATORS);

router.use(
  "/restaurants/:restaurantId/aggregator-payouts",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

// ─── CSV parsing (RFC4180-ish, mirrors menu-imports.ts:253) ──────────────────

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim().length > 0));
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rupeesToPaise(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  // Accept dd/mm/yyyy, dd-mm-yyyy, ISO, or yyyy-mm-dd
  const dmy = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const yr = y.length === 2 ? 2000 + Number(y) : Number(y);
    const dt = new Date(Date.UTC(yr, Number(m) - 1, Number(d)));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(t);
  return isNaN(dt.getTime()) ? null : dt;
}

// ─── Per-aggregator column maps (case-insensitive substrings) ───────────────

interface ColumnMap {
  externalOrderId: string[];
  orderDate: string[];
  customerName: string[];
  status: string[];
  gross: string[];
  commission: string[];
  tax: string[];
  promo: string[];
  refund: string[];
  net: string[];
}

const COLUMN_MAPS: Record<string, ColumnMap> = {
  swiggy: {
    externalOrderId: ["order id", "order_id", "order no"],
    orderDate: ["order date", "date"],
    customerName: ["customer", "customer name"],
    status: ["status", "order status"],
    gross: ["order total", "subtotal", "gross"],
    commission: ["commission", "swiggy fee", "platform fee"],
    tax: ["tax", "gst", "tcs"],
    promo: ["promo", "discount", "offer"],
    refund: ["refund", "cancellation"],
    net: ["net payout", "net", "payable", "to pay"],
  },
  zomato: {
    externalOrderId: ["order id", "res order id", "order_id"],
    orderDate: ["order date", "date"],
    customerName: ["customer", "customer name"],
    status: ["status", "order status"],
    gross: ["item total", "order value", "gross", "subtotal"],
    commission: ["commission", "zomato commission", "platform fee"],
    tax: ["tax", "gst", "tcs"],
    promo: ["promo", "discount", "offer"],
    refund: ["refund", "merchant refund"],
    net: ["net merchant payout", "net payout", "payable", "net"],
  },
  ubereats: {
    externalOrderId: ["order id", "order uuid"],
    orderDate: ["order date", "fulfilled at", "date"],
    customerName: ["customer", "eater"],
    status: ["status"],
    gross: ["sales", "subtotal", "gross"],
    commission: ["uber service fee", "marketplace fee", "commission"],
    tax: ["tax", "gst"],
    promo: ["promo", "discount", "offer"],
    refund: ["refund", "adjustment"],
    net: ["payout", "net", "total payout"],
  },
  other: {
    externalOrderId: ["order id", "order_id", "id", "external id"],
    orderDate: ["date", "order date"],
    customerName: ["customer", "name"],
    status: ["status"],
    gross: ["gross", "subtotal", "amount"],
    commission: ["commission", "fee"],
    tax: ["tax", "gst"],
    promo: ["promo", "discount"],
    refund: ["refund"],
    net: ["net", "payout"],
  },
};

function buildHeaderIndex(headers: string[], map: ColumnMap): Record<keyof ColumnMap, number> {
  const norm = headers.map(h => h.trim().toLowerCase());
  const out = {} as Record<keyof ColumnMap, number>;
  (Object.keys(map) as Array<keyof ColumnMap>).forEach(k => {
    out[k] = -1;
    for (const candidate of map[k]) {
      const idx = norm.findIndex(h => h.includes(candidate));
      if (idx !== -1) { out[k] = idx; break; }
    }
  });
  return out;
}

// ─── Matching & mismatch detection engine ────────────────────────────────────

interface MatchedPair {
  rowId: number | null;
  orderId: number | null;
  issueType: string;
  impact: number;
  expected: number | null;
  actual: number | null;
  matchMethod: "external_id" | "date_amount" | "none";
  reason: string;
}

async function runReconciliation(sheetId: number, restaurantId: number, tenantId: number, aggregator: string) {
  const [agreement] = await db.select().from(aggregatorAgreementsTable)
    .where(and(eq(aggregatorAgreementsTable.restaurantId, restaurantId), eq(aggregatorAgreementsTable.aggregator, aggregator)));
  const commissionBps = agreement?.commissionBps ?? 0;
  const gstBps = agreement?.gstBps ?? 500;
  const tolerance = agreement?.tolerancePaise ?? 100;

  const [sheet] = await db.select().from(aggregatorPayoutSheetsTable).where(eq(aggregatorPayoutSheetsTable.id, sheetId));
  if (!sheet) throw new Error("sheet_missing");

  const rows = await db.select().from(aggregatorPayoutRowsTable)
    .where(eq(aggregatorPayoutRowsTable.sheetId, sheetId));

  // Pull every order in this aggregator + period for matching (both by id and date+amount fallback).
  const periodOrders = await db.select({
    id: ordersTable.id,
    orderNumber: ordersTable.orderNumber,
    aggregatorName: ordersTable.aggregatorName,
    aggregatorOrderId: ordersTable.aggregatorOrderId,
    totalAmount: ordersTable.totalAmount,
    subtotal: ordersTable.subtotal,
    status: ordersTable.status,
    createdAt: ordersTable.createdAt,
  }).from(ordersTable).where(and(
    eq(ordersTable.restaurantId, restaurantId),
    gte(ordersTable.createdAt, sheet.periodFrom),
    lte(ordersTable.createdAt, sheet.periodTo),
  ));

  const ordersByExternal = new Map<string, typeof periodOrders[number]>();
  for (const o of periodOrders) {
    if (o.aggregatorName?.toLowerCase() === aggregator && o.aggregatorOrderId) {
      ordersByExternal.set(o.aggregatorOrderId, o);
    }
  }

  const usedOrderIds = new Set<number>();
  const results: MatchedPair[] = [];

  for (const r of rows) {
    const grossPaise = r.grossPaise;
    const expectedCommission = Math.round(grossPaise * commissionBps / 10000);
    const expectedTax = Math.round(grossPaise * gstBps / 10000);
    const expectedNet = grossPaise - expectedCommission - expectedTax - r.promoPaise - r.refundPaise;

    let order: typeof periodOrders[number] | undefined;
    let matchMethod: "external_id" | "date_amount" | "none" = "none";
    if (r.externalOrderId) {
      order = ordersByExternal.get(r.externalOrderId);
      if (order) matchMethod = "external_id";
    }
    if (!order) {
      const orderTotalPaise = (o: typeof periodOrders[number]) => Math.round(Number(o.totalAmount) * 100);
      const candidate = periodOrders.find(o => !usedOrderIds.has(o.id)
        && Math.abs(orderTotalPaise(o) - grossPaise) <= tolerance
        && (!r.orderDate || Math.abs(o.createdAt.getTime() - r.orderDate.getTime()) < 36 * 3600 * 1000));
      if (candidate) { order = candidate; matchMethod = "date_amount"; }
    }
    if (order) usedOrderIds.add(order.id);

    // Detect issues. Order matters: cancellation/refund mismatches dominate
    // amount mismatches (since cancelled orders won't pay out the full gross).
    let issueType = "matched";
    let impact = 0;
    let reason = "";

    if (!order) {
      issueType = "missing_order";
      impact = r.netPaise; // we received money for an order we have no record of — neutral but flag for owner
      reason = "Payout row has no matching order in our system";
    } else {
      const localCancelled = order.status === "cancelled";
      const aggrCancelled = (r.status ?? "").toLowerCase().includes("cancel");
      const aggrRefunded = r.refundPaise > 0 || (r.status ?? "").toLowerCase().includes("refund");

      if (localCancelled !== aggrCancelled) {
        issueType = "cancellation_mismatch";
        reason = `Aggregator status "${r.status ?? "unknown"}" vs local status "${order.status}"`;
        impact = r.netPaise;
      } else if (aggrRefunded) {
        // Compare refund amount (we don't always track this locally — flag if non-zero refund)
        if (Math.abs(r.refundPaise - 0) > tolerance) {
          issueType = "refund_mismatch";
          reason = `Aggregator refunded ₹${(r.refundPaise / 100).toFixed(2)} for this order`;
          impact = -r.refundPaise;
        }
      } else if (Math.abs(r.commissionPaise - expectedCommission) > tolerance && r.commissionPaise > expectedCommission) {
        issueType = "excess_commission";
        impact = r.commissionPaise - expectedCommission; // aggregator owes us back
        reason = `Commission ₹${(r.commissionPaise / 100).toFixed(2)} exceeds agreed ${(commissionBps / 100).toFixed(2)}% (₹${(expectedCommission / 100).toFixed(2)})`;
      } else if (Math.abs(r.taxPaise - expectedTax) > tolerance) {
        issueType = "tax_mismatch";
        impact = expectedTax - r.taxPaise;
        reason = `GST ₹${(r.taxPaise / 100).toFixed(2)} differs from expected ₹${(expectedTax / 100).toFixed(2)}`;
      } else if (Math.abs(r.netPaise - expectedNet) > tolerance) {
        issueType = "amount_mismatch";
        impact = expectedNet - r.netPaise;
        reason = `Net payout ₹${(r.netPaise / 100).toFixed(2)} differs from expected ₹${(expectedNet / 100).toFixed(2)}`;
      }
    }

    results.push({
      rowId: r.id,
      orderId: order?.id ?? null,
      issueType,
      impact,
      expected: order ? expectedNet : null,
      actual: r.netPaise,
      matchMethod,
      reason,
    });
  }

  // Detect missing payouts: aggregator-tagged orders within the period that
  // were not matched to any sheet row.
  for (const o of periodOrders) {
    if (usedOrderIds.has(o.id)) continue;
    if (o.aggregatorName?.toLowerCase() !== aggregator) continue;
    const orderPaise = Math.round(Number(o.totalAmount) * 100);
    const expectedCommission = Math.round(orderPaise * commissionBps / 10000);
    const expectedTax = Math.round(orderPaise * gstBps / 10000);
    const expectedNet = orderPaise - expectedCommission - expectedTax;
    results.push({
      rowId: null,
      orderId: o.id,
      issueType: "missing_payout",
      impact: expectedNet,
      expected: expectedNet,
      actual: 0,
      matchMethod: "none",
      reason: `Order #${o.orderNumber} not present in payout sheet`,
    });
  }

  // Wipe previous results for this sheet, then insert fresh.
  await db.delete(aggregatorReconResultsTable).where(eq(aggregatorReconResultsTable.sheetId, sheetId));
  if (results.length > 0) {
    await db.insert(aggregatorReconResultsTable).values(results.map(r => ({
      sheetId,
      tenantId,
      restaurantId,
      rowId: r.rowId,
      orderId: r.orderId,
      issueType: r.issueType,
      impactPaise: r.impact,
      expectedPaise: r.expected ?? undefined,
      actualPaise: r.actual ?? undefined,
      matchMethod: r.matchMethod,
      reason: r.reason,
      status: r.issueType === "matched" ? "resolved" : "open",
    })));
  }

  const matched = results.filter(r => r.issueType === "matched").length;
  const disputed = results.filter(r => r.issueType !== "matched" && r.issueType !== "missing_payout").length;
  const unmatched = results.filter(r => r.issueType === "missing_payout" || r.issueType === "missing_order").length;

  await db.update(aggregatorPayoutSheetsTable).set({
    matchedCount: matched, disputedCount: disputed, unmatchedCount: unmatched,
    status: "reconciled", updatedAt: new Date(),
  }).where(eq(aggregatorPayoutSheetsTable.id, sheetId));

  return { matched, disputed, unmatched, total: results.length };
}

// ─── Agreements ──────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/aggregator-payouts/agreements", async (req, res) => {
  const rows = await db.select().from(aggregatorAgreementsTable)
    .where(and(eq(aggregatorAgreementsTable.tenantId, tid(req)), eq(aggregatorAgreementsTable.restaurantId, rid(req))));
  res.json(rows);
});

router.put("/restaurants/:restaurantId/aggregator-payouts/agreements/:aggregator", async (req, res) => {
  const aggregator = aggregatorEnum.safeParse(req.params.aggregator);
  if (!aggregator.success) { res.status(400).json({ error: "invalid_aggregator" }); return; }
  const schema = z.object({
    commissionBps: z.number().int().min(0).max(10000),
    gstBps: z.number().int().min(0).max(10000),
    tolerancePaise: z.number().int().min(0).max(100000).optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const [existing] = await db.select().from(aggregatorAgreementsTable)
    .where(and(eq(aggregatorAgreementsTable.restaurantId, rid(req)), eq(aggregatorAgreementsTable.aggregator, aggregator.data)));
  let row;
  if (existing) {
    [row] = await db.update(aggregatorAgreementsTable).set({
      commissionBps: d.commissionBps, gstBps: d.gstBps,
      tolerancePaise: d.tolerancePaise ?? existing.tolerancePaise,
      notes: d.notes, updatedAt: new Date(),
    }).where(eq(aggregatorAgreementsTable.id, existing.id)).returning();
  } else {
    [row] = await db.insert(aggregatorAgreementsTable).values({
      tenantId: tid(req), restaurantId: rid(req), aggregator: aggregator.data,
      commissionBps: d.commissionBps, gstBps: d.gstBps,
      tolerancePaise: d.tolerancePaise ?? 100, notes: d.notes,
      createdBy: uid(req),
    }).returning();
  }
  await recordAuditLog({ req, module: "aggregator_payouts", action: "agreement_saved", entity: "aggregator_agreement", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.json(row);
});

// ─── Sheets: list / get / upload ─────────────────────────────────────────────

router.get("/restaurants/:restaurantId/aggregator-payouts/sheets", async (req, res) => {
  const aggregator = req.query.aggregator ? String(req.query.aggregator) : null;
  const conds = [
    eq(aggregatorPayoutSheetsTable.tenantId, tid(req)),
    eq(aggregatorPayoutSheetsTable.restaurantId, rid(req)),
  ];
  if (aggregator) conds.push(eq(aggregatorPayoutSheetsTable.aggregator, aggregator));
  const rows = await db.select().from(aggregatorPayoutSheetsTable)
    .where(and(...conds))
    .orderBy(desc(aggregatorPayoutSheetsTable.createdAt))
    .limit(100);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/aggregator-payouts/sheets/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [sheet] = await db.select().from(aggregatorPayoutSheetsTable)
    .where(and(eq(aggregatorPayoutSheetsTable.id, id), eq(aggregatorPayoutSheetsTable.restaurantId, rid(req))));
  if (!sheet) { res.status(404).json({ error: "not_found" }); return; }
  res.json(sheet);
});

router.get("/restaurants/:restaurantId/aggregator-payouts/sheets/:id/rows", async (req, res) => {
  const id = Number(req.params.id);
  const [sheet] = await db.select().from(aggregatorPayoutSheetsTable)
    .where(and(eq(aggregatorPayoutSheetsTable.id, id), eq(aggregatorPayoutSheetsTable.restaurantId, rid(req))));
  if (!sheet) { res.status(404).json({ error: "not_found" }); return; }

  const issueFilter = req.query.issue ? String(req.query.issue) : null;

  const results = await db.select().from(aggregatorReconResultsTable)
    .where(and(
      eq(aggregatorReconResultsTable.sheetId, id),
      ...(issueFilter ? [eq(aggregatorReconResultsTable.issueType, issueFilter)] : []),
    ))
    .orderBy(desc(aggregatorReconResultsTable.impactPaise))
    .limit(2000);

  const rowIds = results.map(r => r.rowId).filter((x): x is number => x != null);
  const orderIds = results.map(r => r.orderId).filter((x): x is number => x != null);
  const rows = rowIds.length > 0
    ? await db.select().from(aggregatorPayoutRowsTable).where(inArray(aggregatorPayoutRowsTable.id, rowIds))
    : [];
  const orders = orderIds.length > 0
    ? await db.select({
        id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status,
        totalAmount: ordersTable.totalAmount, subtotal: ordersTable.subtotal, createdAt: ordersTable.createdAt,
        aggregatorOrderId: ordersTable.aggregatorOrderId,
      }).from(ordersTable).where(inArray(ordersTable.id, orderIds))
    : [];
  const rowMap = new Map(rows.map(r => [r.id, r]));
  const orderMap = new Map(orders.map(o => [o.id, o]));

  res.json(results.map(r => ({
    ...r,
    row: r.rowId ? rowMap.get(r.rowId) ?? null : null,
    order: r.orderId ? orderMap.get(r.orderId) ?? null : null,
  })));
});

router.post("/restaurants/:restaurantId/aggregator-payouts/sheets", async (req, res) => {
  const schema = z.object({
    aggregator: aggregatorEnum,
    fileName: z.string().max(200).optional(),
    periodFrom: z.string().datetime(),
    periodTo: z.string().datetime(),
    csv: z.string().min(10).max(2 * 1024 * 1024), // 2 MB cap
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;

  const grid = parseCsvText(d.csv);
  if (grid.length < 2) { res.status(400).json({ error: "csv_empty" }); return; }
  const headers = grid[0];
  const dataRows = grid.slice(1);
  if (dataRows.length > 5000) { res.status(400).json({ error: "too_many_rows", limit: 5000 }); return; }

  const map = COLUMN_MAPS[d.aggregator] ?? COLUMN_MAPS.other;
  const idx = buildHeaderIndex(headers, map);
  if (idx.gross === -1 || idx.net === -1) {
    res.status(400).json({ error: "missing_required_columns", required: ["gross", "net"], detected: headers });
    return;
  }

  const [sheet] = await db.insert(aggregatorPayoutSheetsTable).values({
    tenantId: tid(req), restaurantId: rid(req),
    aggregator: d.aggregator,
    fileName: d.fileName ?? null,
    fileBytes: d.csv.length,
    periodFrom: new Date(d.periodFrom), periodTo: new Date(d.periodTo),
    rowCount: dataRows.length,
    notes: d.notes,
    uploadedBy: uid(req),
  }).returning();

  const rowsToInsert = dataRows.map(cells => {
    const get = (k: keyof ColumnMap) => idx[k] >= 0 ? cells[idx[k]] : undefined;
    const gross = rupeesToPaise(get("gross"));
    const commission = rupeesToPaise(get("commission"));
    const tax = rupeesToPaise(get("tax"));
    const promo = rupeesToPaise(get("promo"));
    const refund = rupeesToPaise(get("refund"));
    const net = rupeesToPaise(get("net"));
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) raw[h] = cells[i] ?? ""; });
    return {
      sheetId: sheet.id,
      tenantId: tid(req),
      restaurantId: rid(req),
      aggregator: d.aggregator,
      externalOrderId: get("externalOrderId")?.trim() || null,
      orderDate: parseDate(get("orderDate")),
      customerName: get("customerName")?.trim() || null,
      status: get("status")?.trim() || null,
      grossPaise: gross,
      commissionPaise: commission,
      taxPaise: tax,
      promoPaise: promo,
      refundPaise: refund,
      netPaise: net,
      rawPayload: raw,
    };
  });

  // Chunk large inserts
  const CHUNK = 500;
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    await db.insert(aggregatorPayoutRowsTable).values(rowsToInsert.slice(i, i + CHUNK));
  }

  // Aggregate sheet totals
  const totals = rowsToInsert.reduce((acc, r) => ({
    gross: acc.gross + r.grossPaise,
    commission: acc.commission + r.commissionPaise,
    tax: acc.tax + r.taxPaise,
    promo: acc.promo + r.promoPaise,
    refund: acc.refund + r.refundPaise,
    net: acc.net + r.netPaise,
  }), { gross: 0, commission: 0, tax: 0, promo: 0, refund: 0, net: 0 });

  await db.update(aggregatorPayoutSheetsTable).set({
    totalGrossPaise: totals.gross,
    totalCommissionPaise: totals.commission,
    totalTaxPaise: totals.tax,
    totalPromoPaise: totals.promo,
    totalRefundPaise: totals.refund,
    totalNetPaise: totals.net,
    status: "matched", updatedAt: new Date(),
  }).where(eq(aggregatorPayoutSheetsTable.id, sheet.id));

  const recon = await runReconciliation(sheet.id, rid(req), tid(req), d.aggregator);

  await recordAuditLog({ req, module: "aggregator_payouts", action: "sheet_uploaded", entity: "aggregator_sheet", entityId: sheet.id, restaurantId: rid(req), newValue: { aggregator: d.aggregator, rows: dataRows.length, totals } });

  res.json({ sheet: { ...sheet, ...totals }, recon });
});

router.post("/restaurants/:restaurantId/aggregator-payouts/sheets/:id/rerun", async (req, res) => {
  const id = Number(req.params.id);
  const [sheet] = await db.select().from(aggregatorPayoutSheetsTable)
    .where(and(eq(aggregatorPayoutSheetsTable.id, id), eq(aggregatorPayoutSheetsTable.restaurantId, rid(req))));
  if (!sheet) { res.status(404).json({ error: "not_found" }); return; }
  const recon = await runReconciliation(id, rid(req), tid(req), sheet.aggregator);
  res.json(recon);
});

// ─── Settlement dashboard ────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/aggregator-payouts/dashboard", async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const aggregator = req.query.aggregator ? String(req.query.aggregator) : null;

  const conds = [
    eq(aggregatorPayoutSheetsTable.restaurantId, rid(req)),
    gte(aggregatorPayoutSheetsTable.periodFrom, from),
    lte(aggregatorPayoutSheetsTable.periodTo, to),
    ...(aggregator ? [eq(aggregatorPayoutSheetsTable.aggregator, aggregator)] : []),
  ];

  const sheets = await db.select().from(aggregatorPayoutSheetsTable).where(and(...conds));

  // Adjustments in the same window
  const adjConds = [
    eq(aggregatorAdjustmentsTable.restaurantId, rid(req)),
    gte(aggregatorAdjustmentsTable.createdAt, from),
    lte(aggregatorAdjustmentsTable.createdAt, to),
    ...(aggregator ? [eq(aggregatorAdjustmentsTable.aggregator, aggregator)] : []),
  ];
  const adjustments = await db.select().from(aggregatorAdjustmentsTable).where(and(...adjConds));

  // Group by aggregator
  const byAggregator = new Map<string, {
    aggregator: string;
    grossPaise: number; commissionPaise: number; taxPaise: number; promoPaise: number;
    refundPaise: number; actualNetPaise: number; expectedNetPaise: number; adjustmentsPaise: number;
    sheetCount: number; matchedCount: number; disputedCount: number; unmatchedCount: number;
  }>();
  for (const s of sheets) {
    const expectedNet = s.totalGrossPaise - s.totalCommissionPaise - s.totalTaxPaise - s.totalPromoPaise - s.totalRefundPaise;
    const a = byAggregator.get(s.aggregator) ?? {
      aggregator: s.aggregator,
      grossPaise: 0, commissionPaise: 0, taxPaise: 0, promoPaise: 0,
      refundPaise: 0, actualNetPaise: 0, expectedNetPaise: 0, adjustmentsPaise: 0,
      sheetCount: 0, matchedCount: 0, disputedCount: 0, unmatchedCount: 0,
    };
    a.grossPaise += s.totalGrossPaise;
    a.commissionPaise += s.totalCommissionPaise;
    a.taxPaise += s.totalTaxPaise;
    a.promoPaise += s.totalPromoPaise;
    a.refundPaise += s.totalRefundPaise;
    a.actualNetPaise += s.totalNetPaise;
    a.expectedNetPaise += expectedNet;
    a.sheetCount += 1;
    a.matchedCount += s.matchedCount;
    a.disputedCount += s.disputedCount;
    a.unmatchedCount += s.unmatchedCount;
    byAggregator.set(s.aggregator, a);
  }
  for (const adj of adjustments) {
    const a = byAggregator.get(adj.aggregator);
    if (a) a.adjustmentsPaise += adj.amountPaise;
  }

  const perAggregator = Array.from(byAggregator.values()).map(a => ({
    ...a,
    variancePaise: a.actualNetPaise + a.adjustmentsPaise - a.expectedNetPaise,
  }));

  const totals = perAggregator.reduce((acc, a) => ({
    grossPaise: acc.grossPaise + a.grossPaise,
    commissionPaise: acc.commissionPaise + a.commissionPaise,
    taxPaise: acc.taxPaise + a.taxPaise,
    promoPaise: acc.promoPaise + a.promoPaise,
    refundPaise: acc.refundPaise + a.refundPaise,
    actualNetPaise: acc.actualNetPaise + a.actualNetPaise,
    expectedNetPaise: acc.expectedNetPaise + a.expectedNetPaise,
    adjustmentsPaise: acc.adjustmentsPaise + a.adjustmentsPaise,
    variancePaise: acc.variancePaise + a.variancePaise,
    sheetCount: acc.sheetCount + a.sheetCount,
    matchedCount: acc.matchedCount + a.matchedCount,
    disputedCount: acc.disputedCount + a.disputedCount,
    unmatchedCount: acc.unmatchedCount + a.unmatchedCount,
  }), {
    grossPaise: 0, commissionPaise: 0, taxPaise: 0, promoPaise: 0, refundPaise: 0,
    actualNetPaise: 0, expectedNetPaise: 0, adjustmentsPaise: 0, variancePaise: 0,
    sheetCount: 0, matchedCount: 0, disputedCount: 0, unmatchedCount: 0,
  });

  res.json({ from, to, totals, perAggregator });
});

// ─── Commission report ───────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/aggregator-payouts/commission-report", async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const aggregator = req.query.aggregator ? String(req.query.aggregator) : null;

  const sheetConds = [
    eq(aggregatorPayoutSheetsTable.restaurantId, rid(req)),
    gte(aggregatorPayoutSheetsTable.periodFrom, from),
    lte(aggregatorPayoutSheetsTable.periodTo, to),
    ...(aggregator ? [eq(aggregatorPayoutSheetsTable.aggregator, aggregator)] : []),
  ];
  const sheets = await db.select({ id: aggregatorPayoutSheetsTable.id, aggregator: aggregatorPayoutSheetsTable.aggregator })
    .from(aggregatorPayoutSheetsTable).where(and(...sheetConds));
  if (sheets.length === 0) {
    res.json({ from, to, perAggregator: [], rows: [] });
    return;
  }
  const sheetIds = sheets.map(s => s.id);
  const rows = await db.select().from(aggregatorPayoutRowsTable).where(inArray(aggregatorPayoutRowsTable.sheetId, sheetIds));

  const agreements = await db.select().from(aggregatorAgreementsTable)
    .where(eq(aggregatorAgreementsTable.restaurantId, rid(req)));
  const agreementMap = new Map(agreements.map(a => [a.aggregator, a]));

  const flagged = rows.map(r => {
    const ag = agreementMap.get(r.aggregator);
    const agreedBps = ag?.commissionBps ?? 0;
    const effectiveBps = r.grossPaise > 0 ? Math.round(r.commissionPaise / r.grossPaise * 10000) : 0;
    return {
      rowId: r.id,
      aggregator: r.aggregator,
      externalOrderId: r.externalOrderId,
      orderDate: r.orderDate,
      grossPaise: r.grossPaise,
      commissionPaise: r.commissionPaise,
      effectiveBps,
      agreedBps,
      isOutlier: ag != null && effectiveBps > agreedBps + 50, // 0.5% buffer
    };
  });

  // Per-aggregator effective % summary
  const perAggregator = Array.from(new Set(rows.map(r => r.aggregator))).map(name => {
    const slice = rows.filter(r => r.aggregator === name);
    const gross = slice.reduce((s, r) => s + r.grossPaise, 0);
    const commission = slice.reduce((s, r) => s + r.commissionPaise, 0);
    const ag = agreementMap.get(name);
    return {
      aggregator: name,
      orderCount: slice.length,
      grossPaise: gross,
      commissionPaise: commission,
      effectiveBps: gross > 0 ? Math.round(commission / gross * 10000) : 0,
      agreedBps: ag?.commissionBps ?? null,
      outlierCount: flagged.filter(f => f.aggregator === name && f.isOutlier).length,
    };
  });

  res.json({ from, to, perAggregator, rows: flagged.slice(0, 2000) });
});

// ─── Claims ──────────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/aggregator-payouts/claims", async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const aggregator = req.query.aggregator ? String(req.query.aggregator) : null;
  const conds = [
    eq(aggregatorClaimsTable.tenantId, tid(req)),
    eq(aggregatorClaimsTable.restaurantId, rid(req)),
    ...(status ? [eq(aggregatorClaimsTable.status, status)] : []),
    ...(aggregator ? [eq(aggregatorClaimsTable.aggregator, aggregator)] : []),
  ];
  const rows = await db.select().from(aggregatorClaimsTable).where(and(...conds))
    .orderBy(desc(aggregatorClaimsTable.createdAt)).limit(500);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/aggregator-payouts/claims", async (req, res) => {
  const schema = z.object({
    resultId: z.number().int().optional(),
    sheetId: z.number().int().optional(),
    aggregator: aggregatorEnum,
    issueType: z.string().min(2),
    amountPaise: z.number().int(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;

  // If created from a result, ensure it belongs to this restaurant
  if (d.resultId) {
    const [r] = await db.select().from(aggregatorReconResultsTable)
      .where(and(eq(aggregatorReconResultsTable.id, d.resultId), eq(aggregatorReconResultsTable.restaurantId, rid(req))));
    if (!r) { res.status(404).json({ error: "result_not_found" }); return; }
  }

  const [row] = await db.insert(aggregatorClaimsTable).values({
    tenantId: tid(req), restaurantId: rid(req),
    sheetId: d.sheetId, resultId: d.resultId,
    aggregator: d.aggregator, issueType: d.issueType,
    amountPaise: d.amountPaise, notes: d.notes,
    createdBy: uid(req), updatedBy: uid(req),
  }).returning();

  if (d.resultId) {
    await db.update(aggregatorReconResultsTable).set({ status: "claimed" })
      .where(eq(aggregatorReconResultsTable.id, d.resultId));
  }
  await recordAuditLog({ req, module: "aggregator_payouts", action: "claim_created", entity: "aggregator_claim", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.json(row);
});

router.patch("/restaurants/:restaurantId/aggregator-payouts/claims/:id", async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    status: z.enum(AGGREGATOR_CLAIM_STATUSES).optional(),
    externalRef: z.string().optional(),
    notes: z.string().optional(),
    recoveredPaise: z.number().int().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const [existing] = await db.select().from(aggregatorClaimsTable)
    .where(and(eq(aggregatorClaimsTable.id, id), eq(aggregatorClaimsTable.restaurantId, rid(req))));
  if (!existing) { res.status(404).json({ error: "not_found" }); return; }
  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: uid(req) };
  if (d.status) {
    patch.status = d.status;
    if (d.status === "submitted") patch.submittedAt = new Date();
    if (d.status === "recovered") patch.recoveredAt = new Date();
  }
  if (d.externalRef !== undefined) patch.externalRef = d.externalRef;
  if (d.notes !== undefined) patch.notes = d.notes;
  if (d.recoveredPaise !== undefined) patch.recoveredPaise = d.recoveredPaise;
  const [row] = await db.update(aggregatorClaimsTable).set(patch).where(eq(aggregatorClaimsTable.id, id)).returning();
  await recordAuditLog({ req, module: "aggregator_payouts", action: "claim_updated", entity: "aggregator_claim", entityId: id, restaurantId: rid(req), newValue: patch });
  res.json(row);
});

// ─── Manual adjustments ──────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/aggregator-payouts/adjustments", async (req, res) => {
  const rows = await db.select().from(aggregatorAdjustmentsTable)
    .where(and(eq(aggregatorAdjustmentsTable.tenantId, tid(req)), eq(aggregatorAdjustmentsTable.restaurantId, rid(req))))
    .orderBy(desc(aggregatorAdjustmentsTable.createdAt)).limit(500);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/aggregator-payouts/adjustments", async (req, res) => {
  const schema = z.object({
    sheetId: z.number().int().optional(),
    rowId: z.number().int().optional(),
    claimId: z.number().int().optional(),
    aggregator: aggregatorEnum,
    amountPaise: z.number().int(),
    reason: z.string().min(3),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  if (d.amountPaise === 0) { res.status(400).json({ error: "non_zero_amount_required" }); return; }
  const [row] = await db.insert(aggregatorAdjustmentsTable).values({
    tenantId: tid(req), restaurantId: rid(req),
    sheetId: d.sheetId, rowId: d.rowId, claimId: d.claimId,
    aggregator: d.aggregator, amountPaise: d.amountPaise,
    reason: d.reason, notes: d.notes, createdBy: uid(req),
  }).returning();
  await recordAuditLog({ req, module: "aggregator_payouts", action: "adjustment_created", entity: "aggregator_adjustment", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.json(row);
});

// ─── Exports ─────────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/aggregator-payouts/exports/recon.csv", async (req, res) => {
  const sheetId = Number(req.query.sheetId);
  if (!Number.isFinite(sheetId)) { res.status(400).json({ error: "missing_sheetId" }); return; }
  const [sheet] = await db.select().from(aggregatorPayoutSheetsTable)
    .where(and(eq(aggregatorPayoutSheetsTable.id, sheetId), eq(aggregatorPayoutSheetsTable.restaurantId, rid(req))));
  if (!sheet) { res.status(404).json({ error: "not_found" }); return; }

  const results = await db.select().from(aggregatorReconResultsTable).where(eq(aggregatorReconResultsTable.sheetId, sheetId));
  const rowIds = results.map(r => r.rowId).filter((x): x is number => x != null);
  const orderIds = results.map(r => r.orderId).filter((x): x is number => x != null);
  const rows = rowIds.length > 0 ? await db.select().from(aggregatorPayoutRowsTable).where(inArray(aggregatorPayoutRowsTable.id, rowIds)) : [];
  const orders = orderIds.length > 0 ? await db.select({
    id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status, totalAmount: ordersTable.totalAmount,
  }).from(ordersTable).where(inArray(ordersTable.id, orderIds)) : [];
  const rowMap = new Map(rows.map(r => [r.id, r]));
  const orderMap = new Map(orders.map(o => [o.id, o]));

  const header = [
    "external_order_id", "local_order_number", "order_date", "aggregator_status", "local_status",
    "gross_inr", "commission_inr", "tax_inr", "promo_inr", "refund_inr", "net_inr",
    "expected_net_inr", "issue_type", "impact_inr", "match_method", "reason", "result_status",
  ];
  const lines = [header.join(",")];
  const fmt = (p: number | null | undefined) => p == null ? "" : (p / 100).toFixed(2);
  for (const r of results) {
    const row = r.rowId ? rowMap.get(r.rowId) : null;
    const order = r.orderId ? orderMap.get(r.orderId) : null;
    lines.push([
      row?.externalOrderId ?? "",
      order?.orderNumber ?? "",
      row?.orderDate ? row.orderDate.toISOString().slice(0, 10) : "",
      row?.status ?? "",
      order?.status ?? "",
      fmt(row?.grossPaise ?? 0),
      fmt(row?.commissionPaise ?? 0),
      fmt(row?.taxPaise ?? 0),
      fmt(row?.promoPaise ?? 0),
      fmt(row?.refundPaise ?? 0),
      fmt(row?.netPaise ?? 0),
      fmt(r.expectedPaise),
      r.issueType,
      fmt(r.impactPaise),
      r.matchMethod ?? "",
      r.reason ?? "",
      r.status,
    ].map(csvEscape).join(","));
  }

  const filename = `recon_${rid(req)}_${sheet.aggregator}_${sheet.periodFrom.toISOString().slice(0, 10)}_${sheet.periodTo.toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\n"));
});

router.get("/restaurants/:restaurantId/aggregator-payouts/exports/claims.csv", async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 90 * 86400 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const claims = await db.select().from(aggregatorClaimsTable)
    .where(and(
      eq(aggregatorClaimsTable.restaurantId, rid(req)),
      gte(aggregatorClaimsTable.createdAt, from),
      lte(aggregatorClaimsTable.createdAt, to),
    ))
    .orderBy(desc(aggregatorClaimsTable.createdAt));

  const header = [
    "claim_id", "aggregator", "issue_type", "amount_inr", "status",
    "external_ref", "submitted_at", "recovered_at", "recovered_inr", "notes", "created_at",
  ];
  const lines = [header.join(",")];
  const fmt = (p: number) => (p / 100).toFixed(2);
  for (const c of claims) {
    lines.push([
      c.id, c.aggregator, c.issueType, fmt(c.amountPaise), c.status,
      c.externalRef ?? "",
      c.submittedAt ? c.submittedAt.toISOString() : "",
      c.recoveredAt ? c.recoveredAt.toISOString() : "",
      fmt(c.recoveredPaise),
      c.notes ?? "",
      c.createdAt.toISOString(),
    ].map(csvEscape).join(","));
  }

  const filename = `claims_${rid(req)}_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\n"));
});

export default router;
