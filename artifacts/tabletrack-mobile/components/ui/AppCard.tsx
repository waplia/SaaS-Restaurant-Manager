import React from "react";
import {
  View,
  Pressable,
  type ViewStyle,
  type PressableProps,
} from "react-native";
import { useTheme, type ShadowLevel } from "@/theme";

export interface AppCardProps {
  children: React.ReactNode;
  /** Internal padding. Default 16. */
  padding?: number;
  /** Border radius. Default 16. */
  radius?: number;
  /** Shadow / elevation level. Default "sm". */
  shadow?: ShadowLevel;
  /** Override background color. Defaults to theme `card`. */
  background?: string;
  /** Add a hairline border in addition to the shadow. Default true. */
  bordered?: boolean;
  style?: ViewStyle;
  /** When provided, the card becomes pressable. */
  onPress?: PressableProps["onPress"];
}

/**
 * Standard card surface: rounded corners, platform-aware shadow/elevation,
 * and (optionally) a subtle hairline border for crispness on Android.
 */
export function AppCard({
  children,
  padding = 16,
  radius = 16,
  shadow = "sm",
  background,
  bordered = true,
  style,
  onPress,
}: AppCardProps) {
  const t = useTheme();
  const baseStyle: ViewStyle = {
    backgroundColor: background ?? t.colors.card,
    borderRadius: radius,
    padding,
    ...t.shadow(shadow),
  };
  // shadow() already adds a border on Android. Only add one on iOS when asked.
  if (bordered && !("borderWidth" in baseStyle)) {
    Object.assign(baseStyle, { borderWidth: 1, borderColor: t.colors.border });
  }

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [baseStyle, { opacity: pressed ? 0.92 : 1 }, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[baseStyle, style]}>{children}</View>;
}
