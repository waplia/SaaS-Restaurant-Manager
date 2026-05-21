import React, { useState } from "react";
import {
  View, Text, FlatList, StyleSheet, RefreshControl,
  ActivityIndicator, Pressable, Alert, Linking, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

interface Assignment {
  id: number;
  orderId: number;
  riderId: number;
  status: "assigned" | "picked_up" | "delivered" | "cancelled";
  codAmount: string;
  codCollected: boolean;
  codHandedIn: boolean;
  assignedAt: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  order: {
    id: number;
    orderNumber: string;
    customerName: string | null;
    customerPhone: string | null;
    totalAmount: string;
    paymentStatus: string;
    notes: string | null;
  };
}

const STATUS_LABEL: Record<string, string> = {
  assigned: "Assigned",
  picked_up: "Picked up",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export default function MyDeliveriesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { restaurantId, accessToken, user, logout } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"active" | "history">("active");
  const isWeb = Platform.OS === "web";

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["my-deliveries", restaurantId],
    queryFn: () =>
      customFetch<Assignment[]>(`/api/restaurants/${restaurantId}/delivery/my`),
    refetchInterval: 15_000,
    enabled: !!accessToken,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status, codCollected }: { id: number; status: string; codCollected?: boolean }) =>
      customFetch(`/api/restaurants/${restaurantId}/delivery/assignments/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, codCollected }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-deliveries"] }),
  });

  const assignments: Assignment[] = Array.isArray(data) ? data : [];
  const visible = assignments.filter(a =>
    filter === "active"
      ? a.status === "assigned" || a.status === "picked_up"
      : a.status === "delivered" || a.status === "cancelled",
  );

  const callCustomer = (phone: string | null) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => {});
  };

  const markPicked = (a: Assignment) => {
    updateMutation.mutate({ id: a.id, status: "picked_up" });
  };

  const markDelivered = (a: Assignment) => {
    const codAmt = Number(a.codAmount) || 0;
    if (codAmt > 0 && !a.codCollected) {
      Alert.alert(
        "Collect COD?",
        `Did you collect ₹${codAmt.toFixed(2)} from the customer?`,
        [
          {
            text: "Not collected",
            onPress: () => updateMutation.mutate({ id: a.id, status: "delivered", codCollected: false }),
          },
          {
            text: `Collected ₹${codAmt.toFixed(2)}`,
            onPress: () => updateMutation.mutate({ id: a.id, status: "delivered", codCollected: true }),
          },
        ],
      );
    } else {
      updateMutation.mutate({ id: a.id, status: "delivered" });
    }
  };

  const totalCodOutstanding = assignments
    .filter(a => a.codCollected && !a.codHandedIn)
    .reduce((sum, a) => sum + (Number(a.codAmount) || 0), 0);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: isWeb ? 67 : insets.top, borderBottomColor: colors.border }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>My Deliveries</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              {user?.name ?? "Rider"} · ₹{totalCodOutstanding.toFixed(0)} cash to hand in
            </Text>
          </View>
          <Pressable onPress={async () => { await logout(); router.replace("/login"); }} hitSlop={10}>
            <Ionicons name="log-out-outline" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <View style={styles.tabs}>
          {(["active", "history"] as const).map(t => (
            <Pressable
              key={t}
              onPress={() => setFilter(t)}
              style={[styles.tab, { borderColor: filter === t ? colors.primary : colors.border, backgroundColor: filter === t ? colors.primary : "transparent" }]}
            >
              <Text style={{
                color: filter === t ? "#fff" : colors.foreground,
                fontFamily: "Inter_500Medium",
                fontSize: 13,
                textTransform: "capitalize",
              }}>
                {t}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : visible.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="bicycle-outline" size={42} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {filter === "active" ? "No active deliveries" : "No past deliveries"}
          </Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            {filter === "active" ? "New assignments will appear here." : "Your history will appear here."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 : insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          renderItem={({ item: a }) => {
            // API may return COD/total as string, number, null, or undefined.
            // Defensive Number(... || 0) so .toFixed never crashes if the
            // server omits a field on a partial payload.
            const codAmt = Number(a.codAmount) || 0;
            const orderTotal = Number(a.order?.totalAmount) || 0;
            return (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <Text style={[styles.orderNum, { color: colors.foreground }]}>{a.order.orderNumber}</Text>
                  <View style={[styles.statusPill, { backgroundColor: statusBg(a.status) }]}>
                    <Text style={[styles.statusText, { color: statusFg(a.status) }]}>{STATUS_LABEL[a.status]}</Text>
                  </View>
                </View>
                <Text style={[styles.customer, { color: colors.foreground }]}>
                  {a.order.customerName ?? "Customer"}
                </Text>
                {a.order.notes && (
                  <Text style={[styles.notes, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {a.order.notes}
                  </Text>
                )}

                <View style={styles.amountsRow}>
                  <View>
                    <Text style={[styles.amountLabel, { color: colors.mutedForeground }]}>Total</Text>
                    <Text style={[styles.amount, { color: colors.foreground }]}>₹{orderTotal.toFixed(0)}</Text>
                  </View>
                  {codAmt > 0 && (
                    <View>
                      <Text style={[styles.amountLabel, { color: colors.mutedForeground }]}>COD {a.codCollected ? "✓ collected" : ""}</Text>
                      <Text style={[styles.amount, { color: "#ea580c" }]}>₹{codAmt.toFixed(0)}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }} />
                </View>

                <View style={styles.actions}>
                  {a.order.customerPhone && (
                    <Pressable
                      onPress={() => callCustomer(a.order.customerPhone)}
                      style={[styles.actionBtn, { borderColor: colors.border }]}
                    >
                      <Ionicons name="call-outline" size={16} color={colors.foreground} />
                      <Text style={[styles.actionText, { color: colors.foreground }]}>Call</Text>
                    </Pressable>
                  )}
                  {a.status === "assigned" && (
                    <Pressable
                      onPress={() => markPicked(a)}
                      style={[styles.actionBtn, { backgroundColor: colors.primary, borderColor: colors.primary, flex: 1 }]}
                      disabled={updateMutation.isPending}
                    >
                      <Ionicons name="cube-outline" size={16} color="#fff" />
                      <Text style={[styles.actionText, { color: "#fff" }]}>Mark picked up</Text>
                    </Pressable>
                  )}
                  {a.status === "picked_up" && (
                    <Pressable
                      onPress={() => markDelivered(a)}
                      style={[styles.actionBtn, { backgroundColor: "#16a34a", borderColor: "#16a34a", flex: 1 }]}
                      disabled={updateMutation.isPending}
                    >
                      <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                      <Text style={[styles.actionText, { color: "#fff" }]}>Mark delivered</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function statusBg(s: string) {
  if (s === "assigned") return "#dbeafe";
  if (s === "picked_up") return "#ffedd5";
  if (s === "delivered") return "#dcfce7";
  return "#fee2e2";
}
function statusFg(s: string) {
  if (s === "assigned") return "#1d4ed8";
  if (s === "picked_up") return "#c2410c";
  if (s === "delivered") return "#15803d";
  return "#b91c1c";
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", marginTop: 16 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  tabs: { flexDirection: "row", gap: 8, marginTop: 12 },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  list: { padding: 16, gap: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  orderNum: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  statusPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  customer: { fontSize: 14, fontFamily: "Inter_500Medium" },
  notes: { fontSize: 12, fontFamily: "Inter_400Regular" },
  amountsRow: { flexDirection: "row", gap: 18, marginTop: 4 },
  amountLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  amount: { fontSize: 16, fontFamily: "Inter_700Bold" },
  actions: { flexDirection: "row", gap: 8, marginTop: 6 },
  actionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1,
  },
  actionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 6 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});
