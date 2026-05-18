import { eq, and, gte, sql, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  restaurantSettingsTable,
  ordersTable,
  orderItemsTable,
  notificationsTable,
  usersTable,
} from "./db";
import { broadcastEvent } from "./socketio";
import { recordAuditLog } from "./audit";
import { logger } from "./logger";
import { sendSms, sendWhatsApp } from "./notifications";

export interface OrderCapacityConfig {
  enabled: boolean;
  slotMinutes: number;
  maxOrdersPerSlot: number | null;
  pauseQrOrders: boolean;
  pauseOnlineOrders: boolean;
  pauseUntil: string | null;
  autoExtendThresholdPct: number;
  autoExtendPrepMinutes: number;
  managerAlertOnRush: boolean;
  itemCaps: Array<{ menuItemId: number; maxPerSlot: number }>;
  outletCaps: Array<{ branchId: number; maxPerSlot: number }>;
  orderTypeCaps: Array<{ orderType: string; maxPerSlot: number }>;
  pausedDeliveryZones: number[];
  unavailableMessage: string | null;
}

const DEFAULT: OrderCapacityConfig = {
  enabled: false,
  slotMinutes: 15,
  maxOrdersPerSlot: null,
  pauseQrOrders: false,
  pauseOnlineOrders: false,
  pauseUntil: null,
  autoExtendThresholdPct: 80,
  autoExtendPrepMinutes: 10,
  managerAlertOnRush: true,
  itemCaps: [],
  outletCaps: [],
  orderTypeCaps: [],
  pausedDeliveryZones: [],
  unavailableMessage: null,
};

export async function loadOrderCapacityConfig(restaurantId: number): Promise<OrderCapacityConfig> {
  const [row] = await db
    .select()
    .from(restaurantSettingsTable)
    .where(
      and(
        eq(restaurantSettingsTable.restaurantId, restaurantId),
        eq(restaurantSettingsTable.section, "order-capacity"),
      ),
    );
  const d = (row?.data ?? {}) as Partial<OrderCapacityConfig>;
  return {
    ...DEFAULT,
    ...d,
    slotMinutes: clampInt(d.slotMinutes, DEFAULT.slotMinutes, 1, 240),
    maxOrdersPerSlot: nullableInt(d.maxOrdersPerSlot, 0, 10000),
    pauseUntil: typeof d.pauseUntil === "string" ? d.pauseUntil : null,
    autoExtendThresholdPct: clampInt(d.autoExtendThresholdPct, 80, 1, 100),
    autoExtendPrepMinutes: clampInt(d.autoExtendPrepMinutes, 10, 0, 120),
    itemCaps: Array.isArray(d.itemCaps) ? d.itemCaps.filter((x) => typeof x?.menuItemId === "number" && typeof x?.maxPerSlot === "number") : [],
    outletCaps: Array.isArray(d.outletCaps) ? d.outletCaps.filter((x) => typeof x?.branchId === "number" && typeof x?.maxPerSlot === "number") : [],
    orderTypeCaps: Array.isArray(d.orderTypeCaps) ? d.orderTypeCaps.filter((x) => typeof x?.orderType === "string" && typeof x?.maxPerSlot === "number") : [],
    pausedDeliveryZones: Array.isArray(d.pausedDeliveryZones) ? d.pausedDeliveryZones.filter((n) => typeof n === "number") : [],
    unavailableMessage: typeof d.unavailableMessage === "string" ? d.unavailableMessage : null,
  };
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
function nullableInt(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= min) return null;
  return Math.min(max, Math.floor(n));
}

export interface CapacityCheckInput {
  restaurantId: number;
  orderType?: string | null;
  branchId?: number | null;
  deliveryZoneId?: number | null;
  channel?: "qr" | "online" | "pos";
  itemQuantities?: Array<{ menuItemId: number; quantity: number }>;
  config?: OrderCapacityConfig;
}

export interface CapacityCheckResult {
  allowed: boolean;
  reason?: string;
  nextAvailableAt?: string | null;
  utilizationPct?: number;
  autoExtendApplied?: boolean;
}

function slotWindow(slotMinutes: number, at: Date): { start: Date; end: Date } {
  const ms = slotMinutes * 60_000;
  const start = new Date(Math.floor(at.getTime() / ms) * ms);
  const end = new Date(start.getTime() + ms);
  return { start, end };
}

export async function evaluateOrderCapacity(input: CapacityCheckInput): Promise<CapacityCheckResult> {
  const cfg = input.config ?? (await loadOrderCapacityConfig(input.restaurantId));
  if (!cfg.enabled) return { allowed: true };

  const now = new Date();

  // Time-bound pause: once pauseUntil has elapsed, the channel flags no longer
  // count as paused (they auto-resume from the engine's perspective so the
  // "Auto-resume at ..." UI promise is honoured).
  const pauseUntil = cfg.pauseUntil ? new Date(cfg.pauseUntil) : null;
  const pauseStillActive = !pauseUntil || pauseUntil > now;
  const qrPaused = cfg.pauseQrOrders && pauseStillActive;
  const onlinePaused = cfg.pauseOnlineOrders && pauseStillActive;

  if (input.channel === "qr" && qrPaused) {
    return { allowed: false, reason: cfg.unavailableMessage ?? "QR ordering is temporarily paused.", nextAvailableAt: pauseUntil?.toISOString() ?? null };
  }
  if (input.channel === "online" && onlinePaused) {
    return { allowed: false, reason: cfg.unavailableMessage ?? "Online ordering is temporarily paused.", nextAvailableAt: pauseUntil?.toISOString() ?? null };
  }

  if (input.deliveryZoneId != null && cfg.pausedDeliveryZones.includes(input.deliveryZoneId)) {
    return { allowed: false, reason: "Delivery to this area is temporarily paused." };
  }

  const { start, end } = slotWindow(cfg.slotMinutes, now);

  // Count orders in current slot
  const conds = [
    eq(ordersTable.restaurantId, input.restaurantId),
    gte(ordersTable.createdAt, start),
  ];
  const [{ c: slotCountRaw }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(ordersTable)
    .where(and(...conds));
  const slotCount = Number(slotCountRaw);

  if (cfg.maxOrdersPerSlot != null && slotCount >= cfg.maxOrdersPerSlot) {
    return {
      allowed: false,
      reason: cfg.unavailableMessage ?? `We're at capacity for this ${cfg.slotMinutes}-min slot. Try again shortly.`,
      nextAvailableAt: end.toISOString(),
      utilizationPct: 100,
    };
  }

  // Per-order-type cap
  if (input.orderType) {
    const cap = cfg.orderTypeCaps.find((c) => c.orderType === input.orderType);
    if (cap) {
      const [{ c }] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(ordersTable)
        .where(and(...conds, eq(ordersTable.orderType, input.orderType)));
      if (Number(c) >= cap.maxPerSlot) {
        return { allowed: false, reason: `Capacity reached for ${input.orderType} orders.`, nextAvailableAt: end.toISOString() };
      }
    }
  }

  // Per-outlet cap
  // NOTE: the orders table does not currently carry a `branchId` column, so we
  // cannot scope the per-slot count to a specific outlet. Until a real outlet
  // column is added (or a branches→orders join table is introduced), this cap
  // intentionally degrades to a no-op rather than silently aliasing onto an
  // unrelated column (e.g. `brandId`) and misapplying capacity.
  void input.branchId;
  void cfg.outletCaps;

  // Per-item cap
  if (input.itemQuantities && input.itemQuantities.length > 0 && cfg.itemCaps.length > 0) {
    const cappedIds = cfg.itemCaps.map((c) => c.menuItemId);
    const requestedCapped = input.itemQuantities.filter((q) => cappedIds.includes(q.menuItemId));
    if (requestedCapped.length > 0) {
      const rows = await db
        .select({ menuItemId: orderItemsTable.menuItemId, qty: sql<number>`coalesce(sum(${orderItemsTable.quantity}),0)::int` })
        .from(orderItemsTable)
        .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
        .where(and(
          eq(ordersTable.restaurantId, input.restaurantId),
          gte(ordersTable.createdAt, start),
          inArray(orderItemsTable.menuItemId, requestedCapped.map((r) => r.menuItemId)),
        ))
        .groupBy(orderItemsTable.menuItemId);
      const sold = new Map(rows.map((r) => [r.menuItemId, Number(r.qty)] as const));
      for (const req of requestedCapped) {
        const cap = cfg.itemCaps.find((c) => c.menuItemId === req.menuItemId)!;
        const used = sold.get(req.menuItemId) ?? 0;
        if (used + req.quantity > cap.maxPerSlot) {
          return { allowed: false, reason: `Item is sold out for this ${cfg.slotMinutes}-min slot.`, nextAvailableAt: end.toISOString() };
        }
      }
    }
  }

  // Utilization & auto-extend signal
  let utilizationPct = 0;
  let autoExtendApplied = false;
  if (cfg.maxOrdersPerSlot != null && cfg.maxOrdersPerSlot > 0) {
    utilizationPct = Math.round((slotCount / cfg.maxOrdersPerSlot) * 100);
    if (utilizationPct >= cfg.autoExtendThresholdPct) {
      autoExtendApplied = cfg.autoExtendPrepMinutes > 0;
    }
  }

  return { allowed: true, utilizationPct, autoExtendApplied, nextAvailableAt: null };
}

/** Extra prep minutes to add to kitchen tickets during rush. Returns 0 if not active. */
export async function getRushPrepBumpMinutes(restaurantId: number): Promise<number> {
  const cfg = await loadOrderCapacityConfig(restaurantId);
  if (!cfg.enabled || cfg.autoExtendPrepMinutes <= 0 || cfg.maxOrdersPerSlot == null || cfg.maxOrdersPerSlot <= 0) return 0;
  const now = new Date();
  const { start } = slotWindow(cfg.slotMinutes, now);
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(ordersTable)
    .where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, start)));
  const utilization = (Number(c) / cfg.maxOrdersPerSlot) * 100;
  if (utilization >= cfg.autoExtendThresholdPct) return cfg.autoExtendPrepMinutes;
  return 0;
}

/** Fire a manager alert when rush threshold is crossed for the first time in a slot. */
const lastAlertSlot = new Map<number, string>();
export async function maybeAlertManagersOnRush(restaurantId: number): Promise<void> {
  try {
    const cfg = await loadOrderCapacityConfig(restaurantId);
    if (!cfg.enabled || !cfg.managerAlertOnRush || cfg.maxOrdersPerSlot == null) return;
    const { start } = slotWindow(cfg.slotMinutes, new Date());
    const slotKey = `${restaurantId}:${start.toISOString()}`;
    if (lastAlertSlot.get(restaurantId) === slotKey) return;

    const [{ c }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(ordersTable)
      .where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, start)));
    const utilization = (Number(c) / cfg.maxOrdersPerSlot) * 100;
    if (utilization < cfg.autoExtendThresholdPct) return;

    lastAlertSlot.set(restaurantId, slotKey);
    const title = "Kitchen rush — capacity nearly full";
    const body = `Slot at ${utilization.toFixed(0)}% capacity. Prep time auto-extended by ${cfg.autoExtendPrepMinutes} min.`;
    await db.insert(notificationsTable).values({
      restaurantId,
      type: "rush_alert",
      title,
      message: body,
      entityType: "order_capacity",
    });
    broadcastEvent(restaurantId, "order-capacity:rush", { utilization, slotMinutes: cfg.slotMinutes });

    // Fan out to managers/owners via WhatsApp + SMS so they see the alert even
    // when they aren't actively in the dashboard.
    const managers = await db
      .select({ phone: usersTable.phone, role: usersTable.role })
      .from(usersTable)
      .where(and(
        eq(usersTable.restaurantId, restaurantId),
        inArray(usersTable.role, ["owner", "manager"]),
        isNotNull(usersTable.phone),
      ));
    const phones = Array.from(new Set(
      managers.map((m) => (m.phone ?? "").trim()).filter((p) => p.length >= 4),
    ));
    const text = `${title}\n${body}`;
    await Promise.all(phones.flatMap((to) => [
      sendWhatsApp({ to, body: text }).catch((err) => {
        logger.warn({ err, restaurantId, to }, "rush alert whatsapp failed");
      }),
      sendSms({ to, body: text }).catch((err) => {
        logger.warn({ err, restaurantId, to }, "rush alert sms failed");
      }),
    ]));
  } catch (err) {
    logger.error({ err, restaurantId }, "rush alert failed");
  }
}

export async function logCapacityAction(args: {
  req?: Parameters<typeof recordAuditLog>[0]["req"];
  restaurantId: number;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
}): Promise<void> {
  await recordAuditLog({
    req: args.req,
    module: "order_capacity",
    action: args.action,
    entity: "order_capacity",
    restaurantId: args.restaurantId,
    oldValue: args.oldValue ?? null,
    newValue: args.newValue ?? null,
  });
}
