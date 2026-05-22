import React from "react";
import { View, Pressable, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";
import { AppIcon } from "./AppIcon";

export interface AppHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  /** Centers the title (iOS-style). Defaults to left-aligned for density. */
  centered?: boolean;
}

const HEADER_HEIGHT = 52;

export function AppHeader({
  title,
  subtitle,
  showBack,
  onBack,
  right,
  centered = false,
}: AppHeaderProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 16 : insets.top;

  return (
    <View
      style={[
        styles.wrap,
        {
          paddingTop: topPad,
          backgroundColor: t.colors.background,
          borderBottomColor: t.colors.border,
        },
      ]}
    >
      <View style={[styles.row, { height: HEADER_HEIGHT }]}>
        {showBack ? (
          <Pressable
            onPress={() => (onBack ? onBack() : router.back())}
            hitSlop={12}
            style={styles.iconBtn}
            accessibilityLabel="Go back"
          >
            <AppIcon name="chevron-back" size={26} color="foreground" />
          </Pressable>
        ) : (
          <View style={styles.iconBtn} />
        )}
        <View style={[styles.titleWrap, centered && styles.centered]}>
          <AppText
            variant="h2"
            numberOfLines={1}
            align={centered ? "center" : undefined}
          >
            {title}
          </AppText>
          {subtitle ? (
            <AppText
              variant="small"
              color="mutedForeground"
              numberOfLines={1}
              align={centered ? "center" : undefined}
            >
              {subtitle}
            </AppText>
          ) : null}
        </View>
        <View style={styles.right}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center" },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  titleWrap: { flex: 1, paddingHorizontal: 4 },
  centered: { alignItems: "center" },
  right: { minWidth: 44, alignItems: "flex-end", flexDirection: "row" },
});
