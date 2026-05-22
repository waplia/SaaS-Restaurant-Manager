import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/theme";

export type AppIconName = keyof typeof Ionicons.glyphMap;

export interface AppIconProps {
  name: AppIconName;
  size?: number;
  /** Theme token key or hex string. Defaults to `foreground`. */
  color?: string;
}

/**
 * Single icon primitive. The app standardizes on `@expo/vector-icons`
 * Ionicons (already the most-used set across the codebase). Mixing other
 * icon libraries in screens is disallowed — extend this primitive instead.
 */
export function AppIcon({ name, size = 20, color }: AppIconProps) {
  const t = useTheme();
  const resolved =
    !color ? t.colors.foreground
    : (t.colors as unknown as Record<string, string | undefined>)[color] ?? color;
  return <Ionicons name={name} size={size} color={resolved} />;
}
