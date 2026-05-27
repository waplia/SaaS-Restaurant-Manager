import React, { useState, useMemo } from "react";
import { View, ScrollView, RefreshControl, Pressable, TextInput, StyleSheet } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { Alert } from "@/components/ui/AppAlert";
import {
  AppText, AppCard, AppIcon, AppEmptyState, AppButton, AppBottomSheet, StatusChip,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import type { PurchaseOrder, PurchaseOrderLine, Supplier } from "@/components/inventory/types";

const OPEN_STATUSES = new Set(["pending", "approved", "sent", "partial"]);

export default function ReceiveTab() {
  const colors = useColors();
  const { restaurantId, outletScopeId } = useAuth();
  const scopedId = outletScopeId ?? restaurantId;
  const qc = useQueryClient();
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);

  const posQ = useQuery({
    queryKey: ["purchase-orders", scopedId],
    queryFn: () => customFetch<PurchaseOrder[]>(`/api/restaurants/${scopedId}/purchase-orders`),
    refetchInterval: 60_000,
  });
  const suppliersQ = useQuery({
    queryKey: ["suppliers", scopedId],
    queryFn: () => customFetch<Supplier[]>(`/api/restaurants/${scopedId}/suppliers`),
  });
  const supplierName = (id: number | null | undefined) =>
    (id && suppliersQ.data?.find(s => s.id === id)?.name) || "Unassigned supplier";

  const open = (posQ.data ?? []).filter(p => OPEN_STATUSES.has(p.status));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RoleShellHeader title="Receive PO" subtitle="Confirm incoming stock" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={posQ.isRefetching} onRefresh={posQ.refetch} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 12 }}
      >
        {posQ.isLoading ? (
          <AppEmptyState icon="time-outline" title="Loading…" description="Fetching purchase orders." />
        ) : posQ.isError ? (
          <AppEmptyState icon="alert-circle-outline" title="Couldn't load POs" description="Pull down to retry." />
        ) : open.length === 0 ? (
          <AppEmptyState icon="cube-outline" title="No open POs" description="Every purchase order has been received." />
        ) : (
          open.map(po => {
            const itemsCount = po.items?.length ?? 0;
            const tone: "warning" | "primary" | "success" =
              po.status === "partial" ? "warning" : po.status === "approved" || po.status === "sent" ? "primary" : "success";
            return (
              <Pressable key={po.id} onPress={() => setSelected(po)}>
                <AppCard>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.primary + "1A", alignItems: "center", justifyContent: "center" }}>
                      <AppIcon name="document-text-outline" size={20} color="primary" />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <AppText variant="bodyMd" weight="semibold" numberOfLines={1}>
                        PO-{String(po.id).padStart(4, "0")}
                      </AppText>
                      <AppText variant="small" color="mutedForeground" numberOfLines={1}>
                        {supplierName(po.supplierId)} · {itemsCount} {itemsCount === 1 ? "line" : "lines"} · ₹{Number(po.totalAmount).toFixed(2)}
                      </AppText>
                    </View>
                    <StatusChip label={po.status} tone={tone} />
                  </View>
                </AppCard>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <ReceivePOSheet
        po={selected}
        supplierName={selected ? supplierName(selected.supplierId) : ""}
        onClose={() => setSelected(null)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["purchase-orders", scopedId] });
          qc.invalidateQueries({ queryKey: ["inventory", scopedId] });
          setSelected(null);
        }}
      />
    </View>
  );
}

function ReceivePOSheet({
  po, supplierName, onClose, onDone,
}: {
  po: PurchaseOrder | null;
  supplierName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const colors = useColors();
  const { restaurantId, outletScopeId } = useAuth();
  const scopedId = outletScopeId ?? restaurantId;
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [batches, setBatches] = useState<Record<number, string>>({});
  const [expiries, setExpiries] = useState<Record<number, string>>({});

  React.useEffect(() => {
    if (po) {
      const q: Record<number, string> = {};
      for (const li of po.items ?? []) q[li.id] = String(li.quantity ?? 0);
      setQtys(q);
      setBatches({});
      setExpiries({});
    }
  }, [po]);

  const totalReceivedQty = useMemo(() => {
    if (!po) return 0;
    return (po.items ?? []).reduce((s, li) => s + Number(qtys[li.id] ?? 0), 0);
  }, [po, qtys]);

  const receive = useMutation({
    mutationFn: async () => {
      if (!po) throw new Error("No PO");
      // Server marks PO received and increments stock per line; per-line qty
      // overrides aren't supported by PATCH today, so we PUT items first to
      // honor any qty edits, then PATCH status=received with batch metadata.
      const editedItems = (po.items ?? []).map(li => ({
        inventoryItemId: li.inventoryItemId,
        name: (li as PurchaseOrderLine & { name?: string }).name ?? li.itemName ?? "",
        unit: li.unit ?? "",
        quantity: qtys[li.id] ?? String(li.quantity ?? 0),
        costPerUnit: String(li.costPerUnit ?? 0),
      }));
      const someEdited = editedItems.some((e, i) => Number(e.quantity) !== Number(po.items?.[i].quantity ?? 0));
      if (someEdited) {
        await customFetch(`/api/restaurants/${scopedId}/purchase-orders/${po.id}/items`, {
          method: "PUT", body: JSON.stringify({ items: editedItems }),
        });
      }
      const batchPayload = (po.items ?? [])
        .filter(li => batches[li.id] || expiries[li.id])
        .map(li => ({
          purchaseOrderItemId: li.id,
          batchNumber: batches[li.id] || null,
          expiryDate: expiries[li.id] || null,
        }));
      // Staff app marks goods received — server handles all accounting
      // postings (AP, payments) automatically; no billing UI here.
      return customFetch(`/api/restaurants/${scopedId}/purchase-orders/${po.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "received", batches: batchPayload }),
      });
    },
    onSuccess: () => onDone(),
    onError: (e) => Alert.alert("Couldn't receive PO", e instanceof Error ? e.message : "Try again."),
  });

  if (!po) return null;

  return (
    <AppBottomSheet visible={!!po} onClose={onClose} title={`PO-${String(po.id).padStart(4, "0")}`} maxHeightFraction={0.95}>
      <AppText variant="small" color="mutedForeground">{supplierName}</AppText>

      {(po.items ?? []).length === 0 ? (
        <AppEmptyState icon="cube-outline" title="No line items" description="This PO has no items to receive." />
      ) : (
        (po.items ?? []).map(li => {
          const name = (li as PurchaseOrderLine & { name?: string }).name ?? li.itemName ?? "(item)";
          return (
            <View key={li.id} style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, gap: 8, backgroundColor: colors.card }}>
              <AppText variant="bodyMd" weight="semibold" numberOfLines={1}>{name}</AppText>
              <AppText variant="small" color="mutedForeground">
                Ordered: {Number(li.quantity).toFixed(2)} {li.unit ?? ""} @ ₹{Number(li.costPerUnit).toFixed(2)}
              </AppText>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="micro" color="mutedForeground" style={{ marginBottom: 4 }}>Received qty</AppText>
                  <TextInput
                    value={qtys[li.id] ?? ""}
                    onChangeText={(v) => setQtys(s => ({ ...s, [li.id]: v }))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.mutedForeground}
                    style={inputStyle(colors)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="micro" color="mutedForeground" style={{ marginBottom: 4 }}>Batch (optional)</AppText>
                  <TextInput
                    value={batches[li.id] ?? ""}
                    onChangeText={(v) => setBatches(s => ({ ...s, [li.id]: v }))}
                    placeholder="B-001"
                    placeholderTextColor={colors.mutedForeground}
                    style={inputStyle(colors)}
                  />
                </View>
              </View>
              <View>
                <AppText variant="micro" color="mutedForeground" style={{ marginBottom: 4 }}>Expiry (YYYY-MM-DD, optional)</AppText>
                <TextInput
                  value={expiries[li.id] ?? ""}
                  onChangeText={(v) => setExpiries(s => ({ ...s, [li.id]: v }))}
                  placeholder="2026-12-31"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  style={inputStyle(colors)}
                />
              </View>
            </View>
          );
        })
      )}

      <View style={{ padding: 12, borderRadius: 10, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}>
        <AppText variant="small" color="mutedForeground">Total received</AppText>
        <AppText variant="h3" weight="bold">{totalReceivedQty.toFixed(2)} units across {(po.items ?? []).length} lines</AppText>
      </View>

      <AppButton
        label={receive.isPending ? "Receiving…" : "Mark received & update stock"}
        onPress={() => receive.mutate()}
        loading={receive.isPending}
        disabled={receive.isPending || (po.items?.length ?? 0) === 0}
        fullWidth
      />
    </AppBottomSheet>
  );
}

function inputStyle(colors: ReturnType<typeof useColors>) {
  return {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10,
    color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14,
  } as const;
}
