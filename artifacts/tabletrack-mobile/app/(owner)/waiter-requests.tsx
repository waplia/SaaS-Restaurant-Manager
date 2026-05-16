import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";

type Request = {
  id: number;
  tableLabel?: string;
  requestType: "call_waiter" | "water" | "bill" | "cleaning" | "help" | string;
  notes?: string | null;
  createdAt: string;
  status: "pending" | "acknowledged" | "resolved" | string;
};

const ICON: Record<string, keyof typeof import("@expo/vector-icons").Ionicons.glyphMap> = {
  call_waiter: "hand-left-outline",
  water: "water-outline",
  bill: "receipt-outline",
  cleaning: "sparkles-outline",
  help: "help-circle-outline",
};

export default function WaiterRequestsScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";

  const q = useQuery({
    queryKey: ["waiter-requests", restaurantId],
    queryFn: () => customFetch<Request[]>(`/restaurants/${restaurantId}/waiter-requests?status=pending,acknowledged`).catch(() => []),
    refetchInterval: 10_000,
  });
  const list = q.data ?? [];

  const resolve = useMutation({
    mutationFn: (id: number) => customFetch(`/restaurants/${restaurantId}/waiter-requests/${id}/resolve`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waiter-requests"] }),
  });
  const ack = useMutation({
    mutationFn: (id: number) => customFetch(`/restaurants/${restaurantId}/waiter-requests/${id}/acknowledge`, { method: "POST" }),
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
                <Ionicons name={ICON[r.requestType] ?? "alert-circle-outline"} size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.foreground }]}>
                  {r.requestType.replace("_", " ")}{r.tableLabel ? ` · Table ${r.tableLabel}` : ""}
                </Text>
                {r.notes ? <Text style={[styles.notes, { color: colors.mutedForeground }]}>{r.notes}</Text> : null}
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
  iconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  notes: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  time: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  btn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  btnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
