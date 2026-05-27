import React from "react";
import { Pressable, View, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme } from "@/theme";
import { AppText, AppIcon } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { OutletSwitcherSheet } from "./OutletSwitcherSheet";
import { RoleMoreSheet } from "./RoleMoreSheet";
import { OfflineBanner } from "./OfflineBanner";

export interface RoleShellHeaderProps {
  /** Page title (e.g. "Cashier", "Kitchen", "Today's KOTs"). */
  title: string;
  /** Optional secondary line under the title. */
  subtitle?: string;
  /** Hide the outlet switcher trigger (useful for screens that don't act
   *  on a single outlet). The switcher is auto-hidden for single-outlet
   *  users. */
  hideOutletSwitcher?: boolean;
  /** Extra right-side content rendered before the bell + more buttons. */
  rightExtra?: React.ReactNode;
}

/**
 * Shared top bar for every role home stack. Renders the page title with an
 * outlet name underneath, plus a notifications bell and "More" button on
 * the right. Also renders the OfflineBanner directly below so non-owner
 * screens get offline awareness for free.
 */
export function RoleShellHeader({
  title, subtitle, hideOutletSwitcher, rightExtra,
}: RoleShellHeaderProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 16 : insets.top;
  const { activeOutlet, outlets } = useAuth();

  const [showOutlets, setShowOutlets] = React.useState(false);
  const [showMore, setShowMore] = React.useState(false);

  const canSwitchOutlet = !hideOutletSwitcher && outlets.length > 1;
  const outletLabel = activeOutlet?.name ?? (outlets[0]?.name ?? "");
  const computedSubtitle = subtitle ?? (outletLabel || undefined);

  return (
    <View
      style={{
        backgroundColor: t.colors.background,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.border,
        paddingTop: topPad,
      }}
    >
      <View style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        height: 56,
        gap: 8,
      }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="h3" numberOfLines={1}>{title}</AppText>
          {computedSubtitle ? (
            canSwitchOutlet ? (
              <Pressable
                onPress={() => setShowOutlets(true)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Switch outlet"
                style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }}
              >
                <AppText variant="small" color="mutedForeground" numberOfLines={1}>
                  {computedSubtitle}
                </AppText>
                <AppIcon name="chevron-down" size={14} color="mutedForeground" />
              </Pressable>
            ) : (
              <AppText variant="small" color="mutedForeground" numberOfLines={1}>
                {computedSubtitle}
              </AppText>
            )
          ) : null}
        </View>
        {rightExtra}
        <Pressable
          onPress={() => router.push("/notifications" as never)}
          hitSlop={10}
          accessibilityLabel="Notifications"
          style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
        >
          <AppIcon name="notifications-outline" size={22} color="foreground" />
        </Pressable>
        <Pressable
          onPress={() => setShowMore(true)}
          hitSlop={10}
          accessibilityLabel="More"
          style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
        >
          <AppIcon name="ellipsis-vertical" size={22} color="foreground" />
        </Pressable>
      </View>
      <OfflineBanner />
      <OutletSwitcherSheet visible={showOutlets} onClose={() => setShowOutlets(false)} />
      <RoleMoreSheet visible={showMore} onClose={() => setShowMore(false)} />
    </View>
  );
}
