import { Router, type Request, type Response, type NextFunction } from "express";
import { eq, and, gte, lte, desc, asc, sql, inArray } from "drizzle-orm";
import {
  db,
  restaurantsTable,
  menuItemsTable,
  menuCategoriesTable,
  productionPlansTable,
  productionPlanItemsTable,
  finishedGoodsBatchesTable,
  finishedGoodsWastageTable,
  cakeBookingsTable,
  recipeMappingsTable,
  inventoryItemsTable,
  inventoryTransactionsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  notificationsTable,
  customersTable,
  CAKE_BOOKING_STATUSES,
  PRODUCTION_PLAN_ITEM_STATUSES,
  WASTAGE_REASONS,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import Stripe from "stripe";

const router = Router();

const CAKE_STATUSES = new Set<string>(CAKE_BOOKING_STATUSES as readonly string[]);
const PLAN_ITEM_STATUSES = new Set<string>(PRODUCTION_PLAN_ITEM_STATUSES as readonly string[]);
const WASTAGE_REASON_SET = new Set<string>(WASTAGE_REASONS as readonly string[]);

const CAKE_TRANSITIONS: Record<string, string[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["in_production", "cancelled"],
  in_production: ["ready", "cancelled"],
  ready: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

function toDecimal(n: number): string {
  return (Math.round(n * 1000) / 1000).toFixed(3);
}
function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

async function requireBakeryMode(req: Request, res: Response, next: NextFunction): Promise<void> {
  const restaurantId = Number(req.params.restaurantId);
  const [r] = await db
    .select({
      bakeryModeEnabled: restaurantsTable.bakeryModeEnabled,
      defaultShelfLife: restaurantsTable.bakeryDefaultShelfLifeHours,
      expiryAlert: restaurantsTable.bakeryExpiryAlertHours,
    })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  if (!r) {
    res.status(404).json({ error: "Restaurant not found" });
    return;
  }
  if (!r.bakeryModeEnabled && !req.user?.isSuperAdmin) {
    res.status(403).json({ error: "Bakery mode is not enabled for this restaurant. Enable it in Settings → Bakery." });
    return;
  }
  (req as Request & { bakeryConfig?: typeof r }).bakeryConfig = r;
  next();
}

router.use(
  "/restaurants/:restaurantId/bakery",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "super_admin"),
  validateRestaurantAccess,
  requireBakeryMode,
);

// ─────────────────────────── Production Plans ───────────────────────────

router.get("/restaurants/:restaurantId/bakery/plans", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = req.query;
  const conds = [eq(productionPlansTable.restaurantId, restaurantId)];
  if (from) conds.push(gte(productionPlansTable.planDate, new Date(String(from))));
  if (to) conds.push(lte(productionPlansTable.planDate, new Date(String(to))));
  const plans = await db
    .select()
    .from(productionPlansTable)
    .where(and(...conds))
    .orderBy(desc(productionPlansTable.planDate))
    .limit(200);
  res.json(plans);
});

router.get("/restaurants/:restaurantId/bakery/plans/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [plan] = await db
    .select()
    .from(productionPlansTable)
    .where(and(eq(productionPlansTable.id, id), eq(productionPlansTable.restaurantId, restaurantId)));
  if (!plan) return void res.status(404).json({ error: "Plan not found" });
  const items = await db
    .select({
      item: productionPlanItemsTable,
      menuItem: { id: menuItemsTable.id, name: menuItemsTable.name, price: menuItemsTable.price, isCake: menuItemsTable.isCake },
    })
    .from(productionPlanItemsTable)
    .leftJoin(menuItemsTable, eq(productionPlanItemsTable.menuItemId, menuItemsTable.id))
    .where(eq(productionPlanItemsTable.planId, id))
    .orderBy(asc(productionPlanItemsTable.id));
  res.json({ plan, items });
});

router.post(
  "/restaurants/:restaurantId/bakery/plans",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { planDate, notes, items } = req.body ?? {};
    if (!planDate) return void res.status(400).json({ error: "planDate is required" });
    const dt = new Date(planDate);
    if (Number.isNaN(dt.getTime())) return void res.status(400).json({ error: "Invalid planDate" });

    const [plan] = await db
      .insert(productionPlansTable)
      .values({
        restaurantId,
        planDate: dt,
        notes: notes ?? null,
        createdBy: req.user?.sub ?? null,
      })
      .returning();

    if (Array.isArray(items) && items.length > 0) {
      await db.insert(productionPlanItemsTable).values(
        items.map((it: { menuItemId: number; plannedQuantity: number; assignedTo?: number; kitchenId?: number; notes?: string; bookingId?: number }) => ({
          planId: plan.id,
          restaurantId,
          menuItemId: Number(it.menuItemId),
          plannedQuantity: toDecimal(Number(it.plannedQuantity) || 0),
          assignedTo: it.assignedTo ?? null,
          kitchenId: it.kitchenId ?? null,
          notes: it.notes ?? null,
          bookingId: it.bookingId ?? null,
        })),
      );
    }

    res.status(201).json(plan);
  },
);

router.patch(
  "/restaurants/:restaurantId/bakery/plans/:id",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = {};
    if ("notes" in req.body) updates.notes = req.body.notes;
    if ("status" in req.body) updates.status = req.body.status;
    if ("planDate" in req.body) updates.planDate = new Date(req.body.planDate);
    updates.updatedAt = new Date();
    const [updated] = await db
      .update(productionPlansTable)
      .set(updates)
      .where(and(eq(productionPlansTable.id, id), eq(productionPlansTable.restaurantId, restaurantId)))
      .returning();
    if (!updated) return void res.status(404).json({ error: "Plan not found" });
    res.json(updated);
  },
);

router.post(
  "/restaurants/:restaurantId/bakery/plans/:id/items",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { menuItemId, plannedQuantity, assignedTo, kitchenId, notes, bookingId } = req.body ?? {};
    if (!menuItemId) return void res.status(400).json({ error: "menuItemId required" });
    const [plan] = await db.select().from(productionPlansTable)
      .where(and(eq(productionPlansTable.id, id), eq(productionPlansTable.restaurantId, restaurantId)));
    if (!plan) return void res.status(404).json({ error: "Plan not found" });
    const [created] = await db.insert(productionPlanItemsTable).values({
      planId: id,
      restaurantId,
      menuItemId: Number(menuItemId),
      plannedQuantity: toDecimal(Number(plannedQuantity) || 0),
      assignedTo: assignedTo ?? null,
      kitchenId: kitchenId ?? null,
      notes: notes ?? null,
      bookingId: bookingId ?? null,
    }).returning();
    res.status(201).json(created);
  },
);

router.patch(
  "/restaurants/:restaurantId/bakery/plans/:planId/items/:itemId",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const itemId = Number(req.params.itemId);
    const updates: Record<string, unknown> = {};
    if ("plannedQuantity" in req.body) updates.plannedQuantity = toDecimal(Number(req.body.plannedQuantity) || 0);
    if ("status" in req.body) {
      if (!PLAN_ITEM_STATUSES.has(String(req.body.status))) return void res.status(400).json({ error: "Invalid status" });
      updates.status = req.body.status;
    }
    if ("assignedTo" in req.body) updates.assignedTo = req.body.assignedTo;
    if ("kitchenId" in req.body) updates.kitchenId = req.body.kitchenId;
    if ("notes" in req.body) updates.notes = req.body.notes;
    updates.updatedAt = new Date();
    const [updated] = await db.update(productionPlanItemsTable)
      .set(updates)
      .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.restaurantId, restaurantId)))
      .returning();
    if (!updated) return void res.status(404).json({ error: "Item not found" });
    res.json(updated);
  },
);

router.delete(
  "/restaurants/:restaurantId/bakery/plans/:planId/items/:itemId",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const itemId = Number(req.params.itemId);
    await db.delete(productionPlanItemsTable)
      .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.restaurantId, restaurantId)));
    res.status(204).end();
  },
);

// Complete a production plan item: produces a finished-goods batch.
router.post(
  "/restaurants/:restaurantId/bakery/plans/:planId/items/:itemId/complete",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const itemId = Number(req.params.itemId);
    const { quantityProduced, unitCost, expiryAt, storageLocation, notes } = req.body ?? {};

    const [item] = await db.select().from(productionPlanItemsTable)
      .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.restaurantId, restaurantId)));
    if (!item) return void res.status(404).json({ error: "Item not found" });

    const [menu] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, item.menuItemId));
    if (!menu) return void res.status(404).json({ error: "Menu item not found" });

    const cfg = (req as Request & { bakeryConfig?: { defaultShelfLife: number } }).bakeryConfig;
    const shelfLifeHours = menu.shelfLifeHours ?? cfg?.defaultShelfLife ?? 24;
    const producedAt = new Date();
    const expiry = expiryAt ? new Date(expiryAt) : new Date(producedAt.getTime() + shelfLifeHours * 3600_000);

    const qty = Number(quantityProduced ?? item.plannedQuantity) || 0;
    const batchNumber = `B-${producedAt.getFullYear().toString().slice(-2)}${(producedAt.getMonth() + 1).toString().padStart(2, "0")}${producedAt.getDate().toString().padStart(2, "0")}-${Math.floor(Math.random() * 9000 + 1000)}`;

    const [batch] = await db.insert(finishedGoodsBatchesTable).values({
      restaurantId,
      menuItemId: item.menuItemId,
      planItemId: itemId,
      batchNumber,
      quantityProduced: toDecimal(qty),
      quantityRemaining: toDecimal(qty),
      unitCost: money(Number(unitCost) || 0),
      producedAt,
      expiryAt: expiry,
      storageLocation: storageLocation ?? null,
      producedBy: req.user?.sub ?? null,
      notes: notes ?? null,
    }).returning();

    await db.update(productionPlanItemsTable)
      .set({ status: "done", producedQuantity: toDecimal(qty), updatedAt: new Date() })
      .where(eq(productionPlanItemsTable.id, itemId));

    // Decrement raw ingredient stock per recipe mapping (idempotent best-effort).
    const recipes = await db.select().from(recipeMappingsTable)
      .where(and(eq(recipeMappingsTable.restaurantId, restaurantId), eq(recipeMappingsTable.menuItemId, item.menuItemId)));
    for (const rec of recipes) {
      const consume = Number(rec.quantity) * qty;
      if (consume > 0) {
        await db.update(inventoryItemsTable)
          .set({ currentStock: sql`${inventoryItemsTable.currentStock} - ${toDecimal(consume)}`, updatedAt: new Date() })
          .where(eq(inventoryItemsTable.id, rec.inventoryItemId));
        await db.insert(inventoryTransactionsTable).values({
          itemId: rec.inventoryItemId,
          restaurantId,
          type: "consumption",
          quantity: toDecimal(-consume),
          notes: `Production batch ${batchNumber}`,
          referenceId: batch.id,
          referenceType: "finished_goods_batch",
        });
      }
    }

    res.status(201).json(batch);
  },
);

// ─────────────────────────── Finished-goods Batches ───────────────────────────

router.get("/restaurants/:restaurantId/bakery/batches", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { menuItemId, status, activeOnly } = req.query;
  const conds = [eq(finishedGoodsBatchesTable.restaurantId, restaurantId)];
  if (menuItemId) conds.push(eq(finishedGoodsBatchesTable.menuItemId, Number(menuItemId)));
  if (status) conds.push(eq(finishedGoodsBatchesTable.status, String(status) as "active" | "depleted" | "expired" | "wasted"));
  if (activeOnly === "true") conds.push(eq(finishedGoodsBatchesTable.status, "active"));
  const rows = await db.select({
    batch: finishedGoodsBatchesTable,
    menuItemName: menuItemsTable.name,
  }).from(finishedGoodsBatchesTable)
    .leftJoin(menuItemsTable, eq(finishedGoodsBatchesTable.menuItemId, menuItemsTable.id))
    .where(and(...conds))
    .orderBy(asc(finishedGoodsBatchesTable.expiryAt))
    .limit(500);
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/bakery/batches/:id/wastage",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const batchId = Number(req.params.id);
    const { quantity, reason, notes } = req.body ?? {};
    const reasonStr = String(reason ?? "expired");
    if (!WASTAGE_REASON_SET.has(reasonStr)) return void res.status(400).json({ error: "Invalid reason" });

    const [batch] = await db.select().from(finishedGoodsBatchesTable)
      .where(and(eq(finishedGoodsBatchesTable.id, batchId), eq(finishedGoodsBatchesTable.restaurantId, restaurantId)));
    if (!batch) return void res.status(404).json({ error: "Batch not found" });

    const qty = Number(quantity) || 0;
    if (qty <= 0) return void res.status(400).json({ error: "quantity must be positive" });
    if (qty > Number(batch.quantityRemaining)) return void res.status(400).json({ error: "Wastage exceeds remaining" });

    const [w] = await db.insert(finishedGoodsWastageTable).values({
      restaurantId,
      batchId,
      menuItemId: batch.menuItemId,
      quantity: toDecimal(qty),
      reason: reasonStr as "expired" | "damaged" | "unsold" | "sample" | "other",
      notes: notes ?? null,
      recordedBy: req.user?.sub ?? null,
    }).returning();

    const newRemaining = Number(batch.quantityRemaining) - qty;
    await db.update(finishedGoodsBatchesTable)
      .set({
        quantityRemaining: toDecimal(newRemaining),
        status: newRemaining <= 0 ? "wasted" : batch.status,
        updatedAt: new Date(),
      })
      .where(eq(finishedGoodsBatchesTable.id, batchId));

    res.status(201).json(w);
  },
);

router.get("/restaurants/:restaurantId/bakery/wastage", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = req.query;
  const conds = [eq(finishedGoodsWastageTable.restaurantId, restaurantId)];
  if (from) conds.push(gte(finishedGoodsWastageTable.createdAt, new Date(String(from))));
  if (to) conds.push(lte(finishedGoodsWastageTable.createdAt, new Date(String(to))));
  const rows = await db.select({
    wastage: finishedGoodsWastageTable,
    menuItemName: menuItemsTable.name,
    batchNumber: finishedGoodsBatchesTable.batchNumber,
    unitCost: finishedGoodsBatchesTable.unitCost,
  }).from(finishedGoodsWastageTable)
    .leftJoin(menuItemsTable, eq(finishedGoodsWastageTable.menuItemId, menuItemsTable.id))
    .leftJoin(finishedGoodsBatchesTable, eq(finishedGoodsWastageTable.batchId, finishedGoodsBatchesTable.id))
    .where(and(...conds))
    .orderBy(desc(finishedGoodsWastageTable.createdAt))
    .limit(500);
  res.json(rows);
});

// ─────────────────────────── Cake Bookings ───────────────────────────

router.get("/restaurants/:restaurantId/bakery/bookings", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status, from, to } = req.query;
  const conds = [eq(cakeBookingsTable.restaurantId, restaurantId)];
  if (status && CAKE_STATUSES.has(String(status))) conds.push(eq(cakeBookingsTable.status, String(status) as "new" | "confirmed" | "in_production" | "ready" | "delivered" | "cancelled"));
  if (from) conds.push(gte(cakeBookingsTable.deliveryAt, new Date(String(from))));
  if (to) conds.push(lte(cakeBookingsTable.deliveryAt, new Date(String(to))));
  const rows = await db.select().from(cakeBookingsTable)
    .where(and(...conds))
    .orderBy(asc(cakeBookingsTable.deliveryAt))
    .limit(500);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/bakery/bookings/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [b] = await db.select().from(cakeBookingsTable)
    .where(and(eq(cakeBookingsTable.id, id), eq(cakeBookingsTable.restaurantId, restaurantId)));
  if (!b) return void res.status(404).json({ error: "Booking not found" });
  res.json(b);
});

router.post(
  "/restaurants/:restaurantId/bakery/bookings",
  requireRole("owner", "manager", "waiter", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const {
      customerId, customerName, customerPhone, customerEmail,
      menuItemId, cakeName, sizeLabel, flavor, quantity,
      designNotes, referenceImageUrl,
      deliveryAt, deliveryAddress, isPickup,
      totalAmount, advanceAmount, notes,
    } = req.body ?? {};

    if (!customerName) return void res.status(400).json({ error: "customerName required" });
    if (!cakeName) return void res.status(400).json({ error: "cakeName required" });
    if (!deliveryAt) return void res.status(400).json({ error: "deliveryAt required" });
    const dt = new Date(deliveryAt);
    if (Number.isNaN(dt.getTime())) return void res.status(400).json({ error: "Invalid deliveryAt" });

    const bookingNumber = `CK-${Date.now().toString(36).toUpperCase()}`;
    const [b] = await db.insert(cakeBookingsTable).values({
      restaurantId,
      bookingNumber,
      customerId: customerId ?? null,
      customerName: String(customerName).trim(),
      customerPhone: customerPhone ?? null,
      customerEmail: customerEmail ?? null,
      menuItemId: menuItemId ?? null,
      cakeName: String(cakeName).trim(),
      sizeLabel: sizeLabel ?? null,
      flavor: flavor ?? null,
      quantity: Number(quantity) || 1,
      designNotes: designNotes ?? null,
      referenceImageUrl: referenceImageUrl ?? null,
      deliveryAt: dt,
      deliveryAddress: deliveryAddress ?? null,
      isPickup: isPickup !== false,
      totalAmount: money(Number(totalAmount) || 0),
      advanceAmount: money(Number(advanceAmount) || 0),
      notes: notes ?? null,
      createdBy: req.user?.sub ?? null,
    }).returning();
    res.status(201).json(b);
  },
);

router.patch(
  "/restaurants/:restaurantId/bakery/bookings/:id",
  requireRole("owner", "manager", "waiter", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const [existing] = await db.select().from(cakeBookingsTable)
      .where(and(eq(cakeBookingsTable.id, id), eq(cakeBookingsTable.restaurantId, restaurantId)));
    if (!existing) return void res.status(404).json({ error: "Booking not found" });

    const updates: Record<string, unknown> = {};
    const fields = ["customerName", "customerPhone", "customerEmail", "cakeName", "sizeLabel", "flavor", "designNotes", "referenceImageUrl", "deliveryAddress", "isPickup", "notes", "menuItemId", "customerId"];
    for (const k of fields) if (k in req.body) updates[k] = req.body[k];
    if ("quantity" in req.body) updates.quantity = Number(req.body.quantity) || 1;
    if ("totalAmount" in req.body) updates.totalAmount = money(Number(req.body.totalAmount) || 0);
    if ("advanceAmount" in req.body) updates.advanceAmount = money(Number(req.body.advanceAmount) || 0);
    if ("deliveryAt" in req.body) {
      const dt = new Date(req.body.deliveryAt);
      if (Number.isNaN(dt.getTime())) return void res.status(400).json({ error: "Invalid deliveryAt" });
      updates.deliveryAt = dt;
    }
    if ("status" in req.body) {
      const next = String(req.body.status);
      if (!CAKE_STATUSES.has(next)) return void res.status(400).json({ error: "Invalid status" });
      const allowed = CAKE_TRANSITIONS[existing.status] ?? [];
      if (existing.status !== next && !allowed.includes(next)) {
        return void res.status(409).json({ error: `Cannot transition from ${existing.status} to ${next}` });
      }
      updates.status = next;
    }
    updates.updatedAt = new Date();
    const [updated] = await db.update(cakeBookingsTable).set(updates)
      .where(eq(cakeBookingsTable.id, id))
      .returning();
    res.json(updated);
  },
);

router.delete(
  "/restaurants/:restaurantId/bakery/bookings/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    await db.delete(cakeBookingsTable)
      .where(and(eq(cakeBookingsTable.id, id), eq(cakeBookingsTable.restaurantId, restaurantId)));
    res.status(204).end();
  },
);

// Advance payment intent (Stripe)
router.post(
  "/restaurants/:restaurantId/bakery/bookings/:id/payment-intent",
  requireRole("owner", "manager", "waiter", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { amount } = req.body ?? {};
    const [b] = await db.select().from(cakeBookingsTable)
      .where(and(eq(cakeBookingsTable.id, id), eq(cakeBookingsTable.restaurantId, restaurantId)));
    if (!b) return void res.status(404).json({ error: "Booking not found" });
    const amountPaise = Math.round((Number(amount) || Number(b.advanceAmount)) * 100);
    if (amountPaise <= 0) return void res.status(400).json({ error: "amount required" });
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (stripeSecretKey) {
      try {
        const stripe = new Stripe(stripeSecretKey);
        const intent = await stripe.paymentIntents.create({
          amount: amountPaise,
          currency: "inr",
          metadata: { cakeBookingId: String(id), restaurantId: String(restaurantId) },
        });
        return res.json({ clientSecret: intent.client_secret, intentId: intent.id, mode: "live" });
      } catch {
        return void res.status(500).json({ error: "Failed to create payment intent" });
      }
    }
    return res.json({
      clientSecret: null,
      intentId: `demo_pi_cake_${id}_${Date.now()}`,
      mode: "demo",
      amount: (amountPaise / 100).toFixed(2),
    });
  },
);

// Razorpay order for cashfree-equivalent fallback (we use Razorpay primarily for INR)
router.post(
  "/restaurants/:restaurantId/bakery/bookings/:id/razorpay-order",
  requireRole("owner", "manager", "waiter", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { amount } = req.body ?? {};
    const [b] = await db.select().from(cakeBookingsTable)
      .where(and(eq(cakeBookingsTable.id, id), eq(cakeBookingsTable.restaurantId, restaurantId)));
    if (!b) return void res.status(404).json({ error: "Booking not found" });
    const amountPaise = Math.round((Number(amount) || Number(b.advanceAmount)) * 100);
    if (amountPaise <= 0) return void res.status(400).json({ error: "amount required" });
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (keyId && keySecret) {
      try {
        const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
        const r = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify({ amount: amountPaise, currency: "INR", notes: { cakeBookingId: String(id), restaurantId: String(restaurantId) } }),
        });
        if (!r.ok) return void res.status(502).json({ error: "Razorpay order creation failed" });
        const order = await r.json() as { id: string; amount: number; currency: string };
        return res.json({ id: order.id, amount: order.amount, currency: order.currency, keyId, mode: "live" });
      } catch {
        return void res.status(500).json({ error: "Failed to create Razorpay order" });
      }
    }
    return res.json({ id: `demo_rzp_cake_${id}_${Date.now()}`, amount: amountPaise, currency: "INR", keyId: null, mode: "demo" });
  },
);

// Confirm advance payment was received (cash or via gateway)
router.post(
  "/restaurants/:restaurantId/bakery/bookings/:id/confirm-payment",
  requireRole("owner", "manager", "waiter", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { amount, method, reference } = req.body ?? {};
    const [b] = await db.select().from(cakeBookingsTable)
      .where(and(eq(cakeBookingsTable.id, id), eq(cakeBookingsTable.restaurantId, restaurantId)));
    if (!b) return void res.status(404).json({ error: "Booking not found" });
    const paid = Number(b.paidAmount) + (Number(amount) || 0);
    const [updated] = await db.update(cakeBookingsTable).set({
      paidAmount: money(paid),
      advanceMethod: method ?? b.advanceMethod ?? "cash",
      advanceReference: reference ?? b.advanceReference,
      status: b.status === "new" ? "confirmed" : b.status,
      updatedAt: new Date(),
    }).where(eq(cakeBookingsTable.id, id)).returning();
    res.json(updated);
  },
);

// ─────────────────────────── Ingredient forecast ───────────────────────────

router.get("/restaurants/:restaurantId/bakery/forecast", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = req.query;
  const fromDt = from ? new Date(String(from)) : new Date();
  const toDt = to ? new Date(String(to)) : new Date(fromDt.getTime() + 7 * 86400_000);

  // Sum planned quantities across all plan items in the date range
  const planned = await db.select({
    menuItemId: productionPlanItemsTable.menuItemId,
    qty: sql<string>`COALESCE(SUM(${productionPlanItemsTable.plannedQuantity} - ${productionPlanItemsTable.producedQuantity}), 0)`,
  })
    .from(productionPlanItemsTable)
    .leftJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .where(and(
      eq(productionPlanItemsTable.restaurantId, restaurantId),
      gte(productionPlansTable.planDate, fromDt),
      lte(productionPlansTable.planDate, toDt),
    ))
    .groupBy(productionPlanItemsTable.menuItemId);

  // Add cake bookings due in range that don't yet have a plan item
  const bookings = await db.select({ menuItemId: cakeBookingsTable.menuItemId, qty: cakeBookingsTable.quantity })
    .from(cakeBookingsTable)
    .where(and(
      eq(cakeBookingsTable.restaurantId, restaurantId),
      inArray(cakeBookingsTable.status, ["confirmed", "in_production"]),
      gte(cakeBookingsTable.deliveryAt, fromDt),
      lte(cakeBookingsTable.deliveryAt, toDt),
    ));

  const itemQty = new Map<number, number>();
  for (const p of planned) itemQty.set(p.menuItemId, (itemQty.get(p.menuItemId) ?? 0) + Number(p.qty));
  for (const b of bookings) {
    if (b.menuItemId) itemQty.set(b.menuItemId, (itemQty.get(b.menuItemId) ?? 0) + Number(b.qty));
  }

  if (itemQty.size === 0) return void res.json({ ingredients: [], from: fromDt, to: toDt });

  const itemIds = Array.from(itemQty.keys());
  const recipes = await db.select().from(recipeMappingsTable)
    .where(and(eq(recipeMappingsTable.restaurantId, restaurantId), inArray(recipeMappingsTable.menuItemId, itemIds)));

  const ingredientMap = new Map<number, { required: number }>();
  for (const r of recipes) {
    const need = Number(r.quantity) * (itemQty.get(r.menuItemId) ?? 0);
    const cur = ingredientMap.get(r.inventoryItemId)?.required ?? 0;
    ingredientMap.set(r.inventoryItemId, { required: cur + need });
  }

  if (ingredientMap.size === 0) return void res.json({ ingredients: [], from: fromDt, to: toDt });

  const ingredientIds = Array.from(ingredientMap.keys());
  const stocks = await db.select().from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.restaurantId, restaurantId), inArray(inventoryItemsTable.id, ingredientIds)));

  const result = stocks.map(s => {
    const required = ingredientMap.get(s.id)?.required ?? 0;
    const onHand = Number(s.currentStock);
    return {
      inventoryItemId: s.id,
      name: s.name,
      unit: s.unit,
      required: toDecimal(required),
      onHand: toDecimal(onHand),
      shortfall: toDecimal(Math.max(0, required - onHand)),
      supplierId: s.supplierId,
      costPerUnit: s.costPerUnit,
    };
  }).sort((a, b) => Number(b.shortfall) - Number(a.shortfall));

  res.json({ ingredients: result, from: fromDt, to: toDt });
});

router.post(
  "/restaurants/:restaurantId/bakery/forecast/create-po",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { items, supplierId, notes } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) return void res.status(400).json({ error: "items required" });

    const [po] = await db.insert(purchaseOrdersTable).values({
      restaurantId,
      supplierId: supplierId ?? null,
      status: "pending",
      notes: notes ?? "Generated from bakery ingredient forecast",
      isAutoDrafted: true,
      draftedAt: new Date(),
    }).returning();

    let total = 0;
    for (const it of items) {
      const qty = Number(it.quantity) || 0;
      const cost = Number(it.costPerUnit) || 0;
      total += qty * cost;
      await db.insert(purchaseOrderItemsTable).values({
        purchaseOrderId: po.id,
        inventoryItemId: it.inventoryItemId ?? null,
        name: String(it.name ?? "Item"),
        unit: String(it.unit ?? "kg"),
        quantity: toDecimal(qty),
        costPerUnit: money(cost),
      });
    }
    await db.update(purchaseOrdersTable).set({ totalAmount: money(total) }).where(eq(purchaseOrdersTable.id, po.id));

    res.status(201).json({ purchaseOrderId: po.id });
  },
);

// ─────────────────────────── Production Report ───────────────────────────

router.get("/restaurants/:restaurantId/bakery/report", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = req.query;
  const fromDt = from ? new Date(String(from)) : new Date(Date.now() - 7 * 86400_000);
  const toDt = to ? new Date(String(to)) : new Date();

  const planRows = await db.select({
    menuItemId: productionPlanItemsTable.menuItemId,
    name: menuItemsTable.name,
    planned: sql<string>`COALESCE(SUM(${productionPlanItemsTable.plannedQuantity}), 0)`,
    produced: sql<string>`COALESCE(SUM(${productionPlanItemsTable.producedQuantity}), 0)`,
  })
    .from(productionPlanItemsTable)
    .leftJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .leftJoin(menuItemsTable, eq(productionPlanItemsTable.menuItemId, menuItemsTable.id))
    .where(and(
      eq(productionPlanItemsTable.restaurantId, restaurantId),
      gte(productionPlansTable.planDate, fromDt),
      lte(productionPlansTable.planDate, toDt),
    ))
    .groupBy(productionPlanItemsTable.menuItemId, menuItemsTable.name);

  const wastageRows = await db.select({
    menuItemId: finishedGoodsWastageTable.menuItemId,
    name: menuItemsTable.name,
    qty: sql<string>`COALESCE(SUM(${finishedGoodsWastageTable.quantity}), 0)`,
    cost: sql<string>`COALESCE(SUM(${finishedGoodsWastageTable.quantity} * COALESCE(${finishedGoodsBatchesTable.unitCost}, 0)), 0)`,
  })
    .from(finishedGoodsWastageTable)
    .leftJoin(finishedGoodsBatchesTable, eq(finishedGoodsWastageTable.batchId, finishedGoodsBatchesTable.id))
    .leftJoin(menuItemsTable, eq(finishedGoodsWastageTable.menuItemId, menuItemsTable.id))
    .where(and(
      eq(finishedGoodsWastageTable.restaurantId, restaurantId),
      gte(finishedGoodsWastageTable.createdAt, fromDt),
      lte(finishedGoodsWastageTable.createdAt, toDt),
    ))
    .groupBy(finishedGoodsWastageTable.menuItemId, menuItemsTable.name);

  const bookingRows = await db.select({
    status: cakeBookingsTable.status,
    cnt: sql<number>`COUNT(*)::int`,
  })
    .from(cakeBookingsTable)
    .where(and(
      eq(cakeBookingsTable.restaurantId, restaurantId),
      gte(cakeBookingsTable.deliveryAt, fromDt),
      lte(cakeBookingsTable.deliveryAt, toDt),
    ))
    .groupBy(cakeBookingsTable.status);

  const totalWastageCost = wastageRows.reduce((s, r) => s + Number(r.cost), 0);

  res.json({
    from: fromDt,
    to: toDt,
    production: planRows,
    wastage: wastageRows,
    totalWastageCost: money(totalWastageCost),
    bookings: bookingRows,
  });
});

// ─────────────────────────── POS FEFO helper ───────────────────────────

router.get(
  "/restaurants/:restaurantId/bakery/items/:menuItemId/active-batches",
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const menuItemId = Number(req.params.menuItemId);
    const rows = await db.select().from(finishedGoodsBatchesTable)
      .where(and(
        eq(finishedGoodsBatchesTable.restaurantId, restaurantId),
        eq(finishedGoodsBatchesTable.menuItemId, menuItemId),
        eq(finishedGoodsBatchesTable.status, "active"),
      ))
      .orderBy(asc(finishedGoodsBatchesTable.expiryAt));
    res.json(rows.filter(r => Number(r.quantityRemaining) > 0));
  },
);

// Decrement a batch (called by POS on sale)
router.post(
  "/restaurants/:restaurantId/bakery/batches/:id/decrement",
  requireRole("owner", "manager", "waiter", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const batchId = Number(req.params.id);
    const { quantity, orderId } = req.body ?? {};
    const qty = Number(quantity) || 0;
    if (qty <= 0) return void res.status(400).json({ error: "quantity required" });
    const [batch] = await db.select().from(finishedGoodsBatchesTable)
      .where(and(eq(finishedGoodsBatchesTable.id, batchId), eq(finishedGoodsBatchesTable.restaurantId, restaurantId)));
    if (!batch) return void res.status(404).json({ error: "Batch not found" });
    const newRemaining = Math.max(0, Number(batch.quantityRemaining) - qty);
    const [updated] = await db.update(finishedGoodsBatchesTable).set({
      quantityRemaining: toDecimal(newRemaining),
      status: newRemaining === 0 ? "depleted" : batch.status,
      updatedAt: new Date(),
    }).where(eq(finishedGoodsBatchesTable.id, batchId)).returning();
    if (orderId) {
      // log inventory transaction reference
      await db.insert(inventoryTransactionsTable).values({
        itemId: 0, // not an inventory item; reference for trail only
        restaurantId,
        type: "fg_sale",
        quantity: toDecimal(-qty),
        notes: `FEFO sale from batch ${batch.batchNumber}`,
        referenceId: Number(orderId),
        referenceType: "order",
      }).catch(() => {});
    }
    res.json(updated);
  },
);

// ─────────────────────────── Public cake booking (mobile/customer) ───────────────────────────

const publicRouter = Router();

publicRouter.get("/public/restaurants/:restaurantId/bakery/cakes", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [r] = await db.select({ enabled: restaurantsTable.bakeryModeEnabled }).from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  if (!r?.enabled) return void res.json({ enabled: false, items: [] });
  const items = await db.select({
    id: menuItemsTable.id,
    name: menuItemsTable.name,
    description: menuItemsTable.description,
    price: menuItemsTable.price,
    imageUrl: menuItemsTable.imageUrl,
    sizeLabel: menuItemsTable.sku,
    flavor: menuItemsTable.tags,
  }).from(menuItemsTable)
    .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
    .where(and(
      eq(menuItemsTable.restaurantId, restaurantId),
      eq(menuItemsTable.isCake, true),
      eq(menuItemsTable.isAvailable, true),
    ))
    .limit(200);
  res.json({ enabled: true, items });
});

publicRouter.post("/public/restaurants/:restaurantId/bakery/bookings", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [r] = await db.select({ enabled: restaurantsTable.bakeryModeEnabled }).from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  if (!r?.enabled) return void res.status(403).json({ error: "Bakery mode not enabled" });
  const {
    customerName, customerPhone, customerEmail,
    menuItemId, cakeName, sizeLabel, flavor, quantity,
    designNotes, referenceImageUrl,
    deliveryAt, deliveryAddress, isPickup,
    totalAmount, advanceAmount,
  } = req.body ?? {};
  if (!customerName || !customerPhone) return void res.status(400).json({ error: "customerName and customerPhone required" });
  if (!cakeName) return void res.status(400).json({ error: "cakeName required" });
  if (!deliveryAt) return void res.status(400).json({ error: "deliveryAt required" });
  const dt = new Date(deliveryAt);
  if (Number.isNaN(dt.getTime())) return void res.status(400).json({ error: "Invalid deliveryAt" });

  // Find or create customer
  let customerId: number | null = null;
  const [existing] = await db.select().from(customersTable)
    .where(and(eq(customersTable.restaurantId, restaurantId), eq(customersTable.phone, String(customerPhone))));
  if (existing) customerId = existing.id;
  else {
    const [c] = await db.insert(customersTable).values({
      restaurantId,
      name: String(customerName).trim(),
      phone: String(customerPhone),
      email: customerEmail ?? null,
    }).returning();
    customerId = c.id;
  }

  const bookingNumber = `CK-${Date.now().toString(36).toUpperCase()}`;
  const [b] = await db.insert(cakeBookingsTable).values({
    restaurantId,
    bookingNumber,
    customerId,
    customerName: String(customerName).trim(),
    customerPhone: String(customerPhone),
    customerEmail: customerEmail ?? null,
    menuItemId: menuItemId ?? null,
    cakeName: String(cakeName).trim(),
    sizeLabel: sizeLabel ?? null,
    flavor: flavor ?? null,
    quantity: Number(quantity) || 1,
    designNotes: designNotes ?? null,
    referenceImageUrl: referenceImageUrl ?? null,
    deliveryAt: dt,
    deliveryAddress: deliveryAddress ?? null,
    isPickup: isPickup !== false,
    totalAmount: money(Number(totalAmount) || 0),
    advanceAmount: money(Number(advanceAmount) || 0),
  }).returning();

  // Notify restaurant
  await db.insert(notificationsTable).values({
    restaurantId,
    type: "system_error",
    title: "New cake pre-order",
    message: `${customerName} booked ${cakeName} for ${dt.toLocaleString("en-IN")}`,
  }).catch(() => {});

  res.status(201).json(b);
});

// Shelf-life sweep (called by scheduler)
export async function runBakeryShelfLifeSweep(now: Date = new Date()): Promise<{ batchAlerts: number; bookingAlerts: number; expired: number }> {
  let batchAlerts = 0, bookingAlerts = 0, expired = 0;

  // Mark expired batches
  const expRows = await db.update(finishedGoodsBatchesTable)
    .set({ status: "expired", updatedAt: now })
    .where(and(
      eq(finishedGoodsBatchesTable.status, "active"),
      lte(finishedGoodsBatchesTable.expiryAt, now),
    ))
    .returning({ id: finishedGoodsBatchesTable.id });
  expired = expRows.length;

  // Per-restaurant alerts
  const restaurants = await db.select({
    id: restaurantsTable.id,
    expiryAlert: restaurantsTable.bakeryExpiryAlertHours,
    bookingAlert: restaurantsTable.bakeryBookingAlertHours,
  }).from(restaurantsTable).where(eq(restaurantsTable.bakeryModeEnabled, true));

  for (const r of restaurants) {
    const expiryWindow = new Date(now.getTime() + (r.expiryAlert ?? 6) * 3600_000);
    const expiringBatches = await db.select({
      id: finishedGoodsBatchesTable.id,
      batchNumber: finishedGoodsBatchesTable.batchNumber,
      expiryAt: finishedGoodsBatchesTable.expiryAt,
      menuItemName: menuItemsTable.name,
    }).from(finishedGoodsBatchesTable)
      .leftJoin(menuItemsTable, eq(finishedGoodsBatchesTable.menuItemId, menuItemsTable.id))
      .where(and(
        eq(finishedGoodsBatchesTable.restaurantId, r.id),
        eq(finishedGoodsBatchesTable.status, "active"),
        gte(finishedGoodsBatchesTable.expiryAt, now),
        lte(finishedGoodsBatchesTable.expiryAt, expiryWindow),
      ));
    for (const b of expiringBatches) {
      await db.insert(notificationsTable).values({
        restaurantId: r.id,
        type: "stock_alert",
        title: "Batch expiring soon",
        message: `${b.menuItemName ?? "Item"} batch ${b.batchNumber} expires at ${b.expiryAt?.toLocaleString("en-IN")}`,
      }).catch(() => {});
      batchAlerts++;
    }

    const bookingWindow = new Date(now.getTime() + (r.bookingAlert ?? 24) * 3600_000);
    const dueBookings = await db.select().from(cakeBookingsTable)
      .where(and(
        eq(cakeBookingsTable.restaurantId, r.id),
        inArray(cakeBookingsTable.status, ["confirmed", "in_production", "ready"]),
        gte(cakeBookingsTable.deliveryAt, now),
        lte(cakeBookingsTable.deliveryAt, bookingWindow),
      ));
    for (const b of dueBookings) {
      await db.insert(notificationsTable).values({
        restaurantId: r.id,
        type: "system_error",
        title: "Cake booking due soon",
        message: `${b.cakeName} for ${b.customerName} due ${b.deliveryAt.toLocaleString("en-IN")}`,
      }).catch(() => {});
      bookingAlerts++;
    }
  }

  return { batchAlerts, bookingAlerts, expired };
}

export { publicRouter as bakeryPublicRouter };
export default router;
