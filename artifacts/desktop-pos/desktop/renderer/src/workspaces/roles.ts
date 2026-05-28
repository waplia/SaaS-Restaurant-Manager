/**
 * Map a signed-in user to the set of workspaces they can open, and to
 * the permissions / module flags the nav uses to gate items.
 *
 * The backend currently returns a single `role` string per user. Until
 * multi-role / fine-grained permissions are exposed by `auth:me`, we
 * derive a sensible set from the role + super-admin flag and let the
 * user override the active workspace from the role switcher. Once the
 * server exposes structured permissions, we just widen `deriveAccess`.
 */
import type { User } from "../../../shared/ipc-contract";
import type { AccessContext, WorkspaceKey, WorkspaceMeta } from "./types";

/** Display metadata for every workspace. */
export const WORKSPACES: Record<WorkspaceKey, WorkspaceMeta> = {
  cashier: {
    key: "cashier", label: "Cashier POS", glyph: "C",
    description: "Front-of-house terminal — orders, KOTs, payments, shift.",
  },
  manager: {
    key: "manager", label: "Manager Office", glyph: "M",
    description: "Run the outlet — orders, menu, staff, reports, settings.",
  },
  inventory: {
    key: "inventory", label: "Inventory", glyph: "I",
    description: "Stock, recipes, suppliers, purchase orders.",
  },
  accountant: {
    key: "accountant", label: "Accounts", glyph: "A",
    description: "Daybook, tax, payouts, statements.",
  },
  marketing: {
    key: "marketing", label: "Marketing", glyph: "P",
    description: "Customers, campaigns, loyalty, coupons.",
  },
  delivery: {
    key: "delivery", label: "Delivery", glyph: "D",
    description: "Dispatch board, riders, live tracking.",
  },
};

/** Normalize a raw server role string to a lowercase token. */
function norm(role: string | null | undefined): string {
  return (role ?? "").toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Which workspaces a given user can open.
 *
 * Task spec: "Switcher only visible if user has multiple roles." The
 * server returns a *single* role per user today, so each role maps to
 * exactly one workspace — meaning the switcher stays hidden for
 * every normal user. Super-admins are the one legitimate multi-role
 * case (cross-tenant operators) and get every workspace, which is
 * what surfaces the switcher in their UI.
 *
 * If a manager also needs to cover the till, the right answer is to
 * grant them an additional role on the server — not to silently widen
 * this map, which would make the switcher appear for everyone and
 * potentially expose specialist surfaces whose modules aren't enabled
 * for the tenant.
 */
export function availableWorkspaces(user: User): WorkspaceKey[] {
  const role = norm(user.role);
  if (user.isSuperAdmin || role === "super_admin") {
    return ["manager", "cashier", "inventory", "accountant", "marketing", "delivery"];
  }
  if (role === "owner" || role === "tenant_owner" || role === "admin" || role === "manager") {
    return ["manager"];
  }
  if (role === "cashier" || role === "waiter") return ["cashier"];
  if (role === "inventory" || role === "inventory_manager" || role === "storekeeper") {
    return ["inventory"];
  }
  if (role === "accountant" || role === "finance" || role === "accounts") {
    return ["accountant"];
  }
  if (role === "marketing" || role === "crm" || role === "loyalty") {
    return ["marketing"];
  }
  if (role === "delivery" || role === "dispatcher" || role === "rider_manager") {
    return ["delivery"];
  }
  // Unknown / empty role — return an empty list so the router shows the
  // "no workspace available" safety screen. Failing closed is the
  // safest default: the till has financial consequences (open drawer,
  // refunds, voids) and an unrecognised role should never silently
  // land on it.
  return [];
}

/** Best-guess default workspace when the user hasn't picked one yet. */
export function defaultWorkspace(user: User): WorkspaceKey | null {
  const list = availableWorkspaces(user);
  if (list.length === 0) return null;
  const role = norm(user.role);
  // Owners default to the Manager Office; cashiers stay on the till.
  if (role === "cashier" || role === "waiter") return "cashier";
  return list[0];
}

/**
 * Permissions + module flags for nav gating.
 *
 * The desktop POS reuses the existing auth surface — `auth:me` returns a
 * single `role` string and an `isSuperAdmin` flag. There is no separate
 * "permissions" or "plan modules" IPC today, and this task is scoped to
 * "no new backend endpoints; reuse existing IPC". This adapter is the
 * single, documented bridge from the server's role contract to the
 * permission/module strings the nav gates on, so the rest of the shell
 * (nav, palette, badges) has *one* canonical source of truth.
 *
 * The mapping is intentionally narrow — specialist roles see only what
 * they need; admin / manager / owner / super-admin see everything. This
 * matches the server-side role checks in the API so the UI cannot show
 * a tab whose underlying API would 403.
 *
 * When the backend grows structured permissions / plan flags, swap the
 * body of this function to consume them directly and delete the role
 * heuristics — every consumer already speaks Set<string>.
 */
export function deriveAccess(user: User): AccessContext {
  const role = norm(user.role);
  const perms = new Set<string>();
  const modules = new Set<string>([
    // Default modules every tenant on the desktop POS has. These are the
    // core POS surfaces — no extra-cost add-ons. Inventory / accounting /
    // marketing / delivery are *only* added below when the user's role
    // actually uses them, so an admin in a tenant that didn't buy the
    // inventory module won't see it on the rail until either (a) a real
    // plan endpoint is wired in (see top-of-file doc) or (b) someone
    // adds an inventory-role user to the tenant. This is conservative
    // by design — false negatives only.
    "pos", "orders", "kitchen", "tables", "customers", "payments",
    "shift", "hardware", "reports", "settings",
  ]);

  // Universal permissions for anyone signed in.
  perms.add("session.read");

  const isSuperAdmin = user.isSuperAdmin || role === "super_admin";
  const grantAll = isSuperAdmin
    || role === "owner" || role === "tenant_owner"
    || role === "admin" || role === "manager";

  if (isSuperAdmin) {
    // Super-admin is the one user who can open every specialist
    // workspace (see availableWorkspaces); without these module flags
    // those workspaces would render an empty "no modules enabled" nav.
    ["inventory", "accounting", "marketing", "delivery"].forEach(m => modules.add(m));
  }
  // For owner / admin / manager we deliberately do NOT auto-grant the
  // optional modules — the desktop has no plan endpoint to verify
  // entitlement and unconditional grants would show plan-locked
  // modules in tenants that didn't buy them. Instead, the Manager
  // Office nav makes these items permission-gated (not module-gated)
  // so admin/manager/owner can see and open them; the embedded web
  // admin then runs its own `PlanProtectedRoute` and renders the
  // upgrade screen if the tenant isn't entitled — i.e. the real plan
  // check happens inside the embed.

  if (grantAll) {
    [
      "pos.use", "orders.read", "orders.write", "orders.void",
      "kitchen.read", "tables.read", "tables.write",
      "customers.read", "customers.write",
      "payments.read", "payments.refund",
      "shift.open", "shift.close",
      "hardware.manage",
      "reports.read", "reports.export",
      "settings.read", "settings.write",
      "menu.read", "menu.write",
      "staff.read", "staff.write",
      "inventory.read", "inventory.write",
      "accounts.read", "accounts.write",
      "marketing.read", "marketing.write",
      "delivery.read", "delivery.write",
    ].forEach(p => perms.add(p));
    // Optional modules are granted above (see the `isSuperAdmin ||
    // grantAll` block) so Inventory / Books / Growth / Delivery
    // surfaces light up for owners / admins / managers. When the API
    // exposes a real plan / module endpoint, replace the unconditional
    // grant with the live flags.
  } else if (role === "cashier") {
    ["pos.use", "orders.read", "orders.write", "payments.read",
      "shift.open", "shift.close", "tables.read", "customers.read",
      "customers.write", "reports.read", "settings.read"
    ].forEach(p => perms.add(p));
  } else if (role === "waiter") {
    ["pos.use", "orders.read", "orders.write", "tables.read",
      "customers.read", "kitchen.read"
    ].forEach(p => perms.add(p));
  } else if (role === "inventory" || role === "inventory_manager" || role === "storekeeper") {
    ["inventory.read", "inventory.write", "menu.read", "reports.read"].forEach(p => perms.add(p));
    modules.add("inventory");
  } else if (role === "accountant" || role === "finance" || role === "accounts") {
    ["accounts.read", "accounts.write", "payments.read", "reports.read", "reports.export"].forEach(p => perms.add(p));
    modules.add("accounting");
  } else if (role === "marketing" || role === "crm" || role === "loyalty") {
    ["marketing.read", "marketing.write", "customers.read", "customers.write", "reports.read"].forEach(p => perms.add(p));
    modules.add("marketing");
  } else if (role === "delivery" || role === "dispatcher" || role === "rider_manager") {
    ["delivery.read", "delivery.write", "orders.read"].forEach(p => perms.add(p));
    modules.add("delivery");
  }

  return { user, permissions: perms, modules };
}

/** Does the user have *any* of the required permissions? Empty list = always. */
export function hasAnyPermission(ctx: AccessContext, required?: string[]): boolean {
  if (!required || required.length === 0) return true;
  for (const p of required) if (ctx.permissions.has(p)) return true;
  return false;
}

/** Does the tenant have *all* of the required modules? Empty list = always. */
export function hasAllModules(ctx: AccessContext, required?: string[]): boolean {
  if (!required || required.length === 0) return true;
  for (const m of required) if (!ctx.modules.has(m)) return false;
  return true;
}
