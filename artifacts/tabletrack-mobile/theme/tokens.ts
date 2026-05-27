import { Platform, type TextStyle, type ViewStyle } from "react-native";

/**
 * KhanaLagao mobile design tokens.
 *
 * Single source of truth for colors, typography, spacing, radius, and
 * platform-aware shadow/elevation helpers. All shared UI primitives in
 * `components/ui/*` consume these tokens. Legacy modules
 * (`constants/brand.ts`, `constants/colors.ts`) re-export from here so the
 * existing screens continue to compile while we migrate.
 */

type Palette = {
  text: string; tint: string; background: string; foreground: string;
  card: string; cardForeground: string; surface: string; surfaceAlt: string;
  primary: string; primaryDeep: string; primaryForeground: string;
  secondary: string; secondaryForeground: string;
  muted: string; mutedForeground: string;
  accent: string; accentForeground: string;
  destructive: string; destructiveForeground: string;
  border: string; borderStrong: string; input: string;
  success: string; successSoft: string;
  warning: string; warningSoft: string;
  info: string; infoSoft: string;
  ai: string; aiSoft: string;
  overlay: string;
};

/**
 * Dark "kitchen mode" palette used by the chef/kitchen role group only.
 * Amber accent over near-black surfaces optimised for a hot-line tablet:
 * high contrast, glanceable timer badges, color-coded ticket borders.
 */
export const kitchenPalette: Palette = {
  text: "#fafaf9",
  tint: "#fbbf24",
  background: "#0a0908",
  foreground: "#fafaf9",
  card: "#1a1714",
  cardForeground: "#fafaf9",
  surface: "#13110f",
  surfaceAlt: "#231f1c",
  primary: "#f59e0b",
  primaryDeep: "#b45309",
  primaryForeground: "#0a0908",
  secondary: "#2a2520",
  secondaryForeground: "#fafaf9",
  muted: "#1f1c19",
  mutedForeground: "#a8a29e",
  accent: "#3f2d11",
  accentForeground: "#fcd34d",
  destructive: "#f87171",
  destructiveForeground: "#fafaf9",
  border: "#2f2a25",
  borderStrong: "#44382e",
  input: "#2a2520",
  success: "#34d399",
  successSoft: "#064e3b",
  warning: "#fbbf24",
  warningSoft: "#7c2d12",
  info: "#60a5fa",
  infoSoft: "#1e3a8a",
  ai: "#a78bfa",
  aiSoft: "#3b2470",
  overlay: "rgba(0,0,0,0.75)",
};

export const palette: { light: Palette; dark: Palette } = {
  light: {
    text: "#251e1a",
    tint: "#f97316",
    background: "#ffffff",
    foreground: "#251e1a",
    card: "#ffffff",
    cardForeground: "#251e1a",
    surface: "#fbfaf8",
    surfaceAlt: "#f5f3f2",
    primary: "#f97316",
    primaryDeep: "#E85A0C",
    primaryForeground: "#ffffff",
    secondary: "#f0eae8",
    secondaryForeground: "#251e1a",
    muted: "#f5f3f2",
    mutedForeground: "#786e69",
    accent: "#fff3e8",
    accentForeground: "#9a4200",
    destructive: "#ef4444",
    destructiveForeground: "#ffffff",
    border: "#e8e3e0",
    borderStrong: "#d8d2cd",
    input: "#e0dbd8",
    success: "#22c55e",
    successSoft: "#dcfce7",
    warning: "#f59e0b",
    warningSoft: "#fef3c7",
    info: "#3b82f6",
    infoSoft: "#dbeafe",
    ai: "#7C3AED",
    aiSoft: "#ede9fe",
    overlay: "rgba(0,0,0,0.45)",
  },
  dark: {
    text: "#faf6f4",
    tint: "#f97316",
    background: "#0f0d0c",
    foreground: "#faf6f4",
    card: "#1c1815",
    cardForeground: "#faf6f4",
    surface: "#16120f",
    surfaceAlt: "#211d1a",
    primary: "#f97316",
    primaryDeep: "#E85A0C",
    primaryForeground: "#ffffff",
    secondary: "#2a2421",
    secondaryForeground: "#faf6f4",
    muted: "#211d1a",
    mutedForeground: "#9c918b",
    accent: "#3d2210",
    accentForeground: "#fdba74",
    destructive: "#f04545",
    destructiveForeground: "#ffffff",
    border: "#2d2623",
    borderStrong: "#3d3531",
    input: "#352e2a",
    success: "#22c55e",
    successSoft: "#14532d",
    warning: "#f59e0b",
    warningSoft: "#78350f",
    info: "#60a5fa",
    infoSoft: "#1e3a8a",
    ai: "#a78bfa",
    aiSoft: "#3b2470",
    overlay: "rgba(0,0,0,0.65)",
  },
} as const;

export type ColorScheme = "light" | "dark";
export type ColorTokens = typeof palette.light;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 56,
} as const;

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  pill: 999,
} as const;

export const fontFamily = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

export type TypographyVariant =
  | "hero"
  | "title"
  | "h2"
  | "h3"
  | "body"
  | "bodyMd"
  | "small"
  | "micro"
  | "label";

export const typography: Record<TypographyVariant, TextStyle> = {
  hero: { fontSize: 28, lineHeight: 34, fontFamily: fontFamily.bold, letterSpacing: -0.5 },
  title: { fontSize: 22, lineHeight: 28, fontFamily: fontFamily.bold, letterSpacing: -0.3 },
  h2: { fontSize: 18, lineHeight: 24, fontFamily: fontFamily.semibold, letterSpacing: -0.2 },
  h3: { fontSize: 16, lineHeight: 22, fontFamily: fontFamily.semibold },
  body: { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.regular },
  bodyMd: { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.medium },
  small: { fontSize: 12, lineHeight: 16, fontFamily: fontFamily.medium },
  micro: { fontSize: 11, lineHeight: 14, fontFamily: fontFamily.medium },
  label: { fontSize: 12, lineHeight: 16, fontFamily: fontFamily.semibold, letterSpacing: 0.2 },
};

export type FontWeight =
  | "regular"
  | "medium"
  | "semibold"
  | "bold";

export function fontFor(weight: FontWeight | undefined): string | undefined {
  if (!weight) return undefined;
  return fontFamily[weight];
}

/**
 * Platform-aware shadow helper.
 *
 * iOS gets a soft drop shadow; Android gets a real `elevation` plus a
 * subtle 1px border so cards look premium without harsh dark halos.
 */
export type ShadowLevel = "none" | "xs" | "sm" | "md" | "lg";

export function shadow(level: ShadowLevel, tokens: ColorTokens): ViewStyle {
  if (level === "none") return {};
  if (Platform.OS === "ios") {
    const map: Record<Exclude<ShadowLevel, "none">, ViewStyle> = {
      xs: { shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
      sm: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      md: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
      lg: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
    };
    return map[level];
  }
  // Android: real elevation + soft 1px border for a clean material feel.
  const elevationMap: Record<Exclude<ShadowLevel, "none">, number> = {
    xs: 1,
    sm: 2,
    md: 4,
    lg: 8,
  };
  return {
    elevation: elevationMap[level],
    borderWidth: 1,
    borderColor: tokens.border,
  };
}

/** Minimum touch target per platform HIG (iOS 44, Material 48). */
export const minTouch = 48;
