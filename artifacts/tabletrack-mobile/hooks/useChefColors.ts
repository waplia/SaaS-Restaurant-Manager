import { kitchenPalette, radius } from "@/theme/tokens";

/**
 * Returns the dark "kitchen mode" palette used exclusively by the chef
 * (`app/(chef)/*`) screens. We don't follow the system colour scheme here —
 * a hot-line tablet always wants the same high-contrast amber-on-black look
 * regardless of what the device thinks the time of day is.
 *
 * Shape mirrors `useColors()` so the same components can fall back to
 * either hook by accepting `ColorTokens`.
 */
export function useChefColors() {
  return { ...kitchenPalette, radius };
}

export type ChefColors = ReturnType<typeof useChefColors>;
