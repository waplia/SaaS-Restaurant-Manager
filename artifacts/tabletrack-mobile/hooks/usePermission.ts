import { useAuth } from "@/context/AuthContext";
import { can, type PermissionAction } from "@/lib/permissions";

/**
 * Returns `true` if the active user role can perform the given action.
 *
 * Per-role screens should use this to hide or disable buttons that the
 * current user isn't allowed to use (e.g. apply discount, reprint KOT,
 * transfer stock). The backend still enforces authoritatively; this just
 * keeps the UI honest.
 *
 * ```tsx
 * const canDiscount = usePermission("order.discount.apply");
 * {canDiscount ? <DiscountButton/> : null}
 * ```
 */
export function usePermission(action: PermissionAction): boolean {
  const { user, activeRole, permissions } = useAuth();
  if (!user) return false;
  return can(activeRole ?? user.role, action, permissions);
}
