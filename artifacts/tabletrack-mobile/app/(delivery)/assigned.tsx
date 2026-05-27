import React, { useMemo } from "react";
import {
  View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator,
  Pressable, Linking, Platform, ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { type Assignment, STATUS_LABEL, statusBg, statusFg, isToday, etaLabel } from "@/lib/delivery";

export default function AssignedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { restaurantId, accessToken, user, logout } = useAuth();
  const isWeb = Platform.OS === "web";

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["my-deliveries", restaurantId],
    queryFn: () =>
      customFetch<Assignment[]>(`/api/restaurants/${restaurantId}/delivery/my`),
    refetchInterval: 15_000,
    enabled: !!accessToken,
  });

  const assignments: Assignment[] = Array.isArray(data) ? data : [];

  const summary = useMemo(() => {
    const assigned = assignments.filter(a => a.status === "assigned").length;
    const pickedUp = assignments.filter(a => a.status === "picked_up").length;
    const deliveredToday = assignments.filter(a => a.status === "delivered" && isToday(a.deliveredAt)).length;
    const codToCollect = assignments
      .filter(a => (a.status === "assigned" || a.status === "picked_up") && !a.codCollected)
      .reduce((s, a) => s + (Number(a.codAmount) || 0), 0);
    const codInHand = assignments
      .filter(a => a.codCollected && !a.codHandedIn)
      .reduce((s, a) => s + (Number(a.codAmount) || 0), 0);
    return { assigned, pickedUp, deliveredToday, codToCollect, codInHand };
  }, [assignments]);

  const active = assignments.filter(a => a.status === "assigned" || a.status === "picked_up");

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: isWeb ? 16 : insets.top + 8, borderBottomColor: colors.border }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>My Deliveries</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              {user?.name ?? "Rider"} · ₹{summary.codInHand.toFixed(0)} cash in hand
            </Text>
          </View>
          <Pressable onPress={async () => { await logout(); router.replace("/login"); }} hitSlop={10}>
            <Ionicons name="log-out-outline" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={active}
        keyExtractor={(a) => String(a.id)}
        contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
            >
              <Stat label="Assigned" value={String(summary.assigned)} icon="cube-outline" tint="#1d4ed8" bg="#dbeafe" colors={colors} />
              <Stat label="Pickup pending" value={String(summary.assigned)} icon="storefront-outline" tint="#c2410c" bg="#ffedd5" colors={colors} />
              <Stat label="Out for delivery" value={String(summary.pickedUp)} icon="bicycle-outline" tint="#7c3aed" bg="#ede9fe" colors={colors} />
              <Stat label="Delivered today" value={String(summary.deliveredToday)} icon="checkmark-done-outline" tint="#15803d" bg="#dcfce7" colors={colors} />
              <Stat label="Cash to collect" value={`₹${summary.codToCollect.toFixed(0)}`} icon="cash-outline" tint="#b45309" bg="#fef3c7" colors={colors} />
            </ScrollView>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              Active ({active.length})
            </Text>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="bicycle-outline" size={42} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No active deliveries</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                New assignments will appear here.
              </Text>
            </View>
          )
        }
        renderItem={({ item: a }) => <Card a={a} colors={colors} />}
      />
    </View>
  );
}

function Stat({ label, value, icon, tint, bg, colors }: {
  label: string; value: string; icon: keyof typeof Ionicons.glyphMap;
  tint: string; bg: string; colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <View>
        <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
        <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
      </View>
    </View>
  );
}

function Card({ a, colors }: { a: Assignment; colors: ReturnType<typeof useColors> }) {
  const codAmt = Number(a.codAmount) || 0;
  const orderTotal = Number(a.order?.totalAmount) || 0;
  const paid = a.order?.paymentStatus === "paid";
  const address = a.order?.deliveryAddress ?? null;
  const eta = etaLabel(a);

  return (
    <Pressable
      onPress={() => router.push(`/(delivery)/${a.id}` as never)}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.orderNum, { color: colors.foreground }]}>{a.order.orderNumber}</Text>
        <View style={[styles.statusPill, { backgroundColor: statusBg(a.status) }]}>
          <Text style={[styles.statusText, { color: statusFg(a.status) }]}>{STATUS_LABEL[a.status]}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={[styles.customer, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
          {a.order.customerName ?? "Customer"}
        </Text>
        {eta && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="time-outline" size={13} color={eta.late ? "#dc2626" : colors.mutedForeground} />
            <Text style={{
              fontSize: 12, fontFamily: "Inter_600SemiBold",
              color: eta.late ? "#dc2626" : colors.mutedForeground,
            }}>{eta.text}</Text>
          </View>
        )}
      </View>
      {address && (
        <Text style={[styles.address, { color: colors.mutedForeground }]} numberOfLines={2}>
          <Ionicons name="location-outline" size={12} color={colors.mutedForeground} /> {address}
        </Text>
      )}

      <View style={styles.amountsRow}>
        <View>
          <Text style={[styles.amountLabel, { color: colors.mutedForeground }]}>Total</Text>
          <Text style={[styles.amount, { color: colors.foreground }]}>₹{orderTotal.toFixed(0)}</Text>
        </View>
        <View>
          <Text style={[styles.amountLabel, { color: colors.mutedForeground }]}>
            {paid ? "Payment" : (codAmt > 0 ? (a.codCollected ? "COD ✓" : "COD") : "Payment")}
          </Text>
          <Text style={[styles.amount, { color: paid ? "#15803d" : (codAmt > 0 ? "#ea580c" : colors.foreground) }]}>
            {paid ? "Paid" : (codAmt > 0 ? `₹${codAmt.toFixed(0)}` : "—")}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
      </View>

      <View style={styles.actions}>
        {a.order.customerPhone && (
          <Pressable
            onPress={(e) => { e.stopPropagation(); Linking.openURL(`tel:${a.order.customerPhone}`).catch(() => {}); }}
            style={[styles.actionBtn, { borderColor: colors.border }]}
          >
            <Ionicons name="call-outline" size={15} color={colors.foreground} />
            <Text style={[styles.actionText, { color: colors.foreground }]}>Call</Text>
          </Pressable>
        )}
        {address && (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              const url = Platform.select({
                ios: `maps:0,0?q=${encodeURIComponent(address)}`,
                default: `https://maps.google.com/?q=${encodeURIComponent(address)}`,
              })!;
              Linking.openURL(url).catch(() => {});
            }}
            style={[styles.actionBtn, { borderColor: colors.border }]}
          >
            <Ionicons name="navigate-outline" size={15} color={colors.foreground} />
            <Text style={[styles.actionText, { color: colors.foreground }]}>Maps</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => router.push(`/(delivery)/${a.id}` as never)}
          style={[styles.actionBtn, { backgroundColor: colors.primary, borderColor: colors.primary, flex: 1 }]}
        >
          <Text style={[styles.actionText, { color: "#fff" }]}>Open</Text>
          <Ionicons name="arrow-forward" size={15} color="#fff" />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  list: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8 },
  stat: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, minWidth: 130,
  },
  statIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  orderNum: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  statusPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  customer: { fontSize: 14, fontFamily: "Inter_500Medium" },
  address: { fontSize: 12, fontFamily: "Inter_400Regular" },
  amountsRow: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: 4 },
  amountLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  amount: { fontSize: 16, fontFamily: "Inter_700Bold" },
  actions: { flexDirection: "row", gap: 8, marginTop: 6 },
  actionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1,
  },
  actionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  empty: { alignItems: "center", justifyContent: "center", padding: 32, gap: 6, marginTop: 24 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});
