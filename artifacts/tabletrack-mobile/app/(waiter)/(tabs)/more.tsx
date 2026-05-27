import React from "react";
import { View, Pressable, ScrollView, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import {
  AppText, AppIcon, type AppIconName, ConfirmationModal,
} from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { ROLE_LABEL } from "@/lib/roles";

interface MoreItem {
  icon: AppIconName;
  label: string;
  hint?: string;
  onPress: () => void;
  destructive?: boolean;
  show?: boolean;
}

/**
 * Task #637 — Waiter "More" tab. Replaces the legacy Profile tab and
 * exposes every secondary surface (Profile, Service Alerts,
 * Notifications history, Help, Settings, Switch role, Log out) in one
 * scrollable list so the bottom bar can stay focused on the four core
 * floor actions.
 */
export default function WaiterMoreScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { user, roles, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = React.useState(false);

  const go = (path: string) => () => {
    try { router.push(path as never); } catch { /* nav not ready */ }
  };

  const items: MoreItem[] = [
    { icon: "notifications-outline", label: "Service Alerts", hint: "Bell rings, KOT ready, escalations", onPress: go("/notifications") },
    { icon: "person-circle-outline", label: "Profile",        hint: "Name, password, sign out",            onPress: go("/profile") },
    { icon: "help-circle-outline",   label: "Help & support",                                              onPress: go("/support") },
    { icon: "settings-outline",      label: "App settings",                                                onPress: go("/settings") },
    {
      icon: "swap-horizontal-outline",
      label: "Switch role",
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
      <ScrollView
        contentContainerStyle={{
          padding: t.spacing.lg,
          paddingTop: (isWeb ? 24 : insets.top) + t.spacing.lg,
          paddingBottom: insets.bottom + 120,
          gap: t.spacing.md,
        }}
      >
        <AppText variant="h2" weight="bold">More</AppText>

        {user ? (
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 12,
            padding: t.spacing.md, borderRadius: t.radius.md,
            borderWidth: 1, borderColor: t.colors.border,
            backgroundColor: t.colors.card,
          }}>
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
              <AppText variant="bodyMd" weight="semibold" numberOfLines={1}>
                {user.name ?? user.email}
              </AppText>
              <AppText variant="small" color="mutedForeground" numberOfLines={1}>
                {ROLE_LABEL[user.role] ?? user.role}
              </AppText>
            </View>
          </View>
        ) : null}

        <View style={{
          borderRadius: t.radius.md,
          borderWidth: 1,
          borderColor: t.colors.border,
          backgroundColor: t.colors.card,
          overflow: "hidden",
        }}>
          {items.filter((i) => i.show !== false).map((item, idx, arr) => (
            <Pressable
              key={item.label}
              onPress={item.onPress}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", gap: 12,
                padding: 16,
                borderBottomWidth: idx < arr.length - 1 ? 1 : 0,
                borderBottomColor: t.colors.border,
                backgroundColor: pressed ? t.colors.muted : "transparent",
              })}
            >
              <AppIcon
                name={item.icon}
                size={22}
                color={item.destructive ? t.colors.destructive : t.colors.foreground}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText
                  variant="body"
                  weight="medium"
                  style={item.destructive ? { color: t.colors.destructive } : undefined}
                >
                  {item.label}
                </AppText>
                {item.hint ? (
                  <AppText variant="small" color="mutedForeground">{item.hint}</AppText>
                ) : null}
              </View>
              {!item.destructive ? (
                <AppIcon name="chevron-forward" size={18} color="mutedForeground" />
              ) : null}
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <ConfirmationModal
        visible={confirmLogout}
        title="Log out?"
        message="You'll need to sign in again to use the app."
        confirmLabel="Log out"
        tone="destructive"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={async () => {
          setConfirmLogout(false);
          await logout();
          try { router.replace("/login"); } catch { /* ignore */ }
        }}
      />
    </View>
  );
}
