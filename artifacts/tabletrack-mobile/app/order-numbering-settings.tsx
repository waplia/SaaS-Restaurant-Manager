import React, { useEffect, useState } from "react";
import { Alert } from "@/components/ui/AppAlert";
import { View, Text, StyleSheet, Switch, ActivityIndicator, Pressable, Platform, TextInput, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

type Prefixes = { dine_in: string; takeaway: string; delivery: string; qr: string; reservation: string; tiffin: string; catering: string };
type Cfg = {
  enabled: boolean;
  showDisplayNumberToGuests: boolean;
  showInternalNumberInAudit: boolean;
  resetDaily: boolean;
  zeroPadDisplay: boolean;
  prefixes: Prefixes;
};

const DEFAULT_CFG: Cfg = {
  enabled: true,
  showDisplayNumberToGuests: true,
  showInternalNumberInAudit: true,
  resetDaily: true,
  zeroPadDisplay: true,
  prefixes: { dine_in: "DN", takeaway: "TK", delivery: "DL", qr: "QR", reservation: "RS", tiffin: "TF", catering: "CT" },
};

const TOGGLES: Array<{ key: keyof Omit<Cfg, "prefixes">; title: string; description: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "enabled", title: "Dual order numbering", description: "Off = single legacy id only.", icon: "swap-horizontal-outline" },
  { key: "showDisplayNumberToGuests", title: "Show display number to guests", description: "On QR menu, receipts and SMS.", icon: "eye-outline" },
  { key: "showInternalNumberInAudit", title: "Show internal id in audit", description: "Includes payment exports.", icon: "document-text-outline" },
  { key: "resetDaily", title: "Reset counter daily", description: "At business-day rollover.", icon: "refresh-outline" },
  { key: "zeroPadDisplay", title: "Zero-pad display (DN-023)", description: "Off = DN-23 (no leading zeros).", icon: "ellipsis-horizontal-outline" },
];

const TYPE_LABELS: Array<[keyof Prefixes, string]> = [
  ["dine_in", "Dine-in"], ["takeaway", "Takeaway"], ["delivery", "Delivery"],
  ["qr", "QR"], ["reservation", "Reservation"], ["tiffin", "Tiffin"], ["catering", "Catering"],
];

export default function OrderNumberingSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { restaurantId, accessToken } = useAuth();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const baseUrl = getApiBaseUrl();

  useEffect(() => {
    if (!restaurantId || !accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${baseUrl}/api/restaurants/${restaurantId}/settings/order-numbering`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error("load");
        const json = (await res.json()) as { data?: Partial<Cfg> };
        if (!cancelled) {
          const data = json.data ?? {};
          setCfg({ ...DEFAULT_CFG, ...data, prefixes: { ...DEFAULT_CFG.prefixes, ...(data.prefixes ?? {}) } });
        }
      } catch {
        if (!cancelled) setCfg(DEFAULT_CFG);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [restaurantId, accessToken, baseUrl]);

  async function save(next: Cfg) {
    if (!restaurantId || !accessToken) return;
    setSaving(true);
    const prev = cfg;
    setCfg(next);
    try {
      const res = await fetch(`${baseUrl}/api/restaurants/${restaurantId}/settings/order-numbering`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ data: next }),
      });
      if (!res.ok) throw new Error("save");
    } catch {
      setCfg(prev);
      Alert.alert("Could not save", "Your change was not saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 24 : insets.top + 8, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>Order numbering</Text>
          <View style={{ width: 24 }} />
        </View>

        {loading || !cfg ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }}>
            <View style={[styles.hint, { backgroundColor: colors.accent }]}>
              <Text style={[styles.hintText, { color: colors.foreground }]}>
                Short daily ticket numbers (e.g. <Text style={styles.bold}>DN-023</Text>) for counter call-outs. A permanent internal id (e.g. <Text style={styles.bold}>KL-MAIN-…-000123</Text>) is used for payments and audit exports.
              </Text>
            </View>

            {TOGGLES.map(meta => (
              <View key={meta.key} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
                  <Ionicons name={meta.icon} size={20} color={colors.primary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>{meta.title}</Text>
                  <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>{meta.description}</Text>
                </View>
                <Switch
                  value={cfg[meta.key]}
                  onValueChange={v => save({ ...cfg, [meta.key]: v })}
                  disabled={saving}
                  trackColor={{ true: colors.primary, false: colors.border }}
                />
              </View>
            ))}

            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Prefixes per order type</Text>
            <View style={[styles.prefixCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {TYPE_LABELS.map(([key, label]) => (
                <View key={key} style={[styles.prefixRow, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.prefixLabel, { color: colors.foreground }]}>{label}</Text>
                  <TextInput
                    value={cfg.prefixes[key]}
                    onChangeText={t => setCfg({ ...cfg, prefixes: { ...cfg.prefixes, [key]: t.toUpperCase().slice(0, 4) } })}
                    onBlur={() => save(cfg)}
                    maxLength={4}
                    autoCapitalize="characters"
                    style={[styles.prefixInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  />
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "600" },
  hint: { borderRadius: 10, padding: 12 },
  hintText: { fontSize: 13, lineHeight: 18 },
  bold: { fontWeight: "700" },
  sectionLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 4, paddingHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  iconWrap: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  rowDesc: { fontSize: 12, marginTop: 2 },
  prefixCard: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  prefixRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  prefixLabel: { fontSize: 14 },
  prefixInput: { minWidth: 80, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, textAlign: "center", fontWeight: "600", letterSpacing: 1 },
});
