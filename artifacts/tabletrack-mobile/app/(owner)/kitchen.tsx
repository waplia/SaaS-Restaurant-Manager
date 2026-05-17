import React from "react";
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl, Alert, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listKitchenTickets, getListKitchenTicketsQueryKey,
  useUpdateKitchenTicketStatus,
} from "@workspace/api-client-react";
import type { KitchenTicket } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { KitchenTicketCard } from "@/components/KitchenTicketCard";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";

export default function KitchenScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const qc = useQueryClient();
  const { restaurantId } = useAuth();

  // Fetch all tickets and filter client-side to the active ones. The server's
  // `status` filter takes a single value (equality), so a comma-joined list
  // like `pending,in_progress` never matched. The canonical statuses in the
  // DB are `new` / `preparing` / `ready` / `served` (see web kitchen.tsx),
  // not the older `pending` / `in_progress` names this screen used.
  const params = {};

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: getListKitchenTicketsQueryKey(restaurantId, params),
    queryFn: () => listKitchenTickets(restaurantId, params),
    refetchInterval: 15_000,
  });

  const updateStatus = useUpdateKitchenTicketStatus();

  const ACTIVE = new Set(["new", "pending", "preparing", "in_progress", "ready"]);
  const all = (Array.isArray(data) ? data : []) as KitchenTicket[];
  const tickets = all.filter((t) => ACTIVE.has(String(t.status ?? "new")));

  const handleMarkReady = (ticketId: number) => {
    Alert.alert("Mark Ready?", "This will notify the waiter that the order is ready.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Ready",
        onPress: async () => {
          try {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await updateStatus.mutateAsync({ restaurantId, id: ticketId, data: { status: "ready" } });
            qc.invalidateQueries({ queryKey: getListKitchenTicketsQueryKey(restaurantId, params) });
          } catch {
            Alert.alert("Error", "Could not update ticket status.");
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: isWeb ? 67 : insets.top, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Kitchen</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {tickets.length} active ticket{tickets.length !== 1 ? "s" : ""}
        </Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : tickets.length === 0 ? (
        <EmptyState icon="checkmark-circle-outline" title="All caught up" message="No active kitchen tickets right now." />
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          renderItem={({ item: t }) => {
            const tx = t as unknown as {
              orderNumber?: string;
              tableNumber?: string | null;
              tableLabel?: string | null;
              isDelayed?: boolean;
              overdueMinutes?: number;
              delayAlertCount?: number;
              expectedPrepMinutes?: number | null;
            };
            return (
              <KitchenTicketCard
                ticketId={t.id}
                orderNumber={tx.orderNumber ?? String(t.id)}
                tableLabel={tx.tableNumber ?? tx.tableLabel ?? null}
                items={(Array.isArray(t.items) ? t.items : []).map((i) => ({ name: (i as unknown as { menuItemName?: string }).menuItemName ?? "", quantity: i.quantity ?? 1, notes: (i as unknown as { notes?: string | null }).notes ?? null }))}
                status={t.status ?? "pending"}
                createdAt={t.createdAt ?? new Date().toISOString()}
                onMarkReady={handleMarkReady}
                isDelayed={tx.isDelayed}
                overdueMinutes={tx.overdueMinutes}
                delayAlertCount={tx.delayAlertCount}
                expectedPrepMinutes={tx.expectedPrepMinutes}
              />
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginTop: 16 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  list: { padding: 16 },
});
