import React, { useMemo } from "react";
import { View, Pressable, ScrollView, RefreshControl } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  listOrders,
  getListOrdersQueryKey,
  type OrderList,
} from "@workspace/api-client-react";
import { useTheme } from "@/theme";
import { AppText, AppCard, AppIcon, AppEmptyState, StatusChip } from "@/components/ui";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { OfflineBanner } from "@/components/OfflineBanner";
import { DeviceStatusStrip } from "@/components/cashier/DeviceStatusStrip";
import { useAuth } from "@/context/AuthContext";

// Cashier counter queue. The previous filter (`status: "served,ready,delivered"`)
// was a no-op because `orders.status` never holds any of those values — those
// strings live on `kitchen_tickets.status` and `order_items.status`, not on the
// order row. As a result every cashier saw "0 tickets" even when there were
// served-but-unpaid tables waiting.
//
// The correct filter is "any unpaid open order": orders that are still in the
// running-bill / bill-generated lifecycle (i.e. not completed/cancelled) AND
// whose paymentStatus is anything other than `paid`.
const CASHIER_OPEN_STATUSES = "pending,bill_generated";
const CASHIER_UNPAID = "unpaid,partially_paid";

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
};

export default function CashierPaymentsScreen() {
  const t = useTheme();
  const { restaurantId, outletScopeId, accessToken } = useAuth();
  const scopedId = outletScopeId ?? restaurantId;

  // The generated `ListOrdersParams` type only declares `status` and a few
  // basics, but the server (`GET /restaurants/:id/orders`) accepts
  // `paymentStatus` as a comma-separated multi-value filter too — the URL
  // builder forwards every key on the params object verbatim. Cast through
  // unknown so we can pass the extra filter without regenerating the client.
  const queryParams = {
    status: CASHIER_OPEN_STATUSES,
    paymentStatus: CASHIER_UNPAID,
  } as unknown as Parameters<typeof listOrders>[1];

  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: getListOrdersQueryKey(scopedId, queryParams),
    queryFn: () => listOrders(scopedId, queryParams),
    refetchInterval: 15_000,
    enabled: !!scopedId && !!accessToken,
  });

  // Defensive client-side filter: even though the server already excludes
  // `paid` rows, keep the safety net so a stale cache or a race-y refetch
  // never surfaces a fully-paid ticket on the counter.
  const unpaid = useMemo(() => {
    const raw = (data?.data ?? []) as unknown as Order[];
    return raw.filter((o) => o.paymentStatus !== "paid");
  }, [data]);

  const grandTotal = unpaid.reduce((s, o) => s + Number(o.totalAmount), 0);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader title="Payments" subtitle="Charge ready tickets" />
      <DeviceStatusStrip />
      <OfflineBanner />

      <View
        style={{
          marginHorizontal: 12,
          marginTop: 8,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderRadius: 14,
          backgroundColor: t.colors.accent,
          borderWidth: 1,
          borderColor: t.colors.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View>
          <AppText variant="micro" color="mutedForeground">WAITING TO BE CHARGED</AppText>
          <AppText variant="h2">{unpaid.length} ticket{unpaid.length === 1 ? "" : "s"}</AppText>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <AppText variant="micro" color="mutedForeground">UNPAID TOTAL</AppText>
          <AppText variant="h2" color="primary">₹{grandTotal.toLocaleString("en-IN")}</AppText>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => { void refetch(); }}
            tintColor={t.colors.primary}
          />
        }
      >
        {!isLoading && unpaid.length === 0 ? (
          <AppEmptyState
            icon="happy-outline"
            title="Counter is clear"
            description="Every served ticket has been paid. New ones will pop up here automatically."
          />
        ) : null}

        {unpaid.map((o) => {
          const time = new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return (
            <Pressable
              key={o.id}
              onPress={() => router.push(`/(cashier)/pay/${o.id}` as never)}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <AppCard padding={14} shadow="xs" style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <AppText variant="bodyMd" weight="semibold" numberOfLines={1}>#{o.orderNumber}</AppText>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <StatusChip
                        label={(o.orderType ?? "order").replace("_", " ")}
                        tone="neutral"
                        size="xs"
                      />
                      <AppText variant="small" color="mutedForeground" numberOfLines={1}>
                        {o.tableLabel ?? o.customerName ?? "Walk-in"} · {time}
                      </AppText>
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <AppText variant="h3" color="primary">
                      ₹{Number(o.totalAmount).toLocaleString("en-IN")}
                    </AppText>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <AppText variant="small" color="primary" weight="semibold">Pay</AppText>
                      <AppIcon name="chevron-forward" size={16} color="primary" />
                    </View>
                  </View>
                </View>
              </AppCard>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
