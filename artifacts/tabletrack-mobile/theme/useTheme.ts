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

/** Resolve the active theme based on the device's appearance setting. */
export function useTheme(): Theme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
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
