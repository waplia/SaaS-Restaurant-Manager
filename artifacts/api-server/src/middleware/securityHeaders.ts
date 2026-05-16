import type { Request, Response, NextFunction } from "express";

/**
 * Production security headers applied to every API response.
 *
 * Kept dependency-free (no helmet) so the API server stays slim. CSP is
 * intentionally strict: the API only returns JSON and a handful of
 * stream/redirect responses, so there is no need to allow inline scripts or
 * external script hosts. `frame-ancestors 'none'` plus the legacy
 * `X-Frame-Options: DENY` blocks clickjacking on any HTML accidentally served.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  const isProd = process.env.NODE_ENV === "production";

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  );
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");

  if (isProd) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }

  next();
}
