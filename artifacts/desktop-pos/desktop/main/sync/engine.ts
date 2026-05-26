/**
 * Sync engine — drains the pending queue against the live API.
 *
 * Triggers:
 *   - Connectivity transitions to online.
 *   - A new op is enqueued while online (`triggerSync`).
 *   - The renderer requests `sync:run-now`.
 *   - A scheduled retry fires after a failed op's back-off elapses.
 *
 * Rules:
 *   - One op in-flight at a time.
 *   - Oldest first; dependent ops (add-items / pay, orders that reference a
 *     local customer) wait their turn so the ID remap from the preceding
 *     create propagates first.
 *   - 4xx ≠ 408/429/401 → captured as a conflict, not retried.
 *   - Other failures → marked `failed`, retried with exponential back-off
 *     scheduled via setTimeout (2s, 4s, 8s … capped at 60s).
 */

import { EventEmitter } from "node:events";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import {
  listPending, setStatus, removeOp, recordConflict, remapLocalOrderId,
  remapLocalCustomerId, pendingCount, getOp,
} from "../db/pending";
import type { PendingOp } from "../db/pending";
import { remapOrderId, upsertOrder, upsertCustomers } from "../db/queries";
import type {
  CreateOrderRequest, OrderDetailView, CartItemInput, PayMethod,
} from "../../shared/ipc-contract";

export interface SyncStatus {
  draining: boolean;
  pending: number;
  lastRunAt: number | null;
  lastError: string | null;
}

export class SyncEngine extends EventEmitter {
  private running = false;
  private lastRunAt: number | null = null;
  private lastError: string | null = null;
  private backoffMs = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private drainWaiters: Array<() => void> = [];

  constructor(
    private client: ApiClient,
    private restaurantIdProvider: () => number | null,
    private branchIdProvider: () => number | null,
    private isOnline: () => boolean,
  ) {
    super();
  }

  status(): SyncStatus {
    return {
      draining: this.running,
      pending: pendingCount(),
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
    };
  }

  /** Resolve once the current/next drain cycle ends. Used by the offline
   *  helpers to surface the server id immediately when online. */
  awaitDrain(timeoutMs = 3000): Promise<void> {
    if (!this.running && pendingCount() === 0) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = (): void => { if (!settled) { settled = true; resolve(); } };
      this.drainWaiters.push(done);
      setTimeout(done, timeoutMs);
    });
  }

  private notifyWaiters(): void {
    const w = this.drainWaiters;
    this.drainWaiters = [];
    for (const fn of w) fn();
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const wait = Math.min(60_000, this.backoffMs || 2_000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // Reset failed → pending so the drain picks them up again.
      for (const op of listPending()) {
        if (op.status === "failed") setStatus(op.id, "pending");
      }
      void this.drain();
    }, wait);
  }

  /** Try to drain the queue. Safe to call concurrently — only one drain
   *  actually runs at a time. */
  async drain(): Promise<void> {
    if (this.running) return;
    if (!this.isOnline()) return;
    this.running = true;
    this.emit("status", this.status());
    try {
      while (this.isOnline()) {
        const queue = listPending().filter((op) => op.status !== "conflict");
        if (queue.length === 0) { this.lastError = null; break; }
        const op = queue[0];
        // Guard: a dependent op (negative orderId or localCustomerId still
        // set) must wait until its parent create succeeds and rewrites the
        // payload. Skipping ahead would corrupt the sequence.
        if (!isReady(op)) { this.lastError = "Waiting for parent op"; break; }
        setStatus(op.id, "in-flight");
        this.emit("status", this.status());
        try {
          await this.executeOne(op);
          removeOp(op.id);
          this.lastError = null;
          this.backoffMs = 0;
        } catch (err) {
          if (err instanceof ApiError && isConflictStatus(err.status)) {
            recordConflict(op.id, op.kind, err.message, { status: err.status, body: err.body });
            // Cascade: any pending op that still depends on this parent
            // (negative orderId / customerId remap pending) would otherwise
            // sit at the head of the queue forever. Surface them as
            // conflicts too so the operator sees the whole chain in the
            // tray and can resolve it as a unit.
            this.cascadeDependents(op, err.message);
            this.lastError = err.message;
            this.emit("status", this.status());
            break;
          }
          setStatus(op.id, "failed", (err as Error).message);
          this.lastError = (err as Error).message;
          this.backoffMs = Math.min(60_000, (this.backoffMs || 1_000) * 2);
          this.emit("status", this.status());
          this.scheduleRetry();
          break;
        }
      }
    } finally {
      this.lastRunAt = Date.now();
      this.running = false;
      this.emit("status", this.status());
      this.notifyWaiters();
    }
  }

  private cascadeDependents(parent: PendingOp, reason: string): void {
    // Walk the queue and mark anything whose payload still references the
    // parent's local id (order or customer) as a conflict. Without this the
    // FIFO drain would dead-stop on the dependent op forever.
    const queue = listPending();
    for (const op of queue) {
      if (op.id === parent.id) continue;
      const p = op.payload as { orderId?: number; customerId?: number | null } | null;
      const refsLocalOrder = parent.localOrderId != null && (
        (typeof p?.orderId === "number" && p.orderId === parent.localOrderId) ||
        op.localOrderId === parent.localOrderId
      );
      const refsLocalCustomer = parent.localCustomerId != null && (
        (typeof p?.customerId === "number" && p.customerId === parent.localCustomerId) ||
        op.localCustomerId === parent.localCustomerId
      );
      if (refsLocalOrder || refsLocalCustomer) {
        recordConflict(op.id, op.kind, `Blocked by parent conflict: ${reason}`, {
          parentOpId: parent.id, parentKind: parent.kind,
        });
      }
    }
  }

  private async executeOne(op: PendingOp): Promise<void> {
    const restaurantId = this.restaurantIdProvider();
    if (!restaurantId) throw new Error("No active restaurant for sync.");
    switch (op.kind) {
      case "orders:create": {
        const body = op.payload as CreateOrderRequest & { branchId?: number | null };
        const server = await this.client.createOrder(restaurantId, {
          ...body,
          branchId: body.branchId ?? this.branchIdProvider() ?? null,
          idempotencyKey: op.idempotencyKey,
        });
        if (op.localOrderId != null) {
          remapOrderId(op.localOrderId, server, restaurantId, this.branchIdProvider() ?? null);
          remapLocalOrderId(op.localOrderId, server.id);
        } else {
          upsertOrder(server, { restaurantId, branchId: this.branchIdProvider() ?? null });
        }
        break;
      }
      case "orders:add-items": {
        const body = op.payload as { orderId: number; items: CartItemInput[] };
        const server = await this.client.addOrderItems(
          restaurantId, body.orderId, body.items ?? [], op.idempotencyKey,
        );
        upsertOrder(server, { restaurantId, branchId: this.branchIdProvider() ?? null });
        break;
      }
      case "orders:pay": {
        const body = op.payload as {
          orderId: number; paymentMethod: PayMethod; tipAmount?: number;
          stripePaymentIntentId?: string; razorpayPaymentId?: string;
          razorpayOrderId?: string; razorpaySignature?: string;
        };
        // Pass through every optional gateway field the cashier collected on
        // the renderer side. The server validates these for card/upi and
        // would 400 if we dropped them, leaving the local row stuck in a
        // paid-but-unsynced state.
        const server = await this.client.payOrder(
          restaurantId, body.orderId, {
            paymentMethod: body.paymentMethod,
            tipAmount: body.tipAmount,
            stripePaymentIntentId: body.stripePaymentIntentId,
            razorpayPaymentId: body.razorpayPaymentId,
            razorpayOrderId: body.razorpayOrderId,
            razorpaySignature: body.razorpaySignature,
          }, op.idempotencyKey,
        );
        upsertOrder(server, { restaurantId, branchId: this.branchIdProvider() ?? null });
        break;
      }
      case "customers:create": {
        const body = op.payload as { name?: string; phone?: string; email?: string };
        const server = await this.client.createCustomer(restaurantId, body);
        upsertCustomers(restaurantId, [server]);
        if (op.localCustomerId != null) remapLocalCustomerId(op.localCustomerId, server.id);
        break;
      }
      default:
        throw new Error(`Unknown pending op kind: ${op.kind}`);
    }
  }
}

function isReady(op: PendingOp): boolean {
  // A pending op is ready when:
  //   - it has no parent dependency markers, OR
  //   - its remap has already run (markers cleared).
  // Specifically: an order op whose payload still references a negative
  // orderId (from a parent create that hasn't drained yet) must wait.
  if (op.kind === "orders:add-items" || op.kind === "orders:pay") {
    const p = op.payload as { orderId?: number } | null;
    if (p && typeof p.orderId === "number" && p.orderId < 0) return false;
  }
  if (op.kind === "orders:create") {
    const p = op.payload as { customerId?: number | null } | null;
    if (p && typeof p.customerId === "number" && p.customerId < 0) return false;
  }
  return true;
}

function isConflictStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429 && status !== 401;
}

// Touch unused import so TS doesn't complain when the file is bundled.
void getOp;
export type { OrderDetailView };
