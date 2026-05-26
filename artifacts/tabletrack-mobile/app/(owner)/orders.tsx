import React, { useMemo, useState } from "react";
import { Alert } from "@/components/ui/AppAlert";
import { View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, RefreshControl, Platform, ScrollView, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  customFetch, getListOrdersQueryKey,
} from "@workspace/api-client-react";
import type { Order } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { OrderCard } from "@/components/OrderCard";
import { OrderDetailDrawer } from "@/components/OrderDetailDrawer";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";

type StatusFilter = "all" | "new" | "preparing" | "ready" | "completed";
type TypeFilter = "all" | "qr" | "dine_in" | "takeaway" | "delivery";

const STATUS_CHIPS: { key: StatusFilter; label: string; tone?: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New", tone: "#f97316" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready", tone: "#16a34a" },
  { key: "completed", label: "Completed" },
];
const TYPE_CHIPS: { key: TypeFilter; label: string; icon?: keyof typeof Ionicons.glyphMap }[] = [
  { key: "all", label: "All types" },
  { key: "qr", label: "QR", icon: "qr-code-outline" },
  { key: "dine_in", label: "Dine-in", icon: "restaurant-outline" },
  { key: "takeaway", label: "Takeaway", icon: "bag-handle-outline" },
  { key: "delivery", label: "Delivery", icon: "bicycle-outline" },
];

export default function OrdersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const qc = useQueryClient();
  const { restaurantId, effectiveBranchId } = useAuth();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  // Free-text search box. Debounced so we don't hammer the server on every
  // keystroke, and trimmed/lower-bounded so a single character doesn't run
  // a near-unbounded ILIKE on the orders table.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  React.useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = searchInput.trim();
      setSearch(trimmed.length >= 2 ? trimmed : "");
    }, 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Map "new" filter to pending API status.
  const apiStatus = status === "new" ? "pending" : status === "preparing" ? "in_progress" : status;
  const params: Record<string, unknown> = { limit: 50 };
  if (apiStatus !== "all") params.status = apiStatus;
  if (search) params.search = search;
  if (effectiveBranchId != null) params.branchId = effectiveBranchId;

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: getListOrdersQueryKey(restaurantId, params),
    queryFn: () => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v != null && v !== "") qs.set(k, String(v));
      });
      return customFetch<{ data?: Order[]; total?: number }>(
        `/api/restaurants/${restaurantId}/orders?${qs.toString()}`,
      );
    },
    refetchInterval: 20_000,
  });

  const orders = useMemo(() => {
    const raw = (data as { data?: Order[]; orders?: Order[] } | null);
    const list = raw?.data ?? raw?.orders ?? (Array.isArray(data) ? (data as Order[]) : []);
    if (type === "all") return list;
    return (list as Order[]).filter((o) => {
      const t = (o.orderType ?? "dine_in") as string;
      const src = ((o as unknown as { sourceChannel?: string }).sourceChannel ?? "").toLowerCase();
      if (type === "qr") return src === "qr" || src === "self-order" || src === "self_order";
      return t === type;
    });
  }, [data, type]);

  const acceptMut = useMutation({
    mutationFn: (id: number) => customFetch(`/api/restaurants/${restaurantId}/orders/${id}`, {
      method: "PATCH", body: JSON.stringify({ status: "in_progress" }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: getListOrdersQueryKey(restaurantId) }),
    onError: () => Alert.alert("Couldn't accept", "Try again."),
  });
  const rejectMut = useMutation({
    mutationFn: (id: number) => customFetch(`/api/restaurants/${restaurantId}/orders/${id}`, {
      method: "PATCH", body: JSON.stringify({ status: "cancelled" }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: getListOrdersQueryKey(restaurantId) }),
    onError: () => Alert.alert("Couldn't reject", "Try again."),
  });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: isWeb ? 67 : insets.top, borderBottomColor: colors.border }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Orders</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>Tap a card to view · accept new orders inline</Text>
          </View>
          <Pressable onPress={() => router.push("/new-order" as never)} style={[styles.headerCta, { backgroundColor: colors.primary }]}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.headerCtaText}>New</Text>
          </Pressable>
        </View>

        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search order #, customer name or phone"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search orders"
          />
          {searchInput.length > 0 ? (
            <Pressable onPress={() => setSearchInput("")} accessibilityLabel="Clear search" hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
          {STATUS_CHIPS.map((c) => {
            const active = status === c.key;
            return (
              <Pressable key={c.key} onPress={() => setStatus(c.key)} style={[styles.pill, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.card }]}>
                {c.tone && !active ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.tone }} /> : null}
                <Text style={[styles.pillText, { color: active ? "#fff" : colors.mutedForeground }]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
          {TYPE_CHIPS.map((c) => {
            const active = type === c.key;
            return (
              <Pressable key={c.key} onPress={() => setType(c.key)} style={[styles.pill, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.card }]}>
                {c.icon ? <Ionicons name={c.icon} size={12} color={active ? "#fff" : colors.mutedForeground} /> : null}
                <Text style={[styles.pillText, { color: active ? "#fff" : colors.mutedForeground }]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : orders.length === 0 ? (
        <EmptyState icon="receipt-outline" title="No orders" message="Orders will appear here when placed." />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => String(o.id)}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          renderItem={({ item: o }) => {
            const isNew = (o.status ?? "pending") === "pending";
            return (
              <View style={{ marginBottom: 10 }}>
                <Pressable onPress={() => setOpenOrderId(o.id)}>
                  <OrderCard
                    orderNumber={o.orderNumber ?? String(o.id)}
                    tableLabel={(o as unknown as { tableLabel?: string | null }).tableLabel}
                    itemCount={(o as { items?: unknown[] }).items?.length ?? 0}
                    total={o.totalAmount ?? 0}
                    status={o.status ?? "pending"}
                    orderType={o.orderType ?? "dine_in"}
                    createdAt={o.createdAt ?? new Date().toISOString()}
                  />
                </Pressable>
                {isNew ? (
                  <View style={styles.actionRow}>
                    <Pressable
                      disabled={rejectMut.isPending}
                      onPress={() => Alert.alert("Reject order?", `Order #${o.orderNumber ?? o.id}`, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Reject", style: "destructive", onPress: () => rejectMut.mutate(o.id) },
                      ])}
                      style={[styles.rejectBtn, { borderColor: colors.border }]}
                    >
                      <Ionicons name="close" size={14} color={colors.destructive} />
                      <Text style={[styles.rejectText, { color: colors.destructive }]}>Reject</Text>
                    </Pressable>
                    <Pressable
                      disabled={acceptMut.isPending}
                      onPress={() => acceptMut.mutate(o.id)}
                      style={[styles.acceptBtn, { backgroundColor: colors.primary }]}
                    >
                      <Ionicons name="checkmark" size={14} color="#fff" />
                      <Text style={styles.acceptText}>Accept</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
      <OrderDetailDrawer orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  sub: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  headerCta: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  headerCtaText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 38, borderRadius: 10, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", paddingVertical: 0 },
  pills: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  list: { padding: 16 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  rejectBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  rejectText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  acceptBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderRadius: 10 },
  acceptText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
});
