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
import { StatusBadge } from "@/components/StatusBadge";
import { EntityFormSheet, FormField, formInputStyle } from "@/components/EntityFormSheet";

type Reservation = {
  id: number;
  // API uses guestName/guestPhone/scheduledAt; legacy field aliases kept for
  // forward-compat when reading.
  guestName?: string;
  guestPhone?: string;
  customerName?: string;
  customerPhone?: string;
  partySize: number;
  scheduledAt?: string;
  reservationTime?: string;
  status: "pending" | "confirmed" | "seated" | "completed" | "no_show" | "cancelled" | string;
  tableLabel?: string | null;
  tableNumber?: string | null;
  notes?: string | null;
};

const resName = (r: Reservation) => r.guestName ?? r.customerName ?? "Guest";
const resPhone = (r: Reservation) => r.guestPhone ?? r.customerPhone ?? "";
const resWhen = (r: Reservation) => r.scheduledAt ?? r.reservationTime ?? "";

export default function ReservationsScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"today" | "upcoming" | "all">("today");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const isWeb = Platform.OS === "web";

  const q = useQuery({
    queryKey: ["reservations", restaurantId, filter],
    queryFn: () => {
      const today = new Date().toISOString().slice(0, 10);
      const qs = filter === "today" ? `?date=${today}` : "";
      return customFetch<Reservation[] | { reservations?: Reservation[] }>(
        `/api/restaurants/${restaurantId}/reservations${qs}`,
      ).catch(() => []);
    },
  });
  const rawList: Reservation[] = Array.isArray(q.data) ? q.data : (q.data?.reservations ?? []);
  const list: Reservation[] = (() => {
    if (filter === "all") return rawList;
    if (filter === "upcoming") {
      const now = Date.now();
      return rawList.filter(r => {
        const w = resWhen(r);
        return w ? new Date(w).getTime() >= now : true;
      });
    }
    return rawList;
  })();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["reservations"] });
  const errToast = (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not save");

  const createM = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch(`/api/restaurants/${restaurantId}/reservations`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setCreating(false); invalidate(); },
    onError: errToast,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      customFetch(`/api/restaurants/${restaurantId}/reservations/${id}`, {
        method: "PATCH", body: JSON.stringify(body),
      }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: errToast,
  });
  const deleteM = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/reservations/${id}`, { method: "DELETE" }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: errToast,
  });

  const addButton = (
    <Pressable onPress={() => setCreating(true)} hitSlop={10}
      style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}>
      <Ionicons name="add" size={18} color="#fff" />
      <Text style={styles.addBtnText}>New</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Reservations" showBack right={addButton} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 48, flexGrow: 0 }} contentContainerStyle={styles.pills}>
        {(["today", "upcoming", "all"] as const).map(k => (
          <Pressable
            key={k}
            onPress={() => setFilter(k)}
            style={[styles.pill, { borderColor: colors.border, backgroundColor: filter === k ? colors.primary : colors.card }]}
          >
            <Text style={[styles.pillText, { color: filter === k ? "#fff" : colors.mutedForeground }]}>{k}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {list.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No reservations" message="Tap New to add one." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: isWeb ? 100 : 100 }}
        >
          {list.map(r => {
            const when = resWhen(r);
            return (
              <Pressable
                key={r.id}
                onLongPress={() => setEditing(r)}
                delayLongPress={250}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: colors.foreground }]}>{resName(r)}</Text>
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      <Ionicons name="people-outline" size={12} /> {r.partySize} · {when ? new Date(when).toLocaleString() : "—"}
                    </Text>
                    {(r.tableLabel ?? r.tableNumber) ? (
                      <Text style={[styles.meta, { color: colors.mutedForeground }]}>Table {r.tableLabel ?? r.tableNumber}</Text>
                    ) : null}
                  </View>
                  <StatusBadge label={r.status} tone={r.status === "confirmed" ? "success" : r.status === "no_show" || r.status === "cancelled" ? "danger" : "info"} />
                </View>
                {r.status === "pending" || r.status === "confirmed" ? (
                  <View style={styles.btnRow}>
                    <Pressable
                      onPress={() => update.mutate({ id: r.id, body: { status: "seated" } })}
                      style={[styles.btn, { backgroundColor: colors.primary }]}
                    >
                      <Text style={styles.btnText}>Mark arrived</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => update.mutate({ id: r.id, body: { status: "no_show" } })}
                      style={[styles.btn, { borderColor: colors.border, borderWidth: 1 }]}
                    >
                      <Text style={[styles.btnText, { color: colors.foreground }]}>No-show</Text>
                    </Pressable>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          <Text style={{ color: colors.mutedForeground, fontSize: 11, paddingHorizontal: 4, fontFamily: "Inter_400Regular" }}>
            Long-press a reservation to edit or cancel it.
          </Text>
        </ScrollView>
      )}

      <ReservationForm
        visible={creating}
        onClose={() => setCreating(false)}
        title="New reservation"
        submitLabel="Create"
        submitting={createM.isPending}
        onSubmit={(v) => createM.mutate(v)}
      />
      <ReservationForm
        visible={!!editing}
        onClose={() => setEditing(null)}
        title="Edit reservation"
        submitLabel="Save changes"
        submitting={update.isPending}
        initial={editing ?? undefined}
        onSubmit={(v) => editing && update.mutate({ id: editing.id, body: v })}
        onDelete={() => editing && deleteM.mutate(editing.id)}
        deleting={deleteM.isPending}
        deleteLabel="Cancel reservation"
      />
    </View>
  );
}

function ReservationForm({
  visible, onClose, title, submitLabel, submitting, initial, onSubmit, onDelete, deleting, deleteLabel,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  submitting: boolean;
  initial?: Partial<Reservation>;
  onSubmit: (v: Record<string, unknown>) => void;
  onDelete?: () => void;
  deleting?: boolean;
  deleteLabel?: string;
}) {
  const colors = useColors();
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [partySize, setPartySize] = useState("2");
  // datetime-local style input: store as `YYYY-MM-DDTHH:mm`
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");

  React.useEffect(() => {
    if (visible) {
      setGuestName(initial ? resName(initial as Reservation) === "Guest" && !initial.guestName ? "" : resName(initial as Reservation) : "");
      setGuestPhone(initial ? resPhone(initial as Reservation) : "");
      setPartySize(initial?.partySize ? String(initial.partySize) : "2");
      const src = initial ? resWhen(initial as Reservation) : "";
      const t = src
        ? new Date(src).toISOString().slice(0, 16)
        : new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
      setWhen(t);
      setNotes(initial?.notes ?? "");
    }
  }, [visible, initial]);

  const canSubmit = guestName.trim().length > 0 && when.length > 0 && Number(partySize) > 0 && !submitting;

  return (
    <EntityFormSheet
      visible={visible} onClose={onClose} title={title}
      submitting={submitting} canSubmit={canSubmit}
      onSubmit={() => onSubmit({
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || undefined,
        partySize: Number(partySize),
        scheduledAt: new Date(when).toISOString(),
        notes: notes.trim() || undefined,
      })}
      submitLabel={submitLabel}
      onDelete={onDelete} deleting={deleting} deleteLabel={deleteLabel}
      deleteConfirmMessage="Cancel this reservation? The guest will be notified if configured."
    >
      <FormField label="Guest name">
        <TextInput value={guestName} onChangeText={setGuestName}
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
      <FormField label="Phone">
        <TextInput value={guestPhone} onChangeText={setGuestPhone} keyboardType="phone-pad"
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <FormField label="Party size">
            <TextInput value={partySize} onChangeText={setPartySize} keyboardType="number-pad"
              placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
          </FormField>
        </View>
        <View style={{ flex: 2 }}>
          <FormField label="Date & time (YYYY-MM-DDTHH:mm)">
            <TextInput
              value={when}
              onChangeText={setWhen}
              placeholder="2026-05-21T19:30"
              autoCapitalize="none"
              placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)}
            />
          </FormField>
        </View>
      </View>
      <FormField label="Notes (optional)">
        <TextInput value={notes} onChangeText={setNotes} placeholder="Allergies, occasion, etc."
          multiline placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
    </EntityFormSheet>
  );
}

const styles = StyleSheet.create({
  pills: { gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  card: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  btnRow: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  addBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
