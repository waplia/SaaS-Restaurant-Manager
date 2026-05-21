import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  customFetch,
  listKitchenTickets,
  getListKitchenTicketsQueryKey,
} from "@workspace/api-client-react";
import type { KitchenTicket, OrderItemDetail } from "@workspace/api-client-react";

export interface KdsKitchen {
  id: number;
  name: string;
  isDefault?: boolean;
  isActive?: boolean;
  autoPrint?: boolean;
  printerName?: string | null;
  paperSize?: string | null;
  sortOrder?: number;
}

export interface KdsItemModifier {
  id: number;
  name: string;
  groupName?: string | null;
  quantity: number;
}

export interface KdsItem extends OrderItemDetail {
  modifiers?: KdsItemModifier[];
  menuItemImageUrl?: string | null;
}

export interface KdsTicket extends Omit<KitchenTicket, "items"> {
  items: KdsItem[];
  kitchen?: { id: number; name: string; autoPrint?: boolean; printerName?: string | null; paperSize?: string | null } | null;
  kitchenId?: number | null;
  paymentStatus?: string | null;
  customerName?: string | null;
  elapsedMinutes?: number;
  overdueMinutes?: number;
  isDelayed?: boolean;
  expectedPrepMinutes?: number | null;
  delayAlertCount?: number;
}

export type KdsTabKey = "new" | "preparing" | "ready" | "history" | "settings";
export type KdsFilterKey = "all" | "dine_in" | "takeaway" | "delivery" | "online" | "delayed";

const TAB_STATUSES: Record<Exclude<KdsTabKey, "settings">, Set<string>> = {
  new: new Set(["new", "pending"]),
  preparing: new Set(["preparing", "in_progress"]),
  ready: new Set(["ready"]),
  // Cancelled / rejected tickets are not shown on the KDS — they're not
  // actionable for the kitchen and only add noise. They remain in the
  // order record for accounting / audit purposes.
  history: new Set(["served", "completed"]),
};

const ORDER_TYPE_FILTER: Record<KdsFilterKey, (t: KdsTicket) => boolean> = {
  all: () => true,
  dine_in: (t) => (t.orderType ?? "dine_in") === "dine_in",
  takeaway: (t) => (t.orderType ?? "") === "takeaway",
  delivery: (t) => (t.orderType ?? "") === "delivery",
  online: (t) => {
    const ot = t.orderType ?? "";
    return ot === "online" || ot === "online_order" || ot === "qr";
  },
  delayed: (t) => !!t.isDelayed || (t.overdueMinutes ?? 0) > 0,
};

export function useKitchensList(restaurantId: number) {
  return useQuery({
    queryKey: ["kds", "kitchens", restaurantId] as const,
    queryFn: () =>
      customFetch<KdsKitchen[]>(`/api/restaurants/${restaurantId}/kitchens`),
    staleTime: 60_000,
    enabled: !!restaurantId,
  });
}

export function useKdsTickets(restaurantId: number, params: { pollMs?: number } = {}) {
  const pollMs = params.pollMs ?? 15_000;
  const queryKey = getListKitchenTicketsQueryKey(restaurantId);
  const query = useQuery({
    queryKey,
    queryFn: () => listKitchenTickets(restaurantId),
    refetchInterval: pollMs,
    enabled: !!restaurantId,
  });
  return { ...query, queryKey };
}

export interface KdsBuckets {
  byTab: Record<Exclude<KdsTabKey, "settings">, KdsTicket[]>;
  counts: Record<Exclude<KdsTabKey, "settings">, number>;
  delayedCount: number;
  filtered: KdsTicket[];
  stations: KdsKitchen[];
}

export function bucketTickets(
  raw: KdsTicket[] | undefined,
  options: {
    tab: KdsTabKey;
    filter: KdsFilterKey;
    stationId: number | "all";
    delayedThresholdMin: number;
  },
): KdsBuckets {
  const list = Array.isArray(raw) ? raw : [];
  const withDelay = list.map((t) => {
    const elapsed = t.elapsedMinutes ?? Math.floor((Date.now() - new Date(t.createdAt ?? Date.now()).getTime()) / 60000);
    const overdue = t.overdueMinutes ?? 0;
    const isDelayed = t.isDelayed || overdue > 0 || elapsed >= options.delayedThresholdMin;
    return { ...t, elapsedMinutes: elapsed, isDelayed };
  });

  const byStation = options.stationId === "all"
    ? withDelay
    : withDelay.filter((t) => (t.kitchenId ?? null) === options.stationId);

  const byTab: KdsBuckets["byTab"] = {
    new: byStation.filter((t) => TAB_STATUSES.new.has(String(t.status))),
    preparing: byStation.filter((t) => TAB_STATUSES.preparing.has(String(t.status))),
    ready: byStation.filter((t) => TAB_STATUSES.ready.has(String(t.status))),
    history: byStation.filter((t) => TAB_STATUSES.history.has(String(t.status))),
  };

  const counts: KdsBuckets["counts"] = {
    new: byTab.new.length,
    preparing: byTab.preparing.length,
    ready: byTab.ready.length,
    history: byTab.history.length,
  };

  const delayedCount = byStation.filter((t) => t.isDelayed && TAB_STATUSES.history.has(String(t.status)) === false).length;

  const tabList = options.tab === "settings" ? [] : byTab[options.tab];
  const filtered = tabList.filter(ORDER_TYPE_FILTER[options.filter]);

  return { byTab, counts, delayedCount, filtered, stations: [] };
}

export function useKdsBuckets(
  tickets: KdsTicket[] | undefined,
  tab: KdsTabKey,
  filter: KdsFilterKey,
  stationId: number | "all",
  delayedThresholdMin: number,
) {
  return useMemo(
    () => bucketTickets(tickets, { tab, filter, stationId, delayedThresholdMin }),
    [tickets, tab, filter, stationId, delayedThresholdMin],
  );
}
