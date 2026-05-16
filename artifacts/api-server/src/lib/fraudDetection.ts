import { and, eq, gte, lte, sql, desc, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  fraudAlertsTable,
  fraudDetectorSettingsTable,
  FRAUD_DETECTORS,
  FRAUD_DETECTOR_DEFAULTS,
  ordersTable,
  orderDiscountsTable,
  orderItemsTable,
  kitchenTicketsTable,
  paymentsTable,
  cashRegisterSessionsTable,
  attendanceTable,
  auditLogsTable,
  inventoryTransactionsTable,
  recipeMappingsTable,
  notificationsTable,
  usersTable,
  restaurantsTable,
  type FraudDetector,
} from "./db";
import { logger } from "./logger";
import { pushToStaff } from "./pushNotify";
import { generateFraudAiSummary } from "./fraudAiSummary";

export type AlertCandidate = {
  detector: FraudDetector;
  severity: "low" | "medium" | "high";
  subjectUserId: number | null;
  subjectRole: string | null;
  entityType: string | null;
  entityId: number | null;
  windowStart: Date;
  windowEnd: Date;
  score: number;
  threshold: number | null;
  observedValue: number | null;
  evidence: Record<string, unknown>;
  dedupeKey: string;
};

export async function getDetectorSettings(restaurantId: number): Promise<Map<FraudDetector, { isEnabled: boolean; threshold: number; config: Record<string, unknown> }>> {
  const rows = await db.select().from(fraudDetectorSettingsTable).where(eq(fraudDetectorSettingsTable.restaurantId, restaurantId));
  const out = new Map<FraudDetector, { isEnabled: boolean; threshold: number; config: Record<string, unknown> }>();
  for (const det of FRAUD_DETECTORS) {
    const row = rows.find(r => r.detector === det);
    const def = FRAUD_DETECTOR_DEFAULTS[det];
    out.set(det, {
      isEnabled: row?.isEnabled ?? true,
      threshold: row?.threshold != null ? Number(row.threshold) : Number(def.threshold),
      config: { ...def.config, ...(row?.config ?? {}) },
    });
  }
  return out;
}

export async function ensureDefaultDetectorSettings(restaurantId: number): Promise<void> {
  const existing = await db.select({ detector: fraudDetectorSettingsTable.detector })
    .from(fraudDetectorSettingsTable)
    .where(eq(fraudDetectorSettingsTable.restaurantId, restaurantId));
  const have = new Set(existing.map(r => r.detector));
  const toInsert = FRAUD_DETECTORS.filter(d => !have.has(d)).map(d => ({
    restaurantId,
    detector: d,
    isEnabled: true,
    threshold: FRAUD_DETECTOR_DEFAULTS[d].threshold,
    config: FRAUD_DETECTOR_DEFAULTS[d].config,
  }));
  if (toInsert.length) {
    await db.insert(fraudDetectorSettingsTable).values(toInsert).onConflictDoNothing();
  }
}

// ──────────────── Detectors ────────────────

async function detectExcessiveDiscounts(restaurantId: number, threshold: number, config: Record<string, unknown>): Promise<AlertCandidate[]> {
  const windowHours = Number(config.windowHours ?? 24);
  const minOrders = Number(config.minOrders ?? 3);
  const end = new Date();
  const start = new Date(end.getTime() - windowHours * 3600_000);
  const rows = await db
    .select({
      cashierId: orderDiscountsTable.recordedByUserId,
      totalDiscount: sql<number>`coalesce(sum(${orderDiscountsTable.amount}), 0)::float`,
      totalRevenue: sql<number>`coalesce(sum(${ordersTable.subtotal}), 0)::float`,
      orderCount: sql<number>`count(distinct ${ordersTable.id})::int`,
    })
    .from(orderDiscountsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderDiscountsTable.orderId))
    .where(and(
      eq(orderDiscountsTable.restaurantId, restaurantId),
      gte(orderDiscountsTable.createdAt, start),
      lte(orderDiscountsTable.createdAt, end),
      isNotNull(orderDiscountsTable.recordedByUserId),
    ))
    .groupBy(orderDiscountsTable.recordedByUserId);

  const out: AlertCandidate[] = [];
  for (const r of rows) {
    if (r.orderCount < minOrders || r.totalRevenue <= 0) continue;
    const pct = (r.totalDiscount / r.totalRevenue) * 100;
    if (pct < threshold) continue;
    const role = r.cashierId ? await getUserRole(r.cashierId) : null;
    out.push({
      detector: "excessive_discounts",
      severity: pct > threshold * 1.5 ? "high" : "medium",
      subjectUserId: r.cashierId,
      subjectRole: role,
      entityType: "user",
      entityId: r.cashierId,
      windowStart: start,
      windowEnd: end,
      score: pct,
      threshold,
      observedValue: r.totalDiscount,
      evidence: {
        cashierId: r.cashierId,
        totalDiscount: r.totalDiscount,
        totalRevenue: r.totalRevenue,
        discountPercent: Number(pct.toFixed(2)),
        orderCount: r.orderCount,
        windowHours,
      },
      dedupeKey: `excessive_discounts:${r.cashierId}:${dayKey(end)}`,
    });
  }
  return out;
}

async function detectVoidBills(restaurantId: number, threshold: number, config: Record<string, unknown>): Promise<AlertCandidate[]> {
  const windowHours = Number(config.windowHours ?? 24);
  const end = new Date();
  const start = new Date(end.getTime() - windowHours * 3600_000);
  const rows = await db
    .select({
      userId: ordersTable.waiterId,
      voidCount: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(${ordersTable.totalAmount}), 0)::float`,
    })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      eq(ordersTable.status, "cancelled"),
      gte(ordersTable.updatedAt, start),
      lte(ordersTable.updatedAt, end),
    ))
    .groupBy(ordersTable.waiterId);

  const out: AlertCandidate[] = [];
  for (const r of rows) {
    if (r.voidCount < threshold) continue;
    const role = r.userId ? await getUserRole(r.userId) : null;
    out.push({
      detector: "void_bills",
      severity: r.voidCount >= threshold * 2 ? "high" : "medium",
      subjectUserId: r.userId,
      subjectRole: role,
      entityType: "user",
      entityId: r.userId,
      windowStart: start,
      windowEnd: end,
      score: r.voidCount,
      threshold,
      observedValue: r.totalAmount,
      evidence: { userId: r.userId, voidCount: r.voidCount, voidAmount: r.totalAmount, windowHours },
      dedupeKey: `void_bills:${r.userId}:${dayKey(end)}`,
    });
  }
  return out;
}

async function detectCancelledKots(restaurantId: number, threshold: number, config: Record<string, unknown>): Promise<AlertCandidate[]> {
  const windowHours = Number(config.windowHours ?? 24);
  const end = new Date();
  const start = new Date(end.getTime() - windowHours * 3600_000);
  const rows = await db
    .select({
      waiterId: ordersTable.waiterId,
      cancelCount: sql<number>`count(*)::int`,
    })
    .from(kitchenTicketsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, kitchenTicketsTable.orderId))
    .where(and(
      eq(kitchenTicketsTable.restaurantId, restaurantId),
      eq(kitchenTicketsTable.status, "cancelled"),
      gte(kitchenTicketsTable.updatedAt, start),
      lte(kitchenTicketsTable.updatedAt, end),
    ))
    .groupBy(ordersTable.waiterId);

  const out: AlertCandidate[] = [];
  for (const r of rows) {
    if (r.cancelCount < threshold) continue;
    const role = r.waiterId ? await getUserRole(r.waiterId) : null;
    out.push({
      detector: "cancelled_kots",
      severity: r.cancelCount >= threshold * 2 ? "high" : "medium",
      subjectUserId: r.waiterId,
      subjectRole: role,
      entityType: "user",
      entityId: r.waiterId,
      windowStart: start,
      windowEnd: end,
      score: r.cancelCount,
      threshold,
      observedValue: r.cancelCount,
      evidence: { waiterId: r.waiterId, cancelCount: r.cancelCount, windowHours },
      dedupeKey: `cancelled_kots:${r.waiterId}:${dayKey(end)}`,
    });
  }
  return out;
}

async function detectRefundAbuse(restaurantId: number, threshold: number, config: Record<string, unknown>): Promise<AlertCandidate[]> {
  const windowDays = Number(config.windowDays ?? 7);
  const end = new Date();
  const start = new Date(end.getTime() - windowDays * 86400_000);
  const rows = await db
    .select({
      userId: paymentsTable.recordedBy,
      refundCount: sql<number>`count(*)::int`,
      refundTotal: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)::float`,
    })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.restaurantId, restaurantId),
      eq(paymentsTable.direction, "out"),
      eq(paymentsTable.referenceType, "refund"),
      gte(paymentsTable.paymentDate, start),
      lte(paymentsTable.paymentDate, end),
    ))
    .groupBy(paymentsTable.recordedBy);

  const out: AlertCandidate[] = [];
  for (const r of rows) {
    if (r.refundCount < threshold) continue;
    const role = r.userId ? await getUserRole(r.userId) : null;
    out.push({
      detector: "refund_abuse",
      severity: r.refundCount >= threshold * 2 ? "high" : "medium",
      subjectUserId: r.userId,
      subjectRole: role,
      entityType: "user",
      entityId: r.userId,
      windowStart: start,
      windowEnd: end,
      score: r.refundCount,
      threshold,
      observedValue: r.refundTotal,
      evidence: { userId: r.userId, refundCount: r.refundCount, refundTotal: r.refundTotal, windowDays },
      dedupeKey: `refund_abuse:${r.userId}:${dayKey(end)}`,
    });
  }
  return out;
}

async function detectCashMismatch(restaurantId: number, threshold: number): Promise<AlertCandidate[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 36 * 3600_000);
  const rows = await db
    .select()
    .from(cashRegisterSessionsTable)
    .where(and(
      eq(cashRegisterSessionsTable.restaurantId, restaurantId),
      eq(cashRegisterSessionsTable.status, "closed"),
      gte(cashRegisterSessionsTable.closedAt, start),
      lte(cashRegisterSessionsTable.closedAt, end),
    ));

  const out: AlertCandidate[] = [];
  for (const s of rows) {
    const variance = Math.abs(Number(s.overShort ?? 0));
    if (variance < threshold) continue;
    const role = s.closedByUserId ? await getUserRole(s.closedByUserId) : null;
    out.push({
      detector: "cash_mismatch",
      severity: variance >= threshold * 2 ? "high" : "medium",
      subjectUserId: s.closedByUserId,
      subjectRole: role,
      entityType: "cash_register_session",
      entityId: s.id,
      windowStart: s.openedAt,
      windowEnd: s.closedAt ?? end,
      score: variance,
      threshold,
      observedValue: variance,
      evidence: {
        sessionId: s.id,
        expectedCash: Number(s.expectedCash ?? 0),
        actualCash: Number(s.actualCash ?? 0),
        overShort: Number(s.overShort ?? 0),
        closedByUserId: s.closedByUserId,
        varianceReason: s.varianceReason,
      },
      dedupeKey: `cash_mismatch:session:${s.id}`,
    });
  }
  return out;
}

async function detectManualAttendanceEdits(restaurantId: number, threshold: number, config: Record<string, unknown>): Promise<AlertCandidate[]> {
  const windowDays = Number(config.windowDays ?? 7);
  const end = new Date();
  const start = new Date(end.getTime() - windowDays * 86400_000);
  const rows = await db
    .select({
      managerId: auditLogsTable.userId,
      editCount: sql<number>`count(*)::int`,
    })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.restaurantId, restaurantId),
      eq(auditLogsTable.entity, "attendance"),
      inArray(auditLogsTable.action, ["update", "create", "delete"]),
      gte(auditLogsTable.createdAt, start),
      lte(auditLogsTable.createdAt, end),
      isNotNull(auditLogsTable.userId),
    ))
    .groupBy(auditLogsTable.userId);

  const out: AlertCandidate[] = [];
  for (const r of rows) {
    if (r.editCount < threshold) continue;
    const role = r.managerId ? await getUserRole(r.managerId) : null;
    out.push({
      detector: "manual_attendance_edits",
      severity: r.editCount >= threshold * 2 ? "high" : "medium",
      subjectUserId: r.managerId,
      subjectRole: role,
      entityType: "user",
      entityId: r.managerId,
      windowStart: start,
      windowEnd: end,
      score: r.editCount,
      threshold,
      observedValue: r.editCount,
      evidence: { managerId: r.managerId, editCount: r.editCount, windowDays },
      dedupeKey: `manual_attendance_edits:${r.managerId}:${dayKey(end)}`,
    });
  }
  return out;
}

async function detectInventoryMismatch(restaurantId: number, threshold: number): Promise<AlertCandidate[]> {
  // Compare yesterday's recipe-based theoretical depletion vs actual sale-driven inventory deductions.
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - 86400_000);

  // Theoretical: sum(recipe.qty * orderItem.qty) for paid orders yesterday, per inventory item
  const theoretical = await db
    .select({
      itemId: recipeMappingsTable.inventoryItemId,
      expected: sql<number>`coalesce(sum(${recipeMappingsTable.quantity} * ${orderItemsTable.quantity}), 0)::float`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
    .innerJoin(recipeMappingsTable, and(
      eq(recipeMappingsTable.menuItemId, orderItemsTable.menuItemId),
      eq(recipeMappingsTable.restaurantId, restaurantId),
    ))
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      eq(ordersTable.paymentStatus, "paid"),
      gte(ordersTable.createdAt, start),
      lte(ordersTable.createdAt, end),
    ))
    .groupBy(recipeMappingsTable.inventoryItemId);

  // Actual: sum of "sale" / "wastage" / "adjustment" type movements yesterday
  const actual = await db
    .select({
      itemId: inventoryTransactionsTable.itemId,
      consumed: sql<number>`coalesce(sum(case when ${inventoryTransactionsTable.type} in ('sale','wastage','adjustment_out') then abs(${inventoryTransactionsTable.quantity}) else 0 end), 0)::float`,
    })
    .from(inventoryTransactionsTable)
    .where(and(
      eq(inventoryTransactionsTable.restaurantId, restaurantId),
      gte(inventoryTransactionsTable.createdAt, start),
      lte(inventoryTransactionsTable.createdAt, end),
    ))
    .groupBy(inventoryTransactionsTable.itemId);

  const actualMap = new Map(actual.map(a => [a.itemId, a.consumed]));
  const out: AlertCandidate[] = [];
  for (const t of theoretical) {
    if (t.expected <= 0) continue;
    const got = actualMap.get(t.itemId) ?? 0;
    const variancePct = Math.abs(got - t.expected) / t.expected * 100;
    if (variancePct < threshold) continue;
    out.push({
      detector: "inventory_mismatch",
      severity: variancePct >= threshold * 2 ? "high" : "medium",
      subjectUserId: null,
      subjectRole: null,
      entityType: "inventory_item",
      entityId: t.itemId,
      windowStart: start,
      windowEnd: end,
      score: variancePct,
      threshold,
      observedValue: Math.abs(got - t.expected),
      evidence: {
        inventoryItemId: t.itemId,
        expected: t.expected,
        actual: got,
        variancePercent: Number(variancePct.toFixed(2)),
        date: dayKey(start),
      },
      dedupeKey: `inventory_mismatch:${t.itemId}:${dayKey(start)}`,
    });
  }
  return out;
}

async function detectUnusualFreeItems(restaurantId: number, threshold: number, config: Record<string, unknown>): Promise<AlertCandidate[]> {
  const windowHours = Number(config.windowHours ?? 24);
  const end = new Date();
  const start = new Date(end.getTime() - windowHours * 3600_000);
  // 100% discount items or zero-price line items on non-complimentary menu items
  const rows = await db
    .select({
      waiterId: ordersTable.waiterId,
      freeCount: sql<number>`count(*)::int`,
      freeQty: sql<number>`coalesce(sum(${orderItemsTable.quantity}), 0)::int`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      sql`${orderItemsTable.unitPrice}::float = 0`,
      gte(orderItemsTable.createdAt, start),
      lte(orderItemsTable.createdAt, end),
    ))
    .groupBy(ordersTable.waiterId);

  const out: AlertCandidate[] = [];
  for (const r of rows) {
    if (r.freeCount < threshold) continue;
    const role = r.waiterId ? await getUserRole(r.waiterId) : null;
    out.push({
      detector: "unusual_free_items",
      severity: r.freeCount >= threshold * 2 ? "high" : "medium",
      subjectUserId: r.waiterId,
      subjectRole: role,
      entityType: "user",
      entityId: r.waiterId,
      windowStart: start,
      windowEnd: end,
      score: r.freeCount,
      threshold,
      observedValue: r.freeQty,
      evidence: { waiterId: r.waiterId, freeItemLineCount: r.freeCount, freeQuantity: r.freeQty, windowHours },
      dedupeKey: `unusual_free_items:${r.waiterId}:${dayKey(end)}`,
    });
  }
  return out;
}

const roleCache = new Map<number, string | null>();
async function getUserRole(userId: number): Promise<string | null> {
  if (roleCache.has(userId)) return roleCache.get(userId)!;
  const [u] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  const role = u?.role ?? null;
  roleCache.set(userId, role);
  return role;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Coupon abuse: same coupon code redeemed by the same customer phone an
// unusually high number of times within a window. Threshold = max redemptions
// per (coupon_code, customer_phone) pair before alerting.
async function detectCouponAbuse(restaurantId: number, threshold: number, config: Record<string, unknown>): Promise<AlertCandidate[]> {
  const windowHours = Number(config.windowHours ?? 24 * 7); // default 7 days
  const end = new Date();
  const start = new Date(end.getTime() - windowHours * 3600_000);

  const rows = await db
    .select({
      couponCode: orderDiscountsTable.couponCode,
      customerPhone: ordersTable.customerPhone,
      redemptions: sql<number>`count(*)::int`,
      totalDiscount: sql<number>`coalesce(sum(${orderDiscountsTable.amount}), 0)::float`,
    })
    .from(orderDiscountsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderDiscountsTable.orderId))
    .where(and(
      eq(orderDiscountsTable.restaurantId, restaurantId),
      eq(orderDiscountsTable.type, "coupon"),
      gte(orderDiscountsTable.createdAt, start),
      lte(orderDiscountsTable.createdAt, end),
      isNotNull(orderDiscountsTable.couponCode),
      isNotNull(ordersTable.customerPhone),
    ))
    .groupBy(orderDiscountsTable.couponCode, ordersTable.customerPhone);

  const out: AlertCandidate[] = [];
  for (const r of rows) {
    if (!r.couponCode || !r.customerPhone) continue;
    if (r.redemptions < threshold) continue;
    out.push({
      detector: "coupon_abuse",
      severity: r.redemptions > threshold * 2 ? "high" : "medium",
      subjectUserId: null,
      subjectRole: null,
      entityType: "coupon",
      entityId: null,
      windowStart: start,
      windowEnd: end,
      score: r.redemptions,
      threshold,
      observedValue: r.totalDiscount,
      evidence: {
        couponCode: r.couponCode,
        customerPhone: r.customerPhone,
        redemptions: r.redemptions,
        totalDiscount: r.totalDiscount,
        windowHours,
      },
      dedupeKey: `coupon_abuse:${r.couponCode}:${r.customerPhone}:${dayKey(end)}`,
    });
  }
  return out;
}

// Suspicious discount: a single bill discounted by more than `threshold` % of
// its subtotal. Captures the offending order so managers can review quickly.
async function detectSuspiciousDiscount(restaurantId: number, threshold: number, config: Record<string, unknown>): Promise<AlertCandidate[]> {
  const windowHours = Number(config.windowHours ?? 24);
  const end = new Date();
  const start = new Date(end.getTime() - windowHours * 3600_000);
  const minSubtotal = Number(config.minSubtotal ?? 100);

  const rows = await db
    .select({
      orderId: orderDiscountsTable.orderId,
      cashierId: ordersTable.waiterId,
      subtotal: sql<number>`coalesce(${ordersTable.subtotal}, 0)::float`,
      totalDiscount: sql<number>`coalesce(sum(${orderDiscountsTable.amount}), 0)::float`,
    })
    .from(orderDiscountsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderDiscountsTable.orderId))
    .where(and(
      eq(orderDiscountsTable.restaurantId, restaurantId),
      gte(orderDiscountsTable.createdAt, start),
      lte(orderDiscountsTable.createdAt, end),
    ))
    .groupBy(orderDiscountsTable.orderId, ordersTable.waiterId, ordersTable.subtotal);

  const out: AlertCandidate[] = [];
  for (const r of rows) {
    if (r.subtotal < minSubtotal) continue;
    const pct = (r.totalDiscount / r.subtotal) * 100;
    if (pct < threshold) continue;
    const role = r.cashierId ? await getUserRole(r.cashierId) : null;
    out.push({
      detector: "suspicious_discount",
      severity: pct > Math.max(threshold * 1.4, 80) ? "high" : "medium",
      subjectUserId: r.cashierId,
      subjectRole: role,
      entityType: "order",
      entityId: r.orderId,
      windowStart: start,
      windowEnd: end,
      score: pct,
      threshold,
      observedValue: r.totalDiscount,
      evidence: {
        orderId: r.orderId,
        subtotal: r.subtotal,
        totalDiscount: r.totalDiscount,
        discountPercent: Number(pct.toFixed(2)),
        cashierId: r.cashierId,
      },
      dedupeKey: `suspicious_discount:${r.orderId}`,
    });
  }
  return out;
}

// ──────────────── Engine ────────────────

export type DetectorGroup = "fast" | "slow" | "all";

const FAST: FraudDetector[] = ["excessive_discounts", "void_bills", "cancelled_kots", "refund_abuse", "unusual_free_items", "coupon_abuse", "suspicious_discount"];
const SLOW: FraudDetector[] = ["cash_mismatch", "manual_attendance_edits", "inventory_mismatch"];

export async function runDetectorsForRestaurant(
  restaurantId: number,
  group: DetectorGroup = "all",
  triggeredByUserId: number | null = null,
): Promise<{ created: number; skipped: number; detectors: FraudDetector[] }> {
  await ensureDefaultDetectorSettings(restaurantId);
  const settings = await getDetectorSettings(restaurantId);
  const targets = group === "all" ? [...FAST, ...SLOW] : group === "fast" ? FAST : SLOW;

  const candidates: AlertCandidate[] = [];
  for (const det of targets) {
    const cfg = settings.get(det);
    if (!cfg || !cfg.isEnabled) continue;
    try {
      let arr: AlertCandidate[] = [];
      switch (det) {
        case "excessive_discounts": arr = await detectExcessiveDiscounts(restaurantId, cfg.threshold, cfg.config); break;
        case "void_bills": arr = await detectVoidBills(restaurantId, cfg.threshold, cfg.config); break;
        case "cancelled_kots": arr = await detectCancelledKots(restaurantId, cfg.threshold, cfg.config); break;
        case "refund_abuse": arr = await detectRefundAbuse(restaurantId, cfg.threshold, cfg.config); break;
        case "cash_mismatch": arr = await detectCashMismatch(restaurantId, cfg.threshold); break;
        case "manual_attendance_edits": arr = await detectManualAttendanceEdits(restaurantId, cfg.threshold, cfg.config); break;
        case "inventory_mismatch": arr = await detectInventoryMismatch(restaurantId, cfg.threshold); break;
        case "unusual_free_items": arr = await detectUnusualFreeItems(restaurantId, cfg.threshold, cfg.config); break;
        case "coupon_abuse": arr = await detectCouponAbuse(restaurantId, cfg.threshold, cfg.config); break;
        case "suspicious_discount": arr = await detectSuspiciousDiscount(restaurantId, cfg.threshold, cfg.config); break;
      }
      candidates.push(...arr);
    } catch (err) {
      logger.error({ err, detector: det, restaurantId }, "[fraud] detector failed");
    }
  }

  let created = 0, skipped = 0;
  for (const c of candidates) {
    const inserted = await persistAlert(restaurantId, c, triggeredByUserId);
    if (inserted) created++; else skipped++;
  }

  return { created, skipped, detectors: targets };
}

async function persistAlert(restaurantId: number, c: AlertCandidate, triggeredByUserId: number | null): Promise<boolean> {
  // Generate AI summary (with fallback)
  const { summary, fallback } = await generateFraudAiSummary(restaurantId, c);

  const inserted = await db.insert(fraudAlertsTable).values({
    restaurantId,
    detector: c.detector,
    severity: c.severity,
    status: "open",
    subjectUserId: c.subjectUserId,
    subjectRole: c.subjectRole,
    entityType: c.entityType,
    entityId: c.entityId,
    windowStart: c.windowStart,
    windowEnd: c.windowEnd,
    score: c.score.toFixed(2),
    threshold: c.threshold != null ? c.threshold.toFixed(2) : null,
    observedValue: c.observedValue != null ? c.observedValue.toFixed(2) : null,
    evidence: c.evidence,
    aiSummary: summary,
    aiSummaryFallback: fallback,
    dedupeKey: c.dedupeKey,
  }).onConflictDoNothing({ target: [fraudAlertsTable.restaurantId, fraudAlertsTable.dedupeKey] }).returning({ id: fraudAlertsTable.id });

  if (inserted.length === 0) return false;
  const alertId = inserted[0]!.id;

  // In-app notification
  await db.insert(notificationsTable).values({
    restaurantId,
    type: "fraud_alert",
    title: `Fraud alert: ${humanDetector(c.detector)}`,
    message: summary,
    entityId: alertId,
    entityType: "fraud_alert",
  });

  // Audit log entry
  await db.insert(auditLogsTable).values({
    restaurantId,
    userId: triggeredByUserId,
    module: "fraud",
    action: "alert_created",
    entity: "fraud_alert",
    entityId: alertId,
    details: JSON.stringify({ detector: c.detector, severity: c.severity, score: c.score, dedupeKey: c.dedupeKey }),
    newValue: c.evidence,
  });

  // Push notify owners/managers (excluding the subject user)
  try {
    await pushToStaff(
      { restaurantId, roles: ["owner", "manager"], type: "fraud_alert" as never },
      { title: `Fraud alert: ${humanDetector(c.detector)}`, body: summary, data: { alertId, detector: c.detector, severity: c.severity } },
    );
  } catch (err) {
    logger.warn({ err }, "[fraud] push notification failed");
  }
  return true;
}

function humanDetector(d: FraudDetector): string {
  return d.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export async function runFraudCronTick(group: DetectorGroup): Promise<void> {
  const restaurants = await db.select({ id: restaurantsTable.id }).from(restaurantsTable);
  for (const r of restaurants) {
    try {
      const out = await runDetectorsForRestaurant(r.id, group);
      if (out.created > 0) logger.info({ restaurantId: r.id, ...out, group }, "[fraud] alerts created");
    } catch (err) {
      logger.error({ err, restaurantId: r.id }, "[fraud] tick failed");
    }
  }
}
