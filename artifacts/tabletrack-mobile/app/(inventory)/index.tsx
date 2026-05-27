import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listInventoryItems, getListInventoryItemsQueryKey } from "@workspace/api-client-react";
import {
  RoleHomeCard, QuickActionButton, AppText, AppEmptyState,
} from "@/components/ui";
import { RoleShellScreen } from "@/components/RoleShellScreen";
import { useAuth } from "@/context/AuthContext";

/**
 * Inventory manager home. Highlights low-stock alerts and provides quick
 * actions for receiving POs, recording transfers, and managing vendors.
 */
export default function InventoryHome() {
  const { restaurantId, outletScopeId } = useAuth();
  const scopedId = outletScopeId ?? restaurantId;
  const { data: items, isError, isRefetching, refetch } = useQuery({
    queryKey: getListInventoryItemsQueryKey(scopedId),
    queryFn: () => listInventoryItems(scopedId),
    refetchInterval: 60_000,
  });
  const lowStock = Array.isArray(items)
    ? items.filter((i) => {
        const stock = Number((i as { currentStock?: unknown }).currentStock ?? 0);
        const min = Number((i as { reorderLevel?: unknown }).reorderLevel ?? 0);
        return min > 0 && stock <= min;
      }).length
    : 0;

  return (
    <RoleShellScreen
      title="Inventory"
      subtitle="Stock health"
      onRefresh={refetch}
      refreshing={isRefetching}
    >
      <RoleHomeCard
        eyebrow={lowStock > 0 ? "Action needed" : "Healthy"}
        icon="cube-outline"
        title="Low-stock items"
        value={String(lowStock)}
        subtitle={lowStock > 0
          ? "Items at or below their reorder level."
          : "Every tracked item is above its reorder level."}
        badge={lowStock > 0 ? { label: String(lowStock), tone: "warning" } : undefined}
        onPress={() => router.push("/(owner)/inventory" as never)}
      />

      <AppText variant="h3" style={{ marginTop: 8 }}>Quick actions</AppText>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <QuickActionButton icon="cube-outline" label="Stock list" onPress={() => router.push("/(owner)/inventory" as never)} />
        <QuickActionButton icon="restaurant-outline" label="Menu" onPress={() => router.push("/(owner)/menu" as never)} />
        <QuickActionButton icon="checkmark-done-outline" label="Approvals" onPress={() => router.push("/(owner)/approvals" as never)} />
      </View>

      {isError ? (
        <AppEmptyState
          icon="warning-outline"
          title="Couldn't load stock"
          description="Pull to refresh and try again."
          style={{ marginTop: 16 }}
        />
      ) : null}
    </RoleShellScreen>
  );
}
