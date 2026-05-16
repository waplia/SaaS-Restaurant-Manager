import type { DoublePointsConfig, DoublePointsRule } from "./types";

export function activeDoublePointsMultiplier(args: {
  cfg: DoublePointsConfig; at?: Date; outletId?: number | null; orderType?: string | null;
}): { multiplier: number; rule: DoublePointsRule | null } {
  if (!args.cfg.enabled || args.cfg.rules.length === 0) return { multiplier: 1, rule: null };
  const now = args.at ?? new Date();
  let best: { multiplier: number; rule: DoublePointsRule } | null = null;
  for (const rule of args.cfg.rules) {
    if (rule.daysOfWeek && rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(now.getDay())) continue;
    if (rule.startDate && now < new Date(rule.startDate)) continue;
    if (rule.endDate && now > new Date(rule.endDate)) continue;
    if (rule.startHour != null && now.getHours() < rule.startHour) continue;
    if (rule.endHour != null && now.getHours() >= rule.endHour) continue;
    if (rule.outletIds && rule.outletIds.length > 0 && (args.outletId == null || !rule.outletIds.includes(args.outletId))) continue;
    if (rule.orderTypes && rule.orderTypes.length > 0 && args.orderType && !rule.orderTypes.includes(args.orderType)) continue;
    const m = Math.max(1, rule.multiplier ?? 1);
    if (!best || m > best.multiplier) best = { multiplier: m, rule };
  }
  return best ? { multiplier: best.multiplier, rule: best.rule } : { multiplier: 1, rule: null };
}
