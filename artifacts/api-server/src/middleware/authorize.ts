import type { Request, Response, NextFunction } from "express";

export type AppRole =
  | "super_admin"
  | "owner"
  | "manager"
  | "waiter"
  | "kitchen"
  | "delivery_executive"
  | "customer";

export function requireRole(...roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.user.isSuperAdmin || roles.includes(req.user.role as AppRole)) {
      next();
      return;
    }
    res.status(403).json({ error: "Insufficient permissions" });
  };
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ error: "Super admin access required" });
    return;
  }
  next();
}

export function requireTenantMatch(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.isSuperAdmin) {
    next();
    return;
  }
  const tenantId = Number(req.params.tenantId ?? req.query.tenantId);
  if (tenantId && req.user.tenantId !== tenantId) {
    res.status(403).json({ error: "Cross-tenant access denied" });
    return;
  }
  next();
}
