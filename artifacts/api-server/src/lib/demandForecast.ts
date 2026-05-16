/**
 * Demand-forecast engine — extracted from `routes/khana-ai-ops.ts` so both the
 * HTTP route and the nightly auto-run scheduler can call the same code path.
 *
 * `runDemandForecast` performs the LLM call + payload normalization + DB
 * persist. Callers are responsible for credit reservation/commit; for HTTP
 * the existing `requireAiCredits` middleware does it, and for the nightly
 * job `runNightlyDemandForecast` handles credit gating + plan-feature
 * checks before calling the engine.
 *
 * `computeForecastActuals` does a pure aggregation of real orders against a
 * persisted forecast row to produce the "How did yesterday's forecast do?"
 * recap. No LLM call.
 */
import { eq, and, gte, lt, sql, inArray, desc } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  inventoryItemsTable,
  recipeMappingsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  ordersTable,
  orderItemsTable,
  menuItemsTable,
  menuCategoriesTable,
  staffShiftsTable,
  aiForecastsTable,
  tenantsTable,
  subscriptionPlansTable,
  isFeatureEnabled,
  restaurantsTable,
} from "./db";
import { AIProviderService } from "./aiProviderService";
import {
  resolveCreditRule,
  reserveCredits,
  commitReservation,
  refundReservation,
  priceCredits,
  getOrCreateWallet,
  summarizeWallet,
  type AiCreditReservation,
} from "./aiCredits";
import { logger } from "./logger";

interface ForecastItemRow {
  menuItemId: number;
  name: string;
  categoryName: string | null;
  forecastUnits: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
}
interface PeakHourRow { hour: number; expectedOrders: number; intensity: "quiet" | "normal" | "busy" | "peak" }
interface ShiftStaffRow { shift: string; window: string; recommendedHeadcount: number; currentlyScheduled: number; rationale: string }
interface RawMaterialRow { inventoryItemId: number | null; name: string; unit: string; requiredQuantity: number; currentStock: number; shortfall: number }

export interface ForecastPayload {
  summary: string;
  horizonDays: number;
  totalForecastUnits: number;
  estimatedRevenue: number;
  items: ForecastItemRow[];
  byCategory: Array<{ category: string; forecastUnits: number }>;
  peakHours: PeakHourRow[];
  slowHours: number[];
  shiftStaffing: ShiftStaffRow[];
  deliveryDemand: { dineInUnits: number; deliveryUnits: number; takeawayUnits: number; deliveryShare: number };
  rawMaterialNeeds: RawMaterialRow[];
  generatedAt: string;
  /** UTC ISO date the forecast covers (YYYY-MM-DD). For 1-day forecasts this
   *  is "tomorrow" relative to generation in the restaurant's timezone. */
  forecastDate?: string;
}

export class ForecastError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function hashInputs(obj: unknown): string {
  return crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

export interface RunDemandForecastOpts {
  restaurantId: number;
  tenantId: number;
  userId: number | null;
  horizonDays: number;
  /** When provided, used as the YYYY-MM-DD label of the forecast horizon
   *  (e.g. tomorrow's date in restaurant TZ). */
  forecastDate?: string;
  reservation?: AiCreditReservation | null;
  source?: "manual" | "nightly_auto";
}

export interface RunDemandForecastResult {
  forecastId: number;
  payload: ForecastPayload;
  row: typeof aiForecastsTable.$inferSelect;
}

/**
 * Generate a demand forecast and persist it. Throws `ForecastError` for
 * predictable empty/unsupported states; callers should refund the credit
 * reservation in that case.
 */
export async function runDemandForecast(opts: RunDemandForecastOpts): Promise<RunDemandForecastResult> {
  const { restaurantId, tenantId, userId, reservation } = opts;
  const horizonDays = Math.max(1, Math.min(30, Number(opts.horizonDays) || 7));

  const since = new Date(Date.now() - 90 * 86_400_000);

  const [salesByItem, salesByDay, menuItems, salesByHour, salesByType, scheduledShifts, recipeForItems, inventoryRows] = await Promise.all([
    db
      .select({
        menuItemId: orderItemsTable.menuItemId,
        qty: sql<string>`coalesce(sum(${orderItemsTable.quantity}), 0)`,
        revenue: sql<string>`coalesce(sum(${orderItemsTable.quantity} * ${orderItemsTable.unitPrice}), 0)`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
      .where(and(
        eq(ordersTable.restaurantId, restaurantId),
        gte(ordersTable.createdAt, since),
        inArray(ordersTable.status, ["completed", "served", "delivered", "ready"]),
      ))
      .groupBy(orderItemsTable.menuItemId),
    db
      .select({
        day: sql<string>`to_char(${ordersTable.createdAt}, 'YYYY-MM-DD')`,
        qty: sql<string>`coalesce(sum(${orderItemsTable.quantity}), 0)`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
      .where(and(
        eq(ordersTable.restaurantId, restaurantId),
        gte(ordersTable.createdAt, since),
        inArray(ordersTable.status, ["completed", "served", "delivered", "ready"]),
      ))
      .groupBy(sql`to_char(${ordersTable.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${ordersTable.createdAt}, 'YYYY-MM-DD')`),
    db.select({
      id: menuItemsTable.id,
      name: menuItemsTable.name,
      price: menuItemsTable.price,
      categoryId: menuItemsTable.categoryId,
      categoryName: menuCategoriesTable.name,
    })
      .from(menuItemsTable)
      .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
      .where(and(eq(menuItemsTable.restaurantId, restaurantId), eq(menuItemsTable.isAvailable, true))),
    db
      .select({
        hour: sql<string>`extract(hour from ${ordersTable.createdAt})::int`,
        qty: sql<string>`coalesce(sum(${orderItemsTable.quantity}), 0)`,
        orderCount: sql<string>`count(distinct ${ordersTable.id})`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
      .where(and(
        eq(ordersTable.restaurantId, restaurantId),
        gte(ordersTable.createdAt, new Date(Date.now() - 30 * 86_400_000)),
        inArray(ordersTable.status, ["completed", "served", "delivered", "ready"]),
      ))
      .groupBy(sql`extract(hour from ${ordersTable.createdAt})`)
      .orderBy(sql`extract(hour from ${ordersTable.createdAt})`),
    db
      .select({
        orderType: ordersTable.orderType,
        qty: sql<string>`coalesce(sum(${orderItemsTable.quantity}), 0)`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
      .where(and(
        eq(ordersTable.restaurantId, restaurantId),
        gte(ordersTable.createdAt, new Date(Date.now() - 30 * 86_400_000)),
        inArray(ordersTable.status, ["completed", "served", "delivered", "ready"]),
      ))
      .groupBy(ordersTable.orderType),
    db
      .select({ date: staffShiftsTable.date, shiftId: staffShiftsTable.shiftId })
      .from(staffShiftsTable)
      .where(and(
        eq(staffShiftsTable.restaurantId, restaurantId),
        gte(staffShiftsTable.date, new Date()),
      )),
    db
      .select({
        menuItemId: recipeMappingsTable.menuItemId,
        inventoryItemId: recipeMappingsTable.inventoryItemId,
        quantity: recipeMappingsTable.quantity,
        unit: recipeMappingsTable.unit,
        ingredientName: inventoryItemsTable.name,
        ingredientUnit: inventoryItemsTable.unit,
        currentStock: inventoryItemsTable.currentStock,
      })
      .from(recipeMappingsTable)
      .innerJoin(inventoryItemsTable, eq(inventoryItemsTable.id, recipeMappingsTable.inventoryItemId))
      .where(eq(recipeMappingsTable.restaurantId, restaurantId)),
    db.select({ id: inventoryItemsTable.id, name: inventoryItemsTable.name, unit: inventoryItemsTable.unit, currentStock: inventoryItemsTable.currentStock })
      .from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.restaurantId, restaurantId)),
  ]);

  const salesById = new Map(salesByItem.map((s) => [s.menuItemId, { qty: Number(s.qty) || 0, revenue: Number(s.revenue) || 0 }]));
  const itemRows = menuItems.map((m) => {
    const s = salesById.get(m.id) ?? { qty: 0, revenue: 0 };
    return {
      id: m.id,
      name: m.name,
      price: Number(m.price),
      category: m.categoryName ?? "Uncategorised",
      sold90d: s.qty,
      dailyAvg: Number((s.qty / 90).toFixed(3)),
    };
  }).filter((x) => x.sold90d > 0).slice(0, 80);

  if (itemRows.length === 0) {
    throw new ForecastError(
      "INSUFFICIENT_HISTORY",
      "Not enough order history to forecast. Need at least one completed sale in the last 90 days.",
      400,
    );
  }

  const dailyLines = salesByDay.slice(-30).map((d) => `  ${d.day}: ${d.qty}`).join("\n");
  const itemLines = itemRows.map((i) =>
    `  - id=${i.id} name="${i.name}" cat="${i.category}" price=${i.price} sold90d=${i.sold90d} dailyAvg=${i.dailyAvg}`,
  ).join("\n");

  const hourBuckets = new Map<number, { qty: number; orders: number }>();
  for (let h = 0; h < 24; h++) hourBuckets.set(h, { qty: 0, orders: 0 });
  for (const r of salesByHour) {
    const h = Number(r.hour);
    if (Number.isFinite(h)) hourBuckets.set(h, { qty: Number(r.qty) || 0, orders: Number(r.orderCount) || 0 });
  }
  const hourly30 = Array.from(hourBuckets.entries()).map(([hour, v]) => ({ hour, qty: v.qty, orders: v.orders }));
  const peakHourLines = hourly30.map((h) => `  ${String(h.hour).padStart(2, "0")}:00 — ${h.qty} units / ${h.orders} orders`).join("\n");

  const typeMap = new Map<string, number>();
  for (const r of salesByType) typeMap.set(String(r.orderType ?? ""), Number(r.qty) || 0);
  const dineIn30 = typeMap.get("dine_in") ?? 0;
  const delivery30 = typeMap.get("delivery") ?? 0;
  const takeaway30 = typeMap.get("takeaway") ?? 0;
  const totalTyped = dineIn30 + delivery30 + takeaway30;
  const deliveryShareInput = totalTyped > 0 ? Number(((delivery30 / totalTyped) * 100).toFixed(1)) : 0;

  const horizonEnd = new Date(Date.now() + horizonDays * 86_400_000);
  const scheduledByShift = new Map<number, number>();
  for (const r of scheduledShifts) {
    if (!r.shiftId) continue;
    const d = r.date instanceof Date ? r.date : new Date(r.date as unknown as string);
    if (d > horizonEnd) continue;
    scheduledByShift.set(r.shiftId, (scheduledByShift.get(r.shiftId) ?? 0) + 1);
  }
  const scheduledLines = Array.from(scheduledByShift.entries())
    .map(([sid, n]) => `  shiftId=${sid}: ${n} scheduled assignments in next ${horizonDays}d`).join("\n") || "  (no scheduled shifts)";

  const prompt = `You are a restaurant demand forecaster. Forecast the next ${horizonDays} day(s) of unit sales, peak/slow hours, staffing need, delivery vs dine-in mix, and raw-material requirement.

Daily total order-item quantity (last 30 days):
${dailyLines || "  (no recent days)"}

Per-item history (last 90 days):
${itemLines}

Hour-of-day order/units distribution (last 30 days, sums):
${peakHourLines}

Order-type split (last 30 days, units): dine_in=${dineIn30} delivery=${delivery30} takeaway=${takeaway30} (delivery share ${deliveryShareInput}%)

Currently scheduled staff (next ${horizonDays} days):
${scheduledLines}

Return ONLY JSON:
{
  "summary": "${horizonDays === 1 ? "Tomorrow's outlook in 1-2 sentences" : "1-2 sentence forecast overview"} — mention trend, weekday/weekend, peaks, delivery share",
  "items": [
    {"menuItemId": <id>, "forecastUnits": <expected units over next ${horizonDays} day(s)>, "confidence": "low|medium|high", "rationale": "<short reason>"}
  ],
  "peakHours": [
    {"hour": <0-23>, "expectedOrders": <orders/day at this hour>, "intensity": "quiet|normal|busy|peak"}
  ],
  "slowHours": [<hour 0-23>, ...],
  "shiftStaffing": [
    {"shift": "Breakfast|Lunch|Dinner|Late Night", "window": "08:00-12:00", "recommendedHeadcount": <int>, "currentlyScheduled": <int from input>, "rationale": "<short reason>"}
  ],
  "deliveryDemand": {
    "deliveryUnits": <expected delivery units over horizon>,
    "dineInUnits": <expected dine_in units over horizon>,
    "takeawayUnits": <expected takeaway units over horizon>,
    "deliveryShare": <0-100>
  }
}

Rules:
- Forecast every item in input list. Use dailyAvg * ${horizonDays} as baseline; adjust for recent trend, weekday vs weekend.
- Round all unit counts to nearest integer.
- peakHours: list 3-6 busiest hours; intensity "peak" for the top 1-2.
- slowHours: any open-hour with very low expected orders (suggest closing or running specials).
- shiftStaffing: 3-4 shifts spanning the typical operating day; recommendedHeadcount ≥ currentlyScheduled if peak demand exceeds capacity, otherwise can be lower; reflect typical "1 staff per ~15 covers/hour" heuristic.
- deliveryDemand: split must roughly match historical mix unless trend suggests otherwise.
- Confidence "high" if sold90d >= 60, "medium" if >= 15, else "low".
- JSON only, no markdown.`;

  const inputsHash = hashInputs({ horizonDays, items: itemRows.map((i) => ({ id: i.id, q: i.sold90d })) });

  const { data, result } = await AIProviderService.generateJson<{
    summary?: unknown; items?: unknown; peakHours?: unknown; slowHours?: unknown;
    shiftStaffing?: unknown; deliveryDemand?: unknown;
  }>({
    featureSlug: "ai_demand_forecast",
    tenantId,
    restaurantId,
    userId,
    metadata: { inputsHash, horizonDays, source: opts.source ?? "manual" },
  }, {
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    maxTokens: 3000,
  });

  const itemById = new Map(itemRows.map((i) => [i.id, i]));
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const cleanedItems: ForecastItemRow[] = rawItems
    .map((raw: unknown): ForecastItemRow | null => {
      const r = raw as Record<string, unknown>;
      const id = Number(r.menuItemId);
      const item = itemById.get(id);
      if (!item) return null;
      const units = Math.max(0, Math.round(Number(r.forecastUnits) || 0));
      const conf = String(r.confidence ?? "medium").toLowerCase();
      const confidence: "low" | "medium" | "high" = conf === "low" || conf === "high" ? conf : "medium";
      return {
        menuItemId: id,
        name: item.name,
        categoryName: item.category,
        forecastUnits: units,
        confidence,
        rationale: String(r.rationale ?? "").slice(0, 240),
      };
    })
    .filter((x): x is ForecastItemRow => x !== null);

  const totalForecastUnits = cleanedItems.reduce((s, i) => s + i.forecastUnits, 0);
  const estimatedRevenue = Number(cleanedItems.reduce((s, i) => {
    const item = itemById.get(i.menuItemId);
    return s + (item ? item.price * i.forecastUnits : 0);
  }, 0).toFixed(2));

  const catMap = new Map<string, number>();
  for (const i of cleanedItems) {
    const k = i.categoryName ?? "Uncategorised";
    catMap.set(k, (catMap.get(k) ?? 0) + i.forecastUnits);
  }
  const byCategory = Array.from(catMap.entries())
    .map(([category, forecastUnits]) => ({ category, forecastUnits }))
    .sort((a, b) => b.forecastUnits - a.forecastUnits);

  const rawPeak = Array.isArray(data.peakHours) ? data.peakHours : [];
  const cleanedPeak: PeakHourRow[] = rawPeak
    .map((raw: unknown): PeakHourRow | null => {
      const r = raw as Record<string, unknown>;
      const hour = Number(r.hour);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
      const intensityRaw = String(r.intensity ?? "normal").toLowerCase();
      const intensity = (["quiet", "normal", "busy", "peak"] as const).includes(intensityRaw as PeakHourRow["intensity"])
        ? (intensityRaw as PeakHourRow["intensity"]) : "normal";
      return { hour: Math.floor(hour), expectedOrders: Math.max(0, Math.round(Number(r.expectedOrders) || 0)), intensity };
    })
    .filter((x): x is PeakHourRow => x !== null)
    .sort((a, b) => b.expectedOrders - a.expectedOrders);
  const cleanedSlow = Array.isArray(data.slowHours)
    ? data.slowHours.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x >= 0 && x <= 23).map((x) => Math.floor(x))
    : [];

  const rawStaff = Array.isArray(data.shiftStaffing) ? data.shiftStaffing : [];
  const cleanedStaff: ShiftStaffRow[] = rawStaff
    .map((raw: unknown): ShiftStaffRow | null => {
      const r = raw as Record<string, unknown>;
      const shift = String(r.shift ?? "").trim().slice(0, 60);
      if (!shift) return null;
      return {
        shift,
        window: String(r.window ?? "").trim().slice(0, 30),
        recommendedHeadcount: Math.max(0, Math.round(Number(r.recommendedHeadcount) || 0)),
        currentlyScheduled: Math.max(0, Math.round(Number(r.currentlyScheduled) || 0)),
        rationale: String(r.rationale ?? "").slice(0, 240),
      };
    })
    .filter((x): x is ShiftStaffRow => x !== null);

  const dd = (data.deliveryDemand ?? {}) as Record<string, unknown>;
  const deliveryUnits = Math.max(0, Math.round(Number(dd.deliveryUnits) || 0));
  const dineInUnits = Math.max(0, Math.round(Number(dd.dineInUnits) || 0));
  const takeawayUnits = Math.max(0, Math.round(Number(dd.takeawayUnits) || 0));
  const totalDD = deliveryUnits + dineInUnits + takeawayUnits;
  const deliveryShare = totalDD > 0
    ? Number(((deliveryUnits / totalDD) * 100).toFixed(1))
    : Math.max(0, Math.min(100, Number(dd.deliveryShare) || deliveryShareInput));

  const recipeByItem = new Map<number, Array<{ inventoryItemId: number; quantity: number; ingredientName: string; ingredientUnit: string; currentStock: number }>>();
  for (const r of recipeForItems) {
    const arr = recipeByItem.get(r.menuItemId) ?? [];
    arr.push({
      inventoryItemId: r.inventoryItemId,
      quantity: Number(r.quantity) || 0,
      ingredientName: r.ingredientName,
      ingredientUnit: r.ingredientUnit,
      currentStock: Number(r.currentStock) || 0,
    });
    recipeByItem.set(r.menuItemId, arr);
  }
  const ingredientById = new Map(inventoryRows.map((i) => [i.id, { name: i.name, unit: i.unit, currentStock: Number(i.currentStock) || 0 }]));
  const needMap = new Map<number, { name: string; unit: string; required: number; currentStock: number }>();
  for (const f of cleanedItems) {
    const ings = recipeByItem.get(f.menuItemId) ?? [];
    for (const ing of ings) {
      const cur = needMap.get(ing.inventoryItemId);
      const required = (cur?.required ?? 0) + ing.quantity * f.forecastUnits;
      const meta = ingredientById.get(ing.inventoryItemId);
      needMap.set(ing.inventoryItemId, {
        name: meta?.name ?? ing.ingredientName,
        unit: meta?.unit ?? ing.ingredientUnit,
        required,
        currentStock: meta?.currentStock ?? ing.currentStock,
      });
    }
  }
  const rawMaterialNeeds: RawMaterialRow[] = Array.from(needMap.entries())
    .map(([invId, v]) => ({
      inventoryItemId: invId,
      name: v.name,
      unit: v.unit,
      requiredQuantity: Number(v.required.toFixed(3)),
      currentStock: Number(v.currentStock.toFixed(3)),
      shortfall: Number(Math.max(0, v.required - v.currentStock).toFixed(3)),
    }))
    .sort((a, b) => b.shortfall - a.shortfall || b.requiredQuantity - a.requiredQuantity)
    .slice(0, 30);

  const payload: ForecastPayload = {
    summary: typeof data.summary === "string" ? data.summary.trim().slice(0, 500) : "",
    horizonDays,
    totalForecastUnits,
    estimatedRevenue,
    items: cleanedItems.sort((a, b) => b.forecastUnits - a.forecastUnits),
    byCategory,
    peakHours: cleanedPeak,
    slowHours: cleanedSlow,
    shiftStaffing: cleanedStaff,
    deliveryDemand: { dineInUnits, deliveryUnits, takeawayUnits, deliveryShare },
    rawMaterialNeeds,
    generatedAt: new Date().toISOString(),
    forecastDate: opts.forecastDate,
  };

  const avgConf = cleanedItems.length === 0 ? 0.2
    : cleanedItems.reduce((s, i) => s + (i.confidence === "high" ? 0.85 : i.confidence === "medium" ? 0.6 : 0.35), 0) / cleanedItems.length;

  const [row] = await db.insert(aiForecastsTable).values({
    restaurantId,
    horizonDays,
    inputsHash,
    payload: payload as unknown,
    confidence: avgConf.toFixed(2),
    status: "active",
    requestLogId: result.requestLogId,
    generatedBy: userId,
    notes: opts.source === "nightly_auto" ? "Auto-generated nightly tomorrow forecast" : null,
  }).returning();

  if (reservation) {
    await commitReservation({ reservation, userId, requestLogId: result.requestLogId });
  }

  return { forecastId: row.id, payload, row };
}

// ─────────────────── Tomorrow date in restaurant timezone ───────────────────

/** Returns YYYY-MM-DD for the calendar day after `now` in `tz`. */
export function tomorrowDateInTz(tz: string, now: Date = new Date()): string {
  const tomorrow = new Date(now.getTime() + 86_400_000);
  return formatDateInTz(tomorrow, tz);
}

export function formatDateInTz(d: Date, tz: string): string {
  // en-CA gives YYYY-MM-DD format reliably across runtimes.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** Returns the {start, end} UTC instants for a given YYYY-MM-DD calendar day in `tz`. */
export function dayWindowInTz(dateStr: string, tz: string): { start: Date; end: Date } {
  // Find the UTC instant whose local-date in `tz` is `dateStr` at 00:00.
  // Use a binary search approach via a known UTC noon and adjusting by offset.
  const refUtc = new Date(`${dateStr}T12:00:00Z`);
  const localStr = formatDateInTz(refUtc, tz); // YYYY-MM-DD as observed in tz
  const targetMs = Date.parse(`${dateStr}T00:00:00Z`);
  const observedMs = Date.parse(`${localStr}T00:00:00Z`);
  const offsetMs = targetMs - observedMs; // local - utc adjustment
  const start = new Date(Date.parse(`${dateStr}T00:00:00Z`) - offsetMs);
  const end = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

// ────────────────────────── Forecast vs Actuals ──────────────────────────

export interface ForecastActuals {
  forecastId: number;
  forecastDate: string;
  generatedAt: string;
  predicted: { units: number; revenue: number };
  actual: { units: number; revenue: number };
  unitAccuracyPct: number;
  revenueAccuracyPct: number;
  topItemAccuracyPct: number;
  predictedTopItems: Array<{ menuItemId: number; name: string; units: number }>;
  actualTopItems: Array<{ menuItemId: number; name: string; units: number }>;
  predictedPeakHours: number[];
  actualPeakHours: number[];
  peakHourHitRatePct: number;
}

/**
 * Compute predicted-vs-actual aggregation for a 1-day forecast row whose
 * forecasted day has completed. Uses real orders only — no LLM call.
 */
export async function computeForecastActuals(
  forecastRow: typeof aiForecastsTable.$inferSelect,
  restaurantTimezone: string,
): Promise<ForecastActuals | null> {
  const payload = forecastRow.payload as unknown as ForecastPayload;
  if (!payload || payload.horizonDays !== 1) return null;

  const dateStr = payload.forecastDate
    ?? formatDateInTz(new Date(forecastRow.generatedAt.getTime() + 86_400_000), restaurantTimezone);

  const { start, end } = dayWindowInTz(dateStr, restaurantTimezone);
  if (end.getTime() > Date.now()) return null;

  const restaurantId = forecastRow.restaurantId;
  const completedStatuses = ["completed", "served", "delivered", "ready", "paid"];

  const [actualByItem, actualByHour] = await Promise.all([
    db.select({
      menuItemId: orderItemsTable.menuItemId,
      name: menuItemsTable.name,
      qty: sql<string>`coalesce(sum(${orderItemsTable.quantity}), 0)`,
      revenue: sql<string>`coalesce(sum(${orderItemsTable.quantity} * ${orderItemsTable.unitPrice}), 0)`,
    })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
      .leftJoin(menuItemsTable, eq(menuItemsTable.id, orderItemsTable.menuItemId))
      .where(and(
        eq(ordersTable.restaurantId, restaurantId),
        gte(ordersTable.createdAt, start),
        lt(ordersTable.createdAt, end),
        inArray(ordersTable.status, completedStatuses),
      ))
      .groupBy(orderItemsTable.menuItemId, menuItemsTable.name),
    db.select({
      hour: sql<string>`extract(hour from ${ordersTable.createdAt})::int`,
      qty: sql<string>`coalesce(sum(${orderItemsTable.quantity}), 0)`,
    })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
      .where(and(
        eq(ordersTable.restaurantId, restaurantId),
        gte(ordersTable.createdAt, start),
        lt(ordersTable.createdAt, end),
        inArray(ordersTable.status, completedStatuses),
      ))
      .groupBy(sql`extract(hour from ${ordersTable.createdAt})`),
  ]);

  let actualUnits = 0;
  let actualRevenue = 0;
  const actualItemList: Array<{ menuItemId: number; name: string; units: number }> = [];
  for (const r of actualByItem) {
    const q = Number(r.qty) || 0;
    actualUnits += q;
    actualRevenue += Number(r.revenue) || 0;
    actualItemList.push({ menuItemId: r.menuItemId, name: r.name ?? `#${r.menuItemId}`, units: q });
  }
  actualItemList.sort((a, b) => b.units - a.units);

  const predictedUnits = payload.totalForecastUnits;
  const predictedRevenue = payload.estimatedRevenue;

  const acc = (actual: number, predicted: number): number => {
    if (predicted <= 0 && actual <= 0) return 100;
    if (predicted <= 0) return 0;
    const err = Math.abs(actual - predicted) / predicted;
    return Math.max(0, Math.round((1 - err) * 100));
  };

  const predictedTopItems = (payload.items ?? []).slice(0, 5).map((i) => ({
    menuItemId: i.menuItemId,
    name: i.name,
    units: i.forecastUnits,
  }));
  const actualTopItems = actualItemList.slice(0, 5);
  const predictedTopSet = new Set(predictedTopItems.map((i) => i.menuItemId));
  const actualTopSet = new Set(actualTopItems.map((i) => i.menuItemId));
  const overlap = [...predictedTopSet].filter((id) => actualTopSet.has(id)).length;
  const denom = Math.max(predictedTopSet.size, actualTopSet.size, 1);
  const topItemAccuracyPct = Math.round((overlap / denom) * 100);

  const predictedPeak = (payload.peakHours ?? [])
    .filter((h) => h.intensity === "peak" || h.intensity === "busy")
    .map((h) => h.hour);
  const actualHours = actualByHour
    .map((r) => ({ hour: Number(r.hour), qty: Number(r.qty) || 0 }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, Math.max(3, predictedPeak.length || 3))
    .map((h) => h.hour);
  const peakOverlap = predictedPeak.filter((h) => actualHours.includes(h)).length;
  const peakHourHitRatePct = predictedPeak.length === 0 ? 0
    : Math.round((peakOverlap / predictedPeak.length) * 100);

  return {
    forecastId: forecastRow.id,
    forecastDate: dateStr,
    generatedAt: forecastRow.generatedAt.toISOString(),
    predicted: { units: predictedUnits, revenue: predictedRevenue },
    actual: { units: actualUnits, revenue: Number(actualRevenue.toFixed(2)) },
    unitAccuracyPct: acc(actualUnits, predictedUnits),
    revenueAccuracyPct: acc(actualRevenue, predictedRevenue),
    topItemAccuracyPct,
    predictedTopItems,
    actualTopItems,
    predictedPeakHours: predictedPeak,
    actualPeakHours: actualHours,
    peakHourHitRatePct,
  };
}

// ────────────────────────── Nightly auto-run ──────────────────────────

interface NightlyRunResult {
  evaluated: number;
  ranOk: number;
  skippedNoPlan: number;
  skippedNoCredits: number;
  skippedNoHistory: number;
  skippedAlreadyRun: number;
  skippedFeatureDisabled: number;
  failed: number;
}

/**
 * Iterate active restaurants whose local time matches the schedule and run
 * a 1-day "tomorrow" forecast for each one that:
 *   - is on a plan with `khana_ai_enabled` (or legacy `aiEnabled`)
 *   - has the `ai_demand_forecast` toggle on (default: enabled)
 *   - has enough wallet credits for one charge
 *   - hasn't already had a successful nightly forecast for tomorrow today
 *
 * Skips gracefully (logged, no thrown errors) on every other case.
 */
export async function runNightlyDemandForecastsForHour(localHourTarget: number): Promise<NightlyRunResult> {
  const result: NightlyRunResult = {
    evaluated: 0,
    ranOk: 0,
    skippedNoPlan: 0,
    skippedNoCredits: 0,
    skippedNoHistory: 0,
    skippedAlreadyRun: 0,
    skippedFeatureDisabled: 0,
    failed: 0,
  };

  const restaurants = await db.select({
    id: restaurantsTable.id,
    tenantId: restaurantsTable.tenantId,
    name: restaurantsTable.name,
    timezone: restaurantsTable.timezone,
    isActive: restaurantsTable.isActive,
  }).from(restaurantsTable).where(eq(restaurantsTable.isActive, true));

  const now = new Date();
  for (const r of restaurants) {
    const tz = r.timezone || "Asia/Kolkata";
    let localHour: number;
    try {
      localHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now));
    } catch {
      localHour = -1;
    }
    if (localHour !== localHourTarget) continue;
    result.evaluated += 1;

    try {
      // Plan gate: khana_ai_enabled
      const [tenant] = await db.select({
        planId: tenantsTable.planId,
        isSuspended: tenantsTable.isSuspended,
      }).from(tenantsTable).where(eq(tenantsTable.id, r.tenantId));
      if (!tenant || tenant.isSuspended) { result.skippedNoPlan += 1; continue; }

      let planAllowsAi = true;
      let toggles: Record<string, boolean> | null = null;
      if (tenant.planId) {
        const [plan] = await db.select({
          aiEnabled: subscriptionPlansTable.aiEnabled,
          aiFeatureToggles: subscriptionPlansTable.aiFeatureToggles,
          featureFlags: subscriptionPlansTable.featureFlags,
        }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
        if (plan) {
          const khanaFlag = isFeatureEnabled(plan.featureFlags ?? null, "khana_ai_enabled");
          planAllowsAi = khanaFlag || !!plan.aiEnabled;
          toggles = (plan.aiFeatureToggles as Record<string, boolean> | null) ?? null;
        }
      }
      if (!planAllowsAi) { result.skippedNoPlan += 1; continue; }
      if (toggles && toggles["ai_demand_forecast"] === false) {
        result.skippedFeatureDisabled += 1;
        continue;
      }

      // Already-run today guard: any active forecast for this restaurant
      // generated within the last 18 hours with horizonDays=1.
      const cutoff = new Date(Date.now() - 18 * 3600_000);
      const [existing] = await db.select({ id: aiForecastsTable.id })
        .from(aiForecastsTable)
        .where(and(
          eq(aiForecastsTable.restaurantId, r.id),
          eq(aiForecastsTable.horizonDays, 1),
          gte(aiForecastsTable.generatedAt, cutoff),
        ))
        .orderBy(desc(aiForecastsTable.generatedAt))
        .limit(1);
      if (existing) { result.skippedAlreadyRun += 1; continue; }

      // History gate: cheap pre-check.
      const [{ n: orderCount }] = await db.select({
        n: sql<number>`count(*)::int`,
      }).from(ordersTable).where(and(
        eq(ordersTable.restaurantId, r.id),
        gte(ordersTable.createdAt, new Date(Date.now() - 90 * 86_400_000)),
        inArray(ordersTable.status, ["completed", "served", "delivered", "ready"]),
      ));
      if (!orderCount || orderCount < 1) { result.skippedNoHistory += 1; continue; }

      // Credit pre-check + reserve.
      const rule = await resolveCreditRule({
        featureSlug: "ai_demand_forecast",
        planId: tenant.planId ?? null,
        restaurantId: r.id,
      });
      if (!rule) { result.skippedNoPlan += 1; continue; }
      const credits = priceCredits(rule, 1);

      const wallet = await getOrCreateWallet(r.tenantId);
      const balance = summarizeWallet(wallet);
      if (balance.isBlocked || balance.available < credits) {
        result.skippedNoCredits += 1;
        continue;
      }

      let reservation: AiCreditReservation;
      try {
        reservation = await reserveCredits({
          tenantId: r.tenantId,
          featureSlug: "ai_demand_forecast",
          credits,
          meta: { source: "nightly_auto", restaurantId: r.id },
        });
      } catch (err) {
        const e = err as { code?: string };
        if (e.code === "INSUFFICIENT_CREDITS" || e.code === "WALLET_BLOCKED") {
          result.skippedNoCredits += 1;
        } else {
          result.failed += 1;
          logger.error({ err, restaurantId: r.id }, "[forecast-nightly] reserve failed");
        }
        continue;
      }

      try {
        const forecastDate = tomorrowDateInTz(tz, now);
        await runDemandForecast({
          restaurantId: r.id,
          tenantId: r.tenantId,
          userId: null,
          horizonDays: 1,
          forecastDate,
          reservation,
          source: "nightly_auto",
        });
        result.ranOk += 1;
      } catch (err) {
        await refundReservation(reservation, (err as Error).message ?? "nightly forecast failed");
        if (err instanceof ForecastError && err.code === "INSUFFICIENT_HISTORY") {
          result.skippedNoHistory += 1;
        } else {
          result.failed += 1;
          logger.error({ err, restaurantId: r.id }, "[forecast-nightly] generate failed");
        }
      }
    } catch (err) {
      result.failed += 1;
      logger.error({ err, restaurantId: r.id }, "[forecast-nightly] outer failure");
    }
  }

  // Reference an unused import to avoid lint complaints.
  void purchaseOrdersTable;
  void purchaseOrderItemsTable;

  return result;
}
