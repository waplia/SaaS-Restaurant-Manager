import React, { useCallback } from "react";
import { Alert } from "@/components/ui/AppAlert";
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, Pressable, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

interface RouteStop {
  id: number;
  subscriptionId: number;
  deliveryDate: string;
  slot: string;
  status: string;
  mealsCount: number;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  routeStop: number | null;
  routeName: string | null;
}

export default function TiffinRouteScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { restaurantId, accessToken } = useAuth();
  const qc = useQueryClient();
  const baseUrl = `${getApiBaseUrl()}`;

  const apiFetch = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken ?? ""}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  }, [baseUrl, accessToken]);

  const today = new Date().toISOString().slice(0, 10);
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["tiffin-my-route", restaurantId, today],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/tiffin/my-route?date=${today}`) as Promise<RouteStop[]>,
    refetchInterval: 30_000,
    enabled: !!accessToken,
  });

  const mark = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/restaurants/${restaurantId}/tiffin/deliveries/${id}/attendance`, {
        method: "POST", body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-my-route"] }),
    onError: (e) => Alert.alert("Failed", (e as Error).message),
  });

  const stops: RouteStop[] = Array.isArray(data) ? data : [];
  const total = stops.length;
  const done = stops.filter(s => s.status === "delivered").length;
  const pending = stops.filter(s => s.status === "scheduled").length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>Tiffin Route • Today</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {done}/{total} delivered • {pending} pending
        </Text>
      </View>
      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={stops}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={{ padding: 24 }}>
              <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>No tiffin stops assigned to you today.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.headerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                    #{item.routeStop ?? "—"} {item.customerName}
                  </Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {item.routeName ?? "Route"} • {item.slot} • {item.mealsCount} meal(s)
                  </Text>
                </View>
                <View style={[styles.badge, {
                  backgroundColor:
                    item.status === "delivered" ? "#dcfce7" :
                    item.status === "not_delivered" ? "#fee2e2" :
                    item.status === "skipped" || item.status === "paused" ? "#f1f5f9" :
                    "#fef3c7",
                }]}>
                  <Text style={{
                    fontSize: 11,
                    color:
                      item.status === "delivered" ? "#15803d" :
                      item.status === "not_delivered" ? "#b91c1c" :
                      item.status === "skipped" || item.status === "paused" ? "#475569" :
                      "#b45309",
                  }}>{item.status.replace("_", " ")}</Text>
                </View>
              </View>
              <Text style={[styles.address, { color: colors.foreground }]}>{item.deliveryAddress}</Text>
              <View style={styles.actionsRow}>
                {item.customerPhone && (
                  <Pressable onPress={() => Linking.openURL(`tel:${item.customerPhone}`)}
                    style={[styles.btn, { borderColor: colors.border }]}>
                    <Ionicons name="call" size={14} color={colors.primary} />
                    <Text style={{ color: colors.primary, marginLeft: 6, fontSize: 13 }}>Call</Text>
                  </Pressable>
                )}
                {item.deliveryAddress && (
                  <Pressable onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(item.deliveryAddress!)}`)}
                    style={[styles.btn, { borderColor: colors.border }]}>
                    <Ionicons name="map" size={14} color={colors.primary} />
                    <Text style={{ color: colors.primary, marginLeft: 6, fontSize: 13 }}>Map</Text>
                  </Pressable>
                )}
                {item.status === "scheduled" && (
                  <>
                    <Pressable onPress={() => mark.mutate({ id: item.id, status: "delivered" })}
                      style={[styles.btn, { backgroundColor: "#16a34a", borderColor: "#16a34a" }]}>
                      <Ionicons name="checkmark" size={14} color="#fff" />
                      <Text style={{ color: "#fff", marginLeft: 6, fontSize: 13 }}>Delivered</Text>
                    </Pressable>
                    <Pressable onPress={() => mark.mutate({ id: item.id, status: "not_delivered" })}
                      style={[styles.btn, { borderColor: "#dc2626" }]}>
                      <Ionicons name="close" size={14} color="#dc2626" />
                      <Text style={{ color: "#dc2626", marginLeft: 6, fontSize: 13 }}>Missed</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 4 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  cardTitle: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 4 },
  address: { fontSize: 13, marginTop: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  actionsRow: { flexDirection: "row", marginTop: 12, flexWrap: "wrap", gap: 8 },
  btn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, marginRight: 6 },
});
