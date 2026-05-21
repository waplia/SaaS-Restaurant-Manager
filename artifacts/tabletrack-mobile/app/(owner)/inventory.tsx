import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, TextInput,
  Platform, Alert,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { EntityFormSheet, FormField, formInputStyle } from "@/components/EntityFormSheet";

type Item = {
  id: number;
  name: string;
  sku?: string;
  currentStock?: number | string;
  quantity?: number | string;
  minStockLevel?: number | string;
  reorderPoint?: number | string;
  unit?: string;
  costPerUnit?: string;
};

function itemQty(it: Item): number {
  return Number(it.currentStock ?? it.quantity ?? 0);
}
function itemReorder(it: Item): number {
  return Number(it.minStockLevel ?? it.reorderPoint ?? 0);
}

export default function InventoryScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  const q = useQuery({
    queryKey: ["inventory", restaurantId],
    queryFn: () => customFetch<Item[]>(`/api/restaurants/${restaurantId}/inventory`),
  });

  const items = (Array.isArray(q.data) ? q.data : []).filter(it => {
    const qty = itemQty(it);
    const rp = itemReorder(it);
    if (filter === "low" && qty > rp) return false;
    if (filter === "out" && qty > 0) return false;
    if (search && !it.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const errToast = (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not save");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["inventory", restaurantId] });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch(`/api/restaurants/${restaurantId}/inventory`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setCreating(false); invalidate(); },
    onError: errToast,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      customFetch(`/api/restaurants/${restaurantId}/inventory/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: errToast,
  });
  const deleteM = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/inventory/${id}`, { method: "DELETE" }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: errToast,
  });

  const addButton = (
    <Pressable
      onPress={() => setCreating(true)}
      hitSlop={10}
      style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
    >
      <Ionicons name="add" size={18} color="#fff" />
      <Text style={styles.addBtnText}>Add</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Inventory" subtitle={`${items.length} items`} showBack right={addButton} />
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 10 }}>
        <View style={[styles.search, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={16} color={colors.mutedForeground} />
          <TextInput
            placeholder="Search items"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            style={{ flex: 1, color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(["all", "low", "out"] as const).map(k => (
            <Pressable
              key={k}
              onPress={() => setFilter(k)}
              style={[styles.pill, { borderColor: colors.border, backgroundColor: filter === k ? colors.primary : colors.card }]}
            >
              <Text style={[styles.pillText, { color: filter === k ? "#fff" : colors.mutedForeground }]}>
                {k === "all" ? "All" : k === "low" ? "Low stock" : "Out of stock"}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {q.isError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't load inventory"
          message={q.error instanceof Error ? q.error.message : "Please try again."}
        />
      ) : q.isLoading ? (
        <EmptyState icon="time-outline" title="Loading…" message="Fetching your stock items." />
      ) : items.length === 0 ? (
        <EmptyState icon="cube-outline" title="No items" message="No stock items match this filter yet." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: isWeb ? 100 : 100 }}
        >
          {items.map(it => {
            const qty = itemQty(it);
            const rp = itemReorder(it);
            const tone = qty === 0 ? "danger" : qty <= rp ? "warning" : "success";
            const label = qty === 0 ? "Out" : qty <= rp ? "Low" : "OK";
            return (
              <Pressable
                key={it.id}
                onPress={() => setEditing(it)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{it.name}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {qty.toFixed(qty % 1 ? 1 : 0)} {it.unit ?? ""} {rp > 0 ? `· reorder at ${rp}` : ""}
                  </Text>
                </View>
                <StatusBadge label={label} tone={tone} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <InventoryForm
        visible={creating}
        onClose={() => setCreating(false)}
        title="New stock item"
        submitLabel="Create item"
        submitting={create.isPending}
        onSubmit={(v) => create.mutate(v)}
      />
      <InventoryForm
        visible={!!editing}
        onClose={() => setEditing(null)}
        title="Edit stock item"
        submitLabel="Save changes"
        submitting={update.isPending}
        initial={editing ?? undefined}
        onSubmit={(v) => editing && update.mutate({ id: editing.id, body: v })}
        onDelete={() => editing && deleteM.mutate(editing.id)}
        deleting={deleteM.isPending}
      />
    </View>
  );
}

function InventoryForm({
  visible, onClose, title, submitLabel, submitting, initial, onSubmit, onDelete, deleting,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  submitting: boolean;
  initial?: Partial<Item>;
  onSubmit: (v: Record<string, unknown>) => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [stock, setStock] = useState("");
  const [minLevel, setMinLevel] = useState("");
  const [cost, setCost] = useState("");

  React.useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setUnit(initial?.unit ?? "kg");
      setStock(initial?.currentStock != null ? String(initial.currentStock) : initial?.quantity != null ? String(initial.quantity) : "");
      setMinLevel(initial?.minStockLevel != null ? String(initial.minStockLevel) : initial?.reorderPoint != null ? String(initial.reorderPoint) : "");
      setCost(initial?.costPerUnit != null ? String(initial.costPerUnit) : "");
    }
  }, [visible, initial]);

  const canSubmit = name.trim().length > 0 && unit.trim().length > 0 && !submitting;

  return (
    <EntityFormSheet
      visible={visible} onClose={onClose} title={title}
      submitting={submitting} canSubmit={canSubmit}
      onSubmit={() => onSubmit({
        name: name.trim(),
        unit: unit.trim(),
        currentStock: stock.trim() || "0",
        minStockLevel: minLevel.trim() || "0",
        costPerUnit: cost.trim() || "0",
      })}
      submitLabel={submitLabel}
      onDelete={onDelete} deleting={deleting}
      deleteConfirmMessage="Delete this stock item and its history?"
    >
      <FormField label="Name">
        <TextInput value={name} onChangeText={setName} placeholder="e.g. Basmati Rice"
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <FormField label="Unit">
            <TextInput value={unit} onChangeText={setUnit} placeholder="kg, ltr, pc"
              placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
          </FormField>
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Current stock">
            <TextInput value={stock} onChangeText={setStock} placeholder="0" keyboardType="decimal-pad"
              placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
          </FormField>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <FormField label="Reorder at">
            <TextInput value={minLevel} onChangeText={setMinLevel} placeholder="0" keyboardType="decimal-pad"
              placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
          </FormField>
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Cost / unit (₹)">
            <TextInput value={cost} onChangeText={setCost} placeholder="0.00" keyboardType="decimal-pad"
              placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
          </FormField>
        </View>
      </View>
    </EntityFormSheet>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  addBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
