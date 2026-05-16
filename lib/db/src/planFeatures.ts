/**
 * Single source of truth for per-plan feature toggles & quantity limits.
 *
 * Used by:
 *   - api-server: persisting/validating featureFlags + runtime gating helpers
 *   - restaurant-platform admin UI: rendering the structured plan editor
 *   - restaurant-platform settings: rendering the read-only "what's included" grid
 *   - marketing-site pricing: rendering each plan card's feature list
 *
 * Adding a new boolean feature here makes it appear automatically in every
 * surface above. New quantity columns must also be added to the schema.
 */

export type PlanFeatureCategory = "core" | "operations" | "growth" | "platform";

export interface PlanBooleanFeature {
  key: string;
  label: string;
  /** Short description shown in admin / "what's included" tooltips. */
  description: string;
  category: PlanFeatureCategory;
  /** Default for newly created plans when the super admin doesn't pick one. */
  defaultValue: boolean;
}

export interface PlanQuantityFeature {
  /** The schema column name (camelCase) on subscription_plans. */
  key: "maxRestaurants" | "maxBranches" | "maxStaff" | "maxTables" | "maxMenuItems";
  label: string;
  description: string;
  category: PlanFeatureCategory;
  /** Marketing copy: "1 restaurant" vs "1 restaurants" — pick the right form. */
  unitSingular: string;
  unitPlural: string;
  /** Treat values >= this as "Unlimited" in marketing copy. */
  unlimitedThreshold: number;
}

/** Boolean feature catalogue. Keys are stable strings persisted in plan.featureFlags. */
export const PLAN_BOOLEAN_FEATURES: PlanBooleanFeature[] = [
  { key: "kitchen_display",       label: "Kitchen Display (KDS)",       description: "Live kitchen ticket board for chefs and expediters.",       category: "core",       defaultValue: true },
  { key: "qr_ordering",           label: "QR scan-to-order",            description: "Customers scan a table QR code to browse and order.",       category: "core",       defaultValue: true },
  { key: "online_ordering",       label: "Online ordering page",        description: "Public ordering page with checkout for pickup & delivery.", category: "core",       defaultValue: false },
  { key: "reservations",          label: "Table reservations",          description: "Accept and manage table bookings from the customer site.",  category: "operations", defaultValue: false },
  { key: "delivery_module",       label: "Delivery module",             description: "Assign drivers, track runs, manage delivery zones.",        category: "operations", defaultValue: false },
  { key: "events_catering",       label: "Events, banquets & catering", description: "Manage event bookings, packages, payment schedules, staff assignments and quotations.", category: "operations", defaultValue: false },
  { key: "inventory_management",  label: "Inventory & stock",           description: "Track ingredient stock with low-stock alerts and recipes.", category: "operations", defaultValue: false },
  { key: "expense_tracking",      label: "Expense tracking",            description: "Record vendor bills, approvals, and expense reports.",       category: "operations", defaultValue: false },
  { key: "loyalty_program",       label: "Loyalty & rewards",           description: "Points, tiers, and rewards for repeat customers.",          category: "growth",     defaultValue: false },
  { key: "discounts_promotions",  label: "Discounts & promotions",      description: "Coupon codes, happy-hour pricing, and combo offers.",       category: "growth",     defaultValue: false },
  { key: "ai_menu_drafts",        label: "AI menu drafts",              description: "Generate menu descriptions and translations with AI.",      category: "growth",     defaultValue: false },
  { key: "khana_ai_enabled",      label: "Khana AI module",             description: "Unlocks the full Khana AI module (descriptions, food photos, usage dashboard).", category: "growth", defaultValue: false },
  { key: "khana_ai_insights_enabled", label: "AI Sales Insights",       description: "Daily AI-generated insights about sales trends, best-sellers, low-margin items and offer ideas.", category: "growth", defaultValue: false },
  { key: "dashboard_chat_enabled",    label: "Dashboard AI chat",          description: "Persistent in-dashboard chat assistant that can answer questions and draft copy using your data.", category: "growth", defaultValue: false },
  { key: "advanced_reports",      label: "Advanced reports",            description: "Custom date ranges, exports, and per-staff analytics.",     category: "growth",     defaultValue: false },
  { key: "custom_domain",         label: "Custom domain",               description: "Run the customer ordering page on your own domain.",        category: "platform",   defaultValue: false },
  { key: "api_access",            label: "API access",                  description: "Programmatic access to your data via REST API.",            category: "platform",   defaultValue: false },
  { key: "priority_support",      label: "Priority support",            description: "Faster response times and a dedicated success contact.",    category: "platform",   defaultValue: false },
  { key: "sop_training",          label: "SOP & Training",              description: "Publish standard operating procedures, run staff training courses, quizzes, and certificates.", category: "operations", defaultValue: false },
  { key: "compliance_manager",    label: "Compliance Manager",          description: "Document vault, expiry reminders, and global tax/tip/privacy settings.", category: "operations", defaultValue: false },
];

export const PLAN_QUANTITY_FEATURES: PlanQuantityFeature[] = [
  { key: "maxRestaurants", label: "Restaurants",  description: "How many restaurants this tenant can run.", category: "core",       unitSingular: "restaurant",  unitPlural: "restaurants",  unlimitedThreshold: 999 },
  { key: "maxBranches",    label: "Branches",     description: "Outlets per restaurant.",                   category: "core",       unitSingular: "branch",      unitPlural: "branches",     unlimitedThreshold: 999 },
  { key: "maxStaff",       label: "Staff",        description: "Active staff accounts in the tenant.",      category: "operations", unitSingular: "staff member", unitPlural: "staff members", unlimitedThreshold: 999 },
  { key: "maxTables",      label: "Tables",       description: "Floor tables per restaurant.",              category: "operations", unitSingular: "table",       unitPlural: "tables",       unlimitedThreshold: 999 },
  { key: "maxMenuItems",   label: "Menu items",   description: "Menu items per restaurant.",                category: "operations", unitSingular: "menu item",   unitPlural: "menu items",   unlimitedThreshold: 9999 },
];

export const PLAN_FEATURE_CATEGORIES: { key: PlanFeatureCategory; label: string }[] = [
  { key: "core",       label: "Core" },
  { key: "operations", label: "Operations" },
  { key: "growth",     label: "Growth" },
  { key: "platform",   label: "Platform" },
];

/** Build the default featureFlags object for a brand-new plan. */
export function defaultFeatureFlags(): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const f of PLAN_BOOLEAN_FEATURES) flags[f.key] = f.defaultValue;
  return flags;
}

/**
 * Read a single boolean flag from a plan's stored featureFlags map.
 * Falls back to the catalogue default when the key is missing (handles plans
 * created before a new flag was added).
 */
export function isFeatureEnabled(
  flags: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  if (flags && typeof flags === "object" && key in flags) {
    return Boolean((flags as Record<string, unknown>)[key]);
  }
  const def = PLAN_BOOLEAN_FEATURES.find((f) => f.key === key);
  return def?.defaultValue ?? false;
}

/**
 * Format a quantity column value for display, e.g. 1 → "1 branch",
 * 999 → "Unlimited branches", 0 → null (caller decides whether to show).
 */
export function formatQuantity(
  feat: PlanQuantityFeature,
  value: number,
): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value === 0) return null;
  if (value >= feat.unlimitedThreshold) return `Unlimited ${feat.unitPlural}`;
  return `${value.toLocaleString("en-IN")} ${value === 1 ? feat.unitSingular : feat.unitPlural}`;
}

export const PLAN_BOOLEAN_FEATURE_KEYS: readonly string[] = PLAN_BOOLEAN_FEATURES.map((f) => f.key);

/**
 * Numeric settings catalogue. Stored alongside boolean flags inside
 * `subscription_plans.feature_flags` (jsonb). Used for per-plan numeric tunables
 * that don't deserve their own column (e.g. daily free quotas).
 */
export interface PlanNumericFeature {
  key: string;
  label: string;
  description: string;
  category: PlanFeatureCategory;
  defaultValue: number;
  min: number;
  max: number;
  unit: string;
}

export const PLAN_NUMERIC_FEATURES: PlanNumericFeature[] = [
  {
    key: "khana_ai_insights_free_daily",
    label: "Free AI Sales Insights / day",
    description: "How many AI Sales Insight generations are free per day before credits are used.",
    category: "growth",
    defaultValue: 1,
    min: 0,
    max: 50,
    unit: "per day",
  },
];

/** Read a numeric setting from a plan's stored featureFlags map. */
export function getFeatureNumber(
  flags: Record<string, unknown> | null | undefined,
  key: string,
): number {
  const def = PLAN_NUMERIC_FEATURES.find((f) => f.key === key)?.defaultValue ?? 0;
  if (!flags || typeof flags !== "object") return def;
  const v = (flags as Record<string, unknown>)[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return def;
}
