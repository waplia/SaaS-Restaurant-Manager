import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { ROLE_LABEL } from "@/lib/roles";

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const isWeb = Platform.OS === "web";

  const handleLogout = () => {
    Alert.alert("Sign out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out", style: "destructive",
        onPress: async () => { await logout(); router.replace("/login"); },
      },
    ]);
  };

  const rows: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string; right?: string; onPress?: () => void }> = [
    { icon: "person-outline", label: "Name", right: user?.name },
    { icon: "mail-outline", label: "Email", right: user?.email },
    { icon: "ribbon-outline", label: "Role", right: ROLE_LABEL[user?.role ?? ""] ?? user?.role },
    { icon: "notifications-outline", label: "Notifications", onPress: () => router.push("/notification-settings" as never) },
    { icon: "business-outline", label: "Outlets", onPress: () => router.push("/(owner)/outlets" as never) },
    { icon: "help-buoy-outline", label: "Support", onPress: () => router.push("/(owner)/support" as never) },
    { icon: "lock-closed-outline", label: "Change password", right: "Web only" },
    { icon: "language-outline", label: "Language", right: "English" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Settings" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: isWeb ? 100 : insets.bottom + (Platform.OS === "android" ? 140 : 110) }}>
        <View style={styles.profile}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>{(user?.name ?? "U")[0]?.toUpperCase()}</Text>
          </View>
          <Text style={[styles.name, { color: colors.foreground }]}>{user?.name}</Text>
          <View style={[styles.roleBadge, { backgroundColor: colors.accent }]}>
            <Text style={[styles.roleText, { color: colors.primary }]}>{ROLE_LABEL[user?.role ?? ""] ?? user?.role}</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {rows.map((r, i) => (
            <Pressable
              key={r.label}
              onPress={r.onPress}
              disabled={!r.onPress}
              style={({ pressed }) => [
                styles.row,
                {
                  borderBottomColor: colors.border,
                  borderBottomWidth: i === rows.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  opacity: pressed && r.onPress ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name={r.icon} size={18} color={colors.mutedForeground} />
              <Text style={[styles.label, { color: colors.foreground, flex: 1 }]}>{r.label}</Text>
              {r.right ? (
                <Text style={[styles.value, { color: colors.mutedForeground }]} numberOfLines={1}>{r.right}</Text>
              ) : null}
              {r.onPress ? (
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              ) : null}
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [styles.logout, { borderColor: colors.destructive, opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.destructive} />
          <Text style={[styles.logoutText, { color: colors.destructive }]}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  profile: { alignItems: "center", gap: 8 },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 24, fontFamily: "Inter_700Bold" },
  name: { fontSize: 18, fontFamily: "Inter_700Bold" },
  roleBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  roleText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  label: { fontSize: 14, fontFamily: "Inter_500Medium" },
  value: { fontSize: 13, fontFamily: "Inter_400Regular", maxWidth: 160, textAlign: "right" },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5 },
  logoutText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
