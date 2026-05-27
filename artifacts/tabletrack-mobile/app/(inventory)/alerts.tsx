import React, { useState, useMemo } from "react";
import { View, ScrollView, RefreshControl, Pressable, TextInput, StyleSheet } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { router } from "expo-router";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { Alert } from "@/components/ui/AppAlert";
import {
  AppText, AppCard, AppIcon, AppEmptyState, AppButton, AppBottomSheet, StatusChip,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import type { InventoryItem, Supplier, PurchaseOrder, PurchaseOrderLine } from "@/components/inventory/types";

const OPEN_PO_STATUSES = new Set(["pending", "approved", "sent", "partial"]);

export default function AlertsTab() {
  const colors = useColors();
  const { restaurantId, outletScopeId } = useAuth();
  const scopedId = outletScopeId ?? restaurantId;
  const qc = useQueryClient();
  const [poFor, setPoFor] = useState<InventoryItem | null>(null);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);

  const itemsQ = useQuery({
    queryKey: ["inventory-low", scopedId],
    queryFn: () => customFetch<InventoryItem[]>(`/api/restaurants/${scopedId}/inventory/low-stock`),
    refetchInterval: 60_000,
  });
  const suppliersQ = useQuery({
    queryKey: ["suppliers", scopedId],
    queryFn: () => customFetch<Supplier[]>(`/api/restaurants/${scopedId}/suppliers`),
  });
  const posQ = useQuery({
    queryKey: ["purchase-orders", scopedId],
    queryFn: () => customFetch<PurchaseOrder[]>(`/api/restaurants/${scopedId}/purchase-orders`),
  });

  // Map inventoryItemId -> open PO covering it, so we can show a "PO pending"
  // badge and auto-suppress alerts already actioned via reorder.
  const openPoByItem = useMemo(() => {
    const m = new Map<number, PurchaseOrder>();
    for (const po of posQ.data ?? []) {
      if (!OPEN_PO_STATUSES.has(po.status)) continue;
      for (const li of (po.items ?? [])) {
        const id = (li as PurchaseOrderLine).inventoryItemId;
        if (id && !m.has(id)) m.set(id, po);
      }
    }
    return m;
  }, [posQ.data]);

  // Server includes out-of-stock items in low-stock (stock <= min). Sort
  // out-of-stock first, then by how far below min they sit; push items
  // with an open PO to the bottom (alert effectively resolved).
  const sorted = useMemo(() => {
    return [...(itemsQ.data ?? [])].sort((a, b) => {
      const aHasPo = openPoByItem.has(a.id), bHasPo = openPoByItem.has(b.id);
      if (aHasPo !== bHasPo) return aHasPo ? 1 : -1;
      const sa = Number(a.currentStock ?? 0), sb = Number(b.currentStock ?? 0);
      if (sa === 0 && sb !== 0) return -1;
      if (sb === 0 && sa !== 0) return 1;
      const ma = Number(a.minStockLevel ?? 0) - sa;
      const mb = Number(b.minStockLevel ?? 0) - sb;
      return mb - ma;
    });
  }, [itemsQ.data, openPoByItem]);

  const visible = sorted.filter(it => showDismissed || !dismissed.has(it.id));
  const dismiss = (id: number) => setDismissed(s => { const n = new Set(s); n.add(id); return n; });
  const restore = (id: number) => setDismissed(s => { const n = new Set(s); n.delete(id); return n; });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RoleShellHeader title="Low-stock alerts" subtitle="Items at or below reorder level" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={itemsQ.isRefetching} onRefresh={() => { void itemsQ.refetch(); void posQ.refetch(); }} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
      >
        {dismissed.size > 0 ? (
          <Pressable onPress={() => setShowDismissed(s => !s)} style={{ alignSelf: "flex-end", paddingHorizontal: 8, paddingVertical: 4 }}>
            <AppText variant="micro" color="primary" weight="semibold">
              {showDismissed ? "Hide dismissed" : `Show ${dismissed.size} dismissed`}
            </AppText>
          </Pressable>
        ) : null}
        {itemsQ.isLoading ? (
          <AppEmptyState icon="time-outline" title="Loading…" description="Checking stock levels." />
        ) : itemsQ.isError ? (
          <AppEmptyState icon="alert-circle-outline" title="Couldn't load alerts" description="Pull down to retry." />
        ) : visible.length === 0 ? (
          <AppEmptyState
            icon="checkmark-done-circle-outline"
            title="All clear"
            description={sorted.length === 0 ? "No items are at or below their reorder level." : "All current alerts are dismissed or have a PO on the way."}
          />
        ) : (
          visible.map(it => {
            const stock = Number(it.currentStock ?? 0);
            const min = Number(it.minStockLevel ?? 0);
            const reorder = Number((it as InventoryItem & { reorderQuantity?: number | string }).reorderQuantity ?? 0)
              || Math.max(min * 2 - stock, min, 1);
            const openPo = openPoByItem.get(it.id);
            const isDismissed = dismissed.has(it.id);
            const tone: "danger" | "warning" = stock <= 0 ? "danger" : "warning";
            const label = stock <= 0 ? "Out" : "Low";
            return (
              <AppCard key={it.id} style={isDismissed ? { opacity: 0.6 } : undefined}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: tone === "danger" ? "#dc26261A" : "#f59e0b1A" }}>
                    <AppIcon name="alert-circle-outline" size={20} color={tone === "danger" ? "#dc2626" : "#f59e0b"} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <AppText variant="bodyMd" weight="semibold" numberOfLines={1}>{it.name}</AppText>
                    <AppText variant="small" color="mutedForeground" numberOfLines={1}>
                      {stock.toFixed(stock % 1 ? 1 : 0)} {it.unit ?? ""} · min {min.toFixed(min % 1 ? 1 : 0)}
                    </AppText>
                    {openPo ? (
                      <AppText variant="micro" color="#16a34a" style={{ marginTop: 2 }}>
                        PO-{String(openPo.id).padStart(4, "0")} on the way · {openPo.status}
                      </AppText>
                    ) : (
                      <AppText variant="micro" color="primary" style={{ marginTop: 2 }}>
                        Suggest reorder: {Number(reorder).toFixed(reorder % 1 ? 1 : 0)} {it.unit ?? ""}
                      </AppText>
                    )}
                  </View>
                  <StatusChip label={openPo ? "PO" : label} tone={openPo ? "success" : tone} />
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  {isDismissed ? (
                    <AppButton
                      label="Restore"
                      variant="secondary"
                      leftIcon="refresh-outline"
                      onPress={() => restore(it.id)}
                      size="sm"
                      fullWidth
                    />
                  ) : (
                    <>
                      {openPo ? (
                        <AppButton
                          label="Receive PO"
                          variant="secondary"
                          leftIcon="cube-outline"
                          onPress={() => { qc.setQueryData(["selected-po"], openPo); router.push("/(inventory)/receive" as never); }}
                          size="sm"
                          style={{ flex: 1 }}
                        />
                      ) : (
                        <AppButton
                          label="Create PO"
                          leftIcon="document-text-outline"
                          onPress={() => setPoFor(it)}
                          size="sm"
                          style={{ flex: 1 }}
                        />
                      )}
                      <AppButton
                        label="Dismiss"
                        variant="ghost"
                        leftIcon="checkmark-outline"
                        onPress={() => dismiss(it.id)}
                        size="sm"
                        style={{ flex: 1 }}
                      />
                    </>
                  )}
                </View>
              </AppCard>
            );
          })
        )}
      </ScrollView>

      <CreatePOSheet
        item={poFor}
        suppliers={suppliersQ.data ?? []}
        onClose={() => setPoFor(null)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["inventory-low", scopedId] });
          qc.invalidateQueries({ queryKey: ["purchase-orders", scopedId] });
          if (poFor) dismiss(poFor.id);
          setPoFor(null);
        }}
      />
    </View>
  );
}

function CreatePOSheet({
  item, suppliers, onClose, onDone,
}: {
  item: InventoryItem | null;
  suppliers: Supplier[];
  onClose: () => void;
  onDone: () => void;
}) {
  const colors = useColors();
  const { restaurantId, outletScopeId } = useAuth();
  const scopedId = outletScopeId ?? restaurantId;

  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");

  React.useEffect(() => {
    if (item) {
      const min = Number(item.minStockLevel ?? 0);
      const stock = Number(item.currentStock ?? 0);
      const reorder = Number((item as InventoryItem & { reorderQuantity?: number | string }).reorderQuantity ?? 0)
        || Math.max(min * 2 - stock, min, 1);
      setQty(String(reorder.toFixed(reorder % 1 ? 1 : 0)));
      setUnitCost(item.costPerUnit != null ? String(item.costPerUnit) : "");
      setSupplierId(item.supplierId ?? suppliers.find(s => s.isActive !== false)?.id ?? null);
      setNotes("");
    }
  }, [item, suppliers]);

  const create = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("No item");
      const q = Number(qty);
      const c = Number(unitCost);
      if (!Number.isFinite(q) || q <= 0) throw new Error("Enter a quantity > 0.");
      if (!Number.isFinite(c) || c < 0) throw new Error("Enter a unit cost.");
      const total = (q * c).toFixed(2);
      const po = await customFetch<{ id: number }>(`/api/restaurants/${scopedId}/purchase-orders`, {
        method: "POST",
        body: JSON.stringify({ supplierId, totalAmount: total, notes: notes || `Reorder for ${item.name}` }),
      });
      await customFetch(`/api/restaurants/${scopedId}/purchase-orders/${po.id}/items`, {
        method: "PUT",
        body: JSON.stringify({
          items: [{
            inventoryItemId: item.id,
            name: item.name,
            unit: item.unit ?? "",
            quantity: q,
            costPerUnit: c,
          }],
        }),
      });
      return po;
    },
    onSuccess: () => onDone(),
    onError: (e) => Alert.alert("Couldn't create PO", e instanceof Error ? e.message : "Try again."),
  });

  if (!item) return null;
  const activeSuppliers = suppliers.filter(s => s.isActive !== false);

  return (
    <AppBottomSheet visible={!!item} onClose={onClose} title="Create purchase order">
      <View style={{ padding: 12, borderRadius: 10, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}>
        <AppText variant="bodyMd" weight="semibold">{item.name}</AppText>
        <AppText variant="small" color="mutedForeground">
          On hand {Number(item.currentStock ?? 0).toFixed(1)} {item.unit ?? ""} · min {Number(item.minStockLevel ?? 0).toFixed(1)}
        </AppText>
      </View>

      <View>
        <AppText variant="small" color="mutedForeground" style={{ marginBottom: 4 }}>Supplier</AppText>
        {activeSuppliers.length === 0 ? (
          <AppText variant="small" color="destructive">No suppliers configured. PO will be unassigned.</AppText>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {activeSuppliers.map(s => {
              const active = supplierId === s.id;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setSupplierId(s.id)}
                  style={[styles.pill, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + "12" : colors.card }]}
                >
                  <AppText variant="small" color={active ? "primary" : "foreground"} weight="semibold">{s.name}</AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <AppText variant="small" color="mutedForeground" style={{ marginBottom: 4 }}>Quantity {item.unit ? `(${item.unit})` : ""}</AppText>
          <TextInput
            value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="0"
            placeholderTextColor={colors.mutedForeground}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="small" color="mutedForeground" style={{ marginBottom: 4 }}>Unit cost (₹)</AppText>
          <TextInput
            value={unitCost} onChangeText={setUnitCost} keyboardType="decimal-pad" placeholder="0.00"
            placeholderTextColor={colors.mutedForeground}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}
          />
        </View>
      </View>

      <View>
        <AppText variant="small" color="mutedForeground" style={{ marginBottom: 4 }}>Notes (optional)</AppText>
        <TextInput
          value={notes} onChangeText={setNotes} multiline placeholder="Delivery instructions, urgency…"
          placeholderTextColor={colors.mutedForeground}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14, minHeight: 48 }}
        />
      </View>

      <AppButton
        label={create.isPending ? "Creating…" : "Create PO"}
        onPress={() => create.mutate()}
        loading={create.isPending}
        disabled={create.isPending || !qty.trim()}
        fullWidth
      />
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
});
