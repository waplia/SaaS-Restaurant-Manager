import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Alert } from "@/components/ui/AppAlert";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import OwnerProfileScreen from "./(owner)/profile";

/**
 * Top-level Profile route. Owners / managers / super_admins get the
 * full restaurant editor (the one in (owner)/profile.tsx). Every other
 * role (chef, cashier, waiter, rider, inventory, marketing, accountant)
 * gets a minimal staff profile — just identity, change-password, and
 * sign-out. Without this split a chef was seeing restaurant settings,
 * UPI QR config, GSTIN, FSSAI, etc. from their More tab.
 */
export default function ProfileScreen() {
  const { user, activeRole } = useAuth();
  // Use the *active* role (what the user is currently operating as), not
  // the primary `user.role`. A multi-role account (e.g. an owner who has
  // switched into Cashier mode) should see the lightweight staff profile
  // on the cashier shell — otherwise we render the owner restaurant
  // editor whose useEffect+useQuery combo has caused a "Maximum update
  // depth" crash for cashier sessions.
  const effectiveRole = activeRole ?? user?.role ?? null;
  const isOwnerLike =
    effectiveRole === "owner" || effectiveRole === "manager" || effectiveRole === "super_admin";
  if (isOwnerLike) return <OwnerProfileScreen />;
  return <StaffProfileScreen />;
}

function StaffProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, activeOutlet } = useAuth();
  const isWeb = Platform.OS === "web";

  const handleLogout = () =>
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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: isWeb ? 67 + 16 : insets.top + 16,
        paddingBottom: isWeb ? 34 + 90 : insets.bottom + 110,
        paddingHorizontal: 16,
        gap: 16,
      }}
    >
      <View style={styles.avatarSection}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>{(user?.name ?? "U")[0].toUpperCase()}</Text>
        </View>
        <Text style={[styles.name, { color: colors.foreground }]}>{user?.name}</Text>
        {user?.email ? (
          <Text style={[styles.email, { color: colors.mutedForeground }]}>{user.email}</Text>
        ) : null}
        <View style={[styles.roleBadge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.roleText, { color: colors.primary }]}>{user?.role ?? "staff"}</Text>
        </View>
        {activeOutlet?.name ? (
          <Text style={[styles.email, { color: colors.mutedForeground }]}>
            {activeOutlet.name}
          </Text>
        ) : null}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={() => router.push("/change-password" as never)}
      >
        <Ionicons name="lock-closed-outline" size={20} color={colors.primary} />
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>Change password</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </Pressable>

      <Pressable
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={() => router.push("/notification-settings" as never)}
      >
        <Ionicons name="notifications-outline" size={20} color={colors.primary} />
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>Notification settings</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </Pressable>

      <Pressable
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={() => router.push("/support" as never)}
      >
        <Ionicons name="help-circle-outline" size={20} color={colors.primary} />
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>Help & support</Text>
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

const styles = StyleSheet.create({
  avatarSection: { alignItems: "center", gap: 6, paddingTop: 8 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 28, fontFamily: "Inter_700Bold" },
  name: { fontSize: 20, fontFamily: "Inter_700Bold" },
  email: { fontSize: 13, fontFamily: "Inter_400Regular" },
  roleBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, marginTop: 4 },
  roleText: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 14,
    marginTop: 4,
  },
  logoutText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
