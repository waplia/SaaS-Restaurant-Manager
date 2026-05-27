import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listOrders, getListOrdersQueryKey } from "@workspace/api-client-react";
import {
  RoleHomeCard, QuickActionButton, AppText, AppEmptyState,
} from "@/components/ui";
import { RoleShellScreen } from "@/components/RoleShellScreen";
import { useAuth } from "@/context/AuthContext";

/**
 * Chef/Kitchen home. Surfaces today's in-flight KOTs and quick actions
 * for the Kitchen Display, the menu (for 86-ing items), and inventory.
 * Real KDS lives at /(owner)/kitchen — this is the launchpad.
 */
export default function ChefHome() {
  const { restaurantId, outletScopeId } = useAuth();
  // When the user switches outlets via the header sheet, refetch against
  // that outlet (each outlet is its own restaurants row in this tenant).
  const scopedId = outletScopeId ?? restaurantId;
  const { data: orders, isRefetching, refetch } = useQuery({
    queryKey: getListOrdersQueryKey(scopedId, { status: "preparing,pending" }),
    queryFn: () => listOrders(scopedId, { status: "preparing,pending" }),
    refetchInterval: 30_000,
  });
  const pending = Array.isArray(orders) ? orders.length : 0;

  return (
    <RoleShellScreen
      title="Kitchen"
      subtitle="Today's KOTs"
      onRefresh={refetch}
      refreshing={isRefetching}
    >
      <RoleHomeCard
        eyebrow="In flight"
        icon="flame-outline"
        title="Live KOTs"
        value={String(pending)}
        subtitle="Tickets currently being prepared or queued."
        badge={pending > 0 ? { label: String(pending), tone: "warning" } : undefined}
        onPress={() => router.push("/(owner)/kitchen" as never)}
      />

      <AppText variant="h3" style={{ marginTop: 8 }}>Quick actions</AppText>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <QuickActionButton icon="flame-outline" label="Kitchen Display" onPress={() => router.push("/(owner)/kitchen" as never)} />
        <QuickActionButton icon="restaurant-outline" label="Menu / 86 list" onPress={() => router.push("/(owner)/menu" as never)} />
        <QuickActionButton icon="cube-outline" label="Inventory" onPress={() => router.push("/(owner)/inventory" as never)} />
      </View>

      {pending === 0 ? (
        <AppEmptyState
          icon="checkmark-circle-outline"
          title="All caught up"
          description="No KOTs in flight right now."
          style={{ marginTop: 24 }}
        />
      ) : null}
    </RoleShellScreen>
  );
}
