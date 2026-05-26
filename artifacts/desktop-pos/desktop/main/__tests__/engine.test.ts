/**
 * Sync engine — drain semantics, ID remap propagation, conflict capture on
 * 4xx, retry on 5xx, dependency gating.
 */

import { describe, it, expect, vi } from "vitest";
import { SyncEngine } from "../sync/engine";
import { ApiError } from "../api/client";
import type { ApiClient } from "../api/client";
import * as P from "../db/pending";
import * as Q from "../db/queries";
import type { OrderDetailView, CustomerSummary } from "../../shared/ipc-contract";

function makeOrder(id: number, overrides: Partial<OrderDetailView> = {}): OrderDetailView {
  return {
    id,
    restaurantId: 1,
    orderNumber: `O-${id}`,
    status: "pending",
    orderType: "dine_in",
    tableId: null,
    customerName: null,
    customerPhone: null,
    customerId: null,
    subtotal: "0.00",
    taxAmount: "0.00",
    serviceCharge: "0.00",
    discountAmount: "0.00",
    totalAmount: "0.00",
    createdAt: new Date().toISOString(),
    isRunningOrder: true,
    isPriority: false,
    notes: null,
    paymentStatus: "pending",
    paymentMethod: null,
    paymentAmount: null,
    items: [],
    discounts: [],
    ...overrides,
  };
}

function makeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const stub = {
    createOrder: vi.fn(async (_rid: number, body: { items: unknown[] }) =>
      makeOrder(100, { items: [], orderNumber: "S-100" })),
    addOrderItems: vi.fn(async (_rid: number, oid: number) => makeOrder(oid)),
    payOrder: vi.fn(async (_rid: number, oid: number) => makeOrder(oid, { status: "completed", paymentStatus: "paid" })),
    createCustomer: vi.fn(async (_rid: number, body: { name?: string; phone?: string }): Promise<CustomerSummary> => ({
      id: 555, name: body.name ?? null, phone: body.phone ?? null, email: null,
    })),
    ...overrides,
  } as unknown as ApiClient;
  return stub;
}

function makeEngine(client: ApiClient, online = true): SyncEngine {
  return new SyncEngine(client, () => 1, () => null, () => online);
}

describe("SyncEngine.drain", () => {
  it("does nothing when offline", async () => {
    const client = makeClient();
    const engine = makeEngine(client, false);
    P.enqueue({ kind: "customers:create", idempotencyKey: "k", payload: { name: "x" } });
    await engine.drain();
    expect((client.createCustomer as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(P.pendingCount()).toBe(1);
  });

  it("drains a customers:create and removes the op", async () => {
    const client = makeClient();
    const engine = makeEngine(client);
    P.enqueue({
      kind: "customers:create", idempotencyKey: "k",
      payload: { name: "Ada", phone: "+91999" },
      localCustomerId: -1_000_001,
    });
    Q.upsertCustomers(1, [{ id: -1_000_001, name: "Ada", phone: "+91999", email: null }]);
    await engine.drain();
    expect((client.createCustomer as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(P.pendingCount()).toBe(0);
  });

  it("drains create → add-items → pay with ID remap between them", async () => {
    const client = makeClient();
    const engine = makeEngine(client);
    P.enqueue({
      kind: "orders:create", idempotencyKey: "c",
      payload: { orderType: "dine_in", items: [] },
      localOrderId: -1_000_010,
    });
    P.enqueue({
      kind: "orders:add-items", idempotencyKey: "i",
      payload: { orderId: -1_000_010, items: [] },
      localOrderId: -1_000_010,
    });
    P.enqueue({
      kind: "orders:pay", idempotencyKey: "p",
      payload: { orderId: -1_000_010, paymentMethod: "cash" },
      localOrderId: -1_000_010,
    });
    // Seed a local-only order row so remapOrderId has something to upgrade.
    Q.upsertOrder(makeOrder(-1_000_010), { restaurantId: 1, branchId: null, localOnly: true, localId: -1_000_010 });

    await engine.drain();

    expect(P.pendingCount()).toBe(0);
    const calls = (client.addOrderItems as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calls[1]).toBe(100); // remapped to server id from createOrder stub
    const payCalls = (client.payOrder as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payCalls[1]).toBe(100);
  });

  it("captures a 4xx as a conflict, does not retry, and cascades dependents", async () => {
    const client = makeClient({
      createOrder: vi.fn(async () => { throw new ApiError(422, "Bad payload"); }),
    } as Partial<ApiClient>);
    const engine = makeEngine(client);
    const create = P.enqueue({
      kind: "orders:create", idempotencyKey: "c",
      payload: { orderType: "dine_in", items: [] },
      localOrderId: -1_000_020,
    });
    const pay = P.enqueue({
      kind: "orders:pay", idempotencyKey: "p",
      payload: { orderId: -1_000_020, paymentMethod: "cash" },
      localOrderId: -1_000_020,
    });

    await engine.drain();

    expect(P.getOp(create.id)!.status).toBe("conflict");
    expect(P.getOp(pay.id)!.status).toBe("conflict");
    const conflicts = P.listConflicts();
    expect(conflicts.length).toBeGreaterThanOrEqual(2);
    expect(engine.status().lastError).toContain("Bad payload");
  });

  it("retries 5xx by marking failed, scheduling back-off, then succeeding", async () => {
    vi.useFakeTimers();
    try {
      let attempt = 0;
      const client = makeClient({
        createCustomer: vi.fn(async () => {
          attempt += 1;
          if (attempt === 1) throw new ApiError(503, "server boom");
          return { id: 777, name: "Ada", phone: null, email: null };
        }),
      } as Partial<ApiClient>);
      const engine = makeEngine(client);
      const op = P.enqueue({ kind: "customers:create", idempotencyKey: "k", payload: { name: "Ada" } });

      await engine.drain();
      expect(P.getOp(op.id)!.status).toBe("failed");
      expect(engine.status().lastError).toContain("server boom");

      // Advance fake timer so the scheduled retry fires.
      await vi.advanceTimersByTimeAsync(5_000);
      // Allow microtasks queued inside the retry to settle.
      await vi.runAllTimersAsync();
      expect(P.pendingCount()).toBe(0);
      expect(attempt).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry on 408/429 as conflicts — they are treated as transient", async () => {
    const client = makeClient({
      createCustomer: vi.fn(async () => { throw new ApiError(429, "rate limited"); }),
    } as Partial<ApiClient>);
    const engine = makeEngine(client);
    const op = P.enqueue({ kind: "customers:create", idempotencyKey: "k", payload: { name: "Ada" } });
    await engine.drain();
    expect(P.getOp(op.id)!.status).toBe("failed");
    expect(P.listConflicts()).toHaveLength(0);
  });

  it("waits for parent create before draining a dependent op with negative orderId", async () => {
    // Only enqueue the dependent op (no create). isReady() should keep it
    // pending, so the engine drains nothing and reports the gate.
    const client = makeClient();
    const engine = makeEngine(client);
    P.enqueue({
      kind: "orders:pay", idempotencyKey: "p",
      payload: { orderId: -42, paymentMethod: "cash" },
      localOrderId: -42,
    });
    await engine.drain();
    expect((client.payOrder as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(P.pendingCount()).toBe(1);
  });
});

describe("SyncEngine.status", () => {
  it("reports pending count and lastRunAt after a drain", async () => {
    const client = makeClient();
    const engine = makeEngine(client);
    expect(engine.status().lastRunAt).toBeNull();
    P.enqueue({ kind: "customers:create", idempotencyKey: "k", payload: { name: "x" } });
    await engine.drain();
    expect(engine.status().lastRunAt).not.toBeNull();
    expect(engine.status().pending).toBe(0);
  });
});
