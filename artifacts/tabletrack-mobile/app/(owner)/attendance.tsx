import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge, type StatusTone } from "@/components/StatusBadge";

type AttendanceRow = {
  id: number;
  userName?: string;
  role?: string;
  status: "present" | "absent" | "late" | "on_leave" | string;
  clockInAt?: string | null;
  clockOutAt?: string | null;
  hoursWorked?: string | number | null;
};

const TONE: Record<string, StatusTone> = {
  present: "success",
  late: "warning",
  on_leave: "info",
  absent: "danger",
};

export default function AttendanceScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const isWeb = Platform.OS === "web";

  const today = new Date().toISOString().slice(0, 10);
  const q = useQuery({
    queryKey: ["attendance-today", restaurantId, today],
    queryFn: () => customFetch<AttendanceRow[] | { records?: AttendanceRow[] }>(`/restaurants/${restaurantId}/attendance?date=${today}`).catch(() => []),
  });
  const list: AttendanceRow[] = Array.isArray(q.data) ? q.data : (q.data?.records ?? []);

  const counts = { present: 0, absent: 0, late: 0, on_leave: 0 } as Record<string, number>;
  list.forEach(r => { counts[r.status] = (counts[r.status] ?? 0) + 1; });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Attendance" subtitle={new Date().toDateString()} showBack />
      <View style={[styles.summaryRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {(["present", "late", "on_leave", "absent"] as const).map(k => (
          <View key={k} style={styles.summaryCell}>
            <Text style={[styles.summaryNum, { color: colors.foreground }]}>{counts[k] ?? 0}</Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{k.replace("_", " ")}</Text>
          </View>
        ))}
      </View>
      {list.length === 0 ? (
        <EmptyState icon="time-outline" title="No records" message="Attendance for today will appear here." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: isWeb ? 100 : 100 }}
        >
          {list.map(r => (
            <View key={r.id} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: colors.foreground }]}>{r.userName ?? `User #${r.id}`}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {r.clockInAt ? `In ${new Date(r.clockInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—"}
                  {r.clockOutAt ? ` · Out ${new Date(r.clockOutAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                </Text>
              </View>
              <StatusBadge label={r.status.replace("_", " ")} tone={TONE[r.status] ?? "neutral"} />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: "row", margin: 16, marginBottom: 0, padding: 12, borderRadius: 12, borderWidth: 1 },
  summaryCell: { flex: 1, alignItems: "center", gap: 2 },
  summaryNum: { fontSize: 20, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
