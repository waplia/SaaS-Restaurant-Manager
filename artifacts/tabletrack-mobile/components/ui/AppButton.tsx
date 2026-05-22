import React from "react";
import {
  Pressable,
  View,
  ActivityIndicator,
  StyleSheet,
  type PressableProps,
  type ViewStyle,
} from "react-native";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";
import { AppIcon, type AppIconName } from "./AppIcon";

export type AppButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "outline";
export type AppButtonSize = "sm" | "md" | "lg";

export interface AppButtonProps extends Omit<PressableProps, "style" | "children"> {
  label: string;
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: AppIconName;
  rightIcon?: AppIconName;
  fullWidth?: boolean;
  style?: ViewStyle;
}

const HEIGHT: Record<AppButtonSize, number> = { sm: 40, md: 48, lg: 54 };
const FONT: Record<AppButtonSize, "body" | "bodyMd" | "h3"> = {
  sm: "bodyMd",
  md: "bodyMd",
  lg: "h3",
};
const PADDING: Record<AppButtonSize, number> = { sm: 14, md: 18, lg: 22 };

export function AppButton({
  label,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  style,
  ...rest
}: AppButtonProps) {
  const t = useTheme();
  const isDisabled = disabled || loading;

  const colorsForVariant = (): { bg: string; fg: string; border?: string } => {
    switch (variant) {
      case "primary":
        return { bg: t.colors.primary, fg: t.colors.primaryForeground };
      case "destructive":
        return { bg: t.colors.destructive, fg: t.colors.destructiveForeground };
      case "secondary":
        return { bg: t.colors.secondary, fg: t.colors.foreground };
      case "outline":
        return { bg: "transparent", fg: t.colors.foreground, border: t.colors.borderStrong };
      case "ghost":
      default:
        return { bg: "transparent", fg: t.colors.foreground };
    }
  };
  const c = colorsForVariant();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      android_ripple={variant === "ghost" || variant === "outline"
        ? { color: t.colors.muted, borderless: false }
        : { color: "rgba(255,255,255,0.18)" }}
      {...rest}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: PADDING[size],
          backgroundColor: c.bg,
          borderRadius: 14,
          borderWidth: c.border ? 1 : 0,
          borderColor: c.border,
          opacity: isDisabled ? 0.5 : pressed ? 0.9 : 1,
          alignSelf: fullWidth ? "stretch" : "flex-start",
        },
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={c.fg} size="small" />
        ) : (
          <>
            {leftIcon ? <AppIcon name={leftIcon} size={size === "sm" ? 16 : 18} color={c.fg} /> : null}
            <AppText variant={FONT[size]} weight="semibold" style={{ color: c.fg }} numberOfLines={1}>
              {label}
            </AppText>
            {rightIcon ? <AppIcon name={rightIcon} size={size === "sm" ? 16 : 18} color={c.fg} /> : null}
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
});
