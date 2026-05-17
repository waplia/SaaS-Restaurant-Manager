/**
 * Open/click/unsubscribe tracking primitives for the Email Center
 * (Task #414). Tokens are HMAC-signed so a recipient can't forge or
 * tamper with them, and the same `logId` is used to attribute events.
 */
import { createHmac, randomBytes } from "crypto";

const SECRET = () => {
  const s = process.env.EMAIL_TRACKING_SECRET ?? process.env.SESSION_SECRET ?? process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error("Email tracking is not configured: set EMAIL_TRACKING_SECRET (or SESSION_SECRET / JWT_SECRET) to a strong random value of at least 16 characters.");
  }
  return s;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function signToken(payload: Record<string, unknown>): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", SECRET()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken<T = Record<string, unknown>>(token: string): T | null {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = b64url(createHmac("sha256", SECRET()).update(body).digest());
    if (expected !== sig) return null;
    return JSON.parse(fromB64url(body).toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function randomTrackingToken(): string {
  return b64url(randomBytes(18));
}

/** Build a tracking origin (preferring the public marketing site or the
 *  API public domain).  Falls back to relative paths in dev. */
export function trackingOrigin(): string {
  return (
    process.env.PUBLIC_TRACKING_ORIGIN
    ?? process.env.PUBLIC_APP_ORIGIN
    ?? process.env.REPLIT_DEV_DOMAIN_URL
    ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "")
  );
}

export function pixelUrl(trackingToken: string): string {
  return `${trackingOrigin()}/e/o/${encodeURIComponent(trackingToken)}.gif`;
}
export function clickUrl(trackingToken: string, dest: string): string {
  const token = signToken({ t: trackingToken, u: dest, ts: Date.now() });
  return `${trackingOrigin()}/e/c/${token}`;
}
export function unsubscribeUrl(email: string, restaurantId?: number | null, scope: "all" | "restaurant" = "restaurant"): string {
  const token = signToken({ e: email, r: restaurantId ?? null, s: scope, ts: Date.now() });
  return `${trackingOrigin()}/e/u/${token}`;
}

/** Replace every <a href="…"> with a tracked redirect URL and append a
 *  1×1 tracking pixel just before </body>. Returns html unchanged when
 *  trackingToken is empty. */
export function injectTracking(
  html: string,
  trackingToken: string,
  options: { unsubscribeUrl?: string; businessAddress?: string | null; consentReason?: string | null } = {},
): string {
  if (!trackingToken) return html;
  let out = String(html);

  out = out.replace(/<a\b([^>]*?)\bhref=(["'])([^"']+)\2([^>]*)>/gi, (m, pre, q, href, post) => {
    const lower = String(href).toLowerCase();
    if (lower.startsWith("mailto:") || lower.startsWith("tel:") || lower.startsWith("#") || lower.startsWith("data:")) {
      return m;
    }
    if (lower.includes("/e/u/") || lower.includes("/unsubscribe") || lower.includes("/e/c/") || lower.includes("/e/o/")) {
      return m;
    }
    return `<a${pre} href=${q}${clickUrl(trackingToken, href)}${q}${post}>`;
  });

  const pixelTag = `<img src="${pixelUrl(trackingToken)}" width="1" height="1" alt="" style="display:none;border:0;width:1px;height:1px" />`;
  let unsubTag = "";
  if (options.unsubscribeUrl) {
    const parts: string[] = [];
    if (options.consentReason) {
      parts.push(`<div style="margin-bottom:6px">${escapeHtml(options.consentReason)}</div>`);
    }
    parts.push(
      `<div>If you no longer wish to receive these emails, <a href="${options.unsubscribeUrl}" style="color:#888;text-decoration:underline">unsubscribe here</a>.</div>`,
    );
    if (options.businessAddress) {
      parts.push(`<div style="margin-top:6px">${escapeHtml(options.businessAddress)}</div>`);
    }
    unsubTag = `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;font-size:11px;color:#888;text-align:center">${parts.join("")}</div>`;
  }

  if (/<\/body>/i.test(out)) {
    return out.replace(/<\/body>/i, `${unsubTag}${pixelTag}</body>`);
  }
  return `${out}${unsubTag}${pixelTag}`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 43-byte transparent GIF. */
export const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
