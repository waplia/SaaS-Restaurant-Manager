/**
 * Pending operations queue + conflict capture.
 *
 * - Oldest-first FIFO drain.
 * - One in-flight op at a time so dependent calls (add-items, pay) wait for
 *   their predecessor's ID remap.
 * - Conflicts are not retried automatically — they surface in the UI tray.
 */

import { getDb } from "./index";

export type PendingKind =
  | "orders:create"
  | "orders:add-items"
  | "orders:pay"
  | "customers:create"
  | "shift:cash-movement"
  | "shift:expense"
  | "stock:adjust"
  | "prints:record"
  | "audit:log";

/** Category bucket surfaced by the Sync Center as a tab heading. Keep the
 *  buckets stable — the renderer keys its counters off these strings. */
export type PendingCategory =
  | "shift"
  | "orders"
  | "payments"
  | "prints"
  | "expenses"
  | "stock"
  | "customers"
  | "audit"
  | "held_bills"
  | "other";

export function categoryFor(kind: string): PendingCategory {
  if (kind === "shift:cash-movement") return "shift";
  if (kind === "orders:create" || kind === "orders:add-items") return "orders";
  if (kind === "orders:pay") return "payments";
  if (kind === "customers:create") return "customers";
  if (kind === "shift:expense") return "expenses";
  if (kind === "stock:adjust") return "stock";
  if (kind === "prints:record") return "prints";
  if (kind === "audit:log") return "audit";
  return "other";
}

/** Deterministic replay order: when the device reconnects we must drain
 *  shift events first (so the till state is current), then orders, then
 *  payments tied to those orders, then prints, then expenses & stock that
 *  reference the just-synced orders, then the audit log last. Held bills
 *  never sync (they are a local-only park) and `customers:create` is
 *  remapped inline by the engine so its absolute position doesn't matter —
 *  both sit at the tail. */
const CATEGORY_PRIORITY: Record<PendingCategory, number> = {
  shift: 0,
  orders: 1,
  payments: 2,
  prints: 3,
  expenses: 4,
  stock: 5,
  audit: 6,
  customers: 7,
  held_bills: 8,
  other: 9,
};

export function priorityFor(kind: string): number {
  return CATEGORY_PRIORITY[categoryFor(kind)];
}

export interface PendingOp {
  id: number;
  kind: PendingKind;
  localOrderId: number | null;
  localCustomerId: number | null;
  idempotencyKey: string;
  payload: unknown;
  dependsOn: number | null;
  status: "pending" | "in-flight" | "failed" | "conflict";
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number | null;
  createdAt: number;
}

interface Row {
  id: number; kind: string; local_order_id: number | null; local_customer_id: number | null;
  idempotency_key: string; payload: string; depends_on: number | null;
  status: string; attempts: number; last_error: string | null;
  last_attempt_at: number | null; created_at: number;
}

function rowToOp(r: Row): PendingOp {
  return {
    id: r.id,
    kind: r.kind as PendingKind,
    localOrderId: r.local_order_id,
    localCustomerId: r.local_customer_id,
    idempotencyKey: r.idempotency_key,
    payload: JSON.parse(r.payload),
    dependsOn: r.depends_on,
    status: r.status as PendingOp["status"],
    attempts: r.attempts,
    lastError: r.last_error,
    lastAttemptAt: r.last_attempt_at,
    createdAt: r.created_at,
  };
}

export interface EnqueueArgs {
  kind: PendingKind;
  idempotencyKey: string;
  payload: unknown;
  localOrderId?: number | null;
  localCustomerId?: number | null;
  dependsOn?: number | null;
}

export function enqueue(args: EnqueueArgs): PendingOp {
  const r = getDb().prepare(
    `INSERT INTO pending_operations
     (kind, local_order_id, local_customer_id, idempotency_key, payload, depends_on, status, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
  ).run(
    args.kind, args.localOrderId ?? null, args.localCustomerId ?? null,
    args.idempotencyKey, JSON.stringify(args.payload), args.dependsOn ?? null, Date.now(),
  );
  return getOp(Number(r.lastInsertRowid))!;
}

export function getOp(id: number): PendingOp | null {
  const r = getDb().prepare(`SELECT * FROM pending_operations WHERE id=?`).get(id) as Row | undefined;
  return r ? rowToOp(r) : null;
}

export function listPending(): PendingOp[] {
  const rows = getDb().prepare(
    `SELECT * FROM pending_operations WHERE status IN ('pending','failed','in-flight') ORDER BY created_at ASC, id ASC`,
  ).all() as Row[];
  return rows.map(rowToOp);
}

export function listAll(): PendingOp[] {
  const rows = getDb().prepare(`SELECT * FROM pending_operations ORDER BY created_at DESC`).all() as Row[];
  return rows.map(rowToOp);
}

export function pendingCount(): number {
  const r = getDb().prepare(
    `SELECT COUNT(*) AS c FROM pending_operations WHERE status IN ('pending','failed','in-flight')`,
  ).get() as { c: number };
  return r.c;
}

/** Per-category counters for the Sync Center summary. Includes both pending
 *  + conflict ops so the operator sees the total backlog per bucket. */
export function countByCategory(): Record<PendingCategory, { pending: number; failed: number; conflicts: number }> {
  const rows = getDb().prepare(
    `SELECT kind, status, COUNT(*) AS c FROM pending_operations GROUP BY kind, status`,
  ).all() as Array<{ kind: string; status: string; c: number }>;
  const init: Record<PendingCategory, { pending: number; failed: number; conflicts: number }> = {
    shift: { pending: 0, failed: 0, conflicts: 0 },
    orders: { pending: 0, failed: 0, conflicts: 0 },
    payments: { pending: 0, failed: 0, conflicts: 0 },
    prints: { pending: 0, failed: 0, conflicts: 0 },
    expenses: { pending: 0, failed: 0, conflicts: 0 },
    stock: { pending: 0, failed: 0, conflicts: 0 },
    customers: { pending: 0, failed: 0, conflicts: 0 },
    audit: { pending: 0, failed: 0, conflicts: 0 },
    held_bills: { pending: 0, failed: 0, conflicts: 0 },
    other: { pending: 0, failed: 0, conflicts: 0 },
  };
  for (const r of rows) {
    const cat = categoryFor(r.kind);
    if (r.status === "conflict") init[cat].conflicts += r.c;
    else if (r.status === "failed") init[cat].failed += r.c;
    else init[cat].pending += r.c;
  }
  return init;
}

export function setStatus(id: number, status: PendingOp["status"], error?: string | null): void {
  getDb().prepare(
    `UPDATE pending_operations SET status=?, last_error=?, last_attempt_at=?, attempts=attempts+? WHERE id=?`,
  ).run(status, error ?? null, Date.now(), status === "in-flight" ? 0 : 1, id);
}

export function removeOp(id: number): void {
  getDb().prepare(`DELETE FROM pending_operations WHERE id=?`).run(id);
}

export function patchPayload(id: number, payload: unknown): void {
  getDb().prepare(`UPDATE pending_operations SET payload=? WHERE id=?`).run(JSON.stringify(payload), id);
}

/**
 * After a create succeeds and we know the canonical order id, walk every
 * dependent pending op (add-items, pay) and rewrite their payload to point
 * at the new id. This is the "ID remap" pass.
 */
export function remapLocalOrderId(localId: number, serverId: number): void {
  const rows = getDb().prepare(
    `SELECT * FROM pending_operations WHERE local_order_id=? AND id NOT IN (
       SELECT id FROM pending_operations WHERE status='conflict'
     )`,
  ).all(localId) as Row[];
  for (const r of rows) {
    const op = rowToOp(r);
    if (op.payload && typeof op.payload === "object") {
      const p = op.payload as Record<string, unknown>;
      if ("orderId" in p) p.orderId = serverId;
      patchPayload(op.id, p);
    }
    getDb().prepare(`UPDATE pending_operations SET local_order_id=NULL WHERE id=?`).run(op.id);
  }
}

export function remapLocalCustomerId(localId: number, serverId: number): void {
  const rows = getDb().prepare(`SELECT * FROM pending_operations WHERE local_customer_id=?`).all(localId) as Row[];
  for (const r of rows) {
    const op = rowToOp(r);
    if (op.payload && typeof op.payload === "object") {
      const p = op.payload as Record<string, unknown>;
      if ("customerId" in p) p.customerId = serverId;
      patchPayload(op.id, p);
    }
    getDb().prepare(`UPDATE pending_operations SET local_customer_id=NULL WHERE id=?`).run(op.id);
  }
}

// ─── Conflicts ─────────────────────────────────────────────────────────────
export interface ConflictRow {
  id: number; opId: number; kind: string; summary: string;
  details: string | null; capturedAt: number;
}
interface RawConflictRow { id: number; op_id: number; kind: string; summary: string; details: string | null; captured_at: number }

export function recordConflict(opId: number, kind: string, summary: string, details?: unknown): ConflictRow {
  const r = getDb().prepare(
    `INSERT INTO conflicts(op_id, kind, summary, details, captured_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(opId, kind, summary, details != null ? JSON.stringify(details) : null, Date.now());
  setStatus(opId, "conflict", summary);
  return {
    id: Number(r.lastInsertRowid), opId, kind, summary,
    details: details != null ? JSON.stringify(details) : null, capturedAt: Date.now(),
  };
}

export function listConflicts(): ConflictRow[] {
  const rows = getDb().prepare(`SELECT * FROM conflicts ORDER BY captured_at DESC`).all() as RawConflictRow[];
  return rows.map((r) => ({
    id: r.id, opId: r.op_id, kind: r.kind, summary: r.summary,
    details: r.details, capturedAt: r.captured_at,
  }));
}

export type ConflictAction = "discard" | "retry" | "skip";

export function resolveConflict(id: number, action: ConflictAction): void {
  const row = getDb().prepare(`SELECT op_id FROM conflicts WHERE id=?`).get(id) as { op_id: number } | undefined;
  if (!row) return;
  const txn = getDb().transaction(() => {
    getDb().prepare(`DELETE FROM conflicts WHERE id=?`).run(id);
    if (action === "discard") {
      // Drop the op entirely — operator chose to abandon this change.
      getDb().prepare(`DELETE FROM pending_operations WHERE id=?`).run(row.op_id);
    } else if (action === "skip") {
      // Park the op out of the FIFO drain (status stays 'conflict') but
      // remove the conflict row so the tray clears. The operator can revisit
      // by re-opening the op from the SyncPanel.
      // Nothing else to do here — the pending_operations row keeps its
      // 'conflict' status so the engine skips past it permanently.
    } else {
      // Retry — re-arm the op so the engine picks it up on the next drain.
      getDb().prepare(
        `UPDATE pending_operations SET status='pending', last_error=NULL WHERE id=?`,
      ).run(row.op_id);
    }
  });
  txn();
}
