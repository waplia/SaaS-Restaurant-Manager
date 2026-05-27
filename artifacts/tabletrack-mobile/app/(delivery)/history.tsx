import React, { useState, useMemo } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable, Platform,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { type Assignment, STATUS_LABEL, statusBg, statusFg, fmtTime, isToday } from "@/lib/delivery";

type Filter = "today" | "week" | "all";

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { restaurantId, accessToken } = useAuth();
  const isWeb = Platform.OS === "web";
  const [filter, setFilter] = useState<Filter>("today");

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["my-deliveries", restaurantId],
    queryFn: () => customFetch<Assignment[]>(`/api/restaurants/${restaurantId}/delivery/my`),
    refetchInterval: 60_000,
    enabled: !!accessToken,
  });

  const items = useMemo(() => {
    const all = (Array.isArray(data) ? data : []).filter(a => a.status === "delivered" || a.status === "cancelled");
    if (filter === "all") return all;
    const now = Date.now();
    const cutoff = filter === "today" ? null : now - 7 * 24 * 3600 * 1000;
    return all.filter(a => {
      const t = a.deliveredAt ?? a.cancelledAt;
      if (!t) return false;
      if (filter === "today") return isToday(t);
      return new Date(t).getTime() >= cutoff!;
    });
  }, [data, filter]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: isWeb ? 16 : insets.top + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Delivery History</Text>
        <View style={styles.tabs}>
          {(["today", "week", "all"] as Filter[]).map(f => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.tab, {
                borderColor: filter === f ? colors.primary : colors.border,
                backgroundColor: filter === f ? colors.primary : "transparent",
              }]}
            >
              <Text style={{
                color: filter === f ? "#fff" : colors.foreground,
                fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "capitalize",
              }}>{f === "week" ? "Last 7 days" : f === "all" ? "All" : "Today"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={a => String(a.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="time-outline" size={42} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No history yet</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Completed and returned orders will appear here.
              </Text>
            </View>
          )
        }
        renderItem={({ item: a }) => {
          const codAmt = Number(a.codAmount) || 0;
          const t = a.deliveredAt ?? a.cancelledAt;
          return (
            <Pressable
              onPress={() => router.push(`/(delivery)/${a.id}` as never)}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.row}>
                <Text style={[styles.orderNum, { color: colors.foreground }]}>{a.order.orderNumber}</Text>
                <View style={[styles.statusPill, { backgroundColor: statusBg(a.status) }]}>
                  <Text style={[styles.statusText, { color: statusFg(a.status) }]}>{STATUS_LABEL[a.status]}</Text>
                </View>
              </View>
              <Text style={[styles.customer, { color: colors.foreground }]} numberOfLines={1}>
                {a.order.customerName ?? "Customer"}
              </Text>
              <View style={[styles.row, { marginTop: 4 }]}>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {t ? new Date(t).toLocaleDateString() : "—"} · {fmtTime(t)}
                </Text>
                <View style={{ flex: 1 }} />
                {codAmt > 0 && (
                  <Text style={{
                    fontSize: 13, fontFamily: "Inter_600SemiBold",
                    color: a.codCollected ? "#15803d" : "#dc2626",
                  }}>
                    {a.codCollected ? `+₹${codAmt.toFixed(0)} COD` : "COD not collected"}
                  </Text>
                )}
              </View>
              {a.unavailableReason && (
                <Text style={[styles.reason, { color: "#b91c1c" }]} numberOfLines={2}>
                  Reason: {a.unavailableReason}
                </Text>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  tabs: { flexDirection: "row", gap: 8, marginTop: 10 },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  orderNum: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  customer: { fontSize: 13, fontFamily: "Inter_500Medium" },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  reason: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  empty: { alignItems: "center", padding: 32, gap: 6, marginTop: 40 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});
