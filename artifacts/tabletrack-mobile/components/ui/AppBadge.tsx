import React from "react";
import { View, StyleSheet, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";

export type AppBadgeTone =
  | "neutral"
  | "info"
  | "warning"
  | "success"
  | "danger"
  | "ai"
  | "primary";

export interface AppBadgeProps {
  label: string;
  tone?: AppBadgeTone;
  /** Solid uses tone color as bg with white text. Default is "soft". */
  variant?: "soft" | "solid" | "outline";
  style?: ViewStyle;
}

export function AppBadge({ label, tone = "neutral", variant = "soft", style }: AppBadgeProps) {
  const t = useTheme();
  const map: Record<AppBadgeTone, { fg: string; bg: string }> = {
    neutral: { fg: t.colors.mutedForeground, bg: t.colors.muted },
    primary: { fg: t.colors.primary, bg: t.colors.accent },
    info: { fg: t.colors.info, bg: t.colors.infoSoft },
    warning: { fg: t.colors.warning, bg: t.colors.warningSoft },
    success: { fg: t.colors.success, bg: t.colors.successSoft },
    danger: { fg: t.colors.destructive, bg: t.colors.destructive + "1F" },
    ai: { fg: t.colors.ai, bg: t.colors.aiSoft },
  };
  const c = map[tone];
  const bg = variant === "solid" ? c.fg : variant === "outline" ? "transparent" : c.bg;
  const fg = variant === "solid" ? "#fff" : c.fg;
  const border = variant === "outline" ? c.fg : "transparent";
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg, borderColor: border, borderWidth: variant === "outline" ? 1 : 0 },
        style,
      ]}
    >
      <AppText variant="micro" weight="semibold" style={{ color: fg, textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
});
