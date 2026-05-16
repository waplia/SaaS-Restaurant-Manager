import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  orderTokensTable,
  branchesTable,
  restaurantSettingsTable,
  ordersTable,
  kitchenTicketsTable,
  type OrderToken,
} from "./db";
import { broadcastEvent, getIO } from "./socketio";
import { sendWhatsApp } from "./notifications";
import { logger } from "./logger";

export interface TokenSettings {
  enabled: boolean;
  resetMode: "daily" | "manual";
  prefix: string;
  startNumber: number;
  padding: number;
  maxNumber: number;
  defaultCounter: number;
  whatsappOnReady: boolean;
  whatsappTemplate: string;
  showCustomerName: boolean;
  enabledOrderTypes: string[];
  recallTtsEnabled: boolean;
}

export const DEFAULT_TOKEN_SETTINGS: TokenSettings = {
  enabled: true,
  resetMode: "daily",
  prefix: "T",
  startNumber: 1,
  padding: 3,
  maxNumber: 999,
  defaultCounter: 1,
  whatsappOnReady: false,
  whatsappTemplate: "Hi {name}, your token {token} is ready at counter {counter}. Please collect your order.",
  showCustomerName: true,
  enabledOrderTypes: ["dine_in", "takeaway", "delivery"],
  recallTtsEnabled: true,
};

export async function getTokenSettings(restaurantId: number): Promise<TokenSettings> {
  const [row] = await db.select().from(restaurantSettingsTable).where(and(
    eq(restaurantSettingsTable.restaurantId, restaurantId),
    eq(restaurantSettingsTable.section, "token-display"),
  ));
  const data = (row?.data ?? {}) as Partial<TokenSettings>;
  return { ...DEFAULT_TOKEN_SETTINGS, ...data };
}

function todayScopeDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatToken(prefix: string, number: number, padding: number): string {
  const num = String(number).padStart(Math.max(1, padding), "0");
  return prefix ? `${prefix}-${num}` : num;
}

async function resolveBranchId(restaurantId: number): Promise<number | null> {
  const [main] = await db
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(and(eq(branchesTable.restaurantId, restaurantId), eq(branchesTable.isMain, true)));
  if (main) return main.id;
  const [any] = await db
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(eq(branchesTable.restaurantId, restaurantId));
  return any?.id ?? null;
}

/**
 * Issue a new token for an order. Idempotent: returns existing token if one
 * is already attached to the order. Skips when tokens are disabled or when
 * the order's type isn't enabled in settings.
 */
export async function issueTokenForOrder(args: {
  orderId: number;
  restaurantId: number;
  orderType: string;
  customerName?: string | null;
  customerPhone?: string | null;
  branchId?: number | null;
}): Promise<OrderToken | null> {
  const settings = await getTokenSettings(args.restaurantId);
  if (!settings.enabled) return null;
  if (!settings.enabledOrderTypes.includes(args.orderType)) return null;

  const [existing] = await db.select().from(orderTokensTable).where(eq(orderTokensTable.orderId, args.orderId));
  if (existing) return existing;

  const branchId = args.branchId ?? await resolveBranchId(args.restaurantId);
  const scopeDate = settings.resetMode === "daily" ? todayScopeDate() : "1970-01-01";

  // Compute next number for (restaurant, branch, scopeDate). We retry a small
  // number of times to recover from concurrent inserts hitting the unique-on-order
  // index — token uniqueness within scope isn't enforced by the DB to keep the
  // schema simple, so contention is resolved at the app level.
  for (let attempt = 0; attempt < 5; attempt++) {
    const [maxRow] = await db
      .select({ max: sql<number | null>`max(${orderTokensTable.number})` })
      .from(orderTokensTable)
      .where(and(
        eq(orderTokensTable.restaurantId, args.restaurantId),
        eq(orderTokensTable.scopeDate, scopeDate),
        branchId == null
          ? sql`${orderTokensTable.branchId} is null`
          : eq(orderTokensTable.branchId, branchId),
      ));
    const last = maxRow?.max ?? null;
    const next = last == null
      ? settings.startNumber
      : (last >= settings.maxNumber ? settings.startNumber : last + 1);
    const token = formatToken(settings.prefix, next, settings.padding);
    try {
      const [row] = await db.insert(orderTokensTable).values({
        restaurantId: args.restaurantId,
        branchId: branchId ?? null,
        orderId: args.orderId,
        token,
        number: next,
        counter: settings.defaultCounter,
        status: "waiting",
        customerName: args.customerName ?? null,
        customerPhone: args.customerPhone ?? null,
        orderType: args.orderType,
        scopeDate,
      }).returning();
      broadcastTokenEvent(args.restaurantId, branchId, "token:new", projectToken(row, settings));
      return row;
    } catch (err) {
      // Unique-on-orderId — another caller raced us. Return that row.
      const [again] = await db.select().from(orderTokensTable).where(eq(orderTokensTable.orderId, args.orderId));
      if (again) return again;
      // otherwise retry next number
      logger.warn({ err: (err as Error).message, attempt }, "token issuance retrying");
    }
  }
  return null;
}

export function maskName(name: string | null | undefined, show: boolean): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (!first) return null;
  if (!show) {
    return first.charAt(0).toUpperCase() + "•••";
  }
  return first;
}

export function projectToken(t: OrderToken, settings: TokenSettings) {
  return {
    id: t.id,
    token: t.token,
    number: t.number,
    counter: t.counter,
    status: t.status,
    orderId: t.orderId,
    orderType: t.orderType,
    customerName: maskName(t.customerName, settings.showCustomerName),
    branchId: t.branchId,
    issuedAt: t.issuedAt,
    readyAt: t.readyAt,
    servedAt: t.servedAt,
    recalledAt: t.recalledAt,
    recalledCount: t.recalledCount,
  };
}

export function broadcastTokenEvent(
  restaurantId: number,
  branchId: number | null | undefined,
  event: string,
  data: unknown,
): void {
  // Restaurant-wide channel for management UIs
  broadcastEvent(restaurantId, event, data);
  // Per-outlet public room is joined by guest sockets; reuse the io instance
  // exposed via socketio module
  const io = getIO();
  if (!io) return;
  if (branchId != null) io.to(`tokens:${restaurantId}:${branchId}`).emit(event, data);
  io.to(`tokens:${restaurantId}:all`).emit(event, data);
}

/**
 * Sync the token's status with the order's kitchen tickets. Called from the
 * kitchen ticket status PATCH endpoint. The token transitions to "preparing"
 * as soon as any ticket starts, "ready" only when all tickets are ready/served.
 */
export async function syncTokenWithTickets(orderId: number, restaurantId: number): Promise<void> {
  const [tok] = await db.select().from(orderTokensTable).where(eq(orderTokensTable.orderId, orderId));
  if (!tok) return;
  if (tok.status === "served" || tok.status === "cancelled") return;

  const tickets = await db.select({ status: kitchenTicketsTable.status })
    .from(kitchenTicketsTable).where(eq(kitchenTicketsTable.orderId, orderId));
  if (tickets.length === 0) return;

  const allReady = tickets.every(t => t.status === "ready" || t.status === "served");
  const anyStarted = tickets.some(t => t.status === "preparing" || t.status === "ready" || t.status === "served");
  const allServed = tickets.every(t => t.status === "served");

  let newStatus = tok.status;
  if (allServed) newStatus = "served";
  else if (allReady) newStatus = "ready";
  else if (anyStarted) newStatus = "preparing";
  else newStatus = "waiting";

  if (newStatus === tok.status) return;

  const updates: Record<string, unknown> = { status: newStatus, updatedAt: new Date() };
  if (newStatus === "ready" && !tok.readyAt) updates.readyAt = new Date();
  if (newStatus === "served" && !tok.servedAt) updates.servedAt = new Date();

  const [updated] = await db.update(orderTokensTable).set(updates).where(eq(orderTokensTable.id, tok.id)).returning();
  const settings = await getTokenSettings(restaurantId);
  broadcastTokenEvent(restaurantId, updated.branchId, "token:update", projectToken(updated, settings));

  if (newStatus === "ready" && settings.whatsappOnReady && updated.customerPhone && !updated.notifiedReadyAt) {
    const body = settings.whatsappTemplate
      .replace(/\{name\}/g, maskName(updated.customerName, true) ?? "Guest")
      .replace(/\{token\}/g, updated.token)
      .replace(/\{counter\}/g, String(updated.counter));
    sendWhatsApp({ to: updated.customerPhone, body }).catch((err) => {
      logger.error({ err: (err as Error).message, tokenId: updated.id }, "token whatsapp failed");
    });
    await db.update(orderTokensTable).set({ notifiedReadyAt: new Date() }).where(eq(orderTokensTable.id, updated.id));
  }
}
