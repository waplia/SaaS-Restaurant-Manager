import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { CircleIcon } from "@/components/Icon";

export interface MenuListRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  badge?: string | number;
  badgeTone?: "primary" | "danger" | "neutral";
  href?: string;
  onPress?: () => void;
  rightAccessory?: React.ReactNode;
  disabled?: boolean;
}

export function MenuListRow({
  icon,
  label,
  description,
  badge,
  badgeTone = "neutral",
  href,
  onPress,
  rightAccessory,
  disabled,
}: MenuListRowProps) {
  const colors = useColors();
  const handle = () => {
    if (disabled) return;
    if (onPress) onPress();
    else if (href) router.push(href as never);
  };
  const badgeBg =
    badgeTone === "primary" ? colors.primary :
    badgeTone === "danger" ? colors.destructive :
    colors.muted;
  const badgeFg = badgeTone === "neutral" ? colors.foreground : "#fff";

  return (
    <Pressable
      onPress={handle}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 },
      ]}
    >
      <CircleIcon name={icon} size={18} diameter={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.label, { color: colors.foreground }]} numberOfLines={1}>{label}</Text>
        {description ? (
          <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={1}>{description}</Text>
        ) : null}
      </View>
      {badge !== undefined ? (
        <View style={[styles.badge, { backgroundColor: badgeBg }]}>
          <Text style={[styles.badgeText, { color: badgeFg }]}>{String(badge)}</Text>
        </View>
      ) : null}
      {rightAccessory ?? (
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1,
  },
  label: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
});
