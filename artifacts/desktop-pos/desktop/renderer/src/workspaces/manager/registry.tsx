/**
 * Manager-Office screen registry.
 *
 * Maps every Manager `NavItem.key` to a renderable component. Screens
 * fall into three buckets:
 *
 *   • Reused cashier screens — `KitchenScreen`, `TablesScreen`,
 *     `CustomersScreen`, `QrOrdersPanel`, `PaymentsScreen`,
 *     `ReportsScreen`, `HardwareSettings`, `OrderWorkspace`. These are
 *     already real, IPC-backed and battle-tested on the till.
 *
 *   • New Manager-native screens — `Dashboard`, `MenuBrowser`,
 *     `SystemLogs`, `SyncScreen`, `BackOffice`, `SettingsHub`. Built in
 *     this task; only use the existing IPC.
 *
 *   • `WebAdminBridge` — every module without a desktop IPC yet
 *     (Inventory, Purchase, Staff, Finance/Accounting deep, Growth,
 *     Providers, Khana AI, advanced settings). Renders a polished
 *     landing card explaining the module and deep-links to the web
 *     admin via `app:open-external`. Flagged in `gaps.md` so the IPC
 *     work for each can be picked up later — the registry swap is the
 *     only renderer change required.
 *
 * The screen factory receives the active `NavItem` and a `navigate`
 * helper so tiles / cards inside one screen can jump to another
 * (Dashboard → Reports, BackOffice → any module, etc.) without
 * prop-drilling state up to the shell.
 */
import type { SelectionState, User } from "../../../../shared/ipc-contract";
import type { NavItem } from "../types";
import {
  HardwareSettings,
} from "../../screens/HardwareSettings";
import { KitchenScreen } from "../../screens/KitchenScreen";
import { TablesScreen } from "../../screens/TablesScreen";
import { CustomersScreen } from "../../screens/CustomersScreen";
import { QrOrdersPanel } from "../../screens/QrOrdersPanel";
import { PaymentsScreen } from "../../screens/PaymentsScreen";
import { ReportsScreen } from "../../screens/ReportsScreen";
import { OrderWorkspace, type WorkspaceHandoff } from "../../screens/OrderWorkspace";
import { ComingSoon } from "../ComingSoon";
import { ManagerDashboard } from "./Dashboard";
import { MenuBrowser } from "./MenuBrowser";
import { SystemLogs } from "./SystemLogs";
import { SyncScreen } from "./SyncScreen";
import { BackOffice } from "./BackOffice";
import { SettingsHub } from "./SettingsHub";
import { WebAdminBridge } from "./WebAdminBridge";

/**
 * Public registry of every deep-link the Manager-Office WebAdminBridge
 * surfaces opens. Keyed by NavItem.key, values are `{ label, path }`
 * pairs that mirror the `actions` props passed to `WebAdminBridge`
 * below. Exposed so the Back Office index can render each sub-screen
 * as a discoverable chip (otherwise operators would have to open the
 * module to see what's inside). Keep this in sync with the action
 * arrays below — the unit test in `__tests__/manager-registry-routes`
 * walks both shapes to catch drift.
 */
export const MANAGER_DEEP_LINKS: Record<string, { label: string; path: string }[]> = {
  inventory: [
    { label: "Open Inventory", path: "/inventory" },
    { label: "Vendor invoices", path: "/inventory/vendor-invoices" },
    { label: "Recipe versions", path: "/inventory/recipe-versions" },
    { label: "Portion drift", path: "/inventory/portion-drift" },
    { label: "Condiments", path: "/inventory/condiments" },
    { label: "Packaging", path: "/inventory/packaging" },
    { label: "Wastage", path: "/waste" },
  ],
  purchase: [
    { label: "Marketplace", path: "/marketplace" },
    { label: "Purchase requests", path: "/marketplace/purchase-requests" },
    { label: "Supplier catalog", path: "/marketplace/supplier-catalog" },
    { label: "Vendor invoices", path: "/inventory/vendor-invoices" },
  ],
  staff: [
    { label: "Staff directory", path: "/staff" },
    { label: "Scheduling", path: "/staff/scheduling" },
    { label: "Tasks", path: "/staff-tasks" },
    { label: "Incentives", path: "/staff-incentives" },
    { label: "Payroll", path: "/payroll" },
    { label: "Training", path: "/sop-training" },
  ],
  finance: [
    { label: "Accounting books", path: "/finance/accounting-books" },
    { label: "Expenses", path: "/expenses" },
    { label: "Due payments", path: "/due-payments" },
    { label: "P&L", path: "/pnl" },
    { label: "Settlements", path: "/settlements" },
    { label: "Aggregator payouts", path: "/aggregator-payouts" },
    { label: "Accounting settings", path: "/settings/accounting" },
    { label: "Compliance", path: "/compliance" },
  ],
  growth: [
    { label: "Growth engine", path: "/growth" },
    { label: "Local map", path: "/growth/local-map" },
    { label: "Festival calendar", path: "/growth/festival-calendar" },
    { label: "Offer conflicts", path: "/growth/offer-conflicts" },
    { label: "Upsell Pro", path: "/growth/upsell-pro" },
    { label: "Loyalty analytics", path: "/loyalty/analytics" },
    { label: "Wallets", path: "/wallets" },
    { label: "Gift cards", path: "/gift-cards" },
    { label: "Competitors", path: "/competitors" },
    { label: "Complaints", path: "/customers/complaints" },
  ],
  providers: [
    { label: "API keys", path: "/settings/api-keys" },
    { label: "Webhooks", path: "/settings/webhooks" },
    { label: "Webhook logs", path: "/settings/webhook-logs" },
    { label: "API logs", path: "/settings/api-logs" },
    { label: "OAuth apps", path: "/settings/oauth-apps" },
    { label: "Developer docs", path: "/settings/developer-docs" },
  ],
  outlets: [
    { label: "Account & brand", path: "/settings/account" },
    { label: "Subscription", path: "/settings/subscription" },
  ],
  kitchens: [
    { label: "Kitchens", path: "/settings/kitchens" },
    { label: "Printer routing", path: "/settings/printers" },
    { label: "Token display", path: "/settings/token-display" },
  ],
  taxes: [
    { label: "Tax settings", path: "/settings/taxes" },
    { label: "Bill templates", path: "/settings/bill-templates" },
  ],
  discounts: [
    { label: "Discounts", path: "/settings/discounts" },
    { label: "Gift cards", path: "/gift-cards" },
    { label: "Festival calendar", path: "/growth/festival-calendar" },
  ],
  attendance: [
    { label: "Attendance portal", path: "/portal/attendance" },
    { label: "Shifts portal", path: "/portal/shifts" },
    { label: "Scheduling", path: "/staff/scheduling" },
    { label: "Tasks", path: "/staff-tasks" },
  ],
  devices: [
    { label: "Devices", path: "/settings/devices" },
    { label: "Terminals", path: "/settings/terminals" },
    { label: "Counters", path: "/settings/counters" },
    { label: "Sessions", path: "/settings/sessions" },
  ],
  audit: [
    { label: "API logs", path: "/settings/api-logs" },
    { label: "Webhook logs", path: "/settings/webhook-logs" },
  ],
  ai: [
    { label: "Menu import", path: "/ai/menu-import" },
    { label: "Descriptions", path: "/ai/descriptions" },
    { label: "Images", path: "/ai/images" },
    { label: "Sales insights", path: "/ai/insights" },
    { label: "Inventory forecast", path: "/ai/inventory" },
    { label: "Upsell", path: "/ai/upsell" },
    { label: "Review replies", path: "/ai/review-replies" },
    { label: "Review QRs", path: "/ai/review-qrs" },
    { label: "AI usage", path: "/ai/usage" },
    { label: "AI settings", path: "/ai/settings" },
  ],
};

export interface ManagerScreenCtx {
  user: User;
  selection: SelectionState;
  online: boolean;
  navItems: NavItem[];
  navigate: (key: string) => void;
  /** Handoff into the OrderWorkspace (used when a Tables/QR/Customers row
   *  asks to resume / open an order in the POS pane). */
  orderHandoff: WorkspaceHandoff | null;
  setOrderHandoff: (h: WorkspaceHandoff | null) => void;
}

/**
 * Build the screen for a given nav item. Returns `null` when the key
 * has no entry — caller falls back to `<ComingSoon>`.
 */
export function renderManagerScreen(item: NavItem, ctx: ManagerScreenCtx): React.ReactNode {
  const { navigate } = ctx;

  switch (item.key) {
    // ── Reused cashier screens ─────────────────────────────────────
    case "orders":
      return (
        <OrderWorkspace
          handoff={ctx.orderHandoff}
          onHandoffConsumed={() => ctx.setOrderHandoff(null)}
          initialRailOpen
        />
      );
    case "tables":
      return <TablesScreen onOpenTable={(t, orderId) => {
        ctx.setOrderHandoff(
          orderId
            ? { kind: "order", orderId }
            : { kind: "table", tableId: t.id }
        );
        navigate("orders");
      }} />;
    case "kitchen":
      return <KitchenScreen onOpenOrder={(id) => {
        ctx.setOrderHandoff({ kind: "order", orderId: id });
        navigate("orders");
      }} />;
    case "qr":
      return <QrOrdersPanel onOpenOrder={(id) => {
        ctx.setOrderHandoff({ kind: "order", orderId: id });
        navigate("orders");
      }} />;
    case "customers":
      return <CustomersScreen onUseInOrder={(c) => {
        ctx.setOrderHandoff({ kind: "customer", customer: c });
        navigate("orders");
      }} />;
    case "payments":
      return <PaymentsScreen onOpenOrder={(id) => {
        ctx.setOrderHandoff({ kind: "order", orderId: id });
        navigate("orders");
      }} />;
    case "reports":
      return <ReportsScreen />;
    case "hardware":
      return <HardwareSettings online={ctx.online} />;

    // ── New Manager-native screens ─────────────────────────────────
    case "overview":
    case "dashboard":
      return <ManagerDashboard onNavigate={navigate} />;
    case "menu":
      return <MenuBrowser />;
    case "system":
    case "logs":
      return <SystemLogs onNavigate={navigate} />;
    case "sync":
      return <SyncScreen />;
    case "backoffice":
      return <BackOffice items={ctx.navItems} onNavigate={navigate} />;
    case "settings":
      return <SettingsHub onNavigate={navigate} />;

    // ── WebAdminBridge — modules without desktop IPC yet ───────────
    case "inventory":
      return <WebAdminBridge
        title="Inventory" group={item.group}
        description="Stock on hand, recipe & BOM management, low-stock alerts and stock audits. The desktop POS does not yet ship a native inventory IPC — open the web admin for the full surface."
        capabilities={[
          "Track stock levels across outlets and warehouses",
          "Manage recipes (BOM), portion sizes, and yield",
          "Record wastage and stock adjustments with reasons",
          "Run periodic stock audits and reconciliations",
        ]}
        actions={[
          { label: "Open Inventory", path: "/inventory", hint: "Stock, recipes, low-stock" },
          { label: "Vendor invoices", path: "/inventory/vendor-invoices" },
          { label: "Recipe versions", path: "/inventory/recipe-versions" },
          { label: "Portion drift", path: "/inventory/portion-drift" },
          { label: "Condiments", path: "/inventory/condiments" },
          { label: "Packaging", path: "/inventory/packaging" },
          { label: "Wastage", path: "/waste" },
        ]}
        ipcNote="Desktop IPC for stock read/write is not implemented in this build — the Manager Office uses the web admin for inventory work."
      />;
    case "purchase":
      return <WebAdminBridge
        title="Purchase & suppliers" group={item.group}
        description="Create purchase requests, manage suppliers via the marketplace, and reconcile vendor invoices."
        capabilities={[
          "Raise and track purchase requests",
          "Browse the supplier marketplace and price lists",
          "Receive goods and post invoices into accounting",
        ]}
        actions={[
          { label: "Marketplace", path: "/marketplace" },
          { label: "Purchase requests", path: "/marketplace/purchase-requests" },
          { label: "Supplier catalog", path: "/marketplace/supplier-catalog" },
          { label: "Vendor invoices", path: "/inventory/vendor-invoices" },
        ]}
        ipcNote="Procurement IPC isn't wired into the desktop yet — opens the web admin."
      />;
    case "staff":
      return <WebAdminBridge
        title="Staff & roles" group={item.group}
        description="Manage staff accounts, role assignments, scheduling, attendance, tasks, training and incentives."
        capabilities={[
          "Invite staff and assign roles (owner, manager, cashier, waiter, kitchen, …)",
          "Build rosters and capture attendance",
          "Assign tasks and run SOP training",
          "Track incentives and performance",
        ]}
        actions={[
          { label: "Staff directory", path: "/staff" },
          { label: "Scheduling", path: "/staff/scheduling" },
          { label: "Tasks", path: "/staff-tasks" },
          { label: "Incentives", path: "/staff-incentives" },
          { label: "Payroll", path: "/payroll" },
          { label: "Training", path: "/sop-training" },
        ]}
        ipcNote="Desktop IPC for the staff CRUD endpoints is not yet implemented — the web admin remains the source of truth."
      />;
    case "finance":
      return <WebAdminBridge
        title="Books & expenses" group={item.group}
        description="Accounting books, expenses, settlements, taxes and payouts. The desktop already covers cash sales, tender mix and Z-reports — open the web admin for ledgers, expenses and tax filings."
        capabilities={[
          "Accounting books (daybook, ledger, P&L, balance sheet)",
          "Record expenses with categories and approvals",
          "Reconcile aggregator settlements and bank payouts",
          "Manage tax (GST / VAT) and run periodic returns",
        ]}
        actions={[
          { label: "Accounting books", path: "/finance/accounting-books" },
          { label: "Expenses", path: "/expenses" },
          { label: "Due payments", path: "/due-payments" },
          { label: "P&L", path: "/pnl" },
          { label: "Settlements", path: "/settlements" },
          { label: "Aggregator payouts", path: "/aggregator-payouts" },
          { label: "Accounting settings", path: "/settings/accounting" },
          { label: "Compliance", path: "/compliance" },
        ]}
        ipcNote="Finance IPC beyond shift/payments isn't in the desktop yet — the bookkeeping surface stays on the web admin."
      />;
    case "growth":
      return <WebAdminBridge
        title="Growth & marketing" group={item.group}
        description="Marketing campaigns, loyalty programs, wallets, gift cards, customer feedback and competitor analysis."
        capabilities={[
          "Run growth campaigns and promotions",
          "Build loyalty programs and analytics",
          "Track competitor positioning",
          "Issue gift cards and wallets",
        ]}
        actions={[
          { label: "Growth engine", path: "/growth" },
          { label: "Local map", path: "/growth/local-map" },
          { label: "Festival calendar", path: "/growth/festival-calendar" },
          { label: "Offer conflicts", path: "/growth/offer-conflicts" },
          { label: "Upsell Pro", path: "/growth/upsell-pro" },
          { label: "Loyalty analytics", path: "/loyalty/analytics" },
          { label: "Wallets", path: "/wallets" },
          { label: "Gift cards", path: "/gift-cards" },
          { label: "Competitors", path: "/competitors" },
          { label: "Complaints", path: "/customers/complaints" },
        ]}
        ipcNote="Growth / marketing IPC isn't wired into the desktop yet."
      />;
    case "providers":
      return <WebAdminBridge
        title="Providers & integrations" group={item.group}
        description="API keys, webhooks, OAuth apps and developer docs for connecting third-party providers."
        capabilities={[
          "Manage API keys and webhooks",
          "Inspect webhook delivery logs",
          "Register OAuth apps for partners",
          "Read the developer reference",
        ]}
        actions={[
          { label: "API keys", path: "/settings/api-keys" },
          { label: "Webhooks", path: "/settings/webhooks" },
          { label: "Webhook logs", path: "/settings/webhook-logs" },
          { label: "API logs", path: "/settings/api-logs" },
          { label: "OAuth apps", path: "/settings/oauth-apps" },
          { label: "Developer docs", path: "/settings/developer-docs" },
        ]}
        ipcNote="Integration setup is admin-only and stays on the web admin until the desktop ships its own settings tree."
      />;
    case "outlets":
      return <WebAdminBridge
        title="Outlets & branches" group={item.group}
        description="Account-level brand and outlet settings, plus the active subscription. Switch the active outlet from the desktop header; create/edit branches here."
        capabilities={[
          "Edit brand identity and contact details",
          "Manage the tenant's subscription plan",
          "Use the desktop header to switch outlets",
        ]}
        actions={[
          { label: "Account & brand", path: "/settings/account" },
          { label: "Subscription", path: "/settings/subscription" },
        ]}
        ipcNote="Outlet/brand editing lives on the web admin; the desktop already has a branch picker in the header."
      />;
    case "kitchens":
      return <WebAdminBridge
        title="Kitchens & stations" group={item.group}
        description="Configure kitchen stations (hot kitchen, bar, tandoor, …), route items to the right printer, and balance load across stations."
        capabilities={[
          "Define kitchens / stations",
          "Map menu categories or items to a station",
          "Set per-kitchen printer overrides",
        ]}
        actions={[
          { label: "Kitchens", path: "/settings/kitchens" },
          { label: "Printer routing", path: "/settings/printers" },
          { label: "Token display", path: "/settings/token-display" },
        ]}
        ipcNote="Per-kitchen printer overrides have native settings on the desktop (Hardware); routing config stays on the web admin."
      />;
    case "taxes":
      return <WebAdminBridge
        title="Taxes & charges" group={item.group}
        description="GST / VAT / service charge configuration, tax slabs, and bill template tweaks that read those taxes."
        capabilities={[
          "Define tax slabs (GST / VAT)",
          "Configure service charge and rounding rules",
          "Customise the bill template to show them clearly",
        ]}
        actions={[
          { label: "Tax settings", path: "/settings/taxes" },
          { label: "Bill templates", path: "/settings/bill-templates" },
        ]}
        ipcNote="Tax configuration lives on the web admin until the desktop ships its own settings tree."
      />;
    case "discounts":
      return <WebAdminBridge
        title="Discounts & offers" group={item.group}
        description="Set up discounts, happy-hour offers, gift cards and BOGO rules that the POS picks up automatically."
        capabilities={[
          "Create discount profiles",
          "Schedule happy-hour or weekday offers",
          "Issue gift cards customers can redeem at the till",
        ]}
        actions={[
          { label: "Discounts", path: "/settings/discounts" },
          { label: "Gift cards", path: "/gift-cards" },
          { label: "Festival calendar", path: "/growth/festival-calendar" },
        ]}
        ipcNote="Discount setup stays on the web admin; the POS reads and applies the resulting rules."
      />;
    case "attendance":
      return <WebAdminBridge
        title="Attendance & shifts" group={item.group}
        description="Track staff clock-in / clock-out, manage rosters and review attendance reports."
        capabilities={[
          "Clock-in / clock-out log",
          "Roster planning across the week",
          "Tasks and incentives",
        ]}
        actions={[
          { label: "Attendance portal", path: "/portal/attendance" },
          { label: "Shifts portal", path: "/portal/shifts" },
          { label: "Scheduling", path: "/staff/scheduling" },
          { label: "Tasks", path: "/staff-tasks" },
        ]}
        ipcNote="Attendance lives on the web admin; the desktop opens the right page in-shell."
      />;
    case "devices":
      return <WebAdminBridge
        title="Devices & terminals" group={item.group}
        description="See which POS terminals and tablets are paired to this tenant, revoke compromised sessions, and configure counters."
        capabilities={[
          "List paired devices and terminals",
          "Revoke active sessions",
          "Configure counter assignments",
        ]}
        actions={[
          { label: "Devices", path: "/settings/devices" },
          { label: "Terminals", path: "/settings/terminals" },
          { label: "Counters", path: "/settings/counters" },
          { label: "Sessions", path: "/settings/sessions" },
        ]}
        ipcNote="Device admin is a security surface — it remains on the web admin."
      />;
    case "audit":
      return <WebAdminBridge
        title="Audit log" group={item.group}
        description="Searchable timeline of API traffic, webhook deliveries and integration activity."
        capabilities={[
          "Filter API and webhook logs by status / endpoint",
          "Drill into request and response payloads",
          "Re-deliver failed webhooks",
        ]}
        actions={[
          { label: "API logs", path: "/settings/api-logs" },
          { label: "Webhook logs", path: "/settings/webhook-logs" },
        ]}
        ipcNote="Audit logs live on the web admin — the desktop embeds them here."
      />;
    case "ai":
      return <WebAdminBridge
        title="Khana AI" group={item.group}
        description="AI-powered tools: menu import, descriptions, image generation, sales insights, demand forecasting, upsell suggestions and review replies."
        capabilities={[
          "Bulk-import menus from PDFs or photos",
          "Generate menu descriptions and food photography",
          "Forecast demand and detect anomalies",
          "Suggest upsells and auto-reply to reviews",
        ]}
        actions={[
          { label: "Menu import", path: "/ai/menu-import" },
          { label: "Descriptions", path: "/ai/descriptions" },
          { label: "Images", path: "/ai/images" },
          { label: "Sales insights", path: "/ai/insights" },
          { label: "Inventory forecast", path: "/ai/inventory" },
          { label: "Upsell", path: "/ai/upsell" },
          { label: "Review replies", path: "/ai/review-replies" },
          { label: "Review QRs", path: "/ai/review-qrs" },
          { label: "AI usage", path: "/ai/usage" },
          { label: "AI settings", path: "/ai/settings" },
        ]}
        ipcNote="AI tools live on the web admin — desktop wraps them via the browser today."
      />;
  }

  // Anything else falls back to the standard ComingSoon empty state so
  // a future nav item never silently breaks the shell.
  return <ComingSoon title={item.label} group={item.group}
    description="This module isn't wired into the desktop yet — coming soon." />;
}
