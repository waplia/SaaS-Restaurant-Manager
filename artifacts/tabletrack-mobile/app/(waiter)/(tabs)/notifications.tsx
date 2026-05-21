import React from "react";
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { listNotifications, getListNotificationsQueryKey } from "@workspace/api-client-react";
import type { NotificationItem } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";

const TYPE_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  new_order: { icon: "receipt-outline", color: "#f97316" },
  order_status: { icon: "checkmark-circle-outline", color: "#22c55e" },
  low_stock: { icon: "warning-outline", color: "#f59e0b" },
  waiter_call: { icon: "hand-left-outline", color: "#3b82f6" },
  kitchen_ready: { icon: "flame-outline", color: "#ef4444" },
  reservation: { icon: "calendar-outline", color: "#8b5cf6" },
};

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { restaurantId } = useAuth();

  const params = {};

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: getListNotificationsQueryKey(restaurantId, params),
    queryFn: () => listNotifications(restaurantId, params),
    refetchInterval: 30_000,
  });

  const notifications = (Array.isArray(data) ? data : []) as NotificationItem[];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: isWeb ? 67 : insets.top, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Alerts</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : notifications.length === 0 ? (
        <EmptyState icon="notifications-outline" title="No alerts" message="Notifications for orders and kitchen events will appear here." />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => String(n.id)}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          renderItem={({ item: n }) => {
            const typeConf = TYPE_ICONS[n.type ?? ""] ?? { icon: "notifications-outline" as keyof typeof Ionicons.glyphMap, color: colors.primary };
            const elapsed = timeAgo(n.createdAt ?? "");
            return (
              <View
                style={[
                  styles.notifCard,
                  { backgroundColor: n.isRead ? colors.card : colors.accent, borderColor: colors.border },
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: typeConf.color + "22" }]}>
                  <Ionicons name={typeConf.icon} size={20} color={typeConf.color} />
                </View>
                <View style={styles.notifContent}>
                  <Text style={[styles.notifTitle, { color: colors.foreground }]}>{n.title}</Text>
                  {n.message ? <Text style={[styles.notifMsg, { color: colors.mutedForeground }]}>{n.message}</Text> : null}
                  <Text style={[styles.notifTime, { color: colors.mutedForeground }]}>{elapsed}</Text>
                </View>
                {!n.isRead ? <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} /> : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginTop: 16 },
  list: { padding: 12, gap: 8 },
  notifCard: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  notifContent: { flex: 1, gap: 2 },
  notifTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  notifMsg: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  notifTime: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
});
