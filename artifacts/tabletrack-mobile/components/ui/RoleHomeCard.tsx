import React from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";
import { AppIcon, type AppIconName } from "./AppIcon";
import { AppBadge, type AppBadgeTone } from "./AppBadge";

export interface RoleHomeCardProps {
  /** Big lead icon for the card. */
  icon: AppIconName;
  /** Optional small label above the title (e.g. "TODAY"). */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Optional headline value rendered large (e.g. "₹12,400" or "23 KOTs"). */
  value?: string;
  /** Optional badge — e.g. count of pending items. */
  badge?: { label: string; tone?: AppBadgeTone };
  /** Tap handler. The whole card is pressable when provided. */
  onPress?: () => void;
  /** Override the icon tint. Defaults to theme primary. */
  iconColor?: string;
  style?: ViewStyle;
}

/**
 * Headline card for a role home screen. Every per-role app (waiter, chef,
 * cashier, inventory, marketing, accountant) uses this as the top-of-screen
 * summary tile so they all feel like the same product.
 *
 * Designed for both interactive (`onPress`) and read-only use.
 */
export function RoleHomeCard({
  icon, eyebrow, title, subtitle, value, badge, onPress, iconColor, style,
}: RoleHomeCardProps) {
  const t = useTheme();
  const tint = iconColor ?? t.colors.primary;
  const body = (
    <View
      style={[
        {
          flexDirection: "row",
          gap: t.spacing.md,
          alignItems: "center",
          padding: t.spacing.lg,
          borderRadius: t.radius.lg,
          backgroundColor: t.colors.card,
          borderWidth: 1,
          borderColor: t.colors.border,
        },
        t.shadow("xs"),
        style,
      ]}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tint + "1A",
        }}
      >
        <AppIcon name={icon} size={26} color={tint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {eyebrow ? <AppText variant="micro" color="mutedForeground">{eyebrow.toUpperCase()}</AppText> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <AppText variant="h3" numberOfLines={1} style={{ flexShrink: 1 }}>{title}</AppText>
          {badge ? <AppBadge label={badge.label} tone={badge.tone ?? "primary"} /> : null}
        </View>
        {value ? <AppText variant="title" style={{ marginTop: 2 }}>{value}</AppText> : null}
        {subtitle ? (
          <AppText variant="small" color="mutedForeground" numberOfLines={2} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {onPress ? <AppIcon name="chevron-forward" size={20} color="mutedForeground" /> : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {body}
    </Pressable>
  );
}
