import React from "react";
import { View, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";
import { AppIcon, type AppIconName } from "./AppIcon";

export type StatusChipTone = "neutral" | "info" | "warning" | "success" | "danger" | "ai" | "primary";

export interface StatusChipProps {
  label: string;
  tone?: StatusChipTone;
  icon?: AppIconName;
  /** Filled (solid) or soft pastel chip. Default "soft". */
  variant?: "soft" | "solid" | "outline";
  /** Small (default) or compact "xs" for dense lists. */
  size?: "xs" | "sm";
  style?: ViewStyle;
}

/**
 * Single-line status chip used in lists (orders, KOTs, deliveries, etc).
 * Visual sibling of `AppBadge` but slightly larger, with an optional
 * leading icon. Use for status text like "Ready", "Picked up", "Held".
 */
export function StatusChip({
  label, tone = "neutral", icon, variant = "soft", size = "sm", style,
}: StatusChipProps) {
  const t = useTheme();
  const map: Record<StatusChipTone, { fg: string; bg: string }> = {
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
  const padV = size === "xs" ? 2 : 4;
  const padH = size === "xs" ? 6 : 9;

  return (
    <View
      style={[
        {
          flexDirection: "row", alignItems: "center", gap: 4,
          paddingHorizontal: padH, paddingVertical: padV,
          borderRadius: 999,
          backgroundColor: bg,
          borderColor: border,
          borderWidth: variant === "outline" ? 1 : 0,
          alignSelf: "flex-start",
        },
        style,
      ]}
    >
      {icon ? <AppIcon name={icon} size={size === "xs" ? 11 : 13} color={fg} /> : null}
      <AppText variant={size === "xs" ? "micro" : "small"} weight="semibold" color={fg}>
        {label}
      </AppText>
    </View>
  );
}
