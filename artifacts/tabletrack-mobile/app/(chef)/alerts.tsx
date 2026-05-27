import React, { useMemo } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useChefColors } from "@/hooks/useChefColors";
import { useAuth } from "@/context/AuthContext";
import { useKdsTickets, type KdsTicket } from "@/hooks/useKdsTickets";
import { useKdsSettings } from "@/hooks/useKdsSettings";

type AlertKind = "new" | "delayed" | "cancelled" | "unavailable";

interface AlertItem {
  id: string;
  kind: AlertKind;
  title: string;
  body: string;
  iconColor: string;
  bg: string;
  border: string;
  createdAt: string;
  ticketId: number;
}

const KIND_META: Record<AlertKind, { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; color: string; bg: string }> = {
  new:         { icon: "alert-circle",  label: "New KOT",       color: "#60a5fa", bg: "#1e293b" },
  delayed:     { icon: "warning",       label: "Delayed",       color: "#f87171", bg: "#3f0f0f" },
  cancelled:   { icon: "close-circle",  label: "Cancelled",     color: "#fca5a5", bg: "#3f0f0f" },
  unavailable: { icon: "ban",           label: "Item 86'd",     color: "#fcd34d", bg: "#3f2d11" },
};

/**
 * Chef alerts feed — surfaces new KOTs, delayed orders, cancellations and
 * out-of-stock items pulled from the same kitchen tickets stream the board
 * uses. Each row deep-links back to the KOT board so the chef can react
 * immediately. The sound/vibration alerts themselves are wired on the
 * board screens (see `ChefBoard` -> `useKdsRealtime`), so they fire
 * whether or not this screen is focused.
 */
export default function ChefAlertsScreen() {
  const colors = useChefColors();
  const insets = useSafeAreaInsets();
  const { restaurantId } = useAuth();
  const { settings } = useKdsSettings();
  const ticketsQ = useKdsTickets(restaurantId, { pollMs: 20_000 });

  const items: AlertItem[] = useMemo(() => {
    const tickets = (ticketsQ.data ?? []) as KdsTicket[];
    const out: AlertItem[] = [];
    for (const t of tickets) {
      const elapsed = t.elapsedMinutes ?? Math.floor((Date.now() - new Date(t.createdAt ?? Date.now()).getTime()) / 60000);
      const status = String(t.status);
      const label = `KOT #${t.orderNumber ?? t.id}`;
      if (status === "cancelled") {
        out.push({
          id: `t-${t.id}-cancelled`, kind: "cancelled",
          title: `${label} was cancelled`,
          body: t.kitchen?.name ? `Station: ${t.kitchen.name}` : "Order cancelled",
          ...KIND_META.cancelled, iconColor: KIND_META.cancelled.color, border: KIND_META.cancelled.color,
          createdAt: t.createdAt ?? new Date().toISOString(),
          ticketId: t.id,
        });
        continue;
      }
      if (status === "new" || status === "pending") {
        if (elapsed < 5) {
          out.push({
            id: `t-${t.id}-new`, kind: "new",
            title: `${label} just arrived`,
            body: `${t.tableNumber ? `Table ${t.tableNumber}` : t.customerName ?? "Walk-in"}${t.kitchen?.name ? ` · ${t.kitchen.name}` : ""}`,
            ...KIND_META.new, iconColor: KIND_META.new.color, border: KIND_META.new.color,
            createdAt: t.createdAt ?? new Date().toISOString(),
            ticketId: t.id,
          });
        }
      }
      const isDelayed = t.isDelayed || (t.overdueMinutes ?? 0) > 0 || elapsed >= settings.delayedThresholdMin;
      if (isDelayed && status !== "served" && status !== "completed" && status !== "cancelled") {
        out.push({
          id: `t-${t.id}-delayed`, kind: "delayed",
          title: `${label} is running late`,
          body: `${elapsed}m on the line${t.kitchen?.name ? ` · ${t.kitchen.name}` : ""}`,
          ...KIND_META.delayed, iconColor: KIND_META.delayed.color, border: KIND_META.delayed.color,
          createdAt: t.createdAt ?? new Date().toISOString(),
          ticketId: t.id,
        });
      }
      for (const item of t.items ?? []) {
        if (String(item.status) === "out_of_stock") {
          out.push({
            id: `i-${item.id}-oos`, kind: "unavailable",
            title: `${item.menuItemName} marked 86'd`,
            body: `${label}${t.kitchen?.name ? ` · ${t.kitchen.name}` : ""}`,
            ...KIND_META.unavailable, iconColor: KIND_META.unavailable.color, border: KIND_META.unavailable.color,
            createdAt: t.createdAt ?? new Date().toISOString(),
            ticketId: t.id,
          });
        }
      }
    }
    return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [ticketsQ.data, settings.delayedThresholdMin]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Kitchen alerts</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {items.length === 0 ? "No active alerts" : `${items.length} active ${items.length === 1 ? "alert" : "alerts"}`}
        </Text>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="shield-checkmark" size={56} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>All clear</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            New KOTs, delayed tickets, cancellations and out-of-stock alerts will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
          refreshControl={
            <RefreshControl
              refreshing={ticketsQ.isRefetching}
              onRefresh={ticketsQ.refetch}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push("/(chef)" as never)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: item.bg, borderColor: item.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={[styles.iconWrap, { backgroundColor: item.iconColor + "33" }]}>
                <Ionicons name={KIND_META[item.kind].icon} size={20} color={item.iconColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>{item.title}</Text>
                <Text style={[styles.rowBody, { color: colors.mutedForeground }]} numberOfLines={2}>{item.body}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 4 },
  list: { padding: 16, gap: 10 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 1,
    marginBottom: 10,
  },
  iconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  rowBody: { fontSize: 12.5, fontFamily: "Inter_500Medium", marginTop: 2 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 18 },
});
