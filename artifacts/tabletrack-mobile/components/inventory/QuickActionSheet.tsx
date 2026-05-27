import React, { useEffect, useState, useMemo } from "react";
import { View, TextInput, Pressable } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import {
  AppBottomSheet, AppText, AppButton, AppEmptyState, AppIcon,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import type { InventoryItem, AuthOutletLite } from "./types";

export type QuickActionKind = "in" | "out" | "adjust" | "waste" | "transfer";

export interface QuickActionSheetProps {
  kind: QuickActionKind | null;
  preselect?: InventoryItem | null;
  onClose: () => void;
  onDone?: () => void;
}

const META: Record<QuickActionKind, { title: string; verb: string; type: string; tone: string; help: string }> = {
  in:       { title: "Stock In",   verb: "Add stock",    type: "add",    tone: "#16a34a", help: "Add received quantity to current stock." },
  out:      { title: "Stock Out",  verb: "Remove stock", type: "remove", tone: "#0ea5e9", help: "Issue stock for use or sale." },
  adjust:   { title: "Adjustment", verb: "Set stock",    type: "adjust", tone: "#f59e0b", help: "Override current stock to the counted value." },
  waste:    { title: "Wastage",    verb: "Record waste", type: "waste",  tone: "#dc2626", help: "Record spoilage / expiry / breakage." },
  transfer: { title: "Transfer",   verb: "Transfer",     type: "transfer", tone: "#7c3aed", help: "Move stock to another outlet." },
};

export function QuickActionSheet({ kind, preselect, onClose, onDone }: QuickActionSheetProps) {
  const colors = useColors();
  const { restaurantId, outletScopeId, outlets } = useAuth();
  const scopedId = outletScopeId ?? restaurantId;
  const qc = useQueryClient();

  const [item, setItem] = useState<InventoryItem | null>(preselect ?? null);
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [destOutletId, setDestOutletId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (kind) {
      setItem(preselect ?? null);
      setQty("");
      setNotes("");
      setDestOutletId(null);
      setSearch("");
    }
  }, [kind, preselect]);

  const itemsQ = useQuery({
    queryKey: ["inventory", scopedId, "all"],
    queryFn: () => customFetch<InventoryItem[]>(`/api/restaurants/${scopedId}/inventory`),
    enabled: !!kind && !preselect,
  });

  const otherOutlets = useMemo(
    () => (outlets ?? []).filter((o: AuthOutletLite) => o.id !== scopedId),
    [outlets, scopedId],
  );

  const submit = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("Pick a stock item first.");
      const n = Number(qty);
      if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid quantity.");
      if (kind !== "adjust" && n <= 0) throw new Error("Enter a quantity greater than zero.");
      if (kind === "transfer") {
        if (!destOutletId) throw new Error("Pick a destination outlet.");
        return customFetch(`/api/restaurants/${scopedId}/inventory/${item.id}/transfer`, {
          method: "POST",
          body: JSON.stringify({ destRestaurantId: destOutletId, quantity: n, notes }),
        });
      }
      const m = META[kind!];
      return customFetch(`/api/restaurants/${scopedId}/inventory/${item.id}/adjust`, {
        method: "POST",
        body: JSON.stringify({ type: m.type, quantity: n, notes }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory", scopedId] });
      qc.invalidateQueries({ queryKey: ["inventory-low", scopedId] });
      onDone?.();
      onClose();
    },
    onError: (e) => Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again."),
  });

  if (!kind) return null;
  const meta = META[kind];

  const filtered = (itemsQ.data ?? []).filter(it =>
    !search || it.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AppBottomSheet visible={!!kind} onClose={onClose} title={meta.title}>
      <AppText variant="small" color="mutedForeground">{meta.help}</AppText>

      {!item ? (
        <View style={{ gap: 8 }}>
          <AppText variant="bodyMd" weight="semibold">Pick item</AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, backgroundColor: colors.muted }}>
            <AppIcon name="search-outline" size={16} color="mutedForeground" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search stock items"
              placeholderTextColor={colors.mutedForeground}
              style={{ flex: 1, paddingVertical: 10, color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}
            />
          </View>
          <View style={{ maxHeight: 280, gap: 4 }}>
            {itemsQ.isLoading ? (
              <AppText variant="small" color="mutedForeground">Loading items…</AppText>
            ) : filtered.length === 0 ? (
              <AppEmptyState icon="cube-outline" title="No items" description="No stock items match." />
            ) : (
              filtered.slice(0, 30).map(it => (
                <Pressable
                  key={it.id}
                  onPress={() => setItem(it)}
                  style={{ flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <AppText variant="bodyMd" numberOfLines={1}>{it.name}</AppText>
                    <AppText variant="small" color="mutedForeground">
                      {Number(it.currentStock ?? 0).toFixed(1)} {it.unit ?? ""} on hand
                    </AppText>
                  </View>
                  <AppIcon name="chevron-forward" size={18} color="mutedForeground" />
                </Pressable>
              ))
            )}
          </View>
        </View>
      ) : (
        <>
          <View style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: meta.tone + "22" }}>
                <AppIcon name="cube-outline" size={18} color={meta.tone} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="bodyMd" weight="semibold" numberOfLines={1}>{item.name}</AppText>
                <AppText variant="small" color="mutedForeground">
                  {Number(item.currentStock ?? 0).toFixed(1)} {item.unit ?? ""} on hand
                  {item.minStockLevel != null ? ` · reorder at ${Number(item.minStockLevel).toFixed(1)}` : ""}
                </AppText>
              </View>
              {!preselect ? (
                <Pressable onPress={() => setItem(null)} hitSlop={8}>
                  <AppText variant="small" color="primary">Change</AppText>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View>
            <AppText variant="small" color="mutedForeground" style={{ marginBottom: 4 }}>
              {kind === "adjust" ? "New on-hand quantity" : "Quantity"} {item.unit ? `(${item.unit})` : ""}
            </AppText>
            <TextInput
              value={qty}
              onChangeText={setQty}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.mutedForeground}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 16 }}
            />
          </View>

          {kind === "transfer" ? (
            <View>
              <AppText variant="small" color="mutedForeground" style={{ marginBottom: 4 }}>Destination outlet</AppText>
              {otherOutlets.length === 0 ? (
                <AppText variant="small" color="destructive">No other outlets available to transfer to.</AppText>
              ) : (
                <View style={{ gap: 6 }}>
                  {otherOutlets.map(o => {
                    const active = destOutletId === o.id;
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => setDestOutletId(o.id)}
                        style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + "12" : colors.card }}
                      >
                        <AppIcon name={active ? "radio-button-on" : "radio-button-off"} size={18} color={active ? "primary" : "mutedForeground"} />
                        <AppText variant="bodyMd">{o.name}</AppText>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          <View>
            <AppText variant="small" color="mutedForeground" style={{ marginBottom: 4 }}>Notes (optional)</AppText>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder={kind === "waste" ? "Reason (spoilage, breakage…)" : "Reference / remarks"}
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14, minHeight: 48 }}
            />
          </View>

          <AppButton
            label={submit.isPending ? "Saving…" : meta.verb}
            onPress={() => submit.mutate()}
            loading={submit.isPending}
            disabled={
              submit.isPending ||
              !qty.trim() ||
              (kind !== "adjust" && Number(qty) <= 0) ||
              (kind === "transfer" && !destOutletId)
            }
            fullWidth
          />
        </>
      )}
    </AppBottomSheet>
  );
}
