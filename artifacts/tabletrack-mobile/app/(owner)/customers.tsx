import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, TextInput, Pressable, Linking, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";

type Customer = {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  totalSpent?: string | number;
  loyaltyPoints?: number;
  visitCount?: number;
  lastVisitAt?: string;
  segment?: "new" | "regular" | "vip" | "at_risk" | string;
};

const SEGMENT_COLOR: Record<string, string> = {
  vip: "#7c3aed", regular: "#2563eb", new: "#16a34a", at_risk: "#dc2626",
};

export default function CustomersScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const isWeb = Platform.OS === "web";
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["customers", restaurantId],
    queryFn: () => customFetch<{ customers?: Customer[]; data?: Customer[] } | Customer[]>(`/api/restaurants/${restaurantId}/customers?limit=200`).catch(() => []),
  });
  const list: Customer[] = Array.isArray(q.data) ? q.data : (q.data?.customers ?? q.data?.data ?? []);
  const filtered = list.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search)
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Customers" subtitle={`${list.length} total`} showBack />
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View style={[styles.search, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={16} color={colors.mutedForeground} />
          <TextInput
            placeholder="Search by name or phone"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            style={{ flex: 1, color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}
          />
        </View>
      </View>
      {filtered.length === 0 ? (
        <EmptyState icon="person-circle-outline" title="No customers" message="Customers will appear after their first visit." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: isWeb ? 100 : 100 }}
        >
          {filtered.map(c => (
            <View key={c.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.avatar, { backgroundColor: SEGMENT_COLOR[c.segment ?? "regular"] ?? colors.primary }]}>
                <Text style={styles.avatarText}>{c.name?.[0]?.toUpperCase() ?? "?"}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{c.name}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {c.visitCount ? `${c.visitCount} visits · ` : ""}
                  ₹{Number(c.totalSpent ?? 0).toFixed(0)}
                  {c.loyaltyPoints ? ` · ${c.loyaltyPoints} pts` : ""}
                </Text>
              </View>
              {c.phone ? (
                <Pressable hitSlop={8} onPress={() => Linking.openURL(`tel:${c.phone}`)}>
                  <Ionicons name="call-outline" size={20} color={colors.primary} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
