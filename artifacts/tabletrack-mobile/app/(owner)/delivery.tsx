import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge, toneForOrderStatus } from "@/components/StatusBadge";

type DeliveryOrder = {
  id: number;
  orderNumber?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  status?: string;
  totalAmount?: number;
  riderName?: string | null;
  riderPhone?: string | null;
};

type CodSummary = { totalDue: number; collected: number; pending: number };

export default function DeliveryScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const isWeb = Platform.OS === "web";

  type OrdersResp = { orders?: DeliveryOrder[] };
  const ordersQ = useQuery({
    queryKey: ["delivery-orders", restaurantId],
    queryFn: () => customFetch<OrdersResp>(`/api/restaurants/${restaurantId}/orders?orderType=delivery&limit=50`).catch(() => ({} as OrdersResp)),
  });
  const codQ = useQuery<CodSummary | null>({
    queryKey: ["cod-summary", restaurantId],
    queryFn: () => customFetch<CodSummary>(`/api/restaurants/${restaurantId}/delivery/cod-summary`).catch(() => null),
  });
  const list: DeliveryOrder[] = ordersQ.data?.orders ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Delivery" subtitle={`${list.length} orders`} showBack />
      <ScrollView
        refreshControl={<RefreshControl refreshing={ordersQ.isRefetching} onRefresh={() => { ordersQ.refetch(); codQ.refetch(); }} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: isWeb ? 100 : 100 }}
      >
        {codQ.data ? (() => {
          // Decimal columns commonly come back as strings from the API; cast
          // defensively so `.toFixed` never crashes on string/null/undefined.
          const totalDue = Number(codQ.data.totalDue) || 0;
          const collected = Number(codQ.data.collected) || 0;
          const pending = Number(codQ.data.pending) || 0;
          return (
            <View style={[styles.codCard, { backgroundColor: colors.accent, borderColor: colors.primary + "30" }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.codLabel, { color: colors.mutedForeground }]}>Cash on delivery today</Text>
                <Text style={[styles.codTotal, { color: colors.foreground }]}>₹{totalDue.toFixed(0)}</Text>
                <Text style={[styles.codSub, { color: colors.mutedForeground }]}>
                  Collected ₹{collected.toFixed(0)} · Pending ₹{pending.toFixed(0)}
                </Text>
              </View>
              <Ionicons name="cash-outline" size={32} color={colors.primary} />
            </View>
          );
        })() : null}

        {list.length === 0 ? (
          <View style={{ marginTop: 40 }}>
            <EmptyState icon="bicycle-outline" title="No delivery orders" message="Online or aggregator orders will appear here." />
          </View>
        ) : (
          list.map(o => (
            <View key={o.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.headerRow}>
                <Text style={[styles.orderNo, { color: colors.foreground }]}>#{o.orderNumber ?? o.id}</Text>
                <StatusBadge label={o.status ?? "pending"} tone={toneForOrderStatus(o.status)} />
              </View>
              <Text style={[styles.customer, { color: colors.foreground }]}>{o.customerName ?? "Customer"}</Text>
              {o.deliveryAddress ? (
                <Text style={[styles.addr, { color: colors.mutedForeground }]} numberOfLines={2}>
                  <Ionicons name="location-outline" size={12} /> {o.deliveryAddress}
                </Text>
              ) : null}
              <View style={styles.footer}>
                <Text style={[styles.rider, { color: colors.mutedForeground }]}>
                  {o.riderName ? `Rider: ${o.riderName}` : "No rider assigned"}
                </Text>
                <Text style={[styles.amount, { color: colors.foreground }]}>₹{(Number(o.totalAmount) || 0).toFixed(0)}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  codCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  codLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  codTotal: { fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 2 },
  codSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  card: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 6 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  orderNo: { fontSize: 14, fontFamily: "Inter_700Bold" },
  customer: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  addr: { fontSize: 12, fontFamily: "Inter_400Regular" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  rider: { fontSize: 12, fontFamily: "Inter_500Medium" },
  amount: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
