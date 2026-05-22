import { Router } from "express";
import { eq, and, desc, count, ne, notInArray, inArray, sql } from "drizzle-orm";
import Stripe from "stripe";
import { db, ordersTable, orderItemsTable, orderItemModifiersTable, kitchenTicketsTable, kitchensTable, menuItemsTable, menuItemVariantsTable, floorTablesTable, restaurantsTable, recipeMappingsTable, inventoryItemsTable, inventoryTransactionsTable, notificationsTable, customersTable, loyaltyTransactionsTable, couponsTable, paymentsTable, orderDiscountsTable, discountApprovalsTable, hotelStaysTable, hotelFoliosTable, hotelFolioLinesTable, vipAlertsTable, cartSessionsTable, usersTable, tenantsTable, subscriptionPlansTable, serviceTimerEventsTable, auditLogsTable, isFeatureEnabled, tipPoolsTable, tipPoolEntriesTable } from "../lib/db";
import { recordAuditLog } from "../lib/audit";
import { toE164 } from "@workspace/phone-utils";
import { triggerAutoPost } from "./accounting-books";

// Lightweight per-request feature check (used to gate optional order-lifecycle
// side effects so plans without the entitlement see no behavior change).
const _featureCache = new Map<string, { ok: boolean; at: number }>();
async function restaurantHasFeature(restaurantId: number, key: string): Promise<boolean> {
  const cacheKey = `${restaurantId}:${key}`;
  const hit = _featureCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  const [row] = await db.select({ planId: tenantsTable.planId })
    .from(restaurantsTable)
    .innerJoin(tenantsTable, eq(restaurantsTable.tenantId, tenantsTable.id))
    .where(eq(restaurantsTable.id, restaurantId));
  if (!row?.planId) { _featureCache.set(cacheKey, { ok: true, at: Date.now() }); return true; }
  const [plan] = await db.select({ flags: subscriptionPlansTable.featureFlags })
    .from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, row.planId));
  const ok = !plan ? true : isFeatureEnabled(plan.flags, key);
  _featureCache.set(cacheKey, { ok, at: Date.now() });
  return ok;
}

/**
 * Record a service-timer stage transition for an order. Best-effort — any
 * failure (e.g. ops_event_timeline not enabled / table missing) is logged
 * but never blocks the operational write that triggered it. Computes the
 * delta from the previous event so dashboards can chart per-stage SLAs.
 */
async function recordTimerStage(restaurantId: number, orderId: number, stage: string): Promise<void> {
  try {
    const [prev] = await db.select().from(serviceTimerEventsTable)
      .where(and(eq(serviceTimerEventsTable.orderId, orderId), eq(serviceTimerEventsTable.restaurantId, restaurantId)))
      .orderBy(desc(serviceTimerEventsTable.occurredAt)).limit(1);
    const now = new Date();
    const durationMs = prev ? now.getTime() - new Date(prev.occurredAt).getTime() : null;
    await db.insert(serviceTimerEventsTable).values({ restaurantId, orderId, stage, occurredAt: now, durationMs });
  } catch (err) {
    // Swallow — operational writes never block on telemetry.
    void err;
  }
}
import { verifyManagerDiscountOtp } from "../lib/managerOtp";
import { requireRole } from "../middleware/authorize";
import { requirePlanFeature } from "../middleware/planFeature";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { idempotency } from "../middleware/idempotency";
import { broadcastEvent, broadcastOrderUpdate } from "../lib/socketio";
import { emitWebhookEvent } from "../lib/webhookDispatcher";
import { pushToStaff } from "../lib/pushNotify";
import { createKitchenTicketsForOrder, ensureTicketForAddedItem } from "../lib/kitchenRouting";
import { recordVariantPour } from "./bar";
import { issueTokenForOrder, syncTokenWithTickets } from "../lib/tokens";
import { sendEmail, sendWhatsApp, orderConfirmationEmail } from "../lib/notifications";
import { sendWebPush } from "../lib/webPush";
import { requireOpenCashRegister, recordCashSaleMovement, lockOpenCashRegister } from "./cash-register";
import { loadLoyaltyConfig, pickTier, computeEarnedPoints, computeRedemptionDiscount, computeExpiryDate, getLifetimeEarned } from "../lib/loyalty";
import { loadDiscountsConfig, exceedsThreshold, exceedsRoleCap, verifyManagerPin, sumOrderDiscounts, listOrderDiscounts, deleteOrderDiscountsByType } from "../lib/discounts";
import { resolveOrderItemUnitPrice } from "../lib/pricingRules";
import { pricingRuleApplicationsTable } from "../lib/db";
import { enrichModifierSelections, deductInventoryForModifiers, type ModifierSelectionInput, type EnrichedModifier } from "../lib/modifierEnrichment";

async function deductInventoryForOrder(orderId: number, restaurantId: number): Promise<void> {
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  // Modifier-level deduction: gather all selected modifiers for this order and
  // apply modifier_inventory_mappings against current stock. Mirrors menu-item
  // recipe_mappings deduction below.
  const itemIds = items.map(i => i.id);
  const modRows = itemIds.length > 0
    ? await db.select().from(orderItemModifiersTable).where(inArray(orderItemModifiersTable.orderItemId, itemIds))
    : [];
  const modsByOrderItem = new Map<number, typeof modRows>();
  for (const m of modRows) {
    const arr = modsByOrderItem.get(m.orderItemId) ?? [];
    arr.push(m);
    modsByOrderItem.set(m.orderItemId, arr);
  }
  await deductInventoryForModifiers(
    restaurantId,
    orderId,
    items.map(it => ({
      lineQty: it.quantity,
      modifiers: (modsByOrderItem.get(it.id) ?? []).map(m => ({
        modifierId: m.modifierId ?? null,
        quantity: m.quantity ?? 1,
      })),
    })),
  );

  for (const item of items) {
    const mappings = await db.select().from(recipeMappingsTable).where(
      and(eq(recipeMappingsTable.menuItemId, item.menuItemId), eq(recipeMappingsTable.restaurantId, restaurantId))
    );
    for (const mapping of mappings) {
      const totalDeduct = Number(mapping.quantity) * item.quantity;
      if (!Number.isFinite(totalDeduct) || totalDeduct <= 0) continue;
      // Atomically decrement (clamped to 0) under a row lock so concurrent
      // orders for the same inventory item cannot lose updates / oversell.
      // Returns the post-update row so we know whether to fire a low-stock alert.
      const updated = await db.transaction(async (tx) => {
        const [inv] = await tx.select().from(inventoryItemsTable).where(
          and(eq(inventoryItemsTable.id, mapping.inventoryItemId), eq(inventoryItemsTable.restaurantId, restaurantId))
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
          notes: `Auto-deducted for order #${orderId}`,
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

async function earnLoyaltyForOrder(paidOrder: typeof ordersTable.$inferSelect, restaurantId: number): Promise<void> {
  if (!paidOrder.customerId) return;
  const customerId = paidOrder.customerId;
  const pointsRedeemed = paidOrder.loyaltyPointsRedeemed ?? 0;

  const [customer] = await db.select({ loyaltyPoints: customersTable.loyaltyPoints, totalOrders: customersTable.totalOrders, totalSpent: customersTable.totalSpent }).from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!customer) return;

  const cfg = await loadLoyaltyConfig(restaurantId);

  const txns: Array<typeof loyaltyTransactionsTable.$inferInsert> = [];
  let balanceDelta = 0;

  if (cfg.enabled) {
    const lifetime = await getLifetimeEarned(customerId, restaurantId);
    const tier = pickTier(lifetime, cfg.tiers);
    // Earn on the pre-discount subtotal so discounts/redemptions don't reduce earning.
    const earnableAmount = Number(paidOrder.subtotal);
    const pointsEarned = computeEarnedPoints(earnableAmount, cfg, tier);
    if (pointsEarned > 0) {
      const expiresAt = computeExpiryDate(cfg);
      txns.push({ customerId, restaurantId, points: pointsEarned, type: "earn", reason: `Order #${paidOrder.orderNumber}${tier.multiplier && tier.multiplier !== 1 ? ` (${tier.name} ×${tier.multiplier})` : ""}`, orderId: paidOrder.id, expiresAt });
      balanceDelta += pointsEarned;
    }
  }

  if (pointsRedeemed > 0) {
    const deduct = Math.min(pointsRedeemed, customer.loyaltyPoints + balanceDelta);
    if (deduct > 0) {
      txns.push({ customerId, restaurantId, points: -deduct, type: "redeem", reason: `Redeemed for order #${paidOrder.orderNumber}`, orderId: paidOrder.id });
      balanceDelta -= deduct;
    }
  }

  if (txns.length > 0) await db.insert(loyaltyTransactionsTable).values(txns);
  // Maintain CRM-derived activity: firstOrderAt is set once; lastVisitAt is
  // refreshed every paid order so the profile/list stays accurate without a
  // full orders scan.
  const now = new Date();
  await db.execute(sql`
    UPDATE customers SET
      loyalty_points = ${Math.max(0, customer.loyaltyPoints + balanceDelta)},
      total_orders = total_orders + 1,
      total_spent = (total_spent::numeric + ${Number(paidOrder.totalAmount)}::numeric)::text,
      first_order_at = COALESCE(first_order_at, ${now}),
      last_visit_at = ${now},
      updated_at = ${now}
    WHERE id = ${customerId}
  `);
}

async function updateCouponUsage(couponCode: string | null, restaurantId: number): Promise<void> {
  if (!couponCode) return;
  const [coupon] = await db.select({ id: couponsTable.id, usageCount: couponsTable.usageCount }).from(couponsTable)
    .where(and(eq(couponsTable.code, couponCode.toUpperCase()), eq(couponsTable.restaurantId, restaurantId)));
  if (coupon) {
    await db.update(couponsTable).set({ usageCount: coupon.usageCount + 1, updatedAt: new Date() })
      .where(eq(couponsTable.id, coupon.id));
  }
}

async function sendOrderConfirmation(paidOrder: typeof ordersTable.$inferSelect, restaurantId: number): Promise<void> {
  let customer: { name: string | null; email: string | null; phone: string | null } | undefined;
  if (paidOrder.customerId) {
    const [c] = await db.select({ name: customersTable.name, email: customersTable.email, phone: customersTable.phone }).from(customersTable).where(eq(customersTable.id, paidOrder.customerId));
    if (c) customer = c;
  }
  // Fall back to the guest-order fields so QR / public orders without a
  // linked customer record still get a final confirmation message.
  if (!customer) {
    customer = {
      name: paidOrder.customerName ?? null,
      email: null,
      phone: paidOrder.customerPhone ?? null,
    };
  }
  if (!customer.email && !customer.phone) return;
  const [restaurant] = await db.select({ name: restaurantsTable.name }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  const orderItems = await db.select({ name: orderItemsTable.menuItemName, qty: orderItemsTable.quantity }).from(orderItemsTable).where(eq(orderItemsTable.orderId, paidOrder.id));
  const itemStrings = orderItems.map(i => `${i.name} x${i.qty}`);
  if (customer.email) {
    const { sendByTemplateKey } = await import("../lib/emailSender");
    const itemList = `<ul>${itemStrings.map(i => `<li>${i}</li>`).join("")}</ul>`;
    sendByTemplateKey("customer_order_confirmation", customer.email, {
      name: customer.name,
      orderNumber: paidOrder.orderNumber,
      restaurant: restaurant?.name ?? "Restaurant",
      currency: "INR",
      amount: Number(paidOrder.totalAmount).toFixed(2),
      itemList,
      orderUrl: `${process.env.APP_URL ?? ""}/orders/${paidOrder.id}`,
    }, { restaurantId, recipientType: "customer" }).catch(console.error);
  }
  if (customer.phone) {
    const safeName = customer.name ?? paidOrder.customerName ?? "there";
    const total = Number(paidOrder.totalAmount).toFixed(2);
    const restName = restaurant?.name ?? "our restaurant";
    const { renderRestaurantEventBody } = await import("../lib/whatsappEventTemplate");
    const rendered = await renderRestaurantEventBody(restaurantId, "order.confirmed",
      [safeName, paidOrder.orderNumber, restName, `₹${total}`, ""]);
    const msg = rendered
      ?? `Hi ${safeName}, your order #${paidOrder.orderNumber} at ${restName} is confirmed. Total: ₹${total}. Thank you!`;
    // Normalize to strict E.164 so WhatsApp / SMS providers accept the recipient.
    const [rCountry] = await db.select({ country: restaurantsTable.country }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
    const to = toE164(customer.phone, rCountry?.country ?? null) ?? customer.phone;
    sendWhatsApp({ to, body: msg, restaurantId, meta: { event: "order.confirmed", orderId: paidOrder.id } }).catch(console.error);
  }
}

async function handleOrderCompletion(orderId: number, restaurantId: number, paidOrder: typeof ordersTable.$inferSelect): Promise<void> {
  await Promise.allSettled([
    deductInventoryForOrder(orderId, restaurantId).catch(async (err) => {
      console.error(`[OrderCompletion] Inventory deduction failed for order ${orderId}:`, err);
      await db.insert(notificationsTable).values({
        restaurantId,
        type: "system_error",
        title: "Inventory Deduction Failed",
        message: `Auto-deduction failed for order #${paidOrder.orderNumber}. Please adjust stock manually.`,
        entityId: orderId,
        entityType: "order",
      }).catch(() => {});
    }),
    earnLoyaltyForOrder(paidOrder, restaurantId).catch((err) => {
      console.error(`[OrderCompletion] Loyalty earn failed for order ${orderId}:`, err);
    }),
    (async () => {
      try {
        const { runOrderPaidPipeline } = await import("../lib/loyalty/pipeline");
        await runOrderPaidPipeline({ restaurantId, order: paidOrder });
      } catch (err) {
        console.error(`[OrderCompletion] Loyalty 2.0 pipeline failed for order ${orderId}:`, err);
      }
    })(),
    updateCouponUsage(paidOrder.couponCode, restaurantId).catch((err) => {
      console.error(`[OrderCompletion] Coupon usage update failed for order ${orderId}:`, err);
    }),
    sendOrderConfirmation(paidOrder, restaurantId).catch((err) => {
      console.error(`[OrderCompletion] Order confirmation notification failed for order ${orderId}:`, err);
    }),
  ]);
}

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "waiter", "cashier", "kitchen", "delivery_executive", "super_admin"), validateRestaurantAccess);

function generateOrderNumber(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}`;
}

async function getRestaurantRates(restaurantId: number) {
  const [row] = await db
    .select({ taxRate: restaurantsTable.taxRate, serviceCharge: restaurantsTable.serviceCharge })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  return {
    taxRate: Number(row?.taxRate ?? 5) / 100,
    serviceRate: Number(row?.serviceCharge ?? 0) / 100,
  };
}

async function recalculateOrderTotals(orderId: number, restaurantId: number) {
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const subtotal = items.reduce((s, i) => s + Number(i.totalPrice), 0);
  const { taxRate, serviceRate } = await getRestaurantRates(restaurantId);
  const taxAmount = subtotal * taxRate;
  const serviceCharge = subtotal * serviceRate;
  const discountAmount = await sumOrderDiscounts(orderId);
  const totalAmount = Math.max(0, subtotal + taxAmount + serviceCharge - discountAmount);
  await db.update(ordersTable).set({
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    serviceCharge: serviceCharge.toFixed(2),
    discountAmount: discountAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    updatedAt: new Date(),
  }).where(eq(ordersTable.id, orderId));
  return { subtotal, taxAmount, serviceCharge, discountAmount, totalAmount };
}

router.get("/restaurants/:restaurantId/orders", async (req, res) => {
  const { status, tableId, customerId, page, limit } = req.query;
  const pg = Number(page) || 1;
  const lim = Number(limit) || 50;
  const offset = (pg - 1) * lim;
  const restaurantId = Number(req.params.restaurantId);

  const conditions: ReturnType<typeof eq>[] = [eq(ordersTable.restaurantId, restaurantId)];
  if (status) conditions.push(eq(ordersTable.status, String(status)));
  if (tableId) conditions.push(eq(ordersTable.tableId, Number(tableId)));
  if (customerId) conditions.push(eq(ordersTable.customerId, Number(customerId)));

  const [rows, totalRows] = await Promise.all([
    db.select().from(ordersTable).where(and(...conditions)).orderBy(desc(ordersTable.createdAt)).limit(lim).offset(offset),
    db.select({ count: count() }).from(ordersTable).where(and(...conditions)),
  ]);
  res.json({ data: rows, total: totalRows[0]?.count ?? 0 });
});

router.post("/restaurants/:restaurantId/orders", idempotency(), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const {
    tableId, orderType, notes, customerName, customerPhone, customerId, isPriority, items, branchId,
    hotelStayId, banquetEventId,
    brandId, channelKey, channelExternalOrderId,
    vehicleColor, vehicleModel, vehicleNumber, parkingSpot,
  } = req.body;

  if (orderType === "curbside") {
    const okFeat = await restaurantHasFeature(restaurantId, "dlv_curbside_pickup");
    if (!okFeat) return void res.status(403).json({ error: "Curbside pickup is not enabled on this plan." });
    if (!customerPhone || !vehicleColor || !vehicleModel) {
      return void res.status(400).json({ error: "Curbside orders require customer phone, vehicle color and model." });
    }
  }

  // ───── Order capacity / throttle pre-flight ─────
  {
    const { evaluateOrderCapacity, maybeAlertManagersOnRush } = await import("../lib/orderCapacity");
    const itemQuantities = Array.isArray(items)
      ? (items as Array<{ menuItemId?: number; quantity?: number }>)
          .filter((i) => i?.menuItemId && i?.quantity)
          .map((i) => ({ menuItemId: Number(i.menuItemId), quantity: Number(i.quantity) }))
      : [];
    const capRes = await evaluateOrderCapacity({
      restaurantId,
      orderType: typeof orderType === "string" ? orderType : null,
      branchId: typeof branchId === "number" ? branchId : null,
      channel: "pos",
      itemQuantities,
    });
    if (!capRes.allowed) {
      return void res.status(429).json({ error: capRes.reason ?? "Order capacity reached", nextAvailableAt: capRes.nextAvailableAt ?? null });
    }
    if (capRes.autoExtendApplied) {
      // fire-and-forget alert
      void maybeAlertManagersOnRush(restaurantId);
    }
  }

  // ───── Cloud-kitchen pre-flight (only when brandId+channelKey present) ─────
  let ckContext: null | {
    brand: { id: number; name: string; branchId: number | null };
    channelKey: string;
    linkMap: Map<number, { priceOverride: string | null; taxRateOverride: string | null; isAvailable: boolean }>;
    commissionPct: string | null;
    slaTargetAt: Date | null;
    packagingSnapshot: Array<{ packagingItemId: number; name: string; quantity: number; costPerUnit: string }>;
    packagingDeductions: Array<{ packagingItemId: number; quantity: number }>;
  } = null;

  if (brandId != null && typeof channelKey === "string" && channelKey) {
    const ck = await import("./cloud-kitchen");
    const { brandsTable, branchesTable, brandMenuLinksTable, packagingItemsTable, itemPackagingRequirementsTable, brandSlaTargetsTable, ORDER_CHANNELS } = await import("../lib/db");
    if (!ORDER_CHANNELS.includes(channelKey as typeof ORDER_CHANNELS[number])) {
      return void res.status(400).json({ error: "invalid channelKey" });
    }
    const [brand] = await db.select().from(brandsTable).where(and(eq(brandsTable.id, Number(brandId)), eq(brandsTable.restaurantId, restaurantId)));
    if (!brand) return void res.status(404).json({ error: "Brand not found" });
    if (brand.branchId != null) {
      const [b] = await db.select({ ck: branchesTable.cloudKitchenEnabled }).from(branchesTable).where(and(eq(branchesTable.id, brand.branchId), eq(branchesTable.restaurantId, restaurantId)));
      if (!b || !b.ck) return void res.status(400).json({ error: "Cloud Kitchen mode is not enabled for this brand's branch." });
    }
    const throttle = await ck.checkThrottle(restaurantId, brand.id, channelKey);
    if (!throttle.allowed) return void res.status(429).json({ error: throttle.reason ?? "Throttled" });

    const itemIds = (items as Array<{ menuItemId: number }>).map(i => Number(i.menuItemId));
    const linkRows = await db.select().from(brandMenuLinksTable).where(and(
      eq(brandMenuLinksTable.brandId, brand.id),
      eq(brandMenuLinksTable.restaurantId, restaurantId),
      inArray(brandMenuLinksTable.menuItemId, itemIds),
    ));
    const linkMap = new Map(linkRows.map(l => [l.menuItemId, { priceOverride: l.priceOverride, taxRateOverride: l.taxRateOverride, isAvailable: l.isAvailable }]));
    for (const id of itemIds) {
      const link = linkMap.get(id);
      if (!link || !link.isAvailable) {
        return void res.status(400).json({ error: `Menu item ${id} isn't available for ${brand.name}` });
      }
    }

    const reqs = await db.select().from(itemPackagingRequirementsTable).where(and(
      eq(itemPackagingRequirementsTable.restaurantId, restaurantId),
      inArray(itemPackagingRequirementsTable.menuItemId, itemIds),
    ));
    const pkgIds = Array.from(new Set(reqs.map(r => r.packagingItemId)));
    const pkgs = pkgIds.length === 0 ? [] : await db.select().from(packagingItemsTable).where(and(
      inArray(packagingItemsTable.id, pkgIds), eq(packagingItemsTable.restaurantId, restaurantId),
    ));
    const pkgMap = new Map(pkgs.map(p => [p.id, p]));
    const pkgUsage = new Map<number, number>();
    for (const r of reqs) {
      const oi = (items as Array<{ menuItemId: number; quantity: number }>).find(i => Number(i.menuItemId) === r.menuItemId);
      if (!oi) continue;
      pkgUsage.set(r.packagingItemId, (pkgUsage.get(r.packagingItemId) ?? 0) + Number(r.quantity) * Number(oi.quantity));
    }
    const packagingSnapshot: Array<{ packagingItemId: number; name: string; quantity: number; costPerUnit: string }> = [];
    const packagingDeductions: Array<{ packagingItemId: number; quantity: number }> = [];
    for (const [pid, qty] of pkgUsage.entries()) {
      const p = pkgMap.get(pid);
      if (!p) continue;
      packagingSnapshot.push({ packagingItemId: pid, name: p.name, quantity: qty, costPerUnit: p.costPerUnit ?? "0.00" });
      packagingDeductions.push({ packagingItemId: pid, quantity: qty });
    }

    const [sla] = await db.select().from(brandSlaTargetsTable).where(and(
      eq(brandSlaTargetsTable.brandId, brand.id), eq(brandSlaTargetsTable.channelKey, channelKey),
    ));
    const slaTargetAt = sla
      ? new Date(Date.now() + (Number(sla.prepMinutes) + Number(sla.handoverMinutes)) * 60_000)
      : null;
    const commissionPct = (() => {
      const cfg = (brand.channelConfig as Record<string, { commissionPct?: number }> | null)?.[channelKey];
      return cfg?.commissionPct != null ? String(cfg.commissionPct) : null;
    })();

    ckContext = {
      brand: { id: brand.id, name: brand.name, branchId: brand.branchId },
      channelKey,
      linkMap,
      commissionPct,
      slaTargetAt,
      packagingSnapshot,
      packagingDeductions,
    };
  }

  let subtotal = 0;
  const enrichedItems: Array<{
    menuItem: typeof menuItemsTable.$inferSelect;
    qty: number;
    notes?: string;
    modifiers: EnrichedModifier[];
    unitPrice: number;
    originalPrice: number;
    appliedRule: { id: number; name: string; ruleType: string } | null;
    variantId?: number;
  }> = [];

  const channel = (orderType ?? (ckContext ? "delivery" : "dine_in")) as string;
  const at = new Date();

  for (const item of items as Array<{ menuItemId: number; quantity: number; notes?: string; modifiers?: ModifierSelectionInput[]; variantId?: number }>) {
    const [mi] = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.id, item.menuItemId), eq(menuItemsTable.restaurantId, restaurantId)));
    if (!mi) continue;
    const enrichRes = await enrichModifierSelections(mi.id, item.modifiers ?? []);
    if (!enrichRes.ok) return void res.status(400).json({ error: enrichRes.error });
    const lineModifiers = enrichRes.modifiers;
    const modTotal = lineModifiers.reduce((s, m) => s + m.price * m.quantity, 0);
    // Cloud-kitchen brand pricing override takes precedence, 
    // followed by bar peg/bottle variants, and finally standard pricing rules.
    let unitPrice: number;
    let originalPrice: number;
    let appliedRule: { id: number; name: string; ruleType: string } | null = null;

    const link = ckContext?.linkMap.get(mi.id);
    if (link?.priceOverride != null) {
      unitPrice = Number(link.priceOverride) + modTotal;
      originalPrice = Number(mi.price) + modTotal;
    } else if (item.variantId) {
      const [variant] = await db.select().from(menuItemVariantsTable)
        .where(and(eq(menuItemVariantsTable.id, item.variantId), eq(menuItemVariantsTable.restaurantId, restaurantId), eq(menuItemVariantsTable.menuItemId, mi.id)));
      if (variant) {
        unitPrice = Number(variant.price) + modTotal;
        originalPrice = Number(variant.price);
      } else {
        // Unknown variant — fall back to base pricing.
        const resolved = await resolveOrderItemUnitPrice({
          menuItem: { id: mi.id, price: mi.price, categoryId: mi.categoryId },
          restaurantId, branchId: branchId ?? null, channel, customerId: customerId ?? null, modifierTotal: modTotal, at,
        });
        unitPrice = resolved.unitPrice; originalPrice = resolved.originalPrice;
        appliedRule = resolved.appliedRule ? { id: resolved.appliedRule.id, name: resolved.appliedRule.name, ruleType: resolved.appliedRule.ruleType } : null;
      }
    } else {
      const resolved = await resolveOrderItemUnitPrice({
        menuItem: { id: mi.id, price: mi.price, categoryId: mi.categoryId },
        restaurantId,
        branchId: branchId ?? null,
        channel,
        customerId: customerId ?? null,
        modifierTotal: modTotal,
        at,
      });
      unitPrice = resolved.unitPrice; originalPrice = resolved.originalPrice;
      appliedRule = resolved.appliedRule
        ? { id: resolved.appliedRule.id, name: resolved.appliedRule.name, ruleType: resolved.appliedRule.ruleType }
        : null;
    }

    subtotal += unitPrice * item.quantity;
    enrichedItems.push({
      menuItem: mi,
      qty: item.quantity,
      notes: item.notes,
      modifiers: lineModifiers,
      unitPrice,
      originalPrice,
      appliedRule,
      variantId: item.variantId,
    });
  }

  const { taxRate, serviceRate } = await getRestaurantRates(restaurantId);
  const taxAmount = subtotal * taxRate;
  const serviceCharge = subtotal * serviceRate;
  const totalAmount = Math.max(0, subtotal + taxAmount + serviceCharge);

  // Validate customerId belongs to this restaurant (tenant isolation)
  let resolvedCustomerId: number | undefined;
  let resolvedCustomerRow: typeof customersTable.$inferSelect | undefined;
  if (customerId) {
    const [cust] = await db.select().from(customersTable)
      .where(and(eq(customersTable.id, Number(customerId)), eq(customersTable.restaurantId, restaurantId)));
    resolvedCustomerId = cust?.id;
    resolvedCustomerRow = cust;
  } else if (customerPhone) {
    const [cust] = await db.select().from(customersTable)
      .where(and(eq(customersTable.phone, String(customerPhone)), eq(customersTable.restaurantId, restaurantId)));
    if (cust) { resolvedCustomerRow = cust; resolvedCustomerId = cust.id; }
  }

  // Blacklist intercept (cust_blacklist) — feature-gated; only enforced if the
  // restaurant's plan includes the Guest Blacklist entitlement.
  if (resolvedCustomerRow?.isBlacklisted) {
    const blacklistEnabled = await restaurantHasFeature(restaurantId, "cust_blacklist");
    if (blacklistEnabled) {
      const role = (req as any).user?.role;
      const override = req.body?.blacklistOverrideReason;
      if (!override || !["owner", "manager", "super_admin"].includes(role)) {
        return void res.status(403).json({
          error: "Customer is blacklisted",
          blacklistReason: resolvedCustomerRow.blacklistReason ?? null,
          requiresOverride: true,
        });
      }
      try {
        await recordAuditLog({
          req, module: "customer_quality", action: "blacklist.override",
          entity: "CUSTOMER_BLACKLIST_ENTRY", entityId: resolvedCustomerRow.id,
          restaurantId, newValue: { reason: override, role },
        });
      } catch (err) {
        console.error(`[Blacklist audit] failed for restaurant ${restaurantId} customer ${resolvedCustomerRow.id}:`, err);
      }
    }
  }

  const [order] = await db.insert(ordersTable).values({
    restaurantId,
    tableId,
    orderNumber: generateOrderNumber(),
    orderType: orderType ?? (ckContext ? "delivery" : "dine_in"),
    notes,
    customerName,
    customerPhone,
    customerId: resolvedCustomerId,
    isPriority: isPriority ?? false,
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    serviceCharge: serviceCharge.toFixed(2),
    discountAmount: "0.00",
    totalAmount: totalAmount.toFixed(2),
    hotelStayId: hotelStayId ? Number(hotelStayId) : null,
    banquetEventId: banquetEventId ? Number(banquetEventId) : null,
    brandId: ckContext?.brand.id ?? null,
    channelKey: ckContext?.channelKey ?? null,
    channelExternalOrderId: ckContext && typeof channelExternalOrderId === "string" ? channelExternalOrderId : null,
    channelCommissionPct: ckContext?.commissionPct ?? null,
    packagingSnapshot: ckContext?.packagingSnapshot ?? null,
    slaTargetAt: ckContext?.slaTargetAt ?? null,
    vehicleColor: orderType === "curbside" ? String(vehicleColor).slice(0, 40) : null,
    vehicleModel: orderType === "curbside" ? String(vehicleModel).slice(0, 80) : null,
    vehicleNumber: orderType === "curbside" && typeof vehicleNumber === "string" ? vehicleNumber.slice(0, 40) : null,
    parkingSpot: orderType === "curbside" && typeof parkingSpot === "string" ? parkingSpot.slice(0, 40) : null,
  }).returning();

  // Deduct packaging stock for cloud-kitchen orders
  if (ckContext && ckContext.packagingDeductions.length > 0) {
    const { packagingItemsTable } = await import("../lib/db");
    const { sql } = await import("drizzle-orm");
    for (const d of ckContext.packagingDeductions) {
      await db.update(packagingItemsTable)
        .set({ currentStock: sql`GREATEST(0, ${packagingItemsTable.currentStock} - ${d.quantity})`, updatedAt: new Date() })
        .where(and(eq(packagingItemsTable.id, d.packagingItemId), eq(packagingItemsTable.restaurantId, restaurantId)));
    }
  }

  for (const ei of enrichedItems) {
    const [oi] = await db.insert(orderItemsTable).values({
      orderId: order.id,
      menuItemId: ei.menuItem.id,
      menuItemName: ei.menuItem.name,
      quantity: ei.qty,
      unitPrice: ei.unitPrice.toFixed(2),
      totalPrice: (ei.unitPrice * ei.qty).toFixed(2),
      notes: ei.notes,
    }).returning();

    if (ei.variantId) {
      await recordVariantPour({
        restaurantId, orderId: order.id, orderItemId: oi.id,
        variantId: ei.variantId, qty: ei.qty, unitPrice: ei.unitPrice,
      }).catch(err => { console.error("[bar] recordVariantPour failed:", err); });
    }

    for (const mod of ei.modifiers ?? []) {
      await db.insert(orderItemModifiersTable).values({
        orderItemId: oi.id,
        modifierId: mod.modifierId ?? null,
        modifierGroupId: mod.modifierGroupId ?? null,
        groupName: mod.groupName ?? null,
        modifierName: mod.name,
        quantity: mod.quantity,
        price: mod.price.toFixed(2),
      });
    }

    if (ei.appliedRule) {
      await db.insert(pricingRuleApplicationsTable).values({
        orderItemId: oi.id,
        pricingRuleId: ei.appliedRule.id,
        ruleName: ei.appliedRule.name,
        ruleType: ei.appliedRule.ruleType,
        originalUnitPrice: ei.originalPrice.toFixed(2),
        adjustedUnitPrice: ei.unitPrice.toFixed(2),
      }).catch(() => {});
    }
  }

  const createdTickets = await createKitchenTicketsForOrder({
    orderId: order.id,
    restaurantId,
    isPriority: isPriority ?? false,
  });

  if (tableId) {
    await db.update(floorTablesTable).set({ status: "occupied" }).where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId)));
  }

  await db.insert(notificationsTable).values({
    restaurantId,
    type: "new_order",
    title: "New Order",
    message: `Order #${order.orderNumber} placed${order.customerName ? ` by ${order.customerName}` : ""}`,
    entityId: order.id,
    entityType: "order",
  }).catch(() => {});
  void emitWebhookEvent(restaurantId, "order.created", { id: order.id, orderNumber: order.orderNumber, totalAmount: order.totalAmount, status: order.status, customerName: order.customerName });
  for (const t of createdTickets) {
    broadcastEvent(restaurantId, "order:new", { ...order, ticketId: t.ticketId, kitchenId: t.kitchenId });
    pushToStaff(
      { restaurantId, roles: ["kitchen"], type: "new_order", kitchenId: t.kitchenId },
      {
        title: "New kitchen order",
        body: `Order #${order.orderNumber}${order.tableId ? ` • Table ${order.tableId}` : ""}`,
        data: { screen: "kitchen", orderId: order.id, ticketId: t.ticketId, kitchenId: t.kitchenId },
      },
    ).catch(() => {});
  }
  broadcastEvent(restaurantId, "notification:new", { type: "new_order" });

  // Auto-create VIP alert when a VIP customer places an order (cust_vip_alerts)
  if (resolvedCustomerRow?.isVip
      && await restaurantHasFeature(restaurantId, "cust_vip_alerts")) {
    try {
      const [vipAlert] = await db.insert(vipAlertsTable).values({
        restaurantId, customerId: resolvedCustomerRow.id,
        orderId: order.id,
        trigger: "order_placed",
        reason: `VIP guest ${resolvedCustomerRow.name ?? resolvedCustomerRow.phone ?? ""} placed order #${order.orderNumber}`,
        channelsNotified: ["notification"],
      }).returning();
      await db.insert(notificationsTable).values({
        restaurantId,
        type: "vip_alert",
        title: `VIP guest arrived: ${resolvedCustomerRow.name ?? resolvedCustomerRow.phone ?? "Customer"}`,
        message: `Order #${order.orderNumber} — give white-glove service`,
        entityId: vipAlert.id,
        entityType: "vip_alert",
      });
      await recordAuditLog({ req, module: "customer_quality", action: "vip_alert.auto",
        entity: "CUSTOMER", entityId: resolvedCustomerRow.id, restaurantId,
        newValue: { alertId: vipAlert.id, trigger: "order_placed", orderId: order.id } });
    } catch (err) {
      console.error(`[VIP alert] failed for restaurant ${restaurantId} order ${order.id}:`, err);
    }
  }

  // Convert any matching active cart session → "converted" (cust_abandoned_cart)
  if (await restaurantHasFeature(restaurantId, "cust_abandoned_cart")) {
    try {
      const sessKey = req.body?.cartSessionToken ?? req.body?.cartSessionKey ?? null;
      if (sessKey) {
        await db.update(cartSessionsTable)
          .set({ status: "converted", orderId: order.id, convertedAt: new Date() })
          .where(and(eq(cartSessionsTable.restaurantId, restaurantId), eq(cartSessionsTable.sessionToken, String(sessKey))));
      } else if (resolvedCustomerId || customerPhone) {
        const conds = [eq(cartSessionsTable.restaurantId, restaurantId), eq(cartSessionsTable.status, "active")];
        if (resolvedCustomerId) conds.push(eq(cartSessionsTable.customerId, resolvedCustomerId));
        else conds.push(eq(cartSessionsTable.customerPhone, String(customerPhone)));
        await db.update(cartSessionsTable)
          .set({ status: "converted", orderId: order.id, convertedAt: new Date() })
          .where(and(...conds));
      }
    } catch (err) {
      console.error(`[Cart convert] failed for restaurant ${restaurantId} order ${order.id}:`, err);
    }
  }

  // Service-timer: stage 1 (placed) when the order row is first written.
  await recordTimerStage(restaurantId, order.id, "placed");
  for (const t of createdTickets) {
    await recordTimerStage(restaurantId, order.id, "kot_fired");
    void t;
    break; // single kot_fired event per order even when multiple kitchens.
  }

  const createdItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));

  const issuedToken = await issueTokenForOrder({
    orderId: order.id,
    restaurantId,
    orderType: order.orderType,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
  }).catch(() => null);

  res.status(201).json({ ...order, items: createdItems, token: issuedToken });
});

router.get("/restaurants/:restaurantId/orders/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, Number(req.params.id)), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Not found" });
  const itemsRaw = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  const itemIds = itemsRaw.map((i) => i.id);
  const applications = itemIds.length > 0
    ? await db.select().from(pricingRuleApplicationsTable).where(inArray(pricingRuleApplicationsTable.orderItemId, itemIds))
    : [];
  const modRows = itemIds.length > 0
    ? await db.select().from(orderItemModifiersTable).where(inArray(orderItemModifiersTable.orderItemId, itemIds))
    : [];
  const modsByItem = new Map<number, typeof modRows>();
  for (const m of modRows) {
    const arr = modsByItem.get(m.orderItemId) ?? [];
    arr.push(m);
    modsByItem.set(m.orderItemId, arr);
  }
  const appByItem = new Map(applications.map((a) => [a.orderItemId, a]));
  const items = itemsRaw.map((it) => {
    const app = appByItem.get(it.id);
    return {
      ...it,
      modifiers: (modsByItem.get(it.id) ?? []).map(m => ({
        id: m.id,
        modifierId: m.modifierId ?? null,
        modifierGroupId: m.modifierGroupId ?? null,
        groupName: m.groupName ?? null,
        name: m.modifierName,
        quantity: m.quantity ?? 1,
        price: m.price,
      })),
      appliedRule: app
        ? {
            id: app.pricingRuleId,
            name: app.ruleName,
            ruleType: app.ruleType,
            originalUnitPrice: app.originalUnitPrice,
            adjustedUnitPrice: app.adjustedUnitPrice,
          }
        : null,
    };
  });
  const [latestPayment] = await db
    .select({ method: paymentsTable.method, amount: paymentsTable.amount })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.restaurantId, restaurantId),
      eq(paymentsTable.referenceType, "order"),
      eq(paymentsTable.referenceId, order.id),
      eq(paymentsTable.direction, "in"),
    ))
    .orderBy(desc(paymentsTable.paymentDate))
    .limit(1);
  const discounts = await listOrderDiscounts(order.id);
  res.json({
    ...order,
    items,
    discounts,
    paymentMethod: latestPayment?.method ?? null,
    paymentAmount: latestPayment?.amount ?? null,
  });
});

router.patch("/restaurants/:restaurantId/orders/:id", idempotency(), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status, notes, isPriority, customerName } = req.body;
  const updates: Record<string, unknown> = { notes, isPriority, customerName, updatedAt: new Date() };
  if (status) updates.status = status;
  const [updated] = await db.update(ordersTable).set(updates).where(and(eq(ordersTable.id, Number(req.params.id)), eq(ordersTable.restaurantId, restaurantId))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  // Service-timer: emit `accepted` when an order's status transitions to
  // accepted/confirmed via the generic order PATCH. This completes the
  // placed → accepted → kot_fired → preparing → ready → served → billed
  // sequence required by the Smart Service Timer feature.
  if (status === "accepted" || status === "confirmed") {
    await recordTimerStage(restaurantId, updated.id, "accepted");
    if (updated.orderType === "curbside" && !updated.curbsideAcceptedAt) {
      await db.update(ordersTable).set({ curbsideAcceptedAt: new Date() })
        .where(eq(ordersTable.id, updated.id));
    }
  }

  broadcastEvent(restaurantId, "order:status", { id: updated.id, status: updated.status, orderNumber: updated.orderNumber });
  broadcastOrderUpdate(updated.id, { id: updated.id, status: updated.status, orderNumber: updated.orderNumber });
  void emitWebhookEvent(restaurantId, updated.status === "completed" ? "order.completed" : "order.updated", { id: updated.id, orderNumber: updated.orderNumber, status: updated.status });

  res.json(updated);
});

router.post("/restaurants/:restaurantId/orders/:id/items", idempotency(), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const { menuItemId, quantity, notes, modifiers, variantId } = req.body as {
    menuItemId: number; quantity: number; notes?: string;
    modifiers?: ModifierSelectionInput[]; variantId?: number;
  };

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Cannot modify a completed or cancelled order" });
  }

  const [mi] = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.id, menuItemId), eq(menuItemsTable.restaurantId, restaurantId)));
  if (!mi) return void res.status(404).json({ error: "Menu item not found" });

  const qty = Number(quantity) || 1;
  const enrichRes = await enrichModifierSelections(mi.id, modifiers ?? []);
  if (!enrichRes.ok) return void res.status(400).json({ error: enrichRes.error });
  const enrichedMods = enrichRes.modifiers;
  const hasModifiers = enrichedMods.length > 0;

  const modifierAdditional = enrichedMods.reduce((sum, m) => sum + m.price * m.quantity, 0);

  let unitPrice: number;
  let resolved: Awaited<ReturnType<typeof resolveOrderItemUnitPrice>> | null = null;
  let resolvedVariant: typeof menuItemVariantsTable.$inferSelect | null = null;
  if (variantId) {
    const [v] = await db.select().from(menuItemVariantsTable)
      .where(and(eq(menuItemVariantsTable.id, variantId), eq(menuItemVariantsTable.restaurantId, restaurantId), eq(menuItemVariantsTable.menuItemId, mi.id)));
    resolvedVariant = v ?? null;
  }
  if (resolvedVariant) {
    unitPrice = Number(resolvedVariant.price) + modifierAdditional;
  } else {
    resolved = await resolveOrderItemUnitPrice({
      menuItem: { id: mi.id, price: mi.price, categoryId: mi.categoryId },
      restaurantId,
      branchId: req.body?.branchId ?? null,
      channel: order.orderType ?? "dine_in",
      customerId: order.customerId ?? null,
      modifierTotal: modifierAdditional,
    });
    unitPrice = resolved.unitPrice;
  }

  let newItemId: number | undefined;

  if (hasModifiers) {
    // Items with modifiers always create a new line (modifier-distinct)
    const [newItem] = await db.insert(orderItemsTable).values({
      orderId,
      menuItemId: mi.id,
      menuItemName: mi.name,
      quantity: qty,
      unitPrice: unitPrice.toFixed(2),
      totalPrice: (unitPrice * qty).toFixed(2),
      notes,
    }).returning();
    newItemId = newItem.id;
    await db.insert(orderItemModifiersTable).values(
      enrichedMods.map(m => ({
        orderItemId: newItemId!,
        modifierId: m.modifierId ?? null,
        modifierGroupId: m.modifierGroupId ?? null,
        groupName: m.groupName ?? null,
        modifierName: m.name,
        quantity: m.quantity,
        price: m.price.toFixed(2),
      }))
    );
  } else {
    // No modifiers: coalesce only with an existing modifier-free line for this menuItemId
    // *and* an existing line whose persisted unit price still matches the
    // current rule-resolved price — otherwise pricing-rule history would be
    // overwritten on the existing line.
    const existingItems = await db.select().from(orderItemsTable)
      .where(and(eq(orderItemsTable.orderId, orderId), eq(orderItemsTable.menuItemId, menuItemId)));

    let targetLine: typeof existingItems[0] | null = null;
    for (const ex of existingItems) {
      const mods = await db.select().from(orderItemModifiersTable)
        .where(eq(orderItemModifiersTable.orderItemId, ex.id));
      // Only coalesce when notes match too — otherwise a fresh line with
      // special instructions (e.g. "no onions") would silently be merged
      // into a plain line and the kitchen would lose the instruction.
      const sameNotes = (ex.notes ?? "") === (notes ?? "");
      if (mods.length === 0 && sameNotes && Math.abs(Number(ex.unitPrice) - unitPrice) < 0.005) {
        targetLine = ex;
        break;
      }
    }

    if (targetLine) {
      const newQty = targetLine.quantity + qty;
      await db.update(orderItemsTable).set({
        quantity: newQty,
        totalPrice: (unitPrice * newQty).toFixed(2),
      }).where(eq(orderItemsTable.id, targetLine.id));
      newItemId = targetLine.id;
    } else {
      const [created] = await db.insert(orderItemsTable).values({
        orderId,
        menuItemId: mi.id,
        menuItemName: mi.name,
        quantity: qty,
        unitPrice: unitPrice.toFixed(2),
        totalPrice: (unitPrice * qty).toFixed(2),
        notes,
      }).returning();
      newItemId = created.id;
    }
  }

  if (newItemId && resolved?.appliedRule) {
    const existing = await db.select().from(pricingRuleApplicationsTable).where(eq(pricingRuleApplicationsTable.orderItemId, newItemId));
    if (existing.length === 0) {
      await db.insert(pricingRuleApplicationsTable).values({
        orderItemId: newItemId,
        pricingRuleId: resolved.appliedRule.id,
        ruleName: resolved.appliedRule.name,
        ruleType: resolved.appliedRule.ruleType,
        originalUnitPrice: resolved.originalPrice.toFixed(2),
        adjustedUnitPrice: unitPrice.toFixed(2),
      }).catch(() => {});
    }
  }

  if (newItemId && resolvedVariant) {
    await recordVariantPour({
      restaurantId, orderId, orderItemId: newItemId,
      variantId: resolvedVariant.id, qty, unitPrice,
    }).catch(err => { console.error("[bar] recordVariantPour failed:", err); });
  }

  const newTicket = await ensureTicketForAddedItem({ orderId, restaurantId, menuItemId: mi.id });

  const totals = await recalculateOrderTotals(orderId, restaurantId);
  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));

  broadcastEvent(restaurantId, "order:updated", { id: orderId, ...totals });
  if (newTicket) {
    broadcastEvent(restaurantId, "order:new", {
      id: orderId,
      orderNumber: updatedOrder.orderNumber,
      ticketId: newTicket.ticketId,
      kitchenId: newTicket.kitchenId,
    });
  }

  res.json({ ...updatedOrder, items });
});

router.delete("/restaurants/:restaurantId/orders/:id/items/:itemId", idempotency(), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Cannot modify a completed or cancelled order" });
  }

  // Verify item belongs to this order before touching anything
  const [targetItem] = await db.select().from(orderItemsTable)
    .where(and(eq(orderItemsTable.id, itemId), eq(orderItemsTable.orderId, orderId)));
  if (!targetItem) return void res.status(404).json({ error: "Item not found in this order" });

  await db.delete(orderItemModifiersTable).where(eq(orderItemModifiersTable.orderItemId, itemId));
  await db.delete(orderDiscountsTable).where(eq(orderDiscountsTable.orderItemId, itemId));
  await db.delete(orderItemsTable).where(eq(orderItemsTable.id, itemId));

  const totals = await recalculateOrderTotals(orderId, restaurantId);
  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));

  broadcastEvent(restaurantId, "order:updated", { id: orderId, ...totals });

  res.json({ ...updatedOrder, items });
});

router.post("/restaurants/:restaurantId/orders/:id/discounts", requireRole("owner", "manager", "cashier", "waiter", "super_admin"), requirePlanFeature("discounts_promotions"), idempotency(), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const { type, orderItemId, value, reason, managerPin, managerOtp } = req.body as {
    type?: string; orderItemId?: number; value?: number; reason?: string; managerPin?: string; managerOtp?: string;
  };

  const typeStr = String(type ?? "");
  if (!(typeStr === "percentage" || typeStr === "flat" || typeStr === "item")) {
    return void res.status(400).json({ error: "type must be percentage, flat, or item" });
  }
  const reasonTrim = String(reason ?? "").trim();
  if (!reasonTrim) return void res.status(400).json({ error: "reason is required" });
  const valueNum = Math.max(0, Number(value ?? 0));
  if (!isFinite(valueNum) || valueNum <= 0) {
    return void res.status(400).json({ error: "value must be a positive number" });
  }

  const cfgEarly = await loadDiscountsConfig(restaurantId);
  const presets = (cfgEarly.presetReasons ?? []).map(r => r.trim()).filter(r => r.length > 0);
  if (presets.length === 0) {
    return void res.status(409).json({
      error: "No discount reasons are configured. Ask the owner to add preset reasons in Settings → Discounts.",
      code: "NO_DISCOUNT_REASONS_CONFIGURED",
    });
  }
  if (!presets.some(r => r.toLowerCase() === reasonTrim.toLowerCase())) {
    return void res.status(400).json({
      error: "Reason must be one of the configured presets",
      code: "INVALID_DISCOUNT_REASON",
      allowedReasons: presets,
    });
  }

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Cannot modify a completed or cancelled order" });
  }

  const subtotal = Number(order.subtotal);
  let amount = 0;
  let scopeOut: "order" | "item" = "order";
  let resolvedItemId: number | null = null;

  if (typeStr === "item") {
    if (!orderItemId) return void res.status(400).json({ error: "orderItemId is required for item-level discount" });
    const [oi] = await db.select().from(orderItemsTable)
      .where(and(eq(orderItemsTable.id, Number(orderItemId)), eq(orderItemsTable.orderId, orderId)));
    if (!oi) return void res.status(404).json({ error: "Order item not found" });
    const lineTotal = Number(oi.totalPrice);
    amount = Math.min(valueNum, lineTotal);
    scopeOut = "item";
    resolvedItemId = oi.id;
  } else if (typeStr === "percentage") {
    if (valueNum > 100) return void res.status(400).json({ error: "percentage cannot exceed 100" });
    amount = (subtotal * valueNum) / 100;
  } else {
    // flat
    amount = valueNum;
  }

  const existingTotal = await sumOrderDiscounts(orderId);
  const headroom = Math.max(0, subtotal - existingTotal);
  amount = Math.min(amount, headroom);
  if (amount <= 0) {
    return void res.status(400).json({ error: "Order is already fully discounted" });
  }

  const cfg = cfgEarly;
  const cumulative = existingTotal + amount;
  // Approval is required if EITHER the global threshold is crossed OR the
  // requesting user's role-cap is exceeded by the new line on its own.
  const overThreshold = exceedsThreshold(cumulative, subtotal, cfg);
  const overRoleCap = exceedsRoleCap(req.user?.role, !!req.user?.isSuperAdmin, amount, subtotal, cfg);
  const needsApproval = overThreshold || overRoleCap;

  let approvedByUserId: number | null = null;
  let approvalMethod: "auto" | "pin" | "otp" = "auto";
  let otpIdUsed: number | null = null;

  if (needsApproval) {
    const pinOk = managerPin && cfg.hasManagerPin && await verifyManagerPin(String(managerPin), cfg);
    if (pinOk) {
      approvalMethod = "pin";
    } else if (managerOtp) {
      const v = await verifyManagerDiscountOtp({
        restaurantId,
        code: String(managerOtp),
        consumedByUserId: req.user?.sub ?? null,
      });
      if (!v.ok) {
        return void res.status(402).json({
          error: v.error ?? "OTP invalid",
          code: "MANAGER_OTP_INVALID",
          requiresApproval: true,
          methods: cfg.otpEnabled ? (cfg.hasManagerPin ? ["pin", "otp"] : ["otp"]) : ["pin"],
        });
      }
      approvalMethod = "otp";
      otpIdUsed = v.otpId ?? null;
    } else {
      // No credential supplied — tell the client which methods are available.
      const methods: string[] = [];
      if (cfg.hasManagerPin) methods.push("pin");
      if (cfg.otpEnabled) methods.push("otp");
      if (methods.length === 0) {
        return void res.status(409).json({
          error: "This discount requires manager approval but no approval method is configured. Set a Manager PIN or enable OTP in Settings → Discounts.",
          code: "MANAGER_APPROVAL_NOT_CONFIGURED",
        });
      }
      return void res.status(402).json({
        error: "Manager approval required for this discount",
        code: "MANAGER_APPROVAL_REQUIRED",
        requiresPin: methods.includes("pin"),
        requiresApproval: true,
        methods,
        thresholdPercent: cfg.thresholdPercent,
        thresholdAmount: cfg.thresholdAmount,
        roleCap: cfg.roleCaps[req.user?.role as keyof typeof cfg.roleCaps] ?? null,
        reason: overRoleCap ? "ROLE_CAP_EXCEEDED" : "THRESHOLD_EXCEEDED",
      });
    }
    const role = req.user?.role;
    approvedByUserId = (role === "owner" || role === "manager" || req.user?.isSuperAdmin)
      ? (req.user?.sub ?? null)
      : null;
  }

  const [insertedDiscount] = await db.insert(orderDiscountsTable).values({
    orderId,
    restaurantId,
    type: typeStr,
    scope: scopeOut,
    orderItemId: resolvedItemId,
    value: valueNum.toFixed(2),
    amount: amount.toFixed(2),
    reason: reasonTrim,
    recordedByUserId: req.user?.sub ?? null,
    approvedByUserId,
  }).returning({ id: orderDiscountsTable.id });

  // Record an audit row for every discount, even auto-approved ones, so the
  // discount insights report has a single source of truth for ROI / approval
  // method breakdowns.
  await db.insert(discountApprovalsTable).values({
    restaurantId,
    orderId,
    discountId: insertedDiscount?.id ?? null,
    type: typeStr,
    amount: amount.toFixed(2),
    subtotal: subtotal.toFixed(2),
    reason: reasonTrim,
    method: approvalMethod,
    requestedByUserId: req.user?.sub ?? null,
    requestedByRole: req.user?.role ?? null,
    approvedByUserId,
    otpId: otpIdUsed,
  });

  await recalculateOrderTotals(orderId, restaurantId);
  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const discounts = await listOrderDiscounts(orderId);
  res.json({ ...updatedOrder, items, discounts });
});

router.delete("/restaurants/:restaurantId/orders/:id/discounts/:discountId", requireRole("owner", "manager", "cashier", "waiter", "super_admin"), requirePlanFeature("discounts_promotions"), idempotency(), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const discountId = Number(req.params.discountId);

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Cannot modify a completed or cancelled order" });
  }

  const [existing] = await db.select().from(orderDiscountsTable)
    .where(and(eq(orderDiscountsTable.id, discountId), eq(orderDiscountsTable.orderId, orderId)));
  if (!existing) return void res.status(404).json({ error: "Discount line not found" });

  await db.delete(orderDiscountsTable).where(eq(orderDiscountsTable.id, discountId));
  if (existing.type === "coupon") {
    await db.update(ordersTable).set({ couponCode: null, updatedAt: new Date() }).where(eq(ordersTable.id, orderId));
  } else if (existing.type === "loyalty") {
    await db.update(ordersTable).set({ loyaltyPointsRedeemed: 0, updatedAt: new Date() }).where(eq(ordersTable.id, orderId));
  }

  await recalculateOrderTotals(orderId, restaurantId);
  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const discounts = await listOrderDiscounts(orderId);
  res.json({ ...updatedOrder, items, discounts });
});

router.post("/restaurants/:restaurantId/orders/:id/discount", (_req, res) => {
  res.status(410).json({
    error: "Endpoint removed. Use POST /orders/:id/discounts.",
    code: "ENDPOINT_REMOVED",
  });
});

router.post("/restaurants/:restaurantId/orders/:id/apply-loyalty", requirePlanFeature("loyalty_program"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const { points } = req.body;
  const pointsToRedeem = Math.max(0, Math.floor(Number(points ?? 0)));

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Cannot apply loyalty to a completed or cancelled order" });
  }
  if (!order.customerId) return void res.status(400).json({ error: "Order has no linked customer" });

  const [customer] = await db.select({ id: customersTable.id, loyaltyPoints: customersTable.loyaltyPoints }).from(customersTable)
    .where(and(eq(customersTable.id, order.customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!customer) return void res.status(404).json({ error: "Customer not found" });
  if (customer.loyaltyPoints < pointsToRedeem) {
    return void res.status(400).json({ error: `Insufficient loyalty points. Available: ${customer.loyaltyPoints}` });
  }

  const cfg = await loadLoyaltyConfig(restaurantId);
  if (!cfg.enabled) return void res.status(400).json({ error: "Loyalty program is not enabled" });

  // Drop any prior loyalty ledger row so re-applying replaces (not stacks) it.
  await deleteOrderDiscountsByType(orderId, "loyalty");

  // Cap redemption to remaining payable (subtotal + tax + service - existing
  // discounts) so customers never burn more points than the final bill can
  // absorb. The ledger sum already excludes any prior loyalty row removed above.
  const subtotal = Number(order.subtotal);
  const taxAmount = Number(order.taxAmount ?? 0);
  const serviceCharge = Number(order.serviceCharge ?? 0);
  const otherDiscountTotal = await sumOrderDiscounts(orderId);
  const remainingPayable = Math.max(0, subtotal + taxAmount + serviceCharge - otherDiscountTotal);
  const rate = Number(cfg.redemptionRate) || 0;
  const maxRedeemableByPayable = rate > 0 ? Math.floor(remainingPayable / rate) : 0;
  const cappedPoints = Math.min(pointsToRedeem, maxRedeemableByPayable);
  const loyaltyDiscount = computeRedemptionDiscount(cappedPoints, cfg);

  if (cappedPoints > 0 && loyaltyDiscount > 0) {
    await db.insert(orderDiscountsTable).values({
      orderId, restaurantId,
      type: "loyalty",
      scope: "order",
      value: cappedPoints.toFixed(2),
      amount: loyaltyDiscount.toFixed(2),
      reason: `Loyalty redemption (${cappedPoints} pts)`,
      recordedByUserId: req.user?.sub ?? null,
    });
  }
  await db.update(ordersTable).set({
    loyaltyPointsRedeemed: cappedPoints,
    updatedAt: new Date(),
  }).where(eq(ordersTable.id, orderId));

  await recalculateOrderTotals(orderId, restaurantId);
  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const discounts = await listOrderDiscounts(orderId);

  res.json({ ...updatedOrder, items, discounts, loyaltyApplied: { pointsRequested: pointsToRedeem, pointsRedeemed: cappedPoints, discountValue: loyaltyDiscount, remainingBalance: customer.loyaltyPoints - cappedPoints } });
});

router.post("/restaurants/:restaurantId/orders/:id/apply-coupon", requirePlanFeature("discounts_promotions"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const { code } = req.body;

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Cannot apply coupon to a completed or cancelled order" });
  }

  const now = new Date();
  const [coupon] = await db.select().from(couponsTable).where(
    and(eq(couponsTable.restaurantId, restaurantId), eq(couponsTable.code, String(code).toUpperCase()), eq(couponsTable.isActive, true))
  );
  if (!coupon) return void res.status(400).json({ error: "Invalid coupon code" });
  if (coupon.validTo && new Date(coupon.validTo) < now) return void res.status(400).json({ error: "Coupon has expired" });
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) return void res.status(400).json({ error: "Coupon usage limit reached" });
  const subtotal = Number(order.subtotal);
  if (coupon.minOrderAmount && subtotal < Number(coupon.minOrderAmount)) {
    return void res.status(400).json({ error: `Minimum order amount is ₹${coupon.minOrderAmount}` });
  }

  let couponDiscount = coupon.discountType === "percentage"
    ? (subtotal * Number(coupon.discountValue)) / 100
    : Number(coupon.discountValue);
  if (coupon.maxDiscountAmount) couponDiscount = Math.min(couponDiscount, Number(coupon.maxDiscountAmount));

  // Replace any existing coupon row so a new code overrides the previous one.
  await deleteOrderDiscountsByType(orderId, "coupon");

  // Cap so the coupon can't push the order discount above subtotal even if
  // other discounts (manual, loyalty) are also applied.
  const otherDiscountTotal = await sumOrderDiscounts(orderId);
  const headroom = Math.max(0, subtotal - otherDiscountTotal);
  const couponAmount = Math.min(couponDiscount, headroom);

  if (couponAmount <= 0) {
    return void res.status(409).json({ error: "Order is already fully discounted; coupon would have no effect" });
  }
  await db.insert(orderDiscountsTable).values({
    orderId, restaurantId,
    type: "coupon",
    scope: "order",
    value: Number(coupon.discountValue).toFixed(2),
    amount: couponAmount.toFixed(2),
    reason: `Coupon: ${coupon.code}`,
    couponCode: coupon.code,
    recordedByUserId: req.user?.sub ?? null,
  });
  await db.update(ordersTable).set({ couponCode: coupon.code, updatedAt: new Date() }).where(eq(ordersTable.id, orderId));

  await recalculateOrderTotals(orderId, restaurantId);
  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const discounts = await listOrderDiscounts(orderId);

  res.json({ ...updatedOrder, items, discounts, couponApplied: { code: coupon.code, discountAmount: couponAmount.toFixed(2), discountType: coupon.discountType } });
});

router.post("/restaurants/:restaurantId/orders/:id/split", idempotency(), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const { splits } = req.body as {
    splits: Array<{
      paymentMethod: string;
      amount: number;
      amountTendered?: number;
      stripePaymentIntentId?: string;
      razorpayPaymentId?: string;
      razorpayOrderId?: string;
      razorpaySignature?: string;
    }>;
  };

  const [order] = await db.select().from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Order is already completed or cancelled" });
  }
  if (!Array.isArray(splits) || splits.length < 2) {
    return void res.status(400).json({ error: "Split requires at least 2 payment legs" });
  }

  // Per-leg amount sanity: must be finite and strictly positive. Prevents
  // negative/zero cash legs from creating bogus drawer movements even when
  // other legs balance the order total.
  for (const s of splits) {
    const amt = Number(s.amount);
    if (!isFinite(amt) || amt <= 0) {
      return void res.status(400).json({ error: "Each split leg amount must be a positive number" });
    }
  }

  // If any leg pays in cash, an open cash register session is required.
  // Pre-flight check; the authoritative lock is acquired inside the transaction.
  const hasCashLeg = splits.some(s => s.paymentMethod === "cash");
  if (hasCashLeg) {
    const reg = await requireOpenCashRegister(restaurantId);
    if (!reg.ok) return void res.status(409).json({ error: reg.error, code: "REGISTER_CLOSED" });
  }

  // Validate cumulative amount covers the order total
  const cumulativeAmount = splits.reduce((sum, s) => sum + Number(s.amount), 0);
  const orderTotal = Number(order.totalAmount);
  if (cumulativeAmount < orderTotal - 0.01) {
    return void res.status(400).json({
      error: `Split total ₹${cumulativeAmount.toFixed(2)} is less than order total ₹${orderTotal.toFixed(2)}`,
    });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
  const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
  const { createHmac } = await import("crypto");

  // Deduplicate payment proof IDs within the request to prevent the same proof
  // from covering multiple legs (e.g. one ₹50 intent used for two ₹50 legs).
  const seenStripeIds = new Set<string>();
  const seenRzpPayIds = new Set<string>();
  for (const split of splits) {
    if (split.stripePaymentIntentId) {
      if (seenStripeIds.has(split.stripePaymentIntentId)) {
        return void res.status(400).json({ error: "Duplicate Stripe PaymentIntent ID across split legs — each leg must use a distinct payment" });
      }
      seenStripeIds.add(split.stripePaymentIntentId);
    }
    if (split.razorpayPaymentId) {
      if (seenRzpPayIds.has(split.razorpayPaymentId)) {
        return void res.status(400).json({ error: "Duplicate Razorpay payment ID across split legs — each leg must use a distinct payment" });
      }
      seenRzpPayIds.add(split.razorpayPaymentId);
    }
  }

  // Verify each leg and accumulate gateway-confirmed amounts
  let verifiedTotal = 0;

  for (const split of splits) {
    let legVerifiedAmount = 0;

    // Strict enum validation per leg
    if (!["cash", "card", "upi"].includes(String(split.paymentMethod))) {
      return void res.status(400).json({ error: `Invalid payment method '${split.paymentMethod}' in split leg. Must be cash, card, or upi.` });
    }

    if (split.paymentMethod === "cash") {
      if (split.amountTendered !== undefined && Number(split.amountTendered) < Number(split.amount)) {
        return void res.status(400).json({ error: "Cash tendered is less than split amount" });
      }
      legVerifiedAmount = Number(split.amount);

    } else if (split.paymentMethod === "card") {
      if (!split.stripePaymentIntentId) {
        return void res.status(400).json({ error: "Card split requires stripePaymentIntentId" });
      }
      if (stripeKey) {
        if (String(split.stripePaymentIntentId).startsWith("demo_")) {
          return void res.status(400).json({ error: "Demo intent IDs cannot be used when Stripe is configured" });
        }
        const [existingStripeUse] = await db.select({ id: ordersTable.id })
          .from(ordersTable)
          .where(and(eq(ordersTable.stripePaymentId, String(split.stripePaymentIntentId)), eq(ordersTable.restaurantId, restaurantId)));
        if (existingStripeUse && existingStripeUse.id !== orderId) {
          return void res.status(409).json({ error: "Card payment ID has already been used for another order" });
        }
        try {
          const stripe = new Stripe(stripeKey);
          const intent = await stripe.paymentIntents.retrieve(String(split.stripePaymentIntentId));
          if (intent.status !== "succeeded") {
            return void res.status(400).json({ error: `Card payment not confirmed: ${intent.status}` });
          }
          if (intent.metadata?.orderId !== String(orderId) || intent.metadata?.restaurantId !== String(restaurantId)) {
            return void res.status(400).json({ error: "Card payment was not created for this order" });
          }
          if (Math.abs(intent.amount - Math.round(Number(split.amount) * 100)) > 100) {
            return void res.status(400).json({ error: "Card payment amount does not match split share" });
          }
          if (intent.currency !== "inr") {
            return void res.status(400).json({ error: "Card payment currency mismatch" });
          }
          legVerifiedAmount = intent.amount / 100;
        } catch {
          return void res.status(400).json({ error: "Failed to verify card payment with Stripe" });
        }
      } else {
        if (!String(split.stripePaymentIntentId).startsWith("demo_")) {
          return void res.status(400).json({ error: "Stripe not configured; only demo payment IDs accepted" });
        }
        legVerifiedAmount = Number(split.amount);
      }

    } else if (split.paymentMethod === "upi") {
      if (razorpayKeySecret && razorpayKeyId) {
        if (!split.razorpayPaymentId || !split.razorpayOrderId || !split.razorpaySignature) {
          return void res.status(400).json({ error: "UPI split requires razorpayPaymentId, razorpayOrderId, and razorpaySignature" });
        }
        if (String(split.razorpayPaymentId).startsWith("demo_")) {
          return void res.status(400).json({ error: "Demo payment IDs cannot be used when Razorpay is configured" });
        }
        const sigBody = `${split.razorpayOrderId}|${split.razorpayPaymentId}`;
        const expectedSig = createHmac("sha256", razorpayKeySecret).update(sigBody).digest("hex");
        if (expectedSig !== String(split.razorpaySignature)) {
          return void res.status(400).json({ error: "Razorpay signature verification failed for UPI split" });
        }
        const [existingRzpUse] = await db.select({ id: ordersTable.id })
          .from(ordersTable)
          .where(and(eq(ordersTable.stripePaymentId, String(split.razorpayPaymentId)), eq(ordersTable.restaurantId, restaurantId)));
        if (existingRzpUse && existingRzpUse.id !== orderId) {
          return void res.status(409).json({ error: "Razorpay payment ID has already been used for another order" });
        }
        try {
          const authHeader = `Basic ${Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64")}`;
          const rzpPayRes = await fetch(`https://api.razorpay.com/v1/payments/${split.razorpayPaymentId}`, {
            headers: { Authorization: authHeader },
          });
          if (!rzpPayRes.ok) {
            return void res.status(400).json({ error: "Failed to fetch Razorpay payment details" });
          }
          const rzpPay = await rzpPayRes.json() as { status: string; amount: number; currency: string; order_id: string };
          if (rzpPay.status !== "captured") {
            return void res.status(400).json({ error: `Razorpay payment not captured: ${rzpPay.status}` });
          }
          const expectedPaise = Math.round(Number(split.amount) * 100);
          if (Math.abs(rzpPay.amount - expectedPaise) > 100) {
            return void res.status(400).json({ error: "Razorpay payment amount does not match split share" });
          }
          if (rzpPay.order_id !== String(split.razorpayOrderId)) {
            return void res.status(400).json({ error: "Razorpay payment is not linked to the expected Razorpay order for this split leg" });
          }
          const rzpOrdRes = await fetch(`https://api.razorpay.com/v1/orders/${split.razorpayOrderId}`, {
            headers: { Authorization: authHeader },
          });
          if (!rzpOrdRes.ok) {
            return void res.status(400).json({ error: "Failed to fetch Razorpay order details for split leg" });
          }
          const rzpOrd = await rzpOrdRes.json() as { id: string; notes: Record<string, string> };
          if (rzpOrd.notes?.orderId !== String(orderId) || rzpOrd.notes?.restaurantId !== String(restaurantId)) {
            return void res.status(400).json({ error: "Razorpay order for split leg does not belong to this internal order or restaurant" });
          }
          legVerifiedAmount = rzpPay.amount / 100;
        } catch {
          return void res.status(400).json({ error: "Failed to verify UPI payment with Razorpay" });
        }
      } else {
        if (split.razorpayPaymentId && !String(split.razorpayPaymentId).startsWith("demo_")) {
          return void res.status(400).json({ error: "Razorpay not configured; only demo payment IDs accepted" });
        }
        legVerifiedAmount = Number(split.amount);
      }
    }

    verifiedTotal += legVerifiedAmount;
  }

  // Ensure gateway-verified amounts cover the full order total
  if (verifiedTotal < orderTotal - 0.01) {
    return void res.status(400).json({
      error: `Gateway-verified payment total ₹${verifiedTotal.toFixed(2)} is less than order total ₹${orderTotal.toFixed(2)}`,
    });
  }

  const splitMethods = splits.map(s => s.paymentMethod).join(",");
  let updated: typeof ordersTable.$inferSelect | undefined;
  try {
    updated = await db.transaction(async tx => {
      // Lock the open cash register session if any leg is cash.
      let cashSessionId: number | null = null;
      if (hasCashLeg) {
        cashSessionId = await lockOpenCashRegister(tx, restaurantId);
        if (!cashSessionId) throw new Error("REGISTER_CLOSED");
      }

      // Conditional update: only succeeds if the order is still payable.
      // Two concurrent split/pay requests cannot both insert ledger rows.
      const [u] = await tx.update(ordersTable).set({
        paymentMethod: `split:${splitMethods}`,
        paymentStatus: "paid",
        status: "completed",
        updatedAt: new Date(),
      }).where(and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.restaurantId, restaurantId),
        // Allow paying a "completed" but still-unpaid order (e.g. the waiter
        // closed the order and the guest is paying at the till afterwards).
        // Only cancelled or already-paid orders are non-payable.
        ne(ordersTable.status, "cancelled"),
        ne(ordersTable.paymentStatus, "paid"),
      )).returning();
      if (!u) throw new Error("ORDER_ALREADY_PAID");
      if (order.tableId) {
        await tx.update(floorTablesTable).set({ status: "free" })
          .where(and(eq(floorTablesTable.id, order.tableId), eq(floorTablesTable.restaurantId, restaurantId)));
      }
      await tx.insert(paymentsTable).values(
        splits.map(s => ({
          restaurantId,
          direction: "in" as const,
          // Map gateway-backed legs to their gateway method in the ledger so
          // online totals reflect Stripe/Razorpay volume accurately.
          method: s.stripePaymentIntentId
            ? "stripe"
            : s.razorpayPaymentId
              ? "razorpay"
              : s.paymentMethod,
          amount: Number(s.amount).toFixed(2),
          paymentDate: new Date(),
          partyType: (order.customerId ? "customer" : "other") as "customer" | "other",
          partyId: order.customerId ?? null,
          partyName: order.customerName ?? null,
          referenceType: "order" as const,
          referenceId: order.id,
          notes: `Split payment leg`,
          recordedBy: req.user?.sub ?? null,
        })),
      );

      // Record one cash drawer movement per cash leg, in the same transaction
      // so the order, ledger, and drawer commit/rollback atomically.
      if (cashSessionId) {
        for (const s of splits) {
          if (s.paymentMethod !== "cash") continue;
          await recordCashSaleMovement(tx, {
            restaurantId,
            sessionId: cashSessionId,
            amount: Number(s.amount),
            orderId: order.id,
            userId: req.user?.sub ?? null,
          });
        }
      }
      return u;
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "ORDER_ALREADY_PAID") return void res.status(409).json({ error: "Order is already paid or no longer payable", code: "ORDER_ALREADY_PAID" });
    if (msg === "REGISTER_CLOSED") {
      return void res.status(409).json({ error: "Cash register was closed before split payment could be recorded. Open a register and try again.", code: "REGISTER_CLOSED" });
    }
    console.error("[Split] Transaction failed:", err);
    return void res.status(500).json({ error: "Failed to complete split payment" });
  }

  handleOrderCompletion(orderId, restaurantId, updated).catch(console.error);
  broadcastEvent(restaurantId, "order:status", { id: orderId, status: "completed", paymentStatus: "paid", orderNumber: order.orderNumber });

  res.json(updated);
});

router.post("/restaurants/:restaurantId/orders/:id/void", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);

  const rawReason = (req.body && typeof (req.body as any).reason === "string") ? String((req.body as any).reason).trim() : "";
  if (rawReason.length < 3) {
    return void res.status(400).json({ error: "A void reason of at least 3 characters is required.", code: "VOID_REASON_REQUIRED" });
  }

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "cancelled") return void res.status(400).json({ error: "Order is already cancelled" });
  // A completed order may still be voided (e.g. customer dispute / wrong order)
  // — we permit it so inventory can be reversed. Payment refunds are tracked
  // separately on the payments ledger.

  // Void + audit must be atomic — if the audit insert fails, the void itself
  // is rolled back so a destructive action is never recorded without trail.
  let updated: typeof ordersTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      const [u] = await tx.update(ordersTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(ordersTable.id, orderId)).returning();
      await tx.insert(auditLogsTable).values({
        restaurantId,
        userId: (req as any).user?.sub ?? null,
        userDisplay: (req as any).user?.email ?? null,
        role: (req as any).user?.isSuperAdmin ? "super_admin" : ((req as any).user?.role ?? null),
        module: "orders",
        action: "order.void",
        entity: "ORDER",
        entityId: orderId,
        oldValue: { status: order.status, paymentStatus: order.paymentStatus, totalAmount: order.totalAmount } as any,
        newValue: { status: "cancelled", reason: rawReason } as any,
        details: `Order ${order.orderNumber ?? orderId} voided: ${rawReason}`,
      });
      return u;
    });
  } catch (err) {
    console.error("[order-void] transactional audit failed — void aborted", err);
    return void res.status(500).json({ error: "Could not record void audit — order was not voided. Try again.", code: "VOID_AUDIT_FAILED" });
  }

  if (order.tableId) {
    await db.update(floorTablesTable).set({ status: "free" }).where(and(eq(floorTablesTable.id, order.tableId), eq(floorTablesTable.restaurantId, restaurantId)));
  }

  // Reverse any inventory that was auto-deducted for this order (packaging,
  // condiment, and ingredient kinds). Idempotent: looks up existing
  // 'use' transactions for this order and emits inverse 'adjustment' rows.
  try {
    const txns = await db.select().from(inventoryTransactionsTable).where(and(
      eq(inventoryTransactionsTable.restaurantId, restaurantId),
      eq(inventoryTransactionsTable.referenceType, "order"),
      eq(inventoryTransactionsTable.referenceId, orderId),
      eq(inventoryTransactionsTable.type, "use"),
    ));
    // Skip if we already wrote reversals for this order
    const reversed = await db.select({ id: inventoryTransactionsTable.id }).from(inventoryTransactionsTable).where(and(
      eq(inventoryTransactionsTable.restaurantId, restaurantId),
      eq(inventoryTransactionsTable.referenceType, "order_cancel"),
      eq(inventoryTransactionsTable.referenceId, orderId),
    ));
    if (reversed.length === 0) {
      for (const t of txns) {
        const qty = Number(t.quantity);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        await db.transaction(async (tx) => {
          const [inv] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, t.itemId)).for("update");
          if (!inv) return;
          const newStock = Number(inv.currentStock) + qty;
          await tx.update(inventoryItemsTable).set({ currentStock: newStock.toFixed(3), updatedAt: new Date() }).where(eq(inventoryItemsTable.id, inv.id));
          await tx.insert(inventoryTransactionsTable).values({
            itemId: inv.id, restaurantId, type: "adjustment", quantity: qty.toFixed(3),
            notes: `Restocked from cancelled order #${orderId}`,
            referenceId: orderId, referenceType: "order_cancel",
          });
        });
      }
    }
  } catch (err) {
    // Log but do not fail the void
    console.error("[order-void] inventory reversal failed", err);
  }

  broadcastEvent(restaurantId, "order:status", { id: orderId, status: "cancelled", orderNumber: order.orderNumber });
  void emitWebhookEvent(restaurantId, "order.cancelled", { id: orderId, orderNumber: order.orderNumber, status: "cancelled" });

  // Customer-Quality: record as a lost sale + accuracy event (KOT cancellation).
  try {
    const { lostSalesEventsTable, orderAccuracyEventsTable } = await import("../lib/db");
    await db.insert(lostSalesEventsTable).values({
      restaurantId, branchId: order.brandId ?? null, customerId: order.customerId ?? null,
      orderId, eventType: "cancelled_order", channel: order.orderType ?? null,
      reason: (req.body && (req.body as any).reason) ?? "Order voided",
      estimatedValue: String(order.totalAmount ?? "0.00"),
    }).catch(() => undefined);
    await db.insert(orderAccuracyEventsTable).values({
      restaurantId, branchId: order.brandId ?? null, orderId,
      eventType: "kot_cancel", weight: 2,
      notes: "Order voided", createdBy: (req as any).user?.sub ?? null,
    }).catch(() => undefined);
  } catch { /* non-fatal */ }

  res.json(updated);
});

router.post("/restaurants/:restaurantId/orders/:id/payment-intent", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const { customAmount, tipAmount: rawTipPI } = req.body as { customAmount?: number; tipAmount?: number };

  const [order] = await db.select().from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Order is not payable" });
  }

  // customAmount allows split payments to create a PI for a per-person share.
  // tipAmount (Task #421) is added on top so the gateway charges the full
  // grand total including the tip — otherwise we'd record tip revenue we
  // never actually collected.
  const tipPaise = Number.isFinite(Number(rawTipPI)) ? Math.max(0, Math.round(Number(rawTipPI) * 100)) : 0;
  const basePaise = customAmount !== undefined
    ? Math.round(Number(customAmount) * 100)
    : Math.round(Number(order.totalAmount) * 100);
  const amountPaise = basePaise + tipPaise;

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (stripeSecretKey) {
    try {
      const stripe = new Stripe(stripeSecretKey);
      const intent = await stripe.paymentIntents.create({
        amount: amountPaise,
        currency: "inr",
        metadata: { orderId: String(orderId), restaurantId: String(restaurantId) },
      });
      return res.json({ clientSecret: intent.client_secret, intentId: intent.id, mode: "live" });
    } catch {
      return void res.status(500).json({ error: "Failed to create payment intent" });
    }
  }

  // No Stripe key — return demo intent for test/development environments
  return res.json({
    clientSecret: null,
    intentId: `demo_pi_${orderId}_${Date.now()}`,
    mode: "demo",
    totalAmount: order.totalAmount,
  });
});

router.post("/restaurants/:restaurantId/orders/:id/razorpay-order", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const { customAmount, tipAmount: rawTipRzp } = req.body as { customAmount?: number; tipAmount?: number };

  const [order] = await db.select().from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Order is not payable" });
  }

  // customAmount allows split payments to create a Razorpay order for a per-person share.
  // tipAmount (Task #421) is added on top so Razorpay charges the full grand total
  // including the tip — otherwise the captured tip wouldn't be backed by gateway funds.
  const tipPaise = Number.isFinite(Number(rawTipRzp)) ? Math.max(0, Math.round(Number(rawTipRzp) * 100)) : 0;
  const basePaise = customAmount !== undefined
    ? Math.round(Number(customAmount) * 100)
    : Math.round(Number(order.totalAmount) * 100);
  const amountPaise = basePaise + tipPaise;

  const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
  const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
  if (razorpayKeyId && razorpayKeySecret) {
    try {
      const authHeader = `Basic ${Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64")}`;
      const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader },
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          notes: { orderId: String(orderId), restaurantId: String(restaurantId) },
        }),
      });
      if (!rzpRes.ok) {
        const err = await rzpRes.json().catch(() => ({})) as Record<string, unknown>;
        return void res.status(502).json({ error: "Razorpay order creation failed", details: err });
      }
      const rzpOrder = await rzpRes.json() as { id: string; amount: number; currency: string };
      return res.json({ id: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, keyId: razorpayKeyId, mode: "live" });
    } catch {
      return void res.status(500).json({ error: "Failed to create Razorpay order" });
    }
  }

  // Demo mode — no Razorpay keys configured
  return res.json({
    id: `demo_rzp_order_${orderId}_${Date.now()}`,
    amount: amountPaise,
    currency: "INR",
    keyId: null,
    mode: "demo",
  });
});

router.post("/restaurants/:restaurantId/orders/:id/pay", idempotency(), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.id);
  const { paymentMethod, stripePaymentIntentId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;
  // Tip captured at payment time (Task #421). Optional; validated and clamped
  // to >= 0 with up to 2 decimal places. Recorded on the order, payments
  // ledger, and auto-captured into the open daily tip pool against the
  // serving waiter so pooling/payroll sweeps include it.
  const rawTip = req.body?.tipAmount;
  let tipAmount = rawTip == null || rawTip === "" ? 0 : Math.max(0, Math.round(Number(rawTip) * 100) / 100);
  if (!Number.isFinite(tipAmount)) {
    return void res.status(400).json({ error: "tipAmount must be a finite number" });
  }
  // Plan/policy gating for tips: silently zero out tip capture if the
  // restaurant's plan lacks the staff_tips feature or the restaurant has
  // disabled tipping in its tip policy. Silent because POS clients on
  // mixed-plan tenants shouldn't fail the whole sale just because tips
  // aren't entitled — the sale still completes without a tip.
  if (tipAmount > 0) {
    const allowed = await restaurantHasFeature(restaurantId, "staff_tips");
    if (!allowed) tipAmount = 0;
    else {
      const [restRow] = await db.select({ tipPolicy: restaurantsTable.tipPolicy })
        .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
      if (restRow?.tipPolicy?.enabled === false) tipAmount = 0;
    }
  }

  // Strict payment method enum validation
  if (!["cash", "card", "upi", "room_charge"].includes(String(paymentMethod))) {
    return void res.status(400).json({ error: `Invalid payment method '${paymentMethod}'. Must be cash, card, upi, or room_charge.` });
  }

  // Load order — verify it exists and is payable before touching payment gateway
  const [order] = await db.select().from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  // A "completed" order can still be unpaid (e.g. the waiter closed the order
  // and the guest is settling at the till afterwards). Only block payment if
  // the order is cancelled or already paid — those are the truly non-payable
  // states. Concurrency is still guarded by the conditional UPDATE below
  // (ne(paymentStatus, "paid")).
  if (order.status === "cancelled") {
    return void res.status(400).json({ error: "Order is cancelled and cannot be paid" });
  }
  if (order.paymentStatus === "paid") {
    return void res.status(400).json({ error: "Order is already paid" });
  }

  // Room charge: post the order onto the guest's hotel folio instead of taking
  // payment now. The folio is settled at check-out via the consolidated flow.
  if (paymentMethod === "room_charge") {
    if (!order.hotelStayId) {
      return void res.status(400).json({ error: "Order is not linked to a hotel stay" });
    }
    const [restaurant] = await db.select({ tenantId: restaurantsTable.tenantId, isHotelMode: restaurantsTable.isHotelMode })
      .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
    if (!restaurant?.isHotelMode) {
      return void res.status(400).json({ error: "Hotel mode is not enabled for this outlet" });
    }
    const [stay] = await db.select().from(hotelStaysTable)
      .where(and(eq(hotelStaysTable.id, order.hotelStayId), eq(hotelStaysTable.tenantId, restaurant.tenantId)));
    if (!stay || stay.status !== "in_house") {
      return void res.status(400).json({ error: "Hotel stay is not in-house" });
    }
    let folio = (await db.select().from(hotelFoliosTable)
      .where(and(eq(hotelFoliosTable.stayId, stay.id), eq(hotelFoliosTable.status, "open"))))[0];
    if (!folio) {
      [folio] = await db.insert(hotelFoliosTable).values({
        tenantId: restaurant.tenantId, stayId: stay.id, status: "open",
      }).returning();
    }
    const total = Number(order.totalAmount);
    let updatedOrder: typeof ordersTable.$inferSelect | undefined;
    try {
      updatedOrder = await db.transaction(async tx => {
        const [u] = await tx.update(ordersTable).set({
          paymentMethod: "room_charge",
          paymentStatus: "paid",
          status: "completed",
          updatedAt: new Date(),
        }).where(and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.restaurantId, restaurantId),
          // See main /pay handler — completed-but-unpaid orders remain payable.
          ne(ordersTable.status, "cancelled"),
          ne(ordersTable.paymentStatus, "paid"),
        )).returning();
        if (!u) throw new Error("ORDER_ALREADY_PAID");
        if (u.tableId) {
          await tx.update(floorTablesTable).set({ status: "free" })
            .where(and(eq(floorTablesTable.id, u.tableId), eq(floorTablesTable.restaurantId, restaurantId)));
        }
        await tx.insert(hotelFolioLinesTable).values({
          folioId: folio!.id, tenantId: restaurant.tenantId, restaurantId,
          kind: "charge", source: "f&b",
          description: `Order #${u.orderNumber}`,
          amount: total.toFixed(2),
          refType: "order", refId: u.id,
          recordedByUserId: req.user?.sub ?? null,
        });
        const lines = await tx.select().from(hotelFolioLinesTable).where(eq(hotelFolioLinesTable.folioId, folio!.id));
        let charges = 0, payments = 0;
        for (const l of lines) {
          const a = Number(l.amount);
          if (l.kind === "charge") charges += a;
          else if (l.kind === "discount" || l.kind === "comp") charges -= a;
          else if (l.kind === "payment") payments += a;
        }
        await tx.update(hotelFoliosTable).set({
          totalCharges: charges.toFixed(2), totalPayments: payments.toFixed(2),
          balance: (charges - payments).toFixed(2), updatedAt: new Date(),
        }).where(eq(hotelFoliosTable.id, folio!.id));
        return u;
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "ORDER_ALREADY_PAID") return void res.status(409).json({ error: "Order is already paid", code: "ORDER_ALREADY_PAID" });
      console.error("[Pay/RoomCharge] Transaction failed:", err);
      return void res.status(500).json({ error: "Failed to post room charge" });
    }
    handleOrderCompletion(orderId, restaurantId, updatedOrder).catch(console.error);
    broadcastEvent(restaurantId, "order:status", { id: updatedOrder.id, status: "completed", paymentStatus: "paid", orderNumber: updatedOrder.orderNumber });
    broadcastOrderUpdate(updatedOrder.id, { id: updatedOrder.id, status: "completed", paymentStatus: "paid", orderNumber: updatedOrder.orderNumber });
    return void res.json(updatedOrder);
  }

  // Cash payments require an open cash register session — pre-flight check.
  // The authoritative lock happens inside the payment transaction below.
  if (paymentMethod === "cash") {
    const reg = await requireOpenCashRegister(restaurantId);
    if (!reg.ok) return void res.status(409).json({ error: reg.error, code: "REGISTER_CLOSED" });
  }

  // Card payment verification
  if (paymentMethod === "card") {
    if (!stripePaymentIntentId) {
      return void res.status(400).json({ error: "Card payments require a Stripe PaymentIntent ID" });
    }
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (stripeSecretKey) {
      if (String(stripePaymentIntentId).startsWith("demo_")) {
        return void res.status(400).json({ error: "Demo intent IDs cannot be used when Stripe is configured" });
      }
      try {
        const stripe = new Stripe(stripeSecretKey);
        const intent = await stripe.paymentIntents.retrieve(String(stripePaymentIntentId));
        if (intent.status !== "succeeded") {
          return void res.status(400).json({ error: `Payment not confirmed: ${intent.status}` });
        }
        if (intent.metadata?.orderId !== String(orderId) || intent.metadata?.restaurantId !== String(restaurantId)) {
          return void res.status(400).json({ error: "PaymentIntent does not belong to this order" });
        }
        // Tip (Task #421) is charged on top of the order total, so the
        // expected paise must include it to avoid rejecting legitimate
        // tip-inclusive payments.
        const expectedPaise = Math.round(Number(order.totalAmount) * 100) + Math.round(tipAmount * 100);
        if (intent.amount !== expectedPaise) {
          return void res.status(400).json({ error: "PaymentIntent amount does not match order total" });
        }
        if (intent.currency !== "inr") {
          return void res.status(400).json({ error: "PaymentIntent currency mismatch" });
        }
      } catch {
        return void res.status(400).json({ error: "Failed to verify PaymentIntent with Stripe" });
      }
    } else {
      if (!String(stripePaymentIntentId).startsWith("demo_")) {
        return void res.status(400).json({ error: "Stripe is not configured; only demo payment IDs are accepted" });
      }
    }
  }

  // UPI / Razorpay payment verification
  if (paymentMethod === "upi") {
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (razorpayKeySecret && razorpayKeyId) {
      if (!razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
        return void res.status(400).json({ error: "UPI payments require razorpayPaymentId, razorpayOrderId, and razorpaySignature" });
      }
      if (String(razorpayPaymentId).startsWith("demo_")) {
        return void res.status(400).json({ error: "Demo payment IDs cannot be used when Razorpay is configured" });
      }
      const { createHmac } = await import("crypto");
      const sigBody = `${razorpayOrderId}|${razorpayPaymentId}`;
      const expectedSig = createHmac("sha256", razorpayKeySecret).update(sigBody).digest("hex");
      if (expectedSig !== String(razorpaySignature)) {
        return void res.status(400).json({ error: "Razorpay signature verification failed" });
      }
      try {
        const authHeader = `Basic ${Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64")}`;
        const rzpPayRes = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}`, {
          headers: { Authorization: authHeader },
        });
        if (!rzpPayRes.ok) {
          return void res.status(400).json({ error: "Failed to fetch Razorpay payment details" });
        }
        const rzpPay = await rzpPayRes.json() as { status: string; amount: number; currency: string; order_id: string };
        if (rzpPay.status !== "captured") {
          return void res.status(400).json({ error: `Razorpay payment not captured: ${rzpPay.status}` });
        }
        // Tip (Task #421) is charged on top of the order total.
        const expectedPaise = Math.round(Number(order.totalAmount) * 100) + Math.round(tipAmount * 100);
        if (Math.abs(rzpPay.amount - expectedPaise) > 100) {
          return void res.status(400).json({ error: "Razorpay payment amount does not match order total" });
        }
        if (rzpPay.order_id !== String(razorpayOrderId)) {
          return void res.status(400).json({ error: "Razorpay payment is not linked to the expected Razorpay order" });
        }
        const rzpOrdRes = await fetch(`https://api.razorpay.com/v1/orders/${razorpayOrderId}`, {
          headers: { Authorization: authHeader },
        });
        if (!rzpOrdRes.ok) {
          return void res.status(400).json({ error: "Failed to fetch Razorpay order details" });
        }
        const rzpOrd = await rzpOrdRes.json() as { id: string; notes: Record<string, string> };
        if (rzpOrd.notes?.orderId !== String(orderId) || rzpOrd.notes?.restaurantId !== String(restaurantId)) {
          return void res.status(400).json({ error: "Razorpay order does not belong to this internal order or restaurant" });
        }
        const [existingUse] = await db.select({ id: ordersTable.id })
          .from(ordersTable)
          .where(and(eq(ordersTable.stripePaymentId, String(razorpayPaymentId)), eq(ordersTable.restaurantId, restaurantId)));
        if (existingUse && existingUse.id !== orderId) {
          return void res.status(409).json({ error: "Razorpay payment ID has already been used for another order" });
        }
      } catch {
        return void res.status(400).json({ error: "Failed to verify UPI payment with Razorpay" });
      }
    } else {
      if (razorpayPaymentId && !String(razorpayPaymentId).startsWith("demo_")) {
        return void res.status(400).json({ error: "Razorpay is not configured; only demo payment IDs are accepted" });
      }
    }
  }

  const storedPaymentId = stripePaymentIntentId ?? razorpayPaymentId ?? null;
  // Map gateway-backed payments to their gateway method in the ledger so the
  // "Online (Stripe/Razorpay)" reporting bucket reflects actual gateway volume.
  const ledgerMethod: string = stripePaymentIntentId
    ? "stripe"
    : razorpayPaymentId
      ? "razorpay"
      : paymentMethod;
  let updated: typeof ordersTable.$inferSelect | undefined;
  try {
    updated = await db.transaction(async tx => {
      // For cash payments: lock the open session FOR UPDATE and verify it's
      // still open. This prevents a race where the register is closed between
      // pre-flight and now, which would leave a paid cash sale without a drawer
      // entry.
      let cashSessionId: number | null = null;
      if (paymentMethod === "cash") {
        cashSessionId = await lockOpenCashRegister(tx, restaurantId);
        if (!cashSessionId) throw new Error("REGISTER_CLOSED");
      }

      // Conditional update guards against double-payment under concurrency.
      const [u] = await tx.update(ordersTable).set({
        paymentMethod,
        paymentStatus: "paid",
        status: "completed",
        stripePaymentId: storedPaymentId,
        tipAmount: tipAmount.toFixed(2),
        // Add tip onto the bill total so the payments ledger, cash drawer
        // movement, and receipts all reconcile with what the customer paid.
        totalAmount: (Number(order.totalAmount) + tipAmount).toFixed(2),
        updatedAt: new Date(),
      }).where(and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.restaurantId, restaurantId),
        // Allow paying a "completed" but still-unpaid order (settle-after-close
        // flow). Cancelled orders and already-paid orders stay non-payable;
        // ne(paymentStatus, "paid") preserves the double-payment guard.
        ne(ordersTable.status, "cancelled"),
        ne(ordersTable.paymentStatus, "paid"),
      )).returning();
      if (!u) throw new Error("ORDER_ALREADY_PAID");
      if (u.tableId) {
        await tx.update(floorTablesTable).set({ status: "free" })
          .where(and(eq(floorTablesTable.id, u.tableId), eq(floorTablesTable.restaurantId, restaurantId)));
      }
      await tx.insert(paymentsTable).values({
        restaurantId,
        direction: "in",
        method: ledgerMethod,
        amount: Number(u.totalAmount).toFixed(2),
        tipAmount: tipAmount.toFixed(2),
        paymentDate: new Date(),
        partyType: u.customerId ? "customer" : "other",
        partyId: u.customerId ?? null,
        partyName: u.customerName ?? null,
        referenceType: "order",
        referenceId: u.id,
        notes: null,
        recordedBy: req.user?.sub ?? null,
      });

      // Auto-capture tip into today's open pool, attributed to the serving
      // waiter (or the cashier if no waiter). The pool is created on demand
      // so the first tip of the day still lands somewhere. We use 'order'
      // sourceType so post-payment adjustments and reports can trace each
      // pool entry back to its originating order.
      if (tipAmount > 0) {
        const beneficiaryUserId = u.waiterId ?? req.user?.sub ?? null;
        if (beneficiaryUserId) {
          const today = new Date().toISOString().slice(0, 10);
          let [openPool] = await tx.select().from(tipPoolsTable).where(and(
            eq(tipPoolsTable.restaurantId, restaurantId),
            eq(tipPoolsTable.periodStart, today),
            eq(tipPoolsTable.periodEnd, today),
            eq(tipPoolsTable.status, "open"),
          )).limit(1);
          if (!openPool) {
            [openPool] = await tx.insert(tipPoolsTable).values({
              restaurantId, periodStart: today, periodEnd: today,
              status: "open", totalRupees: "0.00",
            }).returning();
          }
          await tx.insert(tipPoolEntriesTable).values({
            poolId: openPool.id, restaurantId, userId: beneficiaryUserId,
            sharePct: "0", amountRupees: tipAmount.toFixed(2),
            sourceType: "order", sourceOrderId: u.id, tableId: u.tableId ?? null,
            notes: `${paymentMethod} tip on order ${u.orderNumber}`,
          });
          await tx.update(tipPoolsTable)
            .set({ totalRupees: sql`COALESCE(${tipPoolsTable.totalRupees}, 0) + ${tipAmount.toFixed(2)}` })
            .where(eq(tipPoolsTable.id, openPool.id));
        }
      }

      // Cash drawer movement is part of the same transaction so the order,
      // payment ledger, and cash drawer all commit together (or all roll back).
      if (cashSessionId) {
        await recordCashSaleMovement(tx, {
          restaurantId,
          sessionId: cashSessionId,
          amount: Number(u.totalAmount),
          orderId,
          userId: req.user?.sub ?? null,
        });
      }
      return u;
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "ORDER_ALREADY_PAID") return void res.status(409).json({ error: "Order is already paid or no longer payable", code: "ORDER_ALREADY_PAID" });
    if (msg === "REGISTER_CLOSED") {
      return void res.status(409).json({ error: "Cash register was closed before payment could be recorded. Open a register and try again.", code: "REGISTER_CLOSED" });
    }
    console.error("[Pay] Transaction failed:", err);
    return void res.status(500).json({ error: "Failed to complete payment" });
  }

  handleOrderCompletion(orderId, restaurantId, updated).catch(console.error);
  // Accounting auto-post: POS sale → ledger (fail-soft, idempotent by orderNumber)
  void triggerAutoPost({
    restaurantId,
    source: "pos_sales",
    sourceRef: `order:${updated.id}`,
    entryDate: new Date().toISOString().slice(0, 10),
    amount: Number(updated.totalAmount ?? 0),
    memo: `POS sale ${updated.orderNumber}`,
    userId: (req.user?.sub ?? req.user?.id ?? null) as number | null,
  });
  // Service-timer: order has been billed (final stage).
  await recordTimerStage(restaurantId, updated.id, "billed");
  broadcastEvent(restaurantId, "order:status", { id: updated.id, status: "completed", paymentStatus: "paid", orderNumber: updated.orderNumber });
  broadcastOrderUpdate(updated.id, { id: updated.id, status: "completed", paymentStatus: "paid", orderNumber: updated.orderNumber });

  res.json(updated);
});

router.get("/restaurants/:restaurantId/kitchen/tickets", requirePlanFeature("kitchen_display"), async (req, res) => {
  const { status, kitchenId } = req.query;
  const restaurantId = Number(req.params.restaurantId);
  const conditions: ReturnType<typeof eq>[] = [eq(kitchenTicketsTable.restaurantId, restaurantId)];
  if (status) {
    conditions.push(eq(kitchenTicketsTable.status, String(status)));
  } else {
    // Default: hide cancelled / rejected tickets from the KDS feed. They
    // remain queryable explicitly via ?status=cancelled for audit views.
    conditions.push(sql`${kitchenTicketsTable.status} <> 'cancelled'`);
  }
  if (kitchenId) conditions.push(eq(kitchenTicketsTable.kitchenId, Number(kitchenId)));

  const tickets = await db.select().from(kitchenTicketsTable).where(and(...conditions)).orderBy(desc(kitchenTicketsTable.isPriority), kitchenTicketsTable.createdAt);

  const kitchens = await db.select().from(kitchensTable).where(eq(kitchensTable.restaurantId, restaurantId));
  const kitchenMap = new Map(kitchens.map(k => [k.id, k] as const));
  const defaultKitchenId = kitchens.find(k => k.isDefault)?.id ?? null;

  const enriched = await Promise.all(tickets.map(async (t) => {
    const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, t.orderId), eq(ordersTable.restaurantId, restaurantId)));
    const allItems = order ? await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id)) : [];

    // Filter to items whose menu item belongs to this ticket's kitchen
    let items = allItems;
    const allMenuItemIds = Array.from(new Set(allItems.map(i => i.menuItemId).filter((x): x is number => x != null)));
    const menuRowsAll = allMenuItemIds.length > 0
      ? await db.select({ id: menuItemsTable.id, kitchenId: menuItemsTable.kitchenId, imageUrl: menuItemsTable.imageUrl })
          .from(menuItemsTable)
          .where(and(eq(menuItemsTable.restaurantId, restaurantId), inArray(menuItemsTable.id, allMenuItemIds)))
      : [];
    const imageById = new Map(menuRowsAll.map(m => [m.id, m.imageUrl ?? null] as const));
    if (t.kitchenId != null && allItems.length > 0) {
      const itemKitchenById = new Map(menuRowsAll.map(m => [m.id, m.kitchenId ?? defaultKitchenId] as const));
      items = allItems.filter(i => {
        const k = i.menuItemId != null ? itemKitchenById.get(i.menuItemId) ?? defaultKitchenId : defaultKitchenId;
        return k === t.kitchenId;
      });
    }
    const itemIds = items.map(i => i.id);
    const ticketMods = itemIds.length > 0
      ? await db.select().from(orderItemModifiersTable).where(inArray(orderItemModifiersTable.orderItemId, itemIds))
      : [];
    const modsByItemTicket = new Map<number, typeof ticketMods>();
    for (const m of ticketMods) {
      const arr = modsByItemTicket.get(m.orderItemId) ?? [];
      arr.push(m);
      modsByItemTicket.set(m.orderItemId, arr);
    }
    const enrichedItems = items.map(i => ({
      ...i,
      menuItemImageUrl: i.menuItemId != null ? imageById.get(i.menuItemId) ?? null : null,
      modifiers: (modsByItemTicket.get(i.id) ?? []).map(m => ({
        id: m.id,
        modifierId: m.modifierId ?? null,
        modifierGroupId: m.modifierGroupId ?? null,
        groupName: m.groupName ?? null,
        name: m.modifierName,
        quantity: m.quantity ?? 1,
        price: m.price,
      })),
    }));

    let tableNumber: string | null = null;
    if (order?.tableId) {
      const [tbl] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, order.tableId), eq(floorTablesTable.restaurantId, restaurantId)));
      tableNumber = tbl?.tableNumber ?? null;
    }

    const kitchen = t.kitchenId != null ? kitchenMap.get(t.kitchenId) ?? null : null;

    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 60000));
    const expectedReadyMs = t.expectedReadyAt
      ? new Date(t.expectedReadyAt).getTime()
      : new Date(t.createdAt).getTime() + (t.expectedPrepMinutes ?? 15) * 60_000;
    const overdueMinutes = Math.floor((Date.now() - expectedReadyMs) / 60_000);
    const isDelayed = (t.delayAlertCount ?? 0) > 0 || overdueMinutes > 0;

    return {
      ...t,
      orderNumber: order?.orderNumber ?? "",
      tableNumber,
      orderType: order?.orderType ?? "dine_in",
      paymentStatus: order?.paymentStatus ?? null,
      customerName: order?.customerName ?? null,
      items: enrichedItems,
      kitchen: kitchen ? { id: kitchen.id, name: kitchen.name, autoPrint: kitchen.autoPrint, printerName: kitchen.printerName, paperSize: kitchen.paperSize } : null,
      elapsedMinutes,
      overdueMinutes: overdueMinutes > 0 ? overdueMinutes : 0,
      isDelayed,
    };
  }));

  res.json(enriched);
});

router.patch("/restaurants/:restaurantId/kitchen/tickets/:id/status", requirePlanFeature("kitchen_display"), idempotency(), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status } = req.body;
  const now = new Date();

  // Cancelling a KOT is destructive (waste, customer dispute, kitchen mistake)
  // — gate it behind manager/owner and require a written reason for audit.
  let cancelReason: string | null = null;
  if (status === "cancelled") {
    const role = (req as any).user?.role;
    const isSuperAdmin = (req as any).user?.isSuperAdmin;
    if (!isSuperAdmin && !["owner", "manager", "super_admin"].includes(role)) {
      return void res.status(403).json({ error: "Only owners or managers can cancel KOTs.", code: "FORBIDDEN_CANCEL" });
    }
    const raw = typeof req.body?.reason === "string" ? String(req.body.reason).trim() : "";
    if (raw.length < 3) {
      return void res.status(400).json({ error: "A cancel reason of at least 3 characters is required.", code: "CANCEL_REASON_REQUIRED" });
    }
    cancelReason = raw;
  }

  const updates: Record<string, unknown> = { status, updatedAt: now };
  if (status === "preparing") updates.startedAt = now;
  if (status === "ready" || status === "served") updates.completedAt = now;

  // For cancels, the ticket update + audit insert run in one transaction so
  // an audit failure rolls back the cancel — destructive change is never
  // recorded without an audit row.
  let updated: typeof kitchenTicketsTable.$inferSelect | undefined;
  if (status === "cancelled" && cancelReason) {
    try {
      updated = await db.transaction(async (tx) => {
        const [u] = await tx.update(kitchenTicketsTable).set(updates).where(and(eq(kitchenTicketsTable.id, Number(req.params.id)), eq(kitchenTicketsTable.restaurantId, restaurantId))).returning();
        if (!u) throw new Error("NOT_FOUND");
        await tx.insert(auditLogsTable).values({
          restaurantId,
          userId: (req as any).user?.sub ?? null,
          userDisplay: (req as any).user?.email ?? null,
          role: (req as any).user?.isSuperAdmin ? "super_admin" : ((req as any).user?.role ?? null),
          module: "kitchen",
          action: "ticket.cancel",
          entity: "KITCHEN_TICKET",
          entityId: u.id,
          newValue: { orderId: u.orderId, reason: cancelReason } as any,
          details: `KOT #${u.id} (order ${u.orderId}) cancelled: ${cancelReason}`,
        });
        return u;
      });
    } catch (err) {
      if ((err as Error).message === "NOT_FOUND") return void res.status(404).json({ error: "Not found" });
      console.error("[ticket-cancel] transactional audit failed — cancel aborted", err);
      return void res.status(500).json({ error: "Could not record cancel audit — KOT was not cancelled.", code: "CANCEL_AUDIT_FAILED" });
    }
  } else {
    const [u] = await db.update(kitchenTicketsTable).set(updates).where(and(eq(kitchenTicketsTable.id, Number(req.params.id)), eq(kitchenTicketsTable.restaurantId, restaurantId))).returning();
    if (!u) return void res.status(404).json({ error: "Not found" });
    updated = u;
  }

  // Service-timer: mirror the kitchen ticket transition onto the order so
  // the per-stage SLA chart (preparing/ready/served) reflects the kitchen
  // workflow, not just the front-of-house events.
  if (status === "preparing" || status === "ready" || status === "served") {
    await recordTimerStage(restaurantId, updated.orderId, status);
  }

  // Mirror timing onto order_items for this ticket's kitchen so per-item analytics work.
  if (status === "preparing" || status === "ready" || status === "served") {
    const allItems = await db.select({ id: orderItemsTable.id, menuItemId: orderItemsTable.menuItemId })
      .from(orderItemsTable).where(eq(orderItemsTable.orderId, updated.orderId));
    const ids = allItems.map(i => i.menuItemId).filter((x): x is number => x != null);
    const menuRows = ids.length > 0
      ? await db.select({ id: menuItemsTable.id, kitchenId: menuItemsTable.kitchenId })
          .from(menuItemsTable).where(and(eq(menuItemsTable.restaurantId, restaurantId), inArray(menuItemsTable.id, ids)))
      : [];
    const kitchenById = new Map(menuRows.map(m => [m.id, m.kitchenId] as const));
    const matchIds = allItems
      .filter(i => updated.kitchenId == null || (i.menuItemId != null && kitchenById.get(i.menuItemId) === updated.kitchenId))
      .map(i => i.id);
    if (matchIds.length > 0) {
      const itemUpdates: Record<string, unknown> = {};
      if (status === "preparing") itemUpdates.startedAt = now;
      if (status === "ready" || status === "served") itemUpdates.readyAt = now;
      await db.update(orderItemsTable).set(itemUpdates).where(inArray(orderItemsTable.id, matchIds));
    }
  }

  broadcastEvent(restaurantId, "ticket:status", { id: updated.id, status: updated.status, orderId: updated.orderId });

  await syncTokenWithTickets(updated.orderId, restaurantId).catch(() => {});

  // Notify the customer on the two transitions they care about: when the
  // kitchen STARTS preparing their food, and when it's READY. Works for
  // both registered customers (via customers.phone) AND walk-in / QR /
  // public guest orders (via orders.customer_phone fallback).
  if (status === "preparing" || status === "ready") {
    const [order] = await db.select({
      customerId: ordersTable.customerId,
      customerName: ordersTable.customerName,
      customerPhone: ordersTable.customerPhone,
      orderNumber: ordersTable.orderNumber,
    }).from(ordersTable).where(eq(ordersTable.id, updated.orderId));

    if (status === "ready") {
      await db.insert(notificationsTable).values({
        restaurantId,
        type: "order_status",
        title: "Order Ready",
        message: `Order #${order?.orderNumber ?? updated.orderId} is ready for pickup`,
        entityId: updated.orderId,
        entityType: "order",
      }).catch(() => {});
      broadcastEvent(restaurantId, "notification:new", { type: "order_status" });
    }

    // Resolve recipient: prefer linked customer record, fall back to the
    // guest phone captured on the order itself so QR / public orders
    // (which have customer_id = NULL) still get WhatsApp updates.
    let custName: string | null = null;
    let custPhone: string | null = null;
    let custEmail: string | null = null;
    if (order?.customerId) {
      const [c] = await db.select({ phone: customersTable.phone, email: customersTable.email, name: customersTable.name })
        .from(customersTable).where(eq(customersTable.id, order.customerId));
      custName = c?.name ?? null;
      custPhone = c?.phone ?? null;
      custEmail = c?.email ?? null;
    }
    if (!custPhone) custPhone = order?.customerPhone ?? null;
    if (!custName) custName = order?.customerName ?? "there";

    // For multi-kitchen orders, hold the "ready" WhatsApp until every
    // kitchen ticket on the order is ready/served — otherwise the guest
    // gets pinged before the rest of their food is actually done.
    let aggregateReady = true;
    if (status === "ready") {
      const pending = await db.select({ id: kitchenTicketsTable.id })
        .from(kitchenTicketsTable)
        .where(and(
          eq(kitchenTicketsTable.orderId, updated.orderId),
          notInArray(kitchenTicketsTable.status, ["ready", "served", "cancelled"]),
        ));
      aggregateReady = pending.length === 0;
    }

    // Dedupe: avoid double-pinging the customer if the same event has
    // already been sent for this order (e.g. multi-kitchen orders where
    // each KOT independently moves through preparing).
    const eventKey = status === "preparing" ? "order.preparing" : "order.ready";
    const dupe = await db.execute(sql`
      SELECT 1 FROM whatsapp_logs
      WHERE status='sent'
        AND meta->>'event'=${eventKey}
        AND meta->>'orderId'=${String(updated.orderId)}
      LIMIT 1
    `);
    const alreadySent = (dupe as any).rows?.length > 0 || (dupe as any).length > 0;

    if (custPhone && aggregateReady && !alreadySent) {
      const [rCountry] = await db.select({ country: restaurantsTable.country, name: restaurantsTable.name }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
      const to = toE164(custPhone, rCountry?.country ?? null) ?? custPhone;
      const orderNum = order?.orderNumber ?? String(updated.orderId);
      const restName = rCountry?.name ?? "our restaurant";
      const { renderRestaurantEventBody } = await import("../lib/whatsappEventTemplate");
      const rendered = status === "preparing"
        ? await renderRestaurantEventBody(restaurantId, "order.preparing", [custName, orderNum, restName, ""])
        : await renderRestaurantEventBody(restaurantId, "order.ready", [custName, orderNum, restName]);
      const body = rendered ?? (status === "preparing"
        ? `Hi ${custName}, the kitchen has started preparing your order #${orderNum}. We'll let you know when it's ready.`
        : `Hi ${custName}, your order #${orderNum} is ready! Please collect it.`);
      sendWhatsApp({
        to,
        body,
        restaurantId,
        meta: { event: eventKey, orderId: updated.orderId },
      }).catch(console.error);
    }

    if (status === "ready" && order?.customerId) {
      if (custEmail) {
        // Email the customer through the Super Admin–editable
        // `order_ready` template so the send lands in `email_logs`
        // and respects the restaurant's premium layout / branding.
        const [restaurant] = await db.select({ name: restaurantsTable.name }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
        const { sendByTemplateKey } = await import("../lib/emailSender");
        sendByTemplateKey("order_ready", custEmail, {
          name: custName,
          orderNumber: order.orderNumber,
          restaurant: restaurant?.name ?? "Restaurant",
          pickupNote: " for pickup",
        }, { restaurantId, recipientType: "customer" }).catch(console.error);
      }
      // Browser/web-push notification — runs in parallel with WhatsApp and is
      // best-effort: opt-in, quiet hours, and caps are enforced inside
      // sendWebPush, so we just hand off the event.
      sendWebPush({
        restaurantId,
        eventKey: "order.ready",
        category: "transactional",
        targetCustomerIds: order.customerId ? [order.customerId] : undefined,
        targetOrderId: updated.orderId,
        payload: {
          title: "Your order is ready!",
          body: `Order #${order.orderNumber ?? updated.orderId} is ready for pickup.`,
          url: `/orders/${updated.orderId}`,
          data: { orderId: updated.orderId, type: "order_ready", orderNumber: String(order.orderNumber ?? updated.orderId), customerName: custName ?? "" },
        },
      }).catch((err) => console.warn("web-push order.ready failed", err));
    }
  }

  res.json(updated);
});

// Per-item kitchen status update — used by the mobile KDS to track each
// line on a ticket (pending / preparing / ready / out_of_stock) without
// changing the whole ticket. Mirrors timer fields onto the order item.
router.patch(
  "/restaurants/:restaurantId/orders/:orderId/items/:itemId/kitchen-status",
  requireRole("owner", "manager", "kitchen", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const orderId = Number(req.params.orderId);
    const itemId = Number(req.params.itemId);
    const allowed = new Set(["pending", "preparing", "ready", "out_of_stock"]);
    const status = String(req.body?.status ?? "");
    if (!allowed.has(status)) {
      return void res.status(400).json({ error: "Invalid status", code: "INVALID_STATUS" });
    }
    const [item] = await db.select().from(orderItemsTable)
      .where(and(eq(orderItemsTable.id, itemId), eq(orderItemsTable.orderId, orderId)));
    if (!item) return void res.status(404).json({ error: "Not found" });
    // Confirm the order belongs to this restaurant.
    const [order] = await db.select({ id: ordersTable.id }).from(ordersTable)
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
    if (!order) return void res.status(404).json({ error: "Not found" });

    const now = new Date();
    const updates: Record<string, unknown> = { status };
    if (status === "preparing" && !item.startedAt) updates.startedAt = now;
    if (status === "ready" && !item.readyAt) updates.readyAt = now;
    if (status === "pending") {
      updates.startedAt = null;
      updates.readyAt = null;
    }
    const [updated] = await db.update(orderItemsTable).set(updates)
      .where(eq(orderItemsTable.id, itemId)).returning();
    broadcastEvent(restaurantId, "order:item-status", {
      orderId, itemId, status, startedAt: updated.startedAt, readyAt: updated.readyAt,
    });
    res.json(updated);
  },
);

router.patch("/restaurants/:restaurantId/kitchen/tickets/:id/priority", requireRole("owner", "manager", "kitchen", "super_admin"), requirePlanFeature("kitchen_display"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [existing] = await db.select().from(kitchenTicketsTable).where(and(eq(kitchenTicketsTable.id, Number(req.params.id)), eq(kitchenTicketsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const [updated] = await db.update(kitchenTicketsTable).set({ isPriority: !existing.isPriority, updatedAt: new Date() }).where(eq(kitchenTicketsTable.id, existing.id)).returning();
  broadcastEvent(restaurantId, "ticket:priority", { id: updated.id, isPriority: updated.isPriority, orderId: updated.orderId });
  res.json(updated);
});

// ───── Curbside Pickup ─────────────────────────────────────────────────────
// Queue: list active curbside orders (not yet handed over). Includes prep
// timer fields so the client can render the live "since arrived" timer.
router.get(
  "/restaurants/:restaurantId/orders/curbside/queue",
  requireRole("owner", "manager", "waiter", "cashier", "super_admin"),
  requirePlanFeature("dlv_curbside_pickup"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const rows = await db.select({
      id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status,
      customerName: ordersTable.customerName, customerPhone: ordersTable.customerPhone,
      totalAmount: ordersTable.totalAmount, createdAt: ordersTable.createdAt,
      vehicleColor: ordersTable.vehicleColor, vehicleModel: ordersTable.vehicleModel,
      vehicleNumber: ordersTable.vehicleNumber, parkingSpot: ordersTable.parkingSpot,
      curbsideAcceptedAt: ordersTable.curbsideAcceptedAt,
      curbsideArrivedAt: ordersTable.curbsideArrivedAt,
      curbsideHandedOverAt: ordersTable.curbsideHandedOverAt,
    }).from(ordersTable).where(and(
      eq(ordersTable.restaurantId, restaurantId),
      eq(ordersTable.orderType, "curbside"),
      notInArray(ordersTable.status, ["completed", "cancelled"]),
    )).orderBy(desc(ordersTable.curbsideArrivedAt), desc(ordersTable.createdAt));
    res.json(rows);
  },
);

// Hand-over: staff confirms the customer has received their order. Sets the
// handover timestamp, completes the order, and emits notifications.
router.post(
  "/restaurants/:restaurantId/orders/:id/curbside/handover",
  requireRole("owner", "manager", "waiter", "cashier", "super_admin"),
  requirePlanFeature("dlv_curbside_pickup"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const orderId = Number(req.params.id);
    const [order] = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
    if (!order) return void res.status(404).json({ error: "Order not found" });
    if (order.orderType !== "curbside") return void res.status(400).json({ error: "Not a curbside order" });
    if (order.curbsideHandedOverAt) return void res.status(400).json({ error: "Already handed over" });
    const now = new Date();
    const [updated] = await db.update(ordersTable).set({
      curbsideHandedOverAt: now,
      status: "completed",
      updatedAt: now,
    }).where(eq(ordersTable.id, orderId)).returning();
    broadcastEvent(restaurantId, "order:status", { id: updated.id, status: "completed", orderNumber: updated.orderNumber });
    broadcastEvent(restaurantId, "curbside:handover", { id: updated.id, orderNumber: updated.orderNumber });
    broadcastOrderUpdate(updated.id, { id: updated.id, status: "completed", curbsideHandedOverAt: now });
    void emitWebhookEvent(restaurantId, "order.completed", { id: updated.id, orderNumber: updated.orderNumber, status: "completed" });
    try {
      await recordAuditLog({
        req, module: "orders", action: "order.curbside_handover",
        entity: "order", entityId: updated.id, restaurantId,
        newValue: { handedOverAt: now },
      });
    } catch (err) { void err; }
    res.json(updated);
  },
);

// Report: counts + average pickup time + no-shows over a date range.
// no-show = curbside order whose current status is "ready" (kitchen done,
// waiting at curb) with no curbsideArrivedAt and older than 2 hours.
router.get(
  "/restaurants/:restaurantId/reports/curbside",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("dlv_curbside_pickup"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const fromStr = typeof req.query.from === "string" ? req.query.from : null;
    const toStr = typeof req.query.to === "string" ? req.query.to : null;
    const from = fromStr ? new Date(fromStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = toStr ? new Date(toStr) : new Date();

    const rows = await db.select({
      id: ordersTable.id, status: ordersTable.status,
      createdAt: ordersTable.createdAt,
      curbsideArrivedAt: ordersTable.curbsideArrivedAt,
      curbsideHandedOverAt: ordersTable.curbsideHandedOverAt,
      totalAmount: ordersTable.totalAmount,
    }).from(ordersTable).where(and(
      eq(ordersTable.restaurantId, restaurantId),
      eq(ordersTable.orderType, "curbside"),
      sql`${ordersTable.createdAt} >= ${from}`,
      sql`${ordersTable.createdAt} <= ${to}`,
    ));

    let totalPickupMs = 0;
    let pickupCount = 0;
    let noShows = 0;
    let revenue = 0;
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const r of rows) {
      if (r.curbsideArrivedAt && r.curbsideHandedOverAt) {
        totalPickupMs += new Date(r.curbsideHandedOverAt).getTime() - new Date(r.curbsideArrivedAt).getTime();
        pickupCount++;
      }
      if (r.status === "ready" && !r.curbsideArrivedAt && new Date(r.createdAt).getTime() < cutoff) {
        noShows++;
      }
      if (r.status === "completed") revenue += Number(r.totalAmount ?? 0);
    }

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      totalOrders: rows.length,
      handedOver: pickupCount,
      noShows,
      avgPickupSeconds: pickupCount > 0 ? Math.round(totalPickupMs / pickupCount / 1000) : 0,
      revenue: revenue.toFixed(2),
    });
  },
);

export default router;
