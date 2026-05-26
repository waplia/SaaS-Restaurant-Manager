/**
 * Pending queue — enqueue, listing, status transitions, ID remap, conflict
 * capture. These tests guard the contract the sync engine relies on.
 */

import { describe, it, expect } from "vitest";
import {
  enqueue, listPending, listAll, pendingCount, setStatus, removeOp,
  patchPayload, remapLocalOrderId, remapLocalCustomerId,
  recordConflict, listConflicts, resolveConflict, getOp,
} from "../db/pending";

describe("pending queue", () => {
  it("enqueues an op and returns it with defaults", () => {
    const op = enqueue({
      kind: "orders:create",
      idempotencyKey: "key-1",
      payload: { orderType: "dine_in", items: [] },
      localOrderId: -1_000_001,
    });
    expect(op.id).toBeGreaterThan(0);
    expect(op.kind).toBe("orders:create");
    expect(op.status).toBe("pending");
    expect(op.attempts).toBe(0);
    expect(op.localOrderId).toBe(-1_000_001);
    expect(op.payload).toEqual({ orderType: "dine_in", items: [] });
    expect(pendingCount()).toBe(1);
  });

  it("listPending returns FIFO order; listAll includes conflicts", () => {
    const a = enqueue({ kind: "orders:create", idempotencyKey: "a", payload: {} });
    const b = enqueue({ kind: "customers:create", idempotencyKey: "b", payload: {} });
    const c = enqueue({ kind: "orders:create", idempotencyKey: "c", payload: {} });
    recordConflict(c.id, c.kind, "boom");
    const pending = listPending();
    expect(pending.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(listAll().map((p) => p.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(pendingCount()).toBe(2);
  });

  it("setStatus increments attempts for non in-flight transitions", () => {
    const op = enqueue({ kind: "orders:create", idempotencyKey: "k", payload: {} });
    setStatus(op.id, "in-flight");
    expect(getOp(op.id)!.attempts).toBe(0);
    setStatus(op.id, "failed", "nope");
    const after = getOp(op.id)!;
    expect(after.attempts).toBe(1);
    expect(after.status).toBe("failed");
    expect(after.lastError).toBe("nope");
  });

  it("removeOp deletes the row", () => {
    const op = enqueue({ kind: "orders:create", idempotencyKey: "k", payload: {} });
    removeOp(op.id);
    expect(getOp(op.id)).toBeNull();
  });

  it("patchPayload rewrites JSON", () => {
    const op = enqueue({ kind: "orders:create", idempotencyKey: "k", payload: { foo: 1 } });
    patchPayload(op.id, { foo: 2, bar: "x" });
    expect(getOp(op.id)!.payload).toEqual({ foo: 2, bar: "x" });
  });

  it("remapLocalOrderId rewrites dependent payloads and clears local marker", () => {
    const create = enqueue({
      kind: "orders:create",
      idempotencyKey: "c",
      payload: { orderType: "dine_in", items: [] },
      localOrderId: -1_000_005,
    });
    const addItems = enqueue({
      kind: "orders:add-items",
      idempotencyKey: "i",
      payload: { orderId: -1_000_005, items: [] },
      localOrderId: -1_000_005,
    });
    const pay = enqueue({
      kind: "orders:pay",
      idempotencyKey: "p",
      payload: { orderId: -1_000_005, paymentMethod: "cash" },
      localOrderId: -1_000_005,
    });
    remapLocalOrderId(-1_000_005, 42);
    const afterAdd = getOp(addItems.id)!;
    const afterPay = getOp(pay.id)!;
    expect((afterAdd.payload as { orderId: number }).orderId).toBe(42);
    expect(afterAdd.localOrderId).toBeNull();
    expect((afterPay.payload as { orderId: number }).orderId).toBe(42);
    expect(afterPay.localOrderId).toBeNull();
    // create op is also touched (its local_order_id cleared) which is fine
    expect(getOp(create.id)).not.toBeNull();
  });

  it("remapLocalOrderId skips ops already in conflict", () => {
    const addItems = enqueue({
      kind: "orders:add-items",
      idempotencyKey: "i",
      payload: { orderId: -7, items: [] },
      localOrderId: -7,
    });
    recordConflict(addItems.id, addItems.kind, "frozen");
    remapLocalOrderId(-7, 100);
    const after = getOp(addItems.id)!;
    expect((after.payload as { orderId: number }).orderId).toBe(-7);
    expect(after.localOrderId).toBe(-7);
  });

  it("remapLocalCustomerId rewrites customerId on dependent orders:create", () => {
    const order = enqueue({
      kind: "orders:create",
      idempotencyKey: "o",
      payload: { orderType: "dine_in", items: [], customerId: -1_000_010 },
      localCustomerId: -1_000_010,
    });
    remapLocalCustomerId(-1_000_010, 999);
    const after = getOp(order.id)!;
    expect((after.payload as { customerId: number }).customerId).toBe(999);
    expect(after.localCustomerId).toBeNull();
  });

  it("recordConflict + resolveConflict('discard') drops the op", () => {
    const op = enqueue({ kind: "orders:create", idempotencyKey: "k", payload: {} });
    const c = recordConflict(op.id, op.kind, "bad", { reason: "x" });
    expect(getOp(op.id)!.status).toBe("conflict");
    expect(listConflicts()).toHaveLength(1);
    resolveConflict(c.id, "discard");
    expect(getOp(op.id)).toBeNull();
    expect(listConflicts()).toHaveLength(0);
  });

  it("resolveConflict('retry') re-arms the op", () => {
    const op = enqueue({ kind: "orders:create", idempotencyKey: "k", payload: {} });
    const c = recordConflict(op.id, op.kind, "bad");
    resolveConflict(c.id, "retry");
    const after = getOp(op.id)!;
    expect(after.status).toBe("pending");
    expect(after.lastError).toBeNull();
  });

  it("resolveConflict('skip') keeps the op out of FIFO but removes the tray row", () => {
    const op = enqueue({ kind: "orders:create", idempotencyKey: "k", payload: {} });
    const c = recordConflict(op.id, op.kind, "bad");
    resolveConflict(c.id, "skip");
    expect(getOp(op.id)!.status).toBe("conflict");
    expect(listConflicts()).toHaveLength(0);
  });
});
