import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { EmptyState } from "@/components/EmptyState";

// Mirrors the shape returned by api-server/src/routes/waiter-requests.ts.
type Request = {
  id: number;
  tableNumber?: string | number | null;
  type: string;
  note?: string | null;
  createdAt: string;
  status: "pending" | "acknowledged" | "resolved" | string;
};

const ICON: Record<string, keyof typeof import("@expo/vector-icons").Ionicons.glyphMap> = {
  call_waiter: "hand-left-outline",
  water: "water-outline",
  request_bill: "receipt-outline",
  bill: "receipt-outline",
  cleaning: "sparkles-outline",
  help: "help-circle-outline",
  custom: "chatbubble-ellipses-outline",
};

const LABEL: Record<string, string> = {
  call_waiter: "Call waiter",
  water: "Water",
  request_bill: "Request bill",
  bill: "Bill",
  cleaning: "Cleaning",
  help: "Help",
  custom: "Custom request",
};

// Bulletproof against any weird field shapes the server might return —
// avoids `.replace of undefined` crashes if `r.type` is ever missing,
// null, a number, or any non-string value.
function formatRequestLabel(type: unknown): string {
  if (type == null) return "Request";
  const key = String(type);
  if (LABEL[key]) return LABEL[key];
  return key.split("_").join(" ") || "Request";
}

export default function WaiterRequestsTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { restaurantId } = useAuth();
  const qc = useQueryClient();

  // Poll every 10s so newly-raised guest requests appear without manual
  // refresh — matches the owner-side waiter-requests screen exactly
  // (same query key, same server-side status filter so both tabs share
  // the react-query cache and stay in sync when one acks/resolves).
  const q = useQuery({
    queryKey: ["waiter-requests", restaurantId],
    queryFn: () => customFetch<Request[]>(`/api/restaurants/${restaurantId}/waiter-requests?status=pending,acknowledged`).catch(() => []),
    refetchInterval: 10_000,
  });
  const list = Array.isArray(q.data) ? q.data : [];

  const ack = useMutation({
    mutationFn: (id: number) => customFetch(`/api/restaurants/${restaurantId}/waiter-requests/${id}/acknowledge`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waiter-requests"] }),
  });
  const resolve = useMutation({
    mutationFn: (id: number) => customFetch(`/api/restaurants/${restaurantId}/waiter-requests/${id}/resolve`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waiter-requests"] }),
  });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: isWeb ? 67 : insets.top, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Requests</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {list.length} active{list.length === 1 ? "" : ""}
        </Text>
      </View>

      {list.length === 0 ? (
        <EmptyState icon="hand-left-outline" title="No active requests" message="Guests' calls will appear here in real time." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: isWeb ? 100 : insets.bottom + 100 }}
        >
          {list.map((r) => (
            <View key={r.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
                  <Ionicons name={ICON[r.type] ?? "alert-circle-outline"} size={22} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                    {formatRequestLabel(r.type)}
                    {r.tableNumber != null ? ` · Table ${r.tableNumber}` : ""}
                  </Text>
                  {r.note ? <Text style={[styles.notes, { color: colors.mutedForeground }]}>{r.note}</Text> : null}
                  <Text style={[styles.time, { color: colors.mutedForeground }]}>
                    {new Date(r.createdAt).toLocaleTimeString()}
                    {r.status === "acknowledged" ? " · Waiter on the way" : ""}
                  </Text>
                </View>
              </View>
              {/* Big, thumb-friendly action buttons live BELOW the request so
                  the waiter can hit them one-handed without aiming at small
                  targets crammed against the right edge of the card. */}
              <View style={styles.actions}>
                <Pressable
                  onPress={() => ack.mutate(r.id)}
                  disabled={r.status !== "pending" || ack.isPending}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnAck,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                      opacity: r.status !== "pending" ? 0.5 : pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={r.status === "acknowledged" ? "checkmark-circle" : "checkmark-outline"}
                    size={20}
                    color={colors.foreground}
                  />
                  <Text style={[styles.btnText, { color: colors.foreground }]}>
                    {r.status === "acknowledged" ? "On my way" : "I'm coming"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => resolve.mutate(r.id)}
                  disabled={resolve.isPending}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnDone,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Ionicons name="checkmark-done" size={20} color="#fff" />
                  <Text style={[styles.btnText, { color: "#fff" }]}>Finished</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  card: { flexDirection: "column", gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  notes: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  time: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  actions: { flexDirection: "row", gap: 10, marginTop: 2 },
  btn: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  btnAck: { borderWidth: 1 },
  btnDone: {},
  btnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
