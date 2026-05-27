import React, { useMemo, useState } from "react";
import { View, Pressable, ScrollView, RefreshControl } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listOrders,
  getListOrdersQueryKey,
  type OrderList,
} from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import { useTheme } from "@/theme";
import {
  AppText, AppIcon, AppCard, AppEmptyState, StatusChip, AppButton,
} from "@/components/ui";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { OfflineBanner } from "@/components/OfflineBanner";
import { DeviceStatusStrip } from "@/components/cashier/DeviceStatusStrip";
import { useAuth } from "@/context/AuthContext";
import { cashierFetch } from "@/lib/cashierApi";

type FilterKey = "all" | "dine_in" | "takeaway" | "delivery" | "qr" | "held";

const FILTERS: Array<{ key: FilterKey; label: string; icon: "grid-outline" | "fast-food-outline" | "bag-handle-outline" | "bicycle-outline" | "qr-code-outline" | "hourglass-outline" }> = [
  { key: "all",      label: "All",       icon: "grid-outline" },
  { key: "held",     label: "Held",      icon: "hourglass-outline" },
  { key: "dine_in",  label: "Dine-in",   icon: "fast-food-outline" },
  { key: "qr",       label: "QR",        icon: "qr-code-outline" },
  { key: "takeaway", label: "Takeaway",  icon: "bag-handle-outline" },
  { key: "delivery", label: "Delivery",  icon: "bicycle-outline" },
];

const OPEN_STATUSES = "pending,confirmed,preparing,ready,served,delivered,bill_requested";

function statusTone(status: string): "info" | "warning" | "success" | "neutral" | "primary" {
  switch (status) {
    case "ready":
    case "served":
    case "delivered": return "success";
    case "preparing": return "info";
    case "pending": return "warning";
    case "bill_requested": return "warning";
    case "confirmed": return "primary";
    default: return "neutral";
  }
}

type Order = {
  id: number;
  orderNumber: string;
  orderType: string;
  status: string;
  paymentStatus?: string | null;
  totalAmount: string | number;
  tableLabel?: string | null;
  customerName?: string | null;
  itemCount?: number;
  createdAt: string;
  source?: string | null;
};

type HeldOrder = {
  orderId: number;
  orderNumber: string;
  tableId: number | null;
  totalAmount: string | number;
  customerName: string | null;
  customerPhone: string | null;
  createdAt: string;
  heldAt: string;
};

type BillRequest = {
  id: number;
  tableId: number | null;
  tableNumber: string | null;
  type: string;
  status: string;
  createdAt: string;
};

export default function CashierBillsScreen() {
  const t = useTheme();
  const { restaurantId, outletScopeId, accessToken } = useAuth();
  const qc = useQueryClient();
  const scopedId = outletScopeId ?? restaurantId;
  const params = useLocalSearchParams<{ filter?: string }>();
  const initialFilter = (FILTERS.find((f) => f.key === params.filter)?.key ?? "all") as FilterKey;
  const [filter, setFilter] = useState<FilterKey>(initialFilter);

  // Open orders queue
  const ordersQ = useQuery({
    queryKey: getListOrdersQueryKey(scopedId, { status: OPEN_STATUSES }),
    queryFn: () => listOrders(scopedId, { status: OPEN_STATUSES }),
    refetchInterval: 20_000,
    enabled: !!scopedId && !!accessToken,
  });

  // Held / pending guest-verification orders (QR self-orders awaiting accept)
  const heldQ = useQuery<HeldOrder[]>({
    queryKey: ["cashier-held", restaurantId],
    queryFn: () =>
      cashierFetch<HeldOrder[]>(
        accessToken,
        `/restaurants/${restaurantId}/guest-verifications`,
      ),
    refetchInterval: 15_000,
    enabled: !!accessToken && !!restaurantId,
  });

  // Active waiter-request "bill requested" pings from dine-in tables
  const requestsQ = useQuery<BillRequest[]>({
    queryKey: ["cashier-bill-requests", restaurantId],
    queryFn: () =>
      cashierFetch<BillRequest[]>(
        accessToken,
        `/restaurants/${restaurantId}/waiter-requests?status=pending,acknowledged`,
      ),
    refetchInterval: 20_000,
    enabled: !!accessToken && !!restaurantId,
  });

  const acceptMut = useMutation({
    mutationFn: (orderId: number) =>
      cashierFetch(accessToken, `/restaurants/${restaurantId}/orders/${orderId}/accept-guest`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cashier-held", restaurantId] });
      void qc.invalidateQueries({ queryKey: getListOrdersQueryKey(scopedId, { status: OPEN_STATUSES }) });
    },
    onError: (err: unknown) => {
      Alert.alert("Could not accept", err instanceof Error ? err.message : "Try again.");
    },
  });

  const rejectMut = useMutation({
    mutationFn: (orderId: number) =>
      cashierFetch(accessToken, `/restaurants/${restaurantId}/orders/${orderId}/reject-guest`, {
        method: "POST",
        body: JSON.stringify({ reason: "Guest not present" }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cashier-held", restaurantId] });
    },
    onError: (err: unknown) => {
      Alert.alert("Could not reject", err instanceof Error ? err.message : "Try again.");
    },
  });

  const billRequests = (requestsQ.data ?? []).filter((r) => r.type === "request_bill");
  const heldOrders = heldQ.data ?? [];

  const allOrders = useMemo<Order[]>(() => {
    const raw = (ordersQ.data as OrderList | undefined) ?? [];
    return (raw as unknown as Order[]);
  }, [ordersQ.data]);

  const filteredOrders = useMemo<Order[]>(() => {
    if (filter === "all" || filter === "held") return allOrders;
    return allOrders.filter((o) => {
      if (filter === "qr") return (o.source ?? "").toLowerCase() === "qr" || (o.orderType ?? "").toLowerCase() === "qr_order";
      return (o.orderType ?? "").toLowerCase() === filter;
    });
  }, [allOrders, filter]);

  const counts = useMemo(() => {
    const out: Record<FilterKey, number> = {
      all: allOrders.length,
      held: heldOrders.length,
      dine_in: 0, takeaway: 0, delivery: 0, qr: 0,
    };
    for (const o of allOrders) {
      const k = (o.orderType ?? "").toLowerCase();
      if (k === "dine_in") out.dine_in += 1;
      else if (k === "takeaway") out.takeaway += 1;
      else if (k === "delivery") out.delivery += 1;
      if ((o.source ?? "").toLowerCase() === "qr" || k === "qr_order") out.qr += 1;
    }
    return out;
  }, [allOrders, heldOrders.length]);

  const refreshAll = () => {
    void ordersQ.refetch();
    void heldQ.refetch();
    void requestsQ.refetch();
  };
  const refreshing = ordersQ.isRefetching || heldQ.isRefetching || requestsQ.isRefetching;

  // Bill-request map by tableId so dine-in rows can show "Bill requested" badge
  const billReqByTable = useMemo(() => {
    const m = new Map<number, BillRequest>();
    for (const r of billRequests) {
      if (r.tableId != null) m.set(r.tableId, r);
    }
    return m;
  }, [billRequests]);

  const showHeldSection = filter === "all" || filter === "held";
  const showOrders = filter !== "held" || filteredOrders.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader title="Bills" subtitle="Live billing queue" />
      <DeviceStatusStrip />
      <OfflineBanner />

      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  backgroundColor: active ? t.colors.primary : t.colors.card,
                  borderColor: active ? t.colors.primary : t.colors.border,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <AppIcon
                  name={f.icon}
                  size={14}
                  color={active ? "#fff" : "mutedForeground"}
                />
                <AppText
                  variant="small"
                  weight="semibold"
                  style={{ color: active ? "#fff" : t.colors.foreground }}
                >
                  {f.label} · {counts[f.key]}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            tintColor={t.colors.primary}
          />
        }
      >
        {/* ─── Held bills section (QR guest orders awaiting verification) ─── */}
        {showHeldSection && heldOrders.length > 0 ? (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <AppIcon name="hourglass-outline" size={14} color="#ca8a04" />
              <AppText variant="label" color="mutedForeground">
                HELD — AWAITING VERIFICATION
              </AppText>
            </View>
            {heldOrders.map((h) => {
              const time = new Date(h.heldAt ?? h.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              const busy = acceptMut.isPending || rejectMut.isPending;
              return (
                <AppCard key={h.orderId} padding={12} shadow="xs" style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <AppText variant="bodyMd" weight="semibold" numberOfLines={1}>
                          #{h.orderNumber}
                        </AppText>
                        <StatusChip label="QR · held" tone="warning" size="xs" />
                      </View>
                      <AppText variant="small" color="mutedForeground" numberOfLines={1}>
                        {h.customerName ?? "Guest"} · {time}
                      </AppText>
                    </View>
                    <AppText variant="bodyMd" weight="bold">
                      ₹{Number(h.totalAmount).toLocaleString("en-IN")}
                    </AppText>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <AppButton
                      label="Reject"
                      variant="outline"
                      size="sm"
                      leftIcon="close-outline"
                      onPress={() => rejectMut.mutate(h.orderId)}
                      disabled={busy}
                      style={{ flex: 1 }}
                    />
                    <AppButton
                      label="Accept & send to kitchen"
                      variant="primary"
                      size="sm"
                      leftIcon="checkmark-outline"
                      onPress={() => acceptMut.mutate(h.orderId)}
                      disabled={busy}
                      style={{ flex: 2 }}
                    />
                  </View>
                </AppCard>
              );
            })}
          </View>
        ) : null}

        {/* ─── Live orders ─── */}
        {showOrders && filteredOrders.length === 0 && heldOrders.length === 0 ? (
          <AppEmptyState
            icon="checkmark-circle-outline"
            title={filter === "held" ? "Nothing on hold" : "No open bills"}
            description={
              filter === "held"
                ? "QR self-orders awaiting staff verification will appear here."
                : "Tickets will appear here as soon as kitchen marks them ready, waiters mark them served, or a table requests the bill."
            }
          />
        ) : null}

        {showOrders
          ? filteredOrders.map((o) => {
              const time = new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              const isPaid = o.paymentStatus === "paid";
              const billReq = o.status === "bill_requested"
                || (o.tableLabel && billReqByTable.size > 0 && Array.from(billReqByTable.values()).some((r) => (r.tableNumber ?? "") === (o.tableLabel ?? "")));
              return (
                <Pressable
                  key={o.id}
                  onPress={() => router.push(`/(cashier)/pay/${o.id}` as never)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                >
                  <AppCard padding={12} shadow="xs" style={{ gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <AppText variant="bodyMd" weight="semibold" numberOfLines={1}>
                            #{o.orderNumber}
                          </AppText>
                          <StatusChip
                            label={(o.orderType ?? "order").replace("_", " ")}
                            tone="neutral"
                            size="xs"
                          />
                          <StatusChip
                            label={o.status.replace("_", " ")}
                            tone={statusTone(o.status)}
                            size="xs"
                          />
                          {billReq ? (
                            <StatusChip label="Bill requested" tone="warning" size="xs" icon="notifications" />
                          ) : null}
                        </View>
                        <AppText variant="small" color="mutedForeground" numberOfLines={1}>
                          {o.tableLabel ?? o.customerName ?? "Walk-in"} · {time}
                          {o.itemCount ? ` · ${o.itemCount} item${o.itemCount === 1 ? "" : "s"}` : ""}
                        </AppText>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 4 }}>
                        <AppText variant="bodyMd" weight="bold">
                          ₹{Number(o.totalAmount).toLocaleString("en-IN")}
                        </AppText>
                        {isPaid ? (
                          <StatusChip label="Paid" tone="success" size="xs" icon="checkmark" />
                        ) : (
                          <StatusChip label="Charge" tone="primary" size="xs" icon="card-outline" />
                        )}
                      </View>
                    </View>
                  </AppCard>
                </Pressable>
              );
            })
          : null}
      </ScrollView>
    </View>
  );
}
