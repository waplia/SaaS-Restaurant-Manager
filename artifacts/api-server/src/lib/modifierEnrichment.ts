import { and, eq, inArray } from "drizzle-orm";
import { db, modifierGroupsTable, modifiersTable, modifierInventoryMappingsTable, inventoryItemsTable, inventoryTransactionsTable, notificationsTable } from "./db";

export type ModifierSelectionInput =
  | { modifierId: number; quantity?: number }
  | { id: number; quantity?: number }
  | { name: string; price: string | number; quantity?: number; modifierId?: number };

export interface EnrichedModifier {
  modifierId: number | null;
  modifierGroupId: number | null;
  name: string;
  groupName: string | null;
  price: number;
  quantity: number;
}

/**
 * Validate and snapshot a customer's modifier selections for a single line item.
 * - Loads the configured groups for the menu item.
 * - Verifies isRequired / min / max for every group bound to that item.
 * - Verifies every option belongs to one of that item's groups and is available.
 * - Returns canonical name + price (snapshot) so a later price change in the
 *   catalogue doesn't retroactively re-price a historical order line.
 */
export async function enrichModifierSelections(
  menuItemId: number,
  selections: ModifierSelectionInput[],
): Promise<{ ok: true; modifiers: EnrichedModifier[] } | { ok: false; error: string }> {
  const groups = await db.select().from(modifierGroupsTable)
    .where(and(eq(modifierGroupsTable.menuItemId, menuItemId), eq(modifierGroupsTable.isActive, true)));
  const groupById = new Map(groups.map(g => [g.id, g] as const));

  const requestedIds: number[] = [];
  for (const sel of selections ?? []) {
    const id =
      "modifierId" in sel && typeof sel.modifierId === "number"
        ? sel.modifierId
        : "id" in sel && typeof sel.id === "number"
          ? sel.id
          : null;
    if (id != null) requestedIds.push(id);
  }

  // Resolve every requested modifier from DB to enforce ownership + price.
  const dbMods = requestedIds.length > 0
    ? await db.select().from(modifiersTable).where(inArray(modifiersTable.id, requestedIds))
    : [];
  const modById = new Map(dbMods.map(m => [m.id, m] as const));

  const enriched: EnrichedModifier[] = [];
  const countByGroup = new Map<number, number>();

  for (const sel of selections ?? []) {
    const reqId =
      "modifierId" in sel && typeof sel.modifierId === "number"
        ? sel.modifierId
        : "id" in sel && typeof sel.id === "number"
          ? sel.id
          : null;
    const qty = Math.max(1, Math.floor(Number((sel as { quantity?: number }).quantity ?? 1)));

    if (reqId != null) {
      const mod = modById.get(reqId);
      if (!mod) return { ok: false, error: `Modifier ${reqId} not found` };
      if (!mod.isAvailable) return { ok: false, error: `Modifier "${mod.name}" is unavailable` };
      const group = groupById.get(mod.groupId);
      if (!group) return { ok: false, error: `Modifier "${mod.name}" does not belong to this menu item` };
      enriched.push({
        modifierId: mod.id,
        modifierGroupId: group.id,
        name: mod.name,
        groupName: group.displayName ?? group.name,
        price: Number(mod.price),
        quantity: qty,
      });
      countByGroup.set(group.id, (countByGroup.get(group.id) ?? 0) + 1);
    } else if ("name" in sel && sel.name) {
      // Legacy free-form pick (no id) — snapshot what the caller sent but tag
      // it as ungrouped. Server cannot validate group constraints for these.
      enriched.push({
        modifierId: null,
        modifierGroupId: null,
        name: String(sel.name),
        groupName: null,
        price: Number((sel as { price: string | number }).price ?? 0),
        quantity: qty,
      });
    }
  }

  // Enforce required + min/max per configured group bound to this item.
  for (const group of groups) {
    const count = countByGroup.get(group.id) ?? 0;
    const min = group.minSelections ?? 0;
    const max = group.maxSelections ?? 0;
    if (group.isRequired && count < Math.max(1, min)) {
      return { ok: false, error: `${group.displayName ?? group.name} is required` };
    }
    if (count > 0 && min > 0 && count < min) {
      return { ok: false, error: `${group.displayName ?? group.name} requires at least ${min} option(s)` };
    }
    if (max > 0 && count > max) {
      return { ok: false, error: `${group.displayName ?? group.name} allows at most ${max} option(s)` };
    }
  }

  return { ok: true, modifiers: enriched };
}

/**
 * Deduct inventory for modifier options selected on a single order line.
 * Mirrors the menu-item deduction path but driven by modifier_inventory_mappings.
 */
export async function deductInventoryForModifiers(
  restaurantId: number,
  orderId: number,
  perLine: Array<{ modifiers: Array<{ modifierId: number | null; quantity: number }>; lineQty: number }>,
): Promise<void> {
  const allModIds = perLine.flatMap(l => l.modifiers.map(m => m.modifierId).filter((x): x is number => x != null));
  if (allModIds.length === 0) return;

  const mappings = await db.select().from(modifierInventoryMappingsTable)
    .where(and(eq(modifierInventoryMappingsTable.restaurantId, restaurantId), inArray(modifierInventoryMappingsTable.modifierId, allModIds)));
  if (mappings.length === 0) return;
  const byModifier = new Map<number, typeof mappings>();
  for (const m of mappings) {
    const arr = byModifier.get(m.modifierId) ?? [];
    arr.push(m);
    byModifier.set(m.modifierId, arr);
  }

  for (const line of perLine) {
    for (const mod of line.modifiers) {
      if (mod.modifierId == null) continue;
      const maps = byModifier.get(mod.modifierId);
      if (!maps) continue;
      for (const map of maps) {
        const totalDeduct = Number(map.quantity) * mod.quantity * line.lineQty;
        if (!Number.isFinite(totalDeduct) || totalDeduct <= 0) continue;
        const updated = await db.transaction(async (tx) => {
          const [inv] = await tx.select().from(inventoryItemsTable).where(
            and(eq(inventoryItemsTable.id, map.inventoryItemId), eq(inventoryItemsTable.restaurantId, restaurantId))
          ).for("update");
          if (!inv) return null;
          const newStock = Math.max(0, Number(inv.currentStock) - totalDeduct);
          await tx.update(inventoryItemsTable)
            .set({ currentStock: newStock.toFixed(3), updatedAt: new Date() })
            .where(eq(inventoryItemsTable.id, inv.id));
          await tx.insert(inventoryTransactionsTable).values({
            itemId: inv.id,
            restaurantId,
            type: "use",
            quantity: totalDeduct.toFixed(3),
            notes: `Auto-deducted (modifier) for order #${orderId}`,
            referenceId: orderId,
            referenceType: "order",
          });
          return { inv, newStock };
        });
        if (updated && updated.newStock <= Number(updated.inv.minStockLevel)) {
          await db.insert(notificationsTable).values({
            restaurantId,
            type: "low_stock",
            title: "Low Stock Alert",
            message: `${updated.inv.name} is running low (${updated.newStock.toFixed(1)} ${updated.inv.unit} remaining, min: ${Number(updated.inv.minStockLevel).toFixed(1)} ${updated.inv.unit})`,
            entityId: updated.inv.id,
            entityType: "inventory_item",
          });
        }
      }
    }
  }
}
