/**
 * Role-based access map for the KhanaLagao mobile app.
 *
 * Keep in sync with the backend (artifacts/api-server/src/lib/rbac.ts).
 * The backend remains the source of truth; this map controls *visibility*
 * (what shows up in the More menu / tabs) only — never bypass it as a
 * security boundary.
 */

export type StaffRole =
  | "owner"
  | "manager"
  | "cashier"
  | "waiter"
  | "captain"
  | "kitchen"
  | "chef"
  | "inventory_manager"
  | "hr"
  | "payroll"
  | "marketing"
  | "accountant"
  | "delivery_executive"
  | "super_admin";

export type ModuleKey =
  | "dashboard"
  | "orders"
  | "kitchen"
  | "tables"
  | "waiter_requests"
  | "reservations"
  | "delivery"
  | "inventory"
  | "menu"
  | "staff"
  | "attendance"
  | "tasks"
  | "customers"
  | "feedback"
  | "growth"
  | "coupons"
  | "khana_ai"
  | "finance"
  | "expenses"
  | "reports"
  | "notifications"
  | "alerts"
  | "approvals"
  | "outlets"
  | "printers"
  | "support"
  | "settings"
  | "billing"
  | "business_hours"
  | "operational_shifts"
  | "tax_gst"
  | "direct_ordering";

const FULL: ModuleKey[] = [
  "dashboard", "orders", "kitchen", "tables", "waiter_requests", "reservations",
  "delivery", "inventory", "menu", "staff", "attendance", "tasks", "customers",
  "feedback", "growth", "coupons", "khana_ai", "finance", "expenses", "reports",
  "notifications", "alerts", "approvals", "outlets", "printers", "support", "settings",
  "billing", "business_hours", "operational_shifts", "tax_gst", "direct_ordering",
];

const ROLE_ACCESS: Record<StaffRole, ModuleKey[]> = {
  super_admin: FULL,
  owner: FULL,
  manager: [
    "dashboard", "orders", "kitchen", "tables", "waiter_requests", "reservations",
    "delivery", "inventory", "menu", "staff", "attendance", "tasks",
    "customers", "feedback", "growth", "coupons", "khana_ai", "reports", "notifications",
    "alerts", "approvals", "outlets", "printers", "support", "settings", "billing",
    "business_hours", "operational_shifts", "tax_gst", "direct_ordering",
  ],
  cashier: [
    "dashboard", "orders", "tables", "expenses", "notifications", "alerts",
    "support", "settings",
  ],
  waiter: [
    "orders", "tables", "waiter_requests", "menu", "reservations",
    "notifications", "alerts", "support", "settings",
  ],
  captain: [
    "dashboard", "orders", "tables", "waiter_requests", "menu", "reservations",
    "staff", "notifications", "alerts", "support", "settings",
  ],
  kitchen: [
    "kitchen", "menu", "notifications", "alerts", "support", "settings",
  ],
  chef: [
    "kitchen", "menu", "inventory", "notifications", "alerts", "support", "settings",
  ],
  inventory_manager: [
    "inventory", "menu", "notifications", "alerts", "approvals", "support", "settings",
  ],
  hr: [
    "staff", "attendance", "tasks", "notifications", "alerts", "approvals",
    "support", "settings",
  ],
  payroll: [
    "staff", "attendance", "finance", "reports", "notifications", "alerts",
    "approvals", "support", "settings",
  ],
  marketing: [
    "customers", "feedback", "growth", "coupons", "khana_ai", "reports", "notifications",
    "alerts", "support", "settings",
  ],
  accountant: [
    "finance", "expenses", "reports", "notifications", "alerts", "approvals",
    "support", "settings",
  ],
  delivery_executive: [
    "delivery", "notifications", "alerts", "support", "settings",
  ],
};

export function rolesAllow(role: string | undefined | null, mod: ModuleKey): boolean {
  if (!role) return false;
  const allowed = ROLE_ACCESS[role as StaffRole];
  if (!allowed) return false;
  return allowed.includes(mod);
}

export function allowedModules(role: string | undefined | null): ModuleKey[] {
  if (!role) return [];
  return ROLE_ACCESS[role as StaffRole] ?? [];
}

/**
 * Returns the post-login home route for a given role. The mobile app has a
 * small number of role stacks ("(owner)", "(waiter)", "(customer)",
 * "(delivery)"), so several roles map to the same stack but to a screen that
 * makes sense for them.
 */
export function roleHomePath(role: string | undefined | null): string {
  switch (role) {
    case "owner":
    case "manager":
    case "super_admin":
      return "/(owner)";
    case "cashier":
      return "/(cashier)";
    case "kitchen":
    case "chef":
      return "/(chef)";
    case "inventory_manager":
      return "/(inventory)";
    case "accountant":
    case "payroll":
      return "/(accountant)";
    case "hr":
      return "/(owner)/staff";
    case "marketing":
      return "/(marketing)";
    case "waiter":
    case "captain":
      return "/(waiter)/(tabs)";
    case "delivery_executive":
      return "/(delivery)/assigned";
    case "customer":
      return "/(customer)";
    default:
      return "/(owner)";
  }
}

/**
 * Role categories used by the notifications screen to filter the inbox.
 * Each category maps to a set of `notifications.type` values the role
 * actually cares about — chefs don't need to see marketing campaigns; the
 * cashier doesn't need every kitchen flip.
 */
export const NOTIFICATION_TYPES_BY_ROLE: Record<string, string[] | "all"> = {
  super_admin: "all",
  owner: "all",
  manager: "all",
  cashier: ["new_order", "order_status", "payment_received", "shift_close", "waiter_call"],
  waiter: ["new_order", "order_status", "kitchen_ready", "waiter_call", "reservation"],
  captain: ["new_order", "order_status", "kitchen_ready", "waiter_call", "reservation"],
  kitchen: ["new_order", "kitchen_ready", "kot_assigned"],
  chef: ["new_order", "kitchen_ready", "kot_assigned", "low_stock"],
  inventory_manager: ["low_stock", "po_received", "stock_adjusted", "vendor"],
  hr: ["attendance", "leave_request", "task_assigned"],
  payroll: ["attendance", "payroll_run", "report_ready"],
  marketing: ["campaign", "coupon", "review", "report_ready"],
  accountant: ["expense_submitted", "settlement", "report_ready"],
  delivery_executive: ["delivery_assigned", "delivery_status"],
  customer: ["order_status", "reward", "coupon"],
};

export function notificationTypesForRole(role: string | null | undefined): string[] | "all" {
  if (!role) return [];
  return NOTIFICATION_TYPES_BY_ROLE[role] ?? "all";
}

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  waiter: "Waiter",
  captain: "Captain",
  kitchen: "Kitchen",
  chef: "Chef",
  inventory_manager: "Inventory",
  hr: "HR",
  payroll: "Payroll",
  marketing: "Marketing",
  accountant: "Accountant",
  delivery_executive: "Delivery",
  customer: "Customer",
};
