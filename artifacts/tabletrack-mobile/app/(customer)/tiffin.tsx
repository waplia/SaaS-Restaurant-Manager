import React, { useCallback } from "react";
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

interface MySubscription {
  id: number;
  planName: string | null;
  status: string;
  startDate: string;
  endDate: string | null;
  pausedFrom: string | null;
  pausedTo: string | null;
  deliveryAddress: string;
  preferredSlot: string;
  mealsPerDay: number;
  pricePerMeal: string | null;
}

export default function MyTiffinScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { restaurantId, accessToken } = useAuth();
  const baseUrl = `${getApiBaseUrl()}`;

  const apiFetch = useCallback(async (path: string) => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  }, [baseUrl, accessToken]);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["my-tiffin-subs", restaurantId, accessToken],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/tiffin/me/subscriptions`) as Promise<MySubscription[]>,
    enabled: !!accessToken,
  });

  const subs: MySubscription[] = Array.isArray(data) ? data : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>My Tiffin</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Your active meal plans</Text>
      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={subs}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 16, paddingTop: 16 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={{ padding: 24, alignItems: "center" }}>
              <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>
                No active tiffin subscriptions. Talk to the kitchen to start one!
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.row}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{item.planName ?? `Plan #${item.id}`}</Text>
                <View style={[styles.badge, {
                  backgroundColor: item.status === "active" ? "#dcfce7" : item.status === "paused" ? "#fef3c7" : "#f1f5f9",
                }]}>
                  <Text style={{
                    fontSize: 11,
                    color: item.status === "active" ? "#15803d" : item.status === "paused" ? "#b45309" : "#475569",
                  }}>{item.status}</Text>
                </View>
              </View>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {item.preferredSlot.toUpperCase()} • {item.mealsPerDay} meal/day
              </Text>
              {item.pausedFrom && (
                <Text style={[styles.meta, { color: "#b45309" }]}>
                  Paused {item.pausedFrom} → {item.pausedTo}
                </Text>
              )}
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                Started {item.startDate}{item.endDate ? ` • Ends ${item.endDate}` : ""}
              </Text>
              <Text style={[styles.address, { color: colors.foreground }]}>{item.deliveryAddress}</Text>
              {item.pricePerMeal && (
                <Text style={[styles.price, { color: colors.primary }]}>₹{item.pricePerMeal} per meal</Text>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 24, fontWeight: "700", paddingHorizontal: 16 },
  subtitle: { fontSize: 13, paddingHorizontal: 16, marginTop: 4 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  meta: { fontSize: 12, marginTop: 4 },
  address: { fontSize: 13, marginTop: 8 },
  price: { fontSize: 14, fontWeight: "600", marginTop: 8 },
});
