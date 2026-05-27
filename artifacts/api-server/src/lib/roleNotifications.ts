/**
 * Server-side allow-list of `notifications.type` values per role.
 *
 * Mirrors `NOTIFICATION_TYPES_BY_ROLE` in
 * artifacts/tabletrack-mobile/lib/roles.ts. The mobile client also
 * sends a `types=` query param for UX, but this map is the security
 * boundary: requested types are intersected with this allow-list so
 * non-owner roles cannot read categories outside their scope by
 * tampering with the query string.
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

/**
 * Returns the effective list of allowed `notifications.type` values for
 * a given role + optional requested types. Returns `null` when the role
 * should see every category (owner / manager / super_admin).
 */
export function effectiveNotificationTypes(
  role: string | null | undefined,
  isSuperAdmin: boolean,
  requested?: string[] | null,
): string[] | null {
  if (isSuperAdmin) {
    return requested && requested.length > 0 ? requested : null;
  }
  const allow = role ? NOTIFICATION_TYPES_BY_ROLE[role] : undefined;
  if (allow === "all") {
    return requested && requested.length > 0 ? requested : null;
  }
  if (!allow) return [];
  if (!requested || requested.length === 0) return allow;
  return requested.filter((t) => allow.includes(t));
}
