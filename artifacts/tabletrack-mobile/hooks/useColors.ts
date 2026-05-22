import { useColorScheme } from "react-native";

import colors from "@/constants/colors";

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 *
 * Falls back to the light palette when no dark key is defined in
 * constants/colors.ts (the scaffold ships light-only by default).
 * When a sibling web artifact's dark tokens are synced into a `dark`
 * key, this hook will automatically switch palettes based on the
 * device's appearance setting.
 */
export function useColors() {
  // App-wide theme is locked to light so iOS and Android look the same
  // regardless of the device's system appearance setting. Keep the
  // useColorScheme() call (no-op) so future re-enablement of system
  // theming is a one-line change.
  void useColorScheme();
  return { ...colors.light, radius: colors.radius };
}
