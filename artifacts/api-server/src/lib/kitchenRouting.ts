import { eq, and, isNull, inArray } from "drizzle-orm";
import { db, kitchensTable, menuItemsTable, kitchenTicketsTable, orderItemsTable, restaurantsTable } from "./db";

export async function getDefaultKitchenId(restaurantId: number): Promise<number> {
  const existing = await db
    .select()
    .from(kitchensTable)
    .where(and(eq(kitchensTable.restaurantId, restaurantId), eq(kitchensTable.isDefault, true)));
  if (existing.length > 0) return existing[0].id;
  const anyExisting = await db
    .select()
    .from(kitchensTable)
    .where(eq(kitchensTable.restaurantId, restaurantId));
  if (anyExisting.length > 0) {
    await db.update(kitchensTable).set({ isDefault: true }).where(eq(kitchensTable.id, anyExisting[0].id));
    return anyExisting[0].id;
  }
  const [created] = await db.insert(kitchensTable).values({
    restaurantId,
    name: "Main Kitchen",
    isDefault: true,
    sortOrder: 0,
  }).returning();
  return created.id;
}

export async function resolveItemKitchenIds(
  restaurantId: number,
  menuItemIds: number[]
): Promise<Map<number, number>> {
  const defaultKitchenId = await getDefaultKitchenId(restaurantId);
  const map = new Map<number, number>();
  if (menuItemIds.length === 0) return map;
  const items = await db
    .select({ id: menuItemsTable.id, kitchenId: menuItemsTable.kitchenId })
    .from(menuItemsTable)
    .where(and(eq(menuItemsTable.restaurantId, restaurantId), inArray(menuItemsTable.id, menuItemIds)));
  for (const it of items) {
    map.set(it.id, it.kitchenId ?? defaultKitchenId);
  }
  return map;
}

/**
 * Group an order's items by kitchen and create one kitchen ticket per kitchen.
 * Items whose menu item has no kitchen assigned go to the restaurant's default kitchen.
 * Returns the ids of created tickets and their kitchen ids.
 */
export async function createKitchenTicketsForOrder(args: {
  orderId: number;
  restaurantId: number;
  isPriority: boolean;
}): Promise<Array<{ ticketId: number; kitchenId: number }>> {
  const { orderId, restaurantId, isPriority } = args;
  const defaultKitchenId = await getDefaultKitchenId(restaurantId);

  const orderItems = await db
    .select({ menuItemId: orderItemsTable.menuItemId })
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, orderId));

  const uniqueMenuItemIds = Array.from(new Set(orderItems.map(oi => oi.menuItemId)));
  const itemKitchenMap = await resolveItemKitchenIds(restaurantId, uniqueMenuItemIds);

  const kitchenIds = new Set<number>();
  for (const oi of orderItems) {
    kitchenIds.add(itemKitchenMap.get(oi.menuItemId) ?? defaultKitchenId);
  }
  if (kitchenIds.size === 0) {
    kitchenIds.add(defaultKitchenId);
  }

  const created: Array<{ ticketId: number; kitchenId: number }> = [];
  for (const kid of kitchenIds) {
    const [t] = await db.insert(kitchenTicketsTable).values({
      orderId,
      restaurantId,
      kitchenId: kid,
      isPriority,
    }).returning();
    created.push({ ticketId: t.id, kitchenId: kid });
  }
  return created;
}

/**
 * Ensure a kitchen ticket exists for the kitchen of the given menu item, for
 * items added to an existing order. Returns null if a ticket already exists.
 */
export async function ensureTicketForAddedItem(args: {
  orderId: number;
  restaurantId: number;
  menuItemId: number;
}): Promise<{ ticketId: number; kitchenId: number } | null> {
  const { orderId, restaurantId, menuItemId } = args;
  const map = await resolveItemKitchenIds(restaurantId, [menuItemId]);
  const kitchenId = map.get(menuItemId) ?? (await getDefaultKitchenId(restaurantId));
  const existing = await db
    .select({ id: kitchenTicketsTable.id })
    .from(kitchenTicketsTable)
    .where(
      and(
        eq(kitchenTicketsTable.orderId, orderId),
        eq(kitchenTicketsTable.kitchenId, kitchenId),
      ),
    );
  if (existing.length > 0) return null;
  const [t] = await db.insert(kitchenTicketsTable).values({
    orderId,
    restaurantId,
    kitchenId,
    isPriority: false,
  }).returning();
  return { ticketId: t.id, kitchenId };
}

/**
 * Backfill: ensure every restaurant has a default kitchen, and assign that
 * kitchen to any kitchen tickets that do not have one yet.
 */
export async function backfillDefaultKitchens(): Promise<void> {
  const restaurants = await db.select({ id: restaurantsTable.id }).from(restaurantsTable);
  for (const r of restaurants) {
    const kid = await getDefaultKitchenId(r.id);
    await db
      .update(kitchenTicketsTable)
      .set({ kitchenId: kid })
      .where(and(eq(kitchenTicketsTable.restaurantId, r.id), isNull(kitchenTicketsTable.kitchenId)));
  }
}
