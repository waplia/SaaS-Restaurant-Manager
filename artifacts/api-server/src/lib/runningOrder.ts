// Task #601 — Running order helpers.
//
// One dine-in "seating" at a table maps to one `table_sessions` row, which
// in turn holds a single running order. KOT rounds (kot_batches) accumulate
// against that order until the bill is generated and paid. These helpers
// centralise the read/write side-effects so the POS create-order, the QR
// public flow, and the add/modify/cancel-items endpoints all behave the
// same way.

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderItemsTable,
  tableSessionsTable,
  kotBatchesTable,
  kitchenTicketsTable,
  menuItemsTable,
  floorTablesTable,
  restaurantSettingsTable,
} from "./db";
import { resolveItemKitchenIds, getDefaultKitchenId } from "./kitchenRouting";
import { dispatchTicketsToDevices } from "./devices";

export type RunningOrderSettings = {
  /** Master switch — single bill per table when enabled. */
  enabled: boolean;
  /** When a new dine-in order is placed on an occupied table, auto-merge into the running bill instead of prompting / creating a new order. */
  autoMergeOnSameTable: boolean;
  /** Ask the cashier before merging (POS only). */
  askBeforeAdding: boolean;
  /** Allow cashier override to start a separate bill on the same table (party-split). */
  allowSeparateBill: boolean;
  /** Behaviour when items are added after the bill has already been generated. */
  afterBillBehavior: "block" | "allow" | "require_approval";
  /** Permit guests to add to a running bill via QR. */
  qrAddToRunningBill: boolean;
};

export const DEFAULT_RUNNING_ORDER_SETTINGS: RunningOrderSettings = {
  enabled: true,
  autoMergeOnSameTable: true,
  askBeforeAdding: true,
  // Separate-bill (party-split on the same table) is OFF by default —
  // restaurants almost always want one bill per occupied table; an owner
  // must explicitly opt in (and approve the per-attempt override).
  allowSeparateBill: false,
  afterBillBehavior: "require_approval",
  qrAddToRunningBill: true,
};

export async function loadRunningOrderSettings(restaurantId: number): Promise<RunningOrderSettings> {
  const [row] = await db
    .select({ data: restaurantSettingsTable.data })
    .from(restaurantSettingsTable)
    .where(
      and(
        eq(restaurantSettingsTable.restaurantId, restaurantId),
        eq(restaurantSettingsTable.section, "running-order"),
      ),
    );
  const data = (row?.data as Partial<RunningOrderSettings> | undefined) ?? {};
  return { ...DEFAULT_RUNNING_ORDER_SETTINGS, ...data };
}

export async function saveRunningOrderSettings(
  restaurantId: number,
  patch: Partial<RunningOrderSettings>,
  updatedBy: number | null,
): Promise<RunningOrderSettings> {
  const merged: RunningOrderSettings = { ...(await loadRunningOrderSettings(restaurantId)), ...patch };
  await db
    .insert(restaurantSettingsTable)
    .values({ restaurantId, section: "running-order", data: merged, updatedBy: updatedBy ?? undefined })
    .onConflictDoUpdate({
      target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
      set: { data: merged, updatedBy: updatedBy ?? undefined, updatedAt: new Date() },
    });
  return merged;
}

/**
 * Returns the open running order on a table, if any. We only consider
 * `dine_in` orders that are not yet paid or cancelled — the order is the
 * one growing against this seating until it's settled. Accepts an optional
 * tx so callers that need write-side coordination (open vs merge) can run
 * the lookup inside a row-locked transaction (see `withTableLock`).
 */
export async function getActiveRunningOrderForTable(
  restaurantId: number,
  tableId: number,
  tx: typeof db = db,
) {
  const [order] = await tx
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.restaurantId, restaurantId),
        eq(ordersTable.tableId, tableId),
        eq(ordersTable.orderType, "dine_in"),
        eq(ordersTable.isRunningOrder, true),
        ne(ordersTable.status, "cancelled"),
        ne(ordersTable.paymentStatus, "paid"),
      ),
    )
    .orderBy(desc(ordersTable.createdAt))
    .limit(1);
  return order ?? null;
}

/**
 * Serialises concurrent "open vs merge" decisions for a single table by
 * taking a PostgreSQL transaction-level advisory lock keyed on
 * (restaurantId, tableId). Without this, two simultaneous create-order
 * requests could both observe no active running order and each open a
 * second running order on the same table, violating the one-bill
 * invariant. The lock is released automatically when the tx commits.
 */
export async function withTableLock<T>(
  restaurantId: number,
  tableId: number,
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  return db.transaction(async tx => {
    // PostgreSQL ships two arities: `pg_advisory_xact_lock(int, int)` and
    // `pg_advisory_xact_lock(bigint)`. There is NO `(bigint, bigint)` overload,
    // so casting both args to bigint resolves to no function and throws. We
    // pack (restaurantId, tableId) into a single bigint key instead.
    await tx.execute(
      sql`select pg_advisory_xact_lock(((${restaurantId}::bigint << 32) | (${tableId}::bigint & 4294967295)))`,
    );
    return fn(tx as unknown as typeof db);
  });
}

export async function openTableSession(args: {
  restaurantId: number;
  branchId: number | null;
  tableId: number;
  waiterId?: number | null;
  customerId?: number | null;
  partySize?: number | null;
  notes?: string | null;
}) {
  const [session] = await db
    .insert(tableSessionsTable)
    .values({
      restaurantId: args.restaurantId,
      branchId: args.branchId ?? undefined,
      tableId: args.tableId,
      waiterId: args.waiterId ?? undefined,
      customerId: args.customerId ?? undefined,
      partySize: args.partySize ?? undefined,
      notes: args.notes ?? undefined,
      status: "open",
    })
    .returning();
  return session;
}

export async function closeTableSession(sessionId: number, opts: { status?: "paid" | "closed" | "cancelled" } = {}) {
  const now = new Date();
  await db
    .update(tableSessionsTable)
    .set({
      status: opts.status ?? "closed",
      paidAt: opts.status === "paid" ? now : undefined,
      closedAt: now,
      updatedAt: now,
    })
    .where(eq(tableSessionsTable.id, sessionId));
}

/**
 * Fire a fresh KOT batch for the supplied order_items. Creates one
 * kitchen ticket per distinct kitchen the items belong to, tagged with the
 * batch id (via the order_items.kot_batch_id back-reference and the
 * batch's item snapshot). For `created_for === "cancelled"` we record the
 * batch so the kitchen screen/printer can show "VOID" on already-fired
 * items without producing a new prep ticket.
 */
export async function createKotBatchForItems(args: {
  restaurantId: number;
  orderId: number;
  tableSessionId: number | null;
  createdFor: "new" | "modified" | "cancelled";
  source: "pos" | "qr" | "manager" | "system";
  firedByUserId?: number | null;
  /** Order-item ids that participate in this batch. Required for new/modified rounds; for cancelled rounds these are the items being voided. */
  orderItemIds: number[];
  /** Optional override of round number (otherwise auto-incremented per order). */
  roundNumber?: number;
  isPriority?: boolean;
  notes?: string | null;
}) {
  const { restaurantId, orderId, tableSessionId, createdFor, source, firedByUserId, orderItemIds, isPriority, notes } = args;

  // Compute next round number per-order. Wrap in an advisory lock keyed on
  // the order id so two concurrent add/cancel requests can't both grab the
  // same max(round_number)+1 (would otherwise violate the per-order round
  // sequence the kitchen relies on).
  let roundNumber = args.roundNumber;
  if (!roundNumber) {
    roundNumber = await db.transaction(async tx => {
      // See note in withTableLock — pack two ints into one bigint key because
      // pg_advisory_xact_lock has no (bigint, bigint) overload.
      await tx.execute(
        sql`select pg_advisory_xact_lock(((${restaurantId}::bigint << 32) | (${orderId}::bigint & 4294967295)))`,
      );
      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${kotBatchesTable.roundNumber}), 0)` })
        .from(kotBatchesTable)
        .where(eq(kotBatchesTable.orderId, orderId));
      return Number(max ?? 0) + 1;
    });
  }

  // Snapshot for audit + kitchen display
  const items = orderItemIds.length === 0
    ? []
    : await db
        .select({
          id: orderItemsTable.id,
          menuItemId: orderItemsTable.menuItemId,
          menuItemName: orderItemsTable.menuItemName,
          quantity: orderItemsTable.quantity,
          notes: orderItemsTable.notes,
        })
        .from(orderItemsTable)
        .where(inArray(orderItemsTable.id, orderItemIds));

  const snapshot = items.map(i => ({
    orderItemId: i.id,
    menuItemId: i.menuItemId,
    menuItemName: i.menuItemName,
    quantity: i.quantity,
    notes: i.notes,
    action: createdFor,
  }));

  const [batch] = await db
    .insert(kotBatchesTable)
    .values({
      restaurantId,
      orderId,
      tableSessionId: tableSessionId ?? undefined,
      roundNumber,
      createdFor,
      status: createdFor === "cancelled" ? "cancelled" : "fired",
      firedByUserId: firedByUserId ?? undefined,
      source,
      notes: notes ?? undefined,
      itemSnapshot: snapshot,
    })
    .returning();

  // Tag the order_items with the batch id so the order detail can render the
  // KOT-by-KOT timeline.
  if (orderItemIds.length > 0) {
    await db
      .update(orderItemsTable)
      .set({ kotBatchId: batch.id, addedRoundNumber: roundNumber })
      .where(inArray(orderItemsTable.id, orderItemIds));
  }

  // Group items by kitchen and emit one ticket per kitchen for this round.
  // Cancelled rounds *also* produce a kitchen ticket (status=cancelled) so
  // every kitchen that originally received the item gets a VOID notification
  // — operationally a cancelled round must be visible at the printer/KDS,
  // not only persisted in `kot_batches`.
  const uniqueMenuItemIds = Array.from(new Set(items.map(i => i.menuItemId)));
  const kitchenMap = await resolveItemKitchenIds(restaurantId, uniqueMenuItemIds);
  const defaultKitchenId = await getDefaultKitchenId(restaurantId);

  const menuRows = uniqueMenuItemIds.length > 0
    ? await db
        .select({ id: menuItemsTable.id, preparationTime: menuItemsTable.preparationTime })
        .from(menuItemsTable)
        .where(inArray(menuItemsTable.id, uniqueMenuItemIds))
    : [];
  const prepById = new Map(menuRows.map(m => [m.id, m.preparationTime ?? 15] as const));

  const itemsByKitchen = new Map<number, number[]>();
  for (const it of items) {
    const kid = kitchenMap.get(it.menuItemId) ?? defaultKitchenId;
    const prep = prepById.get(it.menuItemId) ?? 15;
    const arr = itemsByKitchen.get(kid) ?? [];
    arr.push(prep);
    itemsByKitchen.set(kid, arr);
  }
  if (itemsByKitchen.size === 0) itemsByKitchen.set(defaultKitchenId, [15]);

  const now = new Date();
  const created: Array<{ ticketId: number; kitchenId: number }> = [];
  for (const [kid, preps] of itemsByKitchen) {
    const expectedPrepMinutes = Math.max(...preps, 1);
    const expectedReadyAt = new Date(now.getTime() + expectedPrepMinutes * 60_000);
    const [t] = await db
      .insert(kitchenTicketsTable)
      .values({
        orderId,
        restaurantId,
        kitchenId: kid,
        isPriority: isPriority ?? false,
        expectedPrepMinutes,
        expectedReadyAt,
        // Status must align with the KDS frontend filter (`new` | `preparing`
        // | `ready`). Using "pending" here meant every QR dine-in KOT was
        // invisible on the kitchen display even though the ticket row existed.
        status: createdFor === "cancelled" ? "cancelled" : "new",
      })
      .returning();
    created.push({ ticketId: t.id, kitchenId: kid });
  }

  if (created.length > 0) {
    try {
      await dispatchTicketsToDevices({ restaurantId, orderId, tickets: created });
    } catch (err) {
      console.error("[devices] kot-batch dispatch error", err);
    }
  }

  return { batch, tickets: created };
}

/**
 * Helper used by the order-detail GET to summarise totals while ignoring
 * cancelled items (which remain in the table for audit but should not bill
 * the guest).
 */
export function summariseLiveItems(items: Array<{ status: string; totalPrice: string | number }>) {
  let billable = 0;
  let cancelled = 0;
  for (const i of items) {
    const amt = Number(i.totalPrice ?? 0);
    if (i.status === "cancelled") cancelled += amt;
    else billable += amt;
  }
  return { billable, cancelled };
}

/**
 * Free a table only when no other non-paid running order still exists on it.
 * Critical for party-split scenarios where one of two parallel bills was
 * paid first — the table must stay occupied until every bill clears.
 * Accepts an optional tx so it can participate in the payment transaction.
 */
export async function freeTableIfIdle(
  restaurantId: number,
  tableId: number,
  tx: typeof db = db,
) {
  const open = await getActiveRunningOrderForTable(restaurantId, tableId, tx);
  if (open) return;
  await tx
    .update(floorTablesTable)
    .set({ status: "free", updatedAt: new Date() })
    .where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId)));
}
