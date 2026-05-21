import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Linking, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { ROLE_LABEL } from "@/lib/roles";
import { router } from "expo-router";

type Staff = { id: number; name: string; email?: string; phone?: string; role: string; isActive?: boolean };

export default function StaffScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const isWeb = Platform.OS === "web";
  const q = useQuery({
    queryKey: ["staff-list", restaurantId],
    queryFn: () => customFetch<Staff[] | { staff?: Staff[] }>(`/api/restaurants/${restaurantId}/staff`).catch(() => []),
  });
  const staff: Staff[] = Array.isArray(q.data) ? q.data : (q.data?.staff ?? []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader
        title="Staff"
        subtitle={`${staff.length} members`}
        showBack
        right={
          <Pressable onPress={() => router.push("/(owner)/attendance" as never)} hitSlop={10}>
            <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Attendance</Text>
          </Pressable>
        }
      />
      {staff.length === 0 ? (
        <EmptyState icon="people-outline" title="No staff" message="Invite team members from the web dashboard." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: isWeb ? 100 : 100 }}
        >
          {staff.map(s => (
            <View key={s.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                <Text style={styles.avatarText}>{s.name?.[0]?.toUpperCase() ?? "?"}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{s.name}</Text>
                <Text style={[styles.role, { color: colors.mutedForeground }]}>
                  {ROLE_LABEL[s.role] ?? s.role}
                  {s.isActive === false ? " · Inactive" : ""}
                </Text>
              </View>
              {s.phone ? (
                <Pressable hitSlop={10} onPress={() => Linking.openURL(`tel:${s.phone}`)}>
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
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  role: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
});
