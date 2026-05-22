import React from "react";
import { View, StyleSheet, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";
import { AppIcon, type AppIconName } from "./AppIcon";
import { AppButton } from "./AppButton";

export interface AppEmptyStateProps {
  icon: AppIconName;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function AppEmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  style,
}: AppEmptyStateProps) {
  const t = useTheme();
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.iconWrap, { backgroundColor: t.colors.accent }]}>
        <AppIcon name={icon} size={32} color="primary" />
      </View>
      <AppText variant="h2" align="center">{title}</AppText>
      {description ? (
        <AppText variant="body" color="mutedForeground" align="center">
          {description}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <AppButton label={actionLabel} onPress={onAction} style={{ marginTop: 8 }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 32, alignItems: "center", justifyContent: "center", gap: 10 },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
});
