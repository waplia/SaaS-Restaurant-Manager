import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Linking, Platform,
  TextInput, Alert,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { ROLE_LABEL } from "@/lib/roles";
import { router } from "expo-router";
import { EntityFormSheet, FormField, formInputStyle } from "@/components/EntityFormSheet";
import { PhoneInput } from "@/components/PhoneInput";
import { usePlanLimits } from "@/hooks/usePlanLimits";

// The staff list API (`flattenStaffRow`) returns `id` set to the *user* id
// and `staffId` set to the row id in the `staff` table. All PATCH/DELETE
// routes are keyed on the user id, so we use `s.id` everywhere.
type Staff = {
  id: number; staffId?: number; name: string; email?: string; phone?: string;
  role: string; isActive?: boolean;
};

type FormValues = { name: string; email?: string; phone?: string; role: string };

const EDITABLE_ROLES = ["manager", "waiter", "kitchen", "cashier", "delivery_executive", "hr_officer"];

export default function StaffScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";
  const [editing, setEditing] = useState<Staff | null>(null);
  const [creating, setCreating] = useState(false);
  const limits = usePlanLimits();

  const q = useQuery({
    queryKey: ["staff-list", restaurantId],
    queryFn: () => customFetch<Staff[] | { staff?: Staff[] }>(`/api/restaurants/${restaurantId}/staff`).catch(() => []),
  });
  const staff: Staff[] = Array.isArray(q.data) ? q.data : (q.data?.staff ?? []);
  const activeStaffCount = staff.filter(s => s.isActive !== false).length;
  const staffLimit = limits.staff(activeStaffCount);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["staff-list", restaurantId] });

  const createM = useMutation({
    mutationFn: (body: FormValues) =>
      customFetch(`/api/restaurants/${restaurantId}/staff`, {
        method: "POST", body: JSON.stringify(body),
      }),
    onSuccess: () => { setCreating(false); invalidate(); },
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not invite staff"),
  });

  const updateM = useMutation({
    mutationFn: ({ userId, body }: { userId: number; body: Partial<FormValues> }) =>
      customFetch(`/api/restaurants/${restaurantId}/staff/${userId}`, {
        method: "PATCH", body: JSON.stringify(body),
      }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not update staff"),
  });

  const deleteM = useMutation({
    mutationFn: (userId: number) =>
      customFetch(`/api/restaurants/${restaurantId}/staff/${userId}`, { method: "DELETE" }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not remove staff"),
  });

  const confirmDelete = (m: Staff) => {
    Alert.alert("Deactivate staff?", `Remove “${m.name}” from your team? They will lose access immediately.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Deactivate", style: "destructive", onPress: () => deleteM.mutate(m.id) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader
        title="Staff"
        subtitle={staffLimit.limit > 0
          ? `${activeStaffCount} / ${staffLimit.limit} on ${staffLimit.planName}`
          : `${staff.length} members`}
        showBack
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable onPress={() => router.push("/(owner)/attendance" as never)} hitSlop={10}>
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Attendance</Text>
            </Pressable>
            <Pressable
              onPress={() => staffLimit.reached
                ? Alert.alert("Plan limit reached", staffLimit.reason ?? "Upgrade your plan to invite more staff.")
                : setCreating(true)}
              hitSlop={10}
              style={({ pressed }) => [styles.addBtn, {
                backgroundColor: colors.primary,
                opacity: staffLimit.reached ? 0.4 : (pressed ? 0.85 : 1),
              }]}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>Invite</Text>
            </Pressable>
          </View>
        }
      />
      {staff.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No staff yet"
          message="Tap Invite to add your first team member."
        />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: isWeb ? 100 : 100 }}
        >
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Tap a member to edit name, phone, or role. Invited staff sign in with the standard “Forgot password” flow.
          </Text>
          {staff.map(s => (
            <Pressable
              key={s.id}
              onPress={() => setEditing(s)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                <Text style={styles.avatarText}>{s.name?.[0]?.toUpperCase() ?? "?"}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{s.name}</Text>
                <Text style={[styles.role, { color: colors.mutedForeground }]}>
                  {ROLE_LABEL[s.role] ?? s.role}
                  {s.isActive === false ? " · Inactive" : ""}
                </Text>
              </View>
              {s.phone ? (
                <Pressable hitSlop={10} onPress={() => Linking.openURL(`tel:${s.phone}`)}>
                  <Ionicons name="call-outline" size={20} color={colors.primary} />
                </Pressable>
              ) : null}
              <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <StaffForm
        visible={creating}
        title="Invite staff"
        submitLabel="Send invite"
        mode="create"
        submitting={createM.isPending}
        member={null}
        onClose={() => setCreating(false)}
        onSubmit={(v) => createM.mutate(v)}
      />
      <StaffForm
        visible={!!editing}
        title="Edit staff member"
        submitLabel="Save changes"
        mode="edit"
        submitting={updateM.isPending || deleteM.isPending}
        member={editing}
        onClose={() => setEditing(null)}
        onSubmit={(v) => editing && updateM.mutate({ userId: editing.id, body: v })}
        onDelete={editing ? () => confirmDelete(editing) : undefined}
      />
    </View>
  );
}

function StaffForm({
  visible, title, submitLabel, mode, member, submitting, onClose, onSubmit, onDelete,
}: {
  visible: boolean;
  title: string;
  submitLabel: string;
  mode: "create" | "edit";
  member: Staff | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (v: FormValues) => void;
  onDelete?: () => void;
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<string>("waiter");

  React.useEffect(() => {
    if (visible) {
      setName(member?.name ?? "");
      setEmail(member?.email ?? "");
      setPhone(member?.phone ?? "");
      setRole(member?.role ?? "waiter");
    }
  }, [visible, member]);

  const canSubmit = name.trim().length > 0 && (mode === "edit" || /.+@.+\..+/.test(email)) && !submitting;

  return (
    <EntityFormSheet
      visible={visible} onClose={onClose}
      title={title}
      submitting={submitting}
      canSubmit={canSubmit}
      onSubmit={() => {
        const body: FormValues = { name: name.trim(), phone: phone.trim() || undefined, role };
        if (mode === "create") body.email = email.trim();
        onSubmit(body);
      }}
      submitLabel={submitLabel}
      onDelete={onDelete}
      deleteLabel="Deactivate staff"
      deleteConfirmMessage="The user will lose access immediately and all active sessions will end."
    >
      <FormField label="Name">
        <TextInput value={name} onChangeText={setName} placeholder="Full name"
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
      {mode === "create" ? (
        <FormField label="Email (used for sign-in)">
          <TextInput value={email} onChangeText={setEmail} placeholder="name@example.com"
            autoCapitalize="none" keyboardType="email-address"
            placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
        </FormField>
      ) : null}
      <FormField label="Phone">
        <PhoneInput value={phone} onChange={setPhone} />
      </FormField>
      <FormField label="Role">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
          {EDITABLE_ROLES.map(r => (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              style={[
                styles.chip,
                { borderColor: colors.border, backgroundColor: role === r ? colors.primary : colors.background },
              ]}
            >
              <Text style={{
                color: role === r ? "#fff" : colors.foreground,
                fontSize: 12, fontFamily: "Inter_500Medium",
              }}>
                {ROLE_LABEL[r] ?? r}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </FormField>
      {mode === "create" ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 12 }}>
          A temporary password is generated. Ask the new member to use “Forgot password” on the login screen to set their own.
        </Text>
      ) : null}
    </EntityFormSheet>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  role: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  note: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, paddingHorizontal: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },
  addBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
