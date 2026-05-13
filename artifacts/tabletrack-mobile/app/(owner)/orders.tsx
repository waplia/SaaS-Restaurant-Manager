import React, { useState } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, RefreshControl, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { listOrders, getListOrdersQueryKey } from "@workspace/api-client-react";
import type { Order } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { OrderCard } from "@/components/OrderCard";
import { OrderDetailDrawer } from "@/components/OrderDetailDrawer";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";

const STATUSES = ["all", "pending", "in_progress", "ready", "completed"];

export default function OrdersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { restaurantId } = useAuth();
  const [activeStatus, setActiveStatus] = useState("all");
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);

  const params = activeStatus !== "all" ? { status: activeStatus, limit: 50 } : { limit: 50 };

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: getListOrdersQueryKey(restaurantId, params),
    queryFn: () => listOrders(restaurantId, params),
  });

  const orders = ((data as { orders?: Order[] } | null)?.orders ?? (Array.isArray(data) ? data : [])) as Order[];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: isWeb ? 67 : insets.top, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Orders</Text>
        <FlatList
          horizontal
          data={STATUSES}
          keyExtractor={(s) => s}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pills}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setActiveStatus(item)}
              style={[
                styles.pill,
                { borderColor: colors.border, backgroundColor: activeStatus === item ? colors.primary : colors.card },
              ]}
            >
              <Text style={[styles.pillText, { color: activeStatus === item ? "#fff" : colors.mutedForeground }]}>
                {item === "all" ? "All" : item.replace("_", " ")}
              </Text>
            </Pressable>
          )}
        />
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : orders.length === 0 ? (
        <EmptyState icon="receipt-outline" title="No orders" message="Orders will appear here when placed." />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => String(o.id)}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          renderItem={({ item: o }) => (
            <Pressable onPress={() => setOpenOrderId(o.id)}>
              <OrderCard
                orderNumber={o.orderNumber ?? String(o.id)}
                tableLabel={(o as unknown as { tableLabel?: string | null }).tableLabel}
                itemCount={(o as { items?: unknown[] }).items?.length ?? 0}
                total={o.totalAmount ?? 0}
                status={o.status ?? "pending"}
                orderType={o.orderType ?? "dine_in"}
                createdAt={o.createdAt ?? new Date().toISOString()}
              />
            </Pressable>
          )}
        />
      )}
      <OrderDetailDrawer orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginTop: 16 },
  pills: { gap: 8, paddingVertical: 4 },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  list: { padding: 16 },
});
