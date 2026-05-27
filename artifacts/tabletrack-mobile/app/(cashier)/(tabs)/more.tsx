import React, { useState } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/theme";
import {
  AppText, AppCard, AppIcon, ConfirmationModal, type AppIconName,
} from "@/components/ui";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { OfflineBanner } from "@/components/OfflineBanner";
import { DeviceStatusStrip } from "@/components/cashier/DeviceStatusStrip";
import { useAuth } from "@/context/AuthContext";

interface Item {
  icon: AppIconName;
  label: string;
  description?: string;
  onPress: () => void;
  destructive?: boolean;
  show?: boolean;
}

export default function CashierMoreScreen() {
  const t = useTheme();
  const { user, roles, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const go = (path: string) => () => {
    try { router.push(path as never); } catch { /* nav not ready */ }
  };

  const items: Item[] = [
    { icon: "person-circle-outline", label: "Profile", description: "Edit personal info", onPress: go("/profile") },
    { icon: "notifications-outline", label: "Notifications", description: "Inbox & alerts", onPress: go("/notifications") },
    { icon: "list-outline", label: "All orders", description: "Browse every ticket", onPress: go("/(owner)/orders") },
    { icon: "grid-outline", label: "Tables", description: "Floor view", onPress: go("/(owner)/tables") },
    { icon: "wallet-outline", label: "Expenses", description: "Log petty cash spend", onPress: go("/(owner)/finance") },
    { icon: "print-outline", label: "Printer & terminals", description: "Manage hardware", onPress: go("/settings") },
    { icon: "help-circle-outline", label: "Help & support", onPress: go("/support") },
    { icon: "settings-outline", label: "App settings", onPress: go("/settings") },
    {
      icon: "swap-horizontal-outline",
      label: "Switch role",
      description: `${roles.length} role${roles.length === 1 ? "" : "s"} available`,
      onPress: go("/role-switch"),
      show: roles.length > 1,
    },
    {
      icon: "log-out-outline",
      label: "Log out",
      onPress: () => setConfirmLogout(true),
      destructive: true,
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader title="More" subtitle={user?.name ?? "Cashier"} />
      <DeviceStatusStrip />
      <OfflineBanner />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 32 }}>
        <AppCard padding={12} shadow="xs">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 44, height: 44, borderRadius: 22,
                alignItems: "center", justifyContent: "center",
                backgroundColor: t.colors.accent,
              }}
            >
              <AppIcon name="person" size={22} color="primary" />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyMd" weight="semibold">{user?.name ?? "—"}</AppText>
              <AppText variant="small" color="mutedForeground">{user?.email ?? ""}</AppText>
            </View>
            <View
              style={{
                paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
                backgroundColor: t.colors.accent,
              }}
            >
              <AppText variant="micro" color="primary" weight="semibold">CASHIER</AppText>
            </View>
          </View>
        </AppCard>

        {items.filter((i) => i.show !== false).map((item) => (
          <Pressable
            key={item.label}
            onPress={item.onPress}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          >
            <AppCard padding={14} shadow="xs">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: item.destructive ? "#fee2e2" : t.colors.muted,
                  }}
                >
                  <AppIcon
                    name={item.icon}
                    size={18}
                    color={item.destructive ? "#dc2626" : t.colors.foreground}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText
                    variant="bodyMd"
                    weight="semibold"
                    style={item.destructive ? { color: "#dc2626" } : undefined}
                  >
                    {item.label}
                  </AppText>
                  {item.description ? (
                    <AppText variant="small" color="mutedForeground">{item.description}</AppText>
                  ) : null}
                </View>
                {!item.destructive ? <AppIcon name="chevron-forward" size={18} color="mutedForeground" /> : null}
              </View>
            </AppCard>
          </Pressable>
        ))}
      </ScrollView>

      <ConfirmationModal
        visible={confirmLogout}
        onConfirm={() => { setConfirmLogout(false); void logout(); }}
        onCancel={() => setConfirmLogout(false)}
        title="Log out?"
        message="You'll need to sign in again to access the cashier app."
        confirmLabel="Log out"
        tone="destructive"
      />
    </View>
  );
}
