import React from "react";
import { Pressable, Platform, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";
import { AppIcon, type AppIconName } from "./AppIcon";

export interface FloatingActionButtonProps {
  icon: AppIconName;
  /** Optional inline label rendered next to the icon ("extended FAB"). */
  label?: string;
  onPress: () => void;
  /** Place at bottom-right (default) or bottom-center. */
  placement?: "right" | "center";
  /** Background color. Defaults to theme primary. */
  color?: string;
  /** Add extra bottom inset so the FAB clears a tab bar. Default 80. */
  bottomOffset?: number;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

/**
 * Round (or extended) primary action button anchored to the bottom of the
 * screen. Use for the single most-important action of a role screen:
 * "Take order" (waiter), "Bump all" (chef), "Add expense" (accountant)…
 *
 * Sits above the safe area so it never overlaps the home indicator.
 */
export function FloatingActionButton({
  icon, label, onPress, placement = "right", color, bottomOffset = 80,
  accessibilityLabel, style,
}: FloatingActionButtonProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const bottom = (isWeb ? 16 : insets.bottom) + bottomOffset;
  const bg = color ?? t.colors.primary;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute", left: 0, right: 0, bottom,
        alignItems: placement === "center" ? "center" : "flex-end",
        paddingHorizontal: 20,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label ?? "Primary action"}
        style={({ pressed }) => [
          {
            backgroundColor: bg,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 56,
            height: 56,
            paddingHorizontal: label ? 20 : 0,
            borderRadius: label ? 28 : 28,
            gap: label ? 8 : 0,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          },
          t.shadow("lg"),
          style,
        ]}
      >
        <AppIcon name={icon} size={24} color={"#fff"} />
        {label ? (
          <AppText variant="bodyMd" weight="semibold" color={"#fff"}>
            {label}
          </AppText>
        ) : null}
      </Pressable>
    </View>
  );
}
