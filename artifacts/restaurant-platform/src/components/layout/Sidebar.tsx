import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, ShoppingCart, ChefHat, UtensilsCrossed,
  Package, Users, UserCheck, BarChart3, Table2, Settings,
  Flame, Sun, Moon, LogOut, ShieldCheck, Monitor, Receipt, Wallet, AlertCircle, AlertTriangle, Trash2,
  ChevronDown, Coins, TrendingUp, Percent, Truck, Banknote, BellRing, CalendarDays, Inbox, FileText, LifeBuoy,
  Sparkles, ImageIcon, Upload, History, Megaphone, Folder, BookOpen, GraduationCap, ScrollText, PartyPopper, Cake, Leaf, Award,
  Soup, Wine, ClipboardCheck, Eye, Building2, Gift, MessageSquare, Search, Zap, Plus, Smartphone, CreditCard,
} from "lucide-react";
import { useWaiterRequests } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useAppSettings } from "@/lib/appSettings";
import { resolveImageUrl } from "@/components/ImageUploadField";
import { NotificationDropdown } from "./NotificationDropdown";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { isFeatureEnabled } from "@workspace/db/planFeatures";

type IconType = typeof LayoutDashboard;
/**
 * A planGate is either one of the two AI pseudo-gates (which check the /ai/wallet
 * response) or any boolean feature key from PLAN_BOOLEAN_FEATURES. Locked links
 * deep-link to /pricing?feature=<resolved feature key>.
 */
type PlanGate = string;
type BadgeKind = "new" | "ai" | "premium" | "addon" | "beta";
function gateToFeatureKey(gate: PlanGate): string {
  if (gate === "ai") return "khana_ai_enabled";
  if (gate === "ai_insights") return "khana_ai_insights_enabled";
  return gate;
}
type LinkItem = {
  kind: "link";
  href: string;
  label: string;
  icon: IconType;
  roles?: string[];
  planGate?: PlanGate;
  requiresDocsAccess?: boolean;
  requiresBakeryMode?: boolean;
  requiresBarMode?: boolean;
  requiresCanteenMode?: boolean;
  badge?: BadgeKind;
  /** Runtime flag set by passesPlanGate; when true the link points to /pricing. */
  locked?: boolean;
  lockedFeatureKey?: string;
};
type GroupItem = {
  kind: "group";
  key: string;
  label: string;
  icon: IconType;
  children: LinkItem[];
  badge?: BadgeKind;
  planGate?: PlanGate;
  roles?: string[];
};
type NavEntry = LinkItem | GroupItem;

const navConfig: NavEntry[] = [
  // 1. Dashboard
  { kind: "link", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },

  // 2. Sell
  {
    kind: "group", key: "sell", label: "Sell", icon: ShoppingCart,
    children: [
      { kind: "link", href: "/pos", label: "POS Terminal", icon: Monitor, planGate: "kitchen_display" },
      { kind: "link", href: "/sell/handheld-pos", label: "Handheld POS", icon: Smartphone, roles: ["owner", "manager", "waiter", "cashier"], planGate: "handheld_pos", badge: "premium" },
      { kind: "link", href: "/orders", label: "Orders", icon: ShoppingCart },
      { kind: "link", href: "/kitchen", label: "Kitchen / KDS", icon: ChefHat, planGate: "kitchen_display" },
      { kind: "link", href: "/tables", label: "Tables", icon: Table2 },
      { kind: "link", href: "/reservations", label: "Reservations", icon: CalendarDays, planGate: "reservations" },
      { kind: "link", href: "/waiter-requests", label: "Waiter Requests", icon: BellRing, roles: ["owner", "manager", "waiter"] },
      { kind: "link", href: "/delivery/executives", label: "Delivery Executives", icon: Truck, roles: ["owner", "manager"], planGate: "delivery_module" },
      { kind: "link", href: "/delivery/cod", label: "COD Monitoring", icon: Banknote, roles: ["owner", "manager"], planGate: "delivery_module" },
      { kind: "link", href: "/tokens", label: "Tokens", icon: BellRing, roles: ["owner", "manager", "waiter", "cashier", "kitchen"] },
    ],
  },

  // 3. Menu
  {
    kind: "group", key: "menu", label: "Menu", icon: UtensilsCrossed,
    children: [
      { kind: "link", href: "/menu", label: "Menu Items", icon: UtensilsCrossed },
      { kind: "link", href: "/menu/pricing-rules", label: "Pricing Rules", icon: Percent, roles: ["owner", "manager"] },
      { kind: "link", href: "/menu/pricing-optimizer", label: "Cost & Price Optimizer", icon: Flame, roles: ["owner", "manager"], badge: "ai" },
      { kind: "link", href: "/competitors", label: "Competitor Tracker", icon: Eye, roles: ["owner", "manager"], badge: "premium" },
      // ── Menu Intelligence pack (Task #365) ──
      { kind: "link", href: "/menu/heatmap",          label: "Menu Heatmap",        icon: TrendingUp,    roles: ["owner", "manager"], planGate: "menu_heatmap",          badge: "premium" },
      { kind: "link", href: "/menu/ab-tests",         label: "A/B Tests",           icon: Zap,           roles: ["owner", "manager"], planGate: "menu_ab_tests",         badge: "premium" },
      { kind: "link", href: "/menu/search-analytics", label: "Search Analytics",    icon: Search,        roles: ["owner", "manager"], planGate: "menu_search_analytics", badge: "premium" },
      { kind: "link", href: "/menu/modifier-builder", label: "Modifier Builder",    icon: Plus,          roles: ["owner", "manager"], planGate: "menu_modifier_builder", badge: "premium" },
      { kind: "link", href: "/menu/taste-profiles",   label: "Taste Profiles",      icon: Flame,         roles: ["owner", "manager"], planGate: "menu_taste_profiles",   badge: "premium" },
      { kind: "link", href: "/menu/group-qr",         label: "Group Ordering QR",   icon: Users,         roles: ["owner", "manager"], planGate: "menu_group_qr",         badge: "premium" },
      { kind: "link", href: "/menu/split-cart",       label: "Split Cart",          icon: Receipt,       roles: ["owner", "manager"], planGate: "menu_split_cart",       badge: "premium" },
      { kind: "link", href: "/menu/lifecycle",        label: "Item Lifecycle",      icon: ClipboardCheck,roles: ["owner", "manager"], planGate: "menu_lifecycle",        badge: "premium" },
      { kind: "link", href: "/menu/launches",         label: "Launch Tracker",      icon: Sparkles,      roles: ["owner", "manager"], planGate: "menu_launch_tracker",   badge: "premium" },
      { kind: "link", href: "/menu/photo-approvals",  label: "Photo Approvals",     icon: ImageIcon,     roles: ["owner", "manager"], planGate: "menu_photo_approval",   badge: "premium" },
      { kind: "link", href: "/menu/brand-assets",     label: "Brand Assets",        icon: Folder,        roles: ["owner", "manager"], planGate: "menu_brand_assets",     badge: "premium" },
    ],
  },

  // 4. Inventory
  {
    kind: "group", key: "inventory", label: "Inventory", icon: Package,
    children: [
      { kind: "link", href: "/inventory", label: "Stock", icon: Package, planGate: "inventory_management" },
      { kind: "link", href: "/waste", label: "Waste", icon: Trash2, roles: ["owner", "manager", "kitchen", "waiter", "cashier"], planGate: "inventory_management" },
      { kind: "link", href: "/documents", label: "Documents", icon: Folder, requiresDocsAccess: true },
      // ── Inventory Control pack (Task #365) ──
      { kind: "link", href: "/inventory/packaging",       label: "Packaging Inventory",  icon: Package,    roles: ["owner", "manager"], planGate: "inv_packaging",         badge: "premium" },
      { kind: "link", href: "/inventory/condiments",      label: "Condiment Tracking",   icon: Soup,       roles: ["owner", "manager"], planGate: "inv_condiments",        badge: "premium" },
      { kind: "link", href: "/inventory/portion-drift",   label: "Portion Drift",        icon: AlertTriangle, roles: ["owner", "manager"], planGate: "inv_portion_drift", badge: "premium" },
      { kind: "link", href: "/inventory/recipe-versions", label: "Recipe Versions",      icon: History,    roles: ["owner", "manager"], planGate: "inv_recipe_versioning", badge: "premium" },
      { kind: "link", href: "/inventory/vendor-invoices", label: "Vendor Invoices OCR",  icon: FileText,   roles: ["owner", "manager"], planGate: "inv_vendor_invoice_ocr", badge: "premium" },
    ],
  },

  // 5. Customers
  {
    kind: "group", key: "customers", label: "Customers", icon: Users,
    children: [
      { kind: "link", href: "/customers", label: "CRM", icon: Users },
      { kind: "link", href: "/surveys", label: "Feedback & Surveys", icon: MessageSquare, roles: ["owner", "manager"] },
      { kind: "link", href: "/memberships", label: "Memberships", icon: Receipt, roles: ["owner", "manager", "waiter", "super_admin"], planGate: "loyalty_program" },
      { kind: "link", href: "/loyalty/analytics", label: "Loyalty Analytics", icon: Award, roles: ["owner", "manager"], planGate: "loyalty_program" },
      { kind: "link", href: "/ai/review-qrs", label: "Review Booster", icon: Sparkles, roles: ["owner", "manager"], planGate: "ai", badge: "ai" },
      { kind: "link", href: "/settings/loyalty", label: "Loyalty Settings", icon: Award, roles: ["owner", "manager"], planGate: "loyalty_program" },
      // ── Customer Intelligence pack (Task #365) ──
      { kind: "link", href: "/customers/vip-alerts",       label: "VIP Alerts",            icon: BellRing,      roles: ["owner", "manager"], planGate: "cust_vip_alerts",          badge: "premium" },
      { kind: "link", href: "/customers/blacklist",        label: "Guest Blacklist",       icon: ShieldCheck,   roles: ["owner", "manager"], planGate: "cust_blacklist",           badge: "premium" },
      { kind: "link", href: "/customers/mood",             label: "Mood Tracker",          icon: MessageSquare, roles: ["owner", "manager"], planGate: "cust_mood",                badge: "premium" },
      { kind: "link", href: "/customers/complaints",       label: "Complaint Escalation",  icon: AlertTriangle, roles: ["owner", "manager"], planGate: "cust_complaint_escalation",badge: "premium" },
      { kind: "link", href: "/customers/repeat-detector",  label: "Repeat Detector",       icon: Eye,           roles: ["owner", "manager"], planGate: "cust_repeat_detector",     badge: "premium" },
      { kind: "link", href: "/customers/visit-calendar",   label: "Visit Calendar",        icon: CalendarDays,  roles: ["owner", "manager"], planGate: "cust_visit_calendar",      badge: "premium" },
      { kind: "link", href: "/customers/order-status",     label: "Live Order Status",     icon: TrendingUp,    roles: ["owner", "manager"], planGate: "cust_live_order_status",   badge: "premium" },
      { kind: "link", href: "/customers/lost-sales",       label: "Lost Sales",            icon: AlertCircle,   roles: ["owner", "manager"], planGate: "cust_lost_sales",          badge: "premium" },
      { kind: "link", href: "/customers/abandoned-carts",  label: "Abandoned Carts",       icon: Inbox,         roles: ["owner", "manager"], planGate: "cust_abandoned_cart",      badge: "premium" },
    ],
  },

  // 6. Growth Engine
  {
    kind: "group", key: "growth", label: "Growth Engine", icon: Megaphone, badge: "premium",
    roles: ["owner", "manager"],
    children: [
      { kind: "link", href: "/growth", label: "Campaigns", icon: Megaphone, roles: ["owner", "manager"], planGate: "advanced_reports" },
      { kind: "link", href: "/settings/discounts", label: "Coupons & Discounts", icon: Percent, roles: ["owner", "manager"], planGate: "discounts_promotions" },
      { kind: "link", href: "/loyalty/analytics", label: "Loyalty Analytics", icon: Award, roles: ["owner", "manager"], planGate: "loyalty_program" },
      { kind: "link", href: "/ai/feedback-wall", label: "Feedback Wall", icon: Sparkles, roles: ["owner", "manager"], planGate: "ai", badge: "ai" },
      { kind: "link", href: "/ai/feedback-recovery", label: "Recovery Campaigns", icon: AlertTriangle, roles: ["owner", "manager"], planGate: "ai", badge: "ai" },
      // ── Marketing pack (Task #365) ──
      { kind: "link", href: "/growth/local-map",         label: "Local Customer Map", icon: Eye,        roles: ["owner", "manager"], planGate: "mkt_local_map",        badge: "premium" },
      { kind: "link", href: "/growth/festival-calendar", label: "Festival Calendar",  icon: CalendarDays, roles: ["owner", "manager"], planGate: "mkt_festival_calendar", badge: "premium" },
      { kind: "link", href: "/growth/offer-conflicts",   label: "Offer Conflicts",    icon: AlertTriangle, roles: ["owner", "manager"], planGate: "mkt_offer_conflict",  badge: "premium" },
      { kind: "link", href: "/growth/margin-floors",     label: "Margin Floors",      icon: Percent,    roles: ["owner", "manager"], planGate: "mkt_margin_floors",    badge: "premium" },
      { kind: "link", href: "/growth/upsell-pro",        label: "Upsell Pro",         icon: TrendingUp, roles: ["owner", "manager"], planGate: "mkt_upsell_pro",       badge: "premium" },
      { kind: "link", href: "/growth/referrals",         label: "Referral Program",   icon: Award,      roles: ["owner", "manager"], planGate: "mkt_referral_program", badge: "premium" },
    ],
  },

  // 7. Khana AI
  {
    kind: "group", key: "khana_ai", label: "Khana AI", icon: Sparkles, badge: "ai",
    children: [
      { kind: "link", href: "/ai", label: "Dashboard", icon: LayoutDashboard, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/menu-import", label: "AI Menu Import", icon: Upload, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/menu-import/history", label: "Import History", icon: History, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/descriptions", label: "AI Descriptions", icon: FileText, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/images", label: "AI Food Images", icon: ImageIcon, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/review-qrs", label: "Review QRs", icon: Sparkles, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/review-replies", label: "Review Replies", icon: FileText, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/upsell", label: "Upsell Engine", icon: TrendingUp, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/insights", label: "Sales Insights", icon: TrendingUp, roles: ["owner", "manager"], planGate: "ai_insights" },
      { kind: "link", href: "/ai/forecast", label: "Forecasting", icon: TrendingUp, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/staff-insights", label: "Staff Insights", icon: UserCheck, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/usage", label: "Usage & Credits", icon: Coins, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/settings", label: "AI Settings", icon: Settings, roles: ["owner", "manager"] },
    ],
  },

  // 8. Staff
  {
    kind: "group", key: "staff", label: "Staff", icon: UserCheck,
    children: [
      { kind: "link", href: "/staff", label: "Directory", icon: UserCheck },
      { kind: "link", href: "/staff-tasks", label: "Staff Tasks", icon: ClipboardCheck, roles: ["owner", "manager"] },
      { kind: "link", href: "/hr-compliance", label: "HR Compliance", icon: ScrollText, roles: ["owner", "manager", "hr_officer"], planGate: "hr_compliance" },
      { kind: "link", href: "/payroll", label: "Payroll", icon: Wallet, roles: ["owner"] },
      { kind: "link", href: "/staff-incentives", label: "Incentives", icon: Wallet, roles: ["owner", "manager"] },
      { kind: "link", href: "/sop-training", label: "SOP & Training", icon: BookOpen, roles: ["owner", "manager", "super_admin"], planGate: "sop_training" },
      { kind: "link", href: "/mystery-audits", label: "Mystery Audits", icon: ClipboardCheck, roles: ["owner", "manager", "auditor", "super_admin"], planGate: "mystery_audits" },
      { kind: "link", href: "/my-training", label: "My Training", icon: GraduationCap, roles: ["cashier", "waiter", "kitchen", "delivery_executive"] },
      // ── Staff pack (Task #365) ──
      { kind: "link", href: "/staff/scheduling",         label: "Scheduling & Forecast", icon: CalendarDays, roles: ["owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive", "staff", "super_admin"], planGate: "advanced_scheduling", badge: "premium" },
      { kind: "link", href: "/staff/table-optimization", label: "Table Optimization", icon: Table2,   roles: ["owner", "manager"], planGate: "staff_table_optimization", badge: "premium" },
      { kind: "link", href: "/staff/tips",               label: "Tip Pooling",        icon: Coins,    roles: ["owner", "manager"], planGate: "staff_tips",               badge: "premium" },
      { kind: "link", href: "/staff/leaderboard-tv",     label: "Leaderboard TV",     icon: Monitor,  roles: ["owner", "manager"], planGate: "staff_leaderboard_tv",     badge: "premium" },
    ],
  },

  // 9. Finance
  {
    kind: "group", key: "finance", label: "Finance", icon: Coins,
    children: [
      { kind: "link", href: "/payments", label: "Payments", icon: Wallet, roles: ["owner", "manager"] },
      { kind: "link", href: "/due-payments", label: "Due Payments", icon: AlertCircle, roles: ["owner", "manager"] },
      { kind: "link", href: "/cash-register", label: "Cash Register", icon: Banknote, roles: ["owner", "manager", "waiter"] },
      { kind: "link", href: "/expenses", label: "Expenses", icon: Receipt, roles: ["owner", "manager", "super_admin"], planGate: "expense_tracking" },
      { kind: "link", href: "/pnl", label: "P&L Dashboard", icon: TrendingUp, roles: ["owner", "manager", "super_admin"], planGate: "smart_pnl" },
      { kind: "link", href: "/finance/accounting-books", label: "Accounting Books", icon: ScrollText, roles: ["owner", "manager", "accountant", "super_admin"], planGate: "accounting_back_office" },
      { kind: "link", href: "/wallets", label: "Wallet", icon: Wallet, roles: ["owner", "manager"] },
      { kind: "link", href: "/gift-cards", label: "Gift Cards", icon: Gift, roles: ["owner", "manager", "cashier"] },
      { kind: "link", href: "/settlements", label: "Settlements & Recon", icon: TrendingUp, roles: ["owner", "manager", "cashier"] },
      { kind: "link", href: "/aggregator-payouts", label: "Aggregator Payouts", icon: Truck, roles: ["owner", "manager", "super_admin"] },
      { kind: "link", href: "/capital", label: "Capital & Insurance", icon: Banknote, roles: ["owner", "manager"] },
      { kind: "link", href: "/compliance", label: "Compliance", icon: ScrollText, roles: ["owner", "manager"], planGate: "compliance_manager" },
    ],
  },

  // 10. Operations (auto-hide if empty)
  {
    kind: "group", key: "operations", label: "Operations", icon: Building2,
    children: [
      { kind: "link", href: "/events", label: "Events & Catering", icon: PartyPopper, roles: ["owner", "manager", "waiter", "kitchen"], planGate: "events_catering" },
      { kind: "link", href: "/hotel", label: "Hotel Mode", icon: BellRing, roles: ["owner", "manager", "cashier", "waiter", "staff"] },
      { kind: "link", href: "/food-courts", label: "Food Court", icon: UtensilsCrossed, roles: ["owner", "manager", "food_court_owner"] },
      { kind: "link", href: "/food-court/my-counter", label: "My Counter", icon: Monitor, roles: ["owner", "manager", "cashier", "waiter", "kitchen", "staff"] },
      { kind: "link", href: "/corporate", label: "Corporate", icon: Building2, roles: ["owner", "manager"] },
      { kind: "link", href: "/corporate/companies", label: "Corporate Companies", icon: Building2, roles: ["owner", "manager"] },
      { kind: "link", href: "/corporate/approvals", label: "Corporate Approvals", icon: Inbox, roles: ["owner", "manager"] },
      { kind: "link", href: "/corporate/bulk-orders", label: "Bulk & Catering", icon: PartyPopper, roles: ["owner", "manager"] },
      { kind: "link", href: "/corporate/scheduled", label: "Scheduled Orders", icon: CalendarDays, roles: ["owner", "manager"] },
      { kind: "link", href: "/corporate/invoices", label: "Corporate Invoices", icon: Receipt, roles: ["owner", "manager"] },
      { kind: "link", href: "/tiffin/plans", label: "Tiffin Plans", icon: Soup, roles: ["owner", "manager"] },
      { kind: "link", href: "/tiffin/subscriptions", label: "Tiffin Subscriptions", icon: Users, roles: ["owner", "manager", "cashier"] },
      { kind: "link", href: "/tiffin/deliveries", label: "Tiffin Deliveries", icon: Truck, roles: ["owner", "manager", "delivery_executive"] },
      { kind: "link", href: "/tiffin/billing", label: "Tiffin Billing", icon: Receipt, roles: ["owner", "manager"] },
      { kind: "link", href: "/tiffin/customers", label: "Tiffin History", icon: History, roles: ["owner", "manager"] },
      { kind: "link", href: "/bakery", label: "Bakery", icon: Cake, roles: ["owner", "manager", "waiter", "kitchen", "cashier"], requiresBakeryMode: true },
      { kind: "link", href: "/bar", label: "Bar / Pub", icon: Wine, roles: ["owner", "manager", "waiter", "kitchen", "cashier"], requiresBarMode: true },
      { kind: "link", href: "/cloud-kitchen", label: "Cloud Kitchen", icon: ChefHat, roles: ["owner", "manager", "super_admin"], planGate: "cloud_kitchen" },
      { kind: "link", href: "/canteen/students", label: "Canteen Students", icon: Users, roles: ["owner", "manager", "canteen_admin"], requiresCanteenMode: true },
      { kind: "link", href: "/canteen/meal-plans", label: "Canteen Meal Plans", icon: UtensilsCrossed, roles: ["owner", "manager", "canteen_admin"], requiresCanteenMode: true },
      { kind: "link", href: "/canteen/pos", label: "Canteen POS", icon: Monitor, roles: ["owner", "manager", "cashier", "counter_staff", "canteen_admin"], requiresCanteenMode: true },
      { kind: "link", href: "/canteen/reports", label: "Canteen Reports", icon: BarChart3, roles: ["owner", "manager", "canteen_admin"], requiresCanteenMode: true },
      // ── Operations Intelligence pack (Task #365) ──
      { kind: "link", href: "/ops/digital-twin", label: "Digital Twin",       icon: LayoutDashboard, roles: ["owner", "manager"], planGate: "ops_digital_twin",     badge: "premium" },
      { kind: "link", href: "/ops/panic",        label: "Panic Button",       icon: AlertTriangle,   roles: ["owner", "manager"], planGate: "ops_panic_button",     badge: "premium" },
      { kind: "link", href: "/ops/handover",     label: "Shift Handover",     icon: ClipboardCheck,  roles: ["owner", "manager"], planGate: "ops_shift_handover",   badge: "premium" },
      { kind: "link", href: "/ops/briefings",    label: "Daily Briefings",    icon: Megaphone,       roles: ["owner", "manager"], planGate: "ops_daily_briefings",  badge: "premium" },
      { kind: "link", href: "/ops/checklists",   label: "Checklists",         icon: ClipboardCheck,  roles: ["owner", "manager"], planGate: "ops_closing_checklist",badge: "premium" },
      { kind: "link", href: "/ops/timeline",     label: "Service Timeline",   icon: History,         roles: ["owner", "manager"], planGate: "ops_event_timeline",   badge: "premium" },
      { kind: "link", href: "/ops/approvals",    label: "Approvals Inbox",    icon: Inbox,           roles: ["owner", "manager"], planGate: "ops_manager_approvals",badge: "premium" },
      { kind: "link", href: "/ops/incidents",    label: "Incident Log",       icon: AlertCircle,     roles: ["owner", "manager"], planGate: "ops_incident_log",     badge: "premium" },
      // ── Kitchen & Quality pack ──
      { kind: "link", href: "/kitchen/cleaning",      label: "Cleaning Schedule",  icon: ClipboardCheck, roles: ["owner", "manager", "kitchen"], planGate: "kq_cleaning_schedule", badge: "premium" },
      { kind: "link", href: "/kitchen/temperatures",  label: "Temperature Logs",   icon: Flame,          roles: ["owner", "manager", "kitchen"], planGate: "kq_temperature_log",   badge: "premium" },
      { kind: "link", href: "/kitchen/equipment",     label: "Equipment Register", icon: Settings,       roles: ["owner", "manager"],            planGate: "kq_equipment_register",badge: "premium" },
      { kind: "link", href: "/kitchen/taste-testing", label: "Taste Testing",      icon: Soup,           roles: ["owner", "manager", "kitchen"], planGate: "kq_taste_testing",     badge: "premium" },
      { kind: "link", href: "/kitchen/accuracy",      label: "Order Accuracy",     icon: ShieldCheck,    roles: ["owner", "manager"],            planGate: "kq_accuracy_score",    badge: "premium" },
      // ── Delivery pack ──
      { kind: "link", href: "/delivery/queue",               label: "Delivery Queue",       icon: Truck,         roles: ["owner", "manager"], planGate: "dlv_queue_manager",      badge: "premium" },
      { kind: "link", href: "/delivery/pre-order",           label: "Pre-Order Window",     icon: CalendarDays,  roles: ["owner", "manager"], planGate: "dlv_pre_order",          badge: "premium" },
      { kind: "link", href: "/delivery/zone-profitability",  label: "Zone Profitability",   icon: TrendingUp,    roles: ["owner", "manager"], planGate: "dlv_zone_profitability", badge: "premium" },
      { kind: "link", href: "/delivery/tracking-links",      label: "Live Tracking Links",  icon: Truck,         roles: ["owner", "manager"], planGate: "dlv_live_tracking_link", badge: "premium" },
    ],
  },

  // 11. Marketplace
  {
    kind: "group", key: "marketplace", label: "Marketplace", icon: Package, badge: "addon",
    children: [
      { kind: "link", href: "/marketplace", label: "Vendor Marketplace", icon: Package, roles: ["owner", "manager"] },
      { kind: "link", href: "/settings/devices", label: "Hardware & Devices", icon: Monitor, roles: ["owner", "manager", "cashier", "waiter", "kitchen"] },
      { kind: "link", href: "/settings/terminals", label: "Card Terminals", icon: CreditCard, roles: ["owner", "manager", "cashier"], planGate: "card_terminal", badge: "premium" },
      { kind: "link", href: "/settings/token-display", label: "Token Display", icon: BellRing, roles: ["owner", "manager"] },
      { kind: "link", href: "/settings/kitchens", label: "Kitchen Stations", icon: ChefHat, roles: ["owner", "manager"] },
      { kind: "link", href: "/settings/accounting", label: "Accounting Integrations", icon: ScrollText, roles: ["owner", "manager"] },
      { kind: "link", href: "/settings/webhooks", label: "Webhooks", icon: Settings, roles: ["owner", "manager"], planGate: "api_access" },
      { kind: "link", href: "/settings/api-keys", label: "API Keys", icon: Settings, roles: ["owner", "manager"], planGate: "api_access" },
    ],
  },

  // 12. Reports
  {
    kind: "group", key: "reports", label: "Reports", icon: BarChart3,
    children: [
      { kind: "link", href: "/reports/sales", label: "Sales", icon: TrendingUp, planGate: "advanced_reports" },
      { kind: "link", href: "/reports/compare", label: "Compare Branches", icon: BarChart3, roles: ["owner", "manager", "super_admin"] },
      { kind: "link", href: "/reports/tax", label: "Tax", icon: Percent },
      { kind: "link", href: "/reports/staff", label: "Staff", icon: Users },
      { kind: "link", href: "/reports/payments", label: "Payments", icon: Wallet },
      { kind: "link", href: "/reports/cash-variance", label: "Cash Variance", icon: AlertTriangle, roles: ["owner", "manager", "super_admin"] },
      { kind: "link", href: "/reports/food-cost", label: "Food Cost", icon: Flame, roles: ["owner", "manager", "super_admin"] },
      { kind: "link", href: "/reports/fraud-alerts", label: "Fraud Alerts", icon: AlertTriangle, roles: ["owner", "manager", "super_admin"] },
      { kind: "link", href: "/reports/health-score", label: "Health Score", icon: TrendingUp, roles: ["owner", "manager", "super_admin"] },
      { kind: "link", href: "/sustainability", label: "Sustainability", icon: Leaf, roles: ["owner", "manager", "super_admin"] },
      { kind: "link", href: "/ai/usage", label: "AI Usage", icon: Sparkles, roles: ["owner", "manager"], planGate: "ai" },
    ],
  },

  // 13. Support
  { kind: "link", href: "/support", label: "Support", icon: LifeBuoy, roles: ["owner", "manager"] },
];

// Quick Actions config
type QuickAction = { label: string; href: string; icon: IconType; roles?: string[] };
const QUICK_ACTIONS: QuickAction[] = [
  { label: "New Bill", href: "/pos", icon: Receipt, roles: ["owner", "manager", "cashier", "waiter"] },
  { label: "New Order", href: "/orders", icon: ShoppingCart },
  { label: "Add Menu Item", href: "/menu", icon: UtensilsCrossed, roles: ["owner", "manager"] },
  { label: "Create Campaign", href: "/growth", icon: Megaphone, roles: ["owner", "manager"] },
  { label: "Import Menu (AI)", href: "/ai/menu-import", icon: Sparkles, roles: ["owner", "manager"] },
];

const STORAGE_KEY = "tt_sidebar_groups_open_v2";

function collectAllHrefs(): string[] {
  const out: string[] = [];
  for (const e of navConfig) {
    if (e.kind === "link") out.push(e.href);
    else for (const c of e.children) out.push(c.href);
  }
  return out;
}
const ALL_HREFS = collectAllHrefs();

function isActiveHref(location: string, href: string) {
  if (href === "/") return location === "/";
  if (location !== href && !location.startsWith(href + "/")) return false;
  // Only the most-specific (longest) registered href that matches should win,
  // so /menu doesn't stay active when you navigate to /menu/pricing-rules.
  for (const other of ALL_HREFS) {
    if (other === href) continue;
    if (other.length <= href.length) continue;
    if (location === other || location.startsWith(other + "/")) return false;
  }
  return true;
}

const DEFAULT_OPEN_GROUPS: Record<string, boolean> = { sell: true };

function loadOpenState(): Record<string, boolean> {
  if (typeof window === "undefined") return { ...DEFAULT_OPEN_GROUPS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OPEN_GROUPS };
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    // Ensure Sell defaults to expanded if user has never explicitly toggled it.
    if (!("sell" in parsed)) parsed.sell = true;
    return parsed;
  } catch {
    return { ...DEFAULT_OPEN_GROUPS };
  }
}

function saveOpenState(state: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

const BADGE_STYLES: Record<BadgeKind, string> = {
  ai: "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white",
  new: "bg-emerald-500 text-white",
  premium: "bg-gradient-to-r from-amber-500 to-orange-500 text-white",
  addon: "bg-blue-500 text-white",
  beta: "bg-slate-500 text-white",
};

const BADGE_LABEL: Record<BadgeKind, string> = {
  ai: "AI",
  new: "NEW",
  premium: "PRO",
  addon: "ADD-ON",
  beta: "BETA",
};

function Badge({ kind }: { kind: BadgeKind }) {
  return (
    <span className={cn(
      "text-[9px] font-bold px-1.5 py-0.5 rounded-full tracking-wide uppercase",
      BADGE_STYLES[kind],
    )}>
      {BADGE_LABEL[kind]}
    </span>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const appSettings = useAppSettings();

  const canSeeWaiterRequests = user?.isSuperAdmin || (user?.role ? ["owner", "manager", "waiter"].includes(user.role) : false);
  const { data: waiterReqs = [] } = useWaiterRequests({ enabled: canSeeWaiterRequests });
  const activeWaiterCount = waiterReqs.filter(r => r.status === "pending" || r.status === "acknowledged").length;

  const { data: leadStats } = useQuery<{ byStatus: { status: string; count: number }[] }>({
    queryKey: ["admin-leads-new-count"],
    queryFn: () => apiFetch("/admin/leads/stats"),
    enabled: !!user?.isSuperAdmin,
    refetchInterval: 60_000,
  });
  const newLeadsCount = leadStats?.byStatus.find(s => s.status === "new")?.count ?? 0;

  const { data: aiWallet } = useQuery<{ planAiEnabled: boolean; planKhanaAiInsightsEnabled?: boolean }>({
    queryKey: ["ai-wallet"],
    queryFn: () => apiFetch("/ai/wallet"),
    enabled: !!user && (user.isSuperAdmin || ["owner", "manager"].includes(user.role ?? "")),
    staleTime: 60_000,
  });
  const aiPlanEnabled = aiWallet?.planAiEnabled ?? false;
  const aiInsightsEnabled = aiWallet?.planKhanaAiInsightsEnabled ?? false;

  const restaurantId = user?.restaurantId;

  const { data: subscription } = useQuery<{ plan: { featureFlags: Record<string, boolean> | null } | null }>({
    queryKey: ["subscription-features", restaurantId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/subscription`),
    enabled: !!restaurantId && !!user,
    staleTime: 60_000,
  });
  const planFlags: Record<string, boolean> = subscription?.plan?.featureFlags ?? {};
  const cloudKitchenPlanEnabled = planFlags.cloud_kitchen === true;

  const { data: docsAccess } = useQuery<{ hasAccess: boolean }>({
    queryKey: ["documents-has-access", restaurantId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/documents/has-access`),
    enabled: !!restaurantId && !!user,
    staleTime: 5 * 60_000,
  });
  const docsHasAccess = docsAccess?.hasAccess ?? false;

  const { data: restaurantInfo } = useQuery<{ bakeryModeEnabled?: boolean; serviceMode?: string; canteenModeEnabled?: boolean }>({
    queryKey: ["restaurant", restaurantId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}`),
    enabled: !!restaurantId && !!user,
    staleTime: 60_000,
  });
  const bakeryModeOn = restaurantInfo?.bakeryModeEnabled ?? false;
  const barModeOn = (restaurantInfo?.serviceMode ?? "restaurant") !== "restaurant";
  const canteenModeOn = restaurantInfo?.canteenModeEnabled ?? false;

  const initials = user?.name
    ? user.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  const canSee = (item: LinkItem) => {
    if (item.requiresDocsAccess) return docsHasAccess;
    if (item.requiresBakeryMode && !bakeryModeOn) return false;
    if (item.requiresBarMode && !barModeOn) return false;
    if (item.requiresCanteenMode && !canteenModeOn) return false;
    if (!item.roles) return true;
    if (user?.isSuperAdmin) return true;
    return user?.role ? item.roles.includes(user.role) : false;
  };

  const passesPlanGate = (gate: PlanGate | undefined) => {
    if (!gate) return true;
    if (user?.isSuperAdmin) return true;
    if (gate === "ai") return aiPlanEnabled;
    if (gate === "ai_insights") return aiPlanEnabled && aiInsightsEnabled;
    return isFeatureEnabled(subscription?.plan?.featureFlags ?? null, gate);
  };

  const groupRoleAllowed = (g: GroupItem) => {
    if (!g.roles) return true;
    if (user?.isSuperAdmin) return true;
    return user?.role ? g.roles.includes(user.role) : false;
  };

  // Lock (rather than hide) plan-gated entries: render them with a PRO badge
  // and point them at /pricing?feature=KEY so users can see what they'd get.
  const lockLinkIfGated = (l: LinkItem, parentGate?: PlanGate): LinkItem => {
    const gate = l.planGate ?? parentGate;
    if (!gate || passesPlanGate(gate)) return l;
    const featureKey = gateToFeatureKey(gate);
    return {
      ...l,
      locked: true,
      lockedFeatureKey: featureKey,
      href: `/pricing?feature=${encodeURIComponent(featureKey)}`,
      badge: "premium",
    };
  };

  const visibleEntries: NavEntry[] = useMemo(() => {
    const out: NavEntry[] = [];
    for (const e of navConfig) {
      if (e.kind === "link") {
        if (!canSee(e)) continue;
        out.push(lockLinkIfGated(e));
      } else {
        if (!groupRoleAllowed(e)) continue;
        const visibleChildren = e.children
          .filter((c) => canSee(c))
          .map((c) => lockLinkIfGated(c, e.planGate));
        if (visibleChildren.length > 0) out.push({ ...e, children: visibleChildren });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.isSuperAdmin, aiPlanEnabled, aiInsightsEnabled, subscription?.plan?.featureFlags, docsHasAccess, bakeryModeOn, barModeOn, canteenModeOn, subscription]);

  const [searchTerm, setSearchTerm] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);

  const filteredEntries: NavEntry[] = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return visibleEntries;
    const out: NavEntry[] = [];
    for (const e of visibleEntries) {
      if (e.kind === "link") {
        if (e.label.toLowerCase().includes(q)) out.push(e);
      } else {
        const matchedChildren = e.children.filter(c => c.label.toLowerCase().includes(q));
        const groupMatches = e.label.toLowerCase().includes(q);
        if (groupMatches) out.push(e);
        else if (matchedChildren.length > 0) out.push({ ...e, children: matchedChildren });
      }
    }
    return out;
  }, [visibleEntries, searchTerm]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => loadOpenState());

  useEffect(() => {
    setOpenGroups(prev => {
      let changed = false;
      const next = { ...prev };
      for (const e of visibleEntries) {
        if (e.kind === "group") {
          const containsActive = e.children.some(c => isActiveHref(location, c.href));
          if (containsActive && !next[e.key]) {
            next[e.key] = true;
            changed = true;
          }
        }
      }
      if (changed) saveOpenState(next);
      return changed ? next : prev;
    });
  }, [location, visibleEntries]);

  // Auto-expand all groups when searching
  const effectiveOpen = (key: string) => (searchTerm.trim() ? true : !!openGroups[key]);

  const toggleGroup = (key: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveOpenState(next);
      return next;
    });
  };

  const visibleQuickActions = QUICK_ACTIONS.filter(a => {
    if (!a.roles) return true;
    if (user?.isSuperAdmin) return true;
    return user?.role ? a.roles.includes(user.role) : false;
  });

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-sidebar border-r border-sidebar-border">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        {appSettings.logoUrl ? (
          <img
            src={resolveImageUrl(appSettings.logoUrl)}
            alt={appSettings.appName}
            className="w-9 h-9 rounded-xl object-cover shadow-md shadow-primary/30 ring-1 ring-primary/20"
          />
        ) : (
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md shadow-primary/30 ring-1 ring-primary/20">
            <Flame className="w-5 h-5 text-white" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sidebar-foreground leading-tight tracking-tight">{appSettings.appName}</p>
          <p className="text-xs text-muted-foreground truncate">{user?.name ?? "Loading…"}</p>
        </div>
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors flex-shrink-0"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      {/* Search + Quick Actions */}
      <div className="px-3 pt-3 pb-2 space-y-2 border-b border-sidebar-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search navigation…"
            className="w-full pl-8 pr-2 h-8 rounded-md text-xs bg-sidebar-accent/40 border border-sidebar-border placeholder:text-muted-foreground/70 text-sidebar-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            data-testid="sidebar-search"
          />
        </div>
        {visibleQuickActions.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setQuickOpen(o => !o)}
              className="w-full flex items-center gap-2 px-2.5 h-8 rounded-md text-xs font-medium bg-gradient-to-r from-primary/15 to-primary/5 text-sidebar-foreground hover:from-primary/25 hover:to-primary/10 transition-colors"
              data-testid="sidebar-quick-actions"
            >
              <Zap className="w-3.5 h-3.5 text-primary" />
              <span className="flex-1 text-left">Quick actions</span>
              <ChevronDown className={cn("w-3 h-3 transition-transform", quickOpen && "rotate-180")} />
            </button>
            {quickOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
                {visibleQuickActions.map(a => {
                  const Icon = a.icon;
                  return (
                    <Link
                      key={a.href}
                      href={a.href}
                      onClick={() => { setQuickOpen(false); onNavigate?.(); }}
                      className="flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-accent/60"
                    >
                      <Icon className="w-3.5 h-3.5 text-primary" />
                      <span className="flex-1">{a.label}</span>
                      <Plus className="w-3 h-3 text-muted-foreground" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {filteredEntries.length === 0 && (
          <p className="px-3 py-6 text-xs text-muted-foreground text-center">No matches</p>
        )}
        {filteredEntries.map(entry => {
          if (entry.kind === "link") {
            const active = isActiveHref(location, entry.href);
            const Icon = entry.icon;
            return (
              <Link
                key={entry.href}
                href={entry.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-gradient-to-r from-sidebar-primary to-sidebar-primary/90 text-sidebar-primary-foreground shadow-sm shadow-primary/20"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{entry.label}</span>
                {entry.badge && <Badge kind={entry.badge} />}
                {entry.href === "/waiter-requests" && activeWaiterCount > 0 && (
                  <span className={cn(
                    "text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center",
                    active ? "bg-white/25 text-white" : "bg-orange-500 text-white",
                  )}>{activeWaiterCount}</span>
                )}
              </Link>
            );
          }

          const Icon = entry.icon;
          const isOpen = effectiveOpen(entry.key);
          const childActive = entry.children.some(c => isActiveHref(location, c.href));
          const panelId = `sidebar-group-${entry.key}`;

          return (
            <div key={entry.key}>
              <button
                type="button"
                onClick={() => toggleGroup(entry.key)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  childActive
                    ? "text-sidebar-foreground bg-sidebar-accent/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className={cn("w-4 h-4 flex-shrink-0", entry.badge === "ai" && "text-violet-500")} />
                <span className="flex-1 text-left">{entry.label}</span>
                {entry.badge && <Badge kind={entry.badge} />}
                <ChevronDown className={cn("w-4 h-4 transition-transform duration-300 ease-out", isOpen ? "rotate-0" : "-rotate-90")} />
              </button>
              <div
                id={panelId}
                aria-hidden={!isOpen}
                className={cn(
                  "grid transition-all duration-300 ease-out",
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none",
                )}
              >
                <div className="overflow-hidden">
                  <div className="mt-0.5 ml-3 pl-3 border-l border-sidebar-border space-y-0.5 py-0.5">
                    {entry.children.map(c => {
                      const ChildIcon = c.icon;
                      const active = isActiveHref(location, c.href);
                      return (
                        <Link
                          key={c.href}
                          href={c.href}
                          tabIndex={isOpen ? 0 : -1}
                          aria-hidden={!isOpen}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                            active
                              ? "bg-gradient-to-r from-sidebar-primary to-sidebar-primary/90 text-sidebar-primary-foreground shadow-sm shadow-primary/20"
                              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          )}
                        >
                          <ChildIcon className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="flex-1">{c.label}</span>
                          {c.badge && <Badge kind={c.badge} />}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-sidebar-border space-y-0.5">
        <NotificationDropdown />
        <Link href="/settings" onClick={onNavigate} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
          <Settings className="w-4 h-4" />
          Settings
        </Link>
        {user?.isSuperAdmin && (
          <Link href="/admin" onClick={onNavigate} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all" data-testid="link-admin-panel">
            <ShieldCheck className="w-4 h-4" />
            <span className="flex-1">Admin Panel</span>
            {newLeadsCount > 0 && (
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center bg-orange-500 text-white" data-testid="badge-new-leads">
                {newLeadsCount}
              </span>
            )}
          </Link>
        )}

        <div className="mt-2 pt-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sidebar-foreground font-medium truncate text-sm">{user?.name ?? "—"}</p>
              <p className="text-xs text-muted-foreground capitalize truncate">{user?.role ?? ""}</p>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors flex-shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
