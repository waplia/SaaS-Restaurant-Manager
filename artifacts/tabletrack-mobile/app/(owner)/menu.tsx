import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Switch, TextInput, Platform, Alert } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";

type MenuItem = {
  id: number;
  name: string;
  price?: string | number;
  imageUrl?: string | null;
  isAvailable?: boolean;
  categoryName?: string;
};

export default function MenuScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["menu-items-mobile", restaurantId],
    queryFn: () => customFetch<{ items?: MenuItem[] } | MenuItem[]>(`/api/restaurants/${restaurantId}/menu/items?limit=500`).catch(() => []),
  });
  const items: MenuItem[] = Array.isArray(q.data) ? q.data : (q.data?.items ?? []);
  const filtered = items.filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()));

  const toggle = useMutation({
    mutationFn: ({ id, isAvailable }: { id: number; isAvailable: boolean }) =>
      customFetch(`/api/restaurants/${restaurantId}/items/${id}`, {
        method: "PATCH", body: JSON.stringify({ isAvailable }),
      }),
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not update item"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["menu-items-mobile"] }),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Menu" subtitle={`${items.length} items`} showBack />
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
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
      </View>
      {filtered.length === 0 ? (
        <EmptyState icon="restaurant-outline" title="No items" message="No menu items match your search." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: isWeb ? 100 : 100 }}
        >
          {filtered.map(item => (
            <View key={item.id} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, opacity: item.isAvailable ? 1 : 0.6 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  ₹{item.price ?? "0"}{item.categoryName ? ` · ${item.categoryName}` : ""}
                </Text>
              </View>
              <Switch
                value={item.isAvailable ?? true}
                onValueChange={v => toggle.mutate({ id: item.id, isAvailable: v })}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
