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
