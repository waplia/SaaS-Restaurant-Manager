import React, { useMemo } from "react";
import {
  View, FlatList, Platform, RefreshControl, ActivityIndicator, Pressable,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  listFloorTables, getListFloorTablesQueryKey,
} from "@workspace/api-client-react";
import type { FloorTable } from "@workspace/api-client-react";
import { useTheme } from "@/theme";
import { useAuth } from "@/context/AuthContext";
import {
  AppText, AppCard, AppBadge, AppButton, AppIcon, AppEmptyState,
} from "@/components/ui";
import { Alert } from "@/components/ui/AppAlert";
import { useRunningOrdersSummary, useSetItemKitchenStatus } from "@/hooks/useRunningOrder";
import { usePermission } from "@/hooks/usePermission";

/**
 * Task #637 — "Ready" queue tab. Lists every running-order item the
 * kitchen has marked as ready-to-serve, grouped by table. Tap the
 * "Served" bell on a line to flip the item's kitchen status to
 * `served`, which clears the row and updates the running-order screen
 * in real time. Backed entirely by `useRunningOrdersSummary` — no
 * separate endpoint, no mock data.
 */
export default function ReadyQueueScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const canMarkServed = usePermission("waiter.mark_served");
  const markStatus = useSetItemKitchenStatus();

  const tablesQ = useQuery({
    queryKey: getListFloorTablesQueryKey(restaurantId),
    queryFn: () => listFloorTables(restaurantId),
    refetchInterval: 20_000,
  });
  const tableList = (Array.isArray(tablesQ.data) ? tablesQ.data : []) as FloorTable[];
  const tableLabelById = useMemo(() => {
    const m = new Map<number, string>();
    for (const tt of tableList) m.set(tt.id, tt.tableNumber ?? `T${tt.id}`);
    return m;
  }, [tableList]);

  const occupiedIds = useMemo(
    () => tableList
      .filter((tt) => tt.status === "occupied" || tt.status === "bill_requested" || tt.status === "billed")
      .map((tt) => tt.id),
    [tableList],
  );
  const summaries = useRunningOrdersSummary(occupiedIds);

  // Group ready items into one card per order so the waiter sees the
  // food boxed under its order number — matching the KDS layout the
  // kitchen uses. Within each card we still sort the items oldest-first,
  // and the cards themselves sort by their oldest ready item so plates
  // closest to going cold are always at the top.
  type ReadyItem = {
    itemId: number;
    menuItemName: string;
    quantity: number;
    readyAt: string | null;
    readySinceMin: number;
  };
  type ReadyOrder = {
    tableId: number;
    tableLabel: string;
    orderId: number;
    /** Short per-day display number ("DN-023") preferred for the order
     *  header — long internal number is reserved for invoices. */
    orderNumber: string;
    items: ReadyItem[];
    oldestSinceMin: number;
  };
  const readyOrders = useMemo<ReadyOrder[]>(() => {
    const groups: ReadyOrder[] = [];
    for (const [tableId, s] of summaries.entries()) {
      if (!s.readyItems?.length) continue;
      const items: ReadyItem[] = s.readyItems.map((it) => {
        const readyAt = it.readyAt ?? null;
        const since = readyAt
          ? Math.max(0, Math.floor((Date.now() - new Date(readyAt).getTime()) / 60_000))
          : 0;
        return {
          itemId: it.id,
          menuItemName: it.menuItemName,
          quantity: it.quantity,
          readyAt,
          readySinceMin: since,
        };
      });
      items.sort((a, b) => b.readySinceMin - a.readySinceMin);
      groups.push({
        tableId,
        tableLabel: tableLabelById.get(tableId) ?? `T${tableId}`,
        orderId: s.orderId,
        orderNumber: s.orderDisplayNumber ?? s.orderNumber,
        items,
        oldestSinceMin: items[0]?.readySinceMin ?? 0,
      });
    }
    groups.sort((a, b) => b.oldestSinceMin - a.oldestSinceMin);
    return groups;
  }, [summaries, tableLabelById]);

  const totalReadyItems = useMemo(
    () => readyOrders.reduce((n, o) => n + o.items.length, 0),
    [readyOrders],
  );

  const handleMarkServed = async (args: { orderId: number; itemId: number }) => {
    try {
      await markStatus.mutateAsync({ orderId: args.orderId, itemId: args.itemId, status: "served" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not mark served.";
      Alert.alert("Failed", msg);
    }
  };

  const handleMarkOrderServed = async (order: ReadyOrder) => {
    try {
      await Promise.all(
        order.items.map((it) =>
          markStatus.mutateAsync({ orderId: order.orderId, itemId: it.itemId, status: "served" }),
        ),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not mark all served.";
      Alert.alert("Failed", msg);
    }
  };

  const refetchAll = () => {
    void tablesQ.refetch();
    void qc.invalidateQueries({ queryKey: ["running-order"] });
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{
        paddingTop: (isWeb ? 24 : insets.top) + t.spacing.md,
        paddingHorizontal: t.spacing.lg,
        paddingBottom: t.spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.border,
      }}>
        <AppText variant="h2" weight="bold">Ready to serve</AppText>
        <AppText variant="small" color="mutedForeground">
          {totalReadyItems === 0
            ? "Nothing waiting at the pass."
            : `${totalReadyItems} item${totalReadyItems === 1 ? "" : "s"} across ${readyOrders.length} order${readyOrders.length === 1 ? "" : "s"}`}
        </AppText>
      </View>

      {tablesQ.isLoading ? (
        <ActivityIndicator color={t.colors.primary} style={{ marginTop: 40 }} />
      ) : readyOrders.length === 0 ? (
        <AppEmptyState
          icon="checkmark-done-outline"
          title="All caught up"
          description="No items are ready right now. The kitchen will ping you here when food is up."
        />
      ) : (
        <FlatList
          data={readyOrders}
          keyExtractor={(o) => `order-${o.orderId}`}
          contentContainerStyle={{
            padding: t.spacing.lg,
            gap: t.spacing.md,
            paddingBottom: insets.bottom + 120,
          }}
          refreshControl={
            <RefreshControl
              refreshing={tablesQ.isRefetching}
              onRefresh={refetchAll}
              tintColor={t.colors.primary}
            />
          }
          renderItem={({ item: order }) => {
            const stale = order.oldestSinceMin >= 5;
            const borderColor = stale ? t.colors.destructive : t.colors.warning;
            return (
              <AppCard padding={0}>
                {/* Order header — prominent, matches the KDS "KOT #N" banner */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open running order for ${order.tableLabel}`}
                  onPress={() => router.push({
                    pathname: "/running-order/[tableId]",
                    params: { tableId: String(order.tableId), tableLabel: order.tableLabel },
                  } as never)}
                  style={{
                    paddingHorizontal: t.spacing.md,
                    paddingVertical: t.spacing.sm,
                    borderTopLeftRadius: t.radius.md,
                    borderTopRightRadius: t.radius.md,
                    borderLeftWidth: 5,
                    borderLeftColor: borderColor,
                    backgroundColor: t.colors.muted,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: t.spacing.sm,
                    justifyContent: "space-between",
                  }}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <AppText variant="h3" weight="bold">Order #{order.orderNumber}</AppText>
                      <AppBadge label={order.tableLabel} tone="info" variant="soft" />
                      <AppBadge
                        label={`${order.oldestSinceMin}m ready`}
                        tone={stale ? "danger" : "warning"}
                        variant="soft"
                      />
                    </View>
                    <AppText variant="small" color="mutedForeground">
                      {order.items.length} item{order.items.length === 1 ? "" : "s"} ready to serve
                    </AppText>
                  </View>
                  {canMarkServed && order.items.length > 1 ? (
                    <AppButton
                      label="Serve all"
                      variant="primary"
                      size="sm"
                      leftIcon="checkmark-done-circle-outline"
                      onPress={() => handleMarkOrderServed(order)}
                    />
                  ) : null}
                </Pressable>

                {/* Items boxed inside the order card */}
                <View style={{ padding: t.spacing.md, gap: t.spacing.sm, borderLeftWidth: 5, borderLeftColor: borderColor, borderTopWidth: 0 }}>
                  {order.items.map((item) => {
                    const itemStale = item.readySinceMin >= 5;
                    return (
                      <View
                        key={item.itemId}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: t.spacing.sm,
                          padding: t.spacing.sm,
                          borderWidth: 1,
                          borderColor: t.colors.border,
                          borderRadius: t.radius.sm,
                          backgroundColor: t.colors.card,
                        }}
                      >
                        <View style={{ flex: 1, gap: 4 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <AppBadge label={`×${item.quantity}`} tone="neutral" variant="soft" />
                            <AppBadge
                              label={item.readyAt ? `${item.readySinceMin}m` : "Ready"}
                              tone={itemStale ? "danger" : "warning"}
                              variant="soft"
                            />
                          </View>
                          <AppText variant="bodyMd" weight="semibold" numberOfLines={2}>
                            {item.menuItemName}
                          </AppText>
                        </View>
                        {canMarkServed ? (
                          <AppButton
                            label="Served"
                            variant="primary"
                            size="sm"
                            leftIcon="checkmark-circle-outline"
                            loading={markStatus.isPending && markStatus.variables?.itemId === item.itemId}
                            onPress={() => handleMarkServed({ orderId: order.orderId, itemId: item.itemId })}
                          />
                        ) : (
                          <AppIcon name="lock-closed-outline" size={18} color="mutedForeground" />
                        )}
                      </View>
                    );
                  })}
                </View>
              </AppCard>
            );
          }}
        />
      )}
    </View>
  );
}
