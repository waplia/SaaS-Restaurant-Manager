import React from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/theme";
import { AppBottomSheet, AppText, AppIcon, type AppIconName, ConfirmationModal } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { ROLE_LABEL } from "@/lib/roles";

export interface RoleMoreSheetProps {
  visible: boolean;
  onClose: () => void;
}

interface Item {
  icon: AppIconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  show?: boolean;
}

/**
 * Bottom-sheet "More" menu shared across every role shell. Provides
 * navigation to Profile, Notifications, Help/Support, App settings, and
 * Logout — plus a "Switch role" entry when the user has more than one
 * assigned role.
 */
export function RoleMoreSheet({ visible, onClose }: RoleMoreSheetProps) {
  const t = useTheme();
  const { user, roles, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = React.useState(false);

  const go = (path: string) => () => {
    onClose();
    try { router.push(path as never); } catch { /* nav not ready */ }
  };

  const items: Item[] = [
    { icon: "person-circle-outline", label: "Profile", onPress: go("/profile") },
    { icon: "notifications-outline", label: "Notifications", onPress: go("/notifications") },
    { icon: "help-circle-outline", label: "Help & support", onPress: go("/support") },
    { icon: "settings-outline", label: "App settings", onPress: go("/settings") },
    {
      icon: "swap-horizontal-outline",
      label: "Switch role",
      onPress: go("/role-switch"),
      show: roles.length > 1,
    },
    {
      icon: "log-out-outline",
      label: "Log out",
      onPress: () => { onClose(); setConfirmLogout(true); },
      destructive: true,
    },
  ];

  return (
    <>
      <AppBottomSheet visible={visible} onClose={onClose} title="More">
        {user ? (
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 12,
            padding: 12, borderRadius: t.radius.md,
            borderWidth: 1, borderColor: t.colors.border,
            backgroundColor: t.colors.card,
          }}>
            <View style={{
              width: 44, height: 44, borderRadius: 22,
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

        <View style={{ gap: 4, marginTop: 4 }}>
          {items.filter((i) => i.show !== false).map((item) => (
            <Pressable
              key={item.label}
              onPress={item.onPress}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", gap: 12,
                padding: 14, borderRadius: t.radius.md,
                backgroundColor: pressed ? t.colors.muted : "transparent",
              })}
            >
              <AppIcon
                name={item.icon}
                size={20}
                color={item.destructive ? t.colors.destructive : t.colors.foreground}
              />
              <AppText
                variant="body"
                weight="medium"
                style={item.destructive ? { color: t.colors.destructive } : undefined}
              >
                {item.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      </AppBottomSheet>

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
    </>
  );
}
