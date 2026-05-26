/**
 * Offline-aware IPC helpers — guarantee that orders:create + orders:pay
 * (cash) synthesise local rows and enqueue exactly one op each. These tests
 * pin the local-first contract that the renderer relies on.
 */

import { describe, it, expect, vi } from "vitest";
import * as Offline from "../ipc/offline";
import * as P from "../db/pending";
import * as Q from "../db/queries";
import type { ApiClient } from "../api/client";
import type { MenuItem, RestaurantInfo } from "../../shared/ipc-contract";

function seedFixtures(): void {
  const info: RestaurantInfo = {
    id: 1, name: "T", taxRate: "5", serviceCharge: "10",
  } as unknown as RestaurantInfo;
  Q.kvSet(`restaurant_info:1`, JSON.stringify(info));
  const items: MenuItem[] = [
    { id: 10, name: "Burger", price: "100", isAvailable: true } as unknown as MenuItem,
    { id: 11, name: "Fries", price: "50", isAvailable: true } as unknown as MenuItem,
  ];
  Q.upsertMenuItems(1, items);
}

function makeCtx(overrides: Partial<Offline.OfflineContext> = {}): Offline.OfflineContext {
  const client = {} as unknown as ApiClient;
  return {
    client,
    isOnline: () => false,
    restaurantId: () => 1,
    branchId: () => null,
    triggerSync: vi.fn(),
    awaitDrain: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("offline.createOrder", () => {
  it("synthesises a local row and enqueues exactly one orders:create op", async () => {
    seedFixtures();
    const ctx = makeCtx();
    const before = P.listAll().length;
    const detail = await Offline.createOrder(ctx, {
      orderType: "dine_in",
      items: [{ menuItemId: 10, quantity: 2 }, { menuItemId: 11, quantity: 1 }],
    });
    expect(detail.id).toBeLessThan(0);
    expect(detail.items).toHaveLength(2);
    expect(Number(detail.subtotal)).toBe(250);
    // 5% tax + 10% svc on 250 = 12.5 + 25 = 37.5 → total 287.5
    expect(Number(detail.totalAmount)).toBeCloseTo(287.5, 2);

    const after = P.listAll();
    expect(after.length - before).toBe(1);
    const op = after.find((o) => o.kind === "orders:create" && o.localOrderId === detail.id);
    expect(op).toBeDefined();
    expect(ctx.triggerSync).toHaveBeenCalledTimes(1);

    // Local order row is queryable.
    const fromCache = Q.getOrder(detail.id);
    expect(fromCache).not.toBeNull();
    expect(fromCache!.orderNumber).toMatch(/^L-/);
  });

  it("tags the op with localCustomerId when caller used a negative id", async () => {
    seedFixtures();
    const ctx = makeCtx();
    await Offline.createOrder(ctx, {
      orderType: "takeaway",
      customerId: -1_000_555,
      items: [{ menuItemId: 10, quantity: 1 }],
    });
    const op = P.listAll()[0];
    expect(op.localCustomerId).toBe(-1_000_555);
  });
});

describe("offline.payOrder (cash)", () => {
  it("marks the local order paid + completed and enqueues exactly one orders:pay op", async () => {
    seedFixtures();
    const ctx = makeCtx();
    const created = await Offline.createOrder(ctx, {
      orderType: "dine_in",
      items: [{ menuItemId: 10, quantity: 1 }],
    });
    const queueBefore = P.listAll().length;

    const paid = await Offline.payOrder(ctx, {
      orderId: created.id, paymentMethod: "cash",
    });

    expect(paid.paymentStatus).toBe("paid");
    expect(paid.status).toBe("completed");
    expect(paid.paymentMethod).toBe("cash");
    expect(paid.isRunningOrder).toBe(false);

    const queueAfter = P.listAll();
    expect(queueAfter.length - queueBefore).toBe(1);
    // Find by kind+localOrderId so the assertion doesn't depend on
    // queue ordering when timestamps collide at millisecond resolution.
    const payOp = queueAfter.find((o) => o.kind === "orders:pay" && o.localOrderId === created.id);
    expect(payOp).toBeDefined();
    expect((payOp!.payload as { paymentMethod: string }).paymentMethod).toBe("cash");
    expect(ctx.triggerSync).toHaveBeenCalled();
  });

  it("rejects non-cash payments while offline", async () => {
    seedFixtures();
    const ctx = makeCtx();
    const created = await Offline.createOrder(ctx, {
      orderType: "dine_in",
      items: [{ menuItemId: 10, quantity: 1 }],
    });
    await expect(
      Offline.payOrder(ctx, { orderId: created.id, paymentMethod: "card" }),
    ).rejects.toThrow(/Offline payments are limited to cash/);
  });
});

describe("offline.createCustomer", () => {
  it("synthesises a local row, enqueues one customers:create, and returns synth offline", async () => {
    const ctx = makeCtx();
    const c = await Offline.createCustomer(ctx, { name: "Ada", phone: "+91999" });
    expect(c.id).toBeLessThan(0);
    expect(c.name).toBe("Ada");
    const ops = P.listAll();
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("customers:create");
    expect(ops[0].localCustomerId).toBe(c.id);
  });
});

describe("offline.addOrderItems", () => {
  it("merges totals locally and enqueues exactly one orders:add-items op", async () => {
    seedFixtures();
    const ctx = makeCtx();
    const created = await Offline.createOrder(ctx, {
      orderType: "dine_in",
      items: [{ menuItemId: 10, quantity: 1 }],
    });
    const before = P.listAll().length;
    const merged = await Offline.addOrderItems(ctx, {
      orderId: created.id,
      items: [{ menuItemId: 11, quantity: 2 }],
    });
    expect(merged.items).toHaveLength(2);
    expect(Number(merged.subtotal)).toBeCloseTo(100 + 100, 2);
    const ops = P.listAll();
    expect(ops.length - before).toBe(1);
    // Find by kind to avoid coupling to listAll's ordering when two ops
    // land in the same millisecond.
    const addOp = ops.find((o) => o.kind === "orders:add-items");
    expect(addOp).toBeDefined();
  });
});
