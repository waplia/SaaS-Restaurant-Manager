// Account self-management routes.
//
// Currently implements "delete my account" (Task #573) — a two-step,
// password-then-OTP flow initiated from the mobile Settings screen.
// The route is intentionally separate from /auth/* so it can require a
// logged-in user and reuse the same staff-OTP machinery that other
// phone/email OTPs use.
//
// Lifecycle (soft-delete):
//   POST /api/account/delete/request  → verify password, send OTP
//   POST /api/account/delete/verify   → verify OTP, mark account deleted
//
// Restore is super-admin only and lives in routes/admin-users.ts.
import { Router } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable, userSessionsTable } from "../lib/db";
import { authenticate, invalidateTokenVersionCache } from "../middleware/authenticate";
import { validate } from "../middleware/validate";
import { rateLimit } from "../middleware/rateLimit";
import { sendStaffOtp, verifyStaffOtp, normalizeEmail, normalizePhone } from "../lib/staffOtp";
import { logger } from "../lib/logger";

const router = Router();

// Every endpoint here requires a valid logged-in session.
router.use(authenticate);

// ── Request: { password, channel, phone? }
//   - password: the user's current password (validated against passwordHash)
//   - channel: "sms" | "email" — where to deliver the 6-digit code
//   - phone: required when channel="sms"; must be E.164. If omitted, we
//     fall back to the user's stored phone.
const RequestBody = z.object({
  password: z.string().min(1, "Enter your password."),
  channel: z.enum(["sms", "email"]),
  phone: z.string().trim().optional(),
});

router.post(
  "/account/delete/request",
  rateLimit({ windowMs: 60_000, max: 5 }),
  validate(RequestBody),
  async (req, res) => {
    const userId = (req as any).user?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { password, channel, phone } = req.body as z.infer<typeof RequestBody>;

    const [user] = await db.select({
      id: usersTable.id, email: usersTable.email, phone: usersTable.phone,
      passwordHash: usersTable.passwordHash, name: usersTable.name,
      tenantId: usersTable.tenantId, restaurantId: usersTable.restaurantId,
    }).from(usersTable).where(eq(usersTable.id, userId));
    if (!user) { res.status(404).json({ error: "Account not found" }); return; }

    // Constant-time password check. If the user signed up via Google or
    // mobile OTP they may not have a usable bcrypt hash — surface that
    // cleanly instead of leaking an internal error.
    const ok = user.passwordHash ? await bcrypt.compare(password, user.passwordHash).catch(() => false) : false;
    if (!ok) { res.status(400).json({ error: "Incorrect password." }); return; }

    let identifier: string;
    if (channel === "sms") {
      const raw = (phone ?? user.phone ?? "").trim();
      const norm = normalizePhone(raw);
      if (norm.length < 7) { res.status(400).json({ error: "Enter a valid mobile number." }); return; }
      identifier = norm;
      // Persist the chosen phone so /verify can bind the OTP to a
      // stored identifier on the user row (defence-in-depth check).
      if (!user.phone || normalizePhone(user.phone) !== norm) {
        await db.update(usersTable)
          .set({ phone: norm, updatedAt: new Date() })
          .where(eq(usersTable.id, user.id))
          .catch(err => logger.warn({ err, userId: user.id }, "account-delete: persist phone failed"));
      }
    } else {
      identifier = normalizeEmail(user.email);
    }

    const r = await sendStaffOtp({
      channel, identifier, purpose: "account_deletion",
      userId: user.id, tenantId: user.tenantId, restaurantId: user.restaurantId, name: user.name,
    });
    if (!r.ok) { res.status(400).json({ error: r.error ?? "Could not send code." }); return; }

    res.json({ ok: true, ttlMinutes: 5, channel, identifier });
  },
);

// ── Verify: { channel, identifier, code, reason? }
//   Confirms the code from the previous step, then:
//     1. sets isActive=false + deletedAt=now (+ optional reason)
//     2. bumps tokenVersion so existing JWTs stop working immediately
//     3. revokes every active refresh-token session for the user
const VerifyBody = z.object({
  channel: z.enum(["sms", "email"]),
  identifier: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
  reason: z.string().trim().max(500).optional(),
});

router.post(
  "/account/delete/verify",
  rateLimit({ windowMs: 60_000, max: 10 }),
  validate(VerifyBody),
  async (req, res) => {
    const userId = (req as any).user?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { channel, identifier, code, reason } = req.body as z.infer<typeof VerifyBody>;

    // Re-resolve the user so we can compare the OTP identifier against
    // the user's record (defence-in-depth: the OTP must have been issued
    // for this user's own phone or email).
    const [user] = await db.select({
      id: usersTable.id, email: usersTable.email, phone: usersTable.phone, tokenVersion: usersTable.tokenVersion,
    }).from(usersTable).where(eq(usersTable.id, userId));
    if (!user) { res.status(404).json({ error: "Account not found" }); return; }

    const expected = channel === "email"
      ? normalizeEmail(user.email)
      : normalizePhone(user.phone ?? "");
    const provided = channel === "email" ? normalizeEmail(identifier) : normalizePhone(identifier);
    // Bind the OTP to the authenticated user's own identifier. For SMS
    // this is the phone we stored at /request time (also written to the
    // user row in that handler if it was missing). Refusing mismatches
    // prevents another logged-in user from completing a delete with an
    // OTP issued for a different number.
    if (!expected || expected !== provided) {
      res.status(400).json({ error: "Code is for a different account." });
      return;
    }

    const v = await verifyStaffOtp({ identifier: provided, channel, purpose: "account_deletion", code });
    if (!v.ok) { res.status(400).json({ error: v.error ?? "Invalid code." }); return; }

    try {
      await db.update(usersTable).set({
        isActive: false,
        deletedAt: new Date(),
        deletionReason: reason ?? null,
        tokenVersion: (user.tokenVersion ?? 0) + 1,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, userId));
      invalidateTokenVersionCache(userId);
      // Best-effort: revoke every active session row for this user so the
      // currently-signed-in device (and any other devices) lose access.
      await db.update(userSessionsTable)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessionsTable.userId, userId)))
        .catch(err => logger.warn({ err, userId }, "session revoke during account-delete failed"));
    } catch (err) {
      logger.error({ err, userId }, "account-delete write failed");
      res.status(500).json({ error: "Could not delete account. Please try again." });
      return;
    }
    res.json({ ok: true });
  },
);

export default router;
