import { palette, typography } from "@/theme/tokens";

/**
 * Legacy brand tokens. Prefer importing from `@/theme` directly in new code.
 * Kept as thin re-exports so existing screens compile while we migrate.
 */
export const BRAND = {
  primary: palette.light.primary,
  primaryDeep: palette.light.primaryDeep,
  charcoal: "#111827",
  warmWhite: "#FFF8F1",
  ai: palette.light.ai,
  success: palette.light.success,
  warning: palette.light.warning,
  danger: palette.light.destructive,
  info: palette.light.info,
};

export const TYPE = {
  hero: typography.hero,
  title: typography.title,
  h2: typography.h2,
  body: typography.body,
  bodyMd: typography.bodyMd,
  small: typography.small,
  micro: typography.micro,
};
