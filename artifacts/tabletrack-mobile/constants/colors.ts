import { palette } from "@/theme/tokens";

/**
 * Legacy colors export. Prefer `useTheme()` from `@/theme` in new code.
 * The shape below matches what `hooks/useColors.ts` expects so existing
 * screens keep working unchanged.
 */
const colors = {
  light: palette.light,
  dark: palette.dark,
  radius: 8,
};

export default colors;
