import React, { useEffect, useState } from "react";
import { Alert } from "@/components/ui/AppAlert";
import { View, Text, StyleSheet, Switch, ActivityIndicator, Pressable, Platform, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

type Settings = { enabled: boolean };

export default function GuestVerificationSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { restaurantId, accessToken } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const baseUrl = getApiBaseUrl();

  useEffect(() => {
    if (!restaurantId || !accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${baseUrl}/api/restaurants/${restaurantId}/settings/guest-verification`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error("load failed");
        const body = await res.json();
        const data = (body?.data ?? {}) as Partial<Settings>;
        if (!cancelled) setSettings({ enabled: data.enabled !== false });
      } catch {
        if (!cancelled) setSettings({ enabled: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [restaurantId, accessToken, baseUrl]);

  async function update(value: boolean) {
    if (!restaurantId || !accessToken || !settings) return;
    const prev = settings;
    const next = { enabled: value };
    setSettings(next);
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/api/restaurants/${restaurantId}/settings/guest-verification`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      setSettings(prev);
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
          <Text style={[styles.title, { color: colors.foreground }]}>Guest Verification</Text>
          <View style={{ width: 24 }} />
        </View>

        {loading || !settings ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              Anti-fraud hold for QR dine-in orders
            </Text>

            <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.iconWrap, { backgroundColor: "#FEF3C7" }]}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#B45309" />
              </View>
              <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                When a guest places a QR order at a table not opened by staff, the
                kitchen ticket is held until a waiter accepts. Staff-opened tables
                and online-paid orders are never held.
              </Text>
            </View>

            <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>Enable verification hold</Text>
                <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>
                  {settings.enabled
                    ? "QR orders wait for waiter acceptance"
                    : "QR orders fire to kitchen immediately"}
                </Text>
              </View>
              <Switch
                value={settings.enabled}
                onValueChange={update}
                disabled={saving}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          </ScrollView>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  list: { padding: 16, gap: 12 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 },
  infoCard: {
    flexDirection: "row", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "flex-start",
  },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
  },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  rowDesc: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
