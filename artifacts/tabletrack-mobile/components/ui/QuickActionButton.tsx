import React from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";
import { AppIcon, type AppIconName } from "./AppIcon";

export interface QuickActionButtonProps {
  icon: AppIconName;
  label: string;
  onPress?: () => void;
  /** Optional small badge (e.g. count of pending items). */
  badge?: string | number | null;
  /** Tint color. Defaults to theme primary. */
  tint?: string;
  disabled?: boolean;
  style?: ViewStyle;
}

/**
 * Square tile button used in role home "Quick actions" grids. Designed to
 * sit on a 2- or 3-column grid; sized so 3 fit comfortably on a phone.
 */
export function QuickActionButton({
  icon, label, onPress, badge, tint, disabled, style,
}: QuickActionButtonProps) {
  const t = useTheme();
  const color = tint ?? t.colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          flexGrow: 1,
          flexBasis: 0,
          minWidth: 90,
          padding: t.spacing.md,
          borderRadius: t.radius.md,
          borderWidth: 1,
          borderColor: t.colors.border,
          backgroundColor: t.colors.card,
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          opacity: pressed ? 0.8 : disabled ? 0.55 : 1,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 40, height: 40, borderRadius: 12,
          alignItems: "center", justifyContent: "center",
          backgroundColor: color + "1A",
        }}
      >
        <AppIcon name={icon} size={20} color={color} />
        {badge != null && String(badge) !== "0" ? (
          <View
            style={{
              position: "absolute", top: -4, right: -8,
              minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
              backgroundColor: t.colors.destructive,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <AppText variant="micro" style={{ color: "#fff", fontSize: 10 }}>
              {String(badge)}
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="small" numberOfLines={1} align="center">{label}</AppText>
    </Pressable>
  );
}
