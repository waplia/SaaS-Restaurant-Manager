import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform,
  TextInput, Alert,
} from "react-native";
import { router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { useRunningOrdersSummary } from "@/hooks/useRunningOrder";
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
  bill_requested: "#7c3aed",
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

  const [search, setSearch] = useState("");
  const filteredTables = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter((t) => {
      const label = (t.tableNumber ?? t.label ?? `t${t.id}`).toString().toLowerCase();
      return label.includes(needle) || String(t.id).includes(needle);
    });
  }, [tables, search]);

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
          <View style={[styles.searchWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Ionicons name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search tables"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground }]}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {search.length > 0 ? (
              <Pressable onPress={() => setSearch("")} hitSlop={10}>
                <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Long-press a table to edit or delete it.
          </Text>
          {filteredTables.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, textAlign: "center", marginTop: 16, fontSize: 13 }}>
              No tables match &ldquo;{search}&rdquo;.
            </Text>
          ) : (
            <RunningSummariesGrid tables={filteredTables} colors={colors} setEditing={setEditing} />
          )}
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

function RunningSummariesGrid({
  tables, colors, setEditing,
}: {
  tables: Table[];
  colors: ReturnType<typeof useColors>;
  setEditing: (t: Table) => void;
}) {
  const occupiedIds = React.useMemo(
    () =>
      tables
        .filter((t) => {
          const s = t.status ?? "free";
          return s === "occupied" || s === "bill_requested" || s === "billed";
        })
        .map((t) => t.id),
    [tables],
  );
  const summaries = useRunningOrdersSummary(occupiedIds);
  return (
    <View style={styles.grid}>
      {tables.map(t => {
              const color = STATUS_COLOR[t.status ?? "free"] ?? STATUS_COLOR.free;
              const summary = summaries.get(t.id);
              return (
                <Pressable
                  key={t.id}
                  onPress={() => {
                    const status = t.status ?? "free";
                    const isOccupied = status === "occupied" || status === "bill_requested" || status === "billed";
                    if (!isOccupied) return;
                    router.push({
                      pathname: "/running-order/[tableId]",
                      params: { tableId: String(t.id), tableLabel: tableLabel(t) },
                    } as never);
                  }}
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
                  {summary ? (
                    <View style={{ marginTop: 8, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 2 }}>
                      <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
                        ₹{Number(summary.runningTotal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </Text>
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 10 }}>
                        {summary.itemCount} item{summary.itemCount === 1 ? "" : "s"} · {summary.elapsedMinutes}m
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
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
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 2 },
});
