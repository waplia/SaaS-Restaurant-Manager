import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";

export type RunningOrderItem = {
  id: number;
  orderId: number;
  menuItemId: number;
  menuItemName: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  notes?: string | null;
  status: "pending" | "preparing" | "ready" | "served" | "cancelled" | string;
  addedRoundNumber?: number;
  kotBatchId?: number | null;
  addedAt?: string;
  cancelledAt?: string | null;
};

export type KotBatch = {
  id: number;
  orderId: number;
  roundNumber: number;
  createdFor: "new" | "modified" | "cancelled" | string;
  source: string;
  createdAt: string;
};

export type RunningOrderResponse = {
  order:
    | (Record<string, unknown> & {
        id: number;
        orderNumber: string;
        status: string;
        paymentStatus: string;
        tableId: number | null;
        tableSessionId: number | null;
        isRunningOrder: boolean;
        subtotal?: string;
        taxAmount?: string;
        serviceCharge?: string;
        discountAmount?: string;
        tipAmount?: string;
        totalAmount: string;
        billGeneratedAt?: string | null;
        createdAt: string;
        runningTotal?: string;
      })
    | null;
  items?: RunningOrderItem[];
  kotBatches?: KotBatch[];
};

export type RunningOrderSettings = {
  enabled: boolean;
  autoMergeOnSameTable: boolean;
  askBeforeAdding: boolean;
  allowSeparateBill: boolean;
  afterBillBehavior: "block" | "allow" | "require_approval";
  qrAddToRunningBill: boolean;
};

export const runningOrderKeys = {
  active: (restaurantId: number, tableId: number) =>
    ["running-order", "active", restaurantId, tableId] as const,
  settings: (restaurantId: number) =>
    ["running-order", "settings", restaurantId] as const,
};

export function useActiveRunningOrder(tableId: number | null, opts?: { refetchInterval?: number }) {
  const { restaurantId } = useAuth();
  const enabled = !!restaurantId && !!tableId && tableId > 0;
  return useQuery<RunningOrderResponse>({
    queryKey: runningOrderKeys.active(restaurantId ?? 0, tableId ?? 0),
    queryFn: () =>
      customFetch<RunningOrderResponse>(
        `/api/restaurants/${restaurantId}/tables/${tableId}/active-order`,
      ),
    enabled,
    refetchInterval: opts?.refetchInterval ?? 15_000,
  });
}

export function useRunningOrderSettings() {
  const { restaurantId } = useAuth();
  return useQuery<RunningOrderSettings>({
    queryKey: runningOrderKeys.settings(restaurantId ?? 0),
    queryFn: () =>
      customFetch<RunningOrderSettings>(
        `/api/restaurants/${restaurantId}/settings/running-order`,
      ),
    enabled: !!restaurantId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useGenerateBill() {
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) =>
      customFetch(
        `/api/restaurants/${restaurantId}/orders/${orderId}/generate-bill`,
        {
          method: "POST",
          headers: { "X-Idempotency-Key": `genbill_${orderId}_${Date.now()}` },
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["running-order"] });
    },
  });
}

export function useModifyOrderItem() {
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      itemId,
      quantity,
      notes,
    }: {
      orderId: number;
      itemId: number;
      quantity?: number;
      notes?: string;
    }) =>
      customFetch(
        `/api/restaurants/${restaurantId}/orders/${orderId}/items/${itemId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ quantity, notes }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["running-order"] });
    },
  });
}

export function useCancelOrderItem() {
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, itemId }: { orderId: number; itemId: number }) =>
      customFetch(
        `/api/restaurants/${restaurantId}/orders/${orderId}/items/${itemId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["running-order"] });
    },
  });
}

/**
 * Task #602 — batch fetch the active-order summary for many tables at once
 * so the floor map can render running totals, item counts and elapsed
 * time per occupied tile. Uses `useQueries` so each fetch caches in
 * react-query under the same `runningOrderKeys.active` key the per-table
 * screens already use — no double-fetching when navigating between them.
 */
export type RunningOrderSummary = {
  tableId: number;
  orderId: number;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  runningTotal: string;
  itemCount: number;
  elapsedMinutes: number;
  billGeneratedAt: string | null;
  isRunningOrder: boolean;
  /** Task #637 — per-item kitchen-status breakdown so the floor map and
   *  Ready queue can derive Ordered/Preparing/Ready chips without
   *  re-fetching the active-order payload separately. */
  pendingCount: number;
  preparingCount: number;
  readyCount: number;
  servedCount: number;
  readyItems: Array<{
    id: number;
    menuItemName: string;
    quantity: number;
    readyAt?: string | null;
  }>;
};
export function useRunningOrdersSummary(tableIds: number[]) {
  const { restaurantId } = useAuth();
  const ids = Array.from(new Set(tableIds.filter((id) => Number.isFinite(id) && id > 0)));
  const queries = useQueries({
    queries: ids.map((tableId) => ({
      queryKey: runningOrderKeys.active(restaurantId ?? 0, tableId),
      queryFn: () =>
        customFetch<RunningOrderResponse>(
          `/api/restaurants/${restaurantId}/tables/${tableId}/active-order`,
        ),
      enabled: !!restaurantId && tableId > 0,
      refetchInterval: 20_000,
      staleTime: 10_000,
    })),
  });
  const map = new Map<number, RunningOrderSummary>();
  ids.forEach((tableId, i) => {
    const data = queries[i]?.data;
    const order = data?.order;
    if (!order) return;
    const items = (data?.items ?? []).filter((it) => it.status !== "cancelled");
    const elapsed = order.createdAt
      ? Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60_000))
      : 0;
    let pendingCount = 0;
    let preparingCount = 0;
    let readyCount = 0;
    let servedCount = 0;
    const readyItems: RunningOrderSummary["readyItems"] = [];
    for (const it of items) {
      const qty = Number(it.quantity) || 0;
      if (it.status === "pending") pendingCount += qty;
      else if (it.status === "preparing") preparingCount += qty;
      else if (it.status === "ready") {
        readyCount += qty;
        readyItems.push({
          id: it.id,
          menuItemName: it.menuItemName,
          quantity: qty,
          readyAt: (it as { readyAt?: string | null }).readyAt ?? null,
        });
      }
      else if (it.status === "served") servedCount += qty;
    }
    map.set(tableId, {
      tableId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      runningTotal: String(order.runningTotal ?? order.totalAmount ?? "0"),
      itemCount: items.reduce((s, it) => s + (Number(it.quantity) || 0), 0),
      elapsedMinutes: elapsed,
      billGeneratedAt: order.billGeneratedAt ?? null,
      isRunningOrder: !!order.isRunningOrder,
      pendingCount,
      preparingCount,
      readyCount,
      servedCount,
      readyItems,
    });
  });
  return map;
}

/** Task #602 — used by Running Order screen "Mark Served" action.
 *  Task #637 extends this to also accept "served" so the waiter can flip
 *  ready items directly from the floor without going through KDS. */
export function useSetItemKitchenStatus() {
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      itemId,
      status,
    }: {
      orderId: number;
      itemId: number;
      status: "pending" | "preparing" | "ready" | "served" | "out_of_stock";
    }) =>
      customFetch(
        `/api/restaurants/${restaurantId}/orders/${orderId}/items/${itemId}/kitchen-status`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["running-order"] });
    },
  });
}

/**
 * Task #637 — Create a staff-initiated waiter request (e.g. "Call
 * Manager" from the running-order screen). Backed by the new POST
 * /restaurants/:id/waiter-requests endpoint which fans out the same
 * notification + push as a diner-initiated request.
 */
export function useCreateStaffWaiterRequest() {
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tableId,
      type,
      note,
    }: {
      tableId?: number | null;
      type: "call_manager" | "call_waiter" | "request_bill" | "water" | "custom";
      note?: string | null;
    }) =>
      customFetch(`/api/restaurants/${restaurantId}/waiter-requests`, {
        method: "POST",
        body: JSON.stringify({ tableId: tableId ?? null, type, note: note ?? null }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["waiter-requests"] });
      qc.invalidateQueries({ queryKey: ["user-notifications"] });
    },
  });
}

/** Task #602 — free the floor table after the bill is settled. */
export function useFreeTable() {
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tableId: number) =>
      customFetch(`/api/restaurants/${restaurantId}/tables/${tableId}/mark-clean`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["running-order"] });
      qc.invalidateQueries({ queryKey: ["/restaurants", restaurantId, "tables"] });
    },
  });
}

/**
 * Task #602 — Add items to an existing running order with the policy
 * gates the server expects (askBeforeAdding + post-bill behavior). Callers
 * supply a `managerPin` when the server returned REQUIRES_APPROVAL on a
 * previous attempt.
 */
export function useAppendItemToRunningOrder() {
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      menuItemId,
      quantity,
      notes,
      modifiers,
      managerPin,
    }: {
      orderId: number;
      menuItemId: number;
      quantity: number;
      notes?: string;
      modifiers?: Array<{ modifierId: number; quantity: number }>;
      managerPin?: string;
    }) =>
      customFetch(`/api/restaurants/${restaurantId}/orders/${orderId}/items`, {
        method: "POST",
        body: JSON.stringify({ menuItemId, quantity, notes, modifiers, managerPin }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["running-order"] });
    },
  });
}

export function useSettleRunningOrder() {
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      amount,
      method,
      notes,
    }: {
      orderId: number;
      amount: number;
      method: string;
      notes?: string;
    }) =>
      customFetch(`/api/restaurants/${restaurantId}/payments/settle`, {
        method: "POST",
        body: JSON.stringify({
          referenceType: "order",
          referenceId: orderId,
          amount,
          method,
          notes,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["running-order"] });
    },
  });
}
