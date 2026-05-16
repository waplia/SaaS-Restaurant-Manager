import React from "react";
import {
  View, Text, StyleSheet, Pressable, Alert, ScrollView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

export default function OwnerProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const isWeb = Platform.OS === "web";

  const handleLogout = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/login");
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: isWeb ? 67 + 16 : insets.top + 16, paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90 },
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

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <MenuItem icon="restaurant-outline" label="Restaurant" value="Spice Garden" colors={colors} />
        <MenuItem icon="people-outline" label="Role" value={user?.role ?? "owner"} colors={colors} />
        <MenuItem icon="mail-outline" label="Email" value={user?.email ?? ""} colors={colors} />
      </View>

      <Pressable
        style={({ pressed }) => [
          { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 12, borderWidth: 1, backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={() => router.push("/notification-settings" as never)}
      >
        <Ionicons name="notifications-outline" size={20} color={colors.primary} />
        <Text style={{ flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: colors.foreground }}>Notifications</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </Pressable>

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

function MenuItem({ icon, label, value, colors }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; colors: ReturnType<typeof import("@/hooks/useColors").useColors> }) {
  return (
    <View style={[styles.menuItem, { borderBottomColor: colors.border }]}>
      <Ionicons name={icon} size={18} color={colors.mutedForeground} />
      <Text style={[styles.menuLabel, { color: colors.foreground }]}>{label}</Text>
      <Text style={[styles.menuValue, { color: colors.mutedForeground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 20 },
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
