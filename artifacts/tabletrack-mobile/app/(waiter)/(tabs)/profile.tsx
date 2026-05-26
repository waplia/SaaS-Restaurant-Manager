import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useAlert } from "@/components/ui/AppAlert";
import { LeaveSection } from "@/components/LeaveSection";

export default function WaiterProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { confirm } = useAlert();
  const isWeb = Platform.OS === "web";

  const handleLogout = async () => {
    const ok = await confirm("Sign out", "Are you sure you want to sign out?", {
      confirmText: "Sign out",
      destructive: true,
    });
    if (!ok) return;
    await logout();
    router.replace("/login");
  };

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
          <Text style={styles.avatarText}>{(user?.name ?? "W")[0].toUpperCase()}</Text>
        </View>
        <Text style={[styles.name, { color: colors.foreground }]}>{user?.name}</Text>
        <Text style={[styles.email, { color: colors.mutedForeground }]}>{user?.email}</Text>
        <View style={[styles.roleBadge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.roleText, { color: colors.primary }]}>{user?.role}</Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [styles.menuRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
        onPress={() => router.push("/notification-settings" as never)}
      >
        <Ionicons name="notifications-outline" size={20} color={colors.primary} />
        <Text style={[styles.menuRowLabel, { color: colors.foreground }]}>Notifications</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </Pressable>

      <LeaveSection />

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

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 24 },
  avatarSection: { alignItems: "center", gap: 8, paddingTop: 8 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 28, fontFamily: "Inter_700Bold" },
  name: { fontSize: 20, fontFamily: "Inter_700Bold" },
  email: { fontSize: 13, fontFamily: "Inter_400Regular" },
  roleBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  roleText: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
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
  menuRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
  },
  menuRowLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
});
