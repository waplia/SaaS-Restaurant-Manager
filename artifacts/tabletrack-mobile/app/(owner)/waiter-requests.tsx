import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";

// Server returns rows shaped by api-server/src/routes/waiter-requests.ts:
// `type`, `note`, `tableNumber`, `createdAt`, `status`. (Earlier this screen
// expected `requestType` / `notes` / `tableLabel`, which crashed with
// "Cannot read properties of undefined (reading 'replace')".)
type Request = {
  id: number;
  tableNumber?: string | number | null;
  type: "call_waiter" | "water" | "request_bill" | "custom" | string;
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

export default function WaiterRequestsScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";

  const q = useQuery({
    queryKey: ["waiter-requests", restaurantId],
    queryFn: () => customFetch<Request[]>(`/api/restaurants/${restaurantId}/waiter-requests?status=pending,acknowledged`).catch(() => []),
    refetchInterval: 10_000,
  });
  const list = Array.isArray(q.data) ? q.data : [];

  const resolve = useMutation({
    mutationFn: (id: number) => customFetch(`/api/restaurants/${restaurantId}/waiter-requests/${id}/resolve`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waiter-requests"] }),
  });
  const ack = useMutation({
    mutationFn: (id: number) => customFetch(`/api/restaurants/${restaurantId}/waiter-requests/${id}/acknowledge`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waiter-requests"] }),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Waiter Requests" subtitle={`${list.length} active`} showBack />
      {list.length === 0 ? (
        <EmptyState icon="hand-left-outline" title="No active requests" message="Guests' calls will land here in real time." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: isWeb ? 100 : 100 }}
        >
          {list.map(r => (
            <View key={r.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
                <Ionicons name={ICON[r.type] ?? "alert-circle-outline"} size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.foreground }]}>
                  {LABEL[r.type] ?? String(r.type ?? "Request").replace(/_/g, " ")}
                  {r.tableNumber != null ? ` · Table ${r.tableNumber}` : ""}
                </Text>
                {r.note ? <Text style={[styles.notes, { color: colors.mutedForeground }]}>{r.note}</Text> : null}
                <Text style={[styles.time, { color: colors.mutedForeground }]}>{new Date(r.createdAt).toLocaleTimeString()}</Text>
              </View>
              <View style={{ gap: 6 }}>
                {r.status === "pending" ? (
                  <Pressable onPress={() => ack.mutate(r.id)} style={[styles.btn, { borderColor: colors.border, borderWidth: 1 }]}>
                    <Text style={[styles.btnText, { color: colors.foreground }]}>Ack</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => resolve.mutate(r.id)} style={[styles.btn, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.btnText, { color: "#fff" }]}>Done</Text>
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
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  notes: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  time: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  btn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  btnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
