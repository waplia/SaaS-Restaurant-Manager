import {
  Terminal, QrCode, ShoppingBag, ChefHat, Utensils, Calendar, Bell, Truck,
  BookOpen, Tag, TrendingUp, Eye, Boxes, ClipboardList, Users, Trash2,
  ReceiptText, Repeat, UserCheck, Heart, Crown, Star, Megaphone, Ticket,
  UserPlus, ClipboardCheck, Briefcase, GraduationCap, Search, IndianRupee,
  Wallet, Banknote, FileText, BarChart3, Sparkles, Store, Building2,
  Coffee, Cake, Beer, Hotel, ShoppingCart, Soup, Utensils as UtensilsIcon,
  Building, School, Boxes as BoxesIcon, Plug, Cpu, Image as ImageIcon,
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
  title: string;
  links: NavLink[];
}

export interface MegaMenu {
  label: string;
  href?: string;
  /** Single column of links (no grouping) */
  links?: NavLink[];
  /** Multi-column grouped links */
  groups?: NavGroup[];
  /** Optional promo block on the right */
  promo?: { title: string; desc: string; href: string; cta: string };
}

export const PLATFORM_MENU: MegaMenu = {
  label: "Platform",
  href: "/platform",
  links: [
    { title: "Platform Overview", href: "/platform", desc: "The complete restaurant OS", icon: Sparkles },
    { title: "Restaurant POS", href: "/features/pos-terminal", desc: "Lightning-fast billing", icon: Terminal },
    { title: "QR Menu", href: "/features/qr-menu", desc: "Contactless ordering", icon: QrCode },
    { title: "Online Ordering", href: "/features/online-ordering", desc: "Direct delivery & takeout", icon: ShoppingBag },
    { title: "Kitchen Display / KOT", href: "/features/kitchen-display", desc: "Live ticket flow", icon: ChefHat },
    { title: "Table Management", href: "/features/table-management", desc: "Floor & reservations", icon: Utensils },
    { title: "Inventory", href: "/features/inventory-management", desc: "Real-time stock", icon: Boxes },
    { title: "Staff & Payroll", href: "/features/payroll", desc: "Attendance & pay", icon: Users },
    { title: "Finance & P&L", href: "/features/finance", desc: "True profit visibility", icon: IndianRupee },
    { title: "Growth Engine", href: "/features/growth-engine", desc: "Campaigns & loyalty", icon: TrendingUp },
    { title: "Khana AI", href: "/khana-ai", desc: "AI for restaurants", icon: BrainCircuit },
    { title: "Reports & Analytics", href: "/features/reports-analytics", desc: "Every metric, live", icon: BarChart3 },
    { title: "Super Admin SaaS", href: "/features/super-admin", desc: "Multi-tenant control", icon: ShieldCheck },
  ],
  promo: {
    title: "See the full platform",
    desc: "Watch a 4-minute walkthrough of how every module connects.",
    href: "/book-demo",
    cta: "Book a live demo",
  },
};

export const FEATURES_MENU: MegaMenu = {
  label: "Features",
  href: "/features",
  groups: [
    { title: "Sell", links: [
      { title: "POS Terminal", href: "/features/pos-terminal", icon: Terminal },
      { title: "Orders", href: "/features/orders", icon: ShoppingBag },
      { title: "Kitchen / KDS", href: "/features/kitchen-display", icon: ChefHat },
      { title: "Tables", href: "/features/table-management", icon: Utensils },
      { title: "Reservations", href: "/features/reservations", icon: Calendar },
      { title: "Waiter Requests", href: "/features/waiter-requests", icon: Bell },
      { title: "Delivery Management", href: "/features/delivery-management", icon: Truck },
    ]},
    { title: "Menu", links: [
      { title: "Menu Management", href: "/features/menu-management", icon: BookOpen },
      { title: "QR Menu", href: "/features/qr-menu", icon: QrCode },
      { title: "Combos & Add-ons", href: "/features/combos-addons", icon: Tag },
      { title: "Dynamic Pricing", href: "/features/dynamic-pricing", icon: TrendingUp },
      { title: "Competitor Tracker", href: "/features/competitor-tracker", icon: Eye },
    ]},
    { title: "Inventory", links: [
      { title: "Stock Management", href: "/features/inventory-management", icon: Boxes },
      { title: "Purchase Orders", href: "/features/purchase-orders", icon: ClipboardList },
      { title: "Vendors", href: "/features/vendor-management", icon: Users },
      { title: "Waste Management", href: "/features/waste-management", icon: Trash2 },
      { title: "Recipes", href: "/features/recipe-management", icon: ReceiptText },
      { title: "Stock Transfers", href: "/features/stock-transfers", icon: Repeat },
    ]},
    { title: "Customers", links: [
      { title: "CRM", href: "/features/customer-crm", icon: UserCheck },
      { title: "Feedback & Surveys", href: "/features/feedback-surveys", icon: MessageSquare },
      { title: "Loyalty", href: "/features/loyalty", icon: Heart },
      { title: "Memberships", href: "/features/memberships", icon: Crown },
      { title: "Review Booster", href: "/features/review-booster", icon: Star },
    ]},
    { title: "Growth", links: [
      { title: "Growth Engine", href: "/features/growth-engine", icon: TrendingUp },
      { title: "Campaigns", href: "/features/campaigns", icon: Megaphone },
      { title: "Coupons", href: "/features/coupons", icon: Ticket },
      { title: "Referrals", href: "/features/referrals", icon: UserPlus },
      { title: "Loyalty Analytics", href: "/features/loyalty", icon: LineChart },
    ]},
    { title: "Staff", links: [
      { title: "Staff Directory", href: "/features/staff-management", icon: Users },
      { title: "Attendance", href: "/features/attendance", icon: ClipboardCheck },
      { title: "Payroll", href: "/features/payroll", icon: Briefcase },
      { title: "Staff Tasks", href: "/features/staff-tasks", icon: ClipboardList },
      { title: "SOP & Training", href: "/features/sop-training", icon: GraduationCap },
      { title: "Mystery Audits", href: "/features/mystery-audits", icon: Search },
    ]},
    { title: "Finance", links: [
      { title: "Payments", href: "/features/payments", icon: IndianRupee },
      { title: "Expenses", href: "/features/expenses", icon: ReceiptText },
      { title: "Wallet", href: "/features/wallet", icon: Wallet },
      { title: "Settlements", href: "/features/settlements", icon: Banknote },
      { title: "P&L", href: "/features/profit-loss", icon: FileSpreadsheet },
      { title: "Invoices", href: "/features/invoices", icon: FileText },
    ]},
    { title: "Operations", links: [
      { title: "Events & Catering", href: "/solutions/events-catering", icon: Calendar },
      { title: "Hotel Mode", href: "/solutions/hotel-mode", icon: Hotel },
      { title: "Food Court", href: "/solutions/food-court-management", icon: ShoppingCart },
      { title: "Corporate Ordering", href: "/solutions/corporate-ordering", icon: Building },
      { title: "Tiffin Management", href: "/solutions/tiffin-management", icon: Soup },
    ]},
    { title: "Marketplace", links: [
      { title: "Vendor Marketplace", href: "/features/vendor-marketplace", icon: Store },
      { title: "Add-ons", href: "/features/marketplace", icon: BoxesIcon },
      { title: "Hardware", href: "/features/hardware", icon: Cpu },
      { title: "Integrations", href: "/features/integrations", icon: Plug },
    ]},
    { title: "Insights", links: [
      { title: "Reports & Analytics", href: "/features/reports-analytics", icon: BarChart3 },
      { title: "Super Admin SaaS", href: "/features/super-admin", icon: ShieldCheck },
    ]},
  ],
};

export const SOLUTIONS_MENU: MegaMenu = {
  label: "Solutions",
  href: "/solutions",
  links: [
    { title: "Restaurants", href: "/solutions/restaurants", desc: "Full-service dining", icon: Utensils },
    { title: "Cafes", href: "/solutions/cafes", desc: "Coffee & quick-service", icon: Coffee },
    { title: "Cloud Kitchens", href: "/solutions/cloud-kitchens", desc: "Delivery-first brands", icon: ChefHat },
    { title: "Bakeries", href: "/solutions/bakeries", desc: "Pre-orders & batches", icon: Cake },
    { title: "Bars & Pubs", href: "/solutions/bars-pubs", desc: "Tabs & pour cost", icon: Beer },
    { title: "Hotels", href: "/solutions/hotels", desc: "F&B + PMS sync", icon: Hotel },
    { title: "Food Courts", href: "/solutions/food-courts", desc: "Multi-vendor kiosks", icon: ShoppingCart },
    { title: "Tiffin Services", href: "/solutions/tiffin-services", desc: "Subscriptions & routes", icon: Soup },
    { title: "Catering & Banquets", href: "/solutions/catering-banquets", desc: "Events & BEOs", icon: Calendar },
    { title: "Franchise Chains", href: "/solutions/franchise-chains", desc: "Multi-outlet at scale", icon: Building2 },
    { title: "Corporate Canteens", href: "/solutions/corporate-canteens", desc: "Employee dining", icon: Building },
    { title: "School / College", href: "/solutions/school-college-canteens", desc: "Campus food services", icon: School },
  ],
};

export const AI_MENU: MegaMenu = {
  label: "Khana AI",
  href: "/khana-ai",
  links: [
    { title: "Khana AI Overview", href: "/khana-ai", desc: "AI for restaurants", icon: Sparkles },
    { title: "AI Menu Import", href: "/khana-ai/menu-import", desc: "Photo → menu in 60s", icon: ImageIcon },
    { title: "AI Descriptions", href: "/khana-ai/descriptions", desc: "Mouth-watering copy", icon: FileText },
    { title: "AI Food Images", href: "/khana-ai/food-images", desc: "Studio plates on demand", icon: ImageIcon },
    { title: "AI Review Booster", href: "/khana-ai/review-booster", desc: "More 5-star reviews", icon: Star },
    { title: "AI Campaigns", href: "/khana-ai/campaigns", desc: "Smart marketing", icon: Megaphone },
    { title: "AI Sales Insights", href: "/khana-ai/sales-insights", desc: "Daily intelligence", icon: LineChart },
    { title: "AI Forecasting", href: "/khana-ai/forecasting", desc: "Predict demand", icon: TrendingUp },
    { title: "AI Chat Assistant", href: "/khana-ai/chat-assistant", desc: "Ask your data", icon: Bot },
    { title: "AI Credits", href: "/khana-ai/credits", desc: "Flexible AI billing", icon: Coins },
  ],
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
    { title: "Partner Program", href: "/partners", desc: "Resell & integrate", icon: Users },
  ],
};

export const COMPANY_MENU: MegaMenu = {
  label: "Company",
  href: "/about",
  links: [
    { title: "About", href: "/about", desc: "Our mission", icon: Sparkles },
    { title: "Contact", href: "/contact", desc: "Talk to us", icon: MessageSquare },
    { title: "Security", href: "/security", desc: "Trust & compliance", icon: Lock },
    { title: "Careers", href: "/careers", desc: "Join the team", icon: Users },
    { title: "Privacy Policy", href: "/privacy-policy", icon: ShieldCheck },
    { title: "Terms & Conditions", href: "/terms", icon: Scale },
    { title: "Refund Policy", href: "/refund-policy", icon: FileText },
    { title: "Cookie Policy", href: "/cookie-policy", icon: FileText },
  ],
};

export const MAIN_MENUS: MegaMenu[] = [
  PLATFORM_MENU,
  FEATURES_MENU,
  SOLUTIONS_MENU,
  AI_MENU,
  RESOURCES_MENU,
  COMPANY_MENU,
];

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
