import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, TextInput, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";

type Item = {
  id: number;
  name: string;
  sku?: string;
  // API returns `currentStock` + `minStockLevel`; tolerate older alias names.
  currentStock?: number | string;
  quantity?: number | string;
  minStockLevel?: number | string;
  reorderPoint?: number | string;
  unit?: string;
  costPerUnit?: string;
};

function itemQty(it: Item): number {
  return Number(it.currentStock ?? it.quantity ?? 0);
}
function itemReorder(it: Item): number {
  return Number(it.minStockLevel ?? it.reorderPoint ?? 0);
}

export default function InventoryScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const isWeb = Platform.OS === "web";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");

  const q = useQuery({
    queryKey: ["inventory", restaurantId],
    queryFn: () => customFetch<Item[]>(`/api/restaurants/${restaurantId}/inventory`).catch(() => []),
  });

  const items = (Array.isArray(q.data) ? q.data : []).filter(it => {
    const qty = itemQty(it);
    const rp = itemReorder(it);
    if (filter === "low" && qty > rp) return false;
    if (filter === "out" && qty > 0) return false;
    if (search && !it.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Inventory" subtitle={`${items.length} items`} showBack />
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 10 }}>
        <View style={[styles.search, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={16} color={colors.mutedForeground} />
          <TextInput
            placeholder="Search items"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            style={{ flex: 1, color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(["all", "low", "out"] as const).map(k => (
            <Pressable
              key={k}
              onPress={() => setFilter(k)}
              style={[styles.pill, { borderColor: colors.border, backgroundColor: filter === k ? colors.primary : colors.card }]}
            >
              <Text style={[styles.pillText, { color: filter === k ? "#fff" : colors.mutedForeground }]}>
                {k === "all" ? "All" : k === "low" ? "Low stock" : "Out of stock"}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {items.length === 0 ? (
        <EmptyState icon="cube-outline" title="No items" message="Stock items match this filter." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: isWeb ? 100 : 100 }}
        >
          {items.map(it => {
            const qty = itemQty(it);
            const rp = itemReorder(it);
            const tone = qty === 0 ? "danger" : qty <= rp ? "warning" : "success";
            const label = qty === 0 ? "Out" : qty <= rp ? "Low" : "OK";
            return (
              <View key={it.id} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{it.name}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {qty.toFixed(qty % 1 ? 1 : 0)} {it.unit ?? ""} {rp > 0 ? `· reorder at ${rp}` : ""}
                  </Text>
                </View>
                <StatusBadge label={label} tone={tone} />
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
