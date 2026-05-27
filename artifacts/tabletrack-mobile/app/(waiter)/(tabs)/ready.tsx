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

  const readyRows = useMemo(() => {
    const rows: Array<{
      tableId: number;
      tableLabel: string;
      orderId: number;
      itemId: number;
      menuItemName: string;
      quantity: number;
      readyAt: string | null;
      readySinceMin: number;
    }> = [];
    for (const [tableId, s] of summaries.entries()) {
      for (const it of s.readyItems) {
        const readyAt = it.readyAt ?? null;
        const since = readyAt
          ? Math.max(0, Math.floor((Date.now() - new Date(readyAt).getTime()) / 60_000))
          : 0;
        rows.push({
          tableId,
          tableLabel: tableLabelById.get(tableId) ?? `T${tableId}`,
          orderId: s.orderId,
          itemId: it.id,
          menuItemName: it.menuItemName,
          quantity: it.quantity,
          readyAt,
          readySinceMin: since,
        });
      }
    }
    // Oldest-ready first so the floor never lets a plate go cold.
    rows.sort((a, b) => b.readySinceMin - a.readySinceMin);
    return rows;
  }, [summaries, tableLabelById]);

  const handleMarkServed = async (row: typeof readyRows[number]) => {
    try {
      await markStatus.mutateAsync({ orderId: row.orderId, itemId: row.itemId, status: "served" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not mark served.";
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
          {readyRows.length === 0
            ? "Nothing waiting at the pass."
            : `${readyRows.length} item${readyRows.length === 1 ? "" : "s"} waiting at the pass`}
        </AppText>
      </View>

      {tablesQ.isLoading ? (
        <ActivityIndicator color={t.colors.primary} style={{ marginTop: 40 }} />
      ) : readyRows.length === 0 ? (
        <AppEmptyState
          icon="checkmark-done-outline"
          title="All caught up"
          description="No items are ready right now. The kitchen will ping you here when food is up."
        />
      ) : (
        <FlatList
          data={readyRows}
          keyExtractor={(r) => `${r.orderId}:${r.itemId}`}
          contentContainerStyle={{
            padding: t.spacing.lg,
            gap: t.spacing.sm,
            paddingBottom: insets.bottom + 120,
          }}
          refreshControl={
            <RefreshControl
              refreshing={tablesQ.isRefetching}
              onRefresh={refetchAll}
              tintColor={t.colors.primary}
            />
          }
          renderItem={({ item: row }) => {
            const stale = row.readySinceMin >= 5;
            return (
              <AppCard padding={t.spacing.md}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open running order for ${row.tableLabel}`}
                    onPress={() => router.push({
                      pathname: "/running-order/[tableId]",
                      params: { tableId: String(row.tableId), tableLabel: row.tableLabel },
                    } as never)}
                    style={{ flex: 1, gap: 4 }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <AppBadge label={row.tableLabel} tone="info" variant="soft" />
                      <AppBadge label={`×${row.quantity}`} tone="neutral" variant="soft" />
                      <AppBadge
                        label={row.readyAt ? `${row.readySinceMin}m ready` : "Ready"}
                        tone={stale ? "danger" : "warning"}
                        variant="soft"
                      />
                    </View>
                    <AppText variant="bodyMd" weight="semibold" numberOfLines={2}>
                      {row.menuItemName}
                    </AppText>
                  </Pressable>
                  {canMarkServed ? (
                    <AppButton
                      label="Served"
                      variant="primary"
                      size="sm"
                      leftIcon="checkmark-circle-outline"
                      loading={markStatus.isPending && markStatus.variables?.itemId === row.itemId}
                      onPress={() => handleMarkServed(row)}
                    />
                  ) : (
                    <AppIcon name="lock-closed-outline" size={18} color="mutedForeground" />
                  )}
                </View>
              </AppCard>
            );
          }}
        />
      )}
    </View>
  );
}
