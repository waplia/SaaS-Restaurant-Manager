import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";

type Table = {
  id: number;
  label: string;
  status?: "available" | "occupied" | "reserved" | "cleaning" | "billed" | string;
  capacity?: number;
  floor?: string | null;
  currentOrderId?: number | null;
};

const STATUS_COLOR: Record<string, string> = {
  available: "#16a34a",
  occupied: "#ea580c",
  reserved: "#2563eb",
  cleaning: "#9ca3af",
  billed: "#7c3aed",
};

export default function TablesScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const isWeb = Platform.OS === "web";

  const q = useQuery({
    queryKey: ["tables", restaurantId],
    queryFn: () => customFetch<Table[]>(`/restaurants/${restaurantId}/tables`).catch(() => []),
  });
  const tables = q.data ?? [];

  const byFloor: Record<string, Table[]> = {};
  for (const t of tables) (byFloor[t.floor ?? "Main"] ??= []).push(t);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Tables" subtitle={`${tables.length} total`} showBack />
      {q.isLoading ? (
        <View style={{ padding: 32, alignItems: "center" }}>
          <Text style={{ color: colors.mutedForeground }}>Loading…</Text>
        </View>
      ) : tables.length === 0 ? (
        <EmptyState icon="grid-outline" title="No tables yet" message="Add tables from the web dashboard." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: isWeb ? 100 : 100 }}
        >
          {Object.entries(byFloor).map(([floor, list]) => (
            <View key={floor} style={{ gap: 10 }}>
              <Text style={[styles.floorLabel, { color: colors.mutedForeground }]}>{floor}</Text>
              <View style={styles.grid}>
                {list.map(t => {
                  const color = STATUS_COLOR[t.status ?? "available"] ?? STATUS_COLOR.available;
                  return (
                    <Pressable
                      key={t.id}
                      style={({ pressed }) => [
                        styles.tile,
                        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <View style={[styles.statusDot, { backgroundColor: color }]} />
                      <Text style={[styles.label, { color: colors.foreground }]}>{t.label}</Text>
                      {t.capacity ? (
                        <Text style={[styles.capacity, { color: colors.mutedForeground }]}>
                          <Ionicons name="people-outline" size={11} /> {t.capacity}
                        </Text>
                      ) : null}
                      <Text style={[styles.status, { color }]}>{(t.status ?? "available").replace("_", " ")}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  floorLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "31%", aspectRatio: 1, borderRadius: 12, borderWidth: 1, padding: 10, justifyContent: "space-between" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 17, fontFamily: "Inter_700Bold" },
  capacity: { fontSize: 11, fontFamily: "Inter_500Medium" },
  status: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
});
