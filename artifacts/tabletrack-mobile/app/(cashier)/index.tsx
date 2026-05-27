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
import { usePermission } from "@/hooks/usePermission";

/**
 * Cashier home. Launchpad into orders, billing/split, expenses and the
 * shift close-out flow. The actual order screens live in /(owner)/* —
 * we just front them with role-appropriate quick actions and a "tickets
 * waiting to bill" summary.
 */
export default function CashierHome() {
  const { restaurantId, outletScopeId } = useAuth();
  const scopedId = outletScopeId ?? restaurantId;
  const canCloseShift = usePermission("shift.close");
  const { data: openOrders, isRefetching, refetch } = useQuery({
    queryKey: getListOrdersQueryKey(scopedId, { status: "served,ready,delivered" }),
    queryFn: () => listOrders(scopedId, { status: "served,ready,delivered" }),
    refetchInterval: 30_000,
  });
  const toBill = Array.isArray(openOrders) ? openOrders.length : 0;

  return (
    <RoleShellScreen
      title="Cashier"
      subtitle="Tickets to bill"
      onRefresh={refetch}
      refreshing={isRefetching}
    >
      <RoleHomeCard
        eyebrow="Waiting"
        icon="cash-outline"
        title="Tickets to bill"
        value={String(toBill)}
        subtitle="Served orders that haven't been billed yet."
        badge={toBill > 0 ? { label: String(toBill), tone: "primary" } : undefined}
        onPress={() => router.push("/(owner)/orders" as never)}
      />

      <AppText variant="h3" style={{ marginTop: 8 }}>Quick actions</AppText>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <QuickActionButton icon="receipt-outline" label="New order" onPress={() => router.push("/new-order" as never)} />
        <QuickActionButton icon="list-outline" label="All orders" onPress={() => router.push("/(owner)/orders" as never)} />
        <QuickActionButton icon="grid-outline" label="Tables" onPress={() => router.push("/(owner)/tables" as never)} />
        <QuickActionButton
          icon="lock-closed-outline"
          label="Close shift"
          onPress={() => router.push("/(owner)/finance" as never)}
          disabled={!canCloseShift}
        />
      </View>

      {toBill === 0 ? (
        <AppEmptyState
          icon="checkmark-circle-outline"
          title="Counter is clear"
          description="No served tickets waiting to bill."
          style={{ marginTop: 24 }}
        />
      ) : null}
    </RoleShellScreen>
  );
}
