import { useColorScheme } from "react-native";
import {
  palette,
  spacing,
  radius,
  typography,
  fontFamily,
  shadow,
  minTouch,
  type ColorScheme,
  type ColorTokens,
  type ShadowLevel,
} from "./tokens";

export interface Theme {
  scheme: ColorScheme;
  colors: ColorTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  fontFamily: typeof fontFamily;
  minTouch: number;
  shadow: (level: ShadowLevel) => ReturnType<typeof shadow>;
}

/**
 * Resolve the active theme. We currently lock the app to the light
 * palette on every device so iOS and Android look identical regardless
 * of the system appearance setting. When a real in-app theme toggle
 * lands, switch this back to `useColorScheme()` (still imported so
 * future re-enablement is a one-line change).
 */
export function useTheme(): Theme {
  void useColorScheme();
  const scheme: ColorScheme = "light";
  const colors = palette[scheme];
  return {
    scheme,
    colors,
    spacing,
    radius,
    typography,
    fontFamily,
    minTouch,
    shadow: (level: ShadowLevel) => shadow(level, colors),
  };
}
