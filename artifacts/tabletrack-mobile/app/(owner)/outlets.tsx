import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform,
  TextInput, Alert, Switch,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { EntityFormSheet, FormField, formInputStyle } from "@/components/EntityFormSheet";
import { PhoneInput } from "@/components/PhoneInput";
import { usePlanLimits } from "@/hooks/usePlanLimits";

type Branch = {
  id: number;
  name: string;
  address?: string | null;
  phone?: string | null;
  isMain?: boolean;
  city?: string | null;
  isActive?: boolean;
};

type FormValues = { name: string; address?: string; phone?: string; isMain: boolean };

export default function OutletsScreen() {
  const colors = useColors();
  const { restaurantId, tenantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const limits = usePlanLimits();

  // The branches endpoint lives under the active restaurant; this matches what
  // the web dashboard uses and keeps the mobile/web view in sync.
  const q = useQuery({
    queryKey: ["branches", restaurantId],
    queryFn: () => customFetch<Branch[]>(`/api/restaurants/${restaurantId}/branches`).catch(() => []),
    enabled: restaurantId != null,
  });
  const list = Array.isArray(q.data) ? q.data : [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["branches", restaurantId] });
    qc.invalidateQueries({ queryKey: ["tenant-branches", tenantId] });
  };

  const createM = useMutation({
    mutationFn: (body: FormValues) =>
      customFetch(`/api/restaurants/${restaurantId}/branches`, {
        method: "POST", body: JSON.stringify(body),
      }),
    onSuccess: () => { setCreating(false); invalidate(); },
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not create outlet"),
  });

  const updateM = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<FormValues> }) =>
      customFetch(`/api/restaurants/${restaurantId}/branches/${id}`, {
        method: "PATCH", body: JSON.stringify(body),
      }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not update outlet"),
  });

  const deleteM = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/branches/${id}`, { method: "DELETE" }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: (e: unknown) => Alert.alert("Cannot delete", e instanceof Error ? e.message : "Outlet may have linked records"),
  });

  const confirmDelete = (b: Branch) => {
    Alert.alert("Delete outlet?", `Remove “${b.name}”? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteM.mutate(b.id) },
    ]);
  };

  const branchLimit = limits.branches(list.length);
  const addButton = (
    <Pressable
      onPress={() => branchLimit.reached
        ? Alert.alert("Plan limit reached", branchLimit.reason ?? "Upgrade your plan to add more outlets.")
        : setCreating(true)}
      hitSlop={10}
      style={({ pressed }) => [styles.addBtn, {
        backgroundColor: colors.primary,
        opacity: branchLimit.reached ? 0.4 : (pressed ? 0.85 : 1),
      }]}>
      <Ionicons name="add" size={18} color="#fff" />
      <Text style={styles.addBtnText}>Add</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader
        title="Outlets"
        subtitle={branchLimit.limit > 0
          ? `${list.length} / ${branchLimit.limit} on ${branchLimit.planName}`
          : `${list.length} branches`}
        showBack
        right={addButton}
      />
      {list.length === 0 ? (
        <EmptyState icon="business-outline" title="No outlets" message="Tap Add to create your first branch." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: isWeb ? 100 : 100 }}
        >
          {list.map(b => {
            const isActive = b.id === restaurantId;
            return (
              <Pressable
                key={b.id}
                onPress={() => setEditing(b)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: isActive ? colors.accent : colors.card,
                    borderColor: isActive ? colors.primary : colors.border,
                    borderWidth: isActive ? 1.5 : 1,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.primary }]}>
                  <Ionicons name="storefront" size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.foreground }]}>{b.name}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {b.address ?? b.city ?? "No address"}{b.isMain ? " · Main" : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <OutletForm
        visible={creating}
        title="New outlet"
        submitLabel="Create outlet"
        submitting={createM.isPending}
        initial={null}
        onClose={() => setCreating(false)}
        onSubmit={(v) => createM.mutate(v)}
      />
      <OutletForm
        visible={!!editing}
        title="Edit outlet"
        submitLabel="Save changes"
        submitting={updateM.isPending || deleteM.isPending}
        initial={editing}
        onClose={() => setEditing(null)}
        onSubmit={(v) => editing && updateM.mutate({ id: editing.id, body: v })}
        onDelete={editing ? () => confirmDelete(editing) : undefined}
      />
    </View>
  );
}

function OutletForm({
  visible, title, submitLabel, submitting, initial, onClose, onSubmit, onDelete,
}: {
  visible: boolean;
  title: string;
  submitLabel: string;
  submitting: boolean;
  initial: Branch | null;
  onClose: () => void;
  onSubmit: (v: FormValues) => void;
  onDelete?: () => void;
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [isMain, setIsMain] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setAddress(initial?.address ?? "");
      setPhone(initial?.phone ?? "");
      setIsMain(!!initial?.isMain);
    }
  }, [visible, initial]);

  return (
    <EntityFormSheet
      visible={visible} onClose={onClose} title={title}
      submitting={submitting}
      canSubmit={name.trim().length > 0 && !submitting}
      onSubmit={() => onSubmit({
        name: name.trim(),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        isMain,
      })}
      submitLabel={submitLabel}
      onDelete={onDelete}
      deleteLabel="Delete outlet"
    >
      <FormField label="Outlet name">
        <TextInput value={name} onChangeText={setName} placeholder="e.g. Indiranagar branch"
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
      <FormField label="Address">
        <TextInput value={address} onChangeText={setAddress} placeholder="e.g. 12 MG Road, Bengaluru"
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
      <FormField label="Phone">
        <PhoneInput value={phone} onChange={setPhone} defaultCountry="IN" placeholder="9876543210" />
      </FormField>
      <View style={styles.switchRow}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>Main outlet</Text>
        <Switch value={isMain} onValueChange={setIsMain} />
      </View>
    </EntityFormSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  addBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, marginTop: 4 },
});
