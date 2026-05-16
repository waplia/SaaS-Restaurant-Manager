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
  | "khana_ai"
  | "finance"
  | "expenses"
  | "reports"
  | "notifications"
  | "alerts"
  | "approvals"
  | "outlets"
  | "support"
  | "settings";

const FULL: ModuleKey[] = [
  "dashboard", "orders", "kitchen", "tables", "waiter_requests", "reservations",
  "delivery", "inventory", "menu", "staff", "attendance", "tasks", "customers",
  "feedback", "growth", "khana_ai", "finance", "expenses", "reports",
  "notifications", "alerts", "approvals", "outlets", "support", "settings",
];

const ROLE_ACCESS: Record<StaffRole, ModuleKey[]> = {
  super_admin: FULL,
  owner: FULL,
  manager: [
    "dashboard", "orders", "kitchen", "tables", "waiter_requests", "reservations",
    "delivery", "inventory", "menu", "staff", "attendance", "tasks",
    "customers", "feedback", "growth", "khana_ai", "reports", "notifications",
    "alerts", "approvals", "outlets", "support", "settings",
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
    "customers", "feedback", "growth", "khana_ai", "reports", "notifications",
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
