/**
 * Per-workspace nav configs.
 *
 * Each item declares its required permission(s) + module flags so the
 * sidebar and command palette can apply the same gates without divergence.
 * Everything ships `comingSoon: true` in this task — the foundation only.
 * Real screens land in the follow-up Manager / Inventory / Accountant /
 * Marketing / Delivery tasks, which will flip `comingSoon` off as they wire
 * each module.
 */
import type { NavItem, WorkspaceKey } from "./types";

// Tiny inline glyphs — keep dependency surface small and predictable.
const G = (g: string) => (
  <span style={{ fontSize: 14, lineHeight: 1, color: "currentColor" }}>{g}</span>
);

/**
 * Manager-Office nav.
 *
 * Every item that maps to a wired screen in `manager/registry.tsx`
 * leaves `comingSoon` unset (the shell renders the real component).
 * Items with no IPC backing yet (inventory, purchase, staff, growth,
 * providers, AI, finance deep) still light up the rail and render the
 * `WebAdminBridge` from the registry — the bridge deep-links the
 * corresponding web-admin page so operators have a *working* path
 * instead of a dead "Coming soon" wall.
 *
 * Permission strings come from `roles.deriveAccess`; module strings
 * gate the optional Inventory / Accounting / Growth / Delivery
 * surfaces against the tenant's plan. Both `requiredPermissions` and
 * `requiredModules` use ANY/ALL semantics — see `roles.ts`.
 */
const MANAGER_NAV: NavItem[] = [
  // ─── Overview ─────────────────────────────────────────────────────
  { key: "overview", label: "Dashboard", group: "Overview", icon: G("◎"),
    requiredPermissions: ["reports.read"],
    aliases: ["dashboard", "home", "kpis"] },
  { key: "backoffice", label: "Back office", group: "Overview", icon: G("⊞"),
    requiredPermissions: ["settings.read"],
    aliases: ["modules", "all", "index"] },

  // ─── Service (live operations) ────────────────────────────────────
  { key: "orders", label: "POS & orders", group: "Service", icon: G("▢"),
    requiredPermissions: ["orders.read"],
    aliases: ["pos", "tickets", "live orders"] },
  { key: "tables", label: "Tables & floor", group: "Service", icon: G("⊞"),
    requiredPermissions: ["tables.read"] },
  { key: "kitchen", label: "Kitchen display", group: "Service", icon: G("⌘"),
    requiredPermissions: ["kitchen.read"], aliases: ["kds", "kot"] },
  { key: "qr", label: "QR & online orders", group: "Service", icon: G("⊟"),
    requiredPermissions: ["orders.read"], aliases: ["zomato", "swiggy", "online"] },

  // ─── Restaurant setup ────────────────────────────────────────────
  { key: "outlets", label: "Outlets & branches", group: "Restaurant", icon: G("⌂"),
    requiredPermissions: ["settings.write"], aliases: ["branches", "stores", "locations"] },
  { key: "kitchens", label: "Kitchens & stations", group: "Restaurant", icon: G("⌘"),
    requiredPermissions: ["settings.write"], aliases: ["stations", "bar"] },
  { key: "taxes", label: "Taxes & charges", group: "Restaurant", icon: G("§"),
    requiredPermissions: ["settings.write"], aliases: ["gst", "vat", "service charge"] },
  { key: "discounts", label: "Discounts & offers", group: "Restaurant", icon: G("◈"),
    requiredPermissions: ["settings.write"], aliases: ["coupons", "promotions"] },

  // ─── Catalog ──────────────────────────────────────────────────────
  { key: "menu", label: "Menu & categories", group: "Catalog", icon: G("☰"),
    requiredPermissions: ["menu.read"], aliases: ["items", "modifiers", "pricing"] },

  // ─── People ───────────────────────────────────────────────────────
  { key: "customers", label: "Customers", group: "People", icon: G("◌"),
    requiredPermissions: ["customers.read"], aliases: ["crm", "loyalty"] },
  { key: "staff", label: "Staff & roles", group: "People", icon: G("☻"),
    requiredPermissions: ["staff.read"], aliases: ["users", "team", "rosters"] },
  { key: "attendance", label: "Attendance & shifts", group: "People", icon: G("☑"),
    requiredPermissions: ["staff.read"], aliases: ["clock-in", "roster"] },

  // ─── Inventory & Procurement ───────────────────────────────────
  // NOTE: optional modules (inventory / accounting / marketing /
  // delivery) intentionally aren't `requiredModules` here — the
  // desktop has no plan endpoint, so the embedded web admin runs the
  // PlanProtectedRoute check and renders the upgrade screen if the
  // tenant isn't entitled (see roles.ts). Permission gates still
  // apply, so cashiers / waiters never see these.
  { key: "inventory", label: "Inventory", group: "Inventory", icon: G("▦"),
    requiredPermissions: ["inventory.read"],
    requiredFeature: "inventory_management",
    aliases: ["stock", "recipes"] },
  { key: "purchase", label: "Purchase & suppliers", group: "Inventory", icon: G("◇"),
    requiredPermissions: ["inventory.read"],
    requiredFeature: "supplier_network",
    aliases: ["po", "vendors", "marketplace"] },

  // ─── Finance ──────────────────────────────────────────────────────
  { key: "payments", label: "Payments", group: "Finance", icon: G("₹"),
    requiredPermissions: ["payments.read"], aliases: ["tender", "bills"] },
  { key: "finance", label: "Books & expenses", group: "Finance", icon: G("§"),
    requiredPermissions: ["accounts.read"],
    requiredFeature: "accounting_back_office",
    aliases: ["accounting", "tax", "gst", "expenses", "settlements"] },

  // ─── Growth ───────────────────────────────────────────────────────
  { key: "growth", label: "Growth & marketing", group: "Growth", icon: G("✦"),
    requiredPermissions: ["marketing.read"],
    requiredFeature: "advanced_reports",
    aliases: ["campaigns", "coupons", "loyalty", "leads"] },
  { key: "ai", label: "Khana AI", group: "Khana AI", icon: G("✺"),
    requiredPermissions: ["settings.write"],
    requiredFeature: "khana_ai_enabled",
    aliases: ["ai", "import", "forecast", "insights"] },

  // ─── Reports ──────────────────────────────────────────────────────
  { key: "reports", label: "Reports & Z-history", group: "Reports", icon: G("☷"),
    requiredPermissions: ["reports.read"], aliases: ["analytics", "exports", "z-report"] },

  // ─── System / Settings ────────────────────────────────────────────
  { key: "hardware", label: "Hardware", group: "Hardware", icon: G("⎙"),
    requiredPermissions: ["hardware.manage"],
    aliases: ["printers", "drawer", "scanner"] },
  { key: "devices", label: "Devices & terminals", group: "Hardware", icon: G("▣"),
    requiredPermissions: ["hardware.manage"], aliases: ["terminals", "tills"] },
  { key: "audit", label: "Audit log", group: "System", icon: G("☷"),
    requiredPermissions: ["settings.read"], aliases: ["activity", "events"] },
  { key: "providers", label: "Providers & integrations", group: "Providers", icon: G("⇄"),
    requiredPermissions: ["settings.write"],
    requiredFeature: "api_access",
    aliases: ["api", "webhook", "zomato", "swiggy"] },
  { key: "sync", label: "Sync", group: "System", icon: G("⟳"),
    requiredPermissions: ["session.read"], aliases: ["offline", "queue", "conflicts"] },
  { key: "system", label: "System & logs", group: "System", icon: G("◑"),
    requiredPermissions: ["session.read"], aliases: ["logs", "diagnostics", "version"] },
  { key: "settings", label: "Settings", group: "Settings", icon: G("⌂"),
    requiredPermissions: ["settings.read"], aliases: ["preferences", "connection"] },
];

const INVENTORY_NAV: NavItem[] = [
  { key: "stock", label: "Stock levels", group: "Inventory", icon: G("▦"),
    requiredPermissions: ["inventory.read"], requiredModules: ["inventory"], comingSoon: true },
  { key: "movements", label: "Stock movements", group: "Inventory", icon: G("⇌"),
    requiredPermissions: ["inventory.read"], requiredModules: ["inventory"], comingSoon: true },
  { key: "recipes", label: "Recipes & BOM", group: "Inventory", icon: G("⌬"),
    requiredPermissions: ["inventory.read"], requiredModules: ["inventory"], comingSoon: true },
  { key: "purchase", label: "Purchase orders", group: "Procurement", icon: G("⊞"),
    requiredPermissions: ["inventory.write"], requiredModules: ["inventory"], comingSoon: true },
  { key: "suppliers", label: "Suppliers", group: "Procurement", icon: G("◇"),
    requiredPermissions: ["inventory.read"], requiredModules: ["inventory"], comingSoon: true },
  { key: "wastage", label: "Wastage & adjustments", group: "Audit", icon: G("✕"),
    requiredPermissions: ["inventory.write"], requiredModules: ["inventory"], comingSoon: true },
  { key: "audits", label: "Stock audits", group: "Audit", icon: G("☑"),
    requiredPermissions: ["inventory.read"], requiredModules: ["inventory"], comingSoon: true },
  { key: "reports", label: "Inventory reports", group: "Reports", icon: G("☷"),
    requiredPermissions: ["reports.read"], requiredModules: ["inventory"], comingSoon: true },
];

const ACCOUNTANT_NAV: NavItem[] = [
  { key: "daybook", label: "Daybook", group: "Accounts", icon: G("▦"),
    requiredPermissions: ["accounts.read"], requiredModules: ["accounting"], comingSoon: true },
  { key: "ledger", label: "Ledger", group: "Accounts", icon: G("☰"),
    requiredPermissions: ["accounts.read"], requiredModules: ["accounting"], comingSoon: true },
  { key: "tax", label: "Tax (GST / VAT)", group: "Compliance", icon: G("§"),
    requiredPermissions: ["accounts.read"], requiredModules: ["accounting"], comingSoon: true },
  { key: "payouts", label: "Payouts", group: "Payments", icon: G("↥"),
    requiredPermissions: ["payments.read"], requiredModules: ["accounting"], comingSoon: true },
  { key: "expenses", label: "Expenses", group: "Payments", icon: G("⊖"),
    requiredPermissions: ["accounts.write"], requiredModules: ["accounting"], comingSoon: true },
  { key: "settlements", label: "Settlements", group: "Payments", icon: G("⇆"),
    requiredPermissions: ["payments.read"], requiredModules: ["accounting"], comingSoon: true },
  { key: "statements", label: "Statements", group: "Reports", icon: G("☷"),
    requiredPermissions: ["reports.read"], requiredModules: ["accounting"], comingSoon: true },
  { key: "exports", label: "Export to Tally / Zoho", group: "Reports", icon: G("↧"),
    requiredPermissions: ["reports.export"], requiredModules: ["accounting"], comingSoon: true },
];

const MARKETING_NAV: NavItem[] = [
  { key: "segments", label: "Customer segments", group: "Audience", icon: G("◌"),
    requiredPermissions: ["customers.read"], requiredModules: ["marketing"], comingSoon: true },
  { key: "leads", label: "Leads & enquiries", group: "Audience", icon: G("☎"),
    requiredPermissions: ["customers.read"], requiredModules: ["marketing"], comingSoon: true },
  { key: "campaigns", label: "Campaigns", group: "Outreach", icon: G("✦"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"], comingSoon: true },
  { key: "templates", label: "Templates (SMS · Email · WA)", group: "Outreach", icon: G("✉"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"], comingSoon: true },
  { key: "loyalty", label: "Loyalty programs", group: "Loyalty", icon: G("✺"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"], comingSoon: true },
  { key: "coupons", label: "Coupons & offers", group: "Loyalty", icon: G("◈"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"], comingSoon: true },
  { key: "feedback", label: "Reviews & feedback", group: "Insights", icon: G("♡"),
    requiredPermissions: ["customers.read"], requiredModules: ["marketing"], comingSoon: true },
  { key: "reports", label: "Campaign reports", group: "Insights", icon: G("☷"),
    requiredPermissions: ["reports.read"], requiredModules: ["marketing"], comingSoon: true },
];

const DELIVERY_NAV: NavItem[] = [
  { key: "dispatch", label: "Dispatch board", group: "Dispatch", icon: G("▦"),
    requiredPermissions: ["delivery.read"], requiredModules: ["delivery"], comingSoon: true },
  { key: "live", label: "Live tracking", group: "Dispatch", icon: G("◎"),
    requiredPermissions: ["delivery.read"], requiredModules: ["delivery"], comingSoon: true },
  { key: "riders", label: "Riders & roster", group: "People", icon: G("☻"),
    requiredPermissions: ["delivery.read"], requiredModules: ["delivery"], comingSoon: true },
  { key: "zones", label: "Zones & charges", group: "Setup", icon: G("◇"),
    requiredPermissions: ["delivery.write"], requiredModules: ["delivery"], comingSoon: true },
  { key: "aggregators", label: "Aggregator orders", group: "Channels", icon: G("⇄"),
    requiredPermissions: ["delivery.read"], requiredModules: ["delivery"], comingSoon: true },
  { key: "reconcile", label: "Aggregator reconciliation", group: "Channels", icon: G("⇆"),
    requiredPermissions: ["delivery.read"], requiredModules: ["delivery"], comingSoon: true },
  { key: "reports", label: "Delivery reports", group: "Reports", icon: G("☷"),
    requiredPermissions: ["reports.read"], requiredModules: ["delivery"], comingSoon: true },
];

export const NAV_BY_WORKSPACE: Record<Exclude<WorkspaceKey, "cashier">, NavItem[]> = {
  manager: MANAGER_NAV,
  inventory: INVENTORY_NAV,
  accountant: ACCOUNTANT_NAV,
  marketing: MARKETING_NAV,
  delivery: DELIVERY_NAV,
};
