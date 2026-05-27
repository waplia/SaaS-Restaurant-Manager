import React, { useState } from "react";
import { View, Pressable } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/theme";
import { useAuth } from "@/context/AuthContext";
import { RoleShellScreen } from "@/components/RoleShellScreen";
import { ROLE_LABEL } from "@/lib/roles";
import {
  AppText, AppCard, AppIcon, ConfirmationModal,
  type AppIconName,
} from "@/components/ui";

interface MoreItem {
  icon: AppIconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  show?: boolean;
}

/**
 * Marketing "More" tab — mirrors the shared RoleMoreSheet items (Profile,
 * Notifications, Help, Settings, Switch role, Logout) but rendered as a
 * full screen so it works inside the tab bar.
 */
export default function MarketingMoreScreen() {
  const t = useTheme();
  const { user, roles, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const go = (path: string) => () => {
    try { router.push(path as never); } catch { /* nav not ready */ }
  };

  const items: MoreItem[] = [
    { icon: "person-circle-outline", label: "Profile", onPress: go("/profile") },
    { icon: "notifications-outline", label: "Notifications", onPress: go("/notifications") },
    { icon: "help-circle-outline", label: "Help & support", onPress: go("/support") },
    { icon: "settings-outline", label: "App settings", onPress: go("/settings") },
    {
      icon: "swap-horizontal-outline", label: "Switch role",
      onPress: go("/role-switch"), show: roles.length > 1,
    },
    {
      icon: "log-out-outline", label: "Log out",
      onPress: () => setConfirmLogout(true), destructive: true,
    },
  ];

  return (
    <RoleShellScreen title="More" subtitle={user ? ROLE_LABEL[user.role as keyof typeof ROLE_LABEL] ?? user.role : undefined}>
      {user ? (
        <AppCard padding={14} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{
            width: 48, height: 48, borderRadius: 24,
            alignItems: "center", justifyContent: "center",
            backgroundColor: t.colors.primary + "1A",
          }}>
            <AppText variant="h3" color={t.colors.primary}>
              {(user.name?.[0] ?? user.email?.[0] ?? "?").toUpperCase()}
            </AppText>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText weight="semibold" numberOfLines={1}>{user.name ?? user.email}</AppText>
            <AppText variant="small" color="mutedForeground" numberOfLines={1}>{user.email}</AppText>
          </View>
        </AppCard>
      ) : null}

      {items.filter(i => i.show !== false).map(item => (
        <Pressable
          key={item.label}
          onPress={item.onPress}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <AppCard padding={14} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <AppIcon
              name={item.icon}
              size={22}
              color={item.destructive ? "destructive" : "primary"}
            />
            <AppText
              weight="semibold"
              color={item.destructive ? "destructive" : "foreground"}
              style={{ flex: 1 }}
            >
              {item.label}
            </AppText>
            <AppIcon name="chevron-forward" size={18} color="mutedForeground" />
          </AppCard>
        </Pressable>
      ))}

      <ConfirmationModal
        visible={confirmLogout}
        title="Log out?"
        message="You'll need to sign in again to access your marketing tools."
        confirmLabel="Log out"
        tone="destructive"
        onConfirm={async () => { setConfirmLogout(false); await logout(); }}
        onCancel={() => setConfirmLogout(false)}
      />
    </RoleShellScreen>
  );
}
