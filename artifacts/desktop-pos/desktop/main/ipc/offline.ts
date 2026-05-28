/**
 * Offline-aware helpers used by the IPC handlers.
 *
 * Architecture (Phase 5 contract):
 *   • READS are local-first **always**. The cache is the source of truth
 *     while a shift is open. When online, we fire-and-forget a background
 *     refresh so the next read sees fresh data, but we never block on it.
 *   • WRITES are local-first **always**. Every mutation hits the local DB
 *     and is enqueued into `pending_operations`. The sync engine drains
 *     immediately when online (usually < 1s) so the user-visible behaviour
 *     matches the online flow, but the architecture stays robust if the
 *     network blips mid-action.
 *   • Only `customers:create` writes deserve to surface the *server's* id
 *     synchronously to the caller in the online case, since the cashier may
 *     attach it to an order in the next click. We achieve that by enqueuing
 *     and then waiting briefly for the sync engine to drain that one op.
 *     Falls back gracefully to the local-id row when offline.
 */

import { randomUUID } from "node:crypto";
import { ApiError } from "../api/client";
import type { ApiClient } from "../api/client";
import * as Q from "../db/queries";
import * as P from "../db/pending";
import * as D from "../db/domain";
import { kvGet, kvSet, nextLocalId, upsertOrder, getOrder } from "../db/queries";
import type {
  MenuCategory, MenuItem, FloorTable, CustomerSummary,
  OrderDetailView, OrderHeader, CreateOrderRequest, CartItemInput,
  RestaurantInfo, PayMethod, ModifierGroup,
} from "../../shared/ipc-contract";

export interface OfflineContext {
  client: ApiClient;
  isOnline: () => boolean;
  restaurantId: () => number;
  branchId: () => number | null;
  triggerSync: () => void;
  /** Wait briefly for the sync engine to drain. Used so an online customer
   *  create returns the server-assigned id rather than the local placeholder. */
  awaitDrain?: (timeoutMs?: number) => Promise<void>;
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;
  return true;
}

// ─── KV-backed caches (small / typed) ────────────────────────────────────
const RESTAURANT_INFO_KEY = (rid: number) => `restaurant_info:${rid}`;

function refreshInBackground(label: string, fn: () => Promise<unknown>): void {
  // Fire-and-forget background refresh. Failures are logged but never bubble
  // — the read already returned the cached value.
  void fn().catch((err) => {
    if (!isNetworkError(err)) console.warn(`[offline:${label}]`, (err as Error).message);
  });
}

// ─── Restaurant info ─────────────────────────────────────────────────────
export async function getRestaurantInfo(ctx: OfflineContext): Promise<RestaurantInfo> {
  const rid = ctx.restaurantId();
  const cached = kvGet(RESTAURANT_INFO_KEY(rid));
  if (cached) {
    if (ctx.isOnline()) {
      refreshInBackground("restaurant-info", async () => {
        const info = await ctx.client.getRestaurantInfo(rid);
        kvSet(RESTAURANT_INFO_KEY(rid), JSON.stringify(info));
      });
    }
    return JSON.parse(cached) as RestaurantInfo;
  }
  if (!ctx.isOnline()) throw new Error("Restaurant info unavailable offline — open online once to cache.");
  const info = await ctx.client.getRestaurantInfo(rid);
  kvSet(RESTAURANT_INFO_KEY(rid), JSON.stringify(info));
  return info;
}

// ─── Menu / tables / customers (local-first reads) ───────────────────────
export async function listMenuBundle(ctx: OfflineContext): Promise<{ categories: MenuCategory[]; items: MenuItem[] }> {
  const rid = ctx.restaurantId();
  const categories = Q.listCategories(rid);
  const items = Q.listMenuItems(rid);
  if (categories.length > 0 || items.length > 0) {
    if (ctx.isOnline()) {
      refreshInBackground("menu", async () => {
        const [c, i] = await Promise.all([
          ctx.client.listCategories(rid),
          ctx.client.listMenuItems(rid, {}),
        ]);
        Q.upsertCategories(rid, c);
        Q.upsertMenuItems(rid, i);
        kvSet(`menu:lastAt:${rid}`, String(Date.now()));
      });
    }
    return { categories, items };
  }
  if (!ctx.isOnline()) return { categories: [], items: [] };
  const [c, i] = await Promise.all([
    ctx.client.listCategories(rid),
    ctx.client.listMenuItems(rid, {}),
  ]);
  Q.upsertCategories(rid, c);
  Q.upsertMenuItems(rid, i);
  return { categories: c, items: i };
}

export async function listModifierGroups(ctx: OfflineContext, itemId: number): Promise<ModifierGroup[]> {
  const cached = Q.getModifierGroups(itemId);
  if (cached != null) {
    if (ctx.isOnline()) {
      refreshInBackground("modifiers", async () => {
        const g = await ctx.client.listItemModifierGroups(itemId);
        Q.upsertModifierGroups(itemId, g);
      });
    }
    return cached;
  }
  if (!ctx.isOnline()) return [];
  try {
    const g = await ctx.client.listItemModifierGroups(itemId);
    Q.upsertModifierGroups(itemId, g);
    return g;
  } catch { return []; }
}

export async function listTables(ctx: OfflineContext): Promise<FloorTable[]> {
  const rid = ctx.restaurantId();
  const cached = Q.listTables(rid);
  if (cached.length > 0) {
    if (ctx.isOnline()) {
      refreshInBackground("tables", async () => {
        const rows = await ctx.client.listTables(rid);
        Q.upsertTables(rid, rows);
      });
    }
    return cached;
  }
  if (!ctx.isOnline()) return [];
  const rows = await ctx.client.listTables(rid);
  Q.upsertTables(rid, rows);
  return rows;
}

export async function searchCustomers(ctx: OfflineContext, term: string, limit = 20): Promise<CustomerSummary[]> {
  const rid = ctx.restaurantId();
  const cached = Q.searchCustomers(rid, term, limit);
  if (ctx.isOnline()) {
    refreshInBackground("customers-search", async () => {
      const rows = await ctx.client.searchCustomers(rid, term, limit);
      Q.upsertCustomers(rid, rows);
    });
  }
  return cached;
}

export async function lookupCustomerByPhone(ctx: OfflineContext, phone: string): Promise<CustomerSummary[]> {
  const rid = ctx.restaurantId();
  const cached = Q.lookupCustomerByPhone(rid, phone);
  if (ctx.isOnline()) {
    refreshInBackground("customers-phone", async () => {
      try {
        const raw = await ctx.client.lookupCustomerByPhone(rid, phone) as unknown;
        const arr = Array.isArray(raw)
          ? (raw as CustomerSummary[])
          : Array.isArray((raw as { data?: CustomerSummary[] })?.data)
            ? (raw as { data: CustomerSummary[] }).data
            : [];
        Q.upsertCustomers(rid, arr);
      } catch { /* refresh failure ignored */ }
    });
  }
  return cached;
}

// ─── Customers — local-first create ───────────────────────────────────────
export async function createCustomer(
  ctx: OfflineContext,
  body: { name?: string; phone?: string; email?: string },
): Promise<CustomerSummary> {
  const rid = ctx.restaurantId();
  // Local-first: synth + enqueue + trigger sync. When online we briefly
  // await the drain so the caller can attach the *server* id to an order in
  // the very next click; offline we return the local placeholder.
  const localId = nextLocalId();
  const synth: CustomerSummary = {
    id: localId,
    name: body.name ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
  };
  Q.upsertCustomers(rid, [synth]);
  P.enqueue({
    kind: "customers:create",
    idempotencyKey: randomUUID(),
    payload: body,
    localCustomerId: localId,
  });
  ctx.triggerSync();
  if (ctx.isOnline() && ctx.awaitDrain) {
    try { await ctx.awaitDrain(3000); } catch { /* swallow */ }
    // After drain, the row id in our cache is replaced by the server id via
    // the engine's `upsertCustomers` call. Look it up by phone/name.
    if (body.phone) {
      const hit = Q.lookupCustomerByPhone(rid, body.phone).find((c) => c.id > 0);
      if (hit) return hit;
    }
  }
  return synth;
}

// ─── Orders — reads ───────────────────────────────────────────────────────
export async function listOrders(ctx: OfflineContext, status?: string, limit = 30): Promise<OrderHeader[]> {
  const rid = ctx.restaurantId();
  const cached = Q.listOrders(rid, status, limit);
  if (ctx.isOnline()) {
    refreshInBackground("orders-list", async () => {
      const rows = await ctx.client.listOrders(rid, { status, limit, branchId: ctx.branchId() });
      for (const h of rows) upsertOrderHeader(h, rid, ctx.branchId());
    });
  }
  return cached;
}

function upsertOrderHeader(h: OrderHeader, rid: number, branchId: number | null): void {
  const existing = getOrder(h.id);
  const detail: OrderDetailView = existing ?? { ...h, items: [], discounts: [] };
  upsertOrder({ ...detail, ...h }, { restaurantId: rid, branchId });
}

export async function getOrderDetail(ctx: OfflineContext, id: number): Promise<OrderDetailView> {
  const rid = ctx.restaurantId();
  const cached = getOrder(id);
  if (cached) {
    if (ctx.isOnline() && id > 0) {
      refreshInBackground("order-detail", async () => {
        const d = await ctx.client.getOrder(rid, id);
        upsertOrder(d, { restaurantId: rid, branchId: ctx.branchId() });
      });
    }
    return cached;
  }
  if (!ctx.isOnline()) throw new Error("Order not available offline.");
  if (id < 0) throw new Error("Local order not found in cache.");
  const d = await ctx.client.getOrder(rid, id);
  upsertOrder(d, { restaurantId: rid, branchId: ctx.branchId() });
  return d;
}

export async function getActiveTableOrderId(ctx: OfflineContext, tableId: number): Promise<number | null> {
  const rid = ctx.restaurantId();
  const cached = Q.getActiveOrderIdForTable(rid, tableId);
  // When the cache has a row we can return it immediately, but we still
  // *consume* the API result in the background and hydrate the local order
  // so a subsequent guard check sees fresh occupancy state. When the cache
  // is empty we await the live answer to avoid letting the cashier create a
  // duplicate order on an occupied table.
  if (cached != null) {
    if (ctx.isOnline()) {
      refreshInBackground("table-active", async () => {
        const id = await ctx.client.getTableActiveOrderId(rid, tableId);
        if (id != null) {
          try {
            const d = await ctx.client.getOrder(rid, id);
            upsertOrder(d, { restaurantId: rid, branchId: ctx.branchId() });
          } catch { /* swallow */ }
        }
      });
    }
    return cached;
  }
  if (!ctx.isOnline()) return null;
  const id = await ctx.client.getTableActiveOrderId(rid, tableId);
  if (id != null) {
    try {
      const d = await ctx.client.getOrder(rid, id);
      upsertOrder(d, { restaurantId: rid, branchId: ctx.branchId() });
    } catch { /* swallow */ }
  }
  return id;
}

// ─── Orders — local-first writes ─────────────────────────────────────────
function num(v: number | string | null | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

function priceLookup(restaurantId: number): Map<number, { name: string; price: number; kitchenId: number | null }> {
  const items = Q.listMenuItems(restaurantId);
  const map = new Map<number, { name: string; price: number; kitchenId: number | null }>();
  for (const it of items) {
    // `kitchenId` is not on the contract MenuItem type but the server
    // payload carries it. We preserve it on the offline line item so KOT
    // dispatch routes to the correct station even during an outage.
    const ki = (it as unknown as { kitchenId?: number | null }).kitchenId;
    map.set(it.id, { name: it.name, price: num(it.price), kitchenId: ki ?? null });
  }
  return map;
}

async function computeTotals(
  ctx: OfflineContext,
  items: CartItemInput[],
): Promise<{
  subtotal: number; taxAmount: number; serviceCharge: number; totalAmount: number;
  lineItems: Array<{ menuItemId: number; menuItemName: string; quantity: number; unitPrice: string; totalPrice: string; kitchenId: number | null; modifiers: Array<{ id: number; name: string; price: string; quantity: number }> }>;
}> {
  const info = await getRestaurantInfo(ctx);
  const prices = priceLookup(ctx.restaurantId());
  const taxRate = num(info.taxRate) / 100;
  const svcRate = num(info.serviceCharge) / 100;
  let subtotal = 0;
  const lineItems = items.map((it) => {
    const meta = prices.get(it.menuItemId) ?? { name: `Item #${it.menuItemId}`, price: 0, kitchenId: null };
    const modSum = (it.modifiers ?? []).reduce((acc, m) => acc + num(m.price) * (m.quantity ?? 1), 0);
    const unit = meta.price + modSum;
    const total = unit * (it.quantity ?? 1);
    subtotal += total;
    return {
      menuItemId: it.menuItemId,
      menuItemName: meta.name,
      quantity: it.quantity ?? 1,
      unitPrice: unit.toFixed(2),
      totalPrice: total.toFixed(2),
      kitchenId: meta.kitchenId,
      modifiers: (it.modifiers ?? []).map((m, idx) => ({
        id: -(idx + 1), name: m.name, price: m.price, quantity: m.quantity ?? 1,
      })),
    };
  });
  const taxAmount = +(subtotal * taxRate).toFixed(2);
  const serviceCharge = +(subtotal * svcRate).toFixed(2);
  const totalAmount = +(subtotal + taxAmount + serviceCharge).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), taxAmount, serviceCharge, totalAmount, lineItems };
}

export async function createOrder(ctx: OfflineContext, req: CreateOrderRequest): Promise<OrderDetailView> {
  const rid = ctx.restaurantId();
  // Local-first: always synth the order locally and enqueue. The sync engine
  // drains immediately when online, swapping the local id for the server id.
  const localId = nextLocalId();
  const { subtotal, taxAmount, serviceCharge, totalAmount, lineItems } = await computeTotals(ctx, req.items);
  const now = new Date().toISOString();
  const orderNumber = `L-${String(-localId).slice(-6)}`;
  const detail: OrderDetailView = {
    id: localId,
    restaurantId: rid,
    orderNumber,
    status: "pending",
    orderType: req.orderType,
    tableId: req.tableId ?? null,
    customerName: req.customerName ?? null,
    customerPhone: req.customerPhone ?? null,
    customerId: req.customerId ?? null,
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    serviceCharge: serviceCharge.toFixed(2),
    discountAmount: "0.00",
    totalAmount: totalAmount.toFixed(2),
    createdAt: now,
    isRunningOrder: true,
    isPriority: !!req.isPriority,
    notes: req.notes ?? null,
    paymentStatus: "pending",
    paymentMethod: null,
    paymentAmount: null,
    items: lineItems.map((li, idx) => ({
      id: -((idx + 1) * 1000 + Math.abs(localId % 1000)),
      orderId: localId,
      menuItemId: li.menuItemId,
      menuItemName: li.menuItemName,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      totalPrice: li.totalPrice,
      kitchenId: li.kitchenId,
      notes: null,
      modifiers: li.modifiers,
    })),
    discounts: [],
  };
  upsertOrder(detail, { restaurantId: rid, branchId: ctx.branchId(), localOnly: true, localId });
  const idem = req.idempotencyKey || randomUUID();
  // CRITICAL: if the caller attached a *local* customer id (negative), tag
  // the op so `remapLocalCustomerId` rewrites it once the customer sync
  // succeeds. Without this, the order replay sends a negative customerId
  // and the server returns 4xx, surfacing as a conflict.
  const localCustomerId = (req.customerId != null && req.customerId < 0) ? req.customerId : null;
  P.enqueue({
    kind: "orders:create",
    idempotencyKey: idem,
    payload: { ...req, idempotencyKey: idem, branchId: ctx.branchId() },
    localOrderId: localId,
    localCustomerId,
  });
  ctx.triggerSync();
  // Online: briefly wait so the renderer sees the server id on first read.
  if (ctx.isOnline() && ctx.awaitDrain) {
    try { await ctx.awaitDrain(2000); } catch { /* swallow */ }
    const updated = getOrder(localId);
    if (updated) return updated;
  }
  return detail;
}

export async function addOrderItems(
  ctx: OfflineContext,
  args: { orderId: number; items: CartItemInput[]; idempotencyKey?: string },
): Promise<OrderDetailView> {
  const rid = ctx.restaurantId();
  const existing = getOrder(args.orderId);
  if (!existing) throw new Error("Order not in local cache.");
  const totals = await computeTotals(ctx, args.items);
  const baseLast = existing.items.reduce((min, it) => Math.min(min, it.id), -1) - 1;
  const newItems = totals.lineItems.map((li, idx) => ({
    id: baseLast - idx,
    orderId: existing.id,
    menuItemId: li.menuItemId,
    menuItemName: li.menuItemName,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    totalPrice: li.totalPrice,
    kitchenId: li.kitchenId,
    notes: null,
    modifiers: li.modifiers,
  }));
  const merged: OrderDetailView = {
    ...existing,
    items: [...existing.items, ...newItems],
    subtotal: (num(existing.subtotal) + totals.subtotal).toFixed(2),
    taxAmount: (num(existing.taxAmount) + totals.taxAmount).toFixed(2),
    serviceCharge: (num(existing.serviceCharge) + totals.serviceCharge).toFixed(2),
    totalAmount: (num(existing.totalAmount) + totals.totalAmount).toFixed(2),
  };
  const localOnly = existing.id < 0;
  upsertOrder(merged, {
    restaurantId: rid, branchId: ctx.branchId(),
    localOnly, localId: localOnly ? existing.id : undefined,
  });
  const idem = args.idempotencyKey || randomUUID();
  P.enqueue({
    kind: "orders:add-items",
    idempotencyKey: idem,
    payload: { orderId: existing.id, items: args.items, idempotencyKey: idem },
    localOrderId: localOnly ? existing.id : null,
  });
  ctx.triggerSync();
  if (ctx.isOnline() && ctx.awaitDrain) {
    try { await ctx.awaitDrain(2000); } catch { /* swallow */ }
    const after = getOrder(existing.id);
    if (after) return after;
  }
  return merged;
}

export async function payOrder(
  ctx: OfflineContext,
  args: {
    orderId: number; paymentMethod: PayMethod; tipAmount?: number;
    stripePaymentIntentId?: string; razorpayPaymentId?: string;
    razorpayOrderId?: string; razorpaySignature?: string;
    idempotencyKey?: string;
  },
): Promise<OrderDetailView> {
  const rid = ctx.restaurantId();
  // Non-cash methods (`upi`, `card`) still require an online provider step
  // *before* this handler is reached (the renderer collects the
  // Stripe/Razorpay token first). But once we have the token, recording the
  // payment must be local-first like cash: write optimistic state, enqueue
  // the finalize op, and let the sync engine replay if the API call fails.
  // This way a late server hiccup never strands a paid order.
  if (args.paymentMethod !== "cash" && !ctx.isOnline()) {
    throw new Error(`Offline payments are limited to cash. ${args.paymentMethod} requires connection.`);
  }
  const existing = getOrder(args.orderId);
  if (!existing) throw new Error("Order not in local cache.");
  const total = num(existing.totalAmount);
  const updated: OrderDetailView = {
    ...existing,
    paymentStatus: "paid",
    paymentMethod: args.paymentMethod,
    paymentAmount: total.toFixed(2),
    status: "completed",
    isRunningOrder: false,
    tipAmount: args.tipAmount != null ? String(args.tipAmount) : existing.tipAmount,
  };
  const localOnly = existing.id < 0;
  upsertOrder(updated, {
    restaurantId: rid, branchId: ctx.branchId(),
    localOnly, localId: localOnly ? existing.id : undefined,
  });
  const idem = args.idempotencyKey || randomUUID();
  P.enqueue({
    kind: "orders:pay",
    idempotencyKey: idem,
    payload: {
      orderId: existing.id,
      paymentMethod: args.paymentMethod,
      tipAmount: args.tipAmount,
      stripePaymentIntentId: args.stripePaymentIntentId,
      razorpayPaymentId: args.razorpayPaymentId,
      razorpayOrderId: args.razorpayOrderId,
      razorpaySignature: args.razorpaySignature,
      idempotencyKey: idem,
    },
    localOrderId: localOnly ? existing.id : null,
  });
  ctx.triggerSync();
  if (ctx.isOnline() && ctx.awaitDrain) {
    try { await ctx.awaitDrain(2000); } catch { /* swallow */ }
    const after = getOrder(existing.id);
    if (after) return after;
  }
  return updated;
}

// ─── Sync status assembly ─────────────────────────────────────────────────
export function buildSyncStatus(
  online: boolean, draining: boolean, lastRunAt: number | null, lastError: string | null,
  ctx?: { restaurantId?: number | null },
): import("../../shared/ipc-contract").SyncStatusView {
  const pendings = P.listAll();
  const head = pendings.filter((p) => p.status !== "conflict").slice(0, 25).map((p) => ({
    id: p.id, kind: p.kind, status: p.status, attempts: p.attempts,
    createdAt: p.createdAt, summary: describeOp(p),
    lastError: p.lastError,
  }));
  const categories = P.countByCategory();
  // Held bills are a local-only park (never sent to backend). Surface
  // their count in the Sync Center "held_bills" bucket so the operator
  // sees the outstanding total alongside the real sync queue.
  const rid = ctx?.restaurantId ?? null;
  if (rid != null) {
    categories.held_bills = { pending: D.heldBillCount(rid), failed: 0, conflicts: 0 };
  }
  return {
    online, draining,
    pending: pendings.filter((p) => p.status !== "conflict").length,
    conflicts: pendings.filter((p) => p.status === "conflict").length,
    lastRunAt, lastError, queue: head,
    categories,
  };
}

function describeOp(p: P.PendingOp): string {
  const payload = p.payload as Record<string, unknown> | null;
  switch (p.kind) {
    case "orders:create":
      return `New order${p.localOrderId ? ` (local ${p.localOrderId})` : ""}`;
    case "orders:add-items":
      return `Add items to order #${(payload?.orderId as number | undefined) ?? "?"}`;
    case "orders:pay":
      return `Cash payment on order #${(payload?.orderId as number | undefined) ?? "?"}`;
    case "customers:create":
      return `New customer ${(payload?.name as string | undefined) ?? ""}`.trim();
    case "shift:cash-movement": {
      const kind = (payload?.kind as string | undefined) ?? "in/out";
      const amount = (payload?.amount as number | undefined) ?? 0;
      return `Cash ${kind} · ₹${amount}`;
    }
    case "shift:expense": {
      const amount = (payload?.amount as number | undefined) ?? 0;
      const reason = (payload?.reason as string | undefined) ?? "expense";
      return `Expense · ₹${amount} · ${reason}`;
    }
    case "stock:adjust": {
      const kind = (payload?.kind as string | undefined) ?? "adjust";
      const qty = (payload?.quantity as number | undefined) ?? 0;
      return `Stock ${kind} · ${qty}`;
    }
    case "prints:record":
      return `Print log · ${(payload?.kind as string | undefined) ?? ""}`.trim();
    case "audit:log":
      return `Audit · ${(payload?.action as string | undefined) ?? ""}`.trim();
    default:
      return p.kind;
  }
}
