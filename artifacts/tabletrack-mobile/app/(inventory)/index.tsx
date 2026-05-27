import React, { useState, useMemo } from "react";
import { View, ScrollView, RefreshControl, Pressable, TextInput, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { router } from "expo-router";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import {
  AppText, AppIcon, AppCard, AppEmptyState, StatusChip, QuickActionButton,
} from "@/components/ui";
import { QuickActionSheet, type QuickActionKind } from "@/components/inventory/QuickActionSheet";
import type { InventoryItem, PurchaseOrder } from "@/components/inventory/types";

interface WasteRow { id: number; createdAt: string; type: string; quantity: string; itemName: string }
interface ValuationResponse { totalValue?: number | string; itemsCount?: number }
interface PendingTransfersResponse { count: number; transfers: unknown[] }

export default function InventoryHome() {
  const colors = useColors();
  const { restaurantId, outletScopeId } = useAuth();
  const scopedId = outletScopeId ?? restaurantId;

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "out" | "ok">("all");
  const [activeAction, setActiveAction] = useState<QuickActionKind | null>(null);
  const [actionItem, setActionItem] = useState<InventoryItem | null>(null);

  const itemsQ = useQuery({
    queryKey: ["inventory", scopedId, "list"],
    queryFn: () => customFetch<InventoryItem[]>(`/api/restaurants/${scopedId}/inventory`),
    refetchInterval: 60_000,
  });
  const posQ = useQuery({
    queryKey: ["purchase-orders", scopedId, "home"],
    queryFn: () => customFetch<PurchaseOrder[]>(`/api/restaurants/${scopedId}/purchase-orders`),
    refetchInterval: 60_000,
  });
  const wasteQ = useQuery({
    queryKey: ["waste-log", scopedId, "home"],
    queryFn: () => customFetch<WasteRow[]>(`/api/restaurants/${scopedId}/inventory/waste-log`),
    refetchInterval: 120_000,
  });
  const valuationQ = useQuery({
    queryKey: ["inventory-valuation", scopedId],
    queryFn: () => customFetch<ValuationResponse>(`/api/restaurants/${scopedId}/inventory/valuation`),
    refetchInterval: 300_000,
  });
  const transfersQ = useQuery({
    queryKey: ["transfers-pending", scopedId],
    queryFn: () => customFetch<PendingTransfersResponse>(`/api/restaurants/${scopedId}/inventory/transfers/pending`),
    refetchInterval: 60_000,
  });

  const items = itemsQ.data ?? [];
  const lowCount = items.filter(it => Number(it.currentStock ?? 0) > 0 && Number(it.currentStock ?? 0) <= Number(it.minStockLevel ?? 0)).length;
  const outCount = items.filter(it => Number(it.currentStock ?? 0) <= 0).length;

  const pos = posQ.data ?? [];
  const openPOs = pos.filter(p => p.status === "pending" || p.status === "approved" || p.status === "sent" || p.status === "partial");
  const pendingReceiveCount = pos.filter(p => p.status === "approved" || p.status === "sent" || p.status === "partial").length;

  const wasteTodayCount = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return (wasteQ.data ?? []).filter(w => w.type === "waste" && new Date(w.createdAt).getTime() >= t.getTime()).length;
  }, [wasteQ.data]);

  const stockValue = Number(valuationQ.data?.totalValue ?? 0);
  const pendingTransfers = transfersQ.data?.count ?? 0;

  const filtered = items.filter(it => {
    const stock = Number(it.currentStock ?? 0);
    const min = Number(it.minStockLevel ?? 0);
    if (filter === "out" && stock > 0) return false;
    if (filter === "low" && (stock <= 0 || stock > min)) return false;
    if (filter === "ok" && (stock <= 0 || (min > 0 && stock <= min))) return false;
    if (search && !it.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const onRefresh = () => {
    void itemsQ.refetch(); void posQ.refetch(); void wasteQ.refetch(); void valuationQ.refetch(); void transfersQ.refetch();
  };
  const refreshing = itemsQ.isRefetching || posQ.isRefetching || wasteQ.isRefetching || valuationQ.isRefetching || transfersQ.isRefetching;

  const formatValue = (n: number) => {
    if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
    if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}k`;
    return `₹${n.toFixed(0)}`;
  };

  const summaryCards: Array<{ k: string; label: string; value: string; icon: Parameters<typeof AppIcon>[0]["name"]; tint: string; onPress: () => void; badge?: number }> = [
    { k: "low",   label: "Low stock",         value: String(lowCount),        icon: "trending-down",       tint: "#f59e0b", onPress: () => router.push("/(inventory)/alerts" as never), badge: lowCount },
    { k: "out",   label: "Out of stock",      value: String(outCount),        icon: "close-circle-outline", tint: "#dc2626", onPress: () => setFilter("out"), badge: outCount },
    { k: "po",    label: "Open POs",          value: String(openPOs.length),  icon: "document-text-outline", tint: "#0ea5e9", onPress: () => router.push("/(inventory)/receive" as never), badge: openPOs.length },
    { k: "recv",  label: "Pending receiving", value: String(pendingReceiveCount), icon: "cube-outline",      tint: "#16a34a", onPress: () => router.push("/(inventory)/receive" as never), badge: pendingReceiveCount },
    { k: "waste", label: "Waste today",       value: String(wasteTodayCount), icon: "trash-outline",        tint: "#b91c1c", onPress: () => { setActiveAction("waste"); setActionItem(null); } },
    { k: "xfer",  label: "Pending transfers", value: String(pendingTransfers), icon: "swap-horizontal-outline", tint: "#7c3aed", onPress: () => { setActiveAction("transfer"); setActionItem(null); }, badge: pendingTransfers },
    { k: "value", label: "Stock value",       value: formatValue(stockValue), icon: "cash-outline",         tint: "#0891b2", onPress: () => router.push("/(inventory)/receive" as never) },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RoleShellHeader title="Inventory" subtitle="Stock & operations" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 14 }}
      >
        <View style={styles.cardsGrid}>
          {summaryCards.map(c => (
            <Pressable
              key={c.k}
              onPress={c.onPress}
              style={({ pressed }) => [styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={[styles.summaryIcon, { backgroundColor: c.tint + "1A" }]}>
                <AppIcon name={c.icon} size={18} color={c.tint} />
              </View>
              <AppText variant="h2" weight="bold">{c.value}</AppText>
              <AppText variant="micro" color="mutedForeground" numberOfLines={1}>{c.label}</AppText>
            </Pressable>
          ))}
        </View>

        <AppText variant="h3">Quick actions</AppText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <QuickActionButton icon="add-circle-outline"        label="Stock in"    onPress={() => { setActiveAction("in"); setActionItem(null); }} />
          <QuickActionButton icon="remove-circle-outline"     label="Stock out"   onPress={() => { setActiveAction("out"); setActionItem(null); }} />
          <QuickActionButton icon="construct-outline"         label="Adjust"      onPress={() => { setActiveAction("adjust"); setActionItem(null); }} />
          <QuickActionButton icon="trash-outline"             label="Wastage"     onPress={() => { setActiveAction("waste"); setActionItem(null); }} />
          <QuickActionButton icon="swap-horizontal-outline"   label="Transfer"    onPress={() => { setActiveAction("transfer"); setActionItem(null); }} />
          <QuickActionButton icon="cube-outline"              label="Receive PO"  onPress={() => router.push("/(inventory)/receive" as never)} />
        </View>

        <AppCard padding={0} style={{ overflow: "hidden" }}>
          <View style={{ padding: 12, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <AppText variant="h3">Stock list</AppText>
              <AppText variant="small" color="mutedForeground">{filtered.length} of {items.length}</AppText>
            </View>
            <View style={[styles.search, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <AppIcon name="search-outline" size={16} color="mutedForeground" />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search by item"
                placeholderTextColor={colors.mutedForeground}
                style={{ flex: 1, color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {(["all", "low", "out", "ok"] as const).map(f => (
                <Pressable
                  key={f}
                  onPress={() => setFilter(f)}
                  style={[styles.pill, { borderColor: colors.border, backgroundColor: filter === f ? colors.primary : colors.card }]}
                >
                  <AppText variant="micro" color={filter === f ? "#fff" : "mutedForeground"} weight="semibold">
                    {f === "all" ? "All" : f === "low" ? "Low" : f === "out" ? "Out" : "OK"}
                  </AppText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          {itemsQ.isLoading ? (
            <AppEmptyState icon="time-outline" title="Loading…" description="Fetching stock items." />
          ) : itemsQ.isError ? (
            <AppEmptyState icon="alert-circle-outline" title="Couldn't load stock" description="Pull down to retry." />
          ) : filtered.length === 0 ? (
            <AppEmptyState icon="cube-outline" title="No items" description="No items match this filter." />
          ) : (
            filtered.map(it => {
              const stock = Number(it.currentStock ?? 0);
              const min = Number(it.minStockLevel ?? 0);
              const tone: "danger" | "warning" | "success" =
                stock <= 0 ? "danger" : (min > 0 && stock <= min) ? "warning" : "success";
              const status = stock <= 0 ? "Out" : (min > 0 && stock <= min) ? "Low" : "OK";
              return (
                <Pressable
                  key={it.id}
                  onPress={() => { setActionItem(it); setActiveAction("in"); }}
                  style={({ pressed }) => [styles.row, { borderTopColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <AppText variant="bodyMd" weight="semibold" numberOfLines={1}>{it.name}</AppText>
                    <AppText variant="small" color="mutedForeground" numberOfLines={1}>
                      {stock.toFixed(stock % 1 ? 1 : 0)} {it.unit ?? ""}
                      {min > 0 ? ` · min ${Number(min).toFixed(min % 1 ? 1 : 0)} ${it.unit ?? ""}` : ""}
                    </AppText>
                  </View>
                  <StatusChip label={status} tone={tone} />
                </Pressable>
              );
            })
          )}
        </AppCard>
      </ScrollView>

      <QuickActionSheet
        kind={activeAction}
        preselect={actionItem}
        onClose={() => { setActiveAction(null); setActionItem(null); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cardsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summaryCard: {
    flexBasis: "31%", flexGrow: 1, minWidth: 100,
    padding: 12, borderRadius: 14, borderWidth: 1, gap: 4,
  },
  summaryIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 12, borderTopWidth: 1 },
});
