import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";

type Branch = {
  id: number;
  name: string;
  city?: string | null;
  isActive?: boolean;
  todayRevenue?: number;
  pendingOrders?: number;
};

export default function OutletsScreen() {
  const colors = useColors();
  const { restaurantId, tenantId } = useAuth();
  const isWeb = Platform.OS === "web";

  const q = useQuery({
    queryKey: ["tenant-branches", tenantId],
    queryFn: () => customFetch<Branch[]>(`/tenants/${tenantId}/branches`).catch(() => []),
    enabled: tenantId != null,
  });
  const list = q.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Outlets" subtitle={`${list.length} branches`} showBack />
      {tenantId == null ? (
        <EmptyState icon="business-outline" title="Single outlet" message="Multi-outlet switching is for tenants with multiple branches." />
      ) : list.length === 0 ? (
        <EmptyState icon="business-outline" title="No outlets" message="Add branches from the web dashboard." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: isWeb ? 100 : 100 }}
        >
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Tap an outlet to switch. The Home dashboard reflects the active outlet.
          </Text>
          {list.map(b => {
            const isActive = b.id === restaurantId;
            return (
              <Pressable
                key={b.id}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: isActive ? colors.accent : colors.card,
                    borderColor: isActive ? colors.primary : colors.border,
                    borderWidth: isActive ? 1.5 : 1,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.primary }]}>
                  <Ionicons name="storefront" size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.foreground }]}>{b.name}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {b.city ?? ""}{b.isActive === false ? " · Inactive" : ""}
                  </Text>
                </View>
                {isActive ? (
                  <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                    <Text style={styles.badgeText}>Active</Text>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                )}
              </Pressable>
            );
          })}
          <Text style={[styles.note, { color: colors.mutedForeground, marginTop: 8 }]}>
            Switching outlets requires re-login on this build. Use the web dashboard for instant switching.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  note: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, paddingHorizontal: 4 },
});
