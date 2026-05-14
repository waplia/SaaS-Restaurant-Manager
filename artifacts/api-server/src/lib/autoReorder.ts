import { and, eq, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  inventoryItemsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  notificationsTable,
  restaurantsTable,
  usersTable,
  suppliersTable,
} from "./db";
import { sendEmail, autoDraftPOEmail } from "./notifications";
import { logger } from "./logger";

export interface AutoReorderRunResult {
  restaurantId: number;
  draftsCreated: number;
  itemsConsidered: number;
  draftIds: number[];
  skipped: { reason: string; itemIds: number[] }[];
}

export async function runAutoReorderForRestaurant(restaurantId: number): Promise<AutoReorderRunResult> {
  // Per-restaurant Postgres advisory lock prevents concurrent ticks (across instances or
  // overlapping minute fires) from creating duplicate auto-draft POs for the same shortage.
  // Two-int form: (classifier, restaurantId) — classifier 73610201 is "auto-reorder per restaurant".
  const LOCK_CLASS = 73610201;
  const lockRes = await db.execute(sql`SELECT pg_try_advisory_lock(${LOCK_CLASS}::int, ${restaurantId}::int) AS got`);
  const got = (lockRes as unknown as { rows: { got: boolean }[] }).rows?.[0]?.got;
  if (!got) {
    logger.info({ restaurantId }, "[AutoReorder] another run is already in progress for this restaurant; skipping.");
    return { restaurantId, draftsCreated: 0, itemsConsidered: 0, draftIds: [], skipped: [{ reason: "lock_busy", itemIds: [] }] };
  }
  try {
    return await runAutoReorderForRestaurantLocked(restaurantId);
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_CLASS}::int, ${restaurantId}::int)`);
  }
}

async function runAutoReorderForRestaurantLocked(restaurantId: number): Promise<AutoReorderRunResult> {
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) {
    return { restaurantId, draftsCreated: 0, itemsConsidered: 0, draftIds: [], skipped: [] };
  }
  if (!restaurant.autoReorderEnabled) {
    return { restaurantId, draftsCreated: 0, itemsConsidered: 0, draftIds: [], skipped: [{ reason: "globally_disabled", itemIds: [] }] };
  }

  const lowItems = await db.select().from(inventoryItemsTable).where(and(
    eq(inventoryItemsTable.restaurantId, restaurantId),
    eq(inventoryItemsTable.isActive, true),
    eq(inventoryItemsTable.autoReorderEnabled, true),
    lte(inventoryItemsTable.currentStock, inventoryItemsTable.minStockLevel),
  ));

  if (lowItems.length === 0) {
    return { restaurantId, draftsCreated: 0, itemsConsidered: 0, draftIds: [], skipped: [] };
  }

  const noSupplier = lowItems.filter(i => !i.supplierId);
  const withSupplier = lowItems.filter(i => i.supplierId);

  // Skip items already on an open auto-draft (pending status, isAutoDrafted=true)
  const openDrafts = await db.select({
    poId: purchaseOrdersTable.id,
    itemId: purchaseOrderItemsTable.inventoryItemId,
  })
    .from(purchaseOrdersTable)
    .leftJoin(purchaseOrderItemsTable, eq(purchaseOrderItemsTable.purchaseOrderId, purchaseOrdersTable.id))
    .where(and(
      eq(purchaseOrdersTable.restaurantId, restaurantId),
      eq(purchaseOrdersTable.isAutoDrafted, true),
      inArray(purchaseOrdersTable.status, ["pending", "ordered"]),
    ));
  const itemsAlreadyOnDraft = new Set<number>();
  for (const r of openDrafts) if (r.itemId !== null) itemsAlreadyOnDraft.add(r.itemId);

  const eligible = withSupplier.filter(i => !itemsAlreadyOnDraft.has(i.id));
  const skipped: AutoReorderRunResult["skipped"] = [];
  if (noSupplier.length > 0) skipped.push({ reason: "no_preferred_supplier", itemIds: noSupplier.map(i => i.id) });
  const dupes = withSupplier.filter(i => itemsAlreadyOnDraft.has(i.id));
  if (dupes.length > 0) skipped.push({ reason: "already_on_open_draft", itemIds: dupes.map(i => i.id) });

  if (eligible.length === 0) {
    return { restaurantId, draftsCreated: 0, itemsConsidered: lowItems.length, draftIds: [], skipped };
  }

  const groups = new Map<number, typeof eligible>();
  for (const it of eligible) {
    const sid = it.supplierId!;
    const arr = groups.get(sid) ?? [];
    arr.push(it);
    groups.set(sid, arr);
  }

  const draftIds: number[] = [];
  const supplierIds = [...groups.keys()];
  const suppliers = supplierIds.length > 0
    ? await db.select().from(suppliersTable).where(eq(suppliersTable.restaurantId, restaurantId))
    : [];
  const supplierMap = new Map(suppliers.map(s => [s.id, s]));

  await db.transaction(async tx => {
    for (const [supplierId, items] of groups) {
      const lines = items.map(it => {
        const min = Number(it.minStockLevel);
        const cur = Number(it.currentStock);
        const par = it.parLevel !== null ? Number(it.parLevel) : 0;
        const reorderQ = it.reorderQuantity !== null ? Number(it.reorderQuantity) : 0;
        // Default order qty: explicit reorderQuantity, else (par - current), else (min - current + min)
        let qty = reorderQ;
        if (qty <= 0 && par > 0) qty = Math.max(0, par - cur);
        if (qty <= 0) qty = Math.max(min, min * 2 - cur);
        if (qty <= 0) qty = min > 0 ? min : 1;
        return {
          inventoryItemId: it.id,
          name: it.name,
          unit: it.unit,
          quantity: qty.toFixed(3),
          costPerUnit: Number(it.costPerUnit).toFixed(2),
          lineTotal: qty * Number(it.costPerUnit),
        };
      });

      const total = lines.reduce((s, l) => s + l.lineTotal, 0);

      const [po] = await tx.insert(purchaseOrdersTable).values({
        restaurantId,
        supplierId,
        status: "pending",
        totalAmount: total.toFixed(2),
        notes: `Auto-drafted from low-stock alert (${lines.length} item${lines.length === 1 ? "" : "s"}).`,
        isAutoDrafted: true,
        draftedAt: new Date(),
      }).returning();
      if (!po) continue;

      await tx.insert(purchaseOrderItemsTable).values(lines.map(l => ({
        purchaseOrderId: po.id,
        inventoryItemId: l.inventoryItemId,
        name: l.name,
        unit: l.unit,
        quantity: l.quantity,
        costPerUnit: l.costPerUnit,
      })));
      draftIds.push(po.id);
    }
  });

  if (draftIds.length > 0) {
    try {
      await db.insert(notificationsTable).values({
        restaurantId,
        type: "auto_draft_po",
        title: "Auto-drafted Purchase Orders",
        message: `${draftIds.length} draft purchase order${draftIds.length === 1 ? "" : "s"} created from low-stock items. Review and send.`,
        entityType: "purchase_order",
        entityId: draftIds[0] ?? null,
      });

      try {
        const { broadcastEvent } = await import("./socketio");
        broadcastEvent(restaurantId, "notification:new", { type: "auto_draft_po" });
      } catch (e) {
        logger.warn({ err: e }, "[AutoReorder] socket broadcast failed");
      }

      // Email owners
      const owners = await db.select({ email: usersTable.email }).from(usersTable).where(and(
        eq(usersTable.restaurantId, restaurantId),
        eq(usersTable.role, "owner"),
        eq(usersTable.isActive, true),
      ));
      const summary = [...groups.entries()].map(([sid, items]) => ({
        supplierName: supplierMap.get(sid)?.name ?? "Unknown supplier",
        itemCount: items.length,
        items: items.map(i => i.name),
      }));
      const tpl = autoDraftPOEmail({ restaurantName: restaurant.name, suppliers: summary });
      for (const o of owners) {
        if (o.email) sendEmail({ to: o.email, subject: tpl.subject, html: tpl.html, text: tpl.text }).catch(e => logger.error({ err: e }, "[AutoReorder] email failed"));
      }
    } catch (e) {
      logger.error({ err: e }, "[AutoReorder] post-draft notification failed");
    }
  }

  return { restaurantId, draftsCreated: draftIds.length, itemsConsidered: lowItems.length, draftIds, skipped };
}

export async function runAutoReorderForAllRestaurants(): Promise<void> {
  const LOCK_KEY = 73610200;
  const lockRes = await db.execute(sql`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS got`);
  const got = (lockRes as unknown as { rows: { got: boolean }[] }).rows?.[0]?.got;
  if (!got) {
    logger.info("[AutoReorder] Another instance holds the lock; skipping.");
    return;
  }
  try {
    const restaurants = await db.select({ id: restaurantsTable.id, name: restaurantsTable.name })
      .from(restaurantsTable)
      .where(and(eq(restaurantsTable.isActive, true), eq(restaurantsTable.autoReorderEnabled, true)));
    for (const r of restaurants) {
      try {
        const result = await runAutoReorderForRestaurant(r.id);
        if (result.draftsCreated > 0) {
          logger.info({ restaurantId: r.id, drafts: result.draftsCreated }, "[AutoReorder] drafts created");
        }
      } catch (err) {
        logger.error({ err, restaurantId: r.id }, "[AutoReorder] restaurant run failed");
      }
    }
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`);
  }
}
