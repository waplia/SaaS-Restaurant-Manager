/**
 * Public, unauthenticated tracking endpoints for Email Center (Task #414).
 * Mount BEFORE the JWT `authenticate` gate.
 *
 *   GET  /e/o/:token.gif     1x1 open pixel
 *   GET  /e/c/:token         click-through redirect
 *   GET  /e/u/:token         unsubscribe landing (renders HTML)
 *   POST /e/u/:token         confirm unsubscribe
 */
import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, emailLogsTable, emailTrackingEventsTable, emailUnsubscribesTable, customersTable } from "../lib/db";
import { TRANSPARENT_GIF, verifyToken } from "../lib/emailTracking";
import { stopEnrollmentsByEmail } from "../lib/emailSequences";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/e/o/:token", async (req, res) => {
  const raw = String(req.params.token || "").replace(/\.gif$/i, "");
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  try {
    if (raw) {
      const [log] = await db.select({ id: emailLogsTable.id }).from(emailLogsTable).where(eq(emailLogsTable.trackingToken, raw));
      if (log) {
        await db.update(emailLogsTable).set({
          openCount: sql`${emailLogsTable.openCount} + 1`,
          openedAt: sql`COALESCE(${emailLogsTable.openedAt}, NOW())`,
        }).where(eq(emailLogsTable.id, log.id));
        await db.insert(emailTrackingEventsTable).values({
          logId: log.id, trackingToken: raw, eventType: "open",
          userAgent: req.headers["user-agent"]?.toString().slice(0, 500) ?? null,
          ip: (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.ip ?? "").slice(0, 64),
        }).catch(() => {});
      }
    }
  } catch (err) {
    logger.warn({ err }, "tracking open failed");
  }
  res.end(TRANSPARENT_GIF);
});

router.get("/e/c/:token", async (req, res) => {
  const token = String(req.params.token || "");
  const payload = verifyToken<{ t: string; u: string }>(token);
  if (!payload || !payload.u) {
    res.status(400).send("Invalid link");
    return;
  }
  const destination = String(payload.u);
  // Safety: only allow http/https redirects to avoid open-redirector abuse
  // for javascript:, data:, file:, etc. schemes.
  try {
    const parsed = new URL(destination);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      res.status(400).send("Invalid link"); return;
    }
  } catch {
    res.status(400).send("Invalid link"); return;
  }
  try {
    const [log] = await db.select({ id: emailLogsTable.id }).from(emailLogsTable).where(eq(emailLogsTable.trackingToken, payload.t));
    if (log) {
      await db.update(emailLogsTable).set({
        clickCount: sql`${emailLogsTable.clickCount} + 1`,
        clickedAt: sql`COALESCE(${emailLogsTable.clickedAt}, NOW())`,
      }).where(eq(emailLogsTable.id, log.id));
      await db.insert(emailTrackingEventsTable).values({
        logId: log.id, trackingToken: payload.t, eventType: "click", url: destination,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500) ?? null,
        ip: (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.ip ?? "").slice(0, 64),
      }).catch(() => {});
    }
  } catch (err) {
    logger.warn({ err }, "tracking click failed");
  }
  res.redirect(302, destination);
});

const UNSUB_PAGE = (email: string, token: string, status: "ask" | "done") => `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Email preferences</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;background:#fafafa;color:#111;padding:48px 16px;text-align:center}
.card{max-width:480px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:32px}
.btn{display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:8px;text-decoration:none;border:0;cursor:pointer;font-size:14px;font-weight:600}
.muted{color:#666;font-size:13px}</style></head><body><div class="card">
${status === "done"
  ? `<h2>You're unsubscribed</h2><p class="muted">We've removed <strong>${email}</strong> from our marketing list. You may still receive transactional emails (e.g. receipts) from us.</p>`
  : `<h2>Unsubscribe from marketing emails?</h2><p class="muted">You're about to unsubscribe <strong>${email}</strong>. We'll still send you transactional emails.</p>
<form method="POST" action="/e/u/${encodeURIComponent(token)}"><button class="btn" type="submit">Confirm unsubscribe</button></form>`}
</div></body></html>`;

router.get("/e/u/:token", (req, res) => {
  const token = String(req.params.token || "");
  const payload = verifyToken<{ e: string }>(token);
  if (!payload || !payload.e) { res.status(400).send("Invalid link"); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(UNSUB_PAGE(payload.e, token, "ask"));
});

// Public spec-required alias: /unsubscribe?token=... (GET renders the same
// confirm page; POST performs the unsubscribe).
router.get("/unsubscribe", (req, res) => {
  const token = String(req.query.token ?? "");
  const payload = verifyToken<{ e: string }>(token);
  if (!payload || !payload.e) { res.status(400).send("Invalid link"); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(UNSUB_PAGE(payload.e, token, "ask"));
});

async function performUnsubscribe(token: string, req: import("express").Request, res: import("express").Response): Promise<void> {
  const payload = verifyToken<{ e: string; r: number | null; s: "all" | "restaurant" }>(token);
  if (!payload || !payload.e) { res.status(400).send("Invalid link"); return; }
  const email = String(payload.e).trim().toLowerCase();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(emailUnsubscribesTable).values({
        email, restaurantId: payload.r ?? null, scope: payload.s ?? "restaurant", source: "user",
      }).onConflictDoNothing();
      // Mirror unsubscribe onto customer record(s) so the marketing-eligibility
      // check at send-time and any audience query see a consistent state.
      const conds = payload.r
        ? and(eq(customersTable.email, email), eq(customersTable.restaurantId, payload.r))
        : eq(customersTable.email, email);
      await tx.update(customersTable).set({
        emailMarketingOptIn: false,
        emailUnsubscribed: true,
        emailUnsubscribedAt: new Date(),
        updatedAt: new Date(),
      }).where(conds);
      await tx.insert(emailTrackingEventsTable).values({
        trackingToken: token, eventType: "unsubscribe",
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500) ?? null,
        ip: (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.ip ?? "").slice(0, 64),
      }).catch(() => {});
    });
    // Honor unsubscribe scope: restaurant-scoped tokens only stop that
    // restaurant's active enrollments; "all" stops globally for this email.
    await stopEnrollmentsByEmail(email, "unsubscribed", {
      restaurantId: (payload.s ?? "restaurant") === "restaurant" ? (payload.r ?? null) : null,
    });
  } catch (err) {
    logger.warn({ err, email }, "unsubscribe failed");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(UNSUB_PAGE(email, token, "done"));
}

router.post("/e/u/:token", (req, res) => {
  void performUnsubscribe(String(req.params.token || ""), req, res);
});
router.post("/unsubscribe", (req, res) => {
  const token = String(req.query.token ?? (req.body as { token?: string } | undefined)?.token ?? "");
  void performUnsubscribe(token, req, res);
});

export default router;
