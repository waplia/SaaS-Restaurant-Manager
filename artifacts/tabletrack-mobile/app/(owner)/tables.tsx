import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform,
  TextInput, Alert,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { EntityFormSheet, FormField, formInputStyle } from "@/components/EntityFormSheet";
import { usePlanLimits } from "@/hooks/usePlanLimits";

type Table = {
  id: number;
  // API exposes the floor number as `tableNumber` (string); some legacy
  // responses also include a `label` field. Read both for safety.
  tableNumber?: string;
  label?: string;
  status?: "free" | "available" | "occupied" | "reserved" | "cleaning" | "billed" | string;
  capacity?: number;
  currentOrderId?: number | null;
};

const STATUS_COLOR: Record<string, string> = {
  free: "#16a34a",
  available: "#16a34a",
  occupied: "#ea580c",
  reserved: "#2563eb",
  cleaning: "#9ca3af",
  billed: "#7c3aed",
};

const tableLabel = (t: Table) => t.tableNumber ?? t.label ?? "—";

export default function TablesScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Table | null>(null);
  const limits = usePlanLimits();

  const q = useQuery({
    queryKey: ["tables", restaurantId],
    queryFn: () => customFetch<Table[]>(`/api/restaurants/${restaurantId}/tables`).catch(() => []),
  });
  const tables = Array.isArray(q.data) ? q.data : [];
  const tableLimit = limits.tables(tables.length);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tables", restaurantId] });
  const errToast = (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not save");

  const createM = useMutation({
    mutationFn: (body: { tableNumber: string; capacity: number }) =>
      customFetch(`/api/restaurants/${restaurantId}/tables`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setCreating(false); invalidate(); },
    onError: errToast,
  });
  const updateM = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { tableNumber?: string; capacity?: number } }) =>
      customFetch(`/api/restaurants/${restaurantId}/tables/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: errToast,
  });
  const deleteM = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/tables/${id}`, { method: "DELETE" }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: errToast,
  });

  const addButton = (
    <Pressable
      onPress={() => tableLimit.reached
        ? Alert.alert("Plan limit reached", tableLimit.reason ?? "Upgrade your plan to add more tables.")
        : setCreating(true)}
      hitSlop={10}
      style={({ pressed }) => [styles.addBtn, {
        backgroundColor: colors.primary,
        opacity: tableLimit.reached ? 0.4 : (pressed ? 0.85 : 1),
      }]}>
      <Ionicons name="add" size={18} color="#fff" />
      <Text style={styles.addBtnText}>Add</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader
        title="Tables"
        subtitle={tableLimit.limit > 0
          ? `${tables.length} / ${tableLimit.limit} on ${tableLimit.planName}`
          : `${tables.length} total`}
        showBack
        right={addButton}
      />
      {q.isLoading ? (
        <View style={{ padding: 32, alignItems: "center" }}>
          <Text style={{ color: colors.mutedForeground }}>Loading…</Text>
        </View>
      ) : tables.length === 0 ? (
        <EmptyState icon="grid-outline" title="No tables yet" message="Tap Add to set up your floor plan." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: isWeb ? 100 : 100 }}
        >
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Long-press a table to edit or delete it.
          </Text>
          <View style={styles.grid}>
            {tables.map(t => {
              const color = STATUS_COLOR[t.status ?? "free"] ?? STATUS_COLOR.free;
              return (
                <Pressable
                  key={t.id}
                  onLongPress={() => setEditing(t)}
                  delayLongPress={250}
                  style={({ pressed }) => [
                    styles.tile,
                    { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <View style={[styles.statusDot, { backgroundColor: color }]} />
                  <Text style={[styles.label, { color: colors.foreground }]}>{tableLabel(t)}</Text>
                  {t.capacity ? (
                    <Text style={[styles.capacity, { color: colors.mutedForeground }]}>
                      <Ionicons name="people-outline" size={11} /> {t.capacity}
                    </Text>
                  ) : null}
                  <Text style={[styles.status, { color }]}>{(t.status ?? "free").replace("_", " ")}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}

      <TableForm
        visible={creating}
        onClose={() => setCreating(false)}
        title="New table"
        submitLabel="Create table"
        submitting={createM.isPending}
        onSubmit={(v) => createM.mutate(v)}
      />
      <TableForm
        visible={!!editing}
        onClose={() => setEditing(null)}
        title="Edit table"
        submitLabel="Save changes"
        submitting={updateM.isPending}
        initial={editing ?? undefined}
        onSubmit={(v) => editing && updateM.mutate({ id: editing.id, body: v })}
        onDelete={() => editing && deleteM.mutate(editing.id)}
        deleting={deleteM.isPending}
      />
    </View>
  );
}

function TableForm({
  visible, onClose, title, submitLabel, submitting, initial, onSubmit, onDelete, deleting,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  submitting: boolean;
  initial?: Partial<Table>;
  onSubmit: (v: { tableNumber: string; capacity: number }) => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const colors = useColors();
  const [tableNumber, setTableNumber] = useState("");
  const [capacity, setCapacity] = useState("");

  React.useEffect(() => {
    if (visible) {
      setTableNumber(initial ? tableLabel(initial as Table) === "—" ? "" : tableLabel(initial as Table) : "");
      // The backend requires capacity ≥ 1, so default new tables to 4 seats.
      setCapacity(initial?.capacity ? String(initial.capacity) : "4");
    }
  }, [visible, initial]);

  const capacityNum = Number(capacity);
  const capacityValid = Number.isFinite(capacityNum) && capacityNum >= 1;
  const canSubmit = tableNumber.trim().length > 0 && capacityValid && !submitting;

  return (
    <EntityFormSheet
      visible={visible} onClose={onClose} title={title}
      submitting={submitting} canSubmit={canSubmit}
      onSubmit={() => onSubmit({
        tableNumber: tableNumber.trim(),
        capacity: capacityNum,
      })}
      submitLabel={submitLabel}
      onDelete={onDelete} deleting={deleting}
      deleteConfirmMessage="Delete this table from the floor plan?"
    >
      <FormField label="Table number / label">
        <TextInput value={tableNumber} onChangeText={setTableNumber} placeholder="e.g. T1"
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
      <FormField label="Capacity (seats)">
        <TextInput value={capacity} onChangeText={setCapacity} keyboardType="number-pad"
          placeholder="4" placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
    </EntityFormSheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "31%", aspectRatio: 1, borderRadius: 12, borderWidth: 1, padding: 10, justifyContent: "space-between" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 17, fontFamily: "Inter_700Bold" },
  capacity: { fontSize: 11, fontFamily: "Inter_500Medium" },
  status: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", paddingHorizontal: 4 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  addBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
