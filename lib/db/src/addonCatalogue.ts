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
    description: "Your own branded customer mobile app on iOS & Android.",
    longDescription: "Publish a customer mobile app under your own brand on the App Store and Play Store. Includes ordering, loyalty and push notifications.",
    icon: "Smartphone",
    category: "platform",
    pricing: { mode: "monthly_yearly", monthlyPrice: 2499, yearlyPrice: 24990, currency: "INR" },
    trialDays: 0,
    featureFlags: [],
    comingSoon: true,
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
