import { eq, and } from "drizzle-orm";
import { db, restaurantSettingsTable } from "../db";
import type { Loyalty2Config, MechanicKey } from "./types";
import { DEFAULT_LOYALTY2 } from "./types";

export async function loadLoyalty2Config(restaurantId: number): Promise<Loyalty2Config> {
  const [row] = await db.select().from(restaurantSettingsTable)
    .where(and(eq(restaurantSettingsTable.restaurantId, restaurantId), eq(restaurantSettingsTable.section, "loyalty")));
  const data = (row?.data ?? {}) as Partial<Loyalty2Config>;
  return mergeWithDefaults(data);
}

export function mergeWithDefaults(data: Partial<Loyalty2Config>): Loyalty2Config {
  const out: Loyalty2Config = { ...DEFAULT_LOYALTY2, ...data } as Loyalty2Config;
  // Deep-merge known sub-objects so missing fields don't crash.
  out.tiers = Array.isArray(data.tiers) && data.tiers.length > 0 ? data.tiers : DEFAULT_LOYALTY2.tiers;
  out.tierRules = { ...DEFAULT_LOYALTY2.tierRules, ...(data.tierRules ?? {}) };
  out.stampCards = Array.isArray(data.stampCards) ? data.stampCards : [];
  out.cashback = { ...DEFAULT_LOYALTY2.cashback, ...(data.cashback ?? {}) };
  out.referral = { ...DEFAULT_LOYALTY2.referral, ...(data.referral ?? {}) };
  out.mystery = { ...DEFAULT_LOYALTY2.mystery, ...(data.mystery ?? {}), pool: data.mystery?.pool ?? [] };
  out.streak = { ...DEFAULT_LOYALTY2.streak, ...(data.streak ?? {}) };
  out.milestones = { ...DEFAULT_LOYALTY2.milestones, ...(data.milestones ?? {}), tiers: data.milestones?.tiers ?? [] };
  out.birthday = { ...DEFAULT_LOYALTY2.birthday, ...(data.birthday ?? {}) };
  out.doublePoints = { ...DEFAULT_LOYALTY2.doublePoints, ...(data.doublePoints ?? {}), rules: data.doublePoints?.rules ?? [] };
  out.itemRules = { ...DEFAULT_LOYALTY2.itemRules, ...(data.itemRules ?? {}), rules: data.itemRules?.rules ?? [] };
  out.family = { ...DEFAULT_LOYALTY2.family, ...(data.family ?? {}) };
  out.featureFlags = data.featureFlags ?? {};
  return out;
}

export function isEnabled(cfg: Loyalty2Config, key: MechanicKey): boolean {
  if (!cfg.enabled) return false;
  if (cfg.featureFlags[key] === false) return false;
  switch (key) {
    case "stamps":       return cfg.stampCards.length > 0;
    case "cashback":     return cfg.cashback.enabled;
    case "referral":     return cfg.referral.enabled;
    case "mystery":      return cfg.mystery.enabled && cfg.mystery.pool.length > 0;
    case "streak":       return cfg.streak.enabled;
    case "milestones":   return cfg.milestones.enabled && cfg.milestones.tiers.length > 0;
    case "birthday":     return cfg.birthday.enabled;
    case "doublePoints": return cfg.doublePoints.enabled && cfg.doublePoints.rules.length > 0;
    case "itemRules":    return cfg.itemRules.enabled && cfg.itemRules.rules.length > 0;
    case "family":       return cfg.family.enabled;
    case "tiers":        return cfg.tiers.length > 0;
    case "points":       return cfg.pointsPerCurrencyUnit > 0;
    default:             return true;
  }
}
