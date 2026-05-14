import { Router } from "express";
import { eq, and, inArray, desc, gte, lte, sql } from "drizzle-orm";
import Stripe from "stripe";
import { db, restaurantsTable, menusTable, menuCategoriesTable, menuItemsTable, modifierGroupsTable, modifiersTable, ordersTable, orderItemsTable, orderItemModifiersTable, kitchenTicketsTable, floorTablesTable, notificationsTable, reservationsTable, customersTable, restaurantSettingsTable } from "../lib/db";
import { broadcastEvent, broadcastOrderUpdate } from "../lib/socketio";
import { createKitchenTicketsForOrder } from "../lib/kitchenRouting";
import { generateGuestToken, validateGuestToken } from "../lib/guestToken";
import { createWaiterRequestPublic } from "./waiter-requests";
import { loadLoyaltyConfig, pickTier, getLifetimeEarned, getRecentLoyaltyHistory } from "../lib/loyalty";

const router = Router();

function generateOrderNumber(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}`;
}

router.get("/public/menu/:slug", async (req, res) => {
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.slug, req.params.slug));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  const [menu] = await db.select().from(menusTable).where(and(eq(menusTable.restaurantId, restaurant.id), eq(menusTable.isActive, true)));

  const [imageSettingRow] = await db.select().from(restaurantSettingsTable).where(and(eq(restaurantSettingsTable.restaurantId, restaurant.id), eq(restaurantSettingsTable.section, "menu-image")));
  const imageSettings = (imageSettingRow?.data as Record<string, unknown> | undefined) ?? {};
  const menuImageConfig = {
    aspectRatio: typeof imageSettings.aspectRatio === "string" ? imageSettings.aspectRatio : "1:1",
    fallbackPlaceholder: typeof imageSettings.fallbackPlaceholder === "string" ? imageSettings.fallbackPlaceholder : "",
    showInCustomerMenu: imageSettings.showInCustomerMenu !== false,
  };

  if (!menu) return void res.json({ restaurantId: restaurant.id, restaurantName: restaurant.name, restaurantSlug: restaurant.slug, logoUrl: restaurant.logoUrl, currency: restaurant.currency, menuImageConfig, categories: [] });

  const categories = await db.select().from(menuCategoriesTable).where(and(eq(menuCategoriesTable.menuId, menu.id), eq(menuCategoriesTable.isActive, true)));
  const enriched = await Promise.all(categories.map(async (cat) => {
    const items = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.categoryId, cat.id), eq(menuItemsTable.isAvailable, true)));
    const itemsWithMods = await Promise.all(items.map(async (item) => {
      const groups = await db.select().from(modifierGroupsTable).where(eq(modifierGroupsTable.menuItemId, item.id));
      const groupsWithMods = await Promise.all(groups.map(async (g) => {
        const mods = await db.select().from(modifiersTable).where(and(eq(modifiersTable.groupId, g.id), eq(modifiersTable.isAvailable, true)));
        return { ...g, modifiers: mods };
      }));
      return { ...item, modifierGroups: groupsWithMods };
    }));
    return { ...cat, items: itemsWithMods };
  }));

  res.json({
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    restaurantSlug: restaurant.slug,
    logoUrl: restaurant.logoUrl,
    currency: restaurant.currency,
    menuImageConfig,
    menuBannerUrl: menu.imageUrl ?? null,
    categories: enriched,
  });
});

router.post("/public/orders", async (req, res) => {
  const { restaurantId, tableId, customerName, customerPhone, notes, items } = req.body;

  if (!restaurantId || !items || !Array.isArray(items) || items.length === 0) {
    return void res.status(400).json({ error: "restaurantId and items are required" });
  }

  let subtotal = 0;
  const enrichedItems: Array<{ mi: typeof menuItemsTable.$inferSelect; qty: number; notes?: string; modifiers: Array<{ id: number; name: string; price: string }> }> = [];

  for (const item of items as Array<{ menuItemId: number; quantity: number; notes?: string; modifierIds?: number[] }>) {
    if (!item.menuItemId || !item.quantity) continue;
    const [mi] = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.id, item.menuItemId), eq(menuItemsTable.restaurantId, restaurantId)));
    if (!mi) continue;

    const modifierIds = item.modifierIds ?? [];
    let resolvedMods: Array<{ id: number; name: string; price: string }> = [];
    if (modifierIds.length > 0) {
      const validGroups = await db.select({ id: modifierGroupsTable.id }).from(modifierGroupsTable).where(eq(modifierGroupsTable.menuItemId, mi.id));
      const validGroupIds = validGroups.map(g => g.id);
      if (validGroupIds.length > 0) {
        const dbMods = await db.select().from(modifiersTable).where(
          and(inArray(modifiersTable.id, modifierIds), inArray(modifiersTable.groupId, validGroupIds), eq(modifiersTable.isAvailable, true))
        );
        resolvedMods = dbMods.map(m => ({ id: m.id, name: m.name, price: m.price }));
      }
    }

    const modTotal = resolvedMods.reduce((s, m) => s + Number(m.price), 0);
    subtotal += (Number(mi.price) + modTotal) * item.quantity;
    enrichedItems.push({ mi, qty: item.quantity, notes: item.notes, modifiers: resolvedMods });
  }

  if (enrichedItems.length === 0) {
    return void res.status(400).json({ error: "No valid menu items found" });
  }

  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) return void res.status(400).json({ error: "Restaurant not found" });

  const taxRate = Number(restaurant.taxRate ?? 5) / 100;
  const taxAmount = subtotal * taxRate;
  const totalAmount = subtotal + taxAmount;

  const [order] = await db.insert(ordersTable).values({
    restaurantId, tableId: tableId ?? null, orderNumber: generateOrderNumber(), orderType: "dine_in",
    subtotal: subtotal.toFixed(2), taxAmount: taxAmount.toFixed(2),
    serviceCharge: "0.00", discountAmount: "0.00",
    totalAmount: totalAmount.toFixed(2), customerName: customerName ?? null, customerPhone: customerPhone ?? null, notes: notes ?? null,
  }).returning();

  for (const ei of enrichedItems) {
    const modTotal = ei.modifiers.reduce((s, m) => s + Number(m.price), 0);
    const unitPrice = Number(ei.mi.price) + modTotal;
    const [oi] = await db.insert(orderItemsTable).values({
      orderId: order.id, menuItemId: ei.mi.id, menuItemName: ei.mi.name,
      quantity: ei.qty, unitPrice: unitPrice.toFixed(2), totalPrice: (unitPrice * ei.qty).toFixed(2), notes: ei.notes ?? null,
    }).returning();
    for (const mod of ei.modifiers) {
      await db.insert(orderItemModifiersTable).values({ orderItemId: oi.id, modifierName: mod.name, price: mod.price });
    }
  }

  const createdTickets = await createKitchenTicketsForOrder({ orderId: order.id, restaurantId, isPriority: false });

  if (tableId) {
    const [validTable] = await db.select({ id: floorTablesTable.id }).from(floorTablesTable).where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId)));
    if (validTable) {
      await db.update(floorTablesTable).set({ status: "occupied" }).where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId)));
    }
    await db.insert(notificationsTable).values({ restaurantId, type: "new_order", title: "New QR Order", message: `QR order from table. Order: ${order.orderNumber}` });
    broadcastEvent(restaurantId, "notification:new", { type: "new_order" });
  }

  for (const t of createdTickets) {
    broadcastEvent(restaurantId, "order:new", { id: order.id, orderNumber: order.orderNumber, status: order.status, tableId, ticketId: t.ticketId, kitchenId: t.kitchenId });
  }

  const guestToken = generateGuestToken(order.id);
  res.status(201).json({ orderId: order.id, orderNumber: order.orderNumber, status: order.status, totalAmount: order.totalAmount, guestToken });
});

router.get("/public/orders/verify-session", async (req, res) => {
  const { orderId, token, sessionId } = req.query as { orderId?: string; token?: string; sessionId?: string };
  const id = Number(orderId);
  if (!id || !validateGuestToken(id, token)) {
    return void res.status(403).json({ error: "Invalid or missing order token" });
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.paymentStatus === "paid") {
    return res.json({ verified: true, paymentStatus: "paid", orderId: order.id, orderNumber: order.orderNumber, totalAmount: order.totalAmount });
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey && sessionId) {
    try {
      const stripe = new Stripe(stripeKey);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === "paid" && String(session.metadata?.orderId) === String(id)) {
        await db.update(ordersTable).set({ paymentStatus: "paid", status: "preparing" }).where(eq(ordersTable.id, id));
        broadcastOrderUpdate(id, { id, paymentStatus: "paid", status: "preparing" });
        broadcastEvent(order.restaurantId, "order:update", { id, paymentStatus: "paid", status: "preparing" });
        return res.json({ verified: true, paymentStatus: "paid", orderId: order.id, orderNumber: order.orderNumber, totalAmount: order.totalAmount });
      }
      return res.json({ verified: false, paymentStatus: session.payment_status });
    } catch {
      return void res.status(500).json({ error: "Failed to verify session" });
    }
  }
  return void res.json({ verified: false, paymentStatus: order.paymentStatus });
});

router.get("/public/orders/:id", async (req, res) => {
  const orderId = Number(req.params.id);
  const { token } = req.query as { token?: string };
  if (!validateGuestToken(orderId, token)) {
    return void res.status(403).json({ error: "Invalid or missing order token" });
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) return void res.status(404).json({ error: "Not found" });
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  return void res.json({ id: order.id, orderNumber: order.orderNumber, status: order.status, paymentStatus: order.paymentStatus, totalAmount: order.totalAmount, items, createdAt: order.createdAt });
});

router.post("/public/orders/:id/payment-intent", async (req, res) => {
  const orderId = Number(req.params.id);
  const { token } = req.query as { token?: string };
  if (!validateGuestToken(orderId, token)) {
    return void res.status(403).json({ error: "Invalid or missing order token" });
  }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.paymentStatus === "paid") return void res.json({ success: true, alreadyPaid: true, totalAmount: order.totalAmount });

  const [restaurant] = await db.select({ currency: restaurantsTable.currency, slug: restaurantsTable.slug }).from(restaurantsTable).where(eq(restaurantsTable.id, order.restaurantId));
  const currency = (restaurant?.currency ?? "INR").toLowerCase();
  const amountSmallestUnit = Math.round(Number(order.totalAmount) * 100);
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (stripeKey) {
    try {
      const stripe = new Stripe(stripeKey);
      const baseUrl = process.env.PUBLIC_URL?.replace(/\/$/, "") ?? "";
      const returnUrl = `${baseUrl}/menu/${restaurant?.slug ?? ""}/${order.tableId ?? ""}`;
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price_data: { currency, product_data: { name: `Order ${order.orderNumber}` }, unit_amount: amountSmallestUnit }, quantity: 1 }],
        success_url: `${returnUrl}?order=${orderId}&token=${token}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: returnUrl,
        metadata: { orderId: String(orderId) },
      });
      return res.json({ mode: "live", checkoutUrl: session.url, totalAmount: order.totalAmount });
    } catch {
      return void res.status(500).json({ error: "Failed to create checkout session" });
    }
  }

  const intentId = `demo_pi_${orderId}_${Date.now()}`;
  return res.json({ mode: "demo", clientSecret: null, intentId, totalAmount: order.totalAmount });
});

router.post("/public/orders/:id/pay", async (req, res) => {
  const orderId = Number(req.params.id);
  const { token } = req.query as { token?: string };
  if (!validateGuestToken(orderId, token)) {
    return void res.status(403).json({ error: "Invalid or missing order token" });
  }

  const { intentId, paymentMethod } = req.body as { intentId?: string; paymentMethod?: string };
  if (!intentId) return void res.status(400).json({ error: "intentId is required" });

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.paymentStatus === "paid") return void res.json({ success: true, alreadyPaid: true, totalAmount: order.totalAmount });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey && !intentId.startsWith("demo_")) {
    try {
      const stripe = new Stripe(stripeKey);
      const intent = await stripe.paymentIntents.retrieve(intentId);
      if (intent.status !== "succeeded") {
        return void res.status(400).json({ error: "Payment not yet confirmed by Stripe" });
      }
    } catch {
      return void res.status(400).json({ error: "Could not verify payment with Stripe" });
    }
  } else if (!stripeKey && !intentId.startsWith("demo_")) {
    return void res.status(400).json({ error: "Invalid payment intent ID" });
  }

  const [updated] = await db.update(ordersTable)
    .set({ paymentStatus: "paid", paymentMethod: paymentMethod ?? "card", stripePaymentId: intentId })
    .where(eq(ordersTable.id, orderId))
    .returning();

  broadcastEvent(order.restaurantId, "order:update", { id: order.id, status: order.status, paymentStatus: "paid" });
  broadcastOrderUpdate(orderId, { id: order.id, status: order.status, paymentStatus: "paid" });

  res.json({ success: true, totalAmount: updated.totalAmount });
});

const waiterCallCooldown = new Map<string, number>();
const ALLOWED_WAITER_TYPES = new Set(["call_waiter", "request_bill", "water", "custom"]);

router.post("/public/call-waiter", async (req, res) => {
  const { restaurantId, tableId, token, type, note } = req.body;
  if (!restaurantId) return void res.status(400).json({ error: "restaurantId required" });
  if (!tableId) return void res.status(400).json({ error: "tableId required" });
  const [table] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId)));
  if (!table) return void res.status(403).json({ error: "Invalid table or restaurant" });
  if (token) {
    const [activeOrder] = await db.select({ id: ordersTable.id }).from(ordersTable)
      .where(and(eq(ordersTable.tableId, tableId), eq(ordersTable.restaurantId, restaurantId)))
      .orderBy(desc(ordersTable.createdAt));
    if (activeOrder && !validateGuestToken(activeOrder.id, token)) {
      return void res.status(403).json({ error: "Invalid order token" });
    }
  }
  const reqType = typeof type === "string" && ALLOWED_WAITER_TYPES.has(type) ? type : "call_waiter";
  const trimmedNote = typeof note === "string" ? note.trim().slice(0, 200) : "";
  if (reqType === "custom" && !trimmedNote) {
    return void res.status(400).json({ error: "Note is required for custom requests" });
  }

  const cooldownKey = `${restaurantId}:${tableId}`;
  const now = Date.now();
  const last = waiterCallCooldown.get(cooldownKey) ?? 0;
  if (now - last < 30_000) {
    const wait = Math.ceil((30_000 - (now - last)) / 1000);
    return void res.status(429).json({ error: `Please wait ${wait}s before sending another request` });
  }
  waiterCallCooldown.set(cooldownKey, now);
  if (waiterCallCooldown.size > 5000) {
    for (const [k, t] of waiterCallCooldown) if (now - t > 60_000) waiterCallCooldown.delete(k);
  }

  const row = await createWaiterRequestPublic({
    restaurantId,
    tableId,
    tableNumber: table.tableNumber,
    type: reqType,
    note: trimmedNote || null,
  });
  return void res.json({ success: true, requestId: row.id, message: "Waiter has been notified" });
});

router.get("/public/restaurants/:slug", async (req, res) => {
  const [restaurant] = await db.select({ id: restaurantsTable.id, name: restaurantsTable.name, slug: restaurantsTable.slug, logoUrl: restaurantsTable.logoUrl, currency: restaurantsTable.currency }).from(restaurantsTable).where(eq(restaurantsTable.slug, req.params.slug));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });
  res.json(restaurant);
});

router.post("/public/restaurants/:slug/reservations", async (req, res) => {
  const { guestName, guestPhone, guestEmail, partySize, scheduledAt, notes } = req.body;
  if (!guestName || typeof guestName !== "string" || !guestName.trim()) return void res.status(400).json({ error: "Name is required" });
  if (!guestPhone || typeof guestPhone !== "string" || !guestPhone.trim()) return void res.status(400).json({ error: "Phone is required" });
  const ps = Number(partySize);
  if (!ps || ps < 1) return void res.status(400).json({ error: "Party size must be at least 1" });
  if (ps > 50) return void res.status(400).json({ error: "Party size too large — please call us directly" });
  if (!scheduledAt) return void res.status(400).json({ error: "Date and time required" });
  const dt = new Date(scheduledAt);
  if (Number.isNaN(dt.getTime())) return void res.status(400).json({ error: "Invalid date/time" });
  if (dt.getTime() < Date.now() - 60_000) return void res.status(400).json({ error: "Reservation must be in the future" });

  const [restaurant] = await db.select({ id: restaurantsTable.id, name: restaurantsTable.name }).from(restaurantsTable).where(eq(restaurantsTable.slug, req.params.slug));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  const [reservation] = await db.insert(reservationsTable).values({
    restaurantId: restaurant.id,
    guestName: guestName.trim(),
    guestPhone: guestPhone.trim(),
    guestEmail: guestEmail?.trim() ?? null,
    partySize: ps,
    scheduledAt: dt,
    durationMinutes: 90,
    notes: notes?.trim() ?? null,
    status: "pending",
  }).returning();

  await db.insert(notificationsTable).values({
    restaurantId: restaurant.id,
    type: "reservation_request",
    title: "New reservation request",
    message: `${guestName.trim()} for ${ps} on ${dt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`,
    entityId: reservation.id,
    entityType: "reservation",
  });
  broadcastEvent(restaurant.id, "notification:new", { type: "reservation_request", id: reservation.id });
  broadcastEvent(restaurant.id, "reservation:new", { id: reservation.id });

  res.status(201).json({
    id: reservation.id,
    status: reservation.status,
    guestName: reservation.guestName,
    partySize: reservation.partySize,
    scheduledAt: reservation.scheduledAt,
    restaurantName: restaurant.name,
  });
});

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.map(p => p.length <= 1 ? p : `${p[0]}${"*".repeat(Math.max(1, p.length - 1))}`).join(" ");
}

router.get("/public/restaurants/:slug/reservations/lookup", async (req, res) => {
  const { phone, date } = req.query as { phone?: string; date?: string };
  if (!phone || !phone.trim()) return void res.status(400).json({ error: "Phone is required" });
  if (!date) return void res.status(400).json({ error: "Date is required" });
  const normalizedPhone = phone.trim().replace(/[\s\-()]/g, "");
  if (normalizedPhone.length < 6) return void res.status(400).json({ error: "Phone number too short" });

  const [restaurant] = await db.select({ id: restaurantsTable.id }).from(restaurantsTable).where(eq(restaurantsTable.slug, req.params.slug));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  const start = new Date(`${date}T00:00:00`);
  if (Number.isNaN(start.getTime())) return void res.status(400).json({ error: "Invalid date" });
  const end = new Date(start.getTime() + 24 * 60 * 60_000);

  const rows = await db.select({
    id: reservationsTable.id,
    guestName: reservationsTable.guestName,
    partySize: reservationsTable.partySize,
    scheduledAt: reservationsTable.scheduledAt,
    status: reservationsTable.status,
    storedPhone: reservationsTable.guestPhone,
  }).from(reservationsTable).where(and(
    eq(reservationsTable.restaurantId, restaurant.id),
    gte(reservationsTable.scheduledAt, start),
    sql`${reservationsTable.scheduledAt} < ${end}`,
  )).orderBy(desc(reservationsTable.scheduledAt)).limit(50);

  const matches = rows.filter(r => (r.storedPhone ?? "").replace(/[\s\-()]/g, "") === normalizedPhone)
    .slice(0, 10)
    .map(r => ({
      id: r.id,
      guestName: maskName(r.guestName),
      partySize: r.partySize,
      scheduledAt: r.scheduledAt,
      status: r.status,
      notes: null as string | null,
    }));
  res.json(matches);
});

// In-memory IP rate limiter for the public loyalty lookup — guards against
// phone-number enumeration. Window: 60s, max 10 requests per IP.
const loyaltyLookupBuckets = new Map<string, number[]>();
function loyaltyLookupAllowed(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - 60_000;
  const arr = (loyaltyLookupBuckets.get(ip) ?? []).filter(t => t > cutoff);
  if (arr.length >= 10) { loyaltyLookupBuckets.set(ip, arr); return false; }
  arr.push(now);
  loyaltyLookupBuckets.set(ip, arr);
  if (loyaltyLookupBuckets.size > 5000) {
    // Cheap eviction to prevent unbounded growth.
    for (const [k, v] of loyaltyLookupBuckets) {
      if (!v.some(t => t > cutoff)) loyaltyLookupBuckets.delete(k);
    }
  }
  return true;
}

router.post("/public/loyalty/lookup", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (!loyaltyLookupAllowed(ip)) {
    return void res.status(429).json({ error: "Too many lookups. Please try again in a minute." });
  }
  const { slug, phone, email } = req.body as { slug?: string; phone?: string; email?: string };
  const phoneTrim = phone?.trim() ?? "";
  const emailTrim = email?.trim().toLowerCase() ?? "";
  const hasPhone = phoneTrim.length >= 6;
  const hasEmail = emailTrim.length >= 5 && emailTrim.includes("@");
  if (!slug || (!hasPhone && !hasEmail)) {
    return void res.status(400).json({ error: "slug and either phone (6+ digits) or email required" });
  }
  const [restaurant] = await db.select({ id: restaurantsTable.id, name: restaurantsTable.name, currency: restaurantsTable.currency })
    .from(restaurantsTable).where(eq(restaurantsTable.slug, slug));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  const cfg = await loadLoyaltyConfig(restaurant.id);
  if (!cfg.enabled) return void res.status(404).json({ error: "Loyalty program not active" });

  const identityFilter = hasPhone
    ? eq(customersTable.phone, phoneTrim)
    : eq(customersTable.email, emailTrim);
  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.restaurantId, restaurant.id), identityFilter));
  if (!customer) {
    return void res.json({
      found: false,
      restaurantName: restaurant.name,
      currency: restaurant.currency,
      redemptionRate: cfg.redemptionRate,
      pointsPerCurrencyUnit: cfg.pointsPerCurrencyUnit,
      tiers: cfg.tiers,
    });
  }

  const lifetime = await getLifetimeEarned(customer.id, restaurant.id);
  const tier = pickTier(lifetime, cfg.tiers);
  const history = await getRecentLoyaltyHistory(customer.id, restaurant.id, 10);

  // Determine next tier (if any) and the points needed to reach it.
  const sortedTiers = [...cfg.tiers].sort((a, b) => Number(a.threshold) - Number(b.threshold));
  const nextTier = sortedTiers.find(t => Number(t.threshold) > lifetime) ?? null;

  // Minimize PII: do not expose internal customer.id or full name; greet by first name only.
  const firstName = (customer.name ?? "").trim().split(/\s+/)[0] ?? "";

  res.json({
    found: true,
    restaurantName: restaurant.name,
    currency: restaurant.currency,
    customer: { firstName },
    balance: customer.loyaltyPoints,
    tier: { id: tier.id, name: tier.name, multiplier: Number(tier.multiplier ?? 1) },
    nextTier: nextTier ? { id: nextTier.id, name: nextTier.name, threshold: Number(nextTier.threshold), pointsToGo: Math.max(0, Number(nextTier.threshold) - lifetime) } : null,
    redemptionRate: cfg.redemptionRate,
    pointsPerCurrencyUnit: cfg.pointsPerCurrencyUnit,
    expiryMonths: cfg.expiryMonths,
    history: history.map(h => ({
      points: h.points,
      type: h.type,
      reason: h.reason,
      createdAt: h.createdAt,
      expiresAt: h.expiresAt,
    })),
  });
});

router.post("/public/feedback", async (req, res) => {
  const { orderId, rating, comment, token } = req.body;
  if (!validateGuestToken(Number(orderId), token)) {
    return void res.status(403).json({ error: "Invalid or missing order token" });
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, Number(orderId)));
  if (order) {
    await db.insert(notificationsTable).values({ restaurantId: order.restaurantId, type: "feedback", title: `${rating}/5 Rating`, message: comment ?? `Customer gave ${rating} stars for order ${order.orderNumber}` });
  }
  res.status(201).json({ success: true });
});

export default router;
