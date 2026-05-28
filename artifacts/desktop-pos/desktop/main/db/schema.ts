/**
 * SQLite schema + migrations for the offline cache.
 *
 * Each migration is an idempotent SQL block that runs inside a transaction;
 * the runner records applied versions in `_migrations`. Bump the array to
 * extend the schema — never edit existing entries.
 */

import type DatabaseT from "better-sqlite3";

type Database = DatabaseT.Database;

export interface Migration { version: number; name: string; sql: string }

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );

      -- Generic key/value store (hydrate timestamps, restaurant scope, etc.)
      CREATE TABLE IF NOT EXISTS kv (
        k TEXT PRIMARY KEY,
        v TEXT
      );

      -- Reference data cached from the API for offline reads. payload is
      -- the original JSON returned by the API so we can render the workspace
      -- without a network round-trip.
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER NOT NULL,
        restaurant_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (restaurant_id, id)
      );

      CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER NOT NULL,
        restaurant_id INTEGER NOT NULL,
        category_id INTEGER,
        name TEXT NOT NULL,
        is_available INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (restaurant_id, id)
      );

      CREATE TABLE IF NOT EXISTS tables (
        id INTEGER NOT NULL,
        restaurant_id INTEGER NOT NULL,
        status TEXT,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (restaurant_id, id)
      );

      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER NOT NULL,
        restaurant_id INTEGER NOT NULL,
        phone TEXT,
        name TEXT,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (restaurant_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(restaurant_id, phone);

      -- Orders & items. id may be negative (local-only) until server assigns.
      -- server_id is non-null once a sync round successfully maps it.
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY,
        server_id INTEGER UNIQUE,
        restaurant_id INTEGER NOT NULL,
        branch_id INTEGER,
        order_number TEXT NOT NULL,
        status TEXT NOT NULL,
        payment_status TEXT,
        payment_method TEXT,
        order_type TEXT NOT NULL,
        table_id INTEGER,
        customer_id INTEGER,
        local_only INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders(restaurant_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(restaurant_id, table_id, status);

      -- Pending operations queue. Oldest first; the engine drains
      -- sequentially so dependent ops (add-items, pay) wait for create.
      CREATE TABLE IF NOT EXISTS pending_operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,                 -- "orders:create" | "orders:add-items" | "orders:pay" | "customers:create"
        local_order_id INTEGER,             -- back-reference for ID remap (negative ids)
        local_customer_id INTEGER,          -- back-reference for new customers
        idempotency_key TEXT NOT NULL,
        payload TEXT NOT NULL,              -- JSON request body
        depends_on INTEGER,                 -- pending_operations.id of prerequisite
        status TEXT NOT NULL DEFAULT 'pending', -- pending|in-flight|failed|conflict
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_attempt_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_operations(status, created_at);

      -- Conflicts captured when the server rejects a sync op (409, validation,
      -- 86'd item, etc.). The renderer surfaces these in a tray; user resolves
      -- via discard or manual edit.
      CREATE TABLE IF NOT EXISTS conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        op_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT,
        captured_at INTEGER NOT NULL,
        FOREIGN KEY (op_id) REFERENCES pending_operations(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 2,
    name: "reference_entities_and_sync_log",
    sql: `
      -- First-class tables for the remaining reference entities the cashier
      -- needs offline. Each row stores its JSON payload so the read paths can
      -- return contract-shaped objects without per-entity column mapping.
      CREATE TABLE IF NOT EXISTS settings (
        restaurant_id INTEGER PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS terminals (
        id INTEGER NOT NULL,
        restaurant_id INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (restaurant_id, id)
      );
      CREATE TABLE IF NOT EXISTS kitchens (
        id INTEGER NOT NULL,
        restaurant_id INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (restaurant_id, id)
      );
      CREATE TABLE IF NOT EXISTS discount_rules (
        id INTEGER NOT NULL,
        restaurant_id INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (restaurant_id, id)
      );
      CREATE TABLE IF NOT EXISTS modifier_groups (
        item_id INTEGER PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      -- Append-only audit trail for sync activity. The renderer's SyncPanel
      -- can join against this for a "recent activity" tab; for now it gives
      -- operators a paper trail after a flaky network episode.
      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        op_id INTEGER,
        outcome TEXT NOT NULL,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sync_log_at ON sync_log(at DESC);
      -- Z-report cache so a shift summary can be reprinted offline.
      CREATE TABLE IF NOT EXISTS z_reports (
        session_id INTEGER PRIMARY KEY,
        restaurant_id INTEGER NOT NULL,
        captured_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: "shift_actions_expenses_stock_audit_held_bills",
    sql: `
      -- Held bills (parked carts). Originally renderer-only via localStorage;
      -- the cache promotes them to first-class so they survive a renderer
      -- reload, can be inspected from the Sync Center, and are scoped by
      -- restaurant/branch/counter for multi-terminal stores.
      CREATE TABLE IF NOT EXISTS held_bills (
        id TEXT PRIMARY KEY,
        restaurant_id INTEGER NOT NULL,
        branch_id INTEGER,
        counter_id TEXT,
        label TEXT NOT NULL,
        cashier TEXT,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_held_bills_scope
        ON held_bills(restaurant_id, branch_id, created_at DESC);

      -- Cash movements (cash in / cash out). Same row shape as expenses but
      -- separated so the shift summary can total them independently.
      CREATE TABLE IF NOT EXISTS cash_movements (
        id TEXT PRIMARY KEY,
        restaurant_id INTEGER NOT NULL,
        branch_id INTEGER,
        session_id INTEGER,
        kind TEXT NOT NULL,           -- 'in' | 'out'
        amount REAL NOT NULL,
        reason TEXT,
        cashier TEXT,
        at INTEGER NOT NULL,
        synced_at INTEGER,            -- non-null once the server accepted
        server_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_cash_movements_at
        ON cash_movements(restaurant_id, at DESC);

      -- Expenses (petty cash). Kept separate from cash_movements so the
      -- expense report can roll up by category without filtering.
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        restaurant_id INTEGER NOT NULL,
        branch_id INTEGER,
        session_id INTEGER,
        category TEXT,
        amount REAL NOT NULL,
        reason TEXT,
        cashier TEXT,
        at INTEGER NOT NULL,
        synced_at INTEGER,
        server_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_expenses_at
        ON expenses(restaurant_id, at DESC);

      -- Stock adjustments / wastage / spoilage. Recorded locally during a
      -- shift; replayed when the server is reachable. Conflict resolution
      -- preserves the local entry so reconciliation never loses paper trail.
      CREATE TABLE IF NOT EXISTS stock_actions (
        id TEXT PRIMARY KEY,
        restaurant_id INTEGER NOT NULL,
        branch_id INTEGER,
        menu_item_id INTEGER,
        ingredient_id INTEGER,
        kind TEXT NOT NULL,           -- 'adjust' | 'waste' | 'transfer' | 'spoil'
        quantity REAL NOT NULL,
        unit TEXT,
        reason TEXT,
        cashier TEXT,
        at INTEGER NOT NULL,
        synced_at INTEGER,
        server_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_stock_actions_at
        ON stock_actions(restaurant_id, at DESC);

      -- Audit log of every cashier-significant action. Append-only; never
      -- updated after insert. Used by the Sync Center "view logs" tab and
      -- the renderer-side feedback loop for managers.
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor TEXT,
        action TEXT NOT NULL,
        target TEXT,
        details TEXT,
        synced_at INTEGER,
        server_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at DESC);

      -- Print job journal. The hardware layer already keeps a failed-prints
      -- list; this table records every dispatched job (success or not) so
      -- the Sync Center can show counts per category and the operator can
      -- re-trigger replays without leaving the panel.
      CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,           -- 'kot' | 'bill' | 'z_report'
        order_id INTEGER,
        printer_name TEXT,
        status TEXT NOT NULL,         -- 'queued' | 'sent' | 'failed'
        at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        payload TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_print_jobs_at ON print_jobs(at DESC);
    `,
  },
];

export function runMigrations(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);`);
  const applied = new Set<number>(
    (db.prepare(`SELECT version FROM _migrations`).all() as Array<{ version: number }>).map((r) => r.version),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const txn = db.transaction(() => {
      db.exec(m.sql);
      db.prepare(`INSERT INTO _migrations(version, name, applied_at) VALUES (?, ?, ?)`)
        .run(m.version, m.name, Date.now());
    });
    txn();
  }
}
