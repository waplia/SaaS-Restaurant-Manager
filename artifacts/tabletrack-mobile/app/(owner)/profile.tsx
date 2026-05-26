import React, { useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui/AppAlert";
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, TextInput, ActivityIndicator, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { PhoneInput } from "@/components/PhoneInput";

/**
 * Owner profile screen — mobile parity with the web Settings → General +
 * UPI QR sections (Task #600). Lets owners edit the restaurant's customer-
 * facing details (name, address, phone, GSTIN, FSSAI, website) and the
 * UPI QR-on-bill configuration directly from the phone, then PATCHes the
 * restaurant endpoint. Manager/staff see read-only fields.
 */

type RestaurantRecord = {
  id: number;
  name: string;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  country?: string | null;
  gstin?: string | null;
  fssaiLicense?: string | null;
  website?: string | null;
  upiQrEnabled?: boolean | null;
  upiId?: string | null;
  upiMerchantName?: string | null;
  upiQrLabel?: string | null;
  showUpiQrOnBill?: boolean | null;
  showUpiIdOnBill?: boolean | null;
  upiPaymentNoteFormat?: string | null;
  upiPrintQrMode?: string | null;
};

type DraftFields = Partial<RestaurantRecord>;

export default function OwnerProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, restaurantId } = useAuth();
  const isWeb = Platform.OS === "web";
  const qc = useQueryClient();
  const canEdit = user?.role === "owner" || user?.role === "super_admin";

  const restaurantQ = useQuery({
    queryKey: ["restaurant-info", restaurantId],
    queryFn: () => customFetch<RestaurantRecord>(`/api/restaurants/${restaurantId}`),
    enabled: restaurantId != null,
  });

  // Payment-config drives whether the QR-menu Pay Online flow surfaces
  // "UPI (Restaurant's own)" using the VPA above. Mirrors the web
  // Settings → Payments → Manual UPI toggle so owners can flip it from
  // the same screen where they enter the UPI ID.
  const paymentCfgQ = useQuery<{
    settings: { onlineEnabled: boolean; onlinePaymentSource: string };
    onlineMethods: Array<{ id: number; type: string; gatewayCode: string | null; isEnabled: boolean }>;
    manualUpi: null | { upiId: string | null; merchantName: string | null };
  }>({
    queryKey: ["payment-config", restaurantId],
    queryFn: () => customFetch(`/api/restaurants/${restaurantId}/payment-config`),
    enabled: restaurantId != null,
  });
  const manualUpiEnabled = !!paymentCfgQ.data?.onlineMethods.find(
    m => m.type === "manual_upi" && m.gatewayCode == null,
  )?.isEnabled;

  const toggleQrMenuUpiMut = useMutation({
    mutationFn: async (enable: boolean) => {
      // Use the SAVED restaurant values (not the unsaved `draft`) so this
      // toggle can never publish a UPI ID the owner only typed but didn't
      // commit via "Save changes". The UI separately refuses the toggle
      // when there are unsaved UPI edits in the form.
      const saved = restaurantQ.data;
      const cfg = paymentCfgQ.data;
      if (enable) {
        // 1. Ensure the master "Accept online payments" setting is true —
        //    flipping Manual UPI is a no-op for customers otherwise.
        if (cfg?.settings.onlineEnabled === false) {
          await customFetch(`/api/restaurants/${restaurantId}/payment-config/settings`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ onlineEnabled: true }),
          });
        }
        // 2. Sync the persisted VPA / merchant name into payment-config so
        //    both surfaces (printed-bill QR and QR-menu checkout) read the
        //    same identity. Skip if it already matches to avoid a needless
        //    write.
        const desiredVpa = (saved?.upiId ?? "").trim() || null;
        const desiredMerch = (saved?.upiMerchantName ?? saved?.name ?? "").trim() || null;
        const cur = cfg?.manualUpi;
        if (desiredVpa && (cur?.upiId !== desiredVpa || cur?.merchantName !== desiredMerch)) {
          await customFetch(`/api/restaurants/${restaurantId}/payment-config/manual-upi`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ upiId: desiredVpa, merchantName: desiredMerch }),
          });
        }
      }
      // 3. Flip the method row last so a failure in steps 1/2 doesn't leave
      //    the customer-visible toggle on without a backing identity.
      await customFetch(`/api/restaurants/${restaurantId}/payment-config/methods`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "online",
          type: "manual_upi",
          isEnabled: enable,
          label: "UPI (Restaurant's own)",
        }),
      });
    },
    // Always refetch after the sequence (success OR failure) so the toggle
    // reflects the actual server state, not the optimistic intent — this
    // covers the partial-failure case where step 1/2 succeeded but step 3
    // didn't.
    onSettled: () => qc.invalidateQueries({ queryKey: ["payment-config", restaurantId] }),
    onError: (err: unknown) => {
      Alert.alert("Could not update", err instanceof Error ? err.message : "Try again.");
    },
  });

  const [draft, setDraft] = useState<DraftFields>({});
  useEffect(() => {
    if (restaurantQ.data) {
      const r = restaurantQ.data;
      setDraft({
        name: r.name ?? "",
        address: r.address ?? "",
        phone: r.phone ?? "",
        email: r.email ?? "",
        city: r.city ?? "",
        gstin: r.gstin ?? "",
        fssaiLicense: r.fssaiLicense ?? "",
        website: r.website ?? "",
        upiQrEnabled: !!r.upiQrEnabled,
        upiId: r.upiId ?? "",
        upiMerchantName: r.upiMerchantName ?? r.name ?? "",
        upiQrLabel: r.upiQrLabel ?? "Scan to Pay",
        showUpiQrOnBill: r.showUpiQrOnBill !== false,
        showUpiIdOnBill: !!r.showUpiIdOnBill,
        upiPaymentNoteFormat: r.upiPaymentNoteFormat ?? "Bill {orderNumber}",
        upiPrintQrMode: r.upiPrintQrMode ?? "all",
      });
    }
  }, [restaurantQ.data]);

  const saveMut = useMutation({
    mutationFn: async (patch: DraftFields) => {
      return customFetch<RestaurantRecord>(`/api/restaurants/${restaurantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["restaurant-info", restaurantId] });
      Alert.alert("Saved", "Restaurant profile updated.");
    },
    onError: (err: unknown) => {
      Alert.alert("Save failed", err instanceof Error ? err.message : "Try again.");
    },
  });

  const handleLogout = () =>
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: async () => { await logout(); router.replace("/login"); } },
    ]);

  const QR_MODE_LABEL: Record<string, string> = useMemo(() => ({
    all: "Always print on every bill",
    unpaid: "Only on unpaid bills",
    upi_online_only: "Only when paid via UPI online",
    hide_after_paid: "Hide once the bill is fully paid",
  }), []);

  const setField = <K extends keyof DraftFields>(k: K, v: DraftFields[K]) =>
    setDraft(d => ({ ...d, [k]: v }));

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: isWeb ? 67 + 16 : insets.top + 16, paddingBottom: isWeb ? 34 + 90 : insets.bottom + (Platform.OS === "android" ? 140 : 110) },
      ]}
    >
      <View style={styles.avatarSection}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>{(user?.name ?? "U")[0].toUpperCase()}</Text>
        </View>
        <Text style={[styles.name, { color: colors.foreground }]}>{user?.name}</Text>
        <Text style={[styles.email, { color: colors.mutedForeground }]}>{user?.email}</Text>
        <View style={[styles.roleBadge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.roleText, { color: colors.primary }]}>{user?.role ?? "owner"}</Text>
        </View>
      </View>

      {restaurantQ.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <>
          <SectionHeader colors={colors} title="Restaurant profile" subtitle="Shown on bills, customer site & receipts." />
          <View style={{ gap: 10 }}>
            <EditRow colors={colors} label="Name" value={draft.name ?? ""} onChange={v => setField("name", v)} editable={canEdit} />
            <PhoneField colors={colors} label="Phone" value={draft.phone ?? ""} onChange={v => setField("phone", v)} editable={canEdit} />
            <EditRow colors={colors} label="Email" value={draft.email ?? ""} onChange={v => setField("email", v)} editable={canEdit} keyboardType="email-address" />
            <EditRow colors={colors} label="Address" value={draft.address ?? ""} onChange={v => setField("address", v)} editable={canEdit} multiline />
            <EditRow colors={colors} label="City" value={draft.city ?? ""} onChange={v => setField("city", v)} editable={canEdit} />
            <EditRow colors={colors} label="Website" value={draft.website ?? ""} onChange={v => setField("website", v)} editable={canEdit} keyboardType="url" />
            <EditRow colors={colors} label="GSTIN" value={draft.gstin ?? ""} onChange={v => setField("gstin", v)} editable={canEdit} />
            <EditRow colors={colors} label="FSSAI Lic" value={draft.fssaiLicense ?? ""} onChange={v => setField("fssaiLicense", v)} editable={canEdit} />
          </View>

          <SectionHeader colors={colors} title="UPI QR on bills" subtitle="Show a Scan-to-Pay QR on printed customer bills. Never printed on KOTs." />
          <View style={{ gap: 10 }}>
            <ToggleRow
              colors={colors}
              label="Enable UPI QR on bills"
              value={!!draft.upiQrEnabled}
              onChange={v => setField("upiQrEnabled", v)}
              disabled={!canEdit}
            />
            <EditRow colors={colors} label="UPI ID (VPA)" value={draft.upiId ?? ""} onChange={v => setField("upiId", v.trim())} editable={canEdit} placeholder="restaurant@oksbi" />
            <EditRow colors={colors} label="Merchant name" value={draft.upiMerchantName ?? ""} onChange={v => setField("upiMerchantName", v)} editable={canEdit} />
            <EditRow colors={colors} label="Label above QR" value={draft.upiQrLabel ?? ""} onChange={v => setField("upiQrLabel", v)} editable={canEdit} />
            <EditRow colors={colors} label="Note format" value={draft.upiPaymentNoteFormat ?? ""} onChange={v => setField("upiPaymentNoteFormat", v)} editable={canEdit} placeholder="Bill {orderNumber}" />
            <ToggleRow
              colors={colors}
              label="Print UPI ID below QR"
              value={!!draft.showUpiIdOnBill}
              onChange={v => setField("showUpiIdOnBill", v)}
              disabled={!canEdit}
            />
            <ToggleRow
              colors={colors}
              label="Accept UPI on customer QR menu"
              value={manualUpiEnabled}
              onChange={v => {
                if (v) {
                  const savedVpa = (restaurantQ.data?.upiId ?? "").trim();
                  if (!savedVpa) {
                    Alert.alert("UPI ID required", "Enter your UPI ID above and tap Save changes first, then enable this.");
                    return;
                  }
                  // Block the toggle when the form has unsaved UPI edits — the
                  // toggle syncs identity from the saved record, so flipping it
                  // now would publish stale values to the QR-menu checkout.
                  const dirty =
                    (draft.upiId ?? "").trim() !== savedVpa ||
                    (draft.upiMerchantName ?? "").trim() !== (restaurantQ.data?.upiMerchantName ?? "").trim();
                  if (dirty) {
                    Alert.alert("Save first", "You have unsaved UPI changes. Tap Save changes, then enable this.");
                    return;
                  }
                }
                toggleQrMenuUpiMut.mutate(v);
              }}
              disabled={!canEdit || toggleQrMenuUpiMut.isPending || paymentCfgQ.isLoading}
            />
            <View style={[styles.fieldBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>When to print</Text>
              <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: colors.foreground, marginTop: 2 }}>
                {QR_MODE_LABEL[String(draft.upiPrintQrMode ?? "all")] ?? "Always print"}
              </Text>
              {canEdit && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {Object.entries(QR_MODE_LABEL).map(([k, label]) => {
                    const active = (draft.upiPrintQrMode ?? "all") === k;
                    return (
                      <Pressable
                        key={k}
                        onPress={() => setField("upiPrintQrMode", k)}
                        style={{
                          paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                          borderWidth: 1,
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? colors.primary + "1A" : "transparent",
                        }}
                      >
                        <Text style={{ fontSize: 12, color: active ? colors.primary : colors.mutedForeground, fontFamily: "Inter_500Medium" }}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </View>

          {canEdit && (
            <Pressable
              onPress={() => saveMut.mutate(draft)}
              disabled={saveMut.isPending}
              style={({ pressed }) => [
                { backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 12, alignItems: "center", opacity: pressed || saveMut.isPending ? 0.7 : 1 },
              ]}
            >
              <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                {saveMut.isPending ? "Saving…" : "Save changes"}
              </Text>
            </Pressable>
          )}
        </>
      )}

      <Pressable
        style={({ pressed }) => [
          { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 12, borderWidth: 1, backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={() => router.push("/change-password" as never)}
      >
        <Ionicons name="lock-closed-outline" size={20} color={colors.primary} />
        <Text style={{ flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: colors.foreground }}>Change password</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.logoutBtn, { borderColor: colors.destructive, opacity: pressed ? 0.7 : 1 }]}
        onPress={handleLogout}
      >
        <Ionicons name="log-out-outline" size={18} color={colors.destructive} />
        <Text style={[styles.logoutText, { color: colors.destructive }]}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

type Colors = ReturnType<typeof import("@/hooks/useColors").useColors>;

function SectionHeader({ colors, title, subtitle }: { colors: Colors; title: string; subtitle?: string }) {
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: colors.foreground, textTransform: "uppercase", letterSpacing: 0.6 }}>{title}</Text>
      {subtitle ? (
        <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

function EditRow({
  colors, label, value, onChange, editable, keyboardType, placeholder, multiline,
}: {
  colors: Colors; label: string; value: string; onChange: (v: string) => void;
  editable?: boolean; keyboardType?: "default" | "email-address" | "phone-pad" | "url";
  placeholder?: string; multiline?: boolean;
}) {
  return (
    <View style={[styles.fieldBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        editable={editable}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        multiline={multiline}
        style={{
          color: colors.foreground,
          fontSize: 15,
          fontFamily: "Inter_500Medium",
          paddingVertical: 2,
          marginTop: 2,
          minHeight: multiline ? 44 : undefined,
        }}
      />
    </View>
  );
}

function PhoneField({
  colors, label, value, onChange, editable,
}: {
  colors: Colors; label: string; value: string; onChange: (v: string) => void; editable?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground, paddingHorizontal: 2 }]}>{label}</Text>
      <PhoneInput value={value} onChange={onChange} editable={editable} defaultCountry="IN" />
    </View>
  );
}

function ToggleRow({ colors, label, value, onChange, disabled }: { colors: Colors; label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={[styles.fieldBox, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 12 }]}>
      <Text style={{ flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: colors.foreground }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },
  avatarSection: { alignItems: "center", gap: 8, paddingTop: 8 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 28, fontFamily: "Inter_700Bold" },
  name: { fontSize: 20, fontFamily: "Inter_700Bold" },
  email: { fontSize: 13, fontFamily: "Inter_400Regular" },
  roleBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  roleText: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: 1 },
  menuLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  menuValue: { fontSize: 14, fontFamily: "Inter_400Regular" },
  fieldBox: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 14,
  },
  logoutText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
