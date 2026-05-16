/**
 * Idempotent seeder that registers the default Khana AI feature credit
 * rules on startup. New features added later only need to append entries
 * here — the unique index on (featureSlug, scopeType, scopeId) makes this
 * a safe upsert.
 */
import { db, aiFeatureCreditRulesTable } from "./db";
import { logger } from "./logger";

interface SeedRule {
  featureSlug: string;
  featureLabel: string;
  description: string;
  creditsPerUnit: string;
  minCharge: number;
  unitType: string;
  pricingMode: string;
}

const DEFAULT_RULES: SeedRule[] = [
  {
    featureSlug: "ai_description",
    featureLabel: "AI Item Descriptions",
    description: "Generate appetising menu descriptions, allergens and tags for a single dish.",
    creditsPerUnit: "1",
    minCharge: 1,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "ai_food_image",
    featureLabel: "AI Food Images",
    description: "Generate a professional food photograph for a single dish.",
    creditsPerUnit: "10",
    minCharge: 10,
    unitType: "image",
    pricingMode: "per_image",
  },
  {
    featureSlug: "ai_review_draft",
    featureLabel: "AI Google Review Drafts",
    description: "Generate a friendly Google review draft for a guest based on rating + selected tags + optional note.",
    creditsPerUnit: "1",
    minCharge: 1,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "ai_review_reply",
    featureLabel: "AI Review Replies",
    description: "Generate a reply to a customer review (per generation).",
    creditsPerUnit: "2",
    minCharge: 2,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "ai_feedback_analysis",
    featureLabel: "AI Feedback Analysis",
    description: "Detect sentiment + category and suggest a recovery action for a piece of feedback.",
    creditsPerUnit: "1",
    minCharge: 1,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "ai_inventory_assistant",
    featureLabel: "AI Inventory Assistant",
    description: "Generate reorder suggestions, low-stock alerts and supplier recommendations based on usage history.",
    creditsPerUnit: "5",
    minCharge: 5,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "ai_demand_forecast",
    featureLabel: "AI Demand Forecasting",
    description: "Forecast next-week demand by menu item and category using historical orders.",
    creditsPerUnit: "5",
    minCharge: 5,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "ai_recipe_optimizer",
    featureLabel: "AI Recipe Cost Optimizer",
    description: "Analyse a recipe's COGS, suggest cheaper substitutions and a price/portion tweak (per menu item).",
    creditsPerUnit: "1",
    minCharge: 1,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "ai_upsell_suggest",
    featureLabel: "AI Upsell Engine",
    description: "Generate batch of upsell rule suggestions (item bundles, low-cart nudges, time-of-day specials).",
    creditsPerUnit: "3",
    minCharge: 3,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "ai_sales_insights",
    featureLabel: "AI Sales Insights",
    description: "Generate a fresh batch of daily sales insights (trends, best-sellers, low-margin items, peak times, suggested offers, retention).",
    creditsPerUnit: "5",
    minCharge: 5,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "ai_voice_order",
    featureLabel: "AI Voice Order Assistant",
    description: "Parse a spoken Hindi/English/Hinglish order transcript into structured items + table for the POS / waiter app.",
    creditsPerUnit: "1",
    minCharge: 1,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "ai_setup_wizard",
    featureLabel: "AI Setup Wizard",
    description: "Auto-generate menu categories, tax setup, payment defaults, QR menu style, and starter reports from the new-restaurant signup wizard.",
    creditsPerUnit: "10",
    minCharge: 10,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "ai_nutrition",
    featureLabel: "AI Nutrition & Allergens",
    description: "Estimate calories/protein/fat/carbs, allergen flags (dairy/nuts/gluten), dietary tags (vegan/jain) and spicy level for a single dish.",
    creditsPerUnit: "1",
    minCharge: 1,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "staff_insights",
    featureLabel: "AI Staff Insights",
    description: "Generate per-staff scorecards plus AI summary cards (best performer, training needs, suspicious activity, payroll anomaly, shift suggestion) for a date range.",
    creditsPerUnit: "5",
    minCharge: 5,
    unitType: "request",
    pricingMode: "fixed",
  },
  {
    featureSlug: "ai_menu_import",
    featureLabel: "AI Menu Import",
    description: "Import an entire menu from a PDF, image, spreadsheet, URL, text or screenshot. Charged per page for PDFs, per image for image inputs, and per 50 items for spreadsheets / text / URL.",
    creditsPerUnit: "5",
    minCharge: 5,
    unitType: "page",
    pricingMode: "per_unit",
  },
];

export async function seedDefaultAiCreditRules(): Promise<void> {
  try {
    for (const rule of DEFAULT_RULES) {
      await db.insert(aiFeatureCreditRulesTable).values({
        featureSlug: rule.featureSlug,
        featureLabel: rule.featureLabel,
        description: rule.description,
        scopeType: "global",
        scopeId: null,
        pricingMode: rule.pricingMode,
        unitType: rule.unitType,
        creditsPerUnit: rule.creditsPerUnit,
        minCharge: rule.minCharge,
        freeMonthlyQuota: 0,
        isActive: true,
      }).onConflictDoNothing({ target: [
        aiFeatureCreditRulesTable.featureSlug,
        aiFeatureCreditRulesTable.scopeType,
        aiFeatureCreditRulesTable.scopeId,
      ] });
    }
    logger.info("Default AI credit rules ensured");
  } catch (err) {
    logger.error({ err }, "Failed to seed default AI credit rules");
  }
}
