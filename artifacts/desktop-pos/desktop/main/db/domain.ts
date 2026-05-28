/**
 * Queries for the v3 domain tables:
 *   • held_bills, cash_movements, expenses, stock_actions
 *   • audit_log, sync_log, print_jobs
 *
 * Each table is local-first: the renderer/IPC layer writes immediately, the
 * sync engine drains the matching pending op when the server is reachable,
 * and `markSynced` flips the row to "synced" once the server acknowledges.
 */

import { getDb } from "./index";

// ─── Held bills ───────────────────────────────────────────────────────────
export interface HeldBillRow {
  id: string;
  restaurantId: number;
  branchId: number | null;
  counterId: string | null;
  label: string;
  cashier: string | null;
  createdAt: number;
  payload: unknown;
}

interface RawHeldBillRow {
  id: string; restaurant_id: number; branch_id: number | null;
  counter_id: string | null; label: string; cashier: string | null;
  created_at: number; payload: string;
}

function toHeldBill(r: RawHeldBillRow): HeldBillRow {
  let payload: unknown = null;
  try { payload = JSON.parse(r.payload); } catch { /* keep null */ }
  return {
    id: r.id, restaurantId: r.restaurant_id, branchId: r.branch_id,
    counterId: r.counter_id, label: r.label, cashier: r.cashier,
    createdAt: r.created_at, payload,
  };
}

export function upsertHeldBill(bill: HeldBillRow): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO held_bills
       (id, restaurant_id, branch_id, counter_id, label, cashier, created_at, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    bill.id, bill.restaurantId, bill.branchId, bill.counterId,
    bill.label, bill.cashier, bill.createdAt, JSON.stringify(bill.payload),
  );
}

export function listHeldBills(restaurantId: number, branchId: number | null): HeldBillRow[] {
  // Scope by restaurant; if a branch is selected we filter (NULL branch rows
  // are considered shared across branches in the same restaurant).
  const rows = getDb().prepare(
    `SELECT * FROM held_bills
     WHERE restaurant_id=? AND (branch_id IS NULL OR ?=branch_id OR ? IS NULL)
     ORDER BY created_at DESC`,
  ).all(restaurantId, branchId, branchId) as RawHeldBillRow[];
  return rows.map(toHeldBill);
}

export function removeHeldBill(id: string): void {
  getDb().prepare(`DELETE FROM held_bills WHERE id=?`).run(id);
}

export function clearHeldBills(restaurantId: number): void {
  getDb().prepare(`DELETE FROM held_bills WHERE restaurant_id=?`).run(restaurantId);
}

export function heldBillCount(restaurantId: number): number {
  const r = getDb().prepare(
    `SELECT COUNT(*) AS c FROM held_bills WHERE restaurant_id=?`,
  ).get(restaurantId) as { c: number };
  return r.c;
}

// ─── Cash movements ───────────────────────────────────────────────────────
export interface CashMovementRow {
  id: string; restaurantId: number; branchId: number | null;
  sessionId: number | null;
  kind: "in" | "out"; amount: number; reason: string | null;
  cashier: string | null; at: number;
  syncedAt: number | null; serverId: number | null;
}

interface RawCashRow {
  id: string; restaurant_id: number; branch_id: number | null;
  session_id: number | null; kind: string; amount: number;
  reason: string | null; cashier: string | null; at: number;
  synced_at: number | null; server_id: number | null;
}

function toCash(r: RawCashRow): CashMovementRow {
  return {
    id: r.id, restaurantId: r.restaurant_id, branchId: r.branch_id,
    sessionId: r.session_id, kind: r.kind as "in" | "out",
    amount: r.amount, reason: r.reason, cashier: r.cashier, at: r.at,
    syncedAt: r.synced_at, serverId: r.server_id,
  };
}

export function insertCashMovement(row: Omit<CashMovementRow, "syncedAt" | "serverId">): CashMovementRow {
  getDb().prepare(
    `INSERT OR REPLACE INTO cash_movements
       (id, restaurant_id, branch_id, session_id, kind, amount, reason, cashier, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.restaurantId, row.branchId, row.sessionId, row.kind, row.amount, row.reason, row.cashier, row.at);
  return { ...row, syncedAt: null, serverId: null };
}

export function markCashSynced(id: string, serverId: number | null): void {
  getDb().prepare(
    `UPDATE cash_movements SET synced_at=?, server_id=COALESCE(?, server_id) WHERE id=?`,
  ).run(Date.now(), serverId, id);
}

export function listCashMovements(restaurantId: number, opts: { sessionId?: number | null; limit?: number } = {}): CashMovementRow[] {
  const limit = opts.limit ?? 100;
  const filterSession = opts.sessionId != null;
  const rows = (filterSession
    ? getDb().prepare(
        `SELECT * FROM cash_movements WHERE restaurant_id=? AND session_id=? ORDER BY at DESC LIMIT ?`,
      ).all(restaurantId, opts.sessionId, limit)
    : getDb().prepare(
        `SELECT * FROM cash_movements WHERE restaurant_id=? ORDER BY at DESC LIMIT ?`,
      ).all(restaurantId, limit)
  ) as RawCashRow[];
  return rows.map(toCash);
}

// ─── Expenses ─────────────────────────────────────────────────────────────
export interface ExpenseRow {
  id: string; restaurantId: number; branchId: number | null;
  sessionId: number | null; category: string | null; amount: number;
  reason: string | null; cashier: string | null; at: number;
  syncedAt: number | null; serverId: number | null;
}

interface RawExpenseRow {
  id: string; restaurant_id: number; branch_id: number | null;
  session_id: number | null; category: string | null; amount: number;
  reason: string | null; cashier: string | null; at: number;
  synced_at: number | null; server_id: number | null;
}

function toExpense(r: RawExpenseRow): ExpenseRow {
  return {
    id: r.id, restaurantId: r.restaurant_id, branchId: r.branch_id,
    sessionId: r.session_id, category: r.category, amount: r.amount,
    reason: r.reason, cashier: r.cashier, at: r.at,
    syncedAt: r.synced_at, serverId: r.server_id,
  };
}

export function insertExpense(row: Omit<ExpenseRow, "syncedAt" | "serverId">): ExpenseRow {
  getDb().prepare(
    `INSERT OR REPLACE INTO expenses
       (id, restaurant_id, branch_id, session_id, category, amount, reason, cashier, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.restaurantId, row.branchId, row.sessionId, row.category, row.amount, row.reason, row.cashier, row.at);
  return { ...row, syncedAt: null, serverId: null };
}

export function markExpenseSynced(id: string, serverId: number | null): void {
  getDb().prepare(
    `UPDATE expenses SET synced_at=?, server_id=COALESCE(?, server_id) WHERE id=?`,
  ).run(Date.now(), serverId, id);
}

export function listExpenses(restaurantId: number, opts: { sessionId?: number | null; limit?: number } = {}): ExpenseRow[] {
  const limit = opts.limit ?? 100;
  const rows = (opts.sessionId != null
    ? getDb().prepare(
        `SELECT * FROM expenses WHERE restaurant_id=? AND session_id=? ORDER BY at DESC LIMIT ?`,
      ).all(restaurantId, opts.sessionId, limit)
    : getDb().prepare(
        `SELECT * FROM expenses WHERE restaurant_id=? ORDER BY at DESC LIMIT ?`,
      ).all(restaurantId, limit)
  ) as RawExpenseRow[];
  return rows.map(toExpense);
}

// ─── Stock actions ────────────────────────────────────────────────────────
export interface StockActionRow {
  id: string; restaurantId: number; branchId: number | null;
  menuItemId: number | null; ingredientId: number | null;
  kind: "adjust" | "waste" | "transfer" | "spoil";
  quantity: number; unit: string | null;
  reason: string | null; cashier: string | null; at: number;
  syncedAt: number | null; serverId: number | null;
}

interface RawStockRow {
  id: string; restaurant_id: number; branch_id: number | null;
  menu_item_id: number | null; ingredient_id: number | null;
  kind: string; quantity: number; unit: string | null;
  reason: string | null; cashier: string | null; at: number;
  synced_at: number | null; server_id: number | null;
}

function toStock(r: RawStockRow): StockActionRow {
  return {
    id: r.id, restaurantId: r.restaurant_id, branchId: r.branch_id,
    menuItemId: r.menu_item_id, ingredientId: r.ingredient_id,
    kind: r.kind as StockActionRow["kind"],
    quantity: r.quantity, unit: r.unit, reason: r.reason,
    cashier: r.cashier, at: r.at,
    syncedAt: r.synced_at, serverId: r.server_id,
  };
}

export function insertStockAction(row: Omit<StockActionRow, "syncedAt" | "serverId">): StockActionRow {
  getDb().prepare(
    `INSERT OR REPLACE INTO stock_actions
       (id, restaurant_id, branch_id, menu_item_id, ingredient_id, kind, quantity, unit, reason, cashier, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.restaurantId, row.branchId, row.menuItemId, row.ingredientId,
    row.kind, row.quantity, row.unit, row.reason, row.cashier, row.at);
  return { ...row, syncedAt: null, serverId: null };
}

export function markStockSynced(id: string, serverId: number | null): void {
  getDb().prepare(
    `UPDATE stock_actions SET synced_at=?, server_id=COALESCE(?, server_id) WHERE id=?`,
  ).run(Date.now(), serverId, id);
}

export function listStockActions(restaurantId: number, opts: { limit?: number } = {}): StockActionRow[] {
  const rows = getDb().prepare(
    `SELECT * FROM stock_actions WHERE restaurant_id=? ORDER BY at DESC LIMIT ?`,
  ).all(restaurantId, opts.limit ?? 100) as RawStockRow[];
  return rows.map(toStock);
}

// ─── Audit log ────────────────────────────────────────────────────────────
export interface AuditLogRow {
  id: number; at: number;
  actor: string | null; action: string; target: string | null;
  details: unknown;
  syncedAt: number | null; serverId: number | null;
}

interface RawAuditRow {
  id: number; at: number; actor: string | null; action: string;
  target: string | null; details: string | null;
  synced_at: number | null; server_id: number | null;
}

function toAudit(r: RawAuditRow): AuditLogRow {
  let details: unknown = null;
  if (r.details) { try { details = JSON.parse(r.details); } catch { details = r.details; } }
  return {
    id: r.id, at: r.at, actor: r.actor, action: r.action, target: r.target,
    details, syncedAt: r.synced_at, serverId: r.server_id,
  };
}

export function insertAuditLog(row: Omit<AuditLogRow, "id" | "syncedAt" | "serverId">): AuditLogRow {
  const r = getDb().prepare(
    `INSERT INTO audit_log(at, actor, action, target, details)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(row.at, row.actor, row.action, row.target,
    row.details != null ? JSON.stringify(row.details) : null);
  return { ...row, id: Number(r.lastInsertRowid), syncedAt: null, serverId: null };
}

export function markAuditSynced(id: number, serverId: number | null): void {
  getDb().prepare(
    `UPDATE audit_log SET synced_at=?, server_id=COALESCE(?, server_id) WHERE id=?`,
  ).run(Date.now(), serverId, id);
}

export function listAuditLog(opts: { limit?: number; sinceMs?: number } = {}): AuditLogRow[] {
  const limit = opts.limit ?? 200;
  const since = opts.sinceMs ?? 0;
  const rows = getDb().prepare(
    `SELECT * FROM audit_log WHERE at >= ? ORDER BY at DESC LIMIT ?`,
  ).all(since, limit) as RawAuditRow[];
  return rows.map(toAudit);
}

// ─── Sync log ─────────────────────────────────────────────────────────────
export interface SyncLogRow {
  id: number; at: number; kind: string;
  opId: number | null; outcome: string; details: string | null;
}

interface RawSyncLogRow {
  id: number; at: number; kind: string; op_id: number | null;
  outcome: string; details: string | null;
}

export function appendSyncLog(entry: Omit<SyncLogRow, "id">): void {
  getDb().prepare(
    `INSERT INTO sync_log(at, kind, op_id, outcome, details) VALUES (?, ?, ?, ?, ?)`,
  ).run(entry.at, entry.kind, entry.opId, entry.outcome, entry.details);
  // Cap retention to the most recent 2000 entries so the table doesn't grow
  // unbounded on long-running installs.
  getDb().exec(
    `DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 2000)`,
  );
}

export function listSyncLog(limit = 200): SyncLogRow[] {
  const rows = getDb().prepare(
    `SELECT * FROM sync_log ORDER BY id DESC LIMIT ?`,
  ).all(limit) as RawSyncLogRow[];
  return rows.map((r) => ({
    id: r.id, at: r.at, kind: r.kind, opId: r.op_id,
    outcome: r.outcome, details: r.details,
  }));
}

// ─── Print jobs ───────────────────────────────────────────────────────────
export interface PrintJobRow {
  id: string; kind: "kot" | "bill" | "z_report";
  orderId: number | null; printerName: string | null;
  status: "queued" | "sent" | "failed";
  at: number; attempts: number; lastError: string | null;
  payload: unknown;
}

interface RawPrintJobRow {
  id: string; kind: string; order_id: number | null;
  printer_name: string | null; status: string; at: number;
  attempts: number; last_error: string | null; payload: string | null;
}

function toPrintJob(r: RawPrintJobRow): PrintJobRow {
  let payload: unknown = null;
  if (r.payload) { try { payload = JSON.parse(r.payload); } catch { /* ignore */ } }
  return {
    id: r.id, kind: r.kind as PrintJobRow["kind"],
    orderId: r.order_id, printerName: r.printer_name,
    status: r.status as PrintJobRow["status"],
    at: r.at, attempts: r.attempts, lastError: r.last_error, payload,
  };
}

export function recordPrintJob(job: Omit<PrintJobRow, "attempts">): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO print_jobs
       (id, kind, order_id, printer_name, status, at, attempts, last_error, payload)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT attempts FROM print_jobs WHERE id=?), 0) + ?, ?, ?)`,
  ).run(
    job.id, job.kind, job.orderId, job.printerName, job.status,
    job.at, job.id, job.status === "failed" ? 1 : 0,
    job.lastError, job.payload != null ? JSON.stringify(job.payload) : null,
  );
  // Cap to most recent 500 jobs.
  getDb().exec(
    `DELETE FROM print_jobs WHERE id NOT IN (SELECT id FROM print_jobs ORDER BY at DESC LIMIT 500)`,
  );
}

export function listPrintJobs(limit = 100): PrintJobRow[] {
  const rows = getDb().prepare(
    `SELECT * FROM print_jobs ORDER BY at DESC LIMIT ?`,
  ).all(limit) as RawPrintJobRow[];
  return rows.map(toPrintJob);
}

export function printJobCounts(): { queued: number; sent: number; failed: number } {
  const rows = getDb().prepare(
    `SELECT status, COUNT(*) AS c FROM print_jobs GROUP BY status`,
  ).all() as Array<{ status: string; c: number }>;
  const out = { queued: 0, sent: 0, failed: 0 };
  for (const r of rows) {
    if (r.status === "queued") out.queued = r.c;
    else if (r.status === "sent") out.sent = r.c;
    else if (r.status === "failed") out.failed = r.c;
  }
  return out;
}

// ─── Clear-cache (safe subset) ────────────────────────────────────────────
/**
 * "Safe" cache clear: drops only the reference data (menu/tables/etc.) so a
 * subsequent hydrate refreshes everything. Pending operations, conflicts,
 * audit log, cash movements, expenses, stock actions, held bills, z-reports,
 * and the sync log are all preserved — those represent unsynced or
 * audit-critical state that the operator cannot afford to lose.
 */
export function clearSafeCache(restaurantId: number): void {
  const db = getDb();
  const txn = db.transaction(() => {
    db.prepare(`DELETE FROM categories WHERE restaurant_id=?`).run(restaurantId);
    db.prepare(`DELETE FROM menu_items WHERE restaurant_id=?`).run(restaurantId);
    db.prepare(`DELETE FROM tables WHERE restaurant_id=?`).run(restaurantId);
    db.prepare(`DELETE FROM customers WHERE restaurant_id=?`).run(restaurantId);
    db.prepare(`DELETE FROM settings WHERE restaurant_id=?`).run(restaurantId);
    db.prepare(`DELETE FROM terminals WHERE restaurant_id=?`).run(restaurantId);
    db.prepare(`DELETE FROM kitchens WHERE restaurant_id=?`).run(restaurantId);
    db.prepare(`DELETE FROM discount_rules WHERE restaurant_id=?`).run(restaurantId);
    db.prepare(`DELETE FROM modifier_groups`).run();
    db.prepare(`DELETE FROM kv WHERE k LIKE 'restaurant_info:' || ? OR k LIKE 'menu:lastAt:' || ? OR k LIKE 'hydrate:lastAt:' || ? OR k LIKE 'terminals:' || ? OR k LIKE 'discounts:' || ?`)
      .run(restaurantId, restaurantId, restaurantId, restaurantId, restaurantId);
  });
  txn();
}
