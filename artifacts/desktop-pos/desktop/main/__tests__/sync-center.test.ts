/**
 * Phase 5+ Sync Center coverage:
 *  - PendingKind categorisation + countByCategory across new shift/stock/audit/print kinds.
 *  - postWithFallback returns null on 404 so engine clears the local op as synced.
 *  - clearSafeCache removes reference data but preserves audit / pending /
 *    held bills / expenses / stock / sync log / conflicts / z_reports.
 *  - sync_log captures one entry per drained op outcome.
 */

import { describe, it, expect, vi } from "vitest";
import { SyncEngine } from "../sync/engine";
import { ApiError, type ApiClient } from "../api/client";
import * as P from "../db/pending";
import * as D from "../db/domain";
import { getTestDb } from "./setup";

function makeClient(requestImpl?: (path: string, opts: { method?: string; body?: unknown }) => Promise<unknown>): ApiClient {
  return { request: requestImpl ?? vi.fn(async () => ({ id: 7 })) } as unknown as ApiClient;
}

function makeEngine(client: ApiClient, online = true): SyncEngine {
  return new SyncEngine(client, () => 1, () => null, () => online);
}

describe("pending categories", () => {
  it("buckets every new pending kind into the right category", () => {
    expect(P.categoryFor("orders:create")).toBe("orders");
    expect(P.categoryFor("orders:add-items")).toBe("orders");
    expect(P.categoryFor("orders:pay")).toBe("payments");
    expect(P.categoryFor("customers:create")).toBe("customers");
    expect(P.categoryFor("shift:cash-movement")).toBe("shift");
    expect(P.categoryFor("shift:expense")).toBe("expenses");
    expect(P.categoryFor("stock:adjust")).toBe("stock");
    expect(P.categoryFor("prints:record")).toBe("prints");
    expect(P.categoryFor("audit:log")).toBe("audit");
    expect(P.categoryFor("totally:unknown")).toBe("other");
  });

  it("priorityFor enforces shift → orders → payments → prints → expenses → stock → audit", () => {
    expect(P.priorityFor("shift:cash-movement")).toBeLessThan(P.priorityFor("orders:create"));
    expect(P.priorityFor("orders:create")).toBeLessThan(P.priorityFor("orders:pay"));
    expect(P.priorityFor("orders:pay")).toBeLessThan(P.priorityFor("prints:record"));
    expect(P.priorityFor("prints:record")).toBeLessThan(P.priorityFor("shift:expense"));
    expect(P.priorityFor("shift:expense")).toBeLessThan(P.priorityFor("stock:adjust"));
    expect(P.priorityFor("stock:adjust")).toBeLessThan(P.priorityFor("audit:log"));
  });

  it("countByCategory tallies pending vs failed vs conflict across kinds", () => {
    P.enqueue({ kind: "shift:cash-movement", idempotencyKey: "k1", payload: {} });
    const ex = P.enqueue({ kind: "shift:expense", idempotencyKey: "k2", payload: {} });
    P.setStatus(ex.id, "failed", "boom");
    const st = P.enqueue({ kind: "stock:adjust", idempotencyKey: "k3", payload: {} });
    P.setStatus(st.id, "conflict", "rejected");
    P.recordConflict(st.id, "stock:adjust", "stock rejected");
    P.enqueue({ kind: "audit:log", idempotencyKey: "k4", payload: {} });
    P.enqueue({ kind: "prints:record", idempotencyKey: "k5", payload: {} });

    const c = P.countByCategory();
    expect(c.shift.pending).toBe(1);     // shift:cash-movement
    expect(c.expenses.pending).toBe(0);  // shift:expense is failed below
    expect(c.expenses.failed).toBe(1);
    expect(c.stock.conflicts).toBe(1);
    expect(c.audit.pending).toBe(1);
    expect(c.prints.pending).toBe(1);
    expect(c.orders.pending).toBe(0);
  });
});

describe("SyncEngine — new kinds via postWithFallback", () => {
  it("clears a shift:expense op on 2xx and marks the local expense synced", async () => {
    const calls: string[] = [];
    const client = makeClient(async (path) => { calls.push(path); return { id: 42 }; });
    const engine = makeEngine(client);

    D.insertExpense({
      id: "ex_1", restaurantId: 1, branchId: null, sessionId: null,
      category: null, amount: 50, reason: "milk", cashier: "ada", at: Date.now(),
    });
    P.enqueue({
      kind: "shift:expense", idempotencyKey: "ex_1",
      payload: { localId: "ex_1", sessionId: null, category: null, amount: 50, reason: "milk", cashier: "ada", at: Date.now() },
    });

    await engine.drain();

    expect(P.pendingCount()).toBe(0);
    expect(calls[0]).toContain("/expenses");
    const rows = D.listExpenses(1);
    expect(rows[0].syncedAt).not.toBeNull();
    expect(rows[0].serverId).toBe(42);
  });

  it("treats a 404 as a visible conflict — local row stays unsynced and surfaces in Sync Center", async () => {
    const client = makeClient(async () => { throw new ApiError(404, "not deployed"); });
    const engine = makeEngine(client);

    D.insertStockAction({
      id: "st_1", restaurantId: 1, branchId: null,
      menuItemId: 10, ingredientId: null, kind: "waste",
      quantity: 2, unit: "kg", reason: "spoiled", cashier: "ada", at: Date.now(),
    });
    const op = P.enqueue({
      kind: "stock:adjust", idempotencyKey: "st_1",
      payload: { localId: "st_1", menuItemId: 10, ingredientId: null, kind: "waste", quantity: 2, unit: "kg", reason: "spoiled" },
    });

    await engine.drain();
    // 404 is treated like any other 4xx — recorded as a conflict so the
    // operator sees the failure instead of silently losing the row.
    expect(P.getOp(op.id)!.status).toBe("conflict");
    expect(P.listConflicts()).toHaveLength(1);
    const rows = D.listStockActions(1);
    expect(rows[0].syncedAt).toBeNull();
  });

  it("writes a sync_log entry per drained op", async () => {
    const client = makeClient(async () => ({ id: 1 }));
    const engine = makeEngine(client);

    P.enqueue({
      kind: "audit:log", idempotencyKey: "au_1",
      payload: { localId: 1, action: "shift:open", target: null, details: null, at: Date.now(), actor: "ada" },
    });
    D.insertAuditLog({ at: Date.now(), actor: "ada", action: "shift:open", target: null, details: null });

    await engine.drain();

    const log = D.listSyncLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].outcome).toBe("synced");
    expect(log[0].kind).toBe("audit:log");
  });

  it("captures a 4xx (non-404) as a conflict on the new kinds", async () => {
    const client = makeClient(async () => { throw new ApiError(422, "rejected"); });
    const engine = makeEngine(client);
    const op = P.enqueue({
      kind: "shift:cash-movement", idempotencyKey: "cm_x",
      payload: { localId: "cm_x", sessionId: null, kind: "in", amount: 100, reason: "float", cashier: null, at: Date.now() },
    });
    await engine.drain();
    expect(P.getOp(op.id)!.status).toBe("conflict");
    expect(P.listConflicts()).toHaveLength(1);
  });
});

describe("clearSafeCache", () => {
  it("drops reference data but preserves pending/conflicts/audit/expenses/stock/held bills/sync log", () => {
    const db = getTestDb();
    // Seed reference data the cache-clear should drop.
    db.prepare(`INSERT INTO categories(id, restaurant_id, name, sort_order, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(1, 1, "Bar", 0, Date.now(), "{}");
    db.prepare(`INSERT INTO menu_items(id, restaurant_id, category_id, name, is_available, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(1, 1, 1, "Lager", 1, Date.now(), "{}");
    db.prepare(`INSERT INTO tables(id, restaurant_id, status, updated_at, payload) VALUES (?, ?, ?, ?, ?)`)
      .run(1, 1, "available", Date.now(), "{}");
    db.prepare(`INSERT INTO customers(id, restaurant_id, phone, name, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(1, 1, null, "Joe", Date.now(), "{}");

    // Seed state the cache-clear must preserve.
    P.enqueue({ kind: "shift:expense", idempotencyKey: "e1", payload: { amount: 10 } });
    D.insertExpense({
      id: "e1", restaurantId: 1, branchId: null, sessionId: null,
      category: null, amount: 10, reason: "x", cashier: null, at: Date.now(),
    });
    D.insertStockAction({
      id: "s1", restaurantId: 1, branchId: null, menuItemId: null, ingredientId: null,
      kind: "adjust", quantity: 1, unit: null, reason: null, cashier: null, at: Date.now(),
    });
    D.insertAuditLog({ at: Date.now(), actor: "ada", action: "auth:offline-login", target: null, details: null });
    D.upsertHeldBill({
      id: "h1", restaurantId: 1, branchId: null, counterId: null,
      label: "T1", cashier: null, createdAt: Date.now(), payload: { lines: [] },
    });
    D.appendSyncLog({ at: Date.now(), kind: "test", opId: null, outcome: "synced", details: null });

    D.clearSafeCache(1);

    // Reference data gone.
    expect((db.prepare(`SELECT COUNT(*) AS c FROM categories`).get() as { c: number }).c).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM menu_items`).get() as { c: number }).c).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM tables`).get() as { c: number }).c).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM customers`).get() as { c: number }).c).toBe(0);

    // Sensitive / unsynced state preserved.
    expect(P.pendingCount()).toBe(1);
    expect(D.listExpenses(1)).toHaveLength(1);
    expect(D.listStockActions(1)).toHaveLength(1);
    expect(D.listAuditLog()).toHaveLength(1);
    expect(D.listHeldBills(1, null)).toHaveLength(1);
    expect(D.listSyncLog().length).toBeGreaterThan(0);
  });
});
