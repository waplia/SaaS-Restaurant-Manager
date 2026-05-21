import React from "react";
import { View, StyleSheet, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

type IoniconName = keyof typeof Ionicons.glyphMap;

interface BaseProps {
  name: IoniconName;
  size?: number;
  color?: string;
  style?: ViewStyle;
}

export function PlainIcon({ name, size = 20, color }: BaseProps) {
  const colors = useColors();
  return <Ionicons name={name} size={size} color={color ?? colors.mutedForeground} />;
}

interface CircleIconProps extends BaseProps {
  bg?: string;
  diameter?: number;
}

export function CircleIcon({ name, size = 18, color, bg, diameter = 34, style }: CircleIconProps) {
  const colors = useColors();
  const fg = color ?? colors.primary;
  const background = bg ?? (fg + "1A");
  return (
    <View
      style={[
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: background,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={fg} />
    </View>
  );
}

interface TileIconProps extends BaseProps {
  bg?: string;
  diameter?: number;
}

export function TileIcon({ name, size = 22, color, bg, diameter = 48, style }: TileIconProps) {
  const colors = useColors();
  const fg = color ?? colors.primary;
  const background = bg ?? (fg + "1A");
  return (
    <View
      style={[
        {
          width: diameter,
          height: diameter,
          borderRadius: 16,
          backgroundColor: background,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={fg} />
    </View>
  );
}

interface StatusIconProps extends BaseProps {
  tone?: "primary" | "success" | "warning" | "danger" | "muted";
}

export function StatusIcon({ name, size = 14, color, tone, style }: StatusIconProps) {
  const colors = useColors();
  const toneColor =
    color ??
    (tone === "success" ? "#16a34a" :
      tone === "warning" ? "#d97706" :
      tone === "danger" ? colors.destructive :
      tone === "muted" ? colors.mutedForeground :
      colors.primary);
  return (
    <View style={[styles.statusWrap, style]}>
      <Ionicons name={name} size={size} color={toneColor} />
    </View>
  );
}

const styles = StyleSheet.create({
  statusWrap: { alignItems: "center", justifyContent: "center" },
});
