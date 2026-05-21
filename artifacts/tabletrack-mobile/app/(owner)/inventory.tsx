import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, TextInput,
  Platform, Modal, KeyboardAvoidingView, Alert,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";

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
  const [showCreate, setShowCreate] = useState(false);

  // Don't swallow errors — when the API returns 403 (plan gate) or any
  // other failure we want to surface it instead of showing a blank list.
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

  const create = useMutation({
    mutationFn: (body: { name: string; unit: string; currentStock: string; minStockLevel: string; costPerUnit: string }) =>
      customFetch(`/api/restaurants/${restaurantId}/inventory`, {
        method: "POST", body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ["inventory", restaurantId] });
    },
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not create item"),
  });

  const addButton = (
    <Pressable
      onPress={() => setShowCreate(true)}
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
              <View key={it.id} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{it.name}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {qty.toFixed(qty % 1 ? 1 : 0)} {it.unit ?? ""} {rp > 0 ? `· reorder at ${rp}` : ""}
                  </Text>
                </View>
                <StatusBadge label={label} tone={tone} />
              </View>
            );
          })}
        </ScrollView>
      )}

      <CreateInventoryModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={(v) => create.mutate(v)}
        submitting={create.isPending}
      />
    </View>
  );
}

function CreateInventoryModal({
  visible, onClose, onSubmit, submitting,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (v: { name: string; unit: string; currentStock: string; minStockLevel: string; costPerUnit: string }) => void;
  submitting: boolean;
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [stock, setStock] = useState("");
  const [minLevel, setMinLevel] = useState("");
  const [cost, setCost] = useState("");

  React.useEffect(() => {
    if (visible) { setName(""); setUnit("kg"); setStock(""); setMinLevel(""); setCost(""); }
  }, [visible]);

  const canSubmit = name.trim().length > 0 && unit.trim().length > 0 && stock.trim().length > 0 && !submitting;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={modalStyles.backdrop}>
        <View style={[modalStyles.sheet, { backgroundColor: colors.card }]}>
          <View style={modalStyles.headerRow}>
            <Text style={[modalStyles.title, { color: colors.foreground }]}>New stock item</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <Text style={[modalStyles.label, { color: colors.mutedForeground }]}>Name</Text>
          <TextInput
            value={name} onChangeText={setName} placeholder="e.g. Basmati Rice"
            placeholderTextColor={colors.mutedForeground}
            style={[modalStyles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />

          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={[modalStyles.label, { color: colors.mutedForeground }]}>Unit</Text>
              <TextInput
                value={unit} onChangeText={setUnit} placeholder="kg, ltr, pc"
                placeholderTextColor={colors.mutedForeground}
                style={[modalStyles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[modalStyles.label, { color: colors.mutedForeground }]}>Current stock</Text>
              <TextInput
                value={stock} onChangeText={setStock} placeholder="0" keyboardType="decimal-pad"
                placeholderTextColor={colors.mutedForeground}
                style={[modalStyles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={[modalStyles.label, { color: colors.mutedForeground }]}>Reorder at</Text>
              <TextInput
                value={minLevel} onChangeText={setMinLevel} placeholder="0" keyboardType="decimal-pad"
                placeholderTextColor={colors.mutedForeground}
                style={[modalStyles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[modalStyles.label, { color: colors.mutedForeground }]}>Cost / unit (₹)</Text>
              <TextInput
                value={cost} onChangeText={setCost} placeholder="0.00" keyboardType="decimal-pad"
                placeholderTextColor={colors.mutedForeground}
                style={[modalStyles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
            </View>
          </View>

          <Pressable
            disabled={!canSubmit}
            onPress={() => onSubmit({
              name: name.trim(), unit: unit.trim(),
              currentStock: stock.trim() || "0",
              minStockLevel: minLevel.trim() || "0",
              costPerUnit: cost.trim() || "0",
            })}
            style={({ pressed }) => [modalStyles.submit, { backgroundColor: colors.primary, opacity: !canSubmit ? 0.4 : pressed ? 0.85 : 1 }]}
          >
            <Text style={modalStyles.submitText}>{submitting ? "Creating…" : "Create item"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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

const modalStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 8 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "Inter_400Regular", fontSize: 14 },
  submit: { marginTop: 16, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  submitText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
});
