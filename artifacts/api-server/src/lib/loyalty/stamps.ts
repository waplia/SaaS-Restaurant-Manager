import { eq, and, sql } from "drizzle-orm";
import { db, loyaltyStampCardsTable, orderItemsTable, menuItemsTable } from "../db";
import type { StampCardConfig } from "./types";

export interface StampCompletion {
  cardId: string;
  cardName: string;
  rewardType: StampCardConfig["rewardType"];
  rewardValue: number | string;
  rewardLabel?: string;
}

export async function awardStampsForOrder(args: {
  restaurantId: number; customerId: number; orderId: number;
  cards: StampCardConfig[];
}): Promise<StampCompletion[]> {
  if (args.cards.length === 0) return [];

  const items = await db.select({
    menuItemId: orderItemsTable.menuItemId,
    qty: orderItemsTable.quantity,
    categoryId: menuItemsTable.categoryId,
  })
    .from(orderItemsTable)
    .leftJoin(menuItemsTable, eq(menuItemsTable.id, orderItemsTable.menuItemId))
    .where(eq(orderItemsTable.orderId, args.orderId));

  const completions: StampCompletion[] = [];

  for (const card of args.cards) {
    let qualifyingQty = 0;
    for (const it of items) {
      const matchesItem = card.itemIds && card.itemIds.length > 0 && card.itemIds.includes(it.menuItemId);
      const matchesCat = card.categoryIds && card.categoryIds.length > 0 && it.categoryId != null && card.categoryIds.includes(it.categoryId);
      const broadCard = (!card.itemIds || card.itemIds.length === 0) && (!card.categoryIds || card.categoryIds.length === 0);
      if (matchesItem || matchesCat || broadCard) qualifyingQty += it.qty;
    }
    if (qualifyingQty <= 0) continue;

    const [existing] = await db.select().from(loyaltyStampCardsTable).where(and(
      eq(loyaltyStampCardsTable.restaurantId, args.restaurantId),
      eq(loyaltyStampCardsTable.customerId, args.customerId),
      eq(loyaltyStampCardsTable.cardKey, card.id),
    ));

    let stamps = (existing?.stamps ?? 0) + qualifyingQty;
    let completionsAdded = 0;
    while (card.required > 0 && stamps >= card.required) {
      stamps -= card.required;
      completionsAdded += 1;
    }

    if (existing) {
      await db.update(loyaltyStampCardsTable).set({
        stamps, completions: existing.completions + completionsAdded,
        lastStampedAt: new Date(), updatedAt: new Date(),
      }).where(eq(loyaltyStampCardsTable.id, existing.id));
    } else {
      await db.insert(loyaltyStampCardsTable).values({
        restaurantId: args.restaurantId, customerId: args.customerId,
        cardKey: card.id, stamps, completions: completionsAdded,
        lastStampedAt: new Date(),
      });
    }

    for (let i = 0; i < completionsAdded; i++) {
      completions.push({
        cardId: card.id, cardName: card.name,
        rewardType: card.rewardType, rewardValue: card.rewardValue,
        rewardLabel: card.rewardLabel,
      });
    }
  }
  return completions;
}

export async function manualAddStamp(restaurantId: number, customerId: number, cardKey: string, qty = 1) {
  const [existing] = await db.select().from(loyaltyStampCardsTable).where(and(
    eq(loyaltyStampCardsTable.restaurantId, restaurantId),
    eq(loyaltyStampCardsTable.customerId, customerId),
    eq(loyaltyStampCardsTable.cardKey, cardKey),
  ));
  if (existing) {
    await db.update(loyaltyStampCardsTable).set({
      stamps: existing.stamps + qty, lastStampedAt: new Date(), updatedAt: new Date(),
    }).where(eq(loyaltyStampCardsTable.id, existing.id));
  } else {
    await db.insert(loyaltyStampCardsTable).values({
      restaurantId, customerId, cardKey, stamps: qty, lastStampedAt: new Date(),
    });
  }
}

export async function listStampCards(restaurantId: number, customerId: number) {
  return db.select().from(loyaltyStampCardsTable).where(and(
    eq(loyaltyStampCardsTable.restaurantId, restaurantId),
    eq(loyaltyStampCardsTable.customerId, customerId),
  ));
}
