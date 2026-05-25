import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, ActivityIndicator, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listFloorTables, getListFloorTablesQueryKey } from "@workspace/api-client-react";
import type { FloorTable } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { EmptyState } from "@/components/EmptyState";

const STATUS_COLOR: Record<string, string> = {
  available: "#16a34a", free: "#16a34a",
  occupied: "#ea580c", reserved: "#2563eb",
  cleaning: "#9ca3af", billed: "#7c3aed",
};

export default function PickTableScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const { attachTable } = useCart();

  const q = useQuery({
    queryKey: getListFloorTablesQueryKey(restaurantId),
    queryFn: () => listFloorTables(restaurantId),
    refetchInterval: 20_000,
  });
  const tables = (Array.isArray(q.data) ? q.data : []) as FloorTable[];

  const [search, setSearch] = useState("");
  const filteredTables = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter((t) => {
      const label = ((t as unknown as { tableNumber?: string }).tableNumber ?? `t${t.id}`).toString().toLowerCase();
      return label.includes(needle) || String(t.id).includes(needle);
    });
  }, [tables, search]);

  const byFloor: Record<string, FloorTable[]> = {};
  for (const t of filteredTables) {
    const f = (t as unknown as { floor?: string | null }).floor ?? "Main";
    (byFloor[f] ??= []).push(t);
  }

  const onPick = (t: FloorTable) => {
    const label = (t as unknown as { tableNumber?: string }).tableNumber ?? `T${t.id}`;
    attachTable(restaurantId, t.id, label);
    router.push({ pathname: "/new-order/menu", params: { tableId: String(t.id), tableLabel: label } } as never);
  };

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (tables.length === 0) {
    return <View style={{ flex: 1, backgroundColor: colors.background }}><EmptyState icon="grid-outline" title="No tables" message="Add tables from the web dashboard." /></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 20 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
    >
      <View style={[styles.searchWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Ionicons name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search tables"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch("")} hitSlop={10}>
            <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      <Legend colors={colors} />
      {filteredTables.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, textAlign: "center", marginTop: 24, fontSize: 13 }}>
          No tables match &ldquo;{search}&rdquo;.
        </Text>
      ) : null}
      {Object.entries(byFloor).map(([floor, list]) => (
        <View key={floor} style={{ gap: 10 }}>
          <Text style={[styles.floor, { color: colors.mutedForeground }]}>{floor}</Text>
          <View style={styles.grid}>
            {list.map((t) => {
              const status = (t.status ?? "available") as string;
              const color = STATUS_COLOR[status] ?? STATUS_COLOR.available;
              const label = (t as unknown as { tableNumber?: string }).tableNumber ?? `T${t.id}`;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => onPick(t)}
                  style={({ pressed }) => [styles.tile, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
                >
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
                  {t.capacity ? <Text style={[styles.cap, { color: colors.mutedForeground }]}><Ionicons name="people-outline" size={11} /> {t.capacity}</Text> : null}
                  <Text style={[styles.status, { color }]}>{status.replace("_", " ")}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Legend({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.legend, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {(["available", "occupied", "reserved", "cleaning", "billed"] as const).map((k) => (
        <View key={k} style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR[k] }]} />
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "capitalize" }}>{k}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  floor: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "31%", aspectRatio: 1, borderRadius: 16, borderWidth: 1, padding: 10, justifyContent: "space-between" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 18, fontFamily: "Inter_700Bold" },
  cap: { fontSize: 11, fontFamily: "Inter_500Medium" },
  status: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 10, borderRadius: 12, borderWidth: 1 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 2 },
});
