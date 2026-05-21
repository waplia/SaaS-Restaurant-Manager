import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Switch, ActivityIndicator, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

type Prefs = {
  waiter_call: boolean;
  new_order: boolean;
  reservation: boolean;
};

const PREF_META: Array<{ key: keyof Prefs; title: string; description: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "waiter_call", title: "Waiter calls", description: "When a guest taps the call-waiter button", icon: "hand-left-outline" },
  { key: "new_order", title: "New kitchen orders", description: "When a new ticket arrives at your station", icon: "flame-outline" },
  { key: "reservation", title: "Reservations", description: "When a reservation is confirmed", icon: "calendar-outline" },
];

export default function NotificationSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, accessToken } = useAuth();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const baseUrl = `${getApiBaseUrl()}`;

  useEffect(() => {
    if (!user || !accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${baseUrl}/api/users/${user.id}/notification-prefs`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error("load failed");
        const data = (await res.json()) as Prefs;
        if (!cancelled) setPrefs(data);
      } catch {
        if (!cancelled) setPrefs({ waiter_call: true, new_order: true, reservation: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, accessToken, baseUrl]);

  async function update(key: keyof Prefs, value: boolean) {
    if (!user || !accessToken || !prefs) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaving(key);
    try {
      const res = await fetch(`${baseUrl}/api/users/${user.id}/notification-prefs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error("save failed");
      const updated = (await res.json()) as Prefs;
      setPrefs(updated);
    } catch {
      setPrefs(prefs);
      Alert.alert("Could not save", "Your change was not saved. Please try again.");
    } finally {
      setSaving(null);
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
          <Text style={[styles.title, { color: colors.foreground }]}>Notifications</Text>
          <View style={{ width: 24 }} />
        </View>

        {loading || !prefs ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.list}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              Choose which alerts wake your phone
            </Text>
            {PREF_META.map(meta => (
              <View key={meta.key} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
                  <Ionicons name={meta.icon} size={20} color={colors.primary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>{meta.title}</Text>
                  <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>{meta.description}</Text>
                </View>
                <Switch
                  value={prefs[meta.key]}
                  onValueChange={v => update(meta.key, v)}
                  disabled={saving === meta.key}
                  trackColor={{ true: colors.primary, false: colors.border }}
                />
              </View>
            ))}
          </View>
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
  list: { padding: 16, gap: 10 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
  },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  rowDesc: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
