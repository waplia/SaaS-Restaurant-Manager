import React from "react";
import { Text, type TextProps, type TextStyle } from "react-native";
import { useTheme, type FontWeight } from "@/theme";
import type { TypographyVariant } from "@/theme/tokens";

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  /** Color token name (e.g. "foreground", "mutedForeground", "primary") or any hex string. */
  color?: string;
  weight?: FontWeight;
  align?: TextStyle["textAlign"];
}

/**
 * Single text primitive. Always applies the global Inter font so no screen
 * can fall back to the platform default. Pick a `variant` from the typography
 * scale and (optionally) override `color` / `weight` / `align`.
 */
export function AppText({
  variant = "body",
  color,
  weight,
  align,
  style,
  children,
  ...rest
}: AppTextProps) {
  const t = useTheme();
  const base = t.typography[variant];
  const resolvedColor =
    !color ? t.colors.foreground
    : (t.colors as unknown as Record<string, string | undefined>)[color] ?? color;
  const fontOverride = weight ? { fontFamily: t.fontFamily[weight] } : null;

  return (
    <Text
      allowFontScaling
      {...rest}
      style={[
        base,
        { color: resolvedColor },
        align ? { textAlign: align } : null,
        fontOverride,
        style,
      ]}
    >
      {children}
    </Text>
  );
}
