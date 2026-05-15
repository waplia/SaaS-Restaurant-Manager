import type { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtPayload } from "../lib/auth";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    if (payload.type !== "access") {
      res.status(401).json({ error: "Refresh token cannot be used for API access" });
      return;
    }
    // Impersonation tokens are read-only: super-admin "view as" sessions
    // can browse but cannot mutate the tenant's data.
    if (payload.impersonated && req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      res.status(403).json({ error: "Impersonation session is read-only." });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7);
    try {
      const payload = verifyToken(token);
      if (payload.type === "access") req.user = payload;
    } catch {
      // silently ignore invalid optional tokens
    }
  }
  next();
}
