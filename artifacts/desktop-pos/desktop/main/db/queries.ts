/**
 * Typed query helpers around the offline cache.
 *
 * All reads return JSON-parsed payloads matching the IPC contract types so
 * the renderer doesn't know whether the data came from API or SQLite.
 */

import { getDb } from "./index";
import type {
  MenuCategory, MenuItem, FloorTable, CustomerSummary, OrderDetailView,
  OrderHeader,
} from "../../shared/ipc-contract";

interface Row { payload: string }

function parsePayload<T>(row: Row | undefined): T | null {
  if (!row) return null;
  try { return JSON.parse(row.payload) as T; } catch { return null; }
}

// ─── KV ────────────────────────────────────────────────────────────────────
export function kvGet(k: string): string | null {
  const r = getDb().prepare(`SELECT v FROM kv WHERE k=?`).get(k) as { v: string } | undefined;
  return r?.v ?? null;
}
export function kvSet(k: string, v: string): void {
  getDb().prepare(`INSERT OR REPLACE INTO kv(k, v) VALUES (?, ?)`).run(k, v);
}

// ─── Reference data upserts ────────────────────────────────────────────────
export function upsertCategories(restaurantId: number, rows: MenuCategory[]): void {
  const now = Date.now();
  const stmt = getDb().prepare(
    `INSERT OR REPLACE INTO categories(id, restaurant_id, name, sort_order, updated_at, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const txn = getDb().transaction((list: MenuCategory[]) => {
    for (const c of list) {
      stmt.run(c.id, restaurantId, c.name, c.sortOrder ?? null, now, JSON.stringify(c));
    }
  });
  txn(rows);
}

export function upsertMenuItems(restaurantId: number, rows: MenuItem[]): void {
  const now = Date.now();
  const stmt = getDb().prepare(
    `INSERT OR REPLACE INTO menu_items(id, restaurant_id, category_id, name, is_available, updated_at, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const txn = getDb().transaction((list: MenuItem[]) => {
    for (const it of list) {
      stmt.run(
        it.id, restaurantId, it.categoryId ?? null, it.name,
        it.isAvailable === false ? 0 : 1, now, JSON.stringify(it),
      );
    }
  });
  txn(rows);
}

export function upsertTables(restaurantId: number, rows: FloorTable[]): void {
  const now = Date.now();
  const stmt = getDb().prepare(
    `INSERT OR REPLACE INTO tables(id, restaurant_id, status, updated_at, payload)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const txn = getDb().transaction((list: FloorTable[]) => {
    for (const t of list) stmt.run(t.id, restaurantId, t.status ?? null, now, JSON.stringify(t));
  });
  txn(rows);
}

export function upsertCustomers(restaurantId: number, rows: CustomerSummary[]): void {
  const now = Date.now();
  const stmt = getDb().prepare(
    `INSERT OR REPLACE INTO customers(id, restaurant_id, phone, name, updated_at, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const txn = getDb().transaction((list: CustomerSummary[]) => {
    for (const c of list) stmt.run(c.id, restaurantId, c.phone ?? null, c.name ?? null, now, JSON.stringify(c));
  });
  txn(rows);
}

// ─── Reads ─────────────────────────────────────────────────────────────────
export function listCategories(restaurantId: number): MenuCategory[] {
  const rows = getDb().prepare(`SELECT payload FROM categories WHERE restaurant_id=? ORDER BY COALESCE(sort_order, 9999), name`).all(restaurantId) as Row[];
  return rows.map((r) => JSON.parse(r.payload) as MenuCategory);
}

export function listMenuItems(restaurantId: number): MenuItem[] {
  const rows = getDb().prepare(`SELECT payload FROM menu_items WHERE restaurant_id=? ORDER BY name`).all(restaurantId) as Row[];
  return rows.map((r) => JSON.parse(r.payload) as MenuItem);
}

export function listTables(restaurantId: number): FloorTable[] {
  const rows = getDb().prepare(`SELECT payload FROM tables WHERE restaurant_id=? ORDER BY id`).all(restaurantId) as Row[];
  return rows.map((r) => JSON.parse(r.payload) as FloorTable);
}

export function searchCustomers(restaurantId: number, term: string, limit = 20): CustomerSummary[] {
  const q = `%${term.toLowerCase()}%`;
  const rows = getDb().prepare(
    `SELECT payload FROM customers WHERE restaurant_id=? AND
     (LOWER(COALESCE(name,'')) LIKE ? OR COALESCE(phone,'') LIKE ?)
     LIMIT ?`,
  ).all(restaurantId, q, q, limit) as Row[];
  return rows.map((r) => JSON.parse(r.payload) as CustomerSummary);
}

export function lookupCustomerByPhone(restaurantId: number, phone: string): CustomerSummary[] {
  const rows = getDb().prepare(`SELECT payload FROM customers WHERE restaurant_id=? AND phone=? LIMIT 5`)
    .all(restaurantId, phone) as Row[];
  return rows.map((r) => JSON.parse(r.payload) as CustomerSummary);
}

/**
 * Drop a customer row from the local cache by primary key. Used by the sync
 * engine after a `customers:create` succeeds — the local negative-ID row is
 * stale and the canonical server row has already been upserted, so leaving
 * the negative row in place would let cashier searches return a phantom
 * customer and deadlock the queue with an orphan `customerId<0` reference.
 */
export function deleteCustomerById(id: number): void {
  getDb().prepare(`DELETE FROM customers WHERE id=?`).run(id);
}

// ─── Orders ────────────────────────────────────────────────────────────────
export function upsertOrder(o: OrderDetailView, opts: { restaurantId: number; localOnly?: boolean; localId?: number; branchId?: number | null }): void {
  const now = Date.now();
  const id = opts.localId ?? o.id;
  // Server-confirmed orders carry the canonical id in `server_id` and clear
  // the local-only flag so reads always see a single row per logical order.
  getDb().prepare(
    `INSERT OR REPLACE INTO orders
     (id, server_id, restaurant_id, branch_id, order_number, status, payment_status, payment_method,
      order_type, table_id, customer_id, local_only, updated_at, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.localOnly ? null : o.id,
    opts.restaurantId,
    opts.branchId ?? null,
    o.orderNumber,
    o.status,
    o.paymentStatus ?? null,
    o.paymentMethod ?? null,
    o.orderType,
    o.tableId ?? null,
    o.customerId ?? null,
    opts.localOnly ? 1 : 0,
    now,
    JSON.stringify(o),
  );
}

export function getOrder(idOrServerId: number): OrderDetailView | null {
  const row = getDb().prepare(
    `SELECT payload FROM orders WHERE id=? OR server_id=? LIMIT 1`,
  ).get(idOrServerId, idOrServerId) as Row | undefined;
  return parsePayload<OrderDetailView>(row);
}

export function listOrders(restaurantId: number, status?: string, limit = 50): OrderHeader[] {
  const args: unknown[] = [restaurantId];
  let where = `restaurant_id=?`;
  if (status) { where += ` AND status=?`; args.push(status); }
  args.push(limit);
  const rows = getDb().prepare(
    `SELECT payload FROM orders WHERE ${where} ORDER BY updated_at DESC LIMIT ?`,
  ).all(...args) as Row[];
  return rows.map((r) => JSON.parse(r.payload) as OrderHeader);
}

export function getActiveOrderIdForTable(restaurantId: number, tableId: number): number | null {
  const r = getDb().prepare(
    `SELECT id, server_id FROM orders WHERE restaurant_id=? AND table_id=?
     AND status IN ('pending','confirmed','preparing','ready','in_progress','running')
     ORDER BY updated_at DESC LIMIT 1`,
  ).get(restaurantId, tableId) as { id: number; server_id: number | null } | undefined;
  if (!r) return null;
  return r.server_id ?? r.id;
}

export function remapOrderId(localId: number, serverOrder: OrderDetailView, restaurantId: number, branchId: number | null): void {
  const now = Date.now();
  const txn = getDb().transaction(() => {
    // KEY DECISION: we keep the *local* negative id as the row's primary key
    // and only attach the server id via `server_id`. This way the renderer
    // (which may already be holding the local id in memory from an earlier
    // create call) can still resolve the order via `getOrder(localId)`,
    // while fresh reads using the canonical id go through the `server_id=?`
    // branch. The payload itself is rewritten to expose the server id so
    // subsequent writes enqueue with the canonical id.
    //
    // If a row at server_id already exists (e.g. a hydrate raced ahead),
    // drop it so we don't trip the UNIQUE(server_id) constraint, then merge
    // the canonical payload onto the local row.
    getDb().prepare(`DELETE FROM orders WHERE server_id=? AND id<>?`).run(serverOrder.id, localId);
    getDb().prepare(
      `INSERT OR REPLACE INTO orders
       (id, server_id, restaurant_id, branch_id, order_number, status, payment_status, payment_method,
        order_type, table_id, customer_id, local_only, updated_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      localId, serverOrder.id, restaurantId, branchId,
      serverOrder.orderNumber, serverOrder.status, serverOrder.paymentStatus ?? null,
      serverOrder.paymentMethod ?? null, serverOrder.orderType,
      serverOrder.tableId ?? null, serverOrder.customerId ?? null, now,
      JSON.stringify(serverOrder),
    );
  });
  txn();
}

// ─── Reset / counts ────────────────────────────────────────────────────────
export function countAll(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of [
    "categories", "menu_items", "tables", "customers", "orders",
    "pending_operations", "conflicts",
    "settings", "terminals", "kitchens", "discount_rules", "modifier_groups",
    "sync_log", "z_reports",
  ]) {
    const r = getDb().prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number };
    out[t] = r.c;
  }
  return out;
}

// ─── First-class reference entities (v2 migration) ────────────────────────
export function upsertSettings(restaurantId: number, payload: unknown): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO settings(restaurant_id, updated_at, payload) VALUES (?, ?, ?)`,
  ).run(restaurantId, Date.now(), JSON.stringify(payload));
}

export function getSettings<T = unknown>(restaurantId: number): T | null {
  const r = getDb().prepare(`SELECT payload FROM settings WHERE restaurant_id=?`).get(restaurantId) as Row | undefined;
  return parsePayload<T>(r);
}

export function upsertTerminals(restaurantId: number, rows: Array<{ id: number }>): void {
  const stmt = getDb().prepare(
    `INSERT OR REPLACE INTO terminals(id, restaurant_id, updated_at, payload) VALUES (?, ?, ?, ?)`,
  );
  const txn = getDb().transaction((list: Array<{ id: number }>) => {
    for (const t of list) stmt.run(t.id, restaurantId, Date.now(), JSON.stringify(t));
  });
  txn(rows);
}

export function upsertDiscountRules(restaurantId: number, rows: Array<{ id?: number }>): void {
  const stmt = getDb().prepare(
    `INSERT OR REPLACE INTO discount_rules(id, restaurant_id, updated_at, payload) VALUES (?, ?, ?, ?)`,
  );
  const txn = getDb().transaction((list: Array<{ id?: number }>) => {
    for (const r of list) {
      if (typeof r.id !== "number") continue;
      stmt.run(r.id, restaurantId, Date.now(), JSON.stringify(r));
    }
  });
  txn(rows);
}

export function upsertKitchensFromItems(restaurantId: number, items: MenuItem[]): void {
  const stmt = getDb().prepare(
    `INSERT OR REPLACE INTO kitchens(id, restaurant_id, updated_at, payload) VALUES (?, ?, ?, ?)`,
  );
  const seen = new Map<number, { id: number; itemCount: number }>();
  for (const it of items) {
    const ki = (it as unknown as { kitchenId?: number | null }).kitchenId;
    if (typeof ki !== "number") continue;
    const entry = seen.get(ki) ?? { id: ki, itemCount: 0 };
    entry.itemCount += 1;
    seen.set(ki, entry);
  }
  const txn = getDb().transaction(() => {
    for (const k of seen.values()) {
      stmt.run(k.id, restaurantId, Date.now(), JSON.stringify(k));
    }
  });
  txn();
}

// ─── Modifier groups (v2 migration) ───────────────────────────────────────
// Stored per menu item so the offline order builder can pull spice levels,
// add-ons, etc. without an API round-trip. Empty arrays are persisted too —
// they mean "we checked and this item has no modifiers", which lets the
// renderer skip the modal entirely while offline.
export function upsertModifierGroups(itemId: number, groups: import("../../shared/ipc-contract").ModifierGroup[]): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO modifier_groups(item_id, updated_at, payload) VALUES (?, ?, ?)`,
  ).run(itemId, Date.now(), JSON.stringify(groups));
}

export function getModifierGroups(itemId: number): import("../../shared/ipc-contract").ModifierGroup[] | null {
  const r = getDb().prepare(`SELECT payload FROM modifier_groups WHERE item_id=?`).get(itemId) as Row | undefined;
  if (!r) return null;
  try { return JSON.parse(r.payload) as import("../../shared/ipc-contract").ModifierGroup[]; }
  catch { return null; }
}

export function nextLocalId(): number {
  // Local-only IDs are large negatives to avoid colliding with server ids.
  // We keep a monotonic counter in kv so retries land on the same row.
  const cur = Number(kvGet("local_id_counter") ?? "0");
  const next = cur + 1;
  kvSet("local_id_counter", String(next));
  return -1_000_000 - next;
}
