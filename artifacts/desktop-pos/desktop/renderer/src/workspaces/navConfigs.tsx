/**
 * Per-workspace nav configs.
 *
 * Each item declares its required permission(s) + module flags so the
 * sidebar and command palette can apply the same gates without divergence.
 * Specialist workspaces (Inventory, Accounts, Marketing, Delivery) are
 * fully wired by `WorkspaceRouter` via `renderModule` — see the resolver
 * map in `WorkspaceRouter.tsx` for the screen each `key` opens.
 *
 * Manager Office items are still placeholders — that workspace ships in
 * its own dedicated task.
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
  { key: "raw-materials", label: "Raw materials", group: "Stock", icon: G("▦"),
    requiredPermissions: ["inventory.read"], requiredModules: ["inventory"],
    aliases: ["stock", "ingredients"] },
  { key: "menu-item-stock", label: "Menu item stock", group: "Stock", icon: G("☰"),
    requiredPermissions: ["inventory.read"], requiredModules: ["inventory"] },
  { key: "low-stock", label: "Low stock", group: "Stock", icon: G("⚠"),
    requiredPermissions: ["inventory.read"], requiredModules: ["inventory"] },

  { key: "warehouse", label: "Warehouse", group: "Warehouse", icon: G("⌂"),
    requiredPermissions: ["inventory.read"], requiredModules: ["inventory"] },
  { key: "warehouse-type", label: "Warehouse type", group: "Warehouse", icon: G("◇"),
    requiredPermissions: ["inventory.read"], requiredModules: ["inventory"] },
  { key: "stock-transfer", label: "Stock transfer / issue", group: "Warehouse", icon: G("⇌"),
    requiredPermissions: ["inventory.write"], requiredModules: ["inventory"] },

  { key: "purchase", label: "Purchase orders", group: "Procurement", icon: G("⊞"),
    requiredPermissions: ["inventory.write"], requiredModules: ["inventory"] },
  { key: "suppliers", label: "Suppliers", group: "Procurement", icon: G("◇"),
    requiredPermissions: ["inventory.read"], requiredModules: ["inventory"] },
  { key: "vendor-ocr", label: "Vendor invoice OCR", group: "Procurement", icon: G("◫"),
    requiredPermissions: ["inventory.write"], requiredModules: ["inventory"] },

  { key: "wastage", label: "Wastage", group: "Audit", icon: G("✕"),
    requiredPermissions: ["inventory.write"], requiredModules: ["inventory"] },

  { key: "reports", label: "Inventory reports", group: "Reports", icon: G("☷"),
    requiredPermissions: ["reports.read"], requiredModules: ["inventory"] },
  { key: "sync-center", label: "Sync Center", group: "System", icon: G("⟳"),
    requiredPermissions: [] },
];

const ACCOUNTANT_NAV: NavItem[] = [
  { key: "payments", label: "Payments", group: "Daily", icon: G("⊟"),
    requiredPermissions: ["payments.read"], requiredModules: ["accounting"] },
  { key: "voucher", label: "Vouchers", group: "Daily", icon: G("⌧"),
    requiredPermissions: ["accounts.write"], requiredModules: ["accounting"] },

  { key: "expense-types", label: "Expense types", group: "Expenses", icon: G("☰"),
    requiredPermissions: ["accounts.write"], requiredModules: ["accounting"] },
  { key: "expenses", label: "Expenses", group: "Expenses", icon: G("⊖"),
    requiredPermissions: ["accounts.write"], requiredModules: ["accounting"] },

  { key: "cards", label: "Cards", group: "Banking", icon: G("▭"),
    requiredPermissions: ["accounts.read"], requiredModules: ["accounting"] },
  { key: "wallet", label: "Wallet", group: "Banking", icon: G("◫"),
    requiredPermissions: ["accounts.read"], requiredModules: ["accounting"] },
  { key: "bank-recon", label: "Bank reconciliation", group: "Banking", icon: G("⇆"),
    requiredPermissions: ["accounts.write"], requiredModules: ["accounting"] },

  { key: "refunds", label: "Refunds", group: "Adjustments", icon: G("↺"),
    requiredPermissions: ["payments.refund"], requiredModules: ["accounting"] },
  { key: "settlements", label: "Settlements", group: "Adjustments", icon: G("⇄"),
    requiredPermissions: ["payments.read"], requiredModules: ["accounting"] },

  { key: "accounting-reports", label: "Accounting reports", group: "Reports", icon: G("☷"),
    requiredPermissions: ["reports.read"], requiredModules: ["accounting"] },
  { key: "pos-report", label: "POS report", group: "Reports", icon: G("⊞"),
    requiredPermissions: ["reports.read"], requiredModules: ["accounting"] },
  { key: "work-period", label: "Work period report", group: "Reports", icon: G("⧗"),
    requiredPermissions: ["reports.read"], requiredModules: ["accounting"] },
  { key: "pnl", label: "Profit & loss", group: "Reports", icon: G("☷"),
    requiredPermissions: ["reports.read"], requiredModules: ["accounting"] },
  { key: "sync-center", label: "Sync Center", group: "System", icon: G("⟳"),
    requiredPermissions: [] },
];

const MARKETING_NAV: NavItem[] = [
  { key: "growth-engine", label: "Growth engine", group: "Overview", icon: G("◎"),
    requiredPermissions: ["marketing.read"], requiredModules: ["marketing"] },

  { key: "campaigns", label: "Campaigns", group: "Campaigns", icon: G("✦"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"] },
  { key: "whatsapp-campaigns", label: "WhatsApp", group: "Campaigns", icon: G("☎"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"] },
  { key: "sms-campaigns", label: "SMS", group: "Campaigns", icon: G("✉"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"] },
  { key: "email-campaigns", label: "Email", group: "Campaigns", icon: G("✉"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"] },
  { key: "push-campaigns", label: "Push", group: "Campaigns", icon: G("▲"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"] },

  { key: "templates", label: "Templates", group: "Templates", icon: G("☰"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"] },
  { key: "email-templates", label: "Email templates", group: "Templates", icon: G("✉"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"] },
  { key: "whatsapp-templates", label: "WhatsApp templates", group: "Templates", icon: G("☎"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"] },

  { key: "coupons", label: "Coupons", group: "Offers", icon: G("◈"),
    requiredPermissions: ["marketing.write"], requiredModules: ["marketing"] },
  { key: "segments", label: "Customer segments", group: "Offers", icon: G("◌"),
    requiredPermissions: ["customers.read"], requiredModules: ["marketing"] },

  { key: "reviews", label: "Reviews", group: "Insights", icon: G("♡"),
    requiredPermissions: ["customers.read"], requiredModules: ["marketing"] },

  { key: "sync-center", label: "Sync Center", group: "System", icon: G("⟳"),
    requiredPermissions: [] },
];

const DELIVERY_NAV: NavItem[] = [
  { key: "assignments", label: "Assigned orders", group: "Dispatch", icon: G("▦"),
    requiredPermissions: ["delivery.read"], requiredModules: ["delivery"] },
  { key: "status-board", label: "Status board", group: "Dispatch", icon: G("⊞"),
    requiredPermissions: ["delivery.read"], requiredModules: ["delivery"] },
  { key: "riders", label: "Riders", group: "Dispatch", icon: G("☻"),
    requiredPermissions: ["delivery.read"], requiredModules: ["delivery"] },

  { key: "cod-collection", label: "COD collection", group: "Cash", icon: G("₹"),
    requiredPermissions: ["delivery.read"], requiredModules: ["delivery"] },
  { key: "cash-handover", label: "Cash handover", group: "Cash", icon: G("⇄"),
    requiredPermissions: ["delivery.write"], requiredModules: ["delivery"] },

  { key: "delivery-reports", label: "Delivery reports", group: "Reports", icon: G("☷"),
    requiredPermissions: ["reports.read"], requiredModules: ["delivery"] },
  { key: "sync-center", label: "Sync Center", group: "System", icon: G("⟳"),
    requiredPermissions: [] },
];

export const NAV_BY_WORKSPACE: Record<Exclude<WorkspaceKey, "cashier">, NavItem[]> = {
  manager: MANAGER_NAV,
  inventory: INVENTORY_NAV,
  accountant: ACCOUNTANT_NAV,
  marketing: MARKETING_NAV,
  delivery: DELIVERY_NAV,
};
