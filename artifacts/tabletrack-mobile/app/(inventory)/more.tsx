import React from "react";
import { View, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import {
  AppCard, AppText, AppIcon, AppButton, type AppIconName, ConfirmationModal,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { ROLE_LABEL } from "@/lib/roles";

interface Row { icon: AppIconName; label: string; sub?: string; onPress: () => void; destructive?: boolean }

export default function InventoryMore() {
  const colors = useColors();
  const { user, roles, activeRole, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = React.useState(false);

  const go = (path: string) => () => { try { router.push(path as never); } catch { /* nav not ready */ } };

  const rows: Row[] = [
    { icon: "list-outline",          label: "Waste log",     sub: "Recent waste & adjustments",   onPress: go("/(owner)/inventory") },
    { icon: "people-outline",        label: "Suppliers",     sub: "View & contact vendors",        onPress: go("/(owner)/inventory") },
    { icon: "swap-horizontal-outline", label: "Transfers",    sub: "History of stock transfers",   onPress: go("/(owner)/inventory") },
    { icon: "notifications-outline", label: "Notifications", sub: "Stock & PO alerts",            onPress: go("/notifications") },
    { icon: "person-circle-outline", label: "Profile",       onPress: go("/profile") },
    { icon: "help-circle-outline",   label: "Help & support", onPress: go("/support") },
    { icon: "settings-outline",      label: "App settings",  onPress: go("/settings") },
    ...(roles.length > 1 ? [{ icon: "swap-horizontal-outline" as AppIconName, label: "Switch role", onPress: go("/role-switch") }] : []),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RoleShellHeader title="More" subtitle="Account & tools" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 12 }}>
        <AppCard>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary + "1A" }}>
              <AppText variant="h3" color="primary">
                {(user?.name?.[0] ?? user?.email?.[0] ?? "?").toUpperCase()}
              </AppText>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText variant="bodyMd" weight="semibold" numberOfLines={1}>{user?.name ?? user?.email ?? ""}</AppText>
              <AppText variant="small" color="mutedForeground" numberOfLines={1}>
                {ROLE_LABEL[activeRole ?? user?.role ?? ""] ?? activeRole ?? user?.role}
              </AppText>
            </View>
          </View>
        </AppCard>

        <AppCard padding={0}>
          {rows.map((r, i) => (
            <Pressable
              key={r.label}
              onPress={r.onPress}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", gap: 12,
                padding: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.muted }}>
                <AppIcon name={r.icon} size={18} color={r.destructive ? "destructive" : "foreground"} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="bodyMd" weight="semibold" color={r.destructive ? "destructive" : "foreground"} numberOfLines={1}>{r.label}</AppText>
                {r.sub ? <AppText variant="small" color="mutedForeground" numberOfLines={1}>{r.sub}</AppText> : null}
              </View>
              <AppIcon name="chevron-forward" size={18} color="mutedForeground" />
            </Pressable>
          ))}
        </AppCard>

        <AppButton label="Log out" variant="destructive" leftIcon="log-out-outline" onPress={() => setConfirmLogout(true)} fullWidth />
      </ScrollView>

      <ConfirmationModal
        visible={confirmLogout}
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => { setConfirmLogout(false); void logout(); }}
        title="Log out?"
        message="You'll need to sign in again to access inventory."
        confirmLabel="Log out"
        tone="destructive"
      />
    </View>
  );
}
