import React from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import {
  getDashboardSummary, getGetDashboardSummaryQueryKey,
  listOrders, getListOrdersQueryKey,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import type { DashboardSummary, Order } from "@workspace/api-client-react";

const RESTAURANT_ID = 1;

export default function OwnerDashboard() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const { data: dashboard, isLoading, refetch, isRefetching } = useQuery({
    queryKey: getGetDashboardSummaryQueryKey(RESTAURANT_ID),
    queryFn: () => getDashboardSummary(RESTAURANT_ID),
  });

  const { data: ordersData } = useQuery({
    queryKey: [...getListOrdersQueryKey(RESTAURANT_ID, { status: "in_progress", limit: 5 })],
    queryFn: () => listOrders(RESTAURANT_ID, { status: "in_progress", limit: 5 }),
  });

  if (isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 100 }} />
      </View>
    );
  }

  if (!dashboard) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <EmptyState icon="alert-circle-outline" title="Could not load dashboard" message="Check your connection and try again." actionLabel="Retry" onAction={refetch} />
      </View>
    );
  }

  const ds = dashboard as DashboardSummary;
  const revenue = Number(ds.todayRevenue ?? 0).toLocaleString("en-IN");
  const orders = ds.todayOrders ?? 0;
  const activeTables = ds.activeTables ?? 0;
  const pendingKitchen = ds.pendingKitchenTickets ?? 0;

  const orderList = ((ordersData as { orders?: Order[] } | null)?.orders ?? (Array.isArray(ordersData) ? ordersData : [])) as Order[];

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: isWeb ? 67 + 16 : insets.top + 16, paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90 },
      ]}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
    >
      <View style={styles.header}>
        <Text style={[styles.greeting, { color: colors.mutedForeground }]}>Good {getTimeOfDay()}</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Overview</Text>
      </View>

      <View style={styles.statsGrid}>
        <StatCard label="Today's Revenue" value={`₹${revenue}`} icon={<Ionicons name="cash-outline" size={18} color={colors.primary} />} />
        <StatCard label="Orders Today" value={String(orders)} icon={<Ionicons name="receipt-outline" size={18} color={colors.primary} />} />
      </View>
      <View style={styles.statsGrid}>
        <StatCard label="Active Tables" value={String(activeTables)} icon={<Ionicons name="grid-outline" size={18} color={colors.primary} />} />
        <StatCard label="Kitchen Queue" value={String(pendingKitchen)} sub={pendingKitchen > 5 ? "High load" : undefined} icon={<Ionicons name="flame-outline" size={18} color={colors.primary} />} />
      </View>

      {orderList.length > 0 ? (
        <View style={[styles.section, { borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>In Progress</Text>
          {orderList.map((o) => (
            <View key={o.id} style={[styles.orderRow, { borderBottomColor: colors.border }]}>
              <View>
                <Text style={[styles.orderNum, { color: colors.foreground }]}>#{o.orderNumber}</Text>
                <Text style={[styles.orderMeta, { color: colors.mutedForeground }]}>
                  {(o.items?.length ?? 0)} item{(o.items?.length ?? 0) !== 1 ? "s" : ""}
                </Text>
              </View>
              <Text style={[styles.orderTotal, { color: colors.primary }]}>
                ₹{Number(o.totalAmount ?? 0).toLocaleString()}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },
  header: { gap: 2 },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  statsGrid: { flexDirection: "row", gap: 12 },
  section: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", padding: 14, paddingBottom: 10 },
  orderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  orderNum: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  orderMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  orderTotal: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
