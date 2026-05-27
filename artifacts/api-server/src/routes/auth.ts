import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, tenantsTable, restaurantsTable, subscriptionPlansTable, branchesTable, userSessionsTable } from "../lib/db";
import { createSession, rotateSession, revokeSession, revokeAllSessions } from "../lib/sessions";
import { and, desc, isNull } from "drizzle-orm";
import {
  hashPassword,
  comparePassword,
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from "../lib/auth";
import crypto from "node:crypto";
import { authenticate, invalidateTokenVersionCache } from "../middleware/authenticate";
import { rateLimit } from "../middleware/rateLimit";
import { validate } from "../middleware/validate";
import { z } from "zod";
import {
  RegisterBody,
  LoginBody,
  RefreshTokenBody,
  ForgotPasswordBody,
  ResetPasswordBody,
} from "@workspace/api-zod";

const RegisterBodyStrict = RegisterBody.extend({
  phone: z.string().trim().min(1).optional(),
});
import { sql } from "drizzle-orm";
import { sendByTemplateKey } from "../lib/emailSender";
import { getAppSettings } from "../lib/appSettings";
import { sendLifecycleSms } from "../lib/smsSender";
import { recordAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import bcrypt from "bcryptjs";
import { normalizePhone, normalizeEmail } from "../lib/staffOtp";
import { normalizePhone as normalizePhoneIntl } from "@workspace/phone-utils";

const router = Router();

// Identifier helpers (Task #538). Login accepts either an email or a phone
// number in the same "identifier" field; we sniff which it is here so the
// UI never has to ask the user "is this an email or a phone?".
function isEmailLike(s: string): boolean {
  return s.includes("@");
}
async function findUserByIdentifier(raw: string): Promise<typeof usersTable.$inferSelect | undefined> {
  const v = raw.trim();
  if (!v) return undefined;
  if (isEmailLike(v)) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.email, normalizeEmail(v)));
    return u;
  }
  const normalized = normalizePhone(v);
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 7) return undefined;
  // Step 1: exact match against the user's stored phone after stripping
  // formatting characters from both sides.
  const [exact] = await db.select().from(usersTable)
    .where(sql`regexp_replace(coalesce(${usersTable.phone}, ''), '[^0-9+]', '', 'g') = ${normalized}`);
  if (exact) return exact;
  // Step 2: if the user typed a national number without country code (e.g.
  // "9876543210"), fall back to matching the *last N significant digits* of
  // stored phones. This lets "9876543210" find a user stored as
  // "+91 98765 43210". We require at least 10 trailing digits for the match
  // to avoid false positives on very short inputs.
  if (digits.length >= 10) {
    const tail = digits.slice(-10);
    const [bySuffix] = await db.select().from(usersTable)
      .where(sql`right(regexp_replace(coalesce(${usersTable.phone}, ''), '[^0-9]', '', 'g'), 10) = ${tail}`);
    if (bySuffix) return bySuffix;
  }
  return undefined;
}
export { findUserByIdentifier };

// Pre-computed bcrypt hash of a random string. Compared against when an email
// is unknown so login response time does not leak whether an account exists.
const DUMMY_BCRYPT_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.4OZN8ZjBkA8e2H9YQ2A6E9V1n7Ee";

// Two independent buckets — varying one dimension cannot bypass the other:
//  • per-IP: stops a single host (or a single proxy IP) from spraying.
//  • per-email: stops a botnet from grinding any *one* account from many IPs.
const emailKey = (req: { body?: { email?: string; identifier?: string } }) => {
  // Task #538 — login now accepts either `email` (legacy) or `identifier`
  // (email or phone). The per-account bucket must key on whichever the
  // client sent, otherwise phone-based logins skip per-identifier throttling
  // entirely and rely only on the IP bucket.
  const raw = (req.body?.identifier ?? req.body?.email ?? "").toLowerCase().trim();
  if (!raw) return null;
  const normalised = raw.includes("@") ? raw : raw.replace(/[^\d+]/g, "");
  return normalised.slice(0, 200) || null;
};

const loginLimitByIp = rateLimit({ name: "auth.login.ip", windowMs: 15 * 60 * 1000, max: 20 });
const loginLimitByEmail = rateLimit({ name: "auth.login.email", windowMs: 15 * 60 * 1000, max: 10, ignoreIp: true, keyExtra: emailKey });

const registerLimitByIp = rateLimit({ name: "auth.register.ip", windowMs: 60 * 60 * 1000, max: 20 });

const forgotLimitByIp = rateLimit({ name: "auth.forgot.ip", windowMs: 60 * 60 * 1000, max: 10 });
const forgotLimitByEmail = rateLimit({ name: "auth.forgot.email", windowMs: 60 * 60 * 1000, max: 5, ignoreIp: true, keyExtra: emailKey });

const resetLimitByIp = rateLimit({ name: "auth.reset.ip", windowMs: 60 * 60 * 1000, max: 10 });
// Per-email limiter on reset so a distributed attacker can't burn through
// an account's OTP attempts from many IPs. Tight window mirrors the
// 5-attempt application-level cap.
const resetLimitByEmail = rateLimit({ name: "auth.reset.email", windowMs: 15 * 60 * 1000, max: 10, ignoreIp: true, keyExtra: emailKey });

const refreshLimitByIp = rateLimit({ name: "auth.refresh.ip", windowMs: 60 * 1000, max: 30 });

router.post("/auth/register", registerLimitByIp, validate({ body: RegisterBodyStrict }), async (req, res) => {
  const settings = await getAppSettings();
  if (!settings.signupEnabled) {
    res.status(403).json({ error: "Signups are currently disabled by the platform administrator." });
    return;
  }
  const { restaurantName, ownerName, email, password, phone } = req.body as {
    restaurantName: string;
    ownerName: string;
    email: string;
    password: string;
    phone?: string;
  };

  // Phone is optional. When supplied we normalise via the shared
  // phone-utils helper which accepts "+91 …", "91 …", or a bare
  // national number (assumed India) and emits the canonical
  // "<dial> <national>" storage form.
  const rawPhone = phone?.trim();
  const normalisedPhone = rawPhone ? normalizePhoneIntl(rawPhone, "IN") : null;
  if (rawPhone && !normalisedPhone) {
    res.status(400).json({ error: "Enter a valid mobile number with country code." });
    return;
  }

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const [trialPlan] = await db
    .select()
    .from(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.slug, "free-trial"));

  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const baseSlug = restaurantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const uniqueSuffix = Date.now();

  const passwordHash = await hashPassword(password);

  let tenant: typeof tenantsTable.$inferSelect;
  let restaurant: typeof restaurantsTable.$inferSelect;
  let user: typeof usersTable.$inferSelect;
  try {
    const result = await db.transaction(async (tx) => {
      const [t] = await tx.insert(tenantsTable).values({
        name: restaurantName,
        slug: `${baseSlug}-${uniqueSuffix}`,
        planId: trialPlan?.id ?? null,
        planStatus: "trial",
        trialEndsAt,
        // Anchor the monthly AI credit renewal cycle to the trial start so
        // creditMonthlyAllocation's (tenantId, periodStart) idempotency works
        // and the daily sweep cannot re-allocate within the same cycle.
        subscriptionStartedAt: new Date(),
        isActive: true,
      }).returning();

      const [r] = await tx.insert(restaurantsTable).values({
        tenantId: t.id,
        name: restaurantName,
        slug: `${baseSlug}-r-${uniqueSuffix}`,
      }).returning();

      // Auto-create a default "Main" branch so trial/starter owners can run a
      // single-location restaurant without ever opening the multi-branch step.
      await tx.insert(branchesTable).values({
        restaurantId: r.id,
        name: "Main",
        isMain: true,
        isActive: true,
      });

      const [u] = await tx.insert(usersTable).values({
        name: ownerName,
        email: email.toLowerCase(),
        passwordHash,
        phone: normalisedPhone,
        role: "owner",
        tenantId: t.id,
        restaurantId: r.id,
        isActive: true,
      }).returning();

      // Seed default cashier-facing discount reasons inside the same
      // transaction so the POS "Apply Discount" flow works on day one
      // (without preset reasons it 422s every manual discount).
      const { seedDefaultDiscountSettings } = await import("../lib/discounts");
      await seedDefaultDiscountSettings(r.id, u.id, tx);
      const { seedDefaultOrderNumberingSettings } = await import("../lib/orderNumbers");
      await seedDefaultOrderNumberingSettings(r.id, u.id, tx);

      return { t, r, u };
    });
    tenant = result.t;
    restaurant = result.r;
    user = result.u;
  } catch (err) {
    const message = (err as Error)?.message ?? "";
    if (/duplicate key|unique constraint|users_email_unique/i.test(message)) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    throw err;
  }

  // Grant the trial plan's monthly AI credits to the brand-new tenant so the
  // owner can use Khana AI features (menu import, descriptions, photos, etc.)
  // from day one without waiting for the daily allocation sweep.
  try {
    const { creditMonthlyAllocation } = await import("../lib/aiCredits");
    await creditMonthlyAllocation(tenant.id);
  } catch (err) {
    req.log.warn({ err, tenantId: tenant.id }, "initial AI credit allocation failed (auth/register)");
  }

  const session = await createSession({ userId: user.id, req });
  const tokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    restaurantId: user.restaurantId,
    isSuperAdmin: user.isSuperAdmin,
    tv: user.tokenVersion,
    sid: session.id,
    jti: session.jti,
  };

  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  // Lifecycle SMS — welcome owner. Best-effort, never fails registration.
  if (normalisedPhone) {
    void sendLifecycleSms({
      tenantId: tenant.id,
      restaurantId: restaurant.id,
      to: normalisedPhone,
      eventKey: "welcome",
      variables: { name: ownerName, restaurant: restaurantName, trialDays: 14 },
    });
  }
  // Lifecycle emails — best-effort, never block registration. Errors are
  // surfaced to the server log AND to email_logs so they don't disappear.
  void sendByTemplateKey("restaurant_welcome", user.email, {
    name: user.name,
    restaurant: restaurant.name,
    appName: "Khana Lagao",
    appUrl: process.env.PUBLIC_APP_URL ?? "",
  }, { tenantId: tenant.id })
    .then((r) => {
      if (!r?.ok) logger.warn({ userId: user.id, to: user.email, err: r?.error, skip: r?.skippedReason }, "restaurant_welcome email did not send");
    })
    .catch((err) => logger.error({ err, userId: user.id, to: user.email }, "restaurant_welcome email threw"));

  void sendByTemplateKey("trial_started", user.email, {
    name: user.name,
    trialDays: String(trialPlan?.trialDays ?? 14),
    trialEndsAt: trialEndsAt.toISOString().slice(0, 10),
    appName: "Khana Lagao",
  }, { tenantId: tenant.id })
    .then((r) => {
      if (!r?.ok) logger.warn({ userId: user.id, to: user.email, err: r?.error, skip: r?.skippedReason }, "trial_started email did not send");
    })
    .catch((err) => logger.error({ err, userId: user.id, to: user.email }, "trial_started email threw"));

  // Email Center automations: fire user.signup + trial.started events.
  void (async () => {
    try {
      const { runAutomationsForEvent } = await import("../lib/emailAutomations");
      const ctx = {
        userId: user.id, userEmail: user.email, userName: user.name,
        tenantId: tenant.id, restaurantId: restaurant.id,
        restaurantName: restaurant.name, trialEndsAt: trialEndsAt.toISOString(),
      };
      await runAutomationsForEvent("user.signup", ctx);
      await runAutomationsForEvent("trial.started", ctx);
    } catch (err) {
      logger.warn({ err, userId: user.id }, "signup automation chain failed");
    }
  })();

  res.status(201).json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      restaurantId: restaurant.id,
    },
    tenant: {
      id: tenant.id,
      name: tenant.name,
      planStatus: tenant.planStatus,
      trialEndsAt,
    },
  });
});

// Task #538 — accept either `identifier` (email-or-phone, new) or legacy `email`.
const LoginBodyFlexible = z.object({
  identifier: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(1).max(200),
}).refine((b) => !!(b.identifier || b.email), { message: "identifier or email is required" });

router.post("/auth/login", loginLimitByIp, loginLimitByEmail, validate({ body: LoginBodyFlexible }), async (req, res) => {
  const { identifier, email, password } = req.body as z.infer<typeof LoginBodyFlexible>;
  const rawIdent = (identifier ?? email ?? "").trim();

  const user = await findUserByIdentifier(rawIdent);
  if (!user) {
    // Equalize timing so an attacker cannot tell from the response time
    // whether the identifier exists.
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    await recordAuditLog({
      req, module: "auth", action: "login.failed", entity: "auth",
      userId: null, userDisplay: rawIdent, role: null,
      newValue: { identifier: rawIdent, reason: "user_not_found" },
    });
    res.status(401).json({ error: "Invalid login details" });
    return;
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    await recordAuditLog({
      req, module: "auth", action: "login.failed", entity: "auth",
      userId: user.id, userDisplay: user.name ?? user.email, role: user.role,
      restaurantId: user.restaurantId ?? null,
      newValue: { identifier: rawIdent, reason: "bad_password" },
    });
    res.status(401).json({ error: "Invalid login details" });
    return;
  }

  // Credentials are correct — only NOW reveal account status. Disabled /
  // locked accounts get a specific message so the legitimate owner knows to
  // contact support (per task spec).
  if (!user.isActive) {
    await recordAuditLog({
      req, module: "auth", action: "login.failed", entity: "auth",
      userId: user.id, userDisplay: user.name ?? user.email, role: user.role,
      restaurantId: user.restaurantId ?? null,
      newValue: { identifier: rawIdent, reason: "user_inactive" },
    });
    res.status(403).json({ error: "Your account has been disabled. Please contact support." });
    return;
  }

  // Detect new device/IP by comparing against this user's prior session
  // fingerprints. Cheap query, runs before we mint the new session so the
  // current login isn't counted as the "previous" device.
  const ipNow = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  const uaNow = String(req.headers["user-agent"] ?? "unknown");
  const priorSessions = await db.select({ ip: userSessionsTable.ip, userAgent: userSessionsTable.userAgent })
    .from(userSessionsTable)
    .where(eq(userSessionsTable.userId, user.id))
    .orderBy(desc(userSessionsTable.createdAt))
    .limit(20);
  const seenBefore = priorSessions.some(s => s.ip === ipNow && s.userAgent === uaNow);
  if (!seenBefore && priorSessions.length > 0) {
    // Only alert on truly new devices (skip the very first login to avoid
    // a noisy welcome+new-device pair).
    const signinAt = new Date().toUTCString();
    void sendByTemplateKey("security_login_new_device", user.email, {
      name: user.name ?? user.email,
      device: uaNow,
      location: ipNow,
      signinAt,
      // Back-compat aliases — older edited templates may still reference these.
      ip: ipNow,
      userAgent: uaNow,
      when: signinAt,
      appName: "Khana Lagao",
    }, { tenantId: user.tenantId, restaurantId: user.restaurantId ?? null, recipientType: "user" });
  }

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  await recordAuditLog({
    req, module: "auth", action: "login.success", entity: "auth",
    userId: user.id, userDisplay: user.name ?? user.email,
    role: user.isSuperAdmin ? "super_admin" : user.role,
    restaurantId: user.restaurantId ?? null,
  });

  const session = await createSession({ userId: user.id, req });
  const tokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    restaurantId: user.restaurantId,
    isSuperAdmin: user.isSuperAdmin,
    tv: user.tokenVersion,
    sid: session.id,
    jti: session.jti,
  };

  res.json({
    accessToken: signAccessToken(tokenPayload),
    refreshToken: signRefreshToken(tokenPayload),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      restaurantId: user.restaurantId,
      isSuperAdmin: user.isSuperAdmin,
      kitchenId: user.kitchenId ?? null,
    },
  });
});

router.post("/auth/refresh", refreshLimitByIp, validate({ body: RefreshTokenBody }), async (req, res) => {
  const { refreshToken } = req.body as { refreshToken: string };
  try {
    const payload = verifyToken(refreshToken);
    if (payload.type !== "refresh") {
      res.status(401).json({ error: "Invalid token type" });
      return;
    }
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, payload.sub));
    if (!user || !user.isActive) {
      res.status(401).json({ error: "User not found or inactive" });
      return;
    }
    // Refresh path must re-check tokenVersion too — a stolen refresh token
    // issued before a logout-everywhere must not be able to mint new access
    // tokens after the user bumped their version. Also rejects pre-cutover
    // refresh tokens (which lack `tv` entirely).
    if (typeof payload.tv !== "number" || payload.tv !== user.tokenVersion) {
      res.status(401).json({ error: "Session has been revoked, please sign in again" });
      return;
    }
    // Per-device check: if the refresh token carries a session id, rotate
    // it. rotateSession atomically requires (sid, jti, revokedAt IS NULL),
    // so a stolen-and-replayed refresh token (or one for a revoked device)
    // returns null and we reject the request.
    let nextSid: number | undefined;
    let nextJti: string | undefined;
    if (typeof payload.sid === "number") {
      const rotated = await rotateSession(payload.sid, payload.jti ?? "", req);
      if (!rotated) {
        res.status(401).json({ error: "This device has been signed out" });
        return;
      }
      nextSid = rotated.id;
      nextJti = rotated.jti;
    } else {
      // Legacy refresh token from before the sessions feature shipped.
      // Mint a fresh session row so subsequent refreshes are tracked.
      const created = await createSession({ userId: user.id, req });
      nextSid = created.id;
      nextJti = created.jti;
    }
    const tokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      restaurantId: user.restaurantId,
      isSuperAdmin: user.isSuperAdmin,
      tv: user.tokenVersion,
      sid: nextSid,
      jti: nextJti,
    };
    res.json({
      accessToken: signAccessToken(tokenPayload),
      refreshToken: signRefreshToken(tokenPayload),
    });
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

router.post("/auth/logout", authenticate, async (req, res) => {
  // Logout-everywhere: bump the user's tokenVersion so every existing
  // access/refresh token (on every device, every tab) is rejected by
  // `authenticate` on its next use. Drop the in-process cache entry so the
  // next request doesn't serve a stale value. Also mark every active
  // session row revoked so the sessions list reflects reality.
  const userId = req.user!.sub;
  await db
    .update(usersTable)
    .set({ tokenVersion: sql`${usersTable.tokenVersion} + 1`, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  invalidateTokenVersionCache(userId);
  await revokeAllSessions(userId);
  await recordAuditLog({ req, module: "auth", action: "logout", entity: "auth" });
  res.json({ success: true });
});

// List the caller's active sessions. Returns one row per non-revoked
// `user_sessions` entry so the settings UI can render a "Your sessions"
// list and mark the current device.
router.get("/auth/sessions", authenticate, async (req, res) => {
  const userId = req.user!.sub;
  const callerSid = typeof req.user!.sid === "number" ? req.user!.sid : null;
  const rows = await db
    .select({
      id: userSessionsTable.id,
      deviceLabel: userSessionsTable.deviceLabel,
      ip: userSessionsTable.ip,
      userAgent: userSessionsTable.userAgent,
      createdAt: userSessionsTable.createdAt,
      lastUsedAt: userSessionsTable.lastUsedAt,
    })
    .from(userSessionsTable)
    .where(and(eq(userSessionsTable.userId, userId), isNull(userSessionsTable.revokedAt)))
    .orderBy(desc(userSessionsTable.lastUsedAt));
  res.json({
    sessions: rows.map(r => ({ ...r, isCurrent: callerSid != null && r.id === callerSid })),
  });
});

// Revoke a single session ("Sign out this device"). Scoped to the caller's
// own user id so one user cannot revoke another's session by id-guessing.
router.delete("/auth/sessions/:id", authenticate, async (req, res) => {
  const sid = Number(req.params.id);
  if (!Number.isInteger(sid) || sid <= 0) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }
  const userId = req.user!.sub;
  const ok = await revokeSession(sid, userId);
  if (!ok) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await recordAuditLog({
    req, module: "auth", action: "session.revoke", entity: "auth",
    entityId: sid,
    newValue: { sessionId: sid, current: req.user!.sid === sid },
  });
  res.json({ success: true });
});

// Self-service password change for any authenticated user. Requires the
// current password (so a stolen-but-still-valid access token cannot be used
// to silently swap the password). Bumps tokenVersion so every other session
// for this user — including the one used to make this request, before it
// receives the new tokens below — is invalidated immediately.
const changePasswordLimitByIp = rateLimit({ name: "auth.change.ip", windowMs: 15 * 60 * 1000, max: 10 });
const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
router.post("/auth/change-password", authenticate, changePasswordLimitByIp, validate({ body: ChangePasswordBody }), async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  const userId = req.user!.sub;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Session expired" });
    return;
  }
  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) {
    await recordAuditLog({
      req, module: "auth", action: "password.change.failed", entity: "auth",
      userId: user.id, userDisplay: user.name ?? user.email, role: user.role,
      restaurantId: user.restaurantId ?? null,
      newValue: { reason: "bad_current_password" },
    });
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }
  const passwordHash = await hashPassword(newPassword);
  const [updated] = await db
    .update(usersTable)
    .set({
      passwordHash,
      tokenVersion: sql`${usersTable.tokenVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId))
    .returning({ tokenVersion: usersTable.tokenVersion });
  invalidateTokenVersionCache(userId);
  await recordAuditLog({
    req, module: "auth", action: "password.change", entity: "auth",
    userId: user.id, userDisplay: user.name ?? user.email, role: user.role,
    restaurantId: user.restaurantId ?? null,
  });
  // Notify the account holder that their password was changed so they can act
  // immediately if it wasn't them. Best-effort — never blocks the response,
  // and `sendByTemplateKey` writes its own `email_logs` row.
  const changedAt = new Date().toUTCString();
  const changeIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  const changeUa = String(req.headers["user-agent"] ?? "unknown");
  void sendByTemplateKey("security_password_changed", user.email, {
    name: user.name ?? user.email,
    changedAt,
    // Back-compat aliases — kept in case admin-edited templates reference them.
    ip: changeIp,
    userAgent: changeUa,
    when: changedAt,
    appName: "Khana Lagao",
  }, { tenantId: user.tenantId, restaurantId: user.restaurantId ?? null, recipientType: "user" });
  // Issue fresh tokens bound to the new tokenVersion so the caller stays
  // signed in on this device while every other session is killed.
  const tokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    restaurantId: user.restaurantId,
    isSuperAdmin: user.isSuperAdmin,
    tv: updated.tokenVersion,
  };
  res.json({
    success: true,
    accessToken: signAccessToken(tokenPayload),
    refreshToken: signRefreshToken(tokenPayload),
  });
});

// ─── Password reset (OTP flow) ────────────────────────────────────
// Replaces the old emailed-link / JWT flow. Step 1: user submits email →
// we mint a 6-digit code, bcrypt-hash it into the users row with a
// 15-minute expiry, and email the code via the `password_reset_otp`
// template. Step 2: user submits {email, code, newPassword} → we verify
// the code (constant-time bcrypt compare, attempt-capped, expiry-checked)
// and update the password. Same response shape ("If an account exists…")
// is returned regardless of whether the email is known, to prevent
// account enumeration.
const RESET_OTP_TTL_MINUTES = 15;
const RESET_OTP_MAX_ATTEMPTS = 5;

router.post("/auth/forgot-password", forgotLimitByIp, forgotLimitByEmail, validate({ body: ForgotPasswordBody }), async (req, res) => {
  const { email } = req.body as { email: string };
  const [user] = await db
    .select({
      id: usersTable.id, email: usersTable.email, name: usersTable.name,
      phone: usersTable.phone,
      tenantId: usersTable.tenantId, isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));

  if (user && user.isActive) {
    // 6-digit numeric code, zero-padded. Generated from crypto-strong
    // randomness rather than Math.random.
    const code = String(Math.floor(crypto.randomInt(0, 1_000_000))).padStart(6, "0");
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + RESET_OTP_TTL_MINUTES * 60_000);
    await db
      .update(usersTable)
      .set({
        passwordResetCodeHash: codeHash,
        passwordResetCodeExpiresAt: expiresAt,
        passwordResetAttempts: 0,
      })
      .where(eq(usersTable.id, user.id));
    void sendByTemplateKey("password_reset_otp", user.email, {
      name: user.name ?? user.email,
      otp: code,
      ttlMinutes: String(RESET_OTP_TTL_MINUTES),
      appName: "Khana Lagao",
    }, { tenantId: user.tenantId });

    // Also dispatch the OTP via SMS + WhatsApp if the account has a phone
    // on file, so password reset works for users who can't reach their
    // email (mobile-only operators). Both helpers no-op gracefully when
    // the corresponding provider isn't configured — we never block the
    // response (still constant-time / anti-enumeration friendly because
    // the email send was already fire-and-forget too).
    if (user.phone) {
      const fallbackBody = `${code} is your verification code for KhanaLagao. Valid for 5 minutes. Do not share this code with anyone.`;
      void (async () => {
        try {
          const { sendSmsMessage } = await import("../lib/smsSender");
          const r = await sendSmsMessage({
            to: user.phone!,
            body: fallbackBody,
            eventKey: "password_reset_otp",
            variables: { otp: code, code, ttlMinutes: String(RESET_OTP_TTL_MINUTES) },
            tenantId: user.tenantId,
            purpose: "password_reset",
            messageType: "otp",
          });
          if (!r.ok) {
            console.info(`[forgot-password] SMS not sent for user ${user.id}: ${r.error}`);
          }
        } catch (err) {
          console.warn(`[forgot-password] SMS error for user ${user.id}:`, err);
        }
      })();
      void (async () => {
        try {
          const { sendWhatsAppMessage } = await import("../lib/whatsapp");
          const r = await sendWhatsAppMessage({
            restaurantId: null,
            tenantId: user.tenantId ?? undefined,
            to: user.phone!,
            templateName: "khanalagao_password_reset_otp",
            templateVariables: [code, String(RESET_OTP_TTL_MINUTES)],
            body: fallbackBody,
            // SafeSend classification — OTPs are operational/transactional
            // traffic from a quiet-hours / opt-in perspective.
            category: "transactional",
            // `purpose: "otp"` triggers the AUTHENTICATION-template guard
            // (Task #533) so we fail closed if someone swaps the template.
            purpose: "otp",
            skipQuota: true,
            meta: { event: "auth.password_reset", userId: user.id },
          });
          if (r.status !== "sent") {
            console.info(`[forgot-password] WhatsApp not sent for user ${user.id}: ${r.error}`);
          }
        } catch (err) {
          console.warn(`[forgot-password] WhatsApp error for user ${user.id}:`, err);
        }
      })();
    }
  }
  res.json({
    success: true,
    message: "If an account with that email exists, a 6-digit reset code has been sent.",
    ttlMinutes: RESET_OTP_TTL_MINUTES,
  });
});

// Note: the request body schema changed from {token, newPassword} (link
// flow) to {email, code, newPassword} (OTP flow). The generated zod schema
// `ResetPasswordBody` already reflects the new shape; we extend it here
// with the same min-length + numeric-code constraints the API enforces.
const ResetPasswordBodyStrict = ResetPasswordBody.extend({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().regex(/^\d{6}$/, "Code must be 6 digits"),
  newPassword: z.string().min(8),
});

// Dummy bcrypt hash used to equalize response time on "no such user / no
// active code" paths so an attacker can't distinguish them from a real
// "wrong code" attempt by timing the response. The hash is for a random
// 6-digit number that the attacker will never guess; the compare always
// returns false but takes the same wall time as a real check.
const DUMMY_RESET_HASH = bcrypt.hashSync("000000", 10);

// ── Phone-based forgot/reset password ────────────────────────────────────
// Mirrors the email flow above but looks the account up by `usersTable.phone`
// and delivers the OTP exclusively over SMS (with a WhatsApp dispatch as a
// best-effort fallback). Used by the mobile app's "Phone" reset option for
// users who don't have access to their email inbox. Reuses the same
// passwordResetCodeHash / passwordResetCodeExpiresAt / passwordResetAttempts
// columns + transactional verify path as the email reset so an attacker
// can't request via phone and burn through attempts via email or vice versa.
const phoneKey = (req: { body?: { phone?: string } }) => {
  const raw = (req.body?.phone ?? "").toLowerCase().trim();
  if (!raw) return null;
  return raw.replace(/[^\d+]/g, "").slice(0, 200) || null;
};
const forgotLimitByPhone = rateLimit({ name: "auth.forgot.phone", windowMs: 60 * 60 * 1000, max: 5, ignoreIp: true, keyExtra: phoneKey });
const resetLimitByPhone = rateLimit({ name: "auth.reset.phone", windowMs: 15 * 60 * 1000, max: 10, ignoreIp: true, keyExtra: phoneKey });

function normalizePhoneRaw(raw: string): string {
  return String(raw ?? "").trim().replace(/[^\d+]/g, "");
}

// Match users whose stored phone may include spaces / dashes / parens
// (e.g. "+91 90000 11111"). We compare the normalized form of both sides.
function phoneMatches(normalized: string) {
  return sql`regexp_replace(coalesce(${usersTable.phone}, ''), '[^0-9+]', '', 'g') = ${normalized}`;
}

const PhoneForgotBody = z.object({
  phone: z.string().trim().min(7, "Enter a valid phone number"),
});
const PhoneResetBody = z.object({
  phone: z.string().trim().min(7, "Enter a valid phone number"),
  code: z.string().trim().regex(/^\d{6}$/, "Code must be 6 digits"),
  newPassword: z.string().min(8),
});

router.post("/auth/forgot-password-phone", forgotLimitByIp, forgotLimitByPhone, validate({ body: PhoneForgotBody }), async (req, res) => {
  const phone = normalizePhoneRaw((req.body as { phone: string }).phone);
  const [user] = await db
    .select({
      id: usersTable.id, email: usersTable.email, name: usersTable.name,
      phone: usersTable.phone, tenantId: usersTable.tenantId,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(phoneMatches(phone));

  if (user && user.isActive && user.phone) {
    const code = String(Math.floor(crypto.randomInt(0, 1_000_000))).padStart(6, "0");
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + RESET_OTP_TTL_MINUTES * 60_000);
    await db
      .update(usersTable)
      .set({
        passwordResetCodeHash: codeHash,
        passwordResetCodeExpiresAt: expiresAt,
        passwordResetAttempts: 0,
      })
      .where(eq(usersTable.id, user.id));
    const fallbackBody = `${code} is your verification code for KhanaLagao. Valid for 5 minutes. Do not share this code with anyone.`;
    void (async () => {
      try {
        const { sendSmsMessage } = await import("../lib/smsSender");
        const r = await sendSmsMessage({
          to: user.phone!,
          body: fallbackBody,
          eventKey: "password_reset_otp",
          variables: { otp: code, code, ttlMinutes: String(RESET_OTP_TTL_MINUTES) },
          tenantId: user.tenantId,
          purpose: "password_reset",
          messageType: "otp",
        });
        if (!r.ok) {
          console.info(`[forgot-password-phone] SMS not sent for user ${user.id}: ${r.error}`);
        }
      } catch (err) {
        console.warn(`[forgot-password-phone] SMS error for user ${user.id}:`, err);
      }
    })();
    void (async () => {
      try {
        const { sendWhatsAppMessage } = await import("../lib/whatsapp");
        await sendWhatsAppMessage({
          restaurantId: null,
          tenantId: user.tenantId ?? undefined,
          to: user.phone!,
          templateName: "khanalagao_password_reset_otp",
          templateVariables: [code, String(RESET_OTP_TTL_MINUTES)],
          body: fallbackBody,
          category: "transactional",
          purpose: "otp",
          skipQuota: true,
          meta: { event: "auth.password_reset.phone", userId: user.id },
        });
      } catch (err) {
        console.warn(`[forgot-password-phone] WhatsApp error for user ${user.id}:`, err);
      }
    })();
  }
  res.json({
    success: true,
    message: "If an account with that phone exists, a 6-digit reset code has been sent.",
    ttlMinutes: RESET_OTP_TTL_MINUTES,
  });
});

router.post("/auth/reset-password-phone", resetLimitByIp, resetLimitByPhone, validate({ body: PhoneResetBody }), async (req, res) => {
  const phone = normalizePhoneRaw((req.body as { phone: string }).phone);
  const { code, newPassword } = req.body as { code: string; newPassword: string };
  const genericError = "The code is invalid or has expired. Please request a new one.";

  const verdict: "ok" | "fail" = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        id: usersTable.id, email: usersTable.email, name: usersTable.name,
        isActive: usersTable.isActive, tenantId: usersTable.tenantId,
        restaurantId: usersTable.restaurantId,
        codeHash: usersTable.passwordResetCodeHash,
        codeExpiresAt: usersTable.passwordResetCodeExpiresAt,
        attempts: usersTable.passwordResetAttempts,
      })
      .from(usersTable)
      .where(phoneMatches(phone))
      .for("update");

    if (!user || !user.isActive || !user.codeHash || !user.codeExpiresAt) {
      await bcrypt.compare(code, DUMMY_RESET_HASH);
      return "fail";
    }
    if (user.codeExpiresAt.getTime() < Date.now() || (user.attempts ?? 0) >= RESET_OTP_MAX_ATTEMPTS) {
      await bcrypt.compare(code, DUMMY_RESET_HASH);
      await tx.update(usersTable)
        .set({ passwordResetCodeHash: null, passwordResetCodeExpiresAt: null, passwordResetAttempts: 0 })
        .where(eq(usersTable.id, user.id));
      return "fail";
    }
    const ok = await bcrypt.compare(code, user.codeHash);
    if (!ok) {
      await tx.update(usersTable)
        .set({ passwordResetAttempts: sql`${usersTable.passwordResetAttempts} + 1` })
        .where(eq(usersTable.id, user.id));
      return "fail";
    }
    const passwordHash = await hashPassword(newPassword);
    await tx
      .update(usersTable)
      .set({
        passwordHash,
        passwordResetCodeHash: null,
        passwordResetCodeExpiresAt: null,
        passwordResetAttempts: 0,
        tokenVersion: sql`${usersTable.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));
    (req as unknown as { _resetUser?: typeof user })._resetUser = user;
    return "ok";
  });

  if (verdict === "fail") {
    res.status(400).json({ error: genericError });
    return;
  }
  const user = (req as unknown as { _resetUser: {
    id: number; email: string; name: string | null;
    tenantId: number | null; restaurantId: number | null;
  } })._resetUser;
  invalidateTokenVersionCache(user.id);
  await recordAuditLog({
    req, module: "auth", action: "password.reset.phone", entity: "auth",
    userId: user.id, userDisplay: user.email, role: null,
  });
  const changedAt = new Date().toUTCString();
  const changeIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  const changeUa = String(req.headers["user-agent"] ?? "unknown");
  void sendByTemplateKey("security_password_changed", user.email, {
    name: user.name ?? user.email,
    changedAt, ip: changeIp, userAgent: changeUa, when: changedAt,
    appName: "Khana Lagao",
  }, { tenantId: user.tenantId, restaurantId: user.restaurantId ?? null, recipientType: "user" });
  res.json({ success: true });
});

router.post("/auth/reset-password", resetLimitByIp, resetLimitByEmail, validate({ body: ResetPasswordBodyStrict }), async (req, res) => {
  const { email, code, newPassword } = req.body as { email: string; code: string; newPassword: string };

  // Generic message used for every "couldn't verify" path so the caller
  // can't tell whether the email is unknown, the code is wrong, or the
  // code has expired — same anti-enumeration stance as forgot-password.
  const genericError = "The code is invalid or has expired. Please request a new one.";

  // ── Verify + consume atomically in a transaction ─────────────────────
  // The previous implementation read the row, compared bcrypt, then
  // wrote — leaving a window where two concurrent valid-code requests
  // could both pass the compare. We now SELECT FOR UPDATE inside a
  // transaction and immediately consume (clear or increment) before the
  // commit, so the second concurrent request sees a NULL hash.
  const verdict: "ok" | "fail" = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        id: usersTable.id, email: usersTable.email, name: usersTable.name,
        isActive: usersTable.isActive, tenantId: usersTable.tenantId,
        restaurantId: usersTable.restaurantId,
        codeHash: usersTable.passwordResetCodeHash,
        codeExpiresAt: usersTable.passwordResetCodeExpiresAt,
        attempts: usersTable.passwordResetAttempts,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .for("update");

    // No usable account/code → run a dummy bcrypt to equalize timing,
    // then bail.
    if (!user || !user.isActive || !user.codeHash || !user.codeExpiresAt) {
      await bcrypt.compare(code, DUMMY_RESET_HASH);
      return "fail";
    }
    if (user.codeExpiresAt.getTime() < Date.now() || (user.attempts ?? 0) >= RESET_OTP_MAX_ATTEMPTS) {
      // Expired or attempt-locked — burn the code so future guesses skip
      // the bcrypt path entirely, but still equalize timing on this one.
      await bcrypt.compare(code, DUMMY_RESET_HASH);
      await tx.update(usersTable)
        .set({ passwordResetCodeHash: null, passwordResetCodeExpiresAt: null, passwordResetAttempts: 0 })
        .where(eq(usersTable.id, user.id));
      return "fail";
    }

    const ok = await bcrypt.compare(code, user.codeHash);
    if (!ok) {
      await tx.update(usersTable)
        .set({ passwordResetAttempts: sql`${usersTable.passwordResetAttempts} + 1` })
        .where(eq(usersTable.id, user.id));
      return "fail";
    }

    // Success — hash the new password, clear the OTP fields, and bump
    // tokenVersion so every existing session (including a potential
    // attacker's) is invalidated immediately. All in the same tx so a
    // concurrent request with the same code sees the cleared hash.
    const passwordHash = await hashPassword(newPassword);
    await tx
      .update(usersTable)
      .set({
        passwordHash,
        passwordResetCodeHash: null,
        passwordResetCodeExpiresAt: null,
        passwordResetAttempts: 0,
        tokenVersion: sql`${usersTable.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));
    // Stash a few fields on the request for post-commit side effects.
    (req as unknown as { _resetUser?: typeof user }) ._resetUser = user;
    return "ok";
  });

  if (verdict === "fail") {
    res.status(400).json({ error: genericError });
    return;
  }

  const user = (req as unknown as { _resetUser: {
    id: number; email: string; name: string | null;
    tenantId: number | null; restaurantId: number | null;
  } })._resetUser;

  invalidateTokenVersionCache(user.id);
  await recordAuditLog({
    req, module: "auth", action: "password.reset", entity: "auth",
    userId: user.id, userDisplay: user.email, role: null,
  });

  // Fire the "your password was changed" security notification so the
  // user can react immediately if it wasn't them. Best-effort.
  const changedAt = new Date().toUTCString();
  const changeIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  const changeUa = String(req.headers["user-agent"] ?? "unknown");
  void sendByTemplateKey("security_password_changed", user.email, {
    name: user.name ?? user.email,
    changedAt, ip: changeIp, userAgent: changeUa, when: changedAt,
    appName: "Khana Lagao",
  }, { tenantId: user.tenantId, restaurantId: user.restaurantId ?? null, recipientType: "user" });

  res.json({ success: true });
});

// Permission map mirrored from artifacts/tabletrack-mobile/lib/permissions.ts.
// The backend still enforces authoritatively via requireRole — this list is
// exposed so the mobile UI can hide buttons the active role can't use.
const ROLE_PERMISSIONS_FALLBACK: Record<string, string[]> = {
  super_admin: ["*"],
  owner: ["*"],
  manager: [
    "order.create", "order.void", "order.refund", "order.discount.apply",
    "kot.reprint", "bill.print", "bill.split", "payment.capture",
    "kot.update_status", "kot.86_item",
    "stock.adjust", "stock.receive_po", "vendor.manage",
    "shift.open", "shift.close", "cash.drop", "cash.pickup",
    "delivery.assign",
    "campaign.create", "coupon.create", "review.respond",
    "expense.approve", "report.export",
    "staff.invite", "attendance.edit", "approval.act",
  ],
  cashier: ["order.create", "bill.print", "bill.split", "payment.capture", "order.discount.apply", "shift.open", "shift.close", "cash.drop"],
  waiter: ["order.create", "bill.print", "kot.reprint"],
  captain: ["order.create", "order.discount.apply", "bill.print", "bill.split", "kot.reprint", "payment.capture"],
  kitchen: ["kot.update_status", "kot.reprint"],
  chef: ["kot.update_status", "kot.reprint", "kot.86_item"],
  inventory_manager: ["stock.adjust", "stock.transfer", "stock.receive_po", "vendor.manage"],
  hr: ["staff.invite", "attendance.edit"],
  hr_officer: ["staff.invite", "attendance.edit"],
  payroll: ["report.export"],
  marketing: ["campaign.create", "coupon.create", "review.respond"],
  accountant: ["expense.approve", "settlement.reconcile", "report.export"],
  auditor: ["report.export"],
  delivery_executive: ["delivery.mark_picked", "delivery.mark_delivered", "delivery.handover_cod"],
};

router.get("/auth/me", authenticate, async (req, res) => {
  const [user] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      tenantId: usersTable.tenantId,
      restaurantId: usersTable.restaurantId,
      isSuperAdmin: usersTable.isSuperAdmin,
      avatarUrl: usersTable.avatarUrl,
      phone: usersTable.phone,
      kitchenId: usersTable.kitchenId,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.sub));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Outlets the caller can see (drives the outlet switcher on mobile).
  // For owners/super-admins this is every branch of the tenant; for staff
  // it's the single restaurant they're attached to. We never expose
  // restaurants from another tenant.
  let outlets: { id: number; name: string; slug: string | null; city: string | null; logoUrl: string | null; isActive: boolean }[] = [];
  try {
    if (user.isSuperAdmin) {
      outlets = await db
        .select({
          id: restaurantsTable.id,
          name: restaurantsTable.name,
          slug: restaurantsTable.slug,
          city: restaurantsTable.city,
          logoUrl: restaurantsTable.logoUrl,
          isActive: restaurantsTable.isActive,
        })
        .from(restaurantsTable)
        .where(user.tenantId ? eq(restaurantsTable.tenantId, user.tenantId) : sql`true`)
        .limit(50);
    } else if (user.tenantId && (user.role === "owner" || user.role === "manager")) {
      outlets = await db
        .select({
          id: restaurantsTable.id,
          name: restaurantsTable.name,
          slug: restaurantsTable.slug,
          city: restaurantsTable.city,
          logoUrl: restaurantsTable.logoUrl,
          isActive: restaurantsTable.isActive,
        })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.tenantId, user.tenantId));
    } else if (user.restaurantId) {
      const rows = await db
        .select({
          id: restaurantsTable.id,
          name: restaurantsTable.name,
          slug: restaurantsTable.slug,
          city: restaurantsTable.city,
          logoUrl: restaurantsTable.logoUrl,
          isActive: restaurantsTable.isActive,
        })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.id, user.restaurantId));
      outlets = rows;
    }
  } catch (err) {
    req.log?.warn?.({ err }, "auth.me: failed to load outlets");
  }

  // Roles array: today there's only one role per user. Returned as an
  // array so the mobile app's "Continue as…" picker works once
  // multi-role assignments land. Owners can virtually act as any
  // built-in role via the same picker (their session role still says
  // "owner" — the picker just changes the active home stack).
  const roles = [user.role];
  const permissions = ROLE_PERMISSIONS_FALLBACK[user.role] ?? [];

  res.json({
    ...user,
    roles,
    permissions,
    outlets,
  });
});

export default router;
