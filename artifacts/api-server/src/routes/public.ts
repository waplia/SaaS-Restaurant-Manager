import { Router } from "express";
import { eq, and, inArray, desc, gte, lte, sql } from "drizzle-orm";
import Stripe from "stripe";
import { db, restaurantsTable, menusTable, menuCategoriesTable, menuItemsTable, modifierGroupsTable, modifiersTable, ordersTable, orderItemsTable, orderItemModifiersTable, kitchenTicketsTable, floorTablesTable, notificationsTable, reservationsTable, customersTable, restaurantSettingsTable, tenantsTable, subscriptionPlansTable, isFeatureEnabled, PLAN_BOOLEAN_FEATURES, reviewQrsTable, reviewQrScansTable, customerFeedbackTable, feedbackRecoveryTasksTable, feedbackWallItemsTable, externalReviewsTable, branchesTable, surveysTable, surveyQuestionsTable, surveyResponsesTable } from "../lib/db";
import { reserveCredits, commitReservation, refundReservation, resolveCreditRule, priceCredits, gatePublicAiCall, type AiCreditReservation } from "../lib/aiCredits";
import { AIProviderService } from "../lib/aiProviderService";
import { logger } from "../lib/logger";
import { createHash } from "crypto";

async function checkRestaurantFeature(
  restaurantId: number | null | undefined,
  featureKey: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!restaurantId) return { ok: false, status: 400, error: "Restaurant required" };
  const [row] = await db
    .select({ planId: tenantsTable.planId, isSuspended: tenantsTable.isSuspended })
    .from(restaurantsTable)
    .innerJoin(tenantsTable, eq(restaurantsTable.tenantId, tenantsTable.id))
    .where(eq(restaurantsTable.id, restaurantId));
  if (!row) return { ok: false, status: 404, error: "Restaurant not found" };
  if (row.isSuspended) return { ok: false, status: 403, error: "Account suspended" };
  if (!row.planId) return { ok: true };
  const [plan] = await db
    .select({ featureFlags: subscriptionPlansTable.featureFlags })
    .from(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.id, row.planId));
  if (plan && !isFeatureEnabled(plan.featureFlags, featureKey)) {
    const def = PLAN_BOOLEAN_FEATURES.find((f) => f.key === featureKey);
    return { ok: false, status: 403, error: `This restaurant's plan doesn't include ${def?.label ?? featureKey}.` };
  }
  return { ok: true };
}

async function checkRestaurantFeatureBySlug(
  slug: string,
  featureKey: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [r] = await db.select({ id: restaurantsTable.id }).from(restaurantsTable).where(eq(restaurantsTable.slug, slug));
  if (!r) return { ok: false, status: 404, error: "Restaurant not found" };
  return checkRestaurantFeature(r.id, featureKey);
}
import { broadcastEvent, broadcastOrderUpdate } from "../lib/socketio";
import { createKitchenTicketsForOrder } from "../lib/kitchenRouting";
import { issueTokenForOrder } from "../lib/tokens";
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

  const [nutritionSettingRow] = await db.select().from(restaurantSettingsTable).where(and(eq(restaurantSettingsTable.restaurantId, restaurant.id), eq(restaurantSettingsTable.section, "menu-nutrition")));
  const nutritionSettings = (nutritionSettingRow?.data as Record<string, unknown> | undefined) ?? {};
  const showNutritionOnQrMenu = nutritionSettings.showNutritionOnQrMenu === true;

  const projectItem = (item: typeof menuItemsTable.$inferSelect) => {
    const base = {
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price,
      imageUrl: item.imageUrl,
      isAvailable: item.isAvailable,
      isVeg: item.isVeg,
      calories: item.calories,
      prepTime: item.preparationTime,
      tags: item.tags ?? [],
      allergens: item.allergens ?? [],
    };
    if (!showNutritionOnQrMenu) return base;
    return {
      ...base,
      nutrition: {
        proteinG: item.proteinG != null ? Number(item.proteinG) : null,
        fatG: item.fatG != null ? Number(item.fatG) : null,
        carbsG: item.carbsG != null ? Number(item.carbsG) : null,
        containsDairy: item.containsDairy,
        containsNuts: item.containsNuts,
        containsGluten: item.containsGluten,
        isVegan: item.isVegan,
        isJain: item.isJain,
        spicyLevel: item.spicyLevel,
      },
    };
  };

  if (!menu) return void res.json({ restaurantId: restaurant.id, restaurantName: restaurant.name, restaurantSlug: restaurant.slug, logoUrl: restaurant.logoUrl, currency: restaurant.currency, menuImageConfig, showNutritionOnQrMenu, categories: [] });

  const categories = await db.select().from(menuCategoriesTable).where(and(eq(menuCategoriesTable.menuId, menu.id), eq(menuCategoriesTable.isActive, true)));
  const enriched = await Promise.all(categories.map(async (cat) => {
    const items = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.categoryId, cat.id), eq(menuItemsTable.isAvailable, true)));
    const itemsWithMods = await Promise.all(items.map(async (item) => {
      const groups = await db.select().from(modifierGroupsTable).where(eq(modifierGroupsTable.menuItemId, item.id));
      const groupsWithMods = await Promise.all(groups.map(async (g) => {
        const mods = await db.select().from(modifiersTable).where(and(eq(modifiersTable.groupId, g.id), eq(modifiersTable.isAvailable, true)));
        return { ...g, modifiers: mods };
      }));
      return { ...projectItem(item), modifierGroups: groupsWithMods };
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
    showNutritionOnQrMenu,
    menuBannerUrl: menu.imageUrl ?? null,
    categories: enriched,
  });
});

router.post("/public/orders", async (req, res) => {
  const { restaurantId, tableId, customerName, customerPhone, notes, items } = req.body;

  if (!restaurantId || !items || !Array.isArray(items) || items.length === 0) {
    return void res.status(400).json({ error: "restaurantId and items are required" });
  }

  const onlineOk = await checkRestaurantFeature(restaurantId, "online_ordering");
  if (!onlineOk.ok) return void res.status(onlineOk.status).json({ error: onlineOk.error });

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
  const issuedToken = await issueTokenForOrder({
    orderId: order.id,
    restaurantId,
    orderType: order.orderType,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
  }).catch(() => null);
  res.status(201).json({ orderId: order.id, orderNumber: order.orderNumber, status: order.status, totalAmount: order.totalAmount, guestToken, token: issuedToken?.token ?? null });
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

router.get("/public/site/:slug", async (req, res) => {
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.slug, req.params.slug));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  const settingsRows = await db.select().from(restaurantSettingsTable)
    .where(and(
      eq(restaurantSettingsTable.restaurantId, restaurant.id),
      inArray(restaurantSettingsTable.section, ["customer-site", "about-us", "reservation"]),
    ));
  const sections: Record<string, Record<string, unknown>> = {};
  for (const r of settingsRows) sections[r.section] = (r.data as Record<string, unknown>) ?? {};

  const site = sections["customer-site"] ?? {};
  const about = sections["about-us"] ?? {};
  const reservation = sections["reservation"] ?? {};

  if (site.enabled !== true) {
    return void res.status(404).json({ error: "Public site is not enabled for this restaurant" });
  }

  const safeUrl = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t) return null;
    if (!/^https?:\/\//i.test(t)) return null;
    return t;
  };
  const safeSocials = {
    instagram: safeUrl((site.socials as Record<string, unknown> | undefined)?.instagram),
    facebook: safeUrl((site.socials as Record<string, unknown> | undefined)?.facebook),
    twitter: safeUrl((site.socials as Record<string, unknown> | undefined)?.twitter),
  };
  const safeMap = safeUrl(site.mapEmbedUrl);
  const safeOg = safeUrl(site.ogImageUrl);
  const safeAccent = typeof site.accentColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(site.accentColor) ? site.accentColor : "#c2410c";

  const [menu] = await db.select().from(menusTable).where(and(eq(menusTable.restaurantId, restaurant.id), eq(menusTable.isActive, true)));
  let categories: Array<{ id: number; name: string; items: Array<{ id: number; name: string; description: string | null; price: string; imageUrl: string | null }> }> = [];
  let featured: Array<{ id: number; name: string; description: string | null; price: string; imageUrl: string | null }> = [];
  if (menu) {
    const cats = await db.select().from(menuCategoriesTable).where(and(eq(menuCategoriesTable.menuId, menu.id), eq(menuCategoriesTable.isActive, true)));
    categories = await Promise.all(cats.map(async (c) => {
      const items = await db.select({
        id: menuItemsTable.id, name: menuItemsTable.name, description: menuItemsTable.description,
        price: menuItemsTable.price, imageUrl: menuItemsTable.imageUrl,
      }).from(menuItemsTable).where(and(eq(menuItemsTable.categoryId, c.id), eq(menuItemsTable.isAvailable, true)));
      return { id: c.id, name: c.name, items };
    }));
    const featuredIds = Array.isArray(site.featuredItemIds) ? (site.featuredItemIds as unknown[]).map(Number).filter(n => Number.isFinite(n)) : [];
    if (featuredIds.length > 0) {
      featured = await db.select({
        id: menuItemsTable.id, name: menuItemsTable.name, description: menuItemsTable.description,
        price: menuItemsTable.price, imageUrl: menuItemsTable.imageUrl,
      }).from(menuItemsTable).where(and(eq(menuItemsTable.restaurantId, restaurant.id), inArray(menuItemsTable.id, featuredIds), eq(menuItemsTable.isAvailable, true)));
    }
  }

  const aboutSafe = {
    story: typeof about.story === "string" ? about.story : "",
    mission: typeof about.mission === "string" ? about.mission : "",
    heroImage: typeof about.heroImage === "string" ? about.heroImage : "",
    awards: typeof about.awards === "string" ? about.awards : "",
    gallery: Array.isArray(about.gallery) ? (about.gallery as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
    team: Array.isArray(about.team)
      ? (about.team as unknown[]).filter((m): m is { name: string; role: string; photoUrl: string } => {
          if (!m || typeof m !== "object") return false;
          const o = m as Record<string, unknown>;
          return typeof o.name === "string" && typeof o.role === "string";
        }).map(m => ({ name: m.name, role: m.role, photoUrl: typeof m.photoUrl === "string" ? m.photoUrl : "" }))
      : [],
  };

  res.json({
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
      logoUrl: restaurant.logoUrl,
      currency: restaurant.currency,
      address: restaurant.address ?? null,
      phone: restaurant.phone ?? null,
      email: restaurant.email ?? null,
    },
    site: {
      heroHeadline: typeof site.heroHeadline === "string" ? site.heroHeadline : "",
      heroSubcopy: typeof site.heroSubcopy === "string" ? site.heroSubcopy : "",
      socials: safeSocials,
      mapEmbedUrl: safeMap,
      seoTitle: typeof site.seoTitle === "string" ? site.seoTitle : "",
      seoDescription: typeof site.seoDescription === "string" ? site.seoDescription : "",
      ogImageUrl: safeOg,
      accentColor: safeAccent,
    },
    about: aboutSafe,
    hours: reservation.hours && typeof reservation.hours === "object" ? reservation.hours : null,
    menu: { categories, featured },
  });
});

router.get("/public/restaurants/:slug", async (req, res) => {
  const [restaurant] = await db.select({ id: restaurantsTable.id, name: restaurantsTable.name, slug: restaurantsTable.slug, logoUrl: restaurantsTable.logoUrl, currency: restaurantsTable.currency }).from(restaurantsTable).where(eq(restaurantsTable.slug, req.params.slug));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });
  res.json(restaurant);
});

router.post("/public/restaurants/:slug/reservations", async (req, res) => {
  const { guestName, guestPhone, guestEmail, partySize, scheduledAt, notes, occasion, occasionNotes, seatingNotes } = req.body;
  const ALLOWED_OCCASIONS = ["birthday", "anniversary", "business", "date", "celebration", "other"];
  const occ = (occasion && typeof occasion === "string" && ALLOWED_OCCASIONS.includes(occasion)) ? occasion : null;
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
    occasion: occ,
    occasionNotes: occasionNotes?.trim?.() ?? null,
    seatingNotes: seatingNotes?.trim?.() ?? null,
    sourceChannel: "public",
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

// ─── Public review-QR feedback funnel ────────────────────────────────────────
function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip + "|reviewqr").digest("hex").slice(0, 32);
}

// Resolves a staff-task QR token into a minimal "what restaurant + area is
// this" payload. Staff are then expected to log in via the regular flow and
// hit the authenticated submit endpoint.
router.get("/public/staff-task/:qrToken", async (req, res) => {
  const { staffTaskAreasTable } = await import("../lib/db");
  const [area] = await db.select().from(staffTaskAreasTable)
    .where(eq(staffTaskAreasTable.qrToken, req.params.qrToken));
  if (!area || !area.isActive) return void res.status(404).json({ error: "Not found" });
  const [restaurant] = await db.select({
    id: restaurantsTable.id, name: restaurantsTable.name, slug: restaurantsTable.slug,
    logoUrl: restaurantsTable.logoUrl,
  }).from(restaurantsTable).where(eq(restaurantsTable.id, area.restaurantId));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });
  res.json({
    restaurant,
    area: { id: area.id, name: area.name, description: area.description, qrToken: area.qrToken },
  });
});

router.get("/public/review-qr/:qrCode", async (req, res) => {
  const [qr] = await db.select().from(reviewQrsTable).where(eq(reviewQrsTable.qrCode, req.params.qrCode));
  if (!qr || !qr.isActive) return void res.status(404).json({ error: "Not found" });
  const [restaurant] = await db.select({
    id: restaurantsTable.id, name: restaurantsTable.name, slug: restaurantsTable.slug,
    logoUrl: restaurantsTable.logoUrl, currency: restaurantsTable.currency,
  }).from(restaurantsTable).where(eq(restaurantsTable.id, qr.restaurantId));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  const [siteRow] = await db.select().from(restaurantSettingsTable)
    .where(and(eq(restaurantSettingsTable.restaurantId, restaurant.id), eq(restaurantSettingsTable.section, "customer-site")));
  const site = (siteRow?.data as Record<string, unknown> | undefined) ?? {};
  const accent = typeof site.accentColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(site.accentColor) ? site.accentColor : "#c2410c";

  // Fire-and-forget scan event
  void db.insert(reviewQrScansTable).values({
    qrId: qr.id, restaurantId: qr.restaurantId, event: "scan",
    ipHash: hashIp((req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || null),
  }).catch(() => undefined);

  res.json({
    qrCode: qr.qrCode,
    title: qr.title,
    customMessage: qr.customMessage,
    thankYouMessage: qr.thankYouMessage,
    negativeFeedbackMessage: qr.negativeFeedbackMessage,
    googleReviewUrl: qr.googleReviewUrl,
    positiveThreshold: qr.positiveThreshold,
    showGoogleButtonOnNegative: qr.showGoogleButtonOnNegative,
    restaurant: { name: restaurant.name, slug: restaurant.slug, logoUrl: restaurant.logoUrl },
    accentColor: accent,
  });
});

router.post("/public/review-qr/:qrCode/rate", async (req, res) => {
  const [qr] = await db.select().from(reviewQrsTable).where(eq(reviewQrsTable.qrCode, req.params.qrCode));
  if (!qr || !qr.isActive) return void res.status(404).json({ error: "Not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const rating = Math.min(5, Math.max(1, Number(b.rating)));
  if (!rating) return void res.status(400).json({ error: "Rating required" });
  const sessionToken = typeof b.sessionToken === "string" ? b.sessionToken.slice(0, 80) : "";
  if (!sessionToken) return void res.status(400).json({ error: "sessionToken required" });

  // Upsert one feedback row per (qrId, sessionToken). New rows emit a single
  // `rated` scan event; subsequent rating changes within the same session
  // update the row in place without inflating analytics.
  const existing = await db.update(customerFeedbackTable)
    .set({ rating })
    .where(and(eq(customerFeedbackTable.qrId, qr.id), eq(customerFeedbackTable.sessionToken, sessionToken)))
    .returning({ id: customerFeedbackTable.id });
  let feedbackId: number;
  let isNew = false;
  if (existing.length > 0) {
    feedbackId = existing[0]!.id;
  } else {
    const [fb] = await db.insert(customerFeedbackTable).values({
      restaurantId: qr.restaurantId,
      branchId: qr.branchId,
      qrId: qr.id,
      rating,
      sessionToken,
      source: "qr",
    }).returning({ id: customerFeedbackTable.id });
    feedbackId = fb!.id;
    isNew = true;
  }
  if (isNew) {
    await db.insert(reviewQrScansTable).values({
      qrId: qr.id, restaurantId: qr.restaurantId, event: "rated", rating,
      metadata: { feedbackId },
    });
  }
  res.json({
    ok: true,
    feedbackId,
    positive: rating >= qr.positiveThreshold,
    aiAssistEnabled: qr.aiAssistEnabled && !!qr.googleReviewUrl,
    googleReviewUrl: qr.googleReviewUrl,
  });
});

// AI-generate a Google review draft for a 4-5★ guest based on selected tags +
// optional note. Persists a customer_feedback row with the draft so admins can
// see what was generated, who copied it, and who clicked through to Google.
// No Google API / OAuth — purely a copy-and-paste assist.
// Naive in-process per-IP cooldown for the public AI draft endpoint. The
// endpoint is unauthenticated so we throttle to ~1 generation every 20s per
// IP, with a sliding 5-minute window cap of 8 to bound spend abuse beyond the
// global AI-provider rate limits.
const draftCooldown = new Map<string, number[]>();
const DRAFT_COOLDOWN_MS = 20_000;
const DRAFT_WINDOW_MS = 5 * 60_000;
const DRAFT_WINDOW_MAX = 8;
function checkDraftCooldown(ip: string): { ok: true } | { ok: false; retryAfterMs: number } {
  const now = Date.now();
  const arr = (draftCooldown.get(ip) ?? []).filter(t => now - t < DRAFT_WINDOW_MS);
  if (arr.length > 0 && now - arr[arr.length - 1]! < DRAFT_COOLDOWN_MS) {
    return { ok: false, retryAfterMs: DRAFT_COOLDOWN_MS - (now - arr[arr.length - 1]!) };
  }
  if (arr.length >= DRAFT_WINDOW_MAX) {
    return { ok: false, retryAfterMs: DRAFT_WINDOW_MS - (now - arr[0]!) };
  }
  arr.push(now);
  draftCooldown.set(ip, arr);
  // Opportunistic GC
  if (draftCooldown.size > 5000) {
    for (const [k, v] of draftCooldown) {
      const filtered = v.filter(t => now - t < DRAFT_WINDOW_MS);
      if (filtered.length === 0) draftCooldown.delete(k);
      else draftCooldown.set(k, filtered);
    }
  }
  return { ok: true };
}

router.post("/public/review-qr/:qrCode/generate-draft", async (req, res) => {
  const [qr] = await db.select().from(reviewQrsTable).where(eq(reviewQrsTable.qrCode, req.params.qrCode));
  if (!qr || !qr.isActive) return void res.status(404).json({ error: "Not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const rating = Math.min(5, Math.max(1, Number(b.rating)));
  if (!rating) return void res.status(400).json({ error: "Rating required" });
  const sessionToken = typeof b.sessionToken === "string" ? b.sessionToken.slice(0, 80) : "";
  if (!sessionToken) return void res.status(400).json({ error: "sessionToken required" });
  const tagsRaw = Array.isArray(b.tags) ? (b.tags as unknown[]) : [];
  const tags = tagsRaw.filter((t): t is string => typeof t === "string").slice(0, 8).map((t) => t.slice(0, 40));
  const comment = typeof b.comment === "string" ? b.comment.slice(0, 600) : "";
  const customerName = typeof b.customerName === "string" ? b.customerName.slice(0, 200) : null;
  const customerPhone = typeof b.customerPhone === "string" ? b.customerPhone.slice(0, 50) : null;
  const isPositive = rating >= qr.positiveThreshold;

  const [restaurant] = await db.select({ id: restaurantsTable.id, name: restaurantsTable.name, tenantId: restaurantsTable.tenantId })
    .from(restaurantsTable).where(eq(restaurantsTable.id, qr.restaurantId));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  // Upsert the per-session feedback row. /rate may have already created it;
  // if not, this is the first call for this scan session.
  const updated = await db.update(customerFeedbackTable).set({
    rating, comment: comment || null, customerName, customerPhone, selectedTags: tags,
  }).where(and(eq(customerFeedbackTable.qrId, qr.id), eq(customerFeedbackTable.sessionToken, sessionToken))).returning();
  let fb: typeof customerFeedbackTable.$inferSelect;
  if (updated.length > 0) {
    fb = updated[0]!;
  } else {
    const [created] = await db.insert(customerFeedbackTable).values({
      restaurantId: qr.restaurantId,
      branchId: qr.branchId,
      qrId: qr.id,
      rating,
      comment: comment || null,
      customerName,
      customerPhone,
      selectedTags: tags,
      sessionToken,
      source: "qr",
    }).returning();
    fb = created!;
    // Couldn't have been a /rate scan event, so backfill it once here.
    await db.insert(reviewQrScansTable).values({
      qrId: qr.id, restaurantId: qr.restaurantId, event: "rated", rating,
      metadata: { feedbackId: fb.id },
    });
  }

  // Low-rating: feed the existing recovery queue. Dedup so regenerate / repeated
  // calls within the same scan session don't spam recovery tasks or notifications.
  if (!isPositive) {
    const [existingTask] = await db.select({ id: feedbackRecoveryTasksTable.id })
      .from(feedbackRecoveryTasksTable)
      .where(eq(feedbackRecoveryTasksTable.feedbackId, fb.id));
    if (!existingTask) {
      await db.insert(feedbackRecoveryTasksTable).values({
        restaurantId: qr.restaurantId,
        feedbackId: fb.id,
        sentiment: rating <= 2 ? "negative" : "neutral",
        status: "new",
      });
      await db.insert(notificationsTable).values({
        restaurantId: qr.restaurantId,
        type: "feedback",
        title: `New ${rating}★ private feedback`,
        message: (comment || tags.join(", ") || "Customer left private feedback").slice(0, 200),
      });
      broadcastEvent(qr.restaurantId, "notification:new", { type: "feedback", id: fb.id });
    }
  }

  const baseResponse = { feedbackId: fb.id, googleReviewUrl: qr.googleReviewUrl };

  if (!qr.aiAssistEnabled) return void res.json({ ...baseResponse, available: false, reason: "ai_assist_disabled" });
  if (!qr.googleReviewUrl) return void res.json({ ...baseResponse, available: false, reason: "no_google_url" });

  const ipForLimit = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  const cooldown = checkDraftCooldown(ipForLimit);
  if (!cooldown.ok) {
    return void res.status(429).json({ ...baseResponse, available: false, reason: "rate_limited", retryAfterMs: cooldown.retryAfterMs });
  }

  // Plan/feature/cap gating + credit reservation in one shot. Public-route
  // equivalent of `requireAiCredits` — returns a structured reason so we can
  // degrade gracefully (HTTP 200 + available:false) instead of erroring.
  const gated = await gatePublicAiCall({
    tenantId: restaurant.tenantId,
    featureSlug: "ai_review_draft",
    units: 1,
    meta: { qrId: qr.id, feedbackId: fb.id, restaurantId: restaurant.id },
  });
  if (!gated.ok) {
    return void res.json({ ...baseResponse, available: false, reason: gated.reason });
  }
  const reservation: AiCreditReservation = gated.reservation;

  const systemPrompt = `You write short, warm, authentic-sounding Google reviews from the guest's point of view. Keep it 2-4 sentences, first-person, mention 1-2 specific things they liked. Never invent details that weren't provided. No emojis, no hashtags, no quotation marks. Plain text only.`;
  const userPrompt = [
    `Restaurant: ${restaurant.name}`,
    `Star rating: ${rating}/5`,
    tags.length ? `Things the guest liked: ${tags.join(", ")}` : null,
    comment ? `Guest's own words: "${comment}"` : null,
    customerName ? `Guest first name: ${customerName.split(/\s+/)[0]}` : null,
    `Write the review as the guest would post it on Google.`,
  ].filter(Boolean).join("\n");

  try {
    const result = await AIProviderService.generateText(
      { featureSlug: "ai_review_draft", tenantId: restaurant.tenantId, restaurantId: restaurant.id, metadata: { qrId: qr.id, feedbackId: fb.id } },
      { systemPrompt, messages: [{ role: "user", content: userPrompt }], temperature: 0.8, maxTokens: 220 },
    );
    const draft = result.text.trim().replace(/^["']|["']$/g, "");
    // Persist before billing so a DB failure refunds the reservation cleanly.
    await db.update(customerFeedbackTable)
      .set({ aiDraftText: draft, aiDraftRequestLogId: result.requestLogId })
      .where(eq(customerFeedbackTable.id, fb.id));
    await db.insert(reviewQrScansTable).values({
      qrId: qr.id, restaurantId: qr.restaurantId, event: "draft_generated", rating,
      metadata: { feedbackId: fb.id, tagCount: tags.length, hasComment: !!comment },
    });
    await commitReservation({ reservation, requestLogId: result.requestLogId });
    res.json({ ...baseResponse, available: true, draftText: draft, requestLogId: result.requestLogId });
  } catch (err) {
    await refundReservation(reservation, "ai_review_draft generation failed").catch(() => undefined);
    logger.warn({ err, qrId: qr.id }, "ai_review_draft generation failed");
    res.json({ ...baseResponse, available: false, reason: "generation_failed" });
  }
});

// Resolve the active feedback row for a scan session — used by copy / redirect
// trackers so we don't trust client-supplied IDs.
async function resolveSessionFeedback(qrId: number, body: Record<string, unknown>) {
  const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken.slice(0, 80) : "";
  if (sessionToken) {
    const [row] = await db.select({ id: customerFeedbackTable.id })
      .from(customerFeedbackTable)
      .where(and(eq(customerFeedbackTable.qrId, qrId), eq(customerFeedbackTable.sessionToken, sessionToken)));
    if (row) return row.id;
  }
  return null;
}

router.post("/public/review-qr/:qrCode/draft-copied", async (req, res) => {
  const [qr] = await db.select().from(reviewQrsTable).where(eq(reviewQrsTable.qrCode, req.params.qrCode));
  if (!qr || !qr.isActive) return void res.status(404).json({ error: "Not found" });
  const feedbackId = await resolveSessionFeedback(qr.id, (req.body ?? {}) as Record<string, unknown>);
  if (feedbackId) {
    await db.update(customerFeedbackTable)
      .set({ copiedDraft: true })
      .where(eq(customerFeedbackTable.id, feedbackId));
  }
  await db.insert(reviewQrScansTable).values({
    qrId: qr.id, restaurantId: qr.restaurantId, event: "draft_copied",
    metadata: feedbackId ? { feedbackId } : {},
  });
  res.json({ ok: true });
});

router.post("/public/review-qr/:qrCode/google-redirect", async (req, res) => {
  const [qr] = await db.select().from(reviewQrsTable).where(eq(reviewQrsTable.qrCode, req.params.qrCode));
  if (!qr || !qr.isActive) return void res.status(404).json({ error: "Not found" });
  const feedbackId = await resolveSessionFeedback(qr.id, (req.body ?? {}) as Record<string, unknown>);
  if (feedbackId) {
    await db.update(customerFeedbackTable)
      .set({ googleRedirected: true })
      .where(eq(customerFeedbackTable.id, feedbackId));
  }
  await db.insert(reviewQrScansTable).values({
    qrId: qr.id, restaurantId: qr.restaurantId, event: "google_redirect",
    metadata: feedbackId ? { feedbackId } : {},
  });
  res.json({ ok: true });
});

router.post("/public/review-qr/:qrCode/feedback", async (req, res) => {
  const [qr] = await db.select().from(reviewQrsTable).where(eq(reviewQrsTable.qrCode, req.params.qrCode));
  if (!qr || !qr.isActive) return void res.status(404).json({ error: "Not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const rating = Math.min(5, Math.max(1, Number(b.rating)));
  if (!rating) return void res.status(400).json({ error: "Rating required" });
  const tagsRaw = Array.isArray(b.tags) ? (b.tags as unknown[]) : [];
  const tags = tagsRaw.filter((t): t is string => typeof t === "string").slice(0, 8).map((t) => t.slice(0, 40));
  const [fb] = await db.insert(customerFeedbackTable).values({
    restaurantId: qr.restaurantId,
    branchId: qr.branchId,
    qrId: qr.id,
    rating,
    category: typeof b.category === "string" ? b.category.slice(0, 80) : null,
    comment: typeof b.comment === "string" ? b.comment.slice(0, 4000) : null,
    customerName: typeof b.customerName === "string" ? b.customerName.slice(0, 200) : null,
    customerPhone: typeof b.customerPhone === "string" ? b.customerPhone.slice(0, 50) : null,
    selectedTags: tags,
    source: "qr",
  }).returning();
  await db.insert(reviewQrScansTable).values({
    qrId: qr.id, restaurantId: qr.restaurantId, event: "submitted_negative", rating,
  });
  // Auto-create a recovery task so the manager queue lights up immediately.
  await db.insert(feedbackRecoveryTasksTable).values({
    restaurantId: qr.restaurantId,
    feedbackId: fb.id,
    category: fb.category,
    sentiment: rating <= 2 ? "negative" : "neutral",
    status: "new",
  });
  await db.insert(notificationsTable).values({
    restaurantId: qr.restaurantId,
    type: "feedback",
    title: `New ${rating}★ private feedback`,
    message: (fb.comment ?? "Customer left private feedback").slice(0, 200),
  });
  broadcastEvent(qr.restaurantId, "notification:new", { type: "feedback", id: fb.id });
  res.status(201).json({ ok: true, id: fb.id });
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

// ─── Public Feedback Wall (per-restaurant) ────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

router.get("/public/feedback-wall/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  let branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  const branchSlug = req.query.branch ? String(req.query.branch) : undefined;
  const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24));
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * limit;
  const [restaurant] = await db
    .select({ id: restaurantsTable.id, name: restaurantsTable.name, slug: restaurantsTable.slug, logoUrl: restaurantsTable.logoUrl, currency: restaurantsTable.currency })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.slug, slug));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  // Resolve branch-slug (?branch=outlet-name) to a branchId, scoped to this
  // restaurant. branchId remains the backward-compatible canonical filter.
  if (branchSlug && !branchId) {
    const restaurantBranches = await db
      .select({ id: branchesTable.id, name: branchesTable.name })
      .from(branchesTable)
      .where(eq(branchesTable.restaurantId, restaurant.id));
    const match = restaurantBranches.find(b => slugify(b.name) === branchSlug);
    if (match) branchId = match.id;
  }

  const baseWhere = and(
    eq(feedbackWallItemsTable.restaurantId, restaurant.id),
    eq(feedbackWallItemsTable.isApproved, true),
    eq(feedbackWallItemsTable.isHidden, false),
    branchId ? eq(feedbackWallItemsTable.branchId, branchId) : sql`true`,
  );

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(feedbackWallItemsTable)
    .where(baseWhere);

  const items = await db
    .select({
      id: feedbackWallItemsTable.id,
      branchId: feedbackWallItemsTable.branchId,
      feedbackId: feedbackWallItemsTable.feedbackId,
      externalReviewId: feedbackWallItemsTable.externalReviewId,
      source: feedbackWallItemsTable.source,
      isFeatured: feedbackWallItemsTable.isFeatured,
      displayNameOverride: feedbackWallItemsTable.displayNameOverride,
      createdAt: feedbackWallItemsTable.createdAt,
      branchName: branchesTable.name,
    })
    .from(feedbackWallItemsTable)
    .leftJoin(branchesTable, eq(branchesTable.id, feedbackWallItemsTable.branchId))
    .where(baseWhere)
    .orderBy(desc(feedbackWallItemsTable.isFeatured), desc(feedbackWallItemsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const fbIds = items.map(i => i.feedbackId).filter((x): x is number => !!x);
  const exIds = items.map(i => i.externalReviewId).filter((x): x is number => !!x);
  const fbRows = fbIds.length ? await db.select().from(customerFeedbackTable).where(inArray(customerFeedbackTable.id, fbIds)) : [];
  const exRows = exIds.length ? await db.select().from(externalReviewsTable).where(inArray(externalReviewsTable.id, exIds)) : [];
  const fbMap = new Map(fbRows.map(r => [r.id, r]));
  const exMap = new Map(exRows.map(r => [r.id, r]));

  const branches = await db
    .select({ id: branchesTable.id, name: branchesTable.name })
    .from(branchesTable)
    .where(eq(branchesTable.restaurantId, restaurant.id));

  const enriched = items.map(item => {
    const fb = item.feedbackId ? fbMap.get(item.feedbackId) : null;
    const ex = item.externalReviewId ? exMap.get(item.externalReviewId) : null;
    const rawName = item.displayNameOverride ?? fb?.customerName ?? ex?.authorName ?? "Guest";
    // Anonymize: first name + last initial only when no override is set.
    const safeName = item.displayNameOverride ? rawName : (() => {
      const parts = rawName.trim().split(/\s+/);
      if (parts.length <= 1) return parts[0] || "Guest";
      return `${parts[0]} ${parts[parts.length - 1][0]}.`;
    })();
    return {
      id: item.id,
      branchId: item.branchId,
      branchName: item.branchName,
      source: item.source,
      isFeatured: item.isFeatured,
      rating: fb?.rating ?? ex?.rating ?? null,
      comment: fb?.comment ?? ex?.reviewText ?? null,
      authorName: safeName,
      externalUrl: ex?.reviewUrl ?? null,
      occurredAt: fb?.createdAt ?? ex?.publishedAt ?? item.createdAt,
    };
  });

  const ratings = enriched.map(e => e.rating).filter((x): x is number => typeof x === "number");
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  res.set("Cache-Control", "public, max-age=60");
  res.json({
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
      logoUrl: restaurant.logoUrl,
    },
    branches,
    items: enriched,
    pagination: {
      page,
      limit,
      total,
      hasMore: offset + enriched.length < total,
    },
    summary: {
      total,
      avgRating: avgRating != null ? Math.round(avgRating * 10) / 10 : null,
    },
  });
});

// Cross-tenant marketing testimonials (highlights opted-in by owners).
router.get("/marketing/testimonials", async (_req, res) => {
  const items = await db
    .select({
      id: feedbackWallItemsTable.id,
      restaurantId: feedbackWallItemsTable.restaurantId,
      feedbackId: feedbackWallItemsTable.feedbackId,
      externalReviewId: feedbackWallItemsTable.externalReviewId,
      source: feedbackWallItemsTable.source,
      displayNameOverride: feedbackWallItemsTable.displayNameOverride,
      createdAt: feedbackWallItemsTable.createdAt,
      restaurantName: restaurantsTable.name,
      restaurantSlug: restaurantsTable.slug,
      restaurantLogo: restaurantsTable.logoUrl,
    })
    .from(feedbackWallItemsTable)
    .innerJoin(restaurantsTable, eq(restaurantsTable.id, feedbackWallItemsTable.restaurantId))
    .where(and(
      eq(feedbackWallItemsTable.shareOnMarketing, true),
      eq(feedbackWallItemsTable.isApproved, true),
      eq(feedbackWallItemsTable.isHidden, false),
    ))
    .orderBy(desc(feedbackWallItemsTable.isFeatured), desc(feedbackWallItemsTable.createdAt))
    .limit(24);

  const fbIds = items.map(i => i.feedbackId).filter((x): x is number => !!x);
  const exIds = items.map(i => i.externalReviewId).filter((x): x is number => !!x);
  const fbRows = fbIds.length ? await db.select().from(customerFeedbackTable).where(inArray(customerFeedbackTable.id, fbIds)) : [];
  const exRows = exIds.length ? await db.select().from(externalReviewsTable).where(inArray(externalReviewsTable.id, exIds)) : [];
  const fbMap = new Map(fbRows.map(r => [r.id, r]));
  const exMap = new Map(exRows.map(r => [r.id, r]));

  const enriched = items
    .map(item => {
      const fb = item.feedbackId ? fbMap.get(item.feedbackId) : null;
      const ex = item.externalReviewId ? exMap.get(item.externalReviewId) : null;
      const rawName = item.displayNameOverride ?? fb?.customerName ?? ex?.authorName ?? "Guest";
      const parts = rawName.trim().split(/\s+/);
      const safeName = item.displayNameOverride ? rawName
        : parts.length <= 1 ? (parts[0] || "Guest")
        : `${parts[0]} ${parts[parts.length - 1][0]}.`;
      return {
        id: item.id,
        source: item.source,
        rating: fb?.rating ?? ex?.rating ?? null,
        comment: fb?.comment ?? ex?.reviewText ?? null,
        authorName: safeName,
        restaurantName: item.restaurantName,
        restaurantSlug: item.restaurantSlug,
        restaurantLogo: item.restaurantLogo,
        externalUrl: ex?.reviewUrl ?? null,
      };
    })
    .filter(t => t.comment && (t.comment.length ?? 0) > 10);

  res.set("Cache-Control", "public, max-age=300");
  res.json(enriched);
});

// ─── Public surveys ─────────────────────────────────────────────────────────

const surveySubmitCooldown = new Map<string, number>();

router.get("/public/surveys/:slug", async (req, res) => {
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.slug, req.params.slug));
  if (!survey || !survey.isActive) return void res.status(404).json({ error: "Not found" });
  const [restaurant] = await db.select({
    id: restaurantsTable.id, name: restaurantsTable.name, slug: restaurantsTable.slug, logoUrl: restaurantsTable.logoUrl,
  }).from(restaurantsTable).where(eq(restaurantsTable.id, survey.restaurantId));
  if (!restaurant) return void res.status(404).json({ error: "Not found" });

  const [siteRow] = await db.select().from(restaurantSettingsTable)
    .where(and(eq(restaurantSettingsTable.restaurantId, restaurant.id), eq(restaurantSettingsTable.section, "customer-site")));
  const site = (siteRow?.data as Record<string, unknown> | undefined) ?? {};
  const accent = typeof site.accentColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(site.accentColor) ? site.accentColor : "#c2410c";

  const questions = await db.select().from(surveyQuestionsTable)
    .where(eq(surveyQuestionsTable.surveyId, survey.id))
    .orderBy(surveyQuestionsTable.sortOrder);

  res.json({
    slug: survey.slug,
    type: survey.type,
    title: survey.title,
    description: survey.description,
    thankYouMessage: survey.thankYouMessage,
    collectName: survey.collectName,
    collectPhone: survey.collectPhone,
    collectTableNumber: survey.collectTableNumber,
    questions: questions.map(q => ({
      id: q.id,
      type: q.type,
      label: q.label,
      required: q.required,
      options: q.options ?? [],
      scaleMin: q.scaleMin,
      scaleMax: q.scaleMax,
    })),
    restaurant: { name: restaurant.name, slug: restaurant.slug, logoUrl: restaurant.logoUrl },
    accentColor: accent,
  });
});

router.post("/public/surveys/:slug/responses", async (req, res) => {
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.slug, req.params.slug));
  if (!survey || !survey.isActive) return void res.status(404).json({ error: "Not found" });

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || null;
  const ipHash = hashIp(ip);
  const cooldownKey = `${survey.id}:${ipHash ?? "anon"}`;
  const now = Date.now();
  const last = surveySubmitCooldown.get(cooldownKey) ?? 0;
  if (now - last < 5000) return void res.status(429).json({ error: "Too many requests" });
  surveySubmitCooldown.set(cooldownKey, now);
  // Trim memory
  if (surveySubmitCooldown.size > 5000) {
    for (const [k, t] of surveySubmitCooldown) {
      if (now - t > 60_000) surveySubmitCooldown.delete(k);
    }
  }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const questions = await db.select().from(surveyQuestionsTable)
    .where(eq(surveyQuestionsTable.surveyId, survey.id));

  const incoming = (b.answers ?? {}) as Record<string, unknown>;
  const cleanAnswers: Record<string, unknown> = {};
  for (const q of questions) {
    const raw = incoming[String(q.id)];
    if (raw == null || raw === "") {
      if (q.required) return void res.status(400).json({ error: `Question "${q.label}" is required` });
      continue;
    }
    if (q.type === "rating_5" || q.type === "rating_10" || q.type === "nps") {
      const n = Number(raw);
      const min = q.scaleMin ?? 0;
      const max = q.scaleMax ?? (q.type === "rating_5" ? 5 : 10);
      if (!Number.isFinite(n) || n < min || n > max) {
        if (q.required) return void res.status(400).json({ error: `Invalid value for "${q.label}"` });
        continue;
      }
      cleanAnswers[String(q.id)] = n;
    } else if (q.type === "single_choice") {
      const s = String(raw);
      if (!(q.options ?? []).includes(s)) {
        if (q.required) return void res.status(400).json({ error: `Invalid choice for "${q.label}"` });
        continue;
      }
      cleanAnswers[String(q.id)] = s;
    } else {
      cleanAnswers[String(q.id)] = String(raw).slice(0, 4000);
    }
  }

  const respondentName = survey.collectName && typeof b.respondentName === "string" ? b.respondentName.slice(0, 120) : null;
  const respondentPhone = survey.collectPhone && typeof b.respondentPhone === "string" ? b.respondentPhone.slice(0, 30) : null;
  const tableNumber = survey.collectTableNumber && typeof b.tableNumber === "string" ? b.tableNumber.slice(0, 30) : null;

  await db.insert(surveyResponsesTable).values({
    surveyId: survey.id,
    tenantId: survey.tenantId,
    restaurantId: survey.restaurantId,
    respondentName,
    respondentPhone,
    tableNumber,
    answers: cleanAnswers,
    ipHash,
  });

  await db.update(surveysTable)
    .set({ responseCount: sql`${surveysTable.responseCount} + 1` })
    .where(eq(surveysTable.id, survey.id));

  res.json({ success: true, thankYouMessage: survey.thankYouMessage });
});

export default router;
