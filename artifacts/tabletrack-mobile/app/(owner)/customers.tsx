import React, { useState } from "react";
import { Alert } from "@/components/ui/AppAlert";
import { View, Text, ScrollView, StyleSheet, RefreshControl, TextInput, Pressable, Linking, Platform } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { EntityFormSheet, FormField, formInputStyle } from "@/components/EntityFormSheet";
import { PhoneInput } from "@/components/PhoneInput";

type Customer = {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  totalSpent?: string | number;
  loyaltyPoints?: number;
  visitCount?: number;
  lastVisitAt?: string;
  segment?: "new" | "regular" | "vip" | "at_risk" | string;
};

const SEGMENT_COLOR: Record<string, string> = {
  vip: "#7c3aed", regular: "#2563eb", new: "#16a34a", at_risk: "#dc2626",
};

export default function CustomersScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);

  const q = useQuery({
    queryKey: ["customers", restaurantId],
    queryFn: () => customFetch<{ customers?: Customer[]; data?: Customer[] } | Customer[]>(`/api/restaurants/${restaurantId}/customers?limit=200`).catch(() => []),
  });
  const list: Customer[] = Array.isArray(q.data) ? q.data : (q.data?.customers ?? q.data?.data ?? []);
  const filtered = list.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search)
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["customers", restaurantId] });
  const errToast = (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not save");

  const createM = useMutation({
    mutationFn: (body: Partial<Customer>) =>
      customFetch(`/api/restaurants/${restaurantId}/customers`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setCreating(false); invalidate(); },
    onError: errToast,
  });
  const updateM = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<Customer> }) =>
      customFetch(`/api/restaurants/${restaurantId}/customers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: errToast,
  });
  const deleteM = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: errToast,
  });

  const addButton = (
    <Pressable onPress={() => setCreating(true)} hitSlop={10}
      style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}>
      <Ionicons name="add" size={18} color="#fff" />
      <Text style={styles.addBtnText}>Add</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Customers" subtitle={`${list.length} total`} showBack right={addButton} />
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View style={[styles.search, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={16} color={colors.mutedForeground} />
          <TextInput
            placeholder="Search by name or phone"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            style={{ flex: 1, color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}
          />
        </View>
      </View>
      {filtered.length === 0 ? (
        <EmptyState icon="person-circle-outline" title="No customers" message="Tap Add to create your first customer." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: isWeb ? 100 : 100 }}
        >
          {filtered.map(c => (
            <Pressable
              key={c.id}
              onPress={() => setEditing(c)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={[styles.avatar, { backgroundColor: SEGMENT_COLOR[c.segment ?? "regular"] ?? colors.primary }]}>
                <Text style={styles.avatarText}>{c.name?.[0]?.toUpperCase() ?? "?"}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{c.name}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {c.visitCount ? `${c.visitCount} visits · ` : ""}
                  ₹{Number(c.totalSpent ?? 0).toFixed(0)}
                  {c.loyaltyPoints ? ` · ${c.loyaltyPoints} pts` : ""}
                </Text>
              </View>
              {c.phone ? (
                <Pressable hitSlop={10} onPress={() => Linking.openURL(`tel:${c.phone}`)}>
                  <Ionicons name="call-outline" size={20} color={colors.primary} />
                </Pressable>
              ) : null}
              <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <CustomerForm
        visible={creating}
        onClose={() => setCreating(false)}
        title="New customer"
        submitLabel="Create"
        submitting={createM.isPending}
        onSubmit={(v) => createM.mutate(v)}
      />
      <CustomerForm
        visible={!!editing}
        onClose={() => setEditing(null)}
        title="Edit customer"
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

function CustomerForm({
  visible, onClose, title, submitLabel, submitting, initial, onSubmit, onDelete, deleting,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  submitting: boolean;
  initial?: Partial<Customer>;
  onSubmit: (v: Partial<Customer>) => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  React.useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setPhone(initial?.phone ?? "");
      setEmail(initial?.email ?? "");
      setAddress(initial?.address ?? "");
    }
  }, [visible, initial]);

  const canSubmit = name.trim().length > 0 && !submitting;

  return (
    <EntityFormSheet
      visible={visible} onClose={onClose} title={title}
      submitting={submitting} canSubmit={canSubmit}
      onSubmit={() => onSubmit({
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
      })}
      submitLabel={submitLabel}
      onDelete={onDelete} deleting={deleting}
      deleteConfirmMessage="Delete this customer and all their notes/tags?"
    >
      <FormField label="Name">
        <TextInput value={name} onChangeText={setName} placeholder="Full name"
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
      <FormField label="Phone">
        <PhoneInput value={phone} onChange={setPhone} />
      </FormField>
      <FormField label="Email (optional)">
        <TextInput value={email} onChangeText={setEmail} placeholder="name@example.com"
          autoCapitalize="none" keyboardType="email-address"
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
      <FormField label="Address (optional)">
        <TextInput value={address} onChangeText={setAddress} placeholder="Street, city"
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
    </EntityFormSheet>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  addBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
