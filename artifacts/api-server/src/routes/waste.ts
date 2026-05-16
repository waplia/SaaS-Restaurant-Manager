import { Router } from "express";
import { eq, and, gte, lte, desc, asc, sql, gt, inArray } from "drizzle-orm";
import {
  db,
  wasteEntriesTable,
  wasteReasonsTable,
  wasteSettingsTable,
  inventoryItemsTable,
  inventoryTransactionsTable,
  inventoryItemBatchesTable,
  usersTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { recordAuditLog } from "../lib/audit";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy } from "../lib/objectAcl";

const _objectStorage = new ObjectStorageService();

async function assertPhotoOwnership(restaurantId: number, photoUrl: unknown): Promise<void> {
  if (photoUrl == null || photoUrl === "") return;
  if (typeof photoUrl !== "string" || !photoUrl.startsWith("/objects/")) {
    throw new Error("invalid_photo_url");
  }
  try {
    const file = await _objectStorage.getObjectEntityFile(photoUrl);
    const acl = await getObjectAclPolicy(file);
    if (!acl || acl.restaurantId !== String(restaurantId)) throw new Error("invalid_photo_url");
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new Error("invalid_photo_url");
    throw err;
  }
}

const router = Router();

// All waste endpoints require membership of the restaurant. Granular role
// gating per route is applied via requireRole below.
router.use(
  "/restaurants/:restaurantId/waste",
  requireRole("owner", "manager", "kitchen", "waiter", "cashier", "super_admin"),
  validateRestaurantAccess,
);

// ------------------------------ REASONS ------------------------------

const DEFAULT_REASONS = [
  "Spoilage",
  "Expired",
  "Overproduction",
  "Customer return",
  "Cooking error",
  "Spillage",
  "Quality control",
];

async function ensureDefaultReasons(restaurantId: number) {
  const existing = await db
    .select({ id: wasteReasonsTable.id })
    .from(wasteReasonsTable)
    .where(eq(wasteReasonsTable.restaurantId, restaurantId))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(wasteReasonsTable).values(
      DEFAULT_REASONS.map((label, i) => ({ restaurantId, label, sortOrder: i })),
    );
  }
}

router.get("/restaurants/:restaurantId/waste/reasons", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  await ensureDefaultReasons(restaurantId);
  const rows = await db
    .select()
    .from(wasteReasonsTable)
    .where(eq(wasteReasonsTable.restaurantId, restaurantId))
    .orderBy(asc(wasteReasonsTable.sortOrder), asc(wasteReasonsTable.id));
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/waste/reasons",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { label, sortOrder } = req.body as { label?: string; sortOrder?: number };
    if (!label || !label.trim()) return void res.status(400).json({ error: "label required" });
    const [row] = await db
      .insert(wasteReasonsTable)
      .values({ restaurantId, label: label.trim(), sortOrder: sortOrder ?? 0 })
      .returning();
    await recordAuditLog({
      req,
      module: "waste",
      action: "reason.create",
      entity: "waste_reason",
      entityId: row.id,
      newValue: row,
    });
    res.status(201).json(row);
  },
);

router.patch(
  "/restaurants/:restaurantId/waste/reasons/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { label, isActive, sortOrder } = req.body as { label?: string; isActive?: boolean; sortOrder?: number };
    const [old] = await db.select().from(wasteReasonsTable).where(and(eq(wasteReasonsTable.id, id), eq(wasteReasonsTable.restaurantId, restaurantId)));
    if (!old) return void res.status(404).json({ error: "Not found" });
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (label !== undefined) updates.label = label;
    if (isActive !== undefined) updates.isActive = isActive;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    const [row] = await db.update(wasteReasonsTable).set(updates).where(eq(wasteReasonsTable.id, id)).returning();
    await recordAuditLog({
      req,
      module: "waste",
      action: "reason.update",
      entity: "waste_reason",
      entityId: id,
      oldValue: old,
      newValue: row,
    });
    res.json(row);
  },
);

// ------------------------------ SETTINGS ------------------------------

async function getOrCreateSettings(restaurantId: number) {
  const [existing] = await db.select().from(wasteSettingsTable).where(eq(wasteSettingsTable.restaurantId, restaurantId));
  if (existing) return existing;
  const [created] = await db.insert(wasteSettingsTable).values({ restaurantId }).returning();
  return created;
}

router.get("/restaurants/:restaurantId/waste/settings", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const row = await getOrCreateSettings(restaurantId);
  res.json(row);
});

router.patch(
  "/restaurants/:restaurantId/waste/settings",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { approvalThreshold, autoApproveBelowThreshold } = req.body as {
      approvalThreshold?: string | number;
      autoApproveBelowThreshold?: boolean;
    };
    const old = await getOrCreateSettings(restaurantId);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (approvalThreshold !== undefined) updates.approvalThreshold = String(approvalThreshold);
    if (autoApproveBelowThreshold !== undefined) updates.autoApproveBelowThreshold = autoApproveBelowThreshold;
    const [row] = await db
      .update(wasteSettingsTable)
      .set(updates)
      .where(eq(wasteSettingsTable.restaurantId, restaurantId))
      .returning();
    await recordAuditLog({
      req,
      module: "waste",
      action: "settings.update",
      entity: "waste_settings",
      entityId: restaurantId,
      oldValue: old,
      newValue: row,
    });
    res.json(row);
  },
);

// ------------------------------ ENTRIES ------------------------------

interface ApprovalContext {
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0];
  entryId: number;
  restaurantId: number;
  itemId: number;
  qtyNum: number;
  notes: string | null;
}

/**
 * Deducts inventory stock + FIFO batch consumption + creates a single
 * inventory_transactions row of type "waste". Returns the created transaction
 * id so the caller can stamp it on the waste entry. Avoids double-deduction by
 * being the sole stock-mutating path for waste approvals.
 */
async function deductStockForApproval({ tx, entryId, restaurantId, itemId, qtyNum, notes }: ApprovalContext): Promise<number> {
  const [item] = await tx
    .select()
    .from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.restaurantId, restaurantId)));
  if (!item) throw new Error("inventory_item_missing");

  const newStock = Math.max(0, Number(item.currentStock) - qtyNum);
  await tx
    .update(inventoryItemsTable)
    .set({ currentStock: newStock.toFixed(3), updatedAt: new Date() })
    .where(eq(inventoryItemsTable.id, itemId));

  const [txn] = await tx
    .insert(inventoryTransactionsTable)
    .values({
      itemId,
      restaurantId,
      type: "waste",
      quantity: qtyNum.toFixed(3),
      notes,
      referenceId: entryId,
      referenceType: "waste_entry",
    })
    .returning();

  // FIFO-decrement earliest-expiring batches.
  let toConsume = qtyNum;
  const batches = await tx
    .select()
    .from(inventoryItemBatchesTable)
    .where(and(eq(inventoryItemBatchesTable.inventoryItemId, itemId), gt(inventoryItemBatchesTable.quantityRemaining, "0")))
    .orderBy(asc(inventoryItemBatchesTable.expiryDate), asc(inventoryItemBatchesTable.receivedAt));
  for (const b of batches) {
    if (toConsume <= 0) break;
    const remain = Number(b.quantityRemaining);
    const take = Math.min(remain, toConsume);
    toConsume -= take;
    await tx
      .update(inventoryItemBatchesTable)
      .set({ quantityRemaining: (remain - take).toFixed(3), updatedAt: new Date() })
      .where(eq(inventoryItemBatchesTable.id, b.id));
  }

  return txn.id;
}

function parseDateRange(req: { query: Record<string, unknown> }) {
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  return { from, to };
}

router.get("/restaurants/:restaurantId/waste/entries", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = parseDateRange(req);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const itemId = req.query.itemId ? Number(req.query.itemId) : null;
  const wasteType = typeof req.query.wasteType === "string" ? req.query.wasteType : null;
  const conds = [eq(wasteEntriesTable.restaurantId, restaurantId)];
  if (status) conds.push(eq(wasteEntriesTable.status, status));
  if (wasteType) conds.push(eq(wasteEntriesTable.wasteType, wasteType));
  if (itemId) conds.push(eq(wasteEntriesTable.inventoryItemId, itemId));
  if (from && !Number.isNaN(from.getTime())) conds.push(gte(wasteEntriesTable.createdAt, from));
  if (to && !Number.isNaN(to.getTime())) conds.push(lte(wasteEntriesTable.createdAt, to));

  const rows = await db
    .select({
      entry: wasteEntriesTable,
      itemName: inventoryItemsTable.name,
      itemUnit: inventoryItemsTable.unit,
      reasonLabel: wasteReasonsTable.label,
      recordedByName: usersTable.name,
    })
    .from(wasteEntriesTable)
    .leftJoin(inventoryItemsTable, eq(inventoryItemsTable.id, wasteEntriesTable.inventoryItemId))
    .leftJoin(wasteReasonsTable, eq(wasteReasonsTable.id, wasteEntriesTable.reasonId))
    .leftJoin(usersTable, eq(usersTable.id, wasteEntriesTable.recordedByUserId))
    .where(and(...conds))
    .orderBy(desc(wasteEntriesTable.createdAt))
    .limit(500);

  res.json(rows.map((r) => ({ ...r.entry, itemName: r.itemName, itemUnit: r.itemUnit, reasonLabel: r.reasonLabel, recordedByName: r.recordedByName })));
});

router.post("/restaurants/:restaurantId/waste/entries", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const body = req.body as {
    inventoryItemId: number;
    quantity: number | string;
    wasteType?: string;
    reasonId?: number | null;
    reasonText?: string | null;
    station?: string | null;
    note?: string | null;
    photoUrl?: string | null;
  };
  if (!body.inventoryItemId || body.quantity == null) {
    return void res.status(400).json({ error: "inventoryItemId and quantity required" });
  }
  const qtyNum = Number(body.quantity);
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) return void res.status(400).json({ error: "quantity must be > 0" });

  const [item] = await db
    .select()
    .from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, body.inventoryItemId), eq(inventoryItemsTable.restaurantId, restaurantId)));
  if (!item) return void res.status(404).json({ error: "Inventory item not found" });

  try {
    await assertPhotoOwnership(restaurantId, body.photoUrl ?? null);
  } catch {
    return void res.status(400).json({ error: "invalid_photo_url" });
  }

  const costAtEntry = Number(item.costPerUnit);
  const totalCost = costAtEntry * qtyNum;
  const settings = await getOrCreateSettings(restaurantId);
  const reqUser = req.user as { sub?: number; id?: number; role?: string; isSuperAdmin?: boolean } | undefined;
  const userId = reqUser?.sub ?? reqUser?.id ?? null;
  const role = reqUser?.isSuperAdmin ? "super_admin" : reqUser?.role ?? null;

  // Auto-approve when feature enabled AND totalCost < threshold AND user is owner/manager.
  const canSelfApprove = role === "owner" || role === "manager" || role === "super_admin";
  const autoApprove =
    settings.autoApproveBelowThreshold &&
    Number(settings.approvalThreshold) > 0 &&
    totalCost < Number(settings.approvalThreshold) &&
    canSelfApprove;

  const status = autoApprove ? "approved" : "pending";

  const result = await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(wasteEntriesTable)
      .values({
        restaurantId,
        inventoryItemId: body.inventoryItemId,
        quantity: qtyNum.toFixed(3),
        unit: item.unit,
        wasteType: body.wasteType ?? "wastage",
        reasonId: body.reasonId ?? null,
        reasonText: body.reasonText ?? null,
        station: body.station ?? null,
        note: body.note ?? null,
        photoUrl: body.photoUrl ?? null,
        recordedByUserId: userId,
        costAtEntry: costAtEntry.toFixed(2),
        totalCost: totalCost.toFixed(2),
        status,
        approvedByUserId: autoApprove ? userId : null,
        approvedAt: autoApprove ? new Date() : null,
      })
      .returning();

    if (autoApprove) {
      const txnId = await deductStockForApproval({
        tx,
        entryId: entry.id,
        restaurantId,
        itemId: entry.inventoryItemId,
        qtyNum,
        notes: `auto-approved waste entry #${entry.id}`,
      });
      const [updated] = await tx
        .update(wasteEntriesTable)
        .set({ inventoryTransactionId: txnId, updatedAt: new Date() })
        .where(eq(wasteEntriesTable.id, entry.id))
        .returning();
      return updated;
    }
    return entry;
  });

  await recordAuditLog({
    req,
    module: "waste",
    action: autoApprove ? "entry.create.auto_approved" : "entry.create",
    entity: "waste_entry",
    entityId: result.id,
    newValue: result,
  });

  res.status(201).json(result);
});

router.patch(
  "/restaurants/:restaurantId/waste/entries/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const [old] = await db
      .select()
      .from(wasteEntriesTable)
      .where(and(eq(wasteEntriesTable.id, id), eq(wasteEntriesTable.restaurantId, restaurantId)));
    if (!old) return void res.status(404).json({ error: "Not found" });
    if (old.status !== "pending") {
      return void res.status(400).json({ error: "Only pending entries can be edited" });
    }
    const { wasteType, reasonId, reasonText, station, note, photoUrl, quantity } = req.body as {
      wasteType?: string;
      reasonId?: number | null;
      reasonText?: string | null;
      station?: string | null;
      note?: string | null;
      photoUrl?: string | null;
      quantity?: number | string;
    };
    if (photoUrl !== undefined) {
      try {
        await assertPhotoOwnership(restaurantId, photoUrl);
      } catch {
        return void res.status(400).json({ error: "invalid_photo_url" });
      }
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (wasteType !== undefined) updates.wasteType = wasteType;
    if (reasonId !== undefined) updates.reasonId = reasonId;
    if (reasonText !== undefined) updates.reasonText = reasonText;
    if (station !== undefined) updates.station = station;
    if (note !== undefined) updates.note = note;
    if (photoUrl !== undefined) updates.photoUrl = photoUrl;
    if (quantity !== undefined) {
      const qNum = Number(quantity);
      if (!Number.isFinite(qNum) || qNum <= 0) return void res.status(400).json({ error: "quantity must be > 0" });
      updates.quantity = qNum.toFixed(3);
      updates.totalCost = (qNum * Number(old.costAtEntry)).toFixed(2);
    }
    const [row] = await db.update(wasteEntriesTable).set(updates).where(eq(wasteEntriesTable.id, id)).returning();
    await recordAuditLog({
      req,
      module: "waste",
      action: "entry.update",
      entity: "waste_entry",
      entityId: id,
      oldValue: old,
      newValue: row,
    });
    res.json(row);
  },
);

router.post(
  "/restaurants/:restaurantId/waste/entries/:id/approve",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const reqUser = req.user as { sub?: number; id?: number } | undefined;
    const approverId = reqUser?.sub ?? reqUser?.id ?? null;

    try {
      const result = await db.transaction(async (tx) => {
        const [old] = await tx
          .select()
          .from(wasteEntriesTable)
          .where(and(eq(wasteEntriesTable.id, id), eq(wasteEntriesTable.restaurantId, restaurantId)));
        if (!old) throw new Error("not_found");
        if (old.status !== "pending") throw new Error("invalid_status");

        const txnId = await deductStockForApproval({
          tx,
          entryId: old.id,
          restaurantId,
          itemId: old.inventoryItemId,
          qtyNum: Number(old.quantity),
          notes: `approved waste entry #${old.id}`,
        });
        const [row] = await tx
          .update(wasteEntriesTable)
          .set({
            status: "approved",
            approvedByUserId: approverId,
            approvedAt: new Date(),
            inventoryTransactionId: txnId,
            updatedAt: new Date(),
          })
          .where(eq(wasteEntriesTable.id, id))
          .returning();
        return { old, row };
      });
      await recordAuditLog({
        req,
        module: "waste",
        action: "entry.approve",
        entity: "waste_entry",
        entityId: id,
        oldValue: result.old,
        newValue: result.row,
      });
      res.json(result.row);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (m === "not_found") return void res.status(404).json({ error: "Not found" });
      if (m === "invalid_status") return void res.status(400).json({ error: "Only pending entries can be approved" });
      throw err;
    }
  },
);

router.post(
  "/restaurants/:restaurantId/waste/entries/:id/reject",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { rejectionNote } = req.body as { rejectionNote?: string };
    const reqUser = req.user as { sub?: number; id?: number } | undefined;
    const approverId = reqUser?.sub ?? reqUser?.id ?? null;
    const [old] = await db
      .select()
      .from(wasteEntriesTable)
      .where(and(eq(wasteEntriesTable.id, id), eq(wasteEntriesTable.restaurantId, restaurantId)));
    if (!old) return void res.status(404).json({ error: "Not found" });
    if (old.status !== "pending") return void res.status(400).json({ error: "Only pending entries can be rejected" });
    const [row] = await db
      .update(wasteEntriesTable)
      .set({
        status: "rejected",
        approvedByUserId: approverId,
        approvedAt: new Date(),
        rejectionNote: rejectionNote ?? null,
        updatedAt: new Date(),
      })
      .where(eq(wasteEntriesTable.id, id))
      .returning();
    await recordAuditLog({
      req,
      module: "waste",
      action: "entry.reject",
      entity: "waste_entry",
      entityId: id,
      oldValue: old,
      newValue: row,
    });
    res.json(row);
  },
);

router.post(
  "/restaurants/:restaurantId/waste/entries/:id/donate",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { donationRecipient, donationPickupAt, donationNote } = req.body as {
      donationRecipient?: string;
      donationPickupAt?: string;
      donationNote?: string;
    };
    if (!donationRecipient || !donationRecipient.trim()) {
      return void res.status(400).json({ error: "donationRecipient required" });
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [old] = await tx
          .select()
          .from(wasteEntriesTable)
          .where(and(eq(wasteEntriesTable.id, id), eq(wasteEntriesTable.restaurantId, restaurantId)));
        if (!old) throw new Error("not_found");
        if (old.status !== "pending" && old.status !== "approved") throw new Error("invalid_status");

        // If still pending, deduct stock now (treat donation as approval +
        // donation in one go) — this is the only deduction path.
        let inventoryTransactionId = old.inventoryTransactionId;
        if (old.status === "pending") {
          inventoryTransactionId = await deductStockForApproval({
            tx,
            entryId: old.id,
            restaurantId,
            itemId: old.inventoryItemId,
            qtyNum: Number(old.quantity),
            notes: `donated waste entry #${old.id} → ${donationRecipient}`,
          });
        }

        const reqUser = req.user as { sub?: number; id?: number } | undefined;
        const approverId = old.approvedByUserId ?? reqUser?.sub ?? reqUser?.id ?? null;

        const [row] = await tx
          .update(wasteEntriesTable)
          .set({
            status: "donated",
            donationRecipient: donationRecipient.trim(),
            donationPickupAt: donationPickupAt ? new Date(donationPickupAt) : null,
            donationNote: donationNote ?? null,
            inventoryTransactionId,
            approvedByUserId: approverId,
            approvedAt: old.approvedAt ?? new Date(),
            updatedAt: new Date(),
          })
          .where(eq(wasteEntriesTable.id, id))
          .returning();
        return { old, row };
      });
      await recordAuditLog({
        req,
        module: "waste",
        action: "entry.donate",
        entity: "waste_entry",
        entityId: id,
        oldValue: result.old,
        newValue: result.row,
      });
      res.json(result.row);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (m === "not_found") return void res.status(404).json({ error: "Not found" });
      if (m === "invalid_status")
        return void res.status(400).json({ error: "Only pending or approved entries can be marked donated" });
      throw err;
    }
  },
);

// ------------------------------ REPORTS ------------------------------

router.get("/restaurants/:restaurantId/waste/reports/summary", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = parseDateRange(req);
  const dateConds = [eq(wasteEntriesTable.restaurantId, restaurantId)];
  if (from && !Number.isNaN(from.getTime())) dateConds.push(gte(wasteEntriesTable.createdAt, from));
  if (to && !Number.isNaN(to.getTime())) dateConds.push(lte(wasteEntriesTable.createdAt, to));

  const [totalsRow] = await db
    .select({
      totalEntries: sql<number>`count(*)::int`,
      totalCost: sql<string>`coalesce(sum(${wasteEntriesTable.totalCost}), 0)::text`,
      pendingCount: sql<number>`sum(case when ${wasteEntriesTable.status} = 'pending' then 1 else 0 end)::int`,
      approvedCount: sql<number>`sum(case when ${wasteEntriesTable.status} = 'approved' then 1 else 0 end)::int`,
      donatedCount: sql<number>`sum(case when ${wasteEntriesTable.status} = 'donated' then 1 else 0 end)::int`,
      donatedCost: sql<string>`coalesce(sum(case when ${wasteEntriesTable.status} = 'donated' then ${wasteEntriesTable.totalCost} else 0 end), 0)::text`,
      approvedCost: sql<string>`coalesce(sum(case when ${wasteEntriesTable.status} in ('approved', 'donated') then ${wasteEntriesTable.totalCost} else 0 end), 0)::text`,
    })
    .from(wasteEntriesTable)
    .where(and(...dateConds));

  const byType = await db
    .select({
      wasteType: wasteEntriesTable.wasteType,
      count: sql<number>`count(*)::int`,
      cost: sql<string>`coalesce(sum(${wasteEntriesTable.totalCost}), 0)::text`,
    })
    .from(wasteEntriesTable)
    .where(and(...dateConds, inArray(wasteEntriesTable.status, ["approved", "donated"])))
    .groupBy(wasteEntriesTable.wasteType);

  const trend = await db
    .select({
      day: sql<string>`to_char(${wasteEntriesTable.createdAt}, 'YYYY-MM-DD')`,
      cost: sql<string>`coalesce(sum(${wasteEntriesTable.totalCost}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(wasteEntriesTable)
    .where(and(...dateConds, inArray(wasteEntriesTable.status, ["approved", "donated"])))
    .groupBy(sql`to_char(${wasteEntriesTable.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${wasteEntriesTable.createdAt}, 'YYYY-MM-DD') asc`);

  res.json({ totals: totalsRow, byType, trend });
});

router.get("/restaurants/:restaurantId/waste/reports/by-reason", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = parseDateRange(req);
  const conds = [
    eq(wasteEntriesTable.restaurantId, restaurantId),
    inArray(wasteEntriesTable.status, ["approved", "donated"]),
  ];
  if (from && !Number.isNaN(from.getTime())) conds.push(gte(wasteEntriesTable.createdAt, from));
  if (to && !Number.isNaN(to.getTime())) conds.push(lte(wasteEntriesTable.createdAt, to));

  const rows = await db
    .select({
      reasonId: wasteEntriesTable.reasonId,
      reasonLabel: wasteReasonsTable.label,
      reasonText: wasteEntriesTable.reasonText,
      count: sql<number>`count(*)::int`,
      cost: sql<string>`coalesce(sum(${wasteEntriesTable.totalCost}), 0)::text`,
    })
    .from(wasteEntriesTable)
    .leftJoin(wasteReasonsTable, eq(wasteReasonsTable.id, wasteEntriesTable.reasonId))
    .where(and(...conds))
    .groupBy(wasteEntriesTable.reasonId, wasteReasonsTable.label, wasteEntriesTable.reasonText)
    .orderBy(desc(sql`coalesce(sum(${wasteEntriesTable.totalCost}), 0)`));
  res.json(rows);
});

router.get("/restaurants/:restaurantId/waste/reports/by-staff", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = parseDateRange(req);
  const conds = [eq(wasteEntriesTable.restaurantId, restaurantId)];
  if (from && !Number.isNaN(from.getTime())) conds.push(gte(wasteEntriesTable.createdAt, from));
  if (to && !Number.isNaN(to.getTime())) conds.push(lte(wasteEntriesTable.createdAt, to));

  const rows = await db
    .select({
      userId: wasteEntriesTable.recordedByUserId,
      userName: usersTable.name,
      count: sql<number>`count(*)::int`,
      approvedCount: sql<number>`sum(case when ${wasteEntriesTable.status} in ('approved','donated') then 1 else 0 end)::int`,
      rejectedCount: sql<number>`sum(case when ${wasteEntriesTable.status} = 'rejected' then 1 else 0 end)::int`,
      cost: sql<string>`coalesce(sum(case when ${wasteEntriesTable.status} in ('approved','donated') then ${wasteEntriesTable.totalCost} else 0 end), 0)::text`,
    })
    .from(wasteEntriesTable)
    .leftJoin(usersTable, eq(usersTable.id, wasteEntriesTable.recordedByUserId))
    .where(and(...conds))
    .groupBy(wasteEntriesTable.recordedByUserId, usersTable.name)
    .orderBy(desc(sql`count(*)`));
  res.json(rows);
});

router.get("/restaurants/:restaurantId/waste/reports/by-item", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = parseDateRange(req);
  const conds = [
    eq(wasteEntriesTable.restaurantId, restaurantId),
    inArray(wasteEntriesTable.status, ["approved", "donated"]),
  ];
  if (from && !Number.isNaN(from.getTime())) conds.push(gte(wasteEntriesTable.createdAt, from));
  if (to && !Number.isNaN(to.getTime())) conds.push(lte(wasteEntriesTable.createdAt, to));

  const rows = await db
    .select({
      itemId: wasteEntriesTable.inventoryItemId,
      itemName: inventoryItemsTable.name,
      itemUnit: inventoryItemsTable.unit,
      qty: sql<string>`coalesce(sum(${wasteEntriesTable.quantity}), 0)::text`,
      cost: sql<string>`coalesce(sum(${wasteEntriesTable.totalCost}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(wasteEntriesTable)
    .leftJoin(inventoryItemsTable, eq(inventoryItemsTable.id, wasteEntriesTable.inventoryItemId))
    .where(and(...conds))
    .groupBy(wasteEntriesTable.inventoryItemId, inventoryItemsTable.name, inventoryItemsTable.unit)
    .orderBy(desc(sql`coalesce(sum(${wasteEntriesTable.totalCost}), 0)`))
    .limit(50);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/waste/dashboard-tile", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [row] = await db
    .select({
      totalCost: sql<string>`coalesce(sum(case when ${wasteEntriesTable.status} in ('approved','donated') then ${wasteEntriesTable.totalCost} else 0 end), 0)::text`,
      pendingCount: sql<number>`sum(case when ${wasteEntriesTable.status} = 'pending' then 1 else 0 end)::int`,
      donatedCost: sql<string>`coalesce(sum(case when ${wasteEntriesTable.status} = 'donated' then ${wasteEntriesTable.totalCost} else 0 end), 0)::text`,
    })
    .from(wasteEntriesTable)
    .where(and(eq(wasteEntriesTable.restaurantId, restaurantId), gte(wasteEntriesTable.createdAt, sevenDaysAgo)));
  res.json(row);
});

router.get("/restaurants/:restaurantId/waste/export.csv", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = parseDateRange(req);
  const conds = [eq(wasteEntriesTable.restaurantId, restaurantId)];
  if (from && !Number.isNaN(from.getTime())) conds.push(gte(wasteEntriesTable.createdAt, from));
  if (to && !Number.isNaN(to.getTime())) conds.push(lte(wasteEntriesTable.createdAt, to));

  const rows = await db
    .select({
      entry: wasteEntriesTable,
      itemName: inventoryItemsTable.name,
      reasonLabel: wasteReasonsTable.label,
      recordedByName: usersTable.name,
    })
    .from(wasteEntriesTable)
    .leftJoin(inventoryItemsTable, eq(inventoryItemsTable.id, wasteEntriesTable.inventoryItemId))
    .leftJoin(wasteReasonsTable, eq(wasteReasonsTable.id, wasteEntriesTable.reasonId))
    .leftJoin(usersTable, eq(usersTable.id, wasteEntriesTable.recordedByUserId))
    .where(and(...conds))
    .orderBy(desc(wasteEntriesTable.createdAt));

  const escape = (v: unknown): string => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : v instanceof Date ? v.toISOString() : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const headers = [
    "id",
    "createdAt",
    "status",
    "wasteType",
    "item",
    "quantity",
    "unit",
    "costAtEntry",
    "totalCost",
    "reason",
    "reasonText",
    "station",
    "recordedBy",
    "approvedAt",
    "donationRecipient",
    "note",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const e = r.entry;
    lines.push(
      [
        e.id,
        e.createdAt,
        e.status,
        e.wasteType,
        r.itemName,
        e.quantity,
        e.unit,
        e.costAtEntry,
        e.totalCost,
        r.reasonLabel,
        e.reasonText,
        e.station,
        r.recordedByName,
        e.approvedAt,
        e.donationRecipient,
        e.note,
      ]
        .map(escape)
        .join(","),
    );
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=waste-${restaurantId}.csv`);
  res.send(lines.join("\n"));
});

export default router;
