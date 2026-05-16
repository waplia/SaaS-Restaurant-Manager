import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";

type Reservation = {
  id: number;
  customerName: string;
  customerPhone?: string;
  partySize: number;
  reservationTime: string;
  status: "pending" | "confirmed" | "seated" | "completed" | "no_show" | "cancelled" | string;
  tableLabel?: string | null;
  notes?: string | null;
};

export default function ReservationsScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"today" | "upcoming" | "all">("today");
  const isWeb = Platform.OS === "web";

  const q = useQuery({
    queryKey: ["reservations", restaurantId, filter],
    queryFn: () => customFetch<Reservation[] | { reservations?: Reservation[] }>(`/api/restaurants/${restaurantId}/reservations?range=${filter}`).catch(() => []),
  });
  const list: Reservation[] = Array.isArray(q.data) ? q.data : (q.data?.reservations ?? []);

  const update = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      customFetch(`/api/restaurants/${restaurantId}/reservations/${id}`, {
        method: "PATCH", body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reservations"] }),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Reservations" showBack />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 48, flexGrow: 0 }} contentContainerStyle={styles.pills}>
        {(["today", "upcoming", "all"] as const).map(k => (
          <Pressable
            key={k}
            onPress={() => setFilter(k)}
            style={[styles.pill, { borderColor: colors.border, backgroundColor: filter === k ? colors.primary : colors.card }]}
          >
            <Text style={[styles.pillText, { color: filter === k ? "#fff" : colors.mutedForeground }]}>{k}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {list.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No reservations" message="New bookings will appear here." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: isWeb ? 100 : 100 }}
        >
          {list.map(r => (
            <View key={r.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.foreground }]}>{r.customerName}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    <Ionicons name="people-outline" size={12} /> {r.partySize} · {new Date(r.reservationTime).toLocaleString()}
                  </Text>
                  {r.tableLabel ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>Table {r.tableLabel}</Text>
                  ) : null}
                </View>
                <StatusBadge label={r.status} tone={r.status === "confirmed" ? "success" : r.status === "no_show" || r.status === "cancelled" ? "danger" : "info"} />
              </View>
              {r.status === "pending" || r.status === "confirmed" ? (
                <View style={styles.btnRow}>
                  <Pressable
                    onPress={() => update.mutate({ id: r.id, status: "seated" })}
                    style={[styles.btn, { backgroundColor: colors.primary }]}
                  >
                    <Text style={styles.btnText}>Mark arrived</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => update.mutate({ id: r.id, status: "no_show" })}
                    style={[styles.btn, { borderColor: colors.border, borderWidth: 1 }]}
                  >
                    <Text style={[styles.btnText, { color: colors.foreground }]}>No-show</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pills: { gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  card: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  btnRow: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
