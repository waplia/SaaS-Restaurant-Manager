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

const MANAGER_NAV: NavItem[] = [
  // Overview
  { key: "overview", label: "Overview", group: "Overview", icon: G("◎"),
    requiredPermissions: ["reports.read"], comingSoon: true,
    aliases: ["dashboard", "home"] },

  // Orders & service
  { key: "orders", label: "Live orders", group: "Service", icon: G("▢"),
    requiredPermissions: ["orders.read"], comingSoon: true },
  { key: "tables", label: "Tables & floor", group: "Service", icon: G("⊞"),
    requiredPermissions: ["tables.read"], comingSoon: true },
  { key: "kitchen", label: "Kitchen display", group: "Service", icon: G("⌘"),
    requiredPermissions: ["kitchen.read"], comingSoon: true },
  { key: "qr", label: "QR / online orders", group: "Service", icon: G("⊟"),
    requiredPermissions: ["orders.read"], comingSoon: true },

  // Catalog
  { key: "menu", label: "Menu & categories", group: "Catalog", icon: G("☰"),
    requiredPermissions: ["menu.read"], comingSoon: true },
  { key: "modifiers", label: "Modifiers", group: "Catalog", icon: G("⊕"),
    requiredPermissions: ["menu.read"], comingSoon: true },
  { key: "pricing", label: "Pricing & happy hours", group: "Catalog", icon: G("₹"),
    requiredPermissions: ["menu.write"], comingSoon: true },

  // People
  { key: "staff", label: "Staff & roles", group: "People", icon: G("☻"),
    requiredPermissions: ["staff.read"], comingSoon: true },
  { key: "shifts", label: "Shifts & attendance", group: "People", icon: G("⧗"),
    requiredPermissions: ["shift.open"], comingSoon: true },

  // Customers
  { key: "customers", label: "Customers", group: "Customers", icon: G("◌"),
    requiredPermissions: ["customers.read"], comingSoon: true },
  { key: "loyalty", label: "Loyalty & coupons", group: "Customers", icon: G("✺"),
    requiredPermissions: ["customers.read"], comingSoon: true },

  // Finance
  { key: "payments", label: "Payments", group: "Finance", icon: G("⊟"),
    requiredPermissions: ["payments.read"], comingSoon: true },
  { key: "shifts-close", label: "Shift closures", group: "Finance", icon: G("⟳"),
    requiredPermissions: ["shift.close"], comingSoon: true },

  // Reports
  { key: "reports", label: "Reports", group: "Reports", icon: G("☷"),
    requiredPermissions: ["reports.read"], comingSoon: true },
  { key: "exports", label: "Exports", group: "Reports", icon: G("↧"),
    requiredPermissions: ["reports.export"], comingSoon: true },

  // Settings
  { key: "outlet", label: "Outlet & branches", group: "Settings", icon: G("⌂"),
    requiredPermissions: ["settings.read"], comingSoon: true },
  { key: "hardware", label: "Hardware", group: "Settings", icon: G("⎙"),
    requiredPermissions: ["hardware.manage"], comingSoon: true },
  { key: "integrations", label: "Integrations", group: "Settings", icon: G("⇄"),
    requiredPermissions: ["settings.write"], comingSoon: true },
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
