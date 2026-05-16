export interface TierConfig {
  id: string;
  name: string;
  threshold: number;
  multiplier: number;
  perks?: string[];
}

export interface StampCardConfig {
  id: string;
  name: string;
  required: number;
  itemIds?: number[];
  categoryIds?: number[];
  rewardType: "free_item" | "coupon" | "points";
  rewardValue: number | string;
  rewardLabel?: string;
}

export interface CashbackConfig {
  enabled: boolean;
  percent: number;
  minOrderAmount: number;
  maxRedeemPercent: number;
  minRedeemAmount: number;
  expiryDays: number;
}

export interface ReferralConfig {
  enabled: boolean;
  rewardType: "points" | "cashback" | "coupon";
  referrerReward: number;
  refereeReward: number;
  minFirstOrder: number;
}

export interface MysteryRewardOption {
  key: string;
  label: string;
  weight: number;
  rewardType: "points" | "cashback" | "coupon" | "free_item";
  rewardValue: number | string;
}

export interface MysteryConfig {
  enabled: boolean;
  triggerKind: "order_count" | "order_chance" | "scratch";
  triggerValue: number;
  pool: MysteryRewardOption[];
}

export interface StreakConfig {
  enabled: boolean;
  windowKind: "day" | "week";
  targetStreak: number;
  rewardType: "points" | "cashback" | "coupon";
  rewardValue: number | string;
}

export interface MilestoneTier {
  key: string;
  threshold: number;
  rewardType: "points" | "cashback" | "coupon";
  rewardValue: number | string;
}

export interface MilestoneConfig {
  enabled: boolean;
  windowDays: number;
  tiers: MilestoneTier[];
}

export interface BirthdayConfig {
  enabled: boolean;
  windowDays: number;
  rewardType: "points" | "cashback" | "coupon";
  rewardValue: number | string;
  notify: boolean;
}

export interface DoublePointsRule {
  id: string;
  label: string;
  multiplier: number;
  daysOfWeek?: number[];
  startDate?: string;
  endDate?: string;
  startHour?: number;
  endHour?: number;
  outletIds?: number[];
  orderTypes?: string[];
}

export interface DoublePointsConfig {
  enabled: boolean;
  rules: DoublePointsRule[];
}

export interface ItemRule {
  id: string;
  scope: "item" | "category";
  refId: number;
  multiplier?: number;
  bonusPoints?: number;
  earnsStampCardId?: string;
}

export interface ItemRulesConfig {
  enabled: boolean;
  rules: ItemRule[];
}

export interface FamilyConfig {
  enabled: boolean;
  maxMembers: number;
  shareCashback: boolean;
  sharePoints: boolean;
}

export interface TierRulesConfig {
  basis: "lifetime_points" | "lifetime_spend" | "rolling_visits";
  windowDays: number;
  graceDays: number;
}

export interface Loyalty2Config {
  enabled: boolean;
  pointsPerCurrencyUnit: number;
  redemptionRate: number;
  signupBonus: number;
  expiryMonths: number;

  tiers: TierConfig[];
  tierRules: TierRulesConfig;

  stampCards: StampCardConfig[];
  cashback: CashbackConfig;
  referral: ReferralConfig;
  mystery: MysteryConfig;
  streak: StreakConfig;
  milestones: MilestoneConfig;
  birthday: BirthdayConfig;
  doublePoints: DoublePointsConfig;
  itemRules: ItemRulesConfig;
  family: FamilyConfig;

  featureFlags: Partial<Record<MechanicKey, boolean>>;
}

export type MechanicKey =
  | "points" | "stamps" | "cashback" | "tiers"
  | "referral" | "mystery" | "streak" | "milestones"
  | "birthday" | "doublePoints" | "itemRules" | "family";

export const DEFAULT_LOYALTY2: Loyalty2Config = {
  enabled: false,
  pointsPerCurrencyUnit: 1,
  redemptionRate: 0.05,
  signupBonus: 0,
  expiryMonths: 0,
  tiers: [
    { id: "bronze", name: "Bronze", threshold: 0, multiplier: 1, perks: [] },
    { id: "silver", name: "Silver", threshold: 1000, multiplier: 1.25, perks: ["Priority support"] },
    { id: "gold", name: "Gold", threshold: 5000, multiplier: 1.5, perks: ["Free delivery", "Birthday surprise"] },
  ],
  tierRules: { basis: "lifetime_points", windowDays: 365, graceDays: 30 },
  stampCards: [],
  cashback: { enabled: false, percent: 0, minOrderAmount: 0, maxRedeemPercent: 50, minRedeemAmount: 0, expiryDays: 90 },
  referral: { enabled: false, rewardType: "points", referrerReward: 200, refereeReward: 100, minFirstOrder: 0 },
  mystery: { enabled: false, triggerKind: "order_count", triggerValue: 5, pool: [] },
  streak: { enabled: false, windowKind: "day", targetStreak: 5, rewardType: "points", rewardValue: 100 },
  milestones: { enabled: false, windowDays: 0, tiers: [] },
  birthday: { enabled: false, windowDays: 7, rewardType: "points", rewardValue: 100, notify: true },
  doublePoints: { enabled: false, rules: [] },
  itemRules: { enabled: false, rules: [] },
  family: { enabled: false, maxMembers: 5, shareCashback: true, sharePoints: true },
  featureFlags: {},
};
