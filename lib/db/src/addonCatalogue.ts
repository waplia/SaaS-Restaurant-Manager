/**
 * Catalogue of first-party add-ons for the Add-on Marketplace.
 * Seeded into the `addons` table on boot. Editing entries here updates
 * the catalogue defaults, but Super Admin overrides take precedence.
 */
export type AddonCategory = "ai" | "operations" | "growth" | "platform" | "integrations";

export type AddonPricingMode = "free" | "monthly" | "yearly" | "monthly_yearly" | "one_off";

export interface AddonCatalogueEntry {
  key: string;
  name: string;
  description: string;
  longDescription: string;
  icon: string;
  category: AddonCategory;
  pricing: {
    mode: AddonPricingMode;
    monthlyPrice?: number;
    yearlyPrice?: number;
    oneOffPrice?: number;
    currency?: string;
  };
  trialDays: number;
  /** Plan feature flag(s) this add-on unlocks once active. */
  featureFlags: string[];
  comingSoon: boolean;
  sortOrder: number;
}

export const ADDON_CATALOGUE: AddonCatalogueEntry[] = [
  {
    key: "khana_ai",
    name: "Khana AI",
    description: "AI menu writing, food images, sales insights and review replies.",
    longDescription: "Unlock the full Khana AI suite — menu descriptions, food images, AI sales insights, review replies, dashboard chat and more. Burns from your AI credit wallet.",
    icon: "Sparkles",
    category: "ai",
    pricing: { mode: "monthly_yearly", monthlyPrice: 999, yearlyPrice: 9990, currency: "INR" },
    trialDays: 14,
    featureFlags: ["khana_ai_enabled"],
    comingSoon: false,
    sortOrder: 10,
  },
  {
    key: "advanced_inventory",
    name: "Advanced Inventory",
    description: "Recipe-level stock tracking with low-stock alerts and auto-reorder.",
    longDescription: "Track ingredient stock per recipe, get low-stock alerts, auto-reorder vendors and run inventory reports.",
    icon: "Package",
    category: "operations",
    pricing: { mode: "monthly_yearly", monthlyPrice: 499, yearlyPrice: 4990, currency: "INR" },
    trialDays: 14,
    featureFlags: ["inventory_management"],
    comingSoon: false,
    sortOrder: 20,
  },
  {
    key: "loyalty",
    name: "Loyalty & Rewards",
    description: "Points, tiers and rewards for repeat customers.",
    longDescription: "Run a points-based loyalty program with tiers, expiring points and reward redemption at the POS.",
    icon: "Gift",
    category: "growth",
    pricing: { mode: "monthly_yearly", monthlyPrice: 399, yearlyPrice: 3990, currency: "INR" },
    trialDays: 14,
    featureFlags: ["loyalty_program"],
    comingSoon: false,
    sortOrder: 30,
  },
  {
    key: "whatsapp_marketing",
    name: "WhatsApp Marketing",
    description: "Broadcast offers and updates to customers on WhatsApp.",
    longDescription: "Send approved-template WhatsApp campaigns to customer segments and track delivery, reads and conversions.",
    icon: "MessageCircle",
    category: "growth",
    pricing: { mode: "monthly_yearly", monthlyPrice: 599, yearlyPrice: 5990, currency: "INR" },
    trialDays: 7,
    featureFlags: [],
    comingSoon: false,
    sortOrder: 40,
  },
  {
    key: "staff_payroll",
    name: "Staff Payroll",
    description: "Salaries, attendance, advances and pay slips.",
    longDescription: "Run monthly payroll for your staff — attendance, advances, salary heads, pay slip PDFs and statutory reports.",
    icon: "Wallet",
    category: "operations",
    pricing: { mode: "monthly_yearly", monthlyPrice: 699, yearlyPrice: 6990, currency: "INR" },
    trialDays: 14,
    featureFlags: [],
    comingSoon: false,
    sortOrder: 50,
  },
  {
    key: "online_ordering",
    name: "Online Ordering",
    description: "Public ordering page with checkout for pickup & delivery.",
    longDescription: "Give customers a public ordering page with menu, checkout, pickup and delivery — branded to your restaurant.",
    icon: "ShoppingCart",
    category: "growth",
    pricing: { mode: "monthly_yearly", monthlyPrice: 799, yearlyPrice: 7990, currency: "INR" },
    trialDays: 14,
    featureFlags: ["online_ordering"],
    comingSoon: false,
    sortOrder: 60,
  },
  {
    key: "white_label_app",
    name: "White Label App",
    description: "Your own branded customer ordering & loyalty app.",
    longDescription: "Publish a fully branded customer app with your logo, colors, hero banner, gallery, reviews and app-exclusive coupons. Menu auto-syncs from your restaurant, loyalty wallet integrates out of the box, and you can roll your own custom domain and push campaigns.",
    icon: "Smartphone",
    category: "platform",
    pricing: { mode: "monthly_yearly", monthlyPrice: 2499, yearlyPrice: 24990, currency: "INR" },
    trialDays: 14,
    featureFlags: ["customer_app"],
    comingSoon: false,
    sortOrder: 70,
  },
  {
    key: "accounting_sync",
    name: "Accounting Sync",
    description: "Sync invoices and expenses to Tally, Zoho Books and QuickBooks.",
    longDescription: "Automatically push your sales invoices, expenses and payment ledger to your accounting system every day.",
    icon: "FileSpreadsheet",
    category: "integrations",
    pricing: { mode: "monthly_yearly", monthlyPrice: 999, yearlyPrice: 9990, currency: "INR" },
    trialDays: 14,
    featureFlags: [],
    comingSoon: true,
    sortOrder: 80,
  },
  {
    key: "delivery_sync",
    name: "Delivery Platform Sync",
    description: "Pull Swiggy, Zomato and ONDC orders into one screen.",
    longDescription: "Aggregate orders from Swiggy, Zomato, ONDC and other delivery platforms into your POS — single menu, single order screen.",
    icon: "Truck",
    category: "integrations",
    pricing: { mode: "monthly_yearly", monthlyPrice: 1499, yearlyPrice: 14990, currency: "INR" },
    trialDays: 14,
    featureFlags: [],
    comingSoon: true,
    sortOrder: 90,
  },
  {
    key: "kiosk_ordering",
    name: "Kiosk Ordering",
    description: "Self-serve ordering kiosks for your store.",
    longDescription: "Let customers place orders themselves on a tablet kiosk — full menu, modifiers, payment and KOT printing.",
    icon: "Monitor",
    category: "operations",
    pricing: { mode: "monthly_yearly", monthlyPrice: 899, yearlyPrice: 8990, currency: "INR" },
    trialDays: 14,
    featureFlags: [],
    comingSoon: true,
    sortOrder: 100,
  },
  {
    key: "kitchen_display",
    name: "Kitchen Display (KDS)",
    description: "Live kitchen ticket board for chefs and expediters.",
    longDescription: "Replace paper KOTs with a live kitchen display — bump times, station routing and prep timers.",
    icon: "ChefHat",
    category: "operations",
    pricing: { mode: "monthly_yearly", monthlyPrice: 599, yearlyPrice: 5990, currency: "INR" },
    trialDays: 14,
    featureFlags: ["kitchen_display"],
    comingSoon: false,
    sortOrder: 110,
  },
  {
    key: "franchise_control",
    name: "Franchise Control",
    description: "Centrally manage menus, pricing and reports across franchises.",
    longDescription: "A franchisor console — push menus, prices and SOPs to all franchisee outlets, get consolidated reports.",
    icon: "Building2",
    category: "platform",
    pricing: { mode: "monthly_yearly", monthlyPrice: 2999, yearlyPrice: 29990, currency: "INR" },
    trialDays: 0,
    featureFlags: [],
    comingSoon: true,
    sortOrder: 120,
  },
  {
    key: "advanced_analytics",
    name: "Advanced Analytics",
    description: "Custom date ranges, exports and per-staff analytics.",
    longDescription: "Deeper analytics — cohort analysis, custom date comparisons, staff performance reports and CSV exports.",
    icon: "BarChart3",
    category: "growth",
    pricing: { mode: "monthly_yearly", monthlyPrice: 499, yearlyPrice: 4990, currency: "INR" },
    trialDays: 14,
    featureFlags: ["advanced_reports"],
    comingSoon: false,
    sortOrder: 130,
  },
  // ──────────────────────────────────────────────────────────────────
  // Advanced-pack bundles (Task #365)
  // Each bundle unlocks every feature_flag in its pack, so tenants on a
  // lower plan can buy a pack à la carte without upgrading their whole
  // subscription. Feature keys come from `planFeatures.ts`.
  // ──────────────────────────────────────────────────────────────────
  {
    key: "pack_operations_intelligence",
    name: "Operations Intelligence Pack",
    description: "Digital twin, panic button, shift handovers, checklists, approvals, incident log and more.",
    longDescription: "Run a tighter floor with a live digital twin, panic button, shift handover notes, daily briefings, opening/closing checklists, a manager approvals inbox and an incident log.",
    icon: "LayoutDashboard",
    category: "operations",
    pricing: { mode: "monthly_yearly", monthlyPrice: 1499, yearlyPrice: 14990, currency: "INR" },
    trialDays: 14,
    featureFlags: [
      "ops_digital_twin","ops_panic_button","ops_shift_handover","ops_daily_briefings",
      "ops_closing_checklist","ops_event_timeline","ops_manager_approvals","ops_incident_log",
    ],
    comingSoon: false,
    sortOrder: 200,
  },
  {
    key: "pack_kitchen_quality",
    name: "Kitchen & Quality Pack",
    description: "Cleaning schedules, temperature logs, equipment register, taste testing and accuracy scoring.",
    longDescription: "Stay food-safe and consistent with cleaning schedules, temperature logs, an equipment register with AMC tracking, daily taste-testing sign-off and an order-accuracy score.",
    icon: "ShieldCheck",
    category: "operations",
    pricing: { mode: "monthly_yearly", monthlyPrice: 999, yearlyPrice: 9990, currency: "INR" },
    trialDays: 14,
    featureFlags: [
      "kq_cleaning_schedule","kq_temperature_log","kq_equipment_register","kq_taste_testing","kq_accuracy_score",
    ],
    comingSoon: false,
    sortOrder: 210,
  },
  {
    key: "pack_menu_intelligence",
    name: "Menu Intelligence Pack",
    description: "Heatmap, A/B tests, search analytics, modifier builder, group QR, split cart and brand assets.",
    longDescription: "Run your menu like a product team — heatmaps, A/B tests, search analytics, taste profiles, group/split-cart QR ordering, dish lifecycle, launch tracker, photo approvals and a brand asset library.",
    icon: "TrendingUp",
    category: "growth",
    pricing: { mode: "monthly_yearly", monthlyPrice: 1299, yearlyPrice: 12990, currency: "INR" },
    trialDays: 14,
    featureFlags: [
      "menu_heatmap","menu_ab_tests","menu_search_analytics","menu_modifier_builder","menu_taste_profiles",
      "menu_group_qr","menu_split_cart","menu_lifecycle","menu_launch_tracker","menu_photo_approval","menu_brand_assets",
    ],
    comingSoon: false,
    sortOrder: 220,
  },
  {
    key: "pack_customer_intelligence",
    name: "Customer Intelligence Pack",
    description: "VIP alerts, blacklist, mood tracker, complaint escalation, visit calendar and lost-sales recovery.",
    longDescription: "Know every guest — VIP alerts, blacklist, mood tracker, SLA-based complaint escalation, repeat detector, visit calendar, live order status, lost-sales report and abandoned-cart recovery.",
    icon: "Users",
    category: "growth",
    pricing: { mode: "monthly_yearly", monthlyPrice: 1199, yearlyPrice: 11990, currency: "INR" },
    trialDays: 14,
    featureFlags: [
      "cust_vip_alerts","cust_blacklist","cust_mood","cust_complaint_escalation","cust_repeat_detector",
      "cust_visit_calendar","cust_live_order_status","cust_lost_sales","cust_abandoned_cart",
    ],
    comingSoon: false,
    sortOrder: 230,
  },
  {
    key: "pack_inventory_control",
    name: "Inventory Control Pack",
    description: "Packaging inventory, condiment tracking, portion-drift alerts and recipe versioning.",
    longDescription: "Plug inventory leaks — track packaging, condiments and portion drift against recipes, with versioned recipes and rollback.",
    icon: "Package",
    category: "operations",
    pricing: { mode: "monthly_yearly", monthlyPrice: 799, yearlyPrice: 7990, currency: "INR" },
    trialDays: 14,
    featureFlags: ["inv_packaging","inv_condiments","inv_portion_drift","inv_recipe_versioning"],
    comingSoon: false,
    sortOrder: 240,
  },
  {
    key: "pack_marketing",
    name: "Marketing Intelligence Pack",
    description: "Local map, festival calendar, offer conflict checker, margin floors, upsell pro and referrals.",
    longDescription: "Smarter marketing — local customer heatmap, India-aware festival calendar, offer conflict detection, margin-floor guardrails, advanced upsell prompts and a referral program.",
    icon: "Megaphone",
    category: "growth",
    pricing: { mode: "monthly_yearly", monthlyPrice: 999, yearlyPrice: 9990, currency: "INR" },
    trialDays: 14,
    featureFlags: [
      "mkt_local_map","mkt_festival_calendar","mkt_offer_conflict","mkt_margin_floors","mkt_upsell_pro","mkt_referral_program",
    ],
    comingSoon: false,
    sortOrder: 250,
  },
  {
    key: "pack_delivery",
    name: "Delivery Intelligence Pack",
    description: "Queue manager, pre-order windows, zone profitability and live tracking links.",
    longDescription: "Run delivery like the big aggregators — driver queue with auto-assignment, pre-order windows, per-zone profit tracking and public live-tracking links.",
    icon: "Truck",
    category: "operations",
    pricing: { mode: "monthly_yearly", monthlyPrice: 899, yearlyPrice: 8990, currency: "INR" },
    trialDays: 14,
    featureFlags: ["dlv_queue_manager","dlv_pre_order","dlv_zone_profitability","dlv_live_tracking_link"],
    comingSoon: false,
    sortOrder: 260,
  },
  {
    key: "pack_staff",
    name: "Staff Intelligence Pack",
    description: "Table optimization, tip pooling and the live staff leaderboard TV.",
    longDescription: "Lift covers per shift with table optimization, audit-friendly tip pooling and a live staff leaderboard for the back-of-house TV.",
    icon: "Users",
    category: "operations",
    pricing: { mode: "monthly_yearly", monthlyPrice: 699, yearlyPrice: 6990, currency: "INR" },
    trialDays: 14,
    featureFlags: ["staff_table_optimization","staff_tips","staff_leaderboard_tv"],
    comingSoon: false,
    sortOrder: 270,
  },

  {
    key: "review_booster",
    name: "Review Booster",
    description: "Auto-request Google reviews after every visit.",
    longDescription: "After every dine-in or delivery, auto-send a review request via SMS/WhatsApp/email and route happy customers to Google.",
    icon: "Star",
    category: "growth",
    pricing: { mode: "monthly_yearly", monthlyPrice: 299, yearlyPrice: 2990, currency: "INR" },
    trialDays: 14,
    featureFlags: [],
    comingSoon: true,
    sortOrder: 140,
  },
];

export const ADDON_CATEGORIES: { key: AddonCategory; label: string }[] = [
  { key: "ai", label: "AI" },
  { key: "operations", label: "Operations" },
  { key: "growth", label: "Growth" },
  { key: "integrations", label: "Integrations" },
  { key: "platform", label: "Platform" },
];

export function getCatalogueEntry(key: string): AddonCatalogueEntry | undefined {
  return ADDON_CATALOGUE.find(a => a.key === key);
}
