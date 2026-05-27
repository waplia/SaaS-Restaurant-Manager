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
  dailyReset: boolean;
  prefixByType: boolean;
  paddingDigits: 3 | 4;
  includeTableNumberForDineIn: boolean;
  includeCounterCode: boolean;
  outletWiseSequence: boolean;
  prefixes: Prefixes;
};

const DEFAULT_CFG: Cfg = {
  dailyReset: true,
  prefixByType: true,
  paddingDigits: 3,
  includeTableNumberForDineIn: true,
  includeCounterCode: true,
  outletWiseSequence: true,
  prefixes: { dine_in: "DN", takeaway: "TK", delivery: "DL", qr: "QR", reservation: "RS", tiffin: "TF", catering: "CT" },
};

const TOGGLES: Array<{ key: keyof Omit<Cfg, "prefixes" | "paddingDigits">; title: string; description: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "dailyReset", title: "Reset counter daily", description: "Off = single ever-growing counter per outlet/type.", icon: "refresh-outline" },
  { key: "prefixByType", title: "Per-type prefix (DN / TK / DL)", description: "Off = single shared “ORD-” prefix.", icon: "pricetag-outline" },
  { key: "includeTableNumberForDineIn", title: "Include table no. for dine-in", description: "Shows “Table 5” alongside the ticket number.", icon: "grid-outline" },
  { key: "includeCounterCode", title: "Include counter code", description: "Adds the originating counter on the ticket.", icon: "business-outline" },
  { key: "outletWiseSequence", title: "Outlet-wise sequence", description: "Off = one shared counter across all branches.", icon: "git-branch-outline" },
];

const TYPE_LABELS: Array<[keyof Prefixes, string]> = [
  ["dine_in", "Dine-in"], ["takeaway", "Takeaway"], ["delivery", "Delivery"],
  ["qr", "QR"], ["reservation", "Reservation"], ["tiffin", "Tiffin"], ["catering", "Catering"],
];

function previewFor(cfg: Cfg, key: keyof Prefixes): string {
  const pad = cfg.paddingDigits === 4 ? 4 : 3;
  const prefix = cfg.prefixByType ? (cfg.prefixes[key] || "DN") : "ORD";
  return `${prefix}-${String(23).padStart(pad, "0")}`;
}

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
          const padding = data.paddingDigits === 4 ? 4 : 3;
          setCfg({ ...DEFAULT_CFG, ...data, paddingDigits: padding, prefixes: { ...DEFAULT_CFG.prefixes, ...(data.prefixes ?? {}) } });
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
                Short daily ticket numbers (e.g. <Text style={styles.bold}>{previewFor(cfg, "dine_in")}</Text>) for counter call-outs. A permanent internal id is used for payments and audit exports.
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

            <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
                <Ionicons name="ellipsis-horizontal-outline" size={20} color={colors.primary} />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>Sequence padding</Text>
                <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>
                  {cfg.paddingDigits === 4 ? "4 digits — DN-0023" : "3 digits — DN-023"}
                </Text>
              </View>
              <Pressable
                onPress={() => save({ ...cfg, paddingDigits: cfg.paddingDigits === 4 ? 3 : 4 })}
                disabled={saving}
                style={[styles.padToggle, { borderColor: colors.border, backgroundColor: colors.background }]}
              >
                <Text style={[styles.padToggleText, { color: colors.foreground }]}>{cfg.paddingDigits}</Text>
              </Pressable>
            </View>

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

            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Live preview</Text>
            <View style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {TYPE_LABELS.map(([key, label]) => (
                <View key={key} style={[styles.previewRow, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.previewLabel, { color: colors.mutedForeground }]}>{label}</Text>
                  <Text style={[styles.previewValue, { color: colors.foreground }]}>{previewFor(cfg, key)}</Text>
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
  padToggle: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  padToggleText: { fontSize: 16, fontWeight: "700" },
  prefixCard: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  prefixRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  prefixLabel: { fontSize: 14 },
  prefixInput: { minWidth: 80, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, textAlign: "center", fontWeight: "600", letterSpacing: 1 },
  previewCard: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  previewRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  previewLabel: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  previewValue: { fontSize: 15, fontWeight: "700", fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) },
});
