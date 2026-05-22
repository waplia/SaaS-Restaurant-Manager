import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Alert, ScrollView, Platform,
  TextInput, ActivityIndicator, Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

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
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <EditRow colors={colors} label="Name" value={draft.name ?? ""} onChange={v => setField("name", v)} editable={canEdit} />
            <EditRow colors={colors} label="Phone" value={draft.phone ?? ""} onChange={v => setField("phone", v)} editable={canEdit} keyboardType="phone-pad" />
            <EditRow colors={colors} label="Email" value={draft.email ?? ""} onChange={v => setField("email", v)} editable={canEdit} keyboardType="email-address" />
            <EditRow colors={colors} label="Address" value={draft.address ?? ""} onChange={v => setField("address", v)} editable={canEdit} multiline />
            <EditRow colors={colors} label="City" value={draft.city ?? ""} onChange={v => setField("city", v)} editable={canEdit} />
            <EditRow colors={colors} label="Website" value={draft.website ?? ""} onChange={v => setField("website", v)} editable={canEdit} keyboardType="url" />
            <EditRow colors={colors} label="GSTIN" value={draft.gstin ?? ""} onChange={v => setField("gstin", v)} editable={canEdit} />
            <EditRow colors={colors} label="FSSAI Lic" value={draft.fssaiLicense ?? ""} onChange={v => setField("fssaiLicense", v)} editable={canEdit} isLast />
          </View>

          <SectionHeader colors={colors} title="UPI QR on bills" subtitle="Show a Scan-to-Pay QR on printed customer bills. Never printed on KOTs." />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
            <View style={[styles.menuItem, { borderBottomWidth: 0 }]}>
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>When to print</Text>
              <Text style={[styles.menuValue, { color: colors.mutedForeground, textAlign: "right", flex: 1 }]} numberOfLines={2}>
                {QR_MODE_LABEL[String(draft.upiPrintQrMode ?? "all")] ?? "Always print"}
              </Text>
            </View>
            {canEdit && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 12, paddingTop: 0 }}>
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
  colors, label, value, onChange, editable, keyboardType, placeholder, multiline, isLast,
}: {
  colors: Colors; label: string; value: string; onChange: (v: string) => void;
  editable?: boolean; keyboardType?: "default" | "email-address" | "phone-pad" | "url";
  placeholder?: string; multiline?: boolean; isLast?: boolean;
}) {
  return (
    <View style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth, flexDirection: "column", alignItems: "stretch", gap: 4 }]}>
      <Text style={[styles.menuLabel, { color: colors.mutedForeground, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }]}>{label}</Text>
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
          paddingVertical: 4,
          minHeight: multiline ? 44 : undefined,
        }}
      />
    </View>
  );
}

function ToggleRow({ colors, label, value, onChange, disabled }: { colors: Colors; label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={[styles.menuItem, { borderBottomColor: colors.border }]}>
      <Text style={[styles.menuLabel, { color: colors.foreground }]}>{label}</Text>
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
