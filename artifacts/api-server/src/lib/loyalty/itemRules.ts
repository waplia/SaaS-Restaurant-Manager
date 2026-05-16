import { eq, inArray } from "drizzle-orm";
import { db, orderItemsTable, menuItemsTable } from "../db";
import type { ItemRulesConfig } from "./types";

export interface ItemBonusResult {
  bonusPoints: number;
  itemMultiplierAdj: number;
  stampCardEarns: Map<string, number>;
}

export async function computeItemBonuses(args: {
  restaurantId: number; orderId: number; pointsPerCurrencyUnit: number; cfg: ItemRulesConfig;
}): Promise<ItemBonusResult> {
  if (!args.cfg.enabled || args.cfg.rules.length === 0) {
    return { bonusPoints: 0, itemMultiplierAdj: 0, stampCardEarns: new Map() };
  }
  const items = await db.select({
    menuItemId: orderItemsTable.menuItemId,
    qty: orderItemsTable.quantity,
    totalPrice: orderItemsTable.totalPrice,
    categoryId: menuItemsTable.categoryId,
  })
    .from(orderItemsTable)
    .leftJoin(menuItemsTable, eq(menuItemsTable.id, orderItemsTable.menuItemId))
    .where(eq(orderItemsTable.orderId, args.orderId));

  let bonusPoints = 0;
  let multiplierExtra = 0;
  const stampCardEarns = new Map<string, number>();
  for (const it of items) {
    for (const rule of args.cfg.rules) {
      const matchesItem = rule.scope === "item" && rule.refId === it.menuItemId;
      const matchesCat = rule.scope === "category" && it.categoryId === rule.refId;
      if (!matchesItem && !matchesCat) continue;
      if (rule.bonusPoints && rule.bonusPoints > 0) bonusPoints += rule.bonusPoints * it.qty;
      if (rule.multiplier && rule.multiplier > 1) {
        const lineEarn = Number(it.totalPrice) * args.pointsPerCurrencyUnit;
        multiplierExtra += lineEarn * (rule.multiplier - 1);
      }
      if (rule.earnsStampCardId) {
        stampCardEarns.set(rule.earnsStampCardId, (stampCardEarns.get(rule.earnsStampCardId) ?? 0) + it.qty);
      }
    }
  }
  return {
    bonusPoints: Math.floor(bonusPoints + multiplierExtra),
    itemMultiplierAdj: 0,
    stampCardEarns,
  };
}
