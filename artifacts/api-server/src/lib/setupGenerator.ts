/**
 * AI Setup Wizard generator. Takes the wizard answers (restaurant type,
 * cuisines, outlets, payment/tax preferences), asks Khana AI for a starter
 * pack (categories, QR menu style preset, pinned reports), and applies it
 * to the restaurant's tables in a single transaction. Used by the
 * setup-wizard router on "go live".
 */
import { eq, and } from "drizzle-orm";
import {
  db,
  restaurantsTable,
  branchesTable,
  menusTable,
  menuCategoriesTable,
  menuItemsTable,
  aiMenuImportsTable,
  aiMenuImportItemsTable,
  restaurantSettingsTable,
} from "./db";
import { AIProviderService } from "./aiProviderService";
import {
  reserveCredits,
  commitReservation,
  refundReservation,
  type AiCreditReservation,
} from "./aiCredits";
import { logger } from "./logger";

export interface WizardOutlet {
  name: string;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
}

export interface WizardAnswers {
  restaurantType?: string;
  cuisines?: string[];
  outlets?: WizardOutlet[];
  menuImportId?: number | null;
  googleReviewLink?: string | null;
  paymentMethods?: string[];
  paymentGateway?: string | null;
  taxCountry?: string;
  taxRate?: number;
  serviceCharge?: number;
}

export interface WizardSummary {
  categoriesCreated: number;
  branchesCreated: number;
  itemsImported: number;
  taxApplied: number | null;
  paymentMethods: string[];
  qrMenuStyle: string | null;
  pinnedReports: string[];
  googleReviewLink: string | null;
  menuImportId: number | null;
  menuImportStatus: string | null;
}

interface AiPlan {
  categories: { name: string; description?: string }[];
  qrMenuStyle: { preset: string; primaryColor?: string; theme?: string };
  pinnedReports: string[];
  taxRate?: number;
  paymentMethods?: string[];
}

const FALLBACK_PLAN: AiPlan = {
  categories: [
    { name: "Starters" },
    { name: "Mains" },
    { name: "Beverages" },
    { name: "Desserts" },
  ],
  qrMenuStyle: { preset: "modern", primaryColor: "#E11D48", theme: "light" },
  pinnedReports: ["sales", "items", "payments"],
};

async function callKhanaAi(
  answers: WizardAnswers,
  ctx: { tenantId: number; restaurantId: number; userId: number },
): Promise<{ plan: AiPlan; requestLogId: number | null }> {
  const sys = `You are Khana AI, helping a new restaurant complete its initial setup.
Return STRICT JSON only with shape:
{
  "categories": [ { "name": string, "description": string? } ],
  "qrMenuStyle": { "preset": "modern"|"classic"|"minimal"|"vibrant", "primaryColor": "#RRGGBB", "theme": "light"|"dark" },
  "pinnedReports": string[],
  "taxRate": number?,
  "paymentMethods": string[]?
}
- Suggest 4-8 menu categories appropriate for the cuisines/restaurant type.
- Pick a QR menu style preset that matches the brand vibe.
- Pick 3-5 starter reports from: sales, items, payments, customers, staff, inventory.
- Echo a sensible default tax rate for the country if known.
- Echo the chosen payment methods (cash, upi, card, wallet, online).`;

  const user = `Wizard answers:\n${JSON.stringify(answers, null, 2)}`;

  try {
    const { data, result } = await AIProviderService.generateJson<AiPlan>(
      { featureSlug: "ai_setup_wizard", tenantId: ctx.tenantId, restaurantId: ctx.restaurantId, userId: ctx.userId },
      {
        messages: [{ role: "user", content: user }],
        systemPrompt: sys,
        temperature: 0.4,
        maxTokens: 1500,
      },
    );
    const plan: AiPlan = {
      categories: Array.isArray(data?.categories) && data.categories.length > 0 ? data.categories.slice(0, 12) : FALLBACK_PLAN.categories,
      qrMenuStyle: data?.qrMenuStyle ?? FALLBACK_PLAN.qrMenuStyle,
      pinnedReports: Array.isArray(data?.pinnedReports) && data.pinnedReports.length > 0 ? data.pinnedReports.slice(0, 6) : FALLBACK_PLAN.pinnedReports,
      taxRate: typeof data?.taxRate === "number" ? data.taxRate : undefined,
      paymentMethods: Array.isArray(data?.paymentMethods) ? data.paymentMethods : undefined,
    };
    return { plan, requestLogId: result.requestLogId ?? null };
  } catch (err) {
    logger.warn({ err }, "ai_setup_wizard generation failed, using fallback plan");
    return { plan: FALLBACK_PLAN, requestLogId: null };
  }
}

/**
 * Apply the AI-generated plan + the user's wizard answers to the restaurant.
 * Reserves+commits AI credits, runs the AI call, then writes everything
 * (restaurant fields, branches, default menu+categories, settings sections)
 * inside a single DB transaction.
 */
export async function runSetupWizardGeneration(opts: {
  tenantId: number;
  restaurantId: number;
  userId: number;
  answers: WizardAnswers;
}): Promise<WizardSummary> {
  const { tenantId, restaurantId, userId, answers } = opts;

  // Reserve credits up-front. minCharge=10 from the seeder rule.
  let reservation: AiCreditReservation | null = null;
  try {
    reservation = await reserveCredits({
      tenantId,
      featureSlug: "ai_setup_wizard",
      credits: 10,
      meta: { restaurantId },
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === "INSUFFICIENT_CREDITS") {
      throw Object.assign(new Error("Insufficient AI credits to run the setup wizard"), { code: "INSUFFICIENT_CREDITS", status: 402 });
    }
    throw err;
  }

  let plan: AiPlan;
  let requestLogId: number | null = null;
  try {
    const out = await callKhanaAi(answers, { tenantId, restaurantId, userId });
    plan = out.plan;
    requestLogId = out.requestLogId;
  } catch (err) {
    if (reservation) await refundReservation(reservation, "ai_call_failed");
    throw err;
  }

  await commitReservation({ reservation, userId, requestLogId, actualCredits: 10 });

  // Apply everything in a single transaction so partial setups can't leak.
  const summary = await db.transaction(async (tx) => {
    // 1. Restaurant fields: tax, payment methods, google review link.
    const restaurantUpdates: Record<string, unknown> = { updatedAt: new Date() };
    const taxRate = answers.taxRate ?? plan.taxRate;
    if (typeof taxRate === "number" && taxRate >= 0) {
      restaurantUpdates.taxRate = taxRate.toFixed(2);
    }
    if (typeof answers.serviceCharge === "number" && answers.serviceCharge >= 0) {
      restaurantUpdates.serviceCharge = answers.serviceCharge.toFixed(2);
    }
    const methods = (answers.paymentMethods && answers.paymentMethods.length > 0
      ? answers.paymentMethods
      : plan.paymentMethods ?? ["cash", "upi", "card"]).filter((m) => typeof m === "string");
    restaurantUpdates.acceptedPaymentMethods = methods;
    if (answers.googleReviewLink !== undefined) {
      restaurantUpdates.googleReviewLink = answers.googleReviewLink || null;
    }
    await tx.update(restaurantsTable).set(restaurantUpdates).where(eq(restaurantsTable.id, restaurantId));

    // 2. Branches: ensure a main branch exists, then add any extra outlets.
    const existingBranches = await tx.select().from(branchesTable).where(eq(branchesTable.restaurantId, restaurantId));
    let branchesCreated = 0;
    if (existingBranches.length === 0) {
      const main = answers.outlets?.[0];
      await tx.insert(branchesTable).values({
        restaurantId,
        name: main?.name ?? "Main Branch",
        address: main?.address ?? null,
        phone: main?.phone ?? null,
        isMain: true,
        isActive: true,
      });
      branchesCreated += 1;
    }
    const extras = (answers.outlets ?? []).slice(existingBranches.length === 0 ? 1 : 0);
    for (const o of extras) {
      if (!o.name?.trim()) continue;
      await tx.insert(branchesTable).values({
        restaurantId,
        name: o.name.trim(),
        address: o.address ?? null,
        phone: o.phone ?? null,
        isMain: false,
        isActive: true,
      });
      branchesCreated += 1;
    }

    // 3. Menu categories — only seed if there are no existing categories,
    //    so re-running the wizard never duplicates the menu.
    const existingCats = await tx.select({ id: menuCategoriesTable.id }).from(menuCategoriesTable).where(eq(menuCategoriesTable.restaurantId, restaurantId));
    let categoriesCreated = 0;
    if (existingCats.length === 0) {
      // Ensure a default menu exists.
      let [menu] = await tx.select().from(menusTable).where(eq(menusTable.restaurantId, restaurantId));
      if (!menu) {
        const [created] = await tx.insert(menusTable).values({
          restaurantId,
          name: "Main Menu",
          description: "Default menu",
          isActive: true,
          sortOrder: 0,
        }).returning();
        menu = created;
      }
      let order = 0;
      for (const c of plan.categories) {
        if (!c?.name?.trim()) continue;
        await tx.insert(menuCategoriesTable).values({
          restaurantId,
          menuId: menu.id,
          name: c.name.trim(),
          description: c.description?.trim() ?? null,
          sortOrder: order++,
          isActive: true,
        });
        categoriesCreated += 1;
      }
    }

    // 4. Settings sections — QR menu style preset + pinned reports.
    const upsertSection = async (section: string, data: Record<string, unknown>) => {
      await tx.insert(restaurantSettingsTable).values({ restaurantId, section, data, updatedBy: userId })
        .onConflictDoUpdate({
          target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
          set: { data, updatedBy: userId, updatedAt: new Date() },
        });
    };
    await upsertSection("qr_menu_style", { ...plan.qrMenuStyle, source: "ai_setup_wizard" });
    await upsertSection("pinned_reports", { reports: plan.pinnedReports, source: "ai_setup_wizard" });
    await upsertSection("business_profile", {
      restaurantType: answers.restaurantType ?? null,
      cuisines: answers.cuisines ?? [],
      paymentGateway: answers.paymentGateway ?? null,
      taxCountry: answers.taxCountry ?? null,
      source: "ai_setup_wizard",
    });

    // 5. Apply parsed menu items from a prior AI menu-import (best-effort).
    //    Only "ready" / "partially_saved" imports with draft rows are applied;
    //    we resolve / create categories within the default menu and slot the
    //    items into them. Mirrors the simple path of the menu-imports save
    //    endpoint so the wizard remains a one-click "go live".
    let itemsImported = 0;
    let menuImportStatus: string | null = null;
    if (answers.menuImportId) {
      const [imp] = await tx.select().from(aiMenuImportsTable).where(and(
        eq(aiMenuImportsTable.id, answers.menuImportId),
        eq(aiMenuImportsTable.restaurantId, restaurantId),
      ));
      menuImportStatus = imp?.status ?? null;
      if (imp && (imp.status === "ready" || imp.status === "partially_saved")) {
        const drafts = await tx.select().from(aiMenuImportItemsTable).where(and(
          eq(aiMenuImportItemsTable.importId, imp.id),
          eq(aiMenuImportItemsTable.status, "draft"),
        ));
        if (drafts.length > 0) {
          let [menu] = await tx.select().from(menusTable).where(eq(menusTable.restaurantId, restaurantId));
          if (!menu) {
            const [created] = await tx.insert(menusTable).values({ restaurantId, name: "Main Menu", isActive: true, sortOrder: 0 }).returning();
            menu = created;
          }
          const cats = await tx.select({ id: menuCategoriesTable.id, name: menuCategoriesTable.name }).from(menuCategoriesTable).where(and(eq(menuCategoriesTable.restaurantId, restaurantId), eq(menuCategoriesTable.menuId, menu.id)));
          const catCache = new Map<string, number>();
          for (const c of cats) catCache.set(c.name.toLowerCase(), c.id);
          const resolveCat = async (name: string): Promise<number> => {
            const key = name.toLowerCase().trim();
            const hit = catCache.get(key);
            if (hit) return hit;
            const [created] = await tx.insert(menuCategoriesTable).values({ restaurantId, menuId: menu.id, name: name.trim() }).returning({ id: menuCategoriesTable.id });
            catCache.set(key, created.id);
            return created.id;
          };
          const savedIds: number[] = [];
          for (const draft of drafts) {
            const s = (draft.structured ?? {}) as { name?: string; categoryName?: string; price?: number; description?: string; dietTag?: string; prepTimeMinutes?: number; tags?: string[]; allergens?: string[] };
            const name = String(s.name ?? "").trim();
            if (!name) continue;
            const categoryId = await resolveCat(s.categoryName || "Uncategorised");
            await tx.insert(menuItemsTable).values({
              restaurantId,
              categoryId,
              name,
              description: s.description ?? "",
              price: Number(s.price ?? 0).toFixed(2),
              isVeg: s.dietTag === "veg",
              isAvailable: true,
              preparationTime: s.prepTimeMinutes ?? 15,
              tags: (s.tags ?? []).slice(0, 12),
              allergens: (s.allergens ?? []).slice(0, 8),
            });
            savedIds.push(draft.id);
            itemsImported += 1;
          }
          if (savedIds.length > 0) {
            await tx.update(aiMenuImportItemsTable)
              .set({ status: "saved" })
              .where(and(eq(aiMenuImportItemsTable.importId, imp.id), eq(aiMenuImportItemsTable.status, "draft")));
            await tx.update(aiMenuImportsTable)
              .set({ status: "saved" })
              .where(eq(aiMenuImportsTable.id, imp.id));
            menuImportStatus = "saved";
          }
        }
      }
    }

    return {
      categoriesCreated,
      branchesCreated,
      itemsImported,
      taxApplied: typeof taxRate === "number" ? taxRate : null,
      paymentMethods: methods,
      qrMenuStyle: plan.qrMenuStyle?.preset ?? null,
      pinnedReports: plan.pinnedReports,
      googleReviewLink: answers.googleReviewLink ?? null,
      menuImportId: answers.menuImportId ?? null,
      menuImportStatus,
    } satisfies WizardSummary;
  });

  return summary;
}
