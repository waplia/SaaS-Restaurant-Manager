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
