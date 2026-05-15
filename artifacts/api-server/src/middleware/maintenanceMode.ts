import type { Request, Response, NextFunction } from "express";
import { getAppSettings } from "../lib/appSettings";
import { verifyToken } from "../lib/auth";

/**
 * Pre-auth gate: blocks ALL traffic during maintenance, allowing only the
 * paths required for super admins to log in and toggle the flag back off,
 * the public app-settings endpoint (so the frontend can render the
 * maintenance screen), and health checks. Mounted before authentication.
 */
const MAINTENANCE_ALLOWLIST: RegExp[] = [
  /^\/auth\/(login|refresh|logout)$/,
  /^\/public\/app-settings$/,
  /^\/health$/,
  // Super-admin App Settings management endpoints — must remain reachable so
  // a super admin can toggle maintenance off. Auth is still enforced by
  // `requireSuperAdmin` inside the router.
  /^\/admin\/app-settings(\/.*)?$/,
  // Stripe/Cashfree/Razorpay webhooks — never gate provider callbacks.
  /^\/(stripe|cashfree|razorpay)\/webhook$/,
];

function isAllowlisted(path: string): boolean {
  return MAINTENANCE_ALLOWLIST.some((re) => re.test(path));
}

function tryDecodeSuperAdmin(req: Request): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  try {
    const payload = verifyToken(header.slice(7));
    return payload.type === "access" && payload.isSuperAdmin === true;
  } catch {
    return false;
  }
}

export async function maintenanceGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await getAppSettings();
    if (!settings.maintenanceMode) return next();
    if (isAllowlisted(req.path)) return next();
    // Let authenticated super admins through to any route during maintenance
    // so they can manage the platform. `authenticate` will still re-verify
    // and `requireSuperAdmin` will gate admin endpoints normally.
    if (tryDecodeSuperAdmin(req)) return next();
    res.status(503).json({
      error: "Service is in maintenance mode",
      maintenance: true,
      message: settings.maintenanceMessage ?? "We're performing scheduled maintenance. Please try again shortly.",
    });
  } catch {
    next();
  }
}

/**
 * Post-auth check: lets super admins through even when maintenance is on,
 * so they can manage settings via authenticated admin routes.
 */
export async function maintenanceMode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await getAppSettings();
    if (!settings.maintenanceMode) return next();
    if (req.user?.isSuperAdmin) return next();
    res.status(503).json({
      error: "Service is in maintenance mode",
      maintenance: true,
      message: settings.maintenanceMessage ?? "We're performing scheduled maintenance. Please try again shortly.",
    });
  } catch {
    next();
  }
}
