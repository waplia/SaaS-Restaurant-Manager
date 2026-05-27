import React, { useMemo } from "react";
import { View, Pressable, ScrollView, RefreshControl } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { router } from "expo-router";
import { useTheme } from "@/theme";
import { useAuth } from "@/context/AuthContext";
import { notificationTypesForRole } from "@/lib/roles";
import {
  AppText, AppIcon, AppBadge, AppEmptyState, AppSkeletonList,
} from "@/components/ui";
import { RoleShellHeader } from "@/components/RoleShellHeader";

type Notif = {
  id: number;
  type?: string;
  category?: string;
  title: string;
  message?: string | null;
  body?: string | null;
  createdAt: string;
  readAt?: string | null;
  isRead?: boolean;
  data?: Record<string, unknown> | null;
};

/**
 * Top-level Notifications screen used by every role. The inbox is
 * filtered by the active role via `notificationTypesForRole` so a
 * cashier doesn't see kitchen flips and a chef doesn't see marketing
 * campaigns. Owners and managers see everything ("all").
 */
export default function NotificationsScreen() {
  const t = useTheme();
  const qc = useQueryClient();
  const { user, activeRole, restaurantId, outletScopeId } = useAuth();
  const role = activeRole ?? user?.role ?? null;
  const scopedId = outletScopeId ?? restaurantId;

  // Role-based filtering happens server-side via the `types` query param;
  // owners/managers/super_admins pass none and see everything.
  const allowed = notificationTypesForRole(role);
  const typesParam = allowed === "all" ? "" : allowed.join(",");

  const q = useQuery({
    queryKey: ["role-notifications", scopedId, typesParam],
    queryFn: () => customFetch<Notif[]>(
      `/api/restaurants/${scopedId}/notifications?limit=100${typesParam ? `&types=${encodeURIComponent(typesParam)}` : ""}`,
    ).catch(() => [] as Notif[]),
    enabled: !!user && scopedId > 0,
  });

  const list = useMemo<Notif[]>(() => Array.isArray(q.data) ? q.data : [], [q.data]);

  const markRead = useMutation({
    mutationFn: (ids: number[]) =>
      customFetch(`/api/restaurants/${scopedId}/notifications/mark-read`, {
        method: "POST", body: JSON.stringify({ ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-notifications"] }),
  });

  const unread = list.filter((n) => !(n.readAt || n.isRead));

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader
        title="Notifications"
        subtitle={unread.length > 0 ? `${unread.length} unread` : "All caught up"}
        hideOutletSwitcher
        rightExtra={unread.length > 0 ? (
          <Pressable
            onPress={() => markRead.mutate(unread.map((n) => n.id))}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Mark all as read"
            style={{ paddingHorizontal: 10, paddingVertical: 6 }}
          >
            <AppText variant="small" weight="semibold" color="primary">Mark all read</AppText>
          </Pressable>
        ) : undefined}
      />

      {q.isLoading ? (
        <View style={{ padding: t.spacing.lg }}>
          <AppSkeletonList rows={6} />
        </View>
      ) : list.length === 0 ? (
        <AppEmptyState
          icon="notifications-off-outline"
          title="No notifications"
          description={
            allowed === "all"
              ? "You're all caught up."
              : "No notifications for your role yet."
          }
          style={{ marginTop: 48 }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: t.spacing.lg, gap: 8, paddingBottom: 48 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={t.colors.primary} />}
        >
          {list.map((n) => {
            const isUnread = !(n.readAt || n.isRead);
            return (
              <Pressable
                key={n.id}
                onPress={() => {
                  if (isUnread) markRead.mutate([n.id]);
                  const screen = typeof n.data?.screen === "string" ? n.data.screen : null;
                  const map: Record<string, string> = {
                    orders: "/(owner)/orders",
                    kitchen: "/(owner)/kitchen",
                    inventory: "/(owner)/inventory",
                    staff: "/(owner)/staff",
                    finance: "/(owner)/finance",
                    customers: "/(owner)/customers",
                    reservations: "/(owner)/reservations",
                    waiter_requests: "/(owner)/waiter-requests",
                  };
                  if (screen && map[screen]) {
                    try { router.push(map[screen] as never); } catch { /* ignore */ }
                  }
                }}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 10,
                  padding: 12, borderRadius: t.radius.md, borderWidth: 1,
                  borderColor: t.colors.border,
                  backgroundColor: isUnread ? t.colors.accent : t.colors.card,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <View style={{
                  width: 8, height: 8, borderRadius: 4,
                  backgroundColor: isUnread ? t.colors.primary : "transparent",
                }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText variant="bodyMd" weight="semibold" numberOfLines={1}>{n.title}</AppText>
                  {n.body || n.message ? (
                    <AppText variant="small" color="mutedForeground" numberOfLines={2}>{n.body ?? n.message ?? ""}</AppText>
                  ) : null}
                  <AppText variant="micro" color="mutedForeground">
                    {new Date(n.createdAt).toLocaleString()}
                  </AppText>
                </View>
                {n.type ? <AppBadge label={n.type} tone="info" /> : null}
                <AppIcon name="chevron-forward" size={18} color="mutedForeground" />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
