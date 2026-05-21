import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { ListSkeleton } from "@/components/ListSkeleton";
import { OfflineBanner } from "@/components/OfflineBanner";

type Notif = {
  id: number;
  title: string;
  body?: string | null;
  category?: string;
  createdAt: string;
  readAt?: string | null;
  data?: Record<string, unknown> | null;
};

const CATS = [
  { key: "all", label: "All" },
  { key: "orders", label: "Orders" },
  { key: "kitchen", label: "Kitchen" },
  { key: "inventory", label: "Inventory" },
  { key: "staff", label: "Staff" },
  { key: "finance", label: "Finance" },
  { key: "customers", label: "Customers" },
  { key: "ai", label: "AI" },
  { key: "system", label: "System" },
];

export default function NotificationsScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const { user, restaurantId } = useAuth();
  const isWeb = Platform.OS === "web";
  const [cat, setCat] = useState("all");

  const q = useQuery({
    queryKey: ["user-notifications", user?.id],
    queryFn: () => customFetch<{ notifications?: Notif[] } | Notif[]>(`/api/users/${user?.id}/notifications?limit=100`).catch(() => []),
    enabled: !!user,
  });
  const list: Notif[] = useMemo(() => {
    const d = q.data;
    if (!d) return [];
    const arr = Array.isArray(d) ? d : (d.notifications ?? []);
    return cat === "all" ? arr : arr.filter(n => (n.category ?? "system") === cat);
  }, [q.data, cat]);

  const markRead = useMutation({
    mutationFn: (ids: number[]) =>
      customFetch(`/api/restaurants/${restaurantId}/notifications/mark-read`, {
        method: "POST", body: JSON.stringify({ ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-notifications"] }),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader
        title="Notifications"
        showBack
        right={
          list.some(n => !n.readAt) ? (
            <Pressable
              onPress={() => markRead.mutate(list.filter(n => !n.readAt).map(n => n.id))}
              hitSlop={10}
            >
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Mark all read</Text>
            </Pressable>
          ) : null
        }
      />
      <OfflineBanner />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 48, flexGrow: 0 }} contentContainerStyle={styles.pills}>
        {CATS.map(c => (
          <Pressable
            key={c.key}
            onPress={() => setCat(c.key)}
            style={[styles.pill, { borderColor: colors.border, backgroundColor: cat === c.key ? colors.primary : colors.card }]}
          >
            <Text style={[styles.pillText, { color: cat === c.key ? "#fff" : colors.mutedForeground }]}>{c.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {q.isLoading ? (
        <ListSkeleton rows={6} />
      ) : list.length === 0 ? (
        <EmptyState icon="notifications-off-outline" title="No notifications" message="You're all caught up." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: isWeb ? 100 : 100 }}
        >
          {list.map(n => {
            const unread = !n.readAt;
            return (
              <Pressable
                key={n.id}
                onPress={() => {
                  if (unread) markRead.mutate([n.id]);
                  const screen = typeof n.data?.screen === "string" ? n.data.screen : null;
                  const map: Record<string, string> = {
                    orders: "/(owner)/orders",
                    kitchen: "/(owner)/kitchen",
                    inventory: "/(owner)/inventory",
                    staff: "/(owner)/staff",
                    finance: "/(owner)/finance",
                    customers: "/(owner)/customers",
                    ai: "/(owner)/khana-ai",
                    reservations: "/(owner)/reservations",
                    waiter_requests: "/(owner)/waiter-requests",
                  };
                  if (screen && map[screen]) router.push(map[screen] as never);
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: unread ? colors.accent : colors.card,
                    borderColor: colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={[styles.dot, { backgroundColor: unread ? colors.primary : "transparent" }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>{n.title}</Text>
                  {n.body ? <Text style={[styles.body, { color: colors.mutedForeground }]} numberOfLines={2}>{n.body}</Text> : null}
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>{new Date(n.createdAt).toLocaleString()}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pills: { gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4 },
});
