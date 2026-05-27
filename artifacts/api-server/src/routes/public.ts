import { Router } from "express";
import { eq, and, inArray, desc, gte, lte, sql } from "drizzle-orm";
import Stripe from "stripe";
import { db, restaurantsTable, menusTable, menuCategoriesTable, menuItemsTable, modifierGroupsTable, modifiersTable, ordersTable, orderItemsTable, orderItemModifiersTable, kitchenTicketsTable, floorTablesTable, notificationsTable, reservationsTable, customersTable, restaurantSettingsTable, tenantsTable, subscriptionPlansTable, isFeatureEnabled, PLAN_BOOLEAN_FEATURES, reviewQrsTable, reviewQrScansTable, customerFeedbackTable, feedbackRecoveryTasksTable, feedbackWallItemsTable, externalReviewsTable, branchesTable, surveysTable, surveyQuestionsTable, surveyResponsesTable, cartSessionsTable, moodResponsesTable, vipAlertsTable, couponsTable, orderDiscountsTable, paymentsTable } from "../lib/db";
import { sumOrderDiscounts, listOrderDiscounts, deleteOrderDiscountsByType } from "../lib/discounts";
import { recalculateOrderTotals } from "./orders";
import { reserveCredits, commitReservation, refundReservation, resolveCreditRule, priceCredits, gatePublicAiCall, type AiCreditReservation } from "../lib/aiCredits";
import { AIProviderService } from "../lib/aiProviderService";
import { logger } from "../lib/logger";
import { createHash } from "crypto";
import { recordAuditLog } from "../lib/audit";
import { normalizePhone, toE164 } from "@workspace/phone-utils";

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
import { getVapidPublicKey, upsertWebPushSubscription, deleteWebPushSubscription, updateSubscriptionPrefs, getSubscriptionStatus } from "../lib/webPush";
import { webPushLogsTable } from "../lib/db";
import { markLogClicked } from "../lib/webPush";
import { loadLoyaltyConfig, pickTier, getLifetimeEarned, getRecentLoyaltyHistory } from "../lib/loyalty";
import { mintOrderNumbers } from "../lib/orderNumbers";

const router = Router();

function generateOrderNumber(): string {
  // Legacy fallback — production order paths now mint dual numbers via
  // mintOrderNumbers() (Task #647).
  return `ORD-${Date.now().toString(36).toUpperCase()}`;
}

router.get("/public/menu/:slug", async (req, res) => {
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.slug, req.params.slug));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  // Load ALL active menus and merge their categories. Some restaurants
  // end up with more than one active menu (e.g. an onboarding-created
  // "Main Menu" plus a menu created by a CSV/PDF import named after the
  // file). Picking just one would leave the other's categories invisible
  // on the QR menu — exactly the "empty QR" bug owners report.
  const activeMenus = await db.select().from(menusTable).where(and(eq(menusTable.restaurantId, restaurant.id), eq(menusTable.isActive, true))).orderBy(menusTable.id);
  const menu = activeMenus[0];

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

  if (!menu) return void res.json({ restaurantId: restaurant.id, restaurantName: restaurant.name, restaurantSlug: restaurant.slug, logoUrl: restaurant.logoUrl, currency: restaurant.currency, menuImageConfig, showNutritionOnQrMenu, categories: [], enableOnlinePayment: !!restaurant.enableOnlinePayment });

  const categories = await db.select().from(menuCategoriesTable).where(and(
    inArray(menuCategoriesTable.menuId, activeMenus.map(m => m.id)),
    eq(menuCategoriesTable.isActive, true),
  ));
  const enriched = await Promise.all(categories.map(async (cat) => {
    const items = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.categoryId, cat.id), eq(menuItemsTable.isAvailable, true)));
    const itemsWithMods = await Promise.all(items.map(async (item) => {
      const groups = await db.select().from(modifierGroupsTable)
        .where(and(
          eq(modifierGroupsTable.menuItemId, item.id),
          eq(modifierGroupsTable.isActive, true),
          eq(modifierGroupsTable.showOnQr, true),
        ))
        .orderBy(modifierGroupsTable.sortOrder, modifierGroupsTable.id);
      const groupsWithMods = await Promise.all(groups.map(async (g) => {
        const mods = await db.select().from(modifiersTable)
          .where(and(eq(modifiersTable.groupId, g.id), eq(modifiersTable.isAvailable, true)))
          .orderBy(modifiersTable.sortOrder, modifiersTable.id);
        return { ...g, modifiers: mods };
      }));
      return { ...projectItem(item), modifierGroups: groupsWithMods };
    }));
    return { ...cat, items: itemsWithMods };
  }));
  // Hide empty categories on the QR/diner-facing menu. An onboarding-
  // created placeholder category with zero items just adds visual noise
  // for the diner — owners can still see and manage it from the admin
  // menu editor, but it shouldn't appear in the public QR view until
  // there's at least one available item to show.
  const enrichedNonEmpty = enriched.filter(c => c.items.length > 0);

  // Direct online ordering (Task #432): expose SEO + ordering config so the
  // public menu page can render correct meta tags, holiday closure banners,
  // delivery rules and the schema.org Menu/Restaurant JSON-LD.
  const [doRow] = await db.select().from(restaurantSettingsTable).where(and(
    eq(restaurantSettingsTable.restaurantId, restaurant.id),
    eq(restaurantSettingsTable.section, "direct-ordering"),
  ));
  const doCfg = (doRow?.data as Record<string, unknown> | undefined) ?? {};
  const todayKey = new Date().toISOString().slice(0, 10);
  const closures = Array.isArray(doCfg.holidayClosures) ? (doCfg.holidayClosures as string[]) : [];
  const directOrdering = {
    orderingEnabled: doCfg.orderingEnabled !== false,
    seoTitle: typeof doCfg.seoTitle === "string" && doCfg.seoTitle.trim()
      ? doCfg.seoTitle.trim()
      : `Order ${restaurant.name} Online – Pickup & Delivery`,
    seoDescription: typeof doCfg.seoDescription === "string" && doCfg.seoDescription.trim()
      ? doCfg.seoDescription.trim()
      : `Order online from ${restaurant.name}. Skip the line and order ahead for pickup or delivery.`,
    ogImageUrl: typeof doCfg.ogImageUrl === "string" ? doCfg.ogImageUrl : (restaurant.logoUrl ?? null),
    schemaEnabled: doCfg.schemaEnabled !== false,
    allowPickup: doCfg.allowPickup !== false,
    allowDelivery: doCfg.allowDelivery === true,
    allowScheduling: doCfg.allowScheduling !== false,
    minOrderValue: typeof doCfg.minOrderValue === "number" ? doCfg.minOrderValue : 0,
    deliveryFee: typeof doCfg.deliveryFee === "number" ? doCfg.deliveryFee : 0,
    freeDeliveryThreshold: typeof doCfg.freeDeliveryThreshold === "number" ? doCfg.freeDeliveryThreshold : 0,
    deliveryRadiusKm: typeof doCfg.deliveryRadiusKm === "number" ? doCfg.deliveryRadiusKm : 0,
    holidayClosures: closures,
    closedToday: closures.includes(todayKey),
    customOrderingLink: typeof doCfg.customOrderingLink === "string" ? doCfg.customOrderingLink : null,
    cuisine: typeof doCfg.cuisine === "string" ? doCfg.cuisine : null,
    priceRange: typeof doCfg.priceRange === "string" ? doCfg.priceRange : null,
  };

  res.json({
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    restaurantSlug: restaurant.slug,
    logoUrl: restaurant.logoUrl,
    currency: restaurant.currency,
    menuImageConfig,
    showNutritionOnQrMenu,
    menuBannerUrl: menu.imageUrl ?? null,
    categories: enrichedNonEmpty,
    directOrdering,
    // QR / online menu payment toggle. Owners enable in Settings → Payment.
    // Off by default — only "Pay at Counter" is shown to the diner unless on.
    enableOnlinePayment: !!restaurant.enableOnlinePayment,
  });
});

// Direct online ordering (Task #432): per-customer reorder lookup. To prevent
// trivial phone-enumeration scraping of order history, the caller must prove
// ownership of a recent order on the same device by passing the previous
// order's id + guest token (stored in localStorage after each successful
// order). The token is HMAC-validated and must belong to an order on the
// same restaurant whose customerPhone matches the requested phone. We also
// rate-limit per IP+slug and add a uniform delay so timing can't be used to
// distinguish "wrong phone" from "wrong token".
const reorderAttempts = new Map<string, { count: number; resetAt: number }>();
function checkReorderRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = reorderAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    reorderAttempts.set(key, { count: 1, resetAt: now + 10 * 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 5;
}
router.post("/public/orders/recent", async (req, res) => {
  // Constant ~250ms response time prevents timing-based enumeration of which
  // phone numbers exist. We deliberately await this even on early errors.
  const respondAfter = new Promise<void>(r => setTimeout(r, 250));
  const ip = (req.ip || req.socket.remoteAddress || "unknown").toString();
  const { slug, phone, lastOrderId, lastOrderToken } = req.body as {
    slug?: string; phone?: string; lastOrderId?: number; lastOrderToken?: string;
  };
  const generic = { error: "Couldn't verify your previous order. Place an order first to enable reorder on this device." };

  if (!slug || typeof slug !== "string") {
    await respondAfter; return void res.status(400).json(generic);
  }
  if (!checkReorderRateLimit(`${ip}:${slug}`)) {
    await respondAfter; return void res.status(429).json({ error: "Too many attempts. Please try again later." });
  }
  if (!phone || typeof phone !== "string" || phone.trim().length < 4
      || !lastOrderId || typeof lastOrderId !== "number"
      || !lastOrderToken || typeof lastOrderToken !== "string") {
    await respondAfter; return void res.status(400).json(generic);
  }

  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.slug, slug));
  if (!restaurant) { await respondAfter; return void res.status(404).json(generic); }

  // Normalize the caller-provided phone to the same canonical form we store
  // (e.g. "+91 9876543210"), so callers can match historical orders regardless
  // of whether they typed a country code, spaces, dashes, etc.
  const normPhone = normalizePhone(phone, restaurant.country);
  if (!normPhone) { await respondAfter; return void res.status(400).json(generic); }

  // Authenticate caller: token must match an order belonging to this
  // restaurant whose phone equals the requested phone. validateGuestToken
  // returns the order id when the HMAC is valid.
  if (!validateGuestToken(lastOrderId, lastOrderToken)) { await respondAfter; return void res.status(403).json(generic); }
  const [authOrder] = await db.select({ id: ordersTable.id, phone: ordersTable.customerPhone, rid: ordersTable.restaurantId })
    .from(ordersTable).where(eq(ordersTable.id, lastOrderId));
  if (!authOrder || authOrder.rid !== restaurant.id || !authOrder.phone
      || normalizePhone(authOrder.phone, restaurant.country) !== normPhone) {
    await respondAfter; return void res.status(403).json(generic);
  }

  // Match both the canonical "+<dial> <national>" form (new orders) and the
  // raw value the caller submitted (legacy orders saved before normalization
  // existed), so historical reorder history isn't hidden after the rollout.
  const phoneCandidates = Array.from(new Set([normPhone, phone.trim()].filter(Boolean)));
  const orders = await db.select({
    id: ordersTable.id, orderNumber: ordersTable.orderNumber, totalAmount: ordersTable.totalAmount,
    createdAt: ordersTable.createdAt, orderType: ordersTable.orderType,
  }).from(ordersTable).where(and(
    eq(ordersTable.restaurantId, restaurant.id),
    inArray(ordersTable.customerPhone, phoneCandidates),
    sql`${ordersTable.status} <> 'cancelled'`,
  )).orderBy(desc(ordersTable.createdAt)).limit(5);

  const out: Array<{ id: number; orderNumber: string; totalAmount: string; createdAt: Date; orderType: string; items: Array<{ menuItemId: number; menuItemName: string; quantity: number }> }> = [];
  for (const o of orders) {
    const items = await db.select({
      menuItemId: orderItemsTable.menuItemId,
      menuItemName: orderItemsTable.menuItemName,
      quantity: orderItemsTable.quantity,
    }).from(orderItemsTable).where(eq(orderItemsTable.orderId, o.id));
    out.push({ ...o, items });
  }
  await respondAfter;
  res.json({ orders: out });
});

// Direct online ordering (Task #432): public sitemap.xml listing all
// restaurant ordering pages so search engines can crawl and index them.
router.get("/public/sitemap.xml", async (req, res) => {
  const baseHost = (req.headers.host ?? "").toString();
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol ?? "https";
  const base = `${proto}://${baseHost}`;

  // Only restaurants whose tenant is not suspended AND whose plan includes
  // online_ordering get listed. Build the eligible set in two cheap queries
  // and intersect in memory rather than per-row feature checks.
  const rows = await db.select({
    slug: restaurantsTable.slug, updatedAt: restaurantsTable.updatedAt,
    tenantId: restaurantsTable.tenantId, planId: tenantsTable.planId,
    isSuspended: tenantsTable.isSuspended,
  }).from(restaurantsTable).innerJoin(tenantsTable, eq(restaurantsTable.tenantId, tenantsTable.id));

  const planFlags = new Map<number, unknown>();
  const planIds = Array.from(new Set(rows.map(r => r.planId).filter((x): x is number => x != null)));
  if (planIds.length > 0) {
    const plans = await db.select({ id: subscriptionPlansTable.id, featureFlags: subscriptionPlansTable.featureFlags })
      .from(subscriptionPlansTable).where(inArray(subscriptionPlansTable.id, planIds));
    for (const p of plans) planFlags.set(p.id, p.featureFlags);
  }

  const urls: Array<{ slug: string; updatedAt: Date }> = [];
  for (const r of rows) {
    if (!r.slug || r.isSuspended) continue;
    if (r.planId != null && !isFeatureEnabled(planFlags.get(r.planId) as Record<string, unknown> | null | undefined, "online_ordering")) continue;
    urls.push({ slug: r.slug, updatedAt: r.updatedAt ?? new Date() });
  }

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls.map(u => `  <url><loc>${base}/menu/${u.slug}</loc><lastmod>${u.updatedAt.toISOString().slice(0, 10)}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`),
    `</urlset>`,
  ].join("\n");
  res.set("Content-Type", "application/xml");
  res.set("Cache-Control", "public, max-age=3600");
  res.send(xml);
});

router.post("/public/orders", async (req, res) => {
  const { restaurantId, tableId, customerName, customerPhone, notes, items, orderType: rawOrderType, vehicleColor, vehicleModel, vehicleNumber, parkingSpot, scheduledFor: rawScheduledFor, deliveryAddress: rawDeliveryAddress, deliveryZoneId: rawDeliveryZoneId, deliveryPincode } = req.body;

  if (!restaurantId || !items || !Array.isArray(items) || items.length === 0) {
    return void res.status(400).json({ error: "restaurantId and items are required" });
  }

  const isCurbside = rawOrderType === "curbside";
  const featureKey = isCurbside ? "dlv_curbside_pickup" : (tableId ? "qr_ordering" : "online_ordering");
  const featureOk = await checkRestaurantFeature(restaurantId, featureKey);
  if (!featureOk.ok) return void res.status(featureOk.status).json({ error: featureOk.error });

  // ───── Order capacity gate (pause + per-slot caps) ─────
  {
    const { evaluateOrderCapacity, maybeAlertManagersOnRush } = await import("../lib/orderCapacity");
    const itemQuantities = Array.isArray(items)
      ? (items as Array<{ menuItemId?: number; quantity?: number }>)
          .filter((i) => i?.menuItemId && i?.quantity)
          .map((i) => ({ menuItemId: Number(i.menuItemId), quantity: Number(i.quantity) }))
      : [];
    const channelForCap: "qr" | "online" = tableId ? "qr" : "online";
    const resolvedType = isCurbside ? "curbside" : (tableId ? "dine_in" : (rawOrderType ?? "pickup"));
    // Resolve delivery zone from explicit id or by pincode lookup. This ensures
    // per-zone pause toggles actually block matching public/online orders.
    let zoneIdForCap: number | null = typeof rawDeliveryZoneId === "number" ? rawDeliveryZoneId : null;
    if (zoneIdForCap == null && typeof deliveryPincode === "string" && deliveryPincode.trim()) {
      const { deliveryZonesTable } = await import("../lib/db");
      const pin = deliveryPincode.trim();
      const zones = await db.select({ id: deliveryZonesTable.id, pincodes: deliveryZonesTable.pincodes })
        .from(deliveryZonesTable)
        .where(and(eq(deliveryZonesTable.restaurantId, restaurantId), eq(deliveryZonesTable.isActive, true)));
      const match = zones.find((z) => (z.pincodes ?? "").split(/[\s,]+/).map((p) => p.trim()).includes(pin));
      if (match) zoneIdForCap = match.id;
    }
    const capRes = await evaluateOrderCapacity({
      restaurantId, channel: channelForCap, orderType: resolvedType, itemQuantities, deliveryZoneId: zoneIdForCap,
    });
    if (!capRes.allowed) {
      return void res.status(429).json({
        error: capRes.reason ?? "We're not accepting orders right now.",
        nextAvailableAt: capRes.nextAvailableAt ?? null,
      });
    }
    if (capRes.autoExtendApplied) void maybeAlertManagersOnRush(restaurantId);
  }

  if (isCurbside) {
    if (!customerPhone || typeof customerPhone !== "string" || customerPhone.trim().length < 4) {
      return void res.status(400).json({ error: "A contact phone is required for curbside pickup." });
    }
    if (!vehicleColor || !vehicleModel) {
      return void res.status(400).json({ error: "Vehicle color and model/make are required for curbside pickup." });
    }
  }

  let subtotal = 0;
  const enrichedItems: Array<{ mi: typeof menuItemsTable.$inferSelect; qty: number; notes?: string; modifiers: import("../lib/modifierEnrichment").EnrichedModifier[] }> = [];

  for (const item of items as Array<{ menuItemId: number; quantity: number; notes?: string; modifierIds?: number[]; modifiers?: import("../lib/modifierEnrichment").ModifierSelectionInput[] }>) {
    if (!item.menuItemId || !item.quantity) continue;
    const [mi] = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.id, item.menuItemId), eq(menuItemsTable.restaurantId, restaurantId)));
    if (!mi) continue;

    // Public flow historically sent modifierIds: number[]. Accept that shape
    // and also the richer {modifierId, quantity?} form used by POS.
    const selections: import("../lib/modifierEnrichment").ModifierSelectionInput[] =
      item.modifiers ?? (item.modifierIds ?? []).map(id => ({ modifierId: id }));
    const { enrichModifierSelections } = await import("../lib/modifierEnrichment");
    const r = await enrichModifierSelections(mi.id, selections);
    if (!r.ok) return void res.status(400).json({ error: r.error });
    const resolvedMods = r.modifiers;

    const modTotal = resolvedMods.reduce((s, m) => s + m.price * m.quantity, 0);
    subtotal += (Number(mi.price) + modTotal) * item.quantity;
    enrichedItems.push({ mi, qty: item.quantity, notes: item.notes, modifiers: resolvedMods });
  }

  if (enrichedItems.length === 0) {
    return void res.status(400).json({ error: "No valid menu items found" });
  }

  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) return void res.status(400).json({ error: "Restaurant not found" });

  // Normalize the guest-supplied phone to canonical "+<dial> <national>" so
  // it survives Twilio / WhatsApp dispatch (toE164 strips spaces at send time)
  // and so lookups / reorder flows can match consistently regardless of how
  // the diner typed it. Falls back to the restaurant's configured country.
  const normalizedCustomerPhone = customerPhone
    ? normalizePhone(String(customerPhone), restaurant.country)
    : null;
  if (customerPhone && !normalizedCustomerPhone) {
    return void res.status(400).json({ error: "Please enter a valid phone number." });
  }

  // Reject orders whose tableId belongs to a different restaurant — without
  // this check a malicious payload could attach an order to the wrong tenant's
  // floor table (the per-restaurant scope below would still skip the status
  // update, but the order row itself would carry a foreign tableId).
  if (tableId) {
    const [tableForOrder] = await db.select({ id: floorTablesTable.id }).from(floorTablesTable)
      .where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId)));
    if (!tableForOrder) return void res.status(400).json({ error: "Invalid table for this restaurant" });
  }

  const taxRate = Number(restaurant.taxRate ?? 5) / 100;
  const taxAmount = subtotal * taxRate;
  const totalAmount = subtotal + taxAmount;

  // Resolve customer by phone for CQ hooks (blacklist intercept, VIP alert,
  // cart conversion). Public flow has no authenticated identity, so we only
  // resolve when the guest provided a phone number.
  let resolvedCustomerRow: typeof customersTable.$inferSelect | undefined;
  if (normalizedCustomerPhone) {
    // Tolerant match: canonical form for new rows, raw form for legacy rows
    // saved before normalization. Without this, blacklist/VIP checks could
    // silently miss customers whose stored phone is still in the old format.
    const custCandidates = Array.from(new Set([
      normalizedCustomerPhone,
      String(customerPhone).trim(),
    ].filter(Boolean)));
    const [cust] = await db.select().from(customersTable)
      .where(and(inArray(customersTable.phone, custCandidates), eq(customersTable.restaurantId, restaurantId)));
    resolvedCustomerRow = cust;

    // Auto-provision a CRM customer + wallet link from the diner's phone.
    // Without this, QR/online orders never become "visits" in the diner's
    // wallet and the restaurant never appears in their network list.
    const { ensureCustomerAndWalletLink } = await import("../lib/customerLinkOnOrder");
    const ensuredId = await ensureCustomerAndWalletLink({
      restaurantId,
      name: customerName ?? null,
      rawPhone: normalizedCustomerPhone,
      existingCustomerId: resolvedCustomerRow?.id ?? null,
    });
    if (ensuredId != null && !resolvedCustomerRow) {
      const [row] = await db.select().from(customersTable).where(eq(customersTable.id, ensuredId));
      resolvedCustomerRow = row;
    }
  }

  // Blacklist intercept (cust_blacklist) — public flow has no staff to
  // approve an override, so a blacklisted guest is hard-blocked.
  if (resolvedCustomerRow?.isBlacklisted) {
    const blacklistEnabled = await checkRestaurantFeature(restaurantId, "cust_blacklist");
    if (blacklistEnabled.ok) {
      return void res.status(403).json({
        error: "We are unable to accept this order. Please contact the restaurant.",
        blacklistReason: resolvedCustomerRow.blacklistReason ?? null,
      });
    }
  }

  const resolvedOrderType = isCurbside ? "curbside" : (tableId ? "dine_in" : (rawOrderType ?? "pickup"));

  // Direct online ordering (Task #432): load direct-ordering config for
  // min-order enforcement, delivery fee calculation, and holiday-closure
  // blocking. Apply only to non-dine-in public orders.
  let deliveryFeeAmount = 0;
  let scheduledForDate: Date | null = null;
  let deliveryAddressClean: string | null = null;
  if (!tableId && !isCurbside) {
    const [doRow] = await db.select().from(restaurantSettingsTable).where(and(
      eq(restaurantSettingsTable.restaurantId, restaurantId),
      eq(restaurantSettingsTable.section, "direct-ordering"),
    ));
    const doCfg = (doRow?.data ?? {}) as Record<string, unknown>;
    if (doCfg.orderingEnabled === false) {
      return void res.status(403).json({ error: "Online ordering is currently disabled by the restaurant." });
    }
    // Holiday closures: array of YYYY-MM-DD strings on which ordering is blocked.
    const closures = Array.isArray(doCfg.holidayClosures) ? doCfg.holidayClosures as unknown[] : [];
    const today = new Date().toISOString().slice(0, 10);
    if (closures.includes(today)) {
      return void res.status(403).json({ error: "Online ordering is closed today (holiday). Please try again tomorrow." });
    }
    // Minimum order
    const minOrderValue = typeof doCfg.minOrderValue === "number" ? doCfg.minOrderValue : 0;
    if (minOrderValue > 0 && subtotal < minOrderValue) {
      return void res.status(400).json({ error: `Minimum order is ${minOrderValue.toFixed(2)}. Add a few more items to continue.` });
    }
    // Direct online ordering (Task #432): enforce mode toggles server-side
    // — a malicious payload can't bypass settings by hand-crafting requests.
    const allowPickup = doCfg.allowPickup !== false;
    const allowDelivery = doCfg.allowDelivery === true;
    const allowScheduling = doCfg.allowScheduling !== false;
    const isPickupType = resolvedOrderType === "pickup" || resolvedOrderType === "takeaway";
    if (isPickupType && !allowPickup) {
      return void res.status(403).json({ error: "Pickup orders are not currently accepted online." });
    }
    if (resolvedOrderType === "delivery" && !allowDelivery) {
      return void res.status(403).json({ error: "Delivery orders are not currently accepted online." });
    }
    if (!isPickupType && resolvedOrderType !== "delivery") {
      // Anything other than pickup/takeaway/delivery on the direct ordering
      // path (e.g. dine_in without a tableId) is rejected.
      return void res.status(400).json({ error: "Invalid order type for online ordering." });
    }
    // Delivery fee (flat) — applied only on delivery
    if (resolvedOrderType === "delivery") {
      const flatFee = typeof doCfg.deliveryFee === "number" ? doCfg.deliveryFee : 0;
      const freeAt = typeof doCfg.freeDeliveryThreshold === "number" ? doCfg.freeDeliveryThreshold : 0;
      deliveryFeeAmount = freeAt > 0 && subtotal >= freeAt ? 0 : flatFee;
      if (typeof rawDeliveryAddress === "string" && rawDeliveryAddress.trim()) {
        deliveryAddressClean = rawDeliveryAddress.trim().slice(0, 500);
      } else {
        return void res.status(400).json({ error: "Delivery address is required for delivery orders." });
      }
    }
    // Schedule
    if (rawScheduledFor) {
      if (!allowScheduling) {
        return void res.status(403).json({ error: "Scheduling orders for later is not currently enabled." });
      }
      const d = new Date(rawScheduledFor);
      if (Number.isNaN(d.getTime())) {
        return void res.status(400).json({ error: "Invalid scheduled time." });
      }
      if (d.getTime() < Date.now() - 60_000) {
        return void res.status(400).json({ error: "Scheduled time must be in the future." });
      }
      scheduledForDate = d;
    }
  }

  const totalWithDelivery = totalAmount + deliveryFeeAmount;

  // Task #601 — QR dine-in merge: if guests are scanning a table that already
  // has a running order, append items as a new KOT round into that order
  // (gated by `qrAddToRunningBill`). Respects `afterBillBehavior` once the
  // bill has been generated.
  const { loadRunningOrderSettings, getActiveRunningOrderForTable, createKotBatchForItems, openTableSession, withTableLock } = await import("../lib/runningOrder");
  const { tableSessionsTable, floorTablesTable: ftTable } = await import("../lib/db");
  const roSettings = await loadRunningOrderSettings(restaurantId);

  let order: typeof ordersTable.$inferSelect;
  let qrMergeTarget: typeof ordersTable.$inferSelect | null = null;
  let mergedRound: number | null = null;

  // Task #601 — QR merge/open under per-table advisory lock so concurrent
  // QR scans on the same table can never both open a second running order.
  // afterBillBehavior=require_approval is enforced server-side here for QR:
  // guests cannot approve, so we treat require_approval like block (POS has
  // a manager-PIN path to override).
  if (tableId && resolvedOrderType === "dine_in" && roSettings.enabled) {
    const locked = await withTableLock(restaurantId, tableId, async tx => {
      // One-running-order invariant: always look up the existing running
      // order under the table lock, regardless of toggles. Toggles control
      // whether QR may merge into it — never whether it exists.
      const existing = await getActiveRunningOrderForTable(restaurantId, tableId, tx);
      if (existing) {
        if (!roSettings.qrAddToRunningBill) {
          return { kind: "blocked" as const, reason: "qr_add_disabled" as const };
        }
        if (existing.status === "bill_generated" &&
            (roSettings.afterBillBehavior === "block" || roSettings.afterBillBehavior === "require_approval")) {
          return { kind: "blocked" as const, reason: roSettings.afterBillBehavior };
        }
        return { kind: "merge" as const, order: existing };
      }
      const [sess] = await tx.insert(tableSessionsTable).values({
        restaurantId, branchId: null, tableId,
        customerId: resolvedCustomerRow?.id ?? null,
        status: "open",
        // Guest-verification hold: this session was opened by a QR scan
        // (untrusted). staffVerifiedAt is left null so the first KOT
        // round of this session is held in 'pending_acceptance' until a
        // waiter taps Accept. See createKotBatchForItems below.
        openedBy: "qr",
      }).returning();
      const __minted = await mintOrderNumbers({ restaurantId, branchId: null, orderType: "qr", exec: tx });
      const [newOrder] = await tx.insert(ordersTable).values({
        restaurantId, tableId,
        orderNumber: __minted.orderNumber,
        orderDisplayNumber: __minted.orderDisplayNumber,
        orderInternalNumber: __minted.orderInternalNumber,
        dailySequence: __minted.dailySequence,
        orderTypePrefix: __minted.orderTypePrefix,
        outletCode: __minted.outletCode,
        businessDate: __minted.businessDate,
        orderType: "dine_in",
        tableSessionId: sess.id, isRunningOrder: true,
        subtotal: "0.00", taxAmount: "0.00", serviceCharge: "0.00", discountAmount: "0.00",
        totalAmount: "0.00",
        customerName: customerName ?? null, customerPhone: normalizedCustomerPhone, notes: notes ?? null,
        customerId: resolvedCustomerRow?.id ?? null,
        scheduledFor: scheduledForDate,
        deliveryAddress: deliveryAddressClean,
        deliveryFee: deliveryFeeAmount.toFixed(2),
      }).returning();
      await tx.update(ftTable).set({ status: "occupied", updatedAt: new Date() })
        .where(and(eq(ftTable.id, tableId), eq(ftTable.restaurantId, restaurantId)));
      return { kind: "open" as const, order: newOrder };
    });
    if (locked.kind === "blocked") {
      if (locked.reason === "qr_add_disabled") {
        return void res.status(409).json({
          error: "This table already has an open order. Please ask a staff member to add items.",
          code: "QR_ADD_DISABLED",
        });
      }
      return void res.status(409).json({
        error: locked.reason === "require_approval"
          ? "A staff member must approve adding items after the bill has been generated"
          : "Bill already generated for this table",
        code: locked.reason === "require_approval" ? "REQUIRES_STAFF_APPROVAL" : "BILL_ALREADY_GENERATED",
      });
    }
    order = locked.order;
    if (locked.kind === "merge") qrMergeTarget = locked.order;
    // The new row already has totals=0; we re-update with the computed
    // totals (existing subtotal/tax) below for the non-merge case so the
    // header reflects the items we're about to insert.
    if (locked.kind === "open") {
      const [updated] = await db.update(ordersTable).set({
        subtotal: subtotal.toFixed(2), taxAmount: taxAmount.toFixed(2),
        totalAmount: totalWithDelivery.toFixed(2),
        updatedAt: new Date(),
      }).where(eq(ordersTable.id, order.id)).returning();
      order = updated;
    }
  } else {
    const __minted = await mintOrderNumbers({ restaurantId, branchId: null, orderType: resolvedOrderType });
    [order] = await db.insert(ordersTable).values({
      restaurantId, tableId: tableId ?? null,
      orderNumber: __minted.orderNumber,
      orderDisplayNumber: __minted.orderDisplayNumber,
      orderInternalNumber: __minted.orderInternalNumber,
      dailySequence: __minted.dailySequence,
      orderTypePrefix: __minted.orderTypePrefix,
      outletCode: __minted.outletCode,
      businessDate: __minted.businessDate,
      orderType: resolvedOrderType,
      tableSessionId: null,
      isRunningOrder: false,
      subtotal: subtotal.toFixed(2), taxAmount: taxAmount.toFixed(2),
      serviceCharge: "0.00", discountAmount: "0.00",
      totalAmount: totalWithDelivery.toFixed(2), customerName: customerName ?? null, customerPhone: normalizedCustomerPhone, notes: notes ?? null,
      customerId: resolvedCustomerRow?.id ?? null,
      vehicleColor: isCurbside ? String(vehicleColor).slice(0, 40) : null,
      vehicleModel: isCurbside ? String(vehicleModel).slice(0, 80) : null,
      vehicleNumber: isCurbside && typeof vehicleNumber === "string" ? vehicleNumber.slice(0, 40) : null,
      parkingSpot: isCurbside && typeof parkingSpot === "string" ? parkingSpot.slice(0, 40) : null,
      scheduledFor: scheduledForDate,
      deliveryAddress: deliveryAddressClean,
      deliveryFee: deliveryFeeAmount.toFixed(2),
    }).returning();
  }

  const insertedItemIds: number[] = [];
  for (const ei of enrichedItems) {
    const modTotal = ei.modifiers.reduce((s, m) => s + m.price * m.quantity, 0);
    const unitPrice = Number(ei.mi.price) + modTotal;
    const [oi] = await db.insert(orderItemsTable).values({
      orderId: order.id, menuItemId: ei.mi.id, menuItemName: ei.mi.name,
      quantity: ei.qty, unitPrice: unitPrice.toFixed(2), totalPrice: (unitPrice * ei.qty).toFixed(2), notes: ei.notes ?? null,
    }).returning();
    insertedItemIds.push(oi.id);
    for (const mod of ei.modifiers) {
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
  }

  // Recompute totals into the merged order (existing subtotal/tax already
  // counted, we now add the appended items). If the merge hit a
  // bill_generated order (only reachable when afterBillBehavior=allow),
  // reopen the lifecycle so the stale bill is invalidated.
  if (qrMergeTarget) {
    if (qrMergeTarget.status === "bill_generated") {
      await db.update(ordersTable).set({
        status: "pending", billGeneratedAt: null, updatedAt: new Date(),
      }).where(eq(ordersTable.id, order.id));
      if (qrMergeTarget.tableSessionId) {
        await db.update(tableSessionsTable).set({
          status: "open", billGeneratedAt: null, updatedAt: new Date(),
        }).where(eq(tableSessionsTable.id, qrMergeTarget.tableSessionId));
      }
      if (qrMergeTarget.tableId) {
        await db.update(ftTable).set({
          status: "occupied", updatedAt: new Date(),
        }).where(and(eq(ftTable.id, qrMergeTarget.tableId), eq(ftTable.restaurantId, restaurantId)));
      }
      broadcastEvent(restaurantId, "order:reopened", { id: order.id });
    }
    const { recalculateOrderTotals } = await import("./orders");
    await recalculateOrderTotals(order.id, restaurantId);
    const [refreshed] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    if (refreshed) order = refreshed;
  }

  // Modifier-driven inventory deduction (recipes are deducted elsewhere via deductInventoryForOrder).
  try {
    const { deductInventoryForModifiers } = await import("../lib/modifierEnrichment");
    await deductInventoryForModifiers(restaurantId, order.id, enrichedItems.map(ei => ({
      lineQty: ei.qty,
      modifiers: ei.modifiers.map(m => ({ modifierId: m.modifierId, quantity: m.quantity })),
    })));
  } catch (err) {
    console.error("[public order] modifier inventory deduction failed:", err);
  }

  // Task #601 — every QR dine-in round is a KOT batch (so KDS/printers see
  // round-by-round prep tickets). For non-dine-in QR orders, fall back to
  // the simple per-order ticket helper to preserve existing behaviour.
  //
  // Guest-verification hold: if the table session was opened by a QR scan
  // (`openedBy='qr'`) and no staff member has verified the guest yet
  // (`staffVerifiedAt IS NULL`), this batch is created with status
  // 'pending_acceptance' — KDS hides it until a waiter accepts on Tables /
  // Requests / mobile push. Staff-opened sessions skip the hold.
  let createdTickets: Array<{ ticketId: number; kitchenId: number }> = [];
  let isHeld = false;
  if (tableId && resolvedOrderType === "dine_in" && roSettings.enabled) {
    if (order.tableSessionId) {
      const [sessRow] = await db
        .select({ openedBy: tableSessionsTable.openedBy, staffVerifiedAt: tableSessionsTable.staffVerifiedAt })
        .from(tableSessionsTable)
        .where(eq(tableSessionsTable.id, order.tableSessionId));
      // Skip the verification hold when the order has already been paid
      // (online prepaid flows): real money committed eliminates the
      // dine-and-dash fraud vector the hold is designed to catch.
      const isPrepaid = order.paymentStatus === "paid";
      // Owner-controlled kill switch: restaurants can disable the
      // verification hold entirely from Settings → Guest Verification.
      // Default is enabled (no row OR row.data.enabled !== false).
      const [gvSetting] = await db
        .select({ data: restaurantSettingsTable.data })
        .from(restaurantSettingsTable)
        .where(and(
          eq(restaurantSettingsTable.restaurantId, restaurantId),
          eq(restaurantSettingsTable.section, "guest-verification"),
        ));
      const gvEnabled = (gvSetting?.data as { enabled?: boolean } | undefined)?.enabled !== false;
      isHeld = gvEnabled && sessRow?.openedBy === "qr" && !sessRow?.staffVerifiedAt && !isPrepaid;
    }
    const batchRes = await createKotBatchForItems({
      restaurantId,
      orderId: order.id,
      tableSessionId: order.tableSessionId ?? null,
      createdFor: "new",
      source: "qr",
      orderItemIds: insertedItemIds,
      held: isHeld,
    });
    createdTickets = batchRes.tickets;
    mergedRound = batchRes.batch.roundNumber;
  } else {
    createdTickets = await createKitchenTicketsForOrder({ orderId: order.id, restaurantId, isPriority: false });
  }
  void mergedRound;

  if (tableId) {
    const [validTable] = await db.select({ id: floorTablesTable.id }).from(floorTablesTable).where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId)));
    if (validTable) {
      await db.update(floorTablesTable).set({ status: "occupied" }).where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId)));
    }
    if (isHeld) {
      // Guest-verification hold: notify waiters to physically verify the
      // guest before the kitchen starts. Do NOT play the standard new-order
      // chime — this is an action item, not a "kitchen, start cooking" cue.
      await db.insert(notificationsTable).values({
        restaurantId, type: "guest_verification",
        title: "Guest verification needed",
        message: `Table ordered via QR — accept to fire to kitchen. Order: ${order.orderNumber}`,
        entityId: order.id, entityType: "order",
      });
      broadcastEvent(restaurantId, "notification:new", { type: "guest_verification" });
      broadcastEvent(restaurantId, "guest_verification:new", { orderId: order.id, tableId, orderNumber: order.orderNumber });
      try {
        const { pushToStaff } = await import("../lib/pushNotify");
        await pushToStaff(
          { restaurantId, roles: ["waiter", "manager", "owner"], type: "guest_verification" },
          {
            title: `Guest needs verification · Table order #${order.orderNumber}`,
            body: `Tap to accept and fire to kitchen.`,
            data: { orderId: order.id, tableId, type: "guest_verification", screen: "tables" },
          },
        );
      } catch (err) {
        logger.error?.({ err, orderId: order.id }, "Guest verification push failed");
      }
    } else {
      await db.insert(notificationsTable).values({ restaurantId, type: "new_order", title: "New QR Order", message: `QR order from table. Order: ${order.orderNumber}` });
      broadcastEvent(restaurantId, "notification:new", { type: "new_order" });
      // Fire push to staff so phones light up even when the app is backgrounded.
      try {
        const { pushToStaff } = await import("../lib/pushNotify");
        await pushToStaff(
          { restaurantId, roles: ["waiter", "manager", "owner", "cashier"], type: "new_order" },
          {
            title: `New QR Order · #${order.orderNumber}`,
            body: `Guest placed an order from a table.`,
            data: { orderId: order.id, type: "new_order", screen: "kitchen" },
          },
        );
      } catch (err) {
        logger.error?.({ err, orderId: order.id }, "QR new-order push failed");
      }
    }
  }

  for (const t of createdTickets) {
    broadcastEvent(restaurantId, "order:new", { id: order.id, orderNumber: order.orderNumber, status: order.status, tableId, ticketId: t.ticketId, kitchenId: t.kitchenId });
  }

  // Auto-create VIP alert when a VIP customer places an order via QR/online
  if (resolvedCustomerRow?.isVip && (await checkRestaurantFeature(restaurantId, "cust_vip_alerts")).ok) {
    try {
      const [vipAlert] = await db.insert(vipAlertsTable).values({
        restaurantId, customerId: resolvedCustomerRow.id, orderId: order.id,
        trigger: "order_placed",
        reason: `VIP guest ${resolvedCustomerRow.name ?? resolvedCustomerRow.phone ?? ""} placed order #${order.orderNumber}`,
        channelsNotified: ["notification"],
      }).returning();
      await db.insert(notificationsTable).values({
        restaurantId, type: "vip_alert",
        title: `VIP guest arrived: ${resolvedCustomerRow.name ?? resolvedCustomerRow.phone ?? "Customer"}`,
        message: `Order #${order.orderNumber} — give white-glove service`,
        entityId: vipAlert.id, entityType: "vip_alert",
      });
    } catch (err) {
      console.error(`[VIP alert public] failed for restaurant ${restaurantId} order ${order.id}:`, err);
    }
  }

  // Convert any matching active cart session → "converted" (cust_abandoned_cart)
  if ((await checkRestaurantFeature(restaurantId, "cust_abandoned_cart")).ok) {
    try {
      const sessKey = (req.body?.cartSessionToken ?? req.body?.cartSessionKey ?? null) as string | null;
      if (sessKey) {
        await db.update(cartSessionsTable)
          .set({ status: "converted", orderId: order.id, convertedAt: new Date() })
          .where(and(eq(cartSessionsTable.restaurantId, restaurantId), eq(cartSessionsTable.sessionToken, String(sessKey))));
      } else if (resolvedCustomerRow?.id || normalizedCustomerPhone) {
        const conds = [eq(cartSessionsTable.restaurantId, restaurantId), eq(cartSessionsTable.status, "active")];
        if (resolvedCustomerRow?.id) conds.push(eq(cartSessionsTable.customerId, resolvedCustomerRow.id));
        else if (normalizedCustomerPhone) {
          // Tolerant match for legacy cart sessions saved before normalization.
          const cartCandidates = Array.from(new Set([
            normalizedCustomerPhone,
            String(customerPhone).trim(),
          ].filter(Boolean)));
          conds.push(inArray(cartSessionsTable.customerPhone, cartCandidates));
        }
        await db.update(cartSessionsTable)
          .set({ status: "converted", orderId: order.id, convertedAt: new Date() })
          .where(and(...conds));
      }
    } catch (err) {
      console.error(`[Cart convert public] failed for restaurant ${restaurantId} order ${order.id}:`, err);
    }
  }

  // Immediate "order received" WhatsApp to the guest — without this the
  // diner gets no confirmation until staff later marks the order ready /
  // completed, which can be many minutes after they place the QR order.
  if (normalizedCustomerPhone) {
    try {
      const { sendWhatsApp } = await import("../lib/notifications");
      const { renderRestaurantEventBody } = await import("../lib/whatsappEventTemplate");
      const dispatchTo = toE164(normalizedCustomerPhone, restaurant.country) ?? normalizedCustomerPhone;
      const safeName = order.customerName ?? "there";
      const orderTotal = `₹${Number(order.totalAmount).toFixed(2)}`;
      const rendered = await renderRestaurantEventBody(restaurantId, "order.placed",
        [safeName, order.orderNumber, restaurant.name, orderTotal]);
      const body = rendered
        ?? `Hi ${safeName}, your order #${order.orderNumber} at ${restaurant.name} is received. Total: ${orderTotal}. We'll notify you once it's ready. Thank you!`;
      sendWhatsApp({
        to: dispatchTo,
        body,
        restaurantId,
        meta: { event: "order.placed", orderId: order.id, channel: tableId ? "qr" : "online" },
      }).catch((err) => logger.error?.({ err, orderId: order.id }, "public order placed WhatsApp failed"));
    } catch (err) {
      logger.error?.({ err, orderId: order.id }, "public order placed WhatsApp dispatch threw");
    }
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

// Public live order tracking — tokenized, no-login (cust_live_order_status)
router.get("/public/orders/:orderId/track", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const token = String(req.query.token ?? "");
  if (!orderId || !validateGuestToken(orderId, token)) {
    return void res.status(403).json({ error: "Invalid order token" });
  }
  const [order] = await db.select({
    id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status,
    paymentStatus: ordersTable.paymentStatus, totalAmount: ordersTable.totalAmount,
    customerName: ordersTable.customerName, customerPhone: ordersTable.customerPhone,
    createdAt: ordersTable.createdAt,
    updatedAt: ordersTable.updatedAt, restaurantId: ordersTable.restaurantId,
    tableId: ordersTable.tableId,
    orderType: ordersTable.orderType,
    vehicleColor: ordersTable.vehicleColor,
    vehicleModel: ordersTable.vehicleModel,
    vehicleNumber: ordersTable.vehicleNumber,
    parkingSpot: ordersTable.parkingSpot,
    curbsideAcceptedAt: ordersTable.curbsideAcceptedAt,
    curbsideArrivedAt: ordersTable.curbsideArrivedAt,
    curbsideHandedOverAt: ordersTable.curbsideHandedOverAt,
  }).from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) return void res.status(404).json({ error: "Order not found" });

  // Optional hashed-phone binding: when the order has a customerPhone, an
  // additional `phone` query param must hash-match. This ties the public
  // tracking link to the guest who placed the order even if the token leaks.
  const phoneParam = typeof req.query.phone === "string" ? req.query.phone.trim() : "";
  if (order.customerPhone && phoneParam) {
    const expected = createHash("sha256").update(`${order.id}:${order.customerPhone}`).digest("hex");
    const provided = createHash("sha256").update(`${order.id}:${phoneParam}`).digest("hex");
    if (expected !== provided) {
      return void res.status(403).json({ error: "Phone does not match this order" });
    }
  }
  const featureOk = await checkRestaurantFeature(order.restaurantId, "cust_live_order_status");
  if (!featureOk.ok) return void res.status(featureOk.status).json({ error: featureOk.error });

  const tickets = await db.select({
    id: kitchenTicketsTable.id, status: kitchenTicketsTable.status,
    kitchenId: kitchenTicketsTable.kitchenId, updatedAt: kitchenTicketsTable.updatedAt,
  }).from(kitchenTicketsTable).where(eq(kitchenTicketsTable.orderId, orderId));

  const items = await db.select({
    id: orderItemsTable.id, name: orderItemsTable.menuItemName,
    quantity: orderItemsTable.quantity, status: orderItemsTable.status,
  }).from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));

  const isCurbside = order.orderType === "curbside";
  const baseTimeline = [
    { step: "placed", label: "Order placed", at: order.createdAt },
    { step: "preparing", label: "Preparing", at: tickets.some(t => t.status === "in_progress" || t.status === "ready") ? tickets[0]?.updatedAt : null },
    { step: "ready", label: "Ready", at: tickets.length > 0 && tickets.every(t => t.status === "ready" || t.status === "served") ? tickets[0]?.updatedAt : null },
  ];
  const timeline = isCurbside
    ? [
        ...baseTimeline,
        { step: "arrived", label: "Arrived at curb", at: order.curbsideArrivedAt ?? null },
        { step: "served", label: "Handed over", at: order.curbsideHandedOverAt ?? (order.status === "completed" ? order.updatedAt : null) },
      ]
    : [
        ...baseTimeline,
        { step: "served", label: "Served", at: order.status === "completed" || order.status === "served" ? order.updatedAt : null },
      ];

  res.json({ order, tickets, items, timeline });
});

// Curbside arrival — guest taps "I've arrived" from the tracking page.
// Tokenized; idempotent — the first arrival timestamp is preserved on re-tap,
// but parking spot updates and broadcasts/notifications fire each time.
router.post("/public/orders/:orderId/arrive", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const token = String(req.query.token ?? req.body?.token ?? "");
  if (!orderId || !validateGuestToken(orderId, token)) {
    return void res.status(403).json({ error: "Invalid order token" });
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.orderType !== "curbside") {
    return void res.status(400).json({ error: "This isn't a curbside order." });
  }
  if (order.curbsideHandedOverAt) {
    return void res.status(400).json({ error: "Order has already been handed over." });
  }
  const parkingSpotUpdate = typeof req.body?.parkingSpot === "string" && req.body.parkingSpot.trim().length > 0
    ? req.body.parkingSpot.slice(0, 40)
    : null;
  const now = new Date();
  const [updated] = await db.update(ordersTable).set({
    curbsideArrivedAt: order.curbsideArrivedAt ?? now,
    parkingSpot: parkingSpotUpdate ?? order.parkingSpot,
    updatedAt: now,
  }).where(eq(ordersTable.id, orderId)).returning();

  // Best-effort notifications — never block the customer's "I've arrived" tap.
  try {
    const { broadcastEvent: bEvent, broadcastOrderUpdate: bOrder } = await import("../lib/socketio");
    bEvent(order.restaurantId, "curbside:arrived", {
      orderId: order.id, orderNumber: order.orderNumber,
      vehicleColor: order.vehicleColor, vehicleModel: order.vehicleModel,
      vehicleNumber: order.vehicleNumber, parkingSpot: updated.parkingSpot,
    });
    bOrder(order.id, { id: order.id, status: order.status, curbsideArrivedAt: updated.curbsideArrivedAt });
    await db.insert(notificationsTable).values({
      restaurantId: order.restaurantId,
      type: "curbside_arrival",
      title: `Curbside arrival: ${order.orderNumber}`,
      message: `${order.vehicleColor ?? ""} ${order.vehicleModel ?? ""}${order.vehicleNumber ? ` (${order.vehicleNumber})` : ""}${updated.parkingSpot ? ` · Spot ${updated.parkingSpot}` : ""}`.trim(),
      entityId: order.id, entityType: "order",
    });
  } catch (err) {
    logger.error?.({ err, orderId }, "curbside arrival notification failed");
  }
  try {
    const { pushToStaff } = await import("../lib/pushNotify");
    await pushToStaff(
      { restaurantId: order.restaurantId, roles: ["waiter", "manager", "owner", "cashier"], type: "new_order" },
      {
        title: `Curbside guest arrived · ${order.orderNumber}`,
        body: `${order.vehicleColor ?? ""} ${order.vehicleModel ?? ""}${updated.parkingSpot ? ` at spot ${updated.parkingSpot}` : ""}`.trim(),
        data: { orderId: order.id, kind: "curbside_arrival" },
      },
    );
  } catch (err) {
    logger.error?.({ err, orderId }, "curbside arrival push failed");
  }
  try {
    const { sendWhatsApp, sendSms } = await import("../lib/notifications");
    const [r] = await db.select({ phone: restaurantsTable.phone, country: restaurantsTable.country })
      .from(restaurantsTable).where(eq(restaurantsTable.id, order.restaurantId));
    const body = `🚗 Curbside arrival for #${order.orderNumber}. ${order.vehicleColor ?? ""} ${order.vehicleModel ?? ""}${order.vehicleNumber ? ` (${order.vehicleNumber})` : ""}${updated.parkingSpot ? ` · Spot ${updated.parkingSpot}` : ""}.`.trim();
    // Convert to E.164 (no spaces) so Twilio / WhatsApp accept the recipient.
    const dispatchTo = r?.phone ? (toE164(r.phone, r.country) ?? r.phone) : null;
    if (dispatchTo) {
      let waOk = false;
      try {
        const waResult = await sendWhatsApp({
          to: dispatchTo,
          body,
          restaurantId: order.restaurantId,
          meta: { event: "order.curbside_arrival", orderId },
        });
        // Only treat as delivered when the provider returned a real message id.
        // Guard-blocked sends (disabled/no_session/quota) return { sid: null }
        // without throwing — those must still trigger the SMS fallback.
        waOk = Boolean(waResult?.sid);
        if (!waOk) {
          logger.warn?.({ orderId }, "curbside arrival WhatsApp blocked or returned no sid; falling back to SMS");
        }
      } catch (err) {
        logger.error?.({ err, orderId }, "curbside arrival WhatsApp failed; falling back to SMS");
      }
      if (!waOk) {
        try {
          await sendSms({ to: dispatchTo, body });
        } catch (err) {
          logger.error?.({ err, orderId }, "curbside arrival SMS fallback failed");
        }
      }
    }
  } catch (err) {
    logger.error?.({ err, orderId }, "curbside arrival notification dispatch failed");
  }
  try {
    await recordAuditLog({
      req, module: "orders", action: "order.curbside_arrived",
      entity: "order", entityId: order.id, restaurantId: order.restaurantId,
      newValue: { arrivedAt: updated.curbsideArrivedAt, parkingSpot: updated.parkingSpot },
    });
  } catch (err) {
    void err;
  }
  res.json({ ok: true, curbsideArrivedAt: updated.curbsideArrivedAt });
});

// ─── Public cart sessions (cust_abandoned_cart) ──────────────────────────
// Create or upsert a cart session as the guest browses QR / online menu
router.post("/public/carts", async (req, res) => {
  const { restaurantId, sessionToken, sessionKey, customerName, customerPhone, customerId, channel = "qr", tableId, branchId, items, subtotal, recoveryOptIn } = req.body ?? {};
  const token = sessionToken ?? sessionKey;
  if (!restaurantId || !token || !Array.isArray(items)) {
    return void res.status(400).json({ error: "restaurantId, sessionToken and items required" });
  }
  const featureOk = await checkRestaurantFeature(Number(restaurantId), "cust_abandoned_cart");
  if (!featureOk.ok) {
    // Silently no-op — never block ordering if plan lacks the feature
    return void res.json({ ok: true, skipped: true });
  }
  const now = new Date();
  const [existing] = await db.select().from(cartSessionsTable).where(and(
    eq(cartSessionsTable.restaurantId, Number(restaurantId)),
    eq(cartSessionsTable.sessionToken, String(token)),
  ));
  const itemsJson = items as unknown as Array<{ menuItemId: number; name: string; quantity: number; price: string }>;
  if (existing) {
    const [updated] = await db.update(cartSessionsTable).set({
      items: itemsJson, subtotal: String(subtotal ?? "0.00"),
      customerName: customerName ?? existing.customerName,
      customerPhone: customerPhone ?? existing.customerPhone,
      customerId: customerId ?? existing.customerId,
      recoveryOptIn: recoveryOptIn === true ? true : existing.recoveryOptIn,
      lastActivityAt: now, status: "active",
    }).where(eq(cartSessionsTable.id, existing.id)).returning();
    return void res.json({ cart: updated });
  }
  const [created] = await db.insert(cartSessionsTable).values({
    restaurantId: Number(restaurantId), sessionToken: String(token),
    channel: String(channel), tableId: tableId ?? null, branchId: branchId ?? null,
    customerId: customerId ?? null, customerName: customerName ?? null, customerPhone: customerPhone ?? null,
    items: itemsJson, subtotal: String(subtotal ?? "0.00"),
    recoveryOptIn: !!recoveryOptIn, status: "active", lastActivityAt: now,
  }).returning();
  res.status(201).json({ cart: created });
});

// Public mood capture (cust_mood) — used by QR / post-order screen
router.post("/public/mood", async (req, res) => {
  const { restaurantId, mood, orderId, customerId, customerPhone, comment, source = "checkout", branchId } = req.body ?? {};
  if (!restaurantId || !mood) return void res.status(400).json({ error: "restaurantId and mood required" });
  const MOOD_SCORES: Record<string, number> = { delighted: 2, happy: 1, neutral: 0, unhappy: -1, angry: -2 };
  if (!(mood in MOOD_SCORES)) return void res.status(400).json({ error: "Invalid mood" });
  const featureOk = await checkRestaurantFeature(Number(restaurantId), "cust_mood");
  if (!featureOk.ok) return void res.json({ ok: true, skipped: true });
  const commentWithPhone = customerPhone
    ? `${comment ? String(comment) + " " : ""}[phone:${String(customerPhone)}]`
    : (comment ?? null);
  const [inserted] = await db.insert(moodResponsesTable).values({
    restaurantId: Number(restaurantId), branchId: branchId ?? null,
    customerId: customerId ?? null, orderId: orderId ?? null,
    source: String(source), mood: String(mood), moodScore: MOOD_SCORES[mood],
    comment: commentWithPhone,
  }).returning();
  res.status(201).json({ response: inserted });
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
        // Auto-release any guest-verification hold: payment proves the
        // guest is real, fraud risk is gone, kitchen can start prep.
        try {
          const { releaseHeldTicketsForPaidOrder } = await import("../lib/guestVerificationEscalation");
          await releaseHeldTicketsForPaidOrder(id, order.restaurantId);
        } catch (err) { req.log?.error({ err, orderId: id }, "release held tickets after Stripe verify failed"); }
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

router.post("/public/restaurants/:restaurantId/coupons/validate", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { code, subtotal } = req.body as { code?: string; subtotal?: number };
  if (!restaurantId || !code) return void res.status(400).json({ error: "Restaurant and code are required" });

  const feat = await checkRestaurantFeature(restaurantId, "discounts_promotions");
  if (!feat.ok) return void res.status(feat.status).json({ error: feat.error });

  const [coupon] = await db.select().from(couponsTable).where(and(
    eq(couponsTable.restaurantId, restaurantId),
    eq(couponsTable.code, String(code).toUpperCase().trim()),
    eq(couponsTable.isActive, true),
  ));
  if (!coupon) return void res.status(400).json({ error: "Invalid coupon code" });
  const now = new Date();
  if (coupon.validFrom && new Date(coupon.validFrom) > now) return void res.status(400).json({ error: "Coupon is not yet active" });
  if (coupon.validTo && new Date(coupon.validTo) < now) return void res.status(400).json({ error: "Coupon has expired" });
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) return void res.status(400).json({ error: "Coupon usage limit reached" });

  const subAmt = Number(subtotal ?? 0);
  if (coupon.minOrderAmount && subAmt > 0 && subAmt < Number(coupon.minOrderAmount)) {
    return void res.status(400).json({ error: `Minimum order amount is ${coupon.minOrderAmount}`, minOrderAmount: coupon.minOrderAmount });
  }

  let discount = coupon.discountType === "percentage"
    ? (subAmt * Number(coupon.discountValue)) / 100
    : Number(coupon.discountValue);
  if (coupon.maxDiscountAmount) discount = Math.min(discount, Number(coupon.maxDiscountAmount));
  if (subAmt > 0) discount = Math.min(discount, subAmt);

  res.json({
    valid: true,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountAmount: discount.toFixed(2),
    minOrderAmount: coupon.minOrderAmount ?? null,
    maxDiscountAmount: coupon.maxDiscountAmount ?? null,
  });
});

router.post("/public/orders/:id/apply-coupon", async (req, res) => {
  const orderId = Number(req.params.id);
  const { token } = req.query as { token?: string };
  if (!validateGuestToken(orderId, token)) {
    return void res.status(403).json({ error: "Invalid or missing order token" });
  }
  const { code } = req.body as { code?: string };
  if (!code) return void res.status(400).json({ error: "Code is required" });

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) return void res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return void res.status(400).json({ error: "Cannot apply coupon to a completed or cancelled order" });
  }
  if (order.paymentStatus === "paid") {
    return void res.status(400).json({ error: "Order is already paid" });
  }

  const feat = await checkRestaurantFeature(order.restaurantId, "discounts_promotions");
  if (!feat.ok) return void res.status(feat.status).json({ error: feat.error });

  const now = new Date();
  const [coupon] = await db.select().from(couponsTable).where(and(
    eq(couponsTable.restaurantId, order.restaurantId),
    eq(couponsTable.code, String(code).toUpperCase().trim()),
    eq(couponsTable.isActive, true),
  ));
  if (!coupon) return void res.status(400).json({ error: "Invalid coupon code" });
  if (coupon.validFrom && new Date(coupon.validFrom) > now) return void res.status(400).json({ error: "Coupon is not yet active" });
  if (coupon.validTo && new Date(coupon.validTo) < now) return void res.status(400).json({ error: "Coupon has expired" });
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) return void res.status(400).json({ error: "Coupon usage limit reached" });

  const subtotal = Number(order.subtotal);
  if (coupon.minOrderAmount && subtotal < Number(coupon.minOrderAmount)) {
    return void res.status(400).json({ error: `Minimum order amount is ${coupon.minOrderAmount}` });
  }

  let couponDiscount = coupon.discountType === "percentage"
    ? (subtotal * Number(coupon.discountValue)) / 100
    : Number(coupon.discountValue);
  if (coupon.maxDiscountAmount) couponDiscount = Math.min(couponDiscount, Number(coupon.maxDiscountAmount));

  await deleteOrderDiscountsByType(orderId, "coupon");
  const otherDiscountTotal = await sumOrderDiscounts(orderId);
  const headroom = Math.max(0, subtotal - otherDiscountTotal);
  const couponAmount = Math.min(couponDiscount, headroom);
  if (couponAmount <= 0) {
    return void res.status(409).json({ error: "Order is already fully discounted; coupon would have no effect" });
  }
  await db.insert(orderDiscountsTable).values({
    orderId, restaurantId: order.restaurantId,
    type: "coupon",
    scope: "order",
    value: Number(coupon.discountValue).toFixed(2),
    amount: couponAmount.toFixed(2),
    reason: `Coupon: ${coupon.code}`,
    couponCode: coupon.code,
    recordedByUserId: null,
  });
  await db.update(ordersTable).set({ couponCode: coupon.code, updatedAt: new Date() }).where(eq(ordersTable.id, orderId));
  await recalculateOrderTotals(orderId, order.restaurantId);

  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const discounts = await listOrderDiscounts(orderId);
  res.json({ ...updatedOrder, items, discounts, couponApplied: { code: coupon.code, discountAmount: couponAmount.toFixed(2), discountType: coupon.discountType } });
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
  return void res.json({
    id: order.id, orderNumber: order.orderNumber, status: order.status,
    paymentStatus: order.paymentStatus, totalAmount: order.totalAmount, items,
    createdAt: order.createdAt,
    order: {
      orderType: order.orderType,
      vehicleColor: order.vehicleColor,
      vehicleModel: order.vehicleModel,
      vehicleNumber: order.vehicleNumber,
      parkingSpot: order.parkingSpot,
      curbsideArrivedAt: order.curbsideArrivedAt,
      curbsideHandedOverAt: order.curbsideHandedOverAt,
    },
  });
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

  const [restaurant] = await db.select({ currency: restaurantsTable.currency, slug: restaurantsTable.slug, enableOnlinePayment: restaurantsTable.enableOnlinePayment }).from(restaurantsTable).where(eq(restaurantsTable.id, order.restaurantId));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  // Task #587 — Resolve the customer-requested online method against the
  // restaurant's configured Online options. This both enforces the admin's
  // `onlinePaymentSource` routing choice and rejects sources the customer
  // tried to spoof via direct POST. Falls back to the first enabled option
  // when the client doesn't send a choice (older single-button clients).
  const { resolveCustomerOnlineMethod } = await import("../lib/paymentConfig");
  const requested = (req.body ?? {}) as { paymentSource?: string; gatewayCode?: string | null };
  const resolved = await resolveCustomerOnlineMethod(order.restaurantId, requested);
  if (!resolved) {
    return void res.status(403).json({ error: "Selected online payment method is not available for this restaurant" });
  }
  // Stash the resolved choice on the order so /pay can tag the ledger row
  // with the correct payment_source/gateway_code even when the client only
  // echoes back `intentId`. Mirrors the legacy `paymentMethod` column for
  // free-text method labels.
  await db.update(ordersTable).set({
    paymentSource: resolved.type,
    paymentGatewayCode: resolved.gatewayCode,
  }).where(eq(ordersTable.id, order.id));

  // Task #587 — Manual UPI flow: no live payment processor; surface the
  // restaurant's UPI VPA + reference so the customer can pay outside the
  // app and submit a UTR/screenshot. Staff confirm asynchronously
  // (Manual UPI confirmation queue, follow-up #588). We return an
  // intent-shaped object so the existing client UI keeps working.
  if (resolved.type === "manual_upi") {
    const { getPaymentConfig, decryptManualUpi } = await import("../lib/paymentConfig");
    const cfg = await getPaymentConfig(order.restaurantId);
    const vpa = decryptManualUpi(cfg.manualUpi);
    // NPCI UPI Linking Spec v1.6 fields. `tr` (transaction reference) must
    // be unique alphanumeric ≤35 chars — we encode the order id plus a
    // short timestamp suffix so collisions are impossible even if a
    // customer retries from a stale tab. `mc=5812` is the MCC for
    // "Eating Places, Restaurants" per ISO 18245; supplying it gives the
    // receiving UPI app a legitimate merchant context and meaningfully
    // reduces risk-policy rejections compared to a bare upi://pay link.
    const txnRef = `TT${order.id}${Date.now().toString(36).toUpperCase().slice(-6)}`;
    return void res.json({
      mode: "manual_upi",
      paymentSource: "manual_upi",
      upiId: vpa,
      merchantName: cfg.manualUpi?.merchantName ?? null,
      requireUtr: cfg.manualUpi?.requireUtr ?? true,
      allowScreenshotUpload: cfg.manualUpi?.allowScreenshotUpload ?? true,
      enableIntentLink: cfg.manualUpi?.enableIntentLink ?? true,
      enableStaticQr: cfg.manualUpi?.enableStaticQr ?? false,
      staticQrUrl: cfg.manualUpi?.staticQrUrl ?? null,
      enableCopyUpiId: cfg.manualUpi?.enableCopyUpiId ?? true,
      totalAmount: order.totalAmount,
      orderId: order.id,
      orderNumber: order.orderNumber,
      txnRef,
      merchantCategoryCode: "5812",
    });
  }
  // Own-gateway: behaviour identical to platform_gateway today (PhonePe /
  // Razorpay codepaths live behind the same Stripe-style intent contract);
  // record the routing tag and continue through the Stripe block below.
  const currency = (restaurant?.currency ?? "INR").toLowerCase();
  const amountSmallestUnit = Math.round(Number(order.totalAmount) * 100);
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (stripeKey) {
    try {
      const stripe = new Stripe(stripeKey);
      const baseUrl = process.env.PUBLIC_URL?.replace(/\/$/, "") ?? "";
      const webBase = (process.env.WEB_APP_BASE_PATH ?? "/app").replace(/\/$/, "");
      const returnUrl = `${baseUrl}${webBase}/menu/${restaurant?.slug ?? ""}/${order.tableId ?? ""}`;
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

  // Server-side enforcement: refuse to confirm a card payment for a
  // restaurant whose owner has disabled online payment on the QR menu.
  const [payRestaurant] = await db.select({ enableOnlinePayment: restaurantsTable.enableOnlinePayment }).from(restaurantsTable).where(eq(restaurantsTable.id, order.restaurantId));
  if (!payRestaurant?.enableOnlinePayment) {
    return void res.status(403).json({ error: "Online payment is disabled for this restaurant" });
  }

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

  // Task #587 — Persist a row in the payments ledger tagged with the new
  // category / source / gateway columns so reports (and the upcoming Manual
  // UPI staff confirmation flow) can filter on payment_source. Use the
  // resolved choice stashed on the order at intent time so manual UPI /
  // own-gateway flows aren't misreported as platform_gateway/stripe.
  try {
    const orderSource = (order as { paymentSource?: string | null }).paymentSource ?? "platform_gateway";
    const orderGateway = (order as { paymentGatewayCode?: string | null }).paymentGatewayCode
      ?? (intentId.startsWith("demo_") ? "demo" : "stripe");
    await db.insert(paymentsTable).values({
      restaurantId: order.restaurantId,
      direction: "in",
      method: paymentMethod ?? "card",
      paymentCategory: "online",
      paymentSource: orderSource,
      gatewayCode: orderGateway,
      amount: String(order.totalAmount),
      paymentDate: new Date(),
      partyType: order.customerId ? "customer" : "other",
      partyId: order.customerId ?? null,
      partyName: order.customerName ?? null,
      referenceType: "order",
      referenceId: order.id,
      notes: `Public checkout intent ${intentId}`,
    } as never).onConflictDoNothing();
  } catch (err) {
    req.log?.error({ err }, "public/pay: payments ledger insert failed (continuing)");
  }

  // Auto-release any guest-verification hold: payment proves the guest is
  // real, fraud risk is gone, kitchen can start prep.
  try {
    const { releaseHeldTicketsForPaidOrder } = await import("../lib/guestVerificationEscalation");
    await releaseHeldTicketsForPaidOrder(orderId, order.restaurantId);
  } catch (err) { req.log?.error({ err, orderId }, "release held tickets after public/pay failed"); }

  broadcastEvent(order.restaurantId, "order:update", { id: order.id, status: order.status, paymentStatus: "paid" });
  broadcastOrderUpdate(orderId, { id: order.id, status: order.status, paymentStatus: "paid" });

  // Send "order confirmed" WhatsApp to the guest now that payment is settled.
  // Mirrors the staff payment path so QR / public self-pay customers get
  // the same confirmation as orders paid at the counter.
  try {
    const phone = updated.customerPhone ?? order.customerPhone;
    if (phone) {
      const [restaurant] = await db.select({ name: restaurantsTable.name, country: restaurantsTable.country })
        .from(restaurantsTable).where(eq(restaurantsTable.id, order.restaurantId));
      const to = toE164(phone, restaurant?.country ?? null) ?? phone;
      const name = updated.customerName ?? order.customerName ?? "there";
      const total = Number(updated.totalAmount ?? order.totalAmount).toFixed(2);
      const orderNumber = updated.orderNumber ?? order.orderNumber;
      const restName = restaurant?.name ?? "our restaurant";
      const { renderRestaurantEventBody } = await import("../lib/whatsappEventTemplate");
      const rendered = await renderRestaurantEventBody(order.restaurantId, "order.confirmed",
        [name, orderNumber, restName, `₹${total}`, ""]);
      const body = rendered ?? `Hi ${name}, your order #${orderNumber} at ${restName} is confirmed. Total: ₹${total}. Thank you!`;
      const { sendWhatsApp } = await import("../lib/notifications");
      sendWhatsApp({ to, body, restaurantId: order.restaurantId, meta: { event: "order.confirmed", orderId } }).catch(console.error);
    }
  } catch (err) {
    console.error("[public/pay] order.confirmed dispatch failed", err);
  }

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

router.get("/public/push/vapid-public-key", async (_req, res) => {
  try {
    const key = await getVapidPublicKey();
    res.json({ publicKey: key });
  } catch (err) {
    logger.error({ err }, "Failed to load VAPID public key");
    res.status(500).json({ error: "Web push not available" });
  }
});

router.post("/public/push/subscribe", async (req, res) => {
  const { subscription, orderId, token, restaurantSlug, restaurantId: explicitRestaurantId, tableId, customerId, orderUpdatesOptIn, marketingOptIn, audience, locale } = req.body as {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    orderId?: number;
    token?: string;
    restaurantSlug?: string;
    restaurantId?: number;
    tableId?: number;
    customerId?: number;
    orderUpdatesOptIn?: boolean;
    marketingOptIn?: boolean;
    audience?: "customers" | "staff";
    locale?: string;
  };
  if (!subscription || typeof subscription.endpoint !== "string" || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return void res.status(400).json({ error: "Invalid subscription payload" });
  }
  let resolvedOrderId: number | null = null;
  if (orderId && token) {
    if (!validateGuestToken(orderId, token)) {
      return void res.status(403).json({ error: "Invalid order token" });
    }
    resolvedOrderId = orderId;
  }
  let resolvedRestaurantId: number | null = typeof explicitRestaurantId === "number" ? explicitRestaurantId : null;
  if (!resolvedRestaurantId && restaurantSlug && typeof restaurantSlug === "string") {
    const [r] = await db.select({ id: restaurantsTable.id }).from(restaurantsTable).where(eq(restaurantsTable.slug, restaurantSlug));
    if (r) resolvedRestaurantId = r.id;
  }
  try {
    const row = await upsertWebPushSubscription({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      orderId: resolvedOrderId,
      restaurantId: resolvedRestaurantId,
      tableId: typeof tableId === "number" ? tableId : null,
      customerId: typeof customerId === "number" ? customerId : null,
      audience: audience ?? "customers",
      orderUpdatesOptIn: orderUpdatesOptIn !== false,
      marketingOptIn: marketingOptIn === true,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 500) : null,
      locale: typeof locale === "string" ? locale.slice(0, 16) : null,
    });
    res.json({ success: true, subscriptionId: row.id, status: row.status, orderUpdatesOptIn: row.orderUpdatesOptIn, marketingOptIn: row.marketingOptIn });
  } catch (err) {
    logger.error({ err }, "Failed to persist web push subscription");
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

router.get("/public/push/status", async (req, res) => {
  const endpoint = String(req.query.endpoint ?? "");
  if (!endpoint) return void res.status(400).json({ error: "endpoint required" });
  const row = await getSubscriptionStatus(endpoint);
  if (!row) return void res.json({ subscribed: false });
  res.json({ subscribed: row.status === "active", status: row.status, orderUpdatesOptIn: row.orderUpdatesOptIn, marketingOptIn: row.marketingOptIn });
});

router.patch("/public/push/subscription", async (req, res) => {
  const { endpoint, orderUpdatesOptIn, marketingOptIn } = req.body as { endpoint?: string; orderUpdatesOptIn?: boolean; marketingOptIn?: boolean };
  if (!endpoint) return void res.status(400).json({ error: "endpoint required" });
  const row = await updateSubscriptionPrefs(endpoint, { orderUpdatesOptIn, marketingOptIn });
  if (!row) return void res.status(404).json({ error: "subscription not found" });
  res.json({ success: true, orderUpdatesOptIn: row.orderUpdatesOptIn, marketingOptIn: row.marketingOptIn });
});

// Click-tracking redirect used by the service worker's notificationclick handler.
router.get("/public/push/click/:logId", async (req, res) => {
  const logId = Number(req.params.logId);
  const fallback = typeof req.query.u === "string" ? req.query.u : "/";
  if (logId) { try { await markLogClicked(logId); } catch { /* ignore */ } }
  res.redirect(fallback);
});

router.post("/public/push/unsubscribe", async (req, res) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint || typeof endpoint !== "string") {
    return void res.status(400).json({ error: "endpoint required" });
  }
  await deleteWebPushSubscription(endpoint);
  res.json({ success: true });
});

router.get("/public/site/:slug", async (req, res) => {
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.slug, req.params.slug));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  const settingsRows = await db.select().from(restaurantSettingsTable)
    .where(and(
      eq(restaurantSettingsTable.restaurantId, restaurant.id),
      inArray(restaurantSettingsTable.section, ["customer-site", "about-us", "reservation", "open-close"]),
    ));
  const sections: Record<string, Record<string, unknown>> = {};
  for (const r of settingsRows) sections[r.section] = (r.data as Record<string, unknown>) ?? {};

  const site = sections["customer-site"] ?? {};
  const about = sections["about-us"] ?? {};
  const reservation = sections["reservation"] ?? {};

  if (site.enabled !== true) {
    return void res.status(404).json({
      error: "Public site is not enabled for this restaurant",
      code: "site_not_published",
      restaurantName: restaurant.name,
    });
  }

  const safeUrl = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t) return null;
    if (!/^https?:\/\//i.test(t)) return null;
    return t;
  };
  const safeImageOrObject = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    if (t.startsWith("/objects/")) return t;
    return null;
  };
  const safeSocials = {
    instagram: safeUrl((site.socials as Record<string, unknown> | undefined)?.instagram),
    facebook: safeUrl((site.socials as Record<string, unknown> | undefined)?.facebook),
    twitter: safeUrl((site.socials as Record<string, unknown> | undefined)?.twitter),
    youtube: safeUrl((site.socials as Record<string, unknown> | undefined)?.youtube),
    tiktok: safeUrl((site.socials as Record<string, unknown> | undefined)?.tiktok),
  };
  const safeMap = safeUrl(site.mapEmbedUrl);
  const safeOg = safeImageOrObject(site.ogImageUrl);
  const safeAccent = typeof site.accentColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(site.accentColor) ? site.accentColor : "#c2410c";

  type PublicMenuItem = {
    id: number; name: string; description: string | null;
    price: string; imageUrl: string | null;
    isVeg: boolean; isVegan: boolean; containsGluten: boolean | null;
    tags: string[]; allergens: string[];
  };
  function normalizeMenuItem(row: {
    id: number; name: string; description: string | null;
    price: string; imageUrl: string | null;
    isVeg: boolean | null; isVegan: boolean | null; containsGluten: boolean | null;
    tags: string[] | null; allergens: string[] | null;
  }): PublicMenuItem {
    return {
      id: row.id, name: row.name, description: row.description,
      price: row.price, imageUrl: row.imageUrl,
      isVeg: row.isVeg === true,
      isVegan: row.isVegan === true,
      containsGluten: row.containsGluten,
      tags: Array.isArray(row.tags) ? row.tags.filter(t => typeof t === "string") : [],
      allergens: Array.isArray(row.allergens) ? row.allergens.filter(a => typeof a === "string") : [],
    };
  }
  // Merge all active menus (see /public/menu/:slug for rationale).
  const activeMenusForSite = await db.select({ id: menusTable.id }).from(menusTable).where(and(eq(menusTable.restaurantId, restaurant.id), eq(menusTable.isActive, true))).orderBy(menusTable.id);
  const menu = activeMenusForSite[0];
  let categories: Array<{ id: number; name: string; items: PublicMenuItem[] }> = [];
  let featured: PublicMenuItem[] = [];
  if (menu) {
    const cats = await db.select().from(menuCategoriesTable).where(and(
      inArray(menuCategoriesTable.menuId, activeMenusForSite.map(m => m.id)),
      eq(menuCategoriesTable.isActive, true),
    ));
    const itemCols = {
      id: menuItemsTable.id, name: menuItemsTable.name, description: menuItemsTable.description,
      price: menuItemsTable.price, imageUrl: menuItemsTable.imageUrl,
      isVeg: menuItemsTable.isVeg, isVegan: menuItemsTable.isVegan,
      containsGluten: menuItemsTable.containsGluten,
      tags: menuItemsTable.tags, allergens: menuItemsTable.allergens,
    } as const;
    const allCats = await Promise.all(cats.map(async (c) => {
      const items = await db.select(itemCols).from(menuItemsTable)
        .where(and(eq(menuItemsTable.categoryId, c.id), eq(menuItemsTable.isAvailable, true)));
      return { id: c.id, name: c.name, items: items.map(normalizeMenuItem) };
    }));
    // Hide empty categories on the diner-facing site (same rationale as
    // /public/menu/:slug). Owners still see them in the admin editor.
    categories = allCats.filter(c => c.items.length > 0);
    const featuredIds = Array.isArray(site.featuredItemIds) ? (site.featuredItemIds as unknown[]).map(Number).filter(n => Number.isFinite(n)) : [];
    if (featuredIds.length > 0) {
      const rows = await db.select(itemCols).from(menuItemsTable)
        .where(and(eq(menuItemsTable.restaurantId, restaurant.id), inArray(menuItemsTable.id, featuredIds), eq(menuItemsTable.isAvailable, true)));
      featured = rows.map(normalizeMenuItem);
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

  const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  type DayKey = typeof DAY_KEYS[number];
  type HoursEntry = { open: string; close: string; closed: boolean; breakOpen?: string; breakClose?: string };
  const LONG_DAY_NAMES: Record<DayKey, string> = {
    sun: "sunday", mon: "monday", tue: "tuesday", wed: "wednesday",
    thu: "thursday", fri: "friday", sat: "saturday",
  };
  // openClose section is where the wizard stores hours; older deployments
  // may have used the reservation section. Support both.
  const openCloseSettings = sections["open-close"] ?? {};
  const rawHoursA = (openCloseSettings.hours && typeof openCloseSettings.hours === "object")
    ? openCloseSettings.hours as Record<string, unknown> : null;
  const rawHoursB = (reservation.hours && typeof reservation.hours === "object")
    ? reservation.hours as Record<string, unknown> : null;
  function readHoursEntry(short: DayKey): HoursEntry {
    const long = LONG_DAY_NAMES[short];
    const raw = rawHoursA?.[long] ?? rawHoursA?.[short] ?? rawHoursB?.[long] ?? rawHoursB?.[short];
    if (!raw || typeof raw !== "object") return { open: "", close: "", closed: true };
    const o = raw as Record<string, unknown>;
    // Legacy shape: { open: boolean, from, to, breakFrom?, breakTo? }
    if (typeof o.open === "boolean") {
      return {
        open: typeof o.from === "string" ? o.from : "",
        close: typeof o.to === "string" ? o.to : "",
        closed: o.open !== true,
        breakOpen: typeof o.breakFrom === "string" && o.breakFrom ? o.breakFrom : undefined,
        breakClose: typeof o.breakTo === "string" && o.breakTo ? o.breakTo : undefined,
      };
    }
    // New shape: { open: string, close: string, closed: boolean, breakOpen?, breakClose? }
    return {
      open: typeof o.open === "string" ? o.open : "",
      close: typeof o.close === "string" ? o.close : "",
      closed: o.closed === true,
      breakOpen: typeof o.breakOpen === "string" && o.breakOpen ? o.breakOpen : (typeof o.breakFrom === "string" && o.breakFrom ? o.breakFrom : undefined),
      breakClose: typeof o.breakClose === "string" && o.breakClose ? o.breakClose : (typeof o.breakTo === "string" && o.breakTo ? o.breakTo : undefined),
    };
  }
  const normalizedHours: Record<DayKey, HoursEntry> = DAY_KEYS.reduce((acc, d) => {
    acc[d] = readHoursEntry(d);
    return acc;
  }, {} as Record<DayKey, HoursEntry>);

  const timezone = typeof restaurant.timezone === "string" && restaurant.timezone ? restaurant.timezone : "UTC";
  let openStatus: { isOpen: boolean; today: HoursEntry; weekday: DayKey } = {
    isOpen: false, today: { open: "", close: "", closed: true }, weekday: "sun",
  };
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const wd = (parts.find(p => p.type === "weekday")?.value ?? "Sun").toLowerCase().slice(0, 3) as DayKey;
    const hh = parts.find(p => p.type === "hour")?.value ?? "00";
    const mm = parts.find(p => p.type === "minute")?.value ?? "00";
    const nowMin = parseInt(hh, 10) * 60 + parseInt(mm, 10);
    const today = normalizedHours[wd];
    const toMin = (s: string) => {
      const m = /^(\d{1,2}):(\d{2})/.exec(s);
      return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : -1;
    };
    const o = toMin(today.open);
    const c = toMin(today.close);
    const bo = today.breakOpen ? toMin(today.breakOpen) : -1;
    const bc = today.breakClose ? toMin(today.breakClose) : -1;
    const inMainWindow = o >= 0 && c >= 0
      && (c > o ? nowMin >= o && nowMin < c : nowMin >= o || nowMin < c);
    const inBreak = bo >= 0 && bc >= 0 && nowMin >= bo && nowMin < bc;
    const isOpen = !today.closed && inMainWindow && !inBreak;
    openStatus = { isOpen, today, weekday: wd };
  } catch { /* keep default */ }

  const orderingCheck = await checkRestaurantFeature(restaurant.id, "online_ordering");
  const orderingEnabled = orderingCheck.ok === true && menu !== undefined;

  const testimonialsSafe = Array.isArray(site.testimonials)
    ? (site.testimonials as unknown[]).flatMap(t => {
        if (!t || typeof t !== "object") return [];
        const o = t as Record<string, unknown>;
        const name = typeof o.name === "string" ? o.name.trim() : "";
        const quote = typeof o.quote === "string" ? o.quote.trim() : "";
        if (!name || !quote) return [];
        const ratingN = Number(o.rating);
        return [{
          name, quote,
          rating: Number.isFinite(ratingN) ? Math.min(5, Math.max(1, Math.round(ratingN))) : 5,
          avatarUrl: typeof o.avatarUrl === "string" ? o.avatarUrl : "",
        }];
      })
    : [];

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
      timezone,
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
      ctaPrimaryLabel: typeof site.ctaPrimaryLabel === "string" ? site.ctaPrimaryLabel : "",
      ctaSecondaryLabel: typeof site.ctaSecondaryLabel === "string" ? site.ctaSecondaryLabel : "",
      ctaReserveLabel: typeof site.ctaReserveLabel === "string" ? site.ctaReserveLabel : "",
      showOpenClosedPill: site.showOpenClosedPill !== false,
      testimonials: testimonialsSafe,
      analyticsGa4: typeof site.analyticsGa4 === "string" ? site.analyticsGa4 : "",
      analyticsFbPixel: typeof site.analyticsFbPixel === "string" ? site.analyticsFbPixel : "",
      orderingEnabled,
    },
    about: aboutSafe,
    hours: normalizedHours,
    openStatus,
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

  const featureOk = await checkRestaurantFeature(restaurant.id, "reservations");
  if (!featureOk.ok) return void res.status(featureOk.status).json({ error: featureOk.error });

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
  try {
    const { pushToStaff } = await import("../lib/pushNotify");
    await pushToStaff(
      { restaurantId: restaurant.id, roles: ["manager", "owner"], type: "reservation_request" },
      {
        title: "New reservation request",
        body: `${guestName.trim()} · party of ${ps} · ${dt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`,
        data: { reservationId: reservation.id, type: "reservation_request" },
      },
    );
  } catch (err) {
    logger.error?.({ err, reservationId: reservation.id }, "reservation push failed");
  }

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

  // For phone lookups, accept both the canonical "+<dial> <national>" form
  // (which the UI now submits via PhoneInput) and any legacy raw value the
  // caller might still have on file. We also fall back to normalizing the
  // input so a guest who types "+91 9876543210" can find a customer that
  // was saved as "9876543210" (and vice-versa).
  const phoneLookupCandidates = hasPhone
    ? Array.from(new Set([
        phoneTrim,
        normalizePhone(phoneTrim, null) ?? "",
      ].filter(Boolean)))
    : [];
  const identityFilter = hasPhone
    ? inArray(customersTable.phone, phoneLookupCandidates)
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
      try {
        const { pushToStaff } = await import("../lib/pushNotify");
        await pushToStaff(
          { restaurantId: qr.restaurantId, roles: ["manager", "owner"], type: rating <= 2 ? "negative_feedback" : "feedback" },
          {
            title: `New ${rating}★ feedback`,
            body: (comment || tags.join(", ") || "Customer left private feedback").slice(0, 200),
            data: { feedbackId: fb.id, type: "feedback", rating },
          },
        );
      } catch (err) {
        logger.error?.({ err, feedbackId: fb.id }, "feedback push failed");
      }
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
  const sessionToken = typeof b.sessionToken === "string" ? b.sessionToken.slice(0, 80) : "";
  const isPositive = rating >= qr.positiveThreshold;
  const category = typeof b.category === "string" ? b.category.slice(0, 80) : null;
  const comment = typeof b.comment === "string" ? b.comment.slice(0, 4000) : null;
  const customerName = typeof b.customerName === "string" ? b.customerName.slice(0, 200) : null;
  const customerPhone = typeof b.customerPhone === "string" ? b.customerPhone.slice(0, 50) : null;

  // Upsert by sessionToken when provided so /rate + /feedback for the same
  // scan session updates the same row instead of creating duplicates.
  let fb: typeof customerFeedbackTable.$inferSelect | null = null;
  if (sessionToken) {
    const updated = await db.update(customerFeedbackTable).set({
      rating, category, comment, customerName, customerPhone, selectedTags: tags,
    }).where(and(eq(customerFeedbackTable.qrId, qr.id), eq(customerFeedbackTable.sessionToken, sessionToken))).returning();
    if (updated.length > 0) fb = updated[0]!;
  }
  if (!fb) {
    const [created] = await db.insert(customerFeedbackTable).values({
      restaurantId: qr.restaurantId,
      branchId: qr.branchId,
      qrId: qr.id,
      rating,
      category,
      comment,
      customerName,
      customerPhone,
      selectedTags: tags,
      sessionToken: sessionToken || null,
      source: "qr",
    }).returning();
    fb = created!;
  }

  if (!isPositive) {
    // Only log the "submitted_negative" event and spin up a recovery task for
    // low ratings — positives going via this endpoint (AI off path) shouldn't
    // ping managers as if it were a complaint.
    await db.insert(reviewQrScansTable).values({
      qrId: qr.id, restaurantId: qr.restaurantId, event: "submitted_negative", rating,
      metadata: { feedbackId: fb.id },
    });
    const [existingTask] = await db.select({ id: feedbackRecoveryTasksTable.id })
      .from(feedbackRecoveryTasksTable)
      .where(eq(feedbackRecoveryTasksTable.feedbackId, fb.id));
    if (!existingTask) {
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
        message: ((fb.comment ?? tags.join(", ")) || "Customer left private feedback").slice(0, 200),
      });
      broadcastEvent(qr.restaurantId, "notification:new", { type: "feedback", id: fb.id });
      try {
        const { pushToStaff } = await import("../lib/pushNotify");
        await pushToStaff(
          { restaurantId: qr.restaurantId, roles: ["manager", "owner"], type: rating <= 2 ? "negative_feedback" : "feedback" },
          {
            title: `New ${rating}★ feedback`,
            body: ((fb.comment ?? tags.join(", ")) || "Customer left private feedback").slice(0, 200),
            data: { feedbackId: fb.id, type: "feedback", rating },
          },
        );
      } catch (err) {
        logger.error?.({ err, feedbackId: fb.id }, "feedback push failed");
      }
    }
  }
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
      comment: fb?.comment ?? ex?.body ?? null,
      authorName: safeName,
      externalUrl: null,
      occurredAt: fb?.createdAt ?? ex?.postedAt ?? item.createdAt,
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
        comment: fb?.comment ?? ex?.body ?? null,
        authorName: safeName,
        restaurantName: item.restaurantName,
        restaurantSlug: item.restaurantSlug,
        restaurantLogo: item.restaurantLogo,
        externalUrl: null,
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

// ============================================================
// Public takeaway queue & pre-order booking
//
// These endpoints let walk-in customers join the takeaway waitlist or book
// a pre-order slot from a QR-code landing page without logging in. They are
// rate-limited implicitly by the upstream proxy and only expose minimal
// information back (no PII other than what the customer just supplied).
// ============================================================
router.post("/public/restaurants/:restaurantId/queue/tickets", async (req, res) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    if (!Number.isFinite(restaurantId)) { res.status(400).json({ error: "Invalid restaurantId" }); return; }
    const gate = await checkRestaurantFeature(restaurantId, "dlv_queue_manager");
    if (!gate.ok) { res.status(gate.status).json({ error: gate.error }); return; }
    const { customerName, phone, partySize, notes } = req.body ?? {};
    if (!customerName || !phone) { res.status(400).json({ error: "customerName and phone required" }); return; }
    const { takeawayQueueTicketsTable } = await import("@workspace/db");
    // Atomic per-day ticket-number allocation: a transactional advisory
    // lock keyed by (restaurantId, day-of-year) serialises concurrent
    // self-joins so two phones cannot grab the same number.
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${restaurantId}, EXTRACT(DOY FROM CURRENT_DATE)::int)`);
      const [maxRow] = await tx.select({ m: sql<number>`COALESCE(MAX(${takeawayQueueTicketsTable.ticketNumber}), 0)` })
        .from(takeawayQueueTicketsTable)
        .where(and(eq(takeawayQueueTicketsTable.restaurantId, restaurantId), sql`DATE(${takeawayQueueTicketsTable.createdAt}) = CURRENT_DATE`));
      const nextNumber = Number(maxRow?.m ?? 0) + 1;
      const [inserted] = await tx.insert(takeawayQueueTicketsTable).values({
        restaurantId, ticketNumber: nextNumber, customerName: String(customerName).slice(0, 80),
        phone: String(phone).slice(0, 20), partySize: Number(partySize ?? 1),
        status: "waiting",
        notes: `[QR self-join] ${notes ? String(notes).slice(0, 180) : ""}`.trim(),
      }).returning();
      return inserted;
    });
    const [ahead] = await db.select({ count: sql<number>`COUNT(*)::int` })
      .from(takeawayQueueTicketsTable)
      .where(and(eq(takeawayQueueTicketsTable.restaurantId, restaurantId), eq(takeawayQueueTicketsTable.status, "waiting"), sql`${takeawayQueueTicketsTable.id} < ${row.id}`));
    await recordAuditLog({
      req, module: "dlv_queue_manager", action: "queue.ticket.create_public",
      entity: "takeaway_queue_ticket", entityId: row.id, restaurantId,
      userDisplay: `public:${String(phone).slice(-4)}`,
      newValue: { ticketNumber: row.ticketNumber, partySize: row.partySize, source: "public_qr" },
    });
    res.status(201).json({ ticketNumber: row.ticketNumber, status: row.status, partySize: row.partySize, peopleAhead: Number(ahead?.count ?? 0), createdAt: row.createdAt });
  } catch (err) {
    logger.error({ err }, "public queue ticket failed");
    res.status(500).json({ error: "Failed to join queue" });
  }
});

router.get("/public/restaurants/:restaurantId/queue/tickets/:ticketNumber", async (req, res) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const ticketNumber = Number(req.params.ticketNumber);
    const { takeawayQueueTicketsTable } = await import("@workspace/db");
    const [row] = await db.select().from(takeawayQueueTicketsTable)
      .where(and(eq(takeawayQueueTicketsTable.restaurantId, restaurantId), eq(takeawayQueueTicketsTable.ticketNumber, ticketNumber)))
      .orderBy(desc(takeawayQueueTicketsTable.id)).limit(1);
    if (!row) { res.status(404).json({ error: "Ticket not found" }); return; }
    const [ahead] = await db.select({ count: sql<number>`COUNT(*)::int` })
      .from(takeawayQueueTicketsTable)
      .where(and(eq(takeawayQueueTicketsTable.restaurantId, restaurantId), eq(takeawayQueueTicketsTable.status, "waiting"), sql`${takeawayQueueTicketsTable.id} < ${row.id}`));
    res.json({ ticketNumber: row.ticketNumber, status: row.status, partySize: row.partySize, peopleAhead: row.status === "waiting" ? Number(ahead?.count ?? 0) : 0, notifiedAt: row.notifiedAt, fulfilledAt: row.fulfilledAt, cancelledAt: row.cancelledAt });
  } catch (err) {
    logger.error({ err }, "public queue ticket lookup failed");
    res.status(500).json({ error: "Failed to look up ticket" });
  }
});

router.get("/public/restaurants/:restaurantId/preorder/slots", async (req, res) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const gate = await checkRestaurantFeature(restaurantId, "ops_preorder_booking");
    if (!gate.ok) { res.status(gate.status).json({ error: gate.error }); return; }
    const { preorderSlotsTable, preorderBookingsTable } = await import("@workspace/db");
    const fromDate = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);
    const rows = await db.select({
      id: preorderSlotsTable.id, slotDate: preorderSlotsTable.slotDate,
      startMinutes: preorderSlotsTable.startMinutes, endMinutes: preorderSlotsTable.endMinutes,
      capacity: preorderSlotsTable.capacity,
      booked: sql<number>`COALESCE((SELECT COUNT(*)::int FROM ${preorderBookingsTable} pb WHERE pb.slot_id = ${preorderSlotsTable.id} AND pb.status <> 'cancelled'), 0)`,
    }).from(preorderSlotsTable)
      .where(and(eq(preorderSlotsTable.restaurantId, restaurantId), gte(preorderSlotsTable.slotDate, fromDate), eq(preorderSlotsTable.isActive, true)))
      .orderBy(preorderSlotsTable.slotDate, preorderSlotsTable.startMinutes).limit(50);
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    res.json({ slots: rows.map((s) => ({ id: s.id, slotDate: s.slotDate, startTime: fmt(s.startMinutes), endTime: fmt(s.endMinutes), capacity: s.capacity, booked: Number(s.booked), available: Math.max(0, s.capacity - Number(s.booked)) })) });
  } catch (err) {
    logger.error({ err }, "public preorder slots failed");
    res.status(500).json({ error: "Failed to load slots" });
  }
});

router.post("/public/restaurants/:restaurantId/preorder/bookings", async (req, res) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const gate = await checkRestaurantFeature(restaurantId, "ops_preorder_booking");
    if (!gate.ok) { res.status(gate.status).json({ error: gate.error }); return; }
    const { slotId, customerName, phone, partySize, items } = req.body ?? {};
    if (!slotId || !customerName || !phone) { res.status(400).json({ error: "slotId, customerName, phone required" }); return; }
    const { preorderSlotsTable, preorderBookingsTable } = await import("@workspace/db");
    const notesPayload = [
      `Party of ${Number(partySize ?? 1)}`,
      items ? `Items: ${typeof items === "string" ? items.slice(0, 200) : JSON.stringify(items).slice(0, 200)}` : null,
      "[QR self-book]",
    ].filter(Boolean).join(" • ");
    // Atomic capacity check: lock the slot row inside a transaction and
    // count active (non-cancelled) bookings while holding the lock so two
    // concurrent QR self-bookings can never oversell the slot.
    type Outcome =
      | { kind: "missing" }
      | { kind: "full" }
      | { kind: "ok"; row: typeof preorderBookingsTable.$inferSelect; slotDate: string; startMinutes: number };
    const outcome: Outcome = await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id, capacity, slot_date AS "slotDate", start_minutes AS "startMinutes"
            FROM ${preorderSlotsTable}
            WHERE id = ${Number(slotId)} AND restaurant_id = ${restaurantId} AND is_active = true
            FOR UPDATE`,
      );
      const rows = (locked as unknown as { rows?: Array<{ id: number; capacity: number; slotDate: string; startMinutes: number }> }).rows
        ?? (locked as unknown as Array<{ id: number; capacity: number; slotDate: string; startMinutes: number }>);
      const slotRow = Array.isArray(rows) ? rows[0] : undefined;
      if (!slotRow) return { kind: "missing" };
      const [{ c }] = await tx.select({ c: sql<number>`COUNT(*)::int` }).from(preorderBookingsTable)
        .where(and(eq(preorderBookingsTable.slotId, slotRow.id), sql`${preorderBookingsTable.status} <> 'cancelled'`));
      if (Number(c) >= slotRow.capacity) return { kind: "full" };
      const [inserted] = await tx.insert(preorderBookingsTable).values({
        restaurantId, slotId: slotRow.id, customerName: String(customerName).slice(0, 80),
        phone: String(phone).slice(0, 20), status: "confirmed", notes: notesPayload,
      }).returning();
      return { kind: "ok", row: inserted, slotDate: slotRow.slotDate, startMinutes: slotRow.startMinutes };
    });
    if (outcome.kind === "missing") { res.status(404).json({ error: "Slot not available" }); return; }
    if (outcome.kind === "full") { res.status(409).json({ error: "Slot is fully booked" }); return; }
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    await recordAuditLog({
      req, module: "ops_preorder_booking", action: "preorder.booking.create_public",
      entity: "preorder_booking", entityId: outcome.row.id, restaurantId,
      userDisplay: `public:${String(phone).slice(-4)}`,
      newValue: { slotId: outcome.row.slotId, slotDate: outcome.slotDate, startMinutes: outcome.startMinutes, partySize: Number(partySize ?? 1), source: "public_qr" },
    });
    res.status(201).json({ bookingId: outcome.row.id, status: outcome.row.status, slotDate: outcome.slotDate, startTime: fmt(outcome.startMinutes) });
  } catch (err) {
    logger.error({ err }, "public preorder booking failed");
    res.status(500).json({ error: "Failed to create booking" });
  }
});

export default router;
