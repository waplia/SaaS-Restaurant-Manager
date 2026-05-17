import crypto from "crypto";
import { eq, and, desc, isNull, inArray } from "drizzle-orm";
import {
  db,
  devicesTable,
  deviceLogsTable,
  deviceRoutingRulesTable,
  deviceStationMappingsTable,
  deviceSyncStateTable,
  kitchensTable,
} from "./db";
import { broadcastEvent } from "./socketio";
import type { DeviceType, DeviceStatus } from "@workspace/db";

export const PRINTER_TYPES: DeviceType[] = ["thermal_printer", "kot_printer"];
export const KOT_TARGET_TYPES: DeviceType[] = ["kot_printer", "kitchen_display"];
export const OFFLINE_TYPES: DeviceType[] = ["android_pos", "tablet_menu", "self_kiosk"];
export const CARD_TERMINAL_TYPES: DeviceType[] = ["card_terminal"];
export const ALL_DEVICE_TYPES: DeviceType[] = [
  "thermal_printer", "kot_printer", "kitchen_display", "customer_display",
  "barcode_scanner", "qr_scanner", "cash_drawer", "biometric",
  "android_pos", "tablet_menu", "self_kiosk", "token_display",
  "card_terminal",
];

export function isDeviceType(v: unknown): v is DeviceType {
  return typeof v === "string" && (ALL_DEVICE_TYPES as string[]).includes(v);
}

export function generateRegistrationToken(): string {
  return `dvc_${crypto.randomBytes(18).toString("base64url")}`;
}

export async function logDeviceEvent(args: {
  deviceId: number;
  restaurantId: number;
  eventType: string;
  message?: string;
  metadata?: Record<string, unknown>;
  source?: string;
}): Promise<void> {
  await db.insert(deviceLogsTable).values({
    deviceId: args.deviceId,
    restaurantId: args.restaurantId,
    eventType: args.eventType,
    message: args.message ?? null,
    metadata: args.metadata ?? {},
    source: args.source ?? "system",
  });
}

export async function setDeviceStatus(args: {
  deviceId: number;
  restaurantId: number;
  status: DeviceStatus;
  reason?: string;
}): Promise<void> {
  const [current] = await db.select({ status: devicesTable.status })
    .from(devicesTable).where(eq(devicesTable.id, args.deviceId));
  if (!current) return;
  if (current.status === args.status) return;
  await db.update(devicesTable).set({
    status: args.status,
    updatedAt: new Date(),
  }).where(eq(devicesTable.id, args.deviceId));
  await logDeviceEvent({
    deviceId: args.deviceId,
    restaurantId: args.restaurantId,
    eventType: "status_changed",
    message: `Status changed: ${current.status} -> ${args.status}${args.reason ? ` (${args.reason})` : ""}`,
    metadata: { from: current.status, to: args.status, reason: args.reason },
  });
  broadcastEvent(args.restaurantId, "device:status", {
    id: args.deviceId,
    status: args.status,
  });
}

const ERROR_THRESHOLD = 3;

export async function recordPrintAttempt(args: {
  deviceId: number;
  restaurantId: number;
  orderId?: number;
  ticketId?: number;
  success: boolean;
  message?: string;
}): Promise<void> {
  await logDeviceEvent({
    deviceId: args.deviceId,
    restaurantId: args.restaurantId,
    eventType: args.success ? "print_success" : "print_failed",
    message: args.message,
    metadata: { orderId: args.orderId, ticketId: args.ticketId },
    source: "kot_engine",
  });

  if (args.success) {
    await db.update(devicesTable).set({
      consecutiveErrors: 0,
      updatedAt: new Date(),
    }).where(eq(devicesTable.id, args.deviceId));
  } else {
    const [d] = await db.select({ consecutiveErrors: devicesTable.consecutiveErrors, status: devicesTable.status })
      .from(devicesTable).where(eq(devicesTable.id, args.deviceId));
    if (!d) return;
    const next = d.consecutiveErrors + 1;
    await db.update(devicesTable).set({
      consecutiveErrors: next,
      updatedAt: new Date(),
    }).where(eq(devicesTable.id, args.deviceId));
    if (next >= ERROR_THRESHOLD && d.status !== "error") {
      await setDeviceStatus({
        deviceId: args.deviceId,
        restaurantId: args.restaurantId,
        status: "error",
        reason: `${next} consecutive print failures`,
      });
    }
  }
}

/**
 * Resolve which printer device(s) should print for a given kitchen ticket.
 * Order of resolution:
 *   1. Routing rules matching kitchenId (and optional orderType)
 *   2. Station mappings for the kitchen
 *   3. Device with kitchenId column set (legacy migrated record)
 * Returns an empty array when no live device is configured — callers may
 * fall back to the kitchen.printer_name value.
 */
export async function resolvePrintersForKitchen(args: {
  restaurantId: number;
  kitchenId: number;
  orderType?: string | null;
}): Promise<Array<{ deviceId: number; name: string; status: string }>> {
  const { restaurantId, kitchenId, orderType } = args;

  const rules = await db.select({
    deviceId: deviceRoutingRulesTable.deviceId,
    orderType: deviceRoutingRulesTable.orderType,
  })
    .from(deviceRoutingRulesTable)
    .where(and(
      eq(deviceRoutingRulesTable.restaurantId, restaurantId),
      eq(deviceRoutingRulesTable.kitchenId, kitchenId),
    ))
    .orderBy(desc(deviceRoutingRulesTable.priority));

  const matchingRuleDeviceIds = rules
    .filter(r => !r.orderType || !orderType || r.orderType === orderType)
    .map(r => r.deviceId);

  const stationMappings = await db.select({ deviceId: deviceStationMappingsTable.deviceId })
    .from(deviceStationMappingsTable)
    .where(eq(deviceStationMappingsTable.kitchenId, kitchenId));

  const legacyDevices = await db.select({ id: devicesTable.id })
    .from(devicesTable)
    .where(and(
      eq(devicesTable.restaurantId, restaurantId),
      eq(devicesTable.kitchenId, kitchenId),
      isNull(devicesTable.deletedAt),
    ));

  const candidateIds = Array.from(new Set([
    ...matchingRuleDeviceIds,
    ...stationMappings.map(m => m.deviceId),
    ...legacyDevices.map(d => d.id),
  ]));

  if (candidateIds.length === 0) return [];

  const devices = await db.select({
    id: devicesTable.id,
    name: devicesTable.name,
    status: devicesTable.status,
    type: devicesTable.type,
    deletedAt: devicesTable.deletedAt,
  })
    .from(devicesTable)
    .where(inArray(devicesTable.id, candidateIds));

  return devices
    .filter(d => d.deletedAt === null && (PRINTER_TYPES as string[]).includes(d.type))
    .map(d => ({ deviceId: d.id, name: d.name, status: d.status }));
}

/**
 * Resolve the default receipt printer for a branch (or restaurant when no
 * branch). Returns null if none configured.
 */
export async function resolveDefaultReceiptPrinter(args: {
  restaurantId: number;
  branchId?: number | null;
}): Promise<{ deviceId: number; name: string } | null> {
  const rules = await db.select({
    deviceId: deviceRoutingRulesTable.deviceId,
    branchId: deviceRoutingRulesTable.branchId,
  })
    .from(deviceRoutingRulesTable)
    .where(and(
      eq(deviceRoutingRulesTable.restaurantId, args.restaurantId),
      eq(deviceRoutingRulesTable.isDefaultReceipt, true),
    ));

  const branchMatch = rules.find(r => args.branchId != null && r.branchId === args.branchId);
  const restaurantMatch = rules.find(r => r.branchId == null);
  const pick = branchMatch ?? restaurantMatch;
  if (!pick) return null;

  const [d] = await db.select({ id: devicesTable.id, name: devicesTable.name })
    .from(devicesTable)
    .where(and(eq(devicesTable.id, pick.deviceId), isNull(devicesTable.deletedAt)));
  return d ? { deviceId: d.id, name: d.name } : null;
}

export async function recordHeartbeat(args: {
  deviceId: number;
  restaurantId: number;
  firmwareVersion?: string;
  appVersion?: string;
  pendingCount?: number;
  status?: DeviceStatus;
}): Promise<void> {
  const update: Record<string, unknown> = {
    lastSeenAt: new Date(),
    updatedAt: new Date(),
  };
  if (args.firmwareVersion !== undefined) update.firmwareVersion = args.firmwareVersion;
  if (args.appVersion !== undefined) update.appVersion = args.appVersion;
  await db.update(devicesTable).set(update).where(eq(devicesTable.id, args.deviceId));

  if (args.status) {
    await setDeviceStatus({
      deviceId: args.deviceId,
      restaurantId: args.restaurantId,
      status: args.status,
      reason: "heartbeat",
    });
  } else {
    await setDeviceStatus({
      deviceId: args.deviceId,
      restaurantId: args.restaurantId,
      status: "online",
      reason: "heartbeat",
    });
  }

  if (args.pendingCount !== undefined) {
    const [existing] = await db.select({ id: deviceSyncStateTable.id })
      .from(deviceSyncStateTable).where(eq(deviceSyncStateTable.deviceId, args.deviceId));
    if (existing) {
      await db.update(deviceSyncStateTable).set({
        pendingCount: args.pendingCount,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(deviceSyncStateTable.deviceId, args.deviceId));
    } else {
      await db.insert(deviceSyncStateTable).values({
        deviceId: args.deviceId,
        pendingCount: args.pendingCount,
        lastSyncAt: new Date(),
      });
    }
  }
}

/**
 * Notify configured printers/displays for the given kitchen tickets that a new
 * order arrived. We only log the dispatch + emit a socket event so the device
 * agent (or browser KDS) can pick it up; physical printing is handled by the
 * device-side agent in a follow-up task.
 */
export async function dispatchTicketsToDevices(args: {
  restaurantId: number;
  orderId: number;
  tickets: Array<{ ticketId: number; kitchenId: number }>;
  orderType?: string | null;
}): Promise<void> {
  for (const t of args.tickets) {
    const printers = await resolvePrintersForKitchen({
      restaurantId: args.restaurantId,
      kitchenId: t.kitchenId,
      orderType: args.orderType,
    });
    if (printers.length === 0) {
      // Fall back to kitchen.printerName legacy field — log a no-device event
      const [k] = await db.select({ printerName: kitchensTable.printerName })
        .from(kitchensTable).where(eq(kitchensTable.id, t.kitchenId));
      if (k?.printerName) {
        // Legacy printer config remains active; nothing to do here.
        continue;
      }
      continue;
    }
    for (const p of printers) {
      await recordPrintAttempt({
        deviceId: p.deviceId,
        restaurantId: args.restaurantId,
        orderId: args.orderId,
        ticketId: t.ticketId,
        success: true,
        message: `Dispatched ticket #${t.ticketId} for order #${args.orderId}`,
      });
      broadcastEvent(args.restaurantId, "device:print", {
        deviceId: p.deviceId,
        ticketId: t.ticketId,
        orderId: args.orderId,
        kitchenId: t.kitchenId,
      });
    }
  }
}

export async function offlineSweep(staleMinutes = 5): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const stale = await db.select({ id: devicesTable.id, restaurantId: devicesTable.restaurantId })
    .from(devicesTable)
    .where(and(eq(devicesTable.status, "online"), isNull(devicesTable.deletedAt)));
  let n = 0;
  for (const d of stale) {
    const [{ lastSeenAt }] = await db.select({ lastSeenAt: devicesTable.lastSeenAt })
      .from(devicesTable).where(eq(devicesTable.id, d.id));
    if (lastSeenAt && lastSeenAt < cutoff) {
      await setDeviceStatus({
        deviceId: d.id,
        restaurantId: d.restaurantId,
        status: "offline",
        reason: `no heartbeat for ${staleMinutes}m`,
      });
      n++;
    }
  }
  return n;
}
