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

export type PlanFeatureCategory =
  | "core"
  | "operations"
  | "growth"
  | "platform"
  // ─── Advanced packs (Task #365 plumbing) ──────────────────────────
  | "operations_intelligence"
  | "menu_intelligence"
  | "customer_intelligence"
  | "kitchen_quality"
  | "inventory_control"
  | "marketing"
  | "delivery"
  | "staff";

/** Plan tiers used by the seed catalogue's `defaultPlans` array. */
export type PlanTier = "starter" | "growth" | "pro" | "enterprise" | "addon";

export interface PlanBooleanFeature {
  key: string;
  label: string;
  /** Short description shown in admin / "what's included" tooltips. */
  description: string;
  category: PlanFeatureCategory;
  /** Default for newly created plans when the super admin doesn't pick one. */
  defaultValue: boolean;
  /** Default plan tiers that include this feature when seeding. */
  defaultPlans?: PlanTier[];
  /** When set, the placeholder/upgrade route lives under this path. */
  sidebarHref?: string;
  /** When set, points to the numeric usage limit key in PLAN_NUMERIC_FEATURES. */
  usageLimitKey?: string;
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
  { key: "kitchen_display",       label: "Kitchen Display (KDS)",       description: "Live kitchen ticket board for chefs and expediters.",       category: "core",       defaultValue: true,  defaultPlans: ["starter","growth","pro","enterprise"] },
  { key: "qr_ordering",           label: "QR scan-to-order",            description: "Customers scan a table QR code to browse and order.",       category: "core",       defaultValue: true,  defaultPlans: ["starter","growth","pro","enterprise"] },
  { key: "online_ordering",       label: "Online ordering page",        description: "Public ordering page with checkout for pickup & delivery.", category: "core",       defaultValue: false, defaultPlans: ["growth","pro","enterprise"] },
  { key: "reservations",          label: "Table reservations",          description: "Accept and manage table bookings from the customer site.",  category: "operations", defaultValue: false, defaultPlans: ["growth","pro","enterprise"] },
  { key: "delivery_module",       label: "Delivery module",             description: "Assign drivers, track runs, manage delivery zones.",        category: "operations", defaultValue: false, defaultPlans: ["pro","enterprise"] },
  { key: "events_catering",       label: "Events, banquets & catering", description: "Manage event bookings, packages, payment schedules, staff assignments and quotations.", category: "operations", defaultValue: false, defaultPlans: ["pro","enterprise"] },
  { key: "inventory_management",  label: "Inventory & stock",           description: "Track ingredient stock with low-stock alerts and recipes.", category: "operations", defaultValue: false, defaultPlans: ["growth","pro","enterprise"] },
  { key: "expense_tracking",      label: "Expense tracking",            description: "Record vendor bills, approvals, and expense reports.",       category: "operations", defaultValue: false, defaultPlans: ["growth","pro","enterprise"] },
  { key: "loyalty_program",       label: "Loyalty & rewards",           description: "Points, tiers, and rewards for repeat customers.",          category: "growth",     defaultValue: false, defaultPlans: ["growth","pro","enterprise"] },
  { key: "discounts_promotions",  label: "Discounts & promotions",      description: "Coupon codes, happy-hour pricing, and combo offers.",       category: "growth",     defaultValue: false, defaultPlans: ["growth","pro","enterprise"] },
  { key: "ai_menu_drafts",        label: "AI menu drafts",              description: "Generate menu descriptions and translations with AI.",      category: "growth",     defaultValue: false, defaultPlans: ["pro","enterprise"] },
  { key: "khana_ai_enabled",      label: "Khana AI module",             description: "Unlocks the full Khana AI module (descriptions, food photos, usage dashboard).", category: "growth", defaultValue: false, defaultPlans: ["pro","enterprise"] },
  { key: "khana_ai_insights_enabled", label: "AI Sales Insights",       description: "Daily AI-generated insights about sales trends, best-sellers, low-margin items and offer ideas.", category: "growth", defaultValue: false, defaultPlans: ["pro","enterprise"] },
  { key: "dashboard_chat_enabled",    label: "Dashboard AI chat",          description: "Persistent in-dashboard chat assistant that can answer questions and draft copy using your data.", category: "growth", defaultValue: false, defaultPlans: ["pro","enterprise"] },
  { key: "advanced_reports",      label: "Advanced reports",            description: "Custom date ranges, exports, and per-staff analytics.",     category: "growth",     defaultValue: false, defaultPlans: ["growth","pro","enterprise"] },
  { key: "custom_domain",         label: "Custom domain",               description: "Run the customer ordering page on your own domain.",        category: "platform",   defaultValue: false, defaultPlans: ["pro","enterprise"] },
  { key: "api_access",            label: "API access",                  description: "Programmatic access to your data via REST API.",            category: "platform",   defaultValue: false, defaultPlans: ["pro","enterprise"] },
  { key: "priority_support",      label: "Priority support",            description: "Faster response times and a dedicated success contact.",    category: "platform",   defaultValue: false, defaultPlans: ["enterprise"] },
  { key: "sop_training",          label: "SOP & Training",              description: "Publish standard operating procedures, run staff training courses, quizzes, and certificates.", category: "operations", defaultValue: false, defaultPlans: ["pro","enterprise"] },
  { key: "compliance_manager",    label: "Compliance Manager",          description: "Document vault, expiry reminders, and global tax/tip/privacy settings.", category: "operations", defaultValue: false, defaultPlans: ["pro","enterprise"] },
  { key: "hr_compliance",         label: "HR Compliance & Benefits",    description: "Employee documents with expiry reminders, benefits tracking, tax form summaries, minimum-wage rules, and per-outlet overtime/break/leave policies.", category: "operations", defaultValue: false, defaultPlans: ["pro","enterprise"], sidebarHref: "/hr-compliance" },
  { key: "cloud_kitchen",         label: "Cloud Kitchen mode",          description: "Run multiple virtual brands from one branch with shared stock, separate menus, channels, KOTs, packaging and brand-wise reports.", category: "operations", defaultValue: false, defaultPlans: ["enterprise"] },
  { key: "mystery_audits",        label: "Mystery Audits",              description: "Mystery-shopper audit templates, outlet assignments, scoring with photos, corrective actions and PDF reports.", category: "operations", defaultValue: false, defaultPlans: ["pro","enterprise"] },
  { key: "smart_pnl",             label: "Smart P&L Dashboard",         description: "Unified profit-and-loss dashboard with approval workflow and leak detection.", category: "growth", defaultValue: false, defaultPlans: ["pro","enterprise"] },

  // ──────────────────────────────────────────────────────────────────
  // Operations Intelligence pack (Task #365 plumbing)
  // ──────────────────────────────────────────────────────────────────
  { key: "ops_digital_twin",         label: "Restaurant Digital Twin",     description: "Live floor-and-kitchen digital twin showing every table, KOT, and station in real time.", category: "operations_intelligence", defaultValue: false, defaultPlans: ["enterprise","addon"],     sidebarHref: "/ops/digital-twin" },
  { key: "ops_panic_button",         label: "Panic Button",                description: "One-tap manager alert with escalation chain for urgent floor incidents.",               category: "operations_intelligence", defaultValue: false, defaultPlans: ["enterprise","addon"],     sidebarHref: "/ops/panic" },
  { key: "ops_shift_handover",       label: "Shift Handover Notes",        description: "Structured shift handover with cash, prep, and incident notes between shifts.",         category: "operations_intelligence", defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/ops/handover" },
  { key: "ops_daily_briefings",      label: "Daily Briefings",             description: "Pre-shift briefing board with specials, 86'd items, VIPs and targets.",                category: "operations_intelligence", defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/ops/briefings" },
  { key: "ops_closing_checklist",    label: "Opening & Closing Checklists",description: "Configurable checklists with photo proof and sign-off per outlet.",                     category: "operations_intelligence", defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/ops/checklists" },
  { key: "ops_event_timeline",       label: "Service Timeline",            description: "Minute-by-minute event timeline across orders, payments, voids and staff actions.",    category: "operations_intelligence", defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/ops/timeline" },
  { key: "ops_manager_approvals",    label: "Manager Approvals Inbox",     description: "Central queue of voids, comps, discounts and refunds awaiting manager approval.",      category: "operations_intelligence", defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/ops/approvals" },
  { key: "ops_incident_log",         label: "Incident Log",                description: "Track guest complaints, accidents and equipment failures with root-cause and actions.", category: "operations_intelligence", defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/ops/incidents" },

  // ──────────────────────────────────────────────────────────────────
  // Kitchen & Quality pack
  // ──────────────────────────────────────────────────────────────────
  { key: "kq_cleaning_schedule",     label: "Cleaning Schedule",           description: "Recurring cleaning tasks with sign-off, photo proof and inspector mode.",               category: "kitchen_quality",         defaultValue: false, defaultPlans: ["growth","pro","enterprise","addon"], sidebarHref: "/kitchen/cleaning" },
  { key: "kq_temperature_log",       label: "Temperature Log",             description: "Fridge, freezer and hot-hold temperature logs with deviation alerts.",                category: "kitchen_quality",         defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/kitchen/temperatures" },
  { key: "kq_equipment_register",    label: "Equipment Register",          description: "Asset register with AMC dates, breakdown history and maintenance reminders.",         category: "kitchen_quality",         defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/kitchen/equipment" },
  { key: "kq_taste_testing",         label: "Taste Testing Logs",          description: "Daily taste-test sign-off per dish with notes and corrective actions.",               category: "kitchen_quality",         defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/kitchen/taste-testing" },
  { key: "kq_accuracy_score",        label: "Order Accuracy Score",        description: "Track wrong-item / missing-item events and trend an outlet accuracy KPI.",            category: "kitchen_quality",         defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/kitchen/accuracy" },

  // ──────────────────────────────────────────────────────────────────
  // Menu Intelligence pack
  // ──────────────────────────────────────────────────────────────────
  { key: "menu_heatmap",             label: "Menu Heatmap",                description: "Visual heatmap of menu items by revenue, margin and order frequency.",                  category: "menu_intelligence",       defaultValue: false, defaultPlans: ["growth","pro","enterprise","addon"], sidebarHref: "/menu/heatmap" },
  { key: "menu_ab_tests",            label: "Menu A/B Tests",              description: "Run A/B price and description tests on menu items with statistical winners.",         category: "menu_intelligence",       defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/menu/ab-tests" },
  { key: "menu_search_analytics",    label: "Menu Search Analytics",       description: "Top searches on QR menu, including zero-result queries to inspire new dishes.",       category: "menu_intelligence",       defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/menu/search-analytics" },
  { key: "menu_modifier_builder",    label: "Modifier Builder",            description: "Drag-and-drop modifier and combo builder with bulk attach across menus.",             category: "menu_intelligence",       defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/menu/modifier-builder" },
  { key: "menu_taste_profiles",      label: "Dish Taste Profiles",         description: "Spicy / sweet / allergen taste profiles surfaced to staff and the QR menu.",          category: "menu_intelligence",       defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/menu/taste-profiles" },
  { key: "menu_group_qr",            label: "Group Ordering QR",           description: "Single QR for a group of guests; orders consolidate into one bill.",                  category: "menu_intelligence",       defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/menu/group-qr" },
  { key: "menu_split_cart",          label: "Split Cart at Checkout",      description: "Guests split items into separate carts and pay individually at QR checkout.",        category: "menu_intelligence",       defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/menu/split-cart" },
  { key: "menu_lifecycle",           label: "Menu Item Lifecycle",         description: "Draft → live → 86'd → retired lifecycle with approvals and audit trail.",             category: "menu_intelligence",       defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/menu/lifecycle" },
  { key: "menu_launch_tracker",      label: "New Launch Tracker",          description: "Track newly launched dishes for first-30-day sales, returns and review sentiment.",   category: "menu_intelligence",       defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/menu/launches" },
  { key: "menu_photo_approval",      label: "Dish Photo Approval",         description: "Centralized review queue for dish photos before they go live on the QR menu.",        category: "menu_intelligence",       defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/menu/photo-approvals" },
  { key: "menu_brand_assets",        label: "Brand Asset Library",         description: "Brand-approved logos, fonts and dish photos available across all outlets.",           category: "menu_intelligence",       defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/menu/brand-assets" },

  // ──────────────────────────────────────────────────────────────────
  // Customer Intelligence pack
  // ──────────────────────────────────────────────────────────────────
  { key: "cust_vip_alerts",          label: "VIP Customer Alerts",         description: "Real-time alert when a VIP arrives, with their preferences and history.",              category: "customer_intelligence",   defaultValue: false, defaultPlans: ["growth","pro","enterprise","addon"], sidebarHref: "/customers/vip-alerts" },
  { key: "cust_blacklist",           label: "Guest Blacklist",             description: "Block disruptive or non-paying guests; warn staff at booking or arrival.",            category: "customer_intelligence",   defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/customers/blacklist" },
  { key: "cust_mood",                label: "Guest Mood Tracker",          description: "Quick mood capture per visit so managers can intervene on unhappy guests live.",     category: "customer_intelligence",   defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/customers/mood" },
  { key: "cust_complaint_escalation",label: "Complaint Escalation",        description: "SLA-based escalation of complaints to managers and owners with closure tracking.",   category: "customer_intelligence",   defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/customers/complaints" },
  { key: "cust_repeat_detector",     label: "Repeat Visit Detector",       description: "Detect repeat guests across phone, email and tab to surface relationships instantly.", category: "customer_intelligence",   defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/customers/repeat-detector" },
  { key: "cust_visit_calendar",      label: "Guest Visit Calendar",        description: "Calendar view of guest visits, birthdays, anniversaries and reservations.",            category: "customer_intelligence",   defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/customers/visit-calendar" },
  { key: "cust_live_order_status",   label: "Live Order Status",           description: "Guests track their order live from kitchen → ready → served, like delivery apps.",   category: "customer_intelligence",   defaultValue: false, defaultPlans: ["starter","growth","pro","enterprise"], sidebarHref: "/customers/order-status" },
  { key: "cust_lost_sales",          label: "Lost Sales Report",           description: "Track 86'd-item, capacity-rejected and walked-out lost sales by revenue impact.",     category: "customer_intelligence",   defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/customers/lost-sales" },
  { key: "cust_abandoned_cart",      label: "Abandoned Cart Recovery",     description: "Auto-recover abandoned online and QR carts via WhatsApp / SMS / email nudges.",       category: "customer_intelligence",   defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/customers/abandoned-carts" },

  // ──────────────────────────────────────────────────────────────────
  // Inventory Control pack
  // ──────────────────────────────────────────────────────────────────
  { key: "inv_packaging",            label: "Packaging Inventory",         description: "Track boxes, bags and cutlery as their own inventory class with reorder points.",      category: "inventory_control",       defaultValue: false, defaultPlans: ["growth","pro","enterprise","addon"], sidebarHref: "/inventory/packaging" },
  { key: "inv_condiments",           label: "Condiment Tracking",          description: "Track condiment usage and waste per dish to plug a major leak source.",                category: "inventory_control",       defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/inventory/condiments" },
  { key: "inv_portion_drift",        label: "Portion Drift Alerts",        description: "Detect when actual ingredient usage drifts from recipe expectations.",                 category: "inventory_control",       defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/inventory/portion-drift" },
  { key: "inv_recipe_versioning",    label: "Recipe Versioning",           description: "Versioned recipes with rollback, approval and side-by-side diff.",                     category: "inventory_control",       defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/inventory/recipe-versions" },
  { key: "inv_vendor_invoice_ocr",   label: "Vendor Invoice OCR",          description: "Upload supplier invoices as PDF or photos; AI extracts vendor, totals, line items, matches a PO, flags price variances and books the bill on approval.", category: "inventory_control",       defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/inventory/vendor-invoices" },

  // ──────────────────────────────────────────────────────────────────
  // Marketing pack (Growth, Delivery & Staff intelligence)
  // ──────────────────────────────────────────────────────────────────
  { key: "mkt_local_map",            label: "Local Customer Map",          description: "Heatmap of where your customers live to target leaflets and offers.",                  category: "marketing",               defaultValue: false, defaultPlans: ["pro","enterprise","addon"], sidebarHref: "/growth/local-map" },
  { key: "mkt_festival_calendar",    label: "Festival Calendar",           description: "India-aware festival calendar with menu and offer suggestions.",                        category: "marketing",               defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/growth/festival-calendar" },
  { key: "mkt_offer_conflict",       label: "Offer Conflict Checker",      description: "Detects offers that overlap, cannibalize or breach min-margin floors.",                category: "marketing",               defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/growth/offer-conflicts" },
  { key: "mkt_margin_floors",        label: "Margin Floors",               description: "Set minimum margin per category; warn when a discount or combo drops below it.",      category: "marketing",               defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/growth/margin-floors" },
  { key: "mkt_upsell_pro",           label: "Upsell Suggestions Pro",      description: "Advanced upsell prompts at POS and QR powered by basket affinity analysis.",          category: "marketing",               defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/growth/upsell-pro" },
  { key: "mkt_referral_program",     label: "Referral Program",            description: "Customer referral campaign with shareable codes, reward rules and tracking dashboard.", category: "marketing",               defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/growth/referrals" },

  // ──────────────────────────────────────────────────────────────────
  // Delivery pack
  // ──────────────────────────────────────────────────────────────────
  { key: "dlv_queue_manager",        label: "Delivery Queue Manager",      description: "Live driver queue with auto-assignment, ETA and customer share link.",                 category: "delivery",                defaultValue: false, defaultPlans: ["growth","pro","enterprise","addon"], sidebarHref: "/delivery/queue" },
  { key: "dlv_pre_order",            label: "Pre-Order Window",            description: "Accept pre-orders for future delivery slots with capacity caps.",                       category: "delivery",                defaultValue: false, defaultPlans: ["starter","growth","pro","enterprise"], sidebarHref: "/delivery/pre-order" },
  { key: "dlv_zone_profitability",   label: "Delivery Zone Profitability", description: "Profit per delivery zone after distance, time and refund costs.",                        category: "delivery",                defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/delivery/zone-profitability" },
  { key: "dlv_live_tracking_link",   label: "Live Delivery Tracking Link", description: "Public live-tracking link sent to customers with driver location and ETA.",            category: "delivery",                defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/delivery/tracking-links" },

  // ──────────────────────────────────────────────────────────────────
  // Staff pack
  // ──────────────────────────────────────────────────────────────────
  { key: "staff_table_optimization", label: "Table Optimization",          description: "Optimize floor plans and reservations to lift covers per shift.",                      category: "staff",                   defaultValue: false, defaultPlans: ["pro","enterprise","addon"], sidebarHref: "/staff/table-optimization" },
  { key: "staff_tips",               label: "Tip Pooling & Distribution",  description: "Pool, split and audit tips across staff per shift with payslip lines.",               category: "staff",                   defaultValue: false, defaultPlans: ["growth","pro","enterprise"], sidebarHref: "/staff/tips" },
  { key: "staff_leaderboard_tv",     label: "Staff Leaderboard TV",        description: "Live leaderboard for the staff TV: sales, upsell wins and accuracy.",                  category: "staff",                   defaultValue: false, defaultPlans: ["pro","enterprise"],       sidebarHref: "/staff/leaderboard-tv" },
];

export const PLAN_QUANTITY_FEATURES: PlanQuantityFeature[] = [
  { key: "maxRestaurants", label: "Restaurants",  description: "How many restaurants this tenant can run.", category: "core",       unitSingular: "restaurant",  unitPlural: "restaurants",  unlimitedThreshold: 999 },
  { key: "maxBranches",    label: "Branches",     description: "Outlets per restaurant.",                   category: "core",       unitSingular: "branch",      unitPlural: "branches",     unlimitedThreshold: 999 },
  { key: "maxStaff",       label: "Staff",        description: "Active staff accounts in the tenant.",      category: "operations", unitSingular: "staff member", unitPlural: "staff members", unlimitedThreshold: 999 },
  { key: "maxTables",      label: "Tables",       description: "Floor tables per restaurant.",              category: "operations", unitSingular: "table",       unitPlural: "tables",       unlimitedThreshold: 999 },
  { key: "maxMenuItems",   label: "Menu items",   description: "Menu items per restaurant.",                category: "operations", unitSingular: "menu item",   unitPlural: "menu items",   unlimitedThreshold: 9999 },
];

export const PLAN_FEATURE_CATEGORIES: { key: PlanFeatureCategory; label: string }[] = [
  { key: "core",                     label: "Core" },
  { key: "operations",               label: "Operations" },
  { key: "growth",                   label: "Growth" },
  { key: "platform",                 label: "Platform" },
  { key: "operations_intelligence",  label: "Operations Intelligence" },
  { key: "menu_intelligence",        label: "Menu Intelligence" },
  { key: "customer_intelligence",    label: "Customer Intelligence" },
  { key: "kitchen_quality",          label: "Kitchen & Quality" },
  { key: "inventory_control",        label: "Inventory Control" },
  { key: "marketing",                label: "Marketing" },
  { key: "delivery",                 label: "Delivery" },
  { key: "staff",                    label: "Staff" },
];

/** Build the default featureFlags object for a brand-new plan. */
export function defaultFeatureFlags(): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const f of PLAN_BOOLEAN_FEATURES) flags[f.key] = f.defaultValue;
  return flags;
}

/**
 * Build the featureFlags object for a seeded plan tier. Enterprise gets
 * every catalogue entry; other tiers only flip the keys whose
 * `defaultPlans` array includes the tier. Add-on-only keys default off
 * across all tiers (they're unlocked via the add-on catalogue).
 */
export function defaultFeatureFlagsForPlan(tier: PlanTier): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const f of PLAN_BOOLEAN_FEATURES) {
    if (tier === "enterprise") {
      flags[f.key] = true;
      continue;
    }
    if (f.defaultPlans && f.defaultPlans.includes(tier)) {
      flags[f.key] = true;
      continue;
    }
    flags[f.key] = false;
  }
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

/** Convenience helper for sidebar / router: get the placeholder href registered for a feature key. */
export function getFeatureSidebarHref(key: string): string | undefined {
  return PLAN_BOOLEAN_FEATURES.find((f) => f.key === key)?.sidebarHref;
}

/** Find a feature catalogue entry by its placeholder route. */
export function findFeatureByHref(href: string): PlanBooleanFeature | undefined {
  return PLAN_BOOLEAN_FEATURES.find((f) => f.sidebarHref === href);
}

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
  // ─── Usage limits for advanced packs (Task #365) ─────────────────
  { key: "ops_checklist_count_max",       label: "Max checklists per outlet",     description: "How many opening/closing checklists a tenant may publish per outlet.",                 category: "operations_intelligence", defaultValue: 5,   min: 0, max: 200,  unit: "per outlet" },
  { key: "ops_incident_retention_days",   label: "Incident retention (days)",     description: "How long incident-log entries are kept before archival.",                              category: "operations_intelligence", defaultValue: 365, min: 30, max: 3650, unit: "days" },
  { key: "kq_temperature_log_devices",    label: "Temperature probes per outlet", description: "Maximum number of temperature probes a tenant can register per outlet.",              category: "kitchen_quality",         defaultValue: 5,   min: 0, max: 100,  unit: "per outlet" },
  { key: "menu_ab_active_tests_max",      label: "Max concurrent A/B tests",      description: "Cap on simultaneously running menu A/B tests per restaurant.",                          category: "menu_intelligence",       defaultValue: 3,   min: 0, max: 100,  unit: "tests" },
  { key: "cust_vip_segment_max",          label: "VIP segments",                   description: "Maximum number of VIP customer segments.",                                              category: "customer_intelligence",   defaultValue: 5,   min: 0, max: 50,   unit: "segments" },
  { key: "dlv_zone_max",                  label: "Delivery zones",                description: "Maximum number of delivery zones per outlet.",                                          category: "delivery",                defaultValue: 10,  min: 0, max: 200,  unit: "zones" },
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
