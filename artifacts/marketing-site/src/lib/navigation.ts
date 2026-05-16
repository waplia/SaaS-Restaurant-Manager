import {
  Terminal, QrCode, ShoppingBag, ChefHat, Utensils, Calendar, Bell, Truck,
  BookOpen, Tag, TrendingUp, Eye, Boxes, ClipboardList, Users, Trash2,
  ReceiptText, Repeat, UserCheck, Heart, Crown, Star, Megaphone, Ticket,
  UserPlus, ClipboardCheck, Briefcase, GraduationCap, Search, IndianRupee,
  Wallet, Banknote, FileText, BarChart3, Sparkles, Store, Building2,
  Coffee, Cake, Hotel, ShoppingCart, Soup,
  Building, Boxes as BoxesIcon, Plug, Cpu, Image as ImageIcon,
  MessageSquare, BrainCircuit, LineChart, Bot, Coins, Newspaper,
  HelpCircle, BookMarked, Scale, Award, Lock, ShieldCheck, FileSpreadsheet,
  type LucideIcon,
} from "lucide-react";

export interface NavLink {
  title: string;
  href: string;
  desc?: string;
  icon?: LucideIcon;
  external?: boolean;
}

export interface NavGroup {
  /** Group title — also acts as link to /features#anchor when anchor is set */
  title: string;
  anchor?: string;
  links: NavLink[];
}

export interface MegaMenu {
  label: string;
  href?: string;
  /** Single column / two column list of links */
  links?: NavLink[];
  /** Multi-column grouped links */
  groups?: NavGroup[];
  /** Bottom CTA inside the dropdown */
  footer?: { label: string; href: string };
}

/* -------------------------------------------------------------------------- */
/* Header mega menus — slim, premium, max 2–4 columns                          */
/* -------------------------------------------------------------------------- */

export const PLATFORM_MENU: MegaMenu = {
  label: "Platform",
  href: "/platform",
  links: [
    { title: "Platform Overview", href: "/platform", desc: "The complete restaurant OS", icon: Sparkles },
    { title: "POS Terminal", href: "/features/pos-terminal", desc: "Lightning-fast billing", icon: Terminal },
    { title: "QR Menu", href: "/features/qr-menu", desc: "Contactless ordering", icon: QrCode },
    { title: "Online Ordering", href: "/features/online-ordering", desc: "Direct delivery & takeout", icon: ShoppingBag },
    { title: "Kitchen / KDS", href: "/features/kitchen-display", desc: "Live ticket flow", icon: ChefHat },
    { title: "Inventory", href: "/features/inventory-management", desc: "Real-time stock", icon: Boxes },
    { title: "Staff & Payroll", href: "/features/payroll", desc: "Attendance & pay", icon: Users },
    { title: "Finance & P&L", href: "/features/finance", desc: "True profit visibility", icon: IndianRupee },
    { title: "Growth Engine", href: "/features/growth-engine", desc: "Campaigns & loyalty", icon: TrendingUp },
    { title: "Khana AI", href: "/khana-ai", desc: "AI for restaurants", icon: BrainCircuit },
    { title: "Reports", href: "/features/reports-analytics", desc: "Every metric, live", icon: BarChart3 },
  ],
  footer: { label: "View Complete Platform →", href: "/platform" },
};

export const FEATURES_MENU: MegaMenu = {
  label: "Features",
  href: "/features",
  groups: [
    { title: "Sell", anchor: "sell", links: [
      { title: "POS Terminal", href: "/features/pos-terminal" },
      { title: "Orders", href: "/features/orders" },
      { title: "Kitchen / KDS", href: "/features/kitchen-display" },
      { title: "Tables", href: "/features/table-management" },
    ]},
    { title: "Menu", anchor: "menu", links: [
      { title: "Menu Management", href: "/features/menu-management" },
      { title: "QR Menu", href: "/features/qr-menu" },
      { title: "Combos & Add-ons", href: "/features/combos-addons" },
      { title: "Dynamic Pricing", href: "/features/dynamic-pricing" },
    ]},
    { title: "Inventory", anchor: "inventory", links: [
      { title: "Stock Management", href: "/features/inventory-management" },
      { title: "Purchase Orders", href: "/features/purchase-orders" },
      { title: "Vendors", href: "/features/vendor-management" },
      { title: "Recipes", href: "/features/recipe-management" },
    ]},
    { title: "Customers", anchor: "customers", links: [
      { title: "Customer CRM", href: "/features/customer-crm" },
      { title: "Feedback", href: "/features/feedback-surveys" },
      { title: "Loyalty", href: "/features/loyalty" },
      { title: "Memberships", href: "/features/memberships" },
    ]},
    { title: "Growth", anchor: "growth", links: [
      { title: "Growth Engine", href: "/features/growth-engine" },
      { title: "Campaigns", href: "/features/campaigns" },
      { title: "Coupons", href: "/features/coupons" },
      { title: "Referrals", href: "/features/referrals" },
    ]},
    { title: "Staff", anchor: "staff", links: [
      { title: "Staff Directory", href: "/features/staff-management" },
      { title: "Attendance", href: "/features/attendance" },
      { title: "Payroll", href: "/features/payroll" },
      { title: "Staff Tasks", href: "/features/staff-tasks" },
    ]},
    { title: "Finance", anchor: "finance", links: [
      { title: "Payments", href: "/features/payments" },
      { title: "Expenses", href: "/features/expenses" },
      { title: "P&L", href: "/features/profit-loss" },
      { title: "Invoices", href: "/features/invoices" },
    ]},
    { title: "Marketplace", anchor: "marketplace", links: [
      { title: "Vendor Marketplace", href: "/features/vendor-marketplace" },
      { title: "Hardware", href: "/features/hardware" },
      { title: "Integrations", href: "/features/integrations" },
      { title: "Add-ons", href: "/features/marketplace" },
    ]},
  ],
  footer: { label: "View All Features →", href: "/features" },
};

export const SOLUTIONS_MENU: MegaMenu = {
  label: "Solutions",
  href: "/solutions",
  links: [
    { title: "Restaurants", href: "/solutions/restaurants", desc: "Full-service dining", icon: Utensils },
    { title: "Cafes", href: "/solutions/cafes", desc: "Coffee & quick-service", icon: Coffee },
    { title: "Cloud Kitchens", href: "/solutions/cloud-kitchens", desc: "Delivery-first brands", icon: ChefHat },
    { title: "Bakeries", href: "/solutions/bakeries", desc: "Pre-orders & batches", icon: Cake },
    { title: "Hotels", href: "/solutions/hotels", desc: "F&B + PMS sync", icon: Hotel },
    { title: "Food Courts", href: "/solutions/food-courts", desc: "Multi-vendor kiosks", icon: ShoppingCart },
    { title: "Tiffin Services", href: "/solutions/tiffin-services", desc: "Subscriptions & routes", icon: Soup },
    { title: "Catering & Banquets", href: "/solutions/catering-banquets", desc: "Events & BEOs", icon: Calendar },
    { title: "Franchise Chains", href: "/solutions/franchise-chains", desc: "Multi-outlet at scale", icon: Building2 },
    { title: "Corporate Canteens", href: "/solutions/corporate-canteens", desc: "Employee dining", icon: Building },
  ],
  footer: { label: "View All Solutions →", href: "/solutions" },
};

export const AI_MENU: MegaMenu = {
  label: "Khana AI",
  href: "/khana-ai",
  links: [
    { title: "Overview", href: "/khana-ai", desc: "AI for restaurants", icon: Sparkles },
    { title: "Menu Import", href: "/khana-ai/menu-import", desc: "Photo → menu in 60s", icon: ImageIcon },
    { title: "Review Booster", href: "/khana-ai/review-booster", desc: "More 5-star reviews", icon: Star },
    { title: "Campaigns", href: "/khana-ai/campaigns", desc: "Smart marketing", icon: Megaphone },
    { title: "Sales Insights", href: "/khana-ai/sales-insights", desc: "Daily intelligence", icon: LineChart },
    { title: "Forecasting", href: "/khana-ai/forecasting", desc: "Predict demand", icon: TrendingUp },
    { title: "Chat Assistant", href: "/khana-ai/chat-assistant", desc: "Ask your data", icon: Bot },
    { title: "Credits", href: "/khana-ai/credits", desc: "Flexible AI billing", icon: Coins },
  ],
  footer: { label: "Explore Khana AI →", href: "/khana-ai" },
};

export const RESOURCES_MENU: MegaMenu = {
  label: "Resources",
  href: "/resources",
  links: [
    { title: "Blog", href: "/blog", desc: "Stories & playbooks", icon: Newspaper },
    { title: "Help Center", href: "/help", desc: "Docs & answers", icon: HelpCircle },
    { title: "Guides", href: "/guides", desc: "Owner playbooks", icon: BookMarked },
    { title: "FAQs", href: "/faq", desc: "Quick answers", icon: HelpCircle },
    { title: "Compare", href: "/compare", desc: "vs. legacy POS", icon: Scale },
    { title: "Case Studies", href: "/case-studies", desc: "Customer stories", icon: Award },
  ],
  footer: { label: "View Resources →", href: "/resources" },
};

export const COMPANY_MENU: MegaMenu = {
  label: "Company",
  href: "/about",
  links: [
    { title: "About", href: "/about", desc: "Our mission", icon: Sparkles },
    { title: "Contact", href: "/contact", desc: "Talk to us", icon: MessageSquare },
    { title: "Security", href: "/security", desc: "Trust & compliance", icon: Lock },
    { title: "Partner Program", href: "/partners", desc: "Resell & integrate", icon: Users },
    { title: "Careers", href: "/careers", desc: "Join the team", icon: Briefcase },
  ],
  footer: { label: "Legal Pages →", href: "/legal" },
};

export const MAIN_MENUS: MegaMenu[] = [
  PLATFORM_MENU,
  FEATURES_MENU,
  SOLUTIONS_MENU,
  AI_MENU,
  RESOURCES_MENU,
  COMPANY_MENU,
];

/* -------------------------------------------------------------------------- */
/* Features directory — used by /features page                                 */
/* -------------------------------------------------------------------------- */

export interface DirectoryFeature {
  slug?: string;       // optional: when set, link to /features/<slug>
  href?: string;       // explicit href override
  title: string;
  desc: string;
  benefit: string;
  icon: LucideIcon;
}

export interface FeatureCategory {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  features: DirectoryFeature[];
}

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  {
    id: "sell",
    title: "Sell",
    description: "Take orders across every channel with the fastest restaurant POS and a unified order feed.",
    icon: Terminal,
    features: [
      { slug: "pos-terminal", title: "POS Terminal", desc: "Lightning-fast billing for dine-in, takeaway and delivery.", benefit: "2× faster billing", icon: Terminal },
      { slug: "orders", title: "Orders", desc: "Unified feed across POS, QR, online and aggregators.", benefit: "Zero missed orders", icon: ShoppingBag },
      { slug: "kitchen-display", title: "Kitchen / KDS", desc: "Color-coded tickets with station routing and timers.", benefit: "30% faster tickets", icon: ChefHat },
      { slug: "table-management", title: "Table Management", desc: "Live floor plan with seat-level billing and transfers.", benefit: "Higher table turn", icon: Utensils },
      { slug: "reservations", title: "Reservations", desc: "Bookings, deposits, waitlist and SMS reminders.", benefit: "60% fewer no-shows", icon: Calendar },
      { slug: "waiter-requests", title: "Waiter Requests", desc: "Guests call waiter, water or bill from the QR menu.", benefit: "Quieter dining room", icon: Bell },
      { slug: "delivery-management", title: "Delivery Management", desc: "Rider dispatch, live tracking and customer ETAs.", benefit: "Higher fulfilment rate", icon: Truck },
    ],
  },
  {
    id: "menu",
    title: "Menu",
    description: "Design, price and publish your menu once — sync everywhere it sells.",
    icon: BookOpen,
    features: [
      { slug: "menu-management", title: "Menu Management", desc: "Central menu across all outlets and channels.", benefit: "One source of truth", icon: BookOpen },
      { slug: "qr-menu", title: "QR Menu", desc: "Beautiful contactless menus with photos and ordering.", benefit: "Higher AOV", icon: QrCode },
      { slug: "combos-addons", title: "Combos & Add-ons", desc: "Build smart combos and upsell modifiers.", benefit: "More upsells", icon: Tag },
      { slug: "dynamic-pricing", title: "Dynamic Pricing", desc: "Time-based, channel-based and event-based pricing.", benefit: "Better margins", icon: TrendingUp },
      { slug: "competitor-tracker", title: "Competitor Tracker", desc: "Track competing prices and promos in your area.", benefit: "Stay competitive", icon: Eye },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    description: "Track stock to the gram, automate purchase orders and tighten food costs.",
    icon: Boxes,
    features: [
      { slug: "inventory-management", title: "Stock Management", desc: "Real-time stock that deducts with every sale.", benefit: "Lower food cost", icon: Boxes },
      { slug: "purchase-orders", title: "Purchase Orders", desc: "Auto-generated POs based on par levels and forecasts.", benefit: "No stock-outs", icon: ClipboardList },
      { slug: "vendor-management", title: "Vendor Management", desc: "Track prices, payments and lead times per supplier.", benefit: "Better terms", icon: Users },
      { slug: "waste-management", title: "Waste Management", desc: "Log wastage with reasons and cost impact.", benefit: "Reduce shrinkage", icon: Trash2 },
      { slug: "recipe-management", title: "Recipe Management", desc: "Cost-per-plate with linked ingredients.", benefit: "Know your margin", icon: ReceiptText },
      { slug: "stock-transfers", title: "Stock Transfers", desc: "Move stock between outlets with full audit trail.", benefit: "Network visibility", icon: Repeat },
    ],
  },
  {
    id: "customers",
    title: "Customers",
    description: "Remember every guest, capture feedback and turn one-time diners into regulars.",
    icon: UserCheck,
    features: [
      { slug: "customer-crm", title: "Customer CRM", desc: "Profiles, preferences, spend history and segments.", benefit: "Personal service", icon: UserCheck },
      { slug: "feedback-surveys", title: "Feedback & Surveys", desc: "Post-meal surveys with NPS and rating routing.", benefit: "Catch issues fast", icon: MessageSquare },
      { slug: "loyalty", title: "Loyalty", desc: "Points, tiers and rewards that actually drive repeat visits.", benefit: "More repeat sales", icon: Heart },
      { slug: "memberships", title: "Memberships", desc: "Paid memberships with perks and priority booking.", benefit: "Predictable revenue", icon: Crown },
      { slug: "review-booster", title: "Review Booster", desc: "Auto-route happy guests to Google reviews.", benefit: "Higher star rating", icon: Star },
    ],
  },
  {
    id: "growth",
    title: "Growth",
    description: "Fill quiet hours, run targeted campaigns and bring back lapsed guests.",
    icon: TrendingUp,
    features: [
      { slug: "growth-engine", title: "Growth Engine", desc: "All your marketing channels in one playbook.", benefit: "Lower CAC", icon: TrendingUp },
      { slug: "campaigns", title: "Campaigns", desc: "WhatsApp, SMS, email and push from one place.", benefit: "Higher reach", icon: Megaphone },
      { slug: "coupons", title: "Coupons", desc: "Smart coupons with rules, caps and attribution.", benefit: "Trackable promos", icon: Ticket },
      { slug: "referrals", title: "Referrals", desc: "Referral programs that compound your loyal base.", benefit: "Word-of-mouth growth", icon: UserPlus },
    ],
  },
  {
    id: "khana-ai",
    title: "Khana AI",
    description: "AI tools built for restaurant ops — menus, reviews, campaigns, forecasting and more.",
    icon: BrainCircuit,
    features: [
      { href: "/khana-ai", title: "Khana AI Overview", desc: "Your AI co-pilot for restaurant operations.", benefit: "Run smarter", icon: Sparkles },
      { href: "/khana-ai/menu-import", title: "AI Menu Import", desc: "Snap a menu photo, get a structured digital menu in 60s.", benefit: "Save days of setup", icon: ImageIcon },
      { href: "/khana-ai/review-booster", title: "AI Review Booster", desc: "Auto-reply and route reviews using your brand voice.", benefit: "More 5-star reviews", icon: Star },
      { href: "/khana-ai/campaigns", title: "AI Campaigns", desc: "Generate, target and time campaigns automatically.", benefit: "Higher conversion", icon: Megaphone },
      { href: "/khana-ai/sales-insights", title: "AI Sales Insights", desc: "Daily intelligence on what's working and what's not.", benefit: "Faster decisions", icon: LineChart },
      { href: "/khana-ai/forecasting", title: "AI Forecasting", desc: "Predict demand by item, hour and outlet.", benefit: "Cut over-prep", icon: TrendingUp },
      { href: "/khana-ai/chat-assistant", title: "AI Chat Assistant", desc: "Ask your data anything in plain English.", benefit: "Instant answers", icon: Bot },
      { href: "/khana-ai/credits", title: "AI Credits", desc: "Flexible pay-as-you-go billing for AI features.", benefit: "Predictable AI spend", icon: Coins },
    ],
  },
  {
    id: "staff",
    title: "Staff",
    description: "Hire, schedule, train and pay your team without spreadsheets.",
    icon: Users,
    features: [
      { slug: "staff-management", title: "Staff Directory", desc: "Profiles, roles, documents and shifts in one place.", benefit: "Less paperwork", icon: Users },
      { slug: "attendance", title: "Attendance", desc: "Biometric, QR and geo-fenced clock-ins.", benefit: "Accurate hours", icon: ClipboardCheck },
      { slug: "payroll", title: "Payroll", desc: "Auto-calculated pay with statutory compliance.", benefit: "On-time payouts", icon: Briefcase },
      { slug: "staff-tasks", title: "Staff Tasks", desc: "Opening, closing and shift-change checklists.", benefit: "Consistent ops", icon: ClipboardList },
      { slug: "sop-training", title: "SOP & Training", desc: "Standardize service with built-in training modules.", benefit: "Faster onboarding", icon: GraduationCap },
      { slug: "mystery-audits", title: "Mystery Audits", desc: "Schedule audits and track service quality scores.", benefit: "Tighter service", icon: Search },
    ],
  },
  {
    id: "finance",
    title: "Finance",
    description: "Real P&L by outlet, payment reconciliation and end-to-end expense tracking.",
    icon: IndianRupee,
    features: [
      { slug: "finance", title: "Finance & P&L", desc: "True profit visibility across every outlet.", benefit: "Outlet-level P&L", icon: IndianRupee },
      { slug: "payments", title: "Payments", desc: "All payment methods, one reconciled view.", benefit: "No more matching", icon: IndianRupee },
      { slug: "expenses", title: "Expenses", desc: "Track every rupee out, with photo proof.", benefit: "Catch leaks", icon: ReceiptText },
      { slug: "wallet", title: "Wallet", desc: "Brand wallet for customer credit and refunds.", benefit: "Keep money inside", icon: Wallet },
      { slug: "settlements", title: "Settlements", desc: "Aggregator and gateway settlements reconciled daily.", benefit: "Cleaner books", icon: Banknote },
      { slug: "profit-loss", title: "Profit & Loss", desc: "Live P&L with cost-of-goods and labor splits.", benefit: "Daily clarity", icon: FileSpreadsheet },
      { slug: "invoices", title: "Invoices", desc: "GST-compliant invoices for B2B and catering.", benefit: "Faster payment", icon: FileText },
    ],
  },
  {
    id: "operations",
    title: "Operations",
    description: "Specialized ops for hotels, food courts, events, corporate ordering and tiffin services.",
    icon: Hotel,
    features: [
      { href: "/solutions/catering-banquets", title: "Events & Catering", desc: "BEOs, deposits and on-site execution.", benefit: "Scale events", icon: Calendar },
      { href: "/solutions/hotels", title: "Hotel Mode", desc: "Room posting, PMS sync and outlet routing.", benefit: "Cleaner hotel F&B", icon: Hotel },
      { href: "/solutions/food-courts", title: "Food Court", desc: "Multi-vendor billing, kiosks and settlements.", benefit: "Unified food court", icon: ShoppingCart },
      { href: "/solutions/corporate-canteens", title: "Corporate Ordering", desc: "Employee meal credits and pre-orders.", benefit: "Happy employees", icon: Building },
      { href: "/solutions/tiffin-services", title: "Tiffin Management", desc: "Subscriptions, routing and recurring payments.", benefit: "Reliable tiffin ops", icon: Soup },
    ],
  },
  {
    id: "marketplace",
    title: "Marketplace",
    description: "Extend your platform with vendors, hardware and integrations.",
    icon: Store,
    features: [
      { slug: "vendor-marketplace", title: "Vendor Marketplace", desc: "Discover trusted ingredient and supply vendors.", benefit: "Better procurement", icon: Store },
      { slug: "marketplace", title: "Add-ons", desc: "Plug in feature add-ons built by partners.", benefit: "Extend KhanaLagao", icon: BoxesIcon },
      { slug: "hardware", title: "Hardware", desc: "Certified printers, scanners, KDS screens and bundles.", benefit: "Works out of box", icon: Cpu },
      { slug: "integrations", title: "Integrations", desc: "Aggregators, accounting, payments and CRMs.", benefit: "No silos", icon: Plug },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    description: "Live dashboards and exports across sales, ops, staff and finance — plus SaaS controls.",
    icon: BarChart3,
    features: [
      { slug: "reports-analytics", title: "Reports & Analytics", desc: "Live dashboards across sales, ops, staff and finance.", benefit: "Every metric, live", icon: BarChart3 },
      { slug: "super-admin", title: "Super Admin SaaS", desc: "Multi-tenant control plane for groups and franchises.", benefit: "SaaS-grade controls", icon: ShieldCheck },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Footer — keeps the longer link lists, organized                             */
/* -------------------------------------------------------------------------- */

export const FOOTER_COLUMNS: { title: string; links: NavLink[] }[] = [
  { title: "Product", links: [
    { title: "Platform Overview", href: "/platform" },
    { title: "POS Terminal", href: "/features/pos-terminal" },
    { title: "QR Menu", href: "/features/qr-menu" },
    { title: "Online Ordering", href: "/features/online-ordering" },
    { title: "Kitchen Display", href: "/features/kitchen-display" },
    { title: "Inventory", href: "/features/inventory-management" },
    { title: "Staff & Payroll", href: "/features/payroll" },
    { title: "Finance", href: "/features/finance" },
    { title: "Reports", href: "/features/reports-analytics" },
  ]},
  { title: "Khana AI", links: [
    { title: "AI Menu Import", href: "/khana-ai/menu-import" },
    { title: "AI Review Booster", href: "/khana-ai/review-booster" },
    { title: "AI Campaigns", href: "/khana-ai/campaigns" },
    { title: "AI Insights", href: "/khana-ai/sales-insights" },
    { title: "AI Forecasting", href: "/khana-ai/forecasting" },
    { title: "AI Chat", href: "/khana-ai/chat-assistant" },
    { title: "AI Credits", href: "/khana-ai/credits" },
  ]},
  { title: "Solutions", links: [
    { title: "Restaurants", href: "/solutions/restaurants" },
    { title: "Cafes", href: "/solutions/cafes" },
    { title: "Cloud Kitchens", href: "/solutions/cloud-kitchens" },
    { title: "Bakeries", href: "/solutions/bakeries" },
    { title: "Hotels", href: "/solutions/hotels" },
    { title: "Food Courts", href: "/solutions/food-courts" },
    { title: "Tiffin Services", href: "/solutions/tiffin-services" },
    { title: "Catering", href: "/solutions/catering-banquets" },
    { title: "Franchise Chains", href: "/solutions/franchise-chains" },
  ]},
  { title: "Growth", links: [
    { title: "Growth Engine", href: "/features/growth-engine" },
    { title: "Campaigns", href: "/features/campaigns" },
    { title: "Coupons", href: "/features/coupons" },
    { title: "Loyalty", href: "/features/loyalty" },
    { title: "Review Booster", href: "/features/review-booster" },
    { title: "Customer Segments", href: "/features/customer-crm" },
  ]},
  { title: "Resources", links: [
    { title: "Blog", href: "/blog" },
    { title: "Help Center", href: "/help" },
    { title: "Guides", href: "/guides" },
    { title: "FAQ", href: "/faq" },
    { title: "Compare", href: "/compare" },
    { title: "Security", href: "/security" },
    { title: "Partner Program", href: "/partners" },
  ]},
  { title: "Company", links: [
    { title: "About", href: "/about" },
    { title: "Contact", href: "/contact" },
    { title: "Careers", href: "/careers" },
    { title: "Partners", href: "/partners" },
    { title: "Book Demo", href: "/book-demo" },
  ]},
  { title: "Legal", links: [
    { title: "Privacy Policy", href: "/privacy-policy" },
    { title: "Terms & Conditions", href: "/terms" },
    { title: "Refund Policy", href: "/refund-policy" },
    { title: "Cookie Policy", href: "/cookie-policy" },
    { title: "Data Processing", href: "/data-processing-agreement" },
    { title: "Acceptable Use", href: "/acceptable-use-policy" },
  ]},
];
