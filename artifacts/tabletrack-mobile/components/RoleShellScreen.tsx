import React from "react";
import { RefreshControl, ScrollView, View, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { RoleShellHeader, type RoleShellHeaderProps } from "./RoleShellHeader";

export interface RoleShellScreenProps extends RoleShellHeaderProps {
  children: React.ReactNode;
  /** Wrap children in a vertical ScrollView. Default true. */
  scrollable?: boolean;
  contentStyle?: ViewStyle;
  /**
   * Pull-to-refresh callback. When provided (and `scrollable`), the
   * shell renders a shared RefreshControl on the scroll view so every
   * role home gets identical pull-to-refresh behavior without each
   * screen wiring its own.
   */
  onRefresh?: () => void | Promise<unknown>;
  /** Whether a refresh is currently in flight. */
  refreshing?: boolean;
}

/**
 * Convenience wrapper that renders the shared top bar + offline banner +
 * a scrollable content area with shared pull-to-refresh. Use as the root
 * of a role home/index screen.
 */
export function RoleShellScreen({
  children, scrollable = true, contentStyle, onRefresh, refreshing,
  ...header
}: RoleShellScreenProps) {
  const t = useTheme();
  const Body = scrollable ? ScrollView : View;
  const refreshControl = scrollable && onRefresh
    ? (
      <RefreshControl
        refreshing={!!refreshing}
        onRefresh={() => { void onRefresh(); }}
        tintColor={t.colors.primary}
        colors={[t.colors.primary]}
      />
    )
    : undefined;
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader {...header} />
      <Body
        style={{ flex: 1 }}
        contentContainerStyle={scrollable ? [{ padding: t.spacing.lg, gap: t.spacing.md }, contentStyle] : undefined}
        {...(scrollable ? { refreshControl } : {})}
      >
        {!scrollable ? (
          <View style={[{ flex: 1, padding: t.spacing.lg, gap: t.spacing.md }, contentStyle]}>{children}</View>
        ) : children}
      </Body>
    </View>
  );
}
