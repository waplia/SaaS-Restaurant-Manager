/**
 * Permission map for the mobile app.
 *
 * Role → permission actions (verb-style strings used by `usePermission`).
 * Keep in sync with the backend RBAC. The mobile UI uses these to hide or
 * disable per-role actions; the backend still enforces authoritatively.
 */

import type { StaffRole } from "./roles";

export type PermissionAction =
  // Sales / orders
  | "order.create"
  | "order.void"
  | "order.refund"
  | "order.discount.apply"
  | "kot.reprint"
  | "bill.print"
  | "bill.split"
  | "payment.capture"
  // Kitchen
  | "kot.update_status"
  | "kot.86_item"
  // Inventory
  | "stock.adjust"
  | "stock.transfer"
  | "stock.receive_po"
  | "vendor.manage"
  // Cash / shift
  | "shift.open"
  | "shift.close"
  | "cash.drop"
  | "cash.pickup"
  // Delivery
  | "delivery.assign"
  | "delivery.mark_picked"
  | "delivery.mark_delivered"
  | "delivery.handover_cod"
  // Marketing
  | "campaign.create"
  | "campaign.launch"
  | "coupon.create"
  | "review.respond"
  // Accountant
  | "expense.approve"
  | "settlement.reconcile"
  | "report.export"
  // Staff
  | "staff.invite"
  | "attendance.edit"
  | "approval.act"
  // Waiter floor-service actions (Task #637)
  | "waiter.voice_order"
  | "waiter.customer_note"
  | "waiter.mark_served"
  | "waiter.call_manager";

const ROLE_PERMISSIONS: Record<StaffRole, ReadonlyArray<PermissionAction>> = {
  super_admin: [], // wildcard handled below
  owner: [], // wildcard handled below
  manager: [
    "order.create", "order.void", "order.refund", "order.discount.apply",
    "kot.reprint", "bill.print", "bill.split", "payment.capture",
    "kot.update_status", "kot.86_item",
    "stock.adjust", "stock.receive_po", "vendor.manage",
    "shift.open", "shift.close", "cash.drop", "cash.pickup",
    "delivery.assign",
    "campaign.create", "campaign.launch", "coupon.create", "review.respond",
    "expense.approve", "report.export",
    "staff.invite", "attendance.edit", "approval.act",
  ],
  cashier: [
    "order.create", "bill.print", "bill.split", "payment.capture",
    "order.discount.apply",
    // Cashier owns the drawer end-to-end: open/close the shift, drop
    // (cash out for safe drops / payouts), and pickup (cash in for
    // owner adds / change top-ups).
    "shift.open", "shift.close", "cash.drop", "cash.pickup",
  ],
  waiter: [
    "order.create", "bill.print", "kot.reprint",
    "waiter.voice_order", "waiter.customer_note", "waiter.mark_served", "waiter.call_manager",
  ],
  captain: [
    "order.create", "order.discount.apply", "bill.print", "bill.split",
    "kot.reprint", "payment.capture",
    "waiter.voice_order", "waiter.customer_note", "waiter.mark_served", "waiter.call_manager",
  ],
  kitchen: [
    "kot.update_status", "kot.reprint",
  ],
  chef: [
    "kot.update_status", "kot.reprint", "kot.86_item",
  ],
  inventory_manager: [
    "stock.adjust", "stock.transfer", "stock.receive_po", "vendor.manage",
  ],
  hr: [
    "staff.invite", "attendance.edit",
  ],
  payroll: [
    "report.export",
  ],
  marketing: [
    // Note: no "campaign.launch" — marketing role drafts campaigns that
    // require owner/manager approval to launch.
    "campaign.create", "coupon.create", "review.respond",
  ],
  accountant: [
    "expense.approve", "settlement.reconcile", "report.export",
  ],
  delivery_executive: [
    "delivery.mark_picked", "delivery.mark_delivered", "delivery.handover_cod",
  ],
};

/**
 * Resolve whether a role + (optional) per-user permission override grants
 * an action. The optional `userPermissions` parameter accepts an explicit
 * allow-list returned by the backend (e.g. /auth/me) so individual users
 * can be granted extra permissions without changing their role.
 */
export function can(
  role: string | null | undefined,
  action: PermissionAction,
  userPermissions?: ReadonlyArray<string> | null,
): boolean {
  if (!role) return false;
  if (role === "owner" || role === "super_admin") return true;
  if (userPermissions && userPermissions.includes(action)) return true;
  const list = ROLE_PERMISSIONS[role as StaffRole];
  if (!list) return false;
  return list.includes(action);
}

export function permissionsForRole(role: string | null | undefined): ReadonlyArray<PermissionAction> {
  if (!role) return [];
  if (role === "owner" || role === "super_admin") {
    // Materialise a flat list of all known actions for owners.
    const all = new Set<PermissionAction>();
    for (const acts of Object.values(ROLE_PERMISSIONS)) for (const a of acts) all.add(a);
    return Array.from(all);
  }
  return ROLE_PERMISSIONS[role as StaffRole] ?? [];
}
