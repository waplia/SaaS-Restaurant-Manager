import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Linking, Platform,
  TextInput, Alert, Modal, Share,
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

type FormValues = { name: string; email?: string; phone?: string; role: string; password?: string };

const EDITABLE_ROLES = ["manager", "waiter", "kitchen", "cashier", "delivery_executive", "hr_officer"];

// Generate a memorable-but-strong 10-char temp password. Mirrors the web
// /staff page algorithm: at least one upper, one lower, one digit, one
// special; ambiguous chars (I/l/0/O/1) excluded so it's easy to read
// aloud or copy from a screenshot.
function generateTempPassword(): string {
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$";
  const all = upper + lower + digits + special;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let pwd = pick(upper) + pick(lower) + pick(digits) + pick(special);
  for (let i = 4; i < 10; i++) pwd += pick(all);
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}

export default function StaffScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";
  const [editing, setEditing] = useState<Staff | null>(null);
  // `creating` carries the *flow* used to open the sheet so the success
  // handler knows whether to reveal the temp password (Add) or just show
  // a quiet "invitation sent" toast (Invite).
  //   - "add"    → generate password and surface CredentialsModal so the
  //                owner can hand it to the staff member directly.
  //   - "invite" → same API call, but skip the modal. The staff member
  //                receives the email invite and uses Forgot Password.
  const [creating, setCreating] = useState<null | "add" | "invite">(null);
  // After a successful invite we surface the generated password to the
  // inviter once. It is NEVER fetched again from the server — if they
  // dismiss this without copying it the new staff member must use the
  // Forgot Password flow.
  const [generatedCreds, setGeneratedCreds] = useState<
    { name: string; email: string; password: string } | null
  >(null);
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
    mutationFn: async ({ body, flow }: { body: FormValues; flow: "add" | "invite" }) => {
      // Generate the temp password on the client so we can show it to the
      // owner after success. The API hashes it server-side and returns
      // the created user — it never echoes the password back.
      const password = generateTempPassword();
      await customFetch(`/api/restaurants/${restaurantId}/staff`, {
        method: "POST", body: JSON.stringify({ ...body, password }),
      });
      return { ...body, password, flow };
    },
    onSuccess: (created) => {
      setCreating(null);
      invalidate();
      if (created.flow === "add") {
        setGeneratedCreds({
          name: created.name,
          email: created.email ?? "",
          password: created.password!,
        });
      } else {
        Alert.alert(
          "Invitation sent",
          `${created.name} will receive an email at ${created.email ?? "their address"} to set their password.`,
        );
      }
    },
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not add staff"),
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable onPress={() => router.push("/(owner)/attendance" as never)} hitSlop={10}>
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Attendance</Text>
            </Pressable>
            {/* Invite → emails the staff member; they set their own password.
                Add    → generates a password and shows it to the owner so
                         the staff member can sign in immediately. */}
            <Pressable
              onPress={() => staffLimit.reached
                ? Alert.alert("Plan limit reached", staffLimit.reason ?? "Upgrade your plan to invite more staff.")
                : setCreating("invite")}
              hitSlop={10}
              style={({ pressed }) => [styles.outlineBtn, {
                borderColor: colors.primary,
                opacity: staffLimit.reached ? 0.4 : (pressed ? 0.7 : 1),
              }]}>
              <Ionicons name="mail-outline" size={16} color={colors.primary} />
              <Text style={[styles.outlineBtnText, { color: colors.primary }]}>Invite</Text>
            </Pressable>
            <Pressable
              onPress={() => staffLimit.reached
                ? Alert.alert("Plan limit reached", staffLimit.reason ?? "Upgrade your plan to add more staff.")
                : setCreating("add")}
              hitSlop={10}
              style={({ pressed }) => [styles.addBtn, {
                backgroundColor: colors.primary,
                opacity: staffLimit.reached ? 0.4 : (pressed ? 0.85 : 1),
              }]}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          </View>
        }
      />
      {staff.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No staff yet"
          message="Tap Add to create an account with a password, or Invite to email them a sign-up link."
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
        visible={creating !== null}
        title={creating === "add" ? "Add staff member" : "Invite staff"}
        submitLabel={creating === "add" ? "Add & generate password" : "Send invite"}
        mode="create"
        submitting={createM.isPending}
        member={null}
        onClose={() => setCreating(null)}
        onSubmit={(v) => createM.mutate({ body: v, flow: creating ?? "add" })}
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

      {/* One-time credentials reveal after a successful invite.
          The password is held only in this component's state — closing this
          modal discards it forever. Mirrors the web /staff page behavior. */}
      <CredentialsModal
        creds={generatedCreds}
        onClose={() => setGeneratedCreds(null)}
      />
    </View>
  );
}

function CredentialsModal({
  creds, onClose,
}: {
  creds: { name: string; email: string; password: string } | null;
  onClose: () => void;
}) {
  const colors = useColors();
  if (!creds) return null;
  const shareText =
    `${creds.name}'s sign-in for the team app:\n\n` +
    `Email: ${creds.email}\nTemporary password: ${creds.password}\n\n` +
    `Please change this password on first login.`;
  // On web `navigator.clipboard.writeText` works directly; on native we
  // fall back to opening the share sheet (which lets the inviter paste
  // into WhatsApp/SMS/Email — the most common share targets anyway).
  // The password is also rendered as `selectable` Text so the user can
  // long-press → copy as a last resort.
  const copy = async () => {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(creds.password);
        Alert.alert("Copied", "Password copied to clipboard.");
        return;
      } catch { /* fall through */ }
    }
    try {
      await Share.share({ message: creds.password });
    } catch {
      Alert.alert("Long-press to copy", "Long-press the password to select and copy it.");
    }
  };
  const share = async () => {
    try { await Share.share({ message: shareText }); } catch { /* user-cancelled */ }
  };
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={credStyles.backdrop}>
        <View style={[credStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[credStyles.iconCircle, { backgroundColor: colors.primary + "22" }]}>
            <Ionicons name="checkmark-circle" size={32} color={colors.primary} />
          </View>
          <Text style={[credStyles.title, { color: colors.foreground }]}>Staff invited</Text>
          <Text style={[credStyles.subtitle, { color: colors.mutedForeground }]}>
            {creds.name} has been added. Share these credentials securely — they
            will not be shown again.
          </Text>

          <View style={[credStyles.credBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[credStyles.credLabel, { color: colors.mutedForeground }]}>Email</Text>
            <Text style={[credStyles.credValue, { color: colors.foreground }]} selectable>
              {creds.email || "—"}
            </Text>
            <View style={{ height: 10 }} />
            <Text style={[credStyles.credLabel, { color: colors.mutedForeground }]}>Temporary password</Text>
            <Text style={[credStyles.credPassword, { color: colors.foreground }]} selectable>
              {creds.password}
            </Text>
          </View>

          <Text style={[credStyles.hint, { color: "#b45309" }]}>
            Ask {creds.name.split(" ")[0] || "them"} to change this password after first sign-in.
          </Text>

          <View style={credStyles.btnRow}>
            <Pressable
              onPress={share}
              style={({ pressed }) => [credStyles.btn, credStyles.btnGhost, {
                borderColor: colors.border, opacity: pressed ? 0.85 : 1,
              }]}
            >
              <Ionicons name="share-outline" size={16} color={colors.foreground} />
              <Text style={[credStyles.btnText, { color: colors.foreground }]}>Share</Text>
            </Pressable>
            <Pressable
              onPress={copy}
              style={({ pressed }) => [credStyles.btn, {
                backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1,
              }]}
            >
              <Ionicons name="copy-outline" size={16} color="#fff" />
              <Text style={[credStyles.btnText, { color: "#fff" }]}>Copy password</Text>
            </Pressable>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={credStyles.closeRow}>
            <Text style={[credStyles.closeText, { color: colors.mutedForeground }]}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const credStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  card: { borderRadius: 18, borderWidth: 1, padding: 22, gap: 10, alignItems: "stretch" },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center", marginTop: 4 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  credBox: { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 8 },
  credLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  credValue: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 2 },
  credPassword: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: 1.5, marginTop: 4 },
  hint: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 2 },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10 },
  btnGhost: { borderWidth: 1, backgroundColor: "transparent" },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  closeRow: { alignItems: "center", paddingVertical: 8, marginTop: 2 },
  closeText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});

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
  outlineBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, backgroundColor: "transparent" },
  outlineBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
