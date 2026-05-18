/**
 * White-Label Customer App
 *
 * Builder backend for the branded customer ordering & loyalty app. Branding
 * (logo, colours, hero, about, contact, gallery, review widget, app-exclusive
 * coupons, custom domain placeholder, push campaign placeholders, SEO meta)
 * is stored in the `customer-app` section of `restaurant_settings` via the
 * standard settings router. This file adds the publish/unpublish lifecycle
 * (separate audited actions) and the public read endpoint that the rendered
 * customer-app shell consumes.
 *
 * Out of scope: real DNS/SSL provisioning, native iOS/Android builds and
 * actual push notification delivery — DNS instructions and a campaign queue
 * are surfaced as placeholders.
 */
import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  restaurantSettingsTable,
  restaurantsTable,
  menusTable,
  menuCategoriesTable,
  menuItemsTable,
  couponsTable,
  tenantsTable,
  subscriptionPlansTable,
  isFeatureEnabled,
} from "../lib/db";
import { loadLoyaltyConfig } from "../lib/loyalty";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { recordAuditLog } from "../lib/audit";

const router = Router();
const publicRouter = Router();

const SECTION = "customer-app";

router.use(
  "/restaurants/:restaurantId/customer-app",
  requireRole("owner", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("customer_app"),
);

async function readSection(restaurantId: number): Promise<Record<string, unknown>> {
  const [row] = await db.select().from(restaurantSettingsTable).where(and(
    eq(restaurantSettingsTable.restaurantId, restaurantId),
    eq(restaurantSettingsTable.section, SECTION),
  ));
  return (row?.data as Record<string, unknown> | undefined) ?? {};
}

async function writeSection(restaurantId: number, data: Record<string, unknown>, userId: number | undefined) {
  const [row] = await db
    .insert(restaurantSettingsTable)
    .values({ restaurantId, section: SECTION, data, updatedBy: userId })
    .onConflictDoUpdate({
      target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
      set: { data, updatedBy: userId, updatedAt: new Date() },
    })
    .returning();
  return row;
}

router.post("/restaurants/:restaurantId/customer-app/publish", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const previous = await readSection(restaurantId);
  const now = new Date().toISOString();
  const next = {
    ...previous,
    published: true,
    publishedAt: now,
    publishedBy: req.user?.sub ?? null,
  };
  await writeSection(restaurantId, next, req.user?.sub);
  await recordAuditLog({
    req,
    module: "customer_app",
    action: "published",
    entity: "customer_app",
    entityId: restaurantId,
    restaurantId,
    targetRestaurantId: restaurantId,
    oldValue: { published: previous.published === true, publishedAt: previous.publishedAt ?? null },
    newValue: { published: true, publishedAt: now },
  });
  res.json({ section: SECTION, data: next });
});

router.post("/restaurants/:restaurantId/customer-app/unpublish", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const previous = await readSection(restaurantId);
  const now = new Date().toISOString();
  const next = {
    ...previous,
    published: false,
    unpublishedAt: now,
  };
  await writeSection(restaurantId, next, req.user?.sub);
  await recordAuditLog({
    req,
    module: "customer_app",
    action: "unpublished",
    entity: "customer_app",
    entityId: restaurantId,
    restaurantId,
    targetRestaurantId: restaurantId,
    oldValue: { published: previous.published === true },
    newValue: { published: false, unpublishedAt: now },
  });
  res.json({ section: SECTION, data: next });
});

/**
 * Public read endpoint for the rendered customer-app shell. Returns branding
 * config (only the published fields), the live menu, the loyalty program
 * summary, and the curated list of app-exclusive coupons resolved against
 * the coupon catalogue. Returns 404 with `code: app_not_published` when the
 * owner has not published yet so the shell can render a friendly notice.
 */
publicRouter.get("/public/customer-app/:slug", async (req, res) => {
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.slug, req.params.slug));
  if (!restaurant) return void res.status(404).json({ error: "Restaurant not found" });

  const [row] = await db.select().from(restaurantSettingsTable).where(and(
    eq(restaurantSettingsTable.restaurantId, restaurant.id),
    eq(restaurantSettingsTable.section, SECTION),
  ));
  const cfg = (row?.data as Record<string, unknown> | undefined) ?? {};
  if (cfg.published !== true) {
    return void res.status(404).json({
      error: "Customer app is not published yet",
      code: "app_not_published",
      restaurantName: restaurant.name,
    });
  }

  // Runtime plan gate — keep the public shell in sync with entitlements so a
  // downgrade or suspension immediately takes the app offline without
  // requiring the owner to re-unpublish.
  const [tenant] = await db
    .select({ planId: tenantsTable.planId, isSuspended: tenantsTable.isSuspended })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, restaurant.tenantId));
  if (!tenant || tenant.isSuspended) {
    return void res.status(404).json({ error: "Customer app is not available", code: "app_not_available" });
  }
  if (tenant.planId) {
    const [plan] = await db
      .select({ featureFlags: subscriptionPlansTable.featureFlags })
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.id, tenant.planId));
    if (plan && !isFeatureEnabled(plan.featureFlags, "customer_app")) {
      return void res.status(404).json({ error: "Customer app is not available on this plan", code: "app_not_available" });
    }
  }

  // Menu — reuse the same shape as /public/site so the shell can reuse cards.
  const [menu] = await db.select().from(menusTable)
    .where(and(eq(menusTable.restaurantId, restaurant.id), eq(menusTable.isActive, true)));
  let categories: Array<{ id: number; name: string; items: Array<{
    id: number; name: string; description: string | null; price: string; imageUrl: string | null;
    isVeg: boolean; isVegan: boolean; tags: string[];
  }> }> = [];
  if (menu) {
    const cats = await db.select().from(menuCategoriesTable)
      .where(and(eq(menuCategoriesTable.menuId, menu.id), eq(menuCategoriesTable.isActive, true)));
    categories = await Promise.all(cats.map(async (c) => {
      const items = await db.select({
        id: menuItemsTable.id, name: menuItemsTable.name, description: menuItemsTable.description,
        price: menuItemsTable.price, imageUrl: menuItemsTable.imageUrl,
        isVeg: menuItemsTable.isVeg, isVegan: menuItemsTable.isVegan, tags: menuItemsTable.tags,
      }).from(menuItemsTable)
        .where(and(eq(menuItemsTable.categoryId, c.id), eq(menuItemsTable.isAvailable, true)));
      return {
        id: c.id, name: c.name,
        items: items.map(it => ({
          id: it.id, name: it.name, description: it.description, price: it.price, imageUrl: it.imageUrl,
          isVeg: it.isVeg === true, isVegan: it.isVegan === true,
          tags: Array.isArray(it.tags) ? it.tags.filter(t => typeof t === "string") : [],
        })),
      };
    }));
  }

  // App-exclusive coupons — config stores an array of coupon codes; resolve
  // them against the coupon catalogue and only surface active ones.
  const codes = Array.isArray(cfg.couponCodes)
    ? (cfg.couponCodes as unknown[]).filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : [];
  let coupons: Array<{ code: string; description: string | null; discountType: string; discountValue: string }> = [];
  if (codes.length > 0) {
    const rows = await db.select({
      code: couponsTable.code,
      discountType: couponsTable.discountType, discountValue: couponsTable.discountValue,
      isActive: couponsTable.isActive,
    }).from(couponsTable).where(and(
      eq(couponsTable.restaurantId, restaurant.id),
      inArray(couponsTable.code, codes),
    ));
    coupons = rows.filter(r => r.isActive).map(r => ({
      code: r.code, description: null,
      discountType: r.discountType, discountValue: r.discountValue,
    }));
  }

  // Loyalty wallet — surface the active program summary so the app can show
  // points/tiers signposts. The full wallet API is reached via the same
  // public loyalty endpoints used by the QR menu, so we only echo program
  // metadata here.
  const program = await loadLoyaltyConfig(restaurant.id);

  const safeUrl = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    if (t.startsWith("/objects/")) return t;
    return null;
  };
  // Strict allowlist for outbound user-controlled links (rendered as <a href>
  // in the public app shell). Reject javascript:, data:, and other schemes.
  const safeOutboundUrl = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t || !/^https?:\/\//i.test(t)) return null;
    try {
      const u = new URL(t);
      return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
    } catch {
      return null;
    }
  };
  const gallery = Array.isArray(cfg.gallery)
    ? (cfg.gallery as unknown[]).map(safeUrl).filter((x): x is string => !!x)
    : [];

  res.json({
    restaurant: {
      id: restaurant.id, name: restaurant.name, slug: restaurant.slug,
      logoUrl: restaurant.logoUrl, currency: restaurant.currency,
      address: restaurant.address, phone: restaurant.phone, email: restaurant.email,
    },
    branding: {
      appName: typeof cfg.appName === "string" ? cfg.appName : restaurant.name,
      tagline: typeof cfg.tagline === "string" ? cfg.tagline : "",
      logoUrl: safeUrl(cfg.logoUrl) ?? restaurant.logoUrl,
      primaryColor: typeof cfg.primaryColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(cfg.primaryColor) ? cfg.primaryColor : "#c2410c",
      accentColor: typeof cfg.accentColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(cfg.accentColor) ? cfg.accentColor : "#f59e0b",
      heroImageUrl: safeUrl(cfg.heroImageUrl),
      heroHeadline: typeof cfg.heroHeadline === "string" ? cfg.heroHeadline : `Welcome to ${restaurant.name}`,
      heroSubcopy: typeof cfg.heroSubcopy === "string" ? cfg.heroSubcopy : "Order, earn loyalty points and discover what's new.",
      aboutTitle: typeof cfg.aboutTitle === "string" ? cfg.aboutTitle : "About Us",
      aboutBody: typeof cfg.aboutBody === "string" ? cfg.aboutBody : "",
      contactPhone: typeof cfg.contactPhone === "string" ? cfg.contactPhone : restaurant.phone,
      contactEmail: typeof cfg.contactEmail === "string" ? cfg.contactEmail : restaurant.email,
      contactAddress: typeof cfg.contactAddress === "string" ? cfg.contactAddress : restaurant.address,
      gallery,
      reviewWidget: {
        enabled: cfg.reviewWidgetEnabled === true,
        googleReviewLink: safeOutboundUrl(cfg.googleReviewLink),
      },
      seo: {
        title: typeof cfg.seoTitle === "string" ? cfg.seoTitle : `${restaurant.name} — Order Online`,
        description: typeof cfg.seoDescription === "string" ? cfg.seoDescription : `Order from ${restaurant.name} — fresh menu, loyalty rewards and app-exclusive offers.`,
        ogImageUrl: safeUrl(cfg.ogImageUrl) ?? safeUrl(cfg.heroImageUrl) ?? null,
      },
      customDomain: typeof cfg.customDomain === "string" ? cfg.customDomain : null,
    },
    menu: { categories },
    coupons,
    loyalty: program.enabled
      ? { enabled: true, pointsPerCurrencyUnit: program.pointsPerCurrencyUnit, redemptionRate: program.redemptionRate, tiers: program.tiers }
      : { enabled: false },
    publishedAt: typeof cfg.publishedAt === "string" ? cfg.publishedAt : null,
  });
});

export default router;
export { publicRouter as customerAppPublicRouter };
