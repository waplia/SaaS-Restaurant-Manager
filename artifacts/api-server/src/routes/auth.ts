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
  signResetToken,
  verifyToken,
  verifyResetToken,
} from "../lib/auth";
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
import bcrypt from "bcryptjs";

const router = Router();

// Pre-computed bcrypt hash of a random string. Compared against when an email
// is unknown so login response time does not leak whether an account exists.
const DUMMY_BCRYPT_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.4OZN8ZjBkA8e2H9YQ2A6E9V1n7Ee";

// Two independent buckets — varying one dimension cannot bypass the other:
//  • per-IP: stops a single host (or a single proxy IP) from spraying.
//  • per-email: stops a botnet from grinding any *one* account from many IPs.
const emailKey = (req: { body?: { email?: string } }) => {
  const email = req.body?.email?.toLowerCase().trim();
  return email ? email.slice(0, 200) : null;
};

const loginLimitByIp = rateLimit({ name: "auth.login.ip", windowMs: 15 * 60 * 1000, max: 20 });
const loginLimitByEmail = rateLimit({ name: "auth.login.email", windowMs: 15 * 60 * 1000, max: 10, ignoreIp: true, keyExtra: emailKey });

const registerLimitByIp = rateLimit({ name: "auth.register.ip", windowMs: 60 * 60 * 1000, max: 5 });

const forgotLimitByIp = rateLimit({ name: "auth.forgot.ip", windowMs: 60 * 60 * 1000, max: 10 });
const forgotLimitByEmail = rateLimit({ name: "auth.forgot.email", windowMs: 60 * 60 * 1000, max: 5, ignoreIp: true, keyExtra: emailKey });

const resetLimitByIp = rateLimit({ name: "auth.reset.ip", windowMs: 60 * 60 * 1000, max: 10 });

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

  // Phone is optional but, if provided, must include the country code.
  // Stored as e.g. "+91 9876543210" — server stays format-agnostic, just ensures '+'.
  const normalisedPhone = phone?.trim() ? phone.trim() : null;
  if (normalisedPhone && !normalisedPhone.startsWith("+")) {
    res.status(400).json({ error: "Phone must include a country code, e.g. +91 9876543210" });
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

  const [tenant] = await db.insert(tenantsTable).values({
    name: restaurantName,
    slug: `${baseSlug}-${uniqueSuffix}`,
    planId: trialPlan?.id ?? null,
    planStatus: "trial",
    trialEndsAt,
    isActive: true,
  }).returning();

  const [restaurant] = await db.insert(restaurantsTable).values({
    tenantId: tenant.id,
    name: restaurantName,
    slug: `${baseSlug}-r-${uniqueSuffix}`,
  }).returning();

  // Auto-create a default "Main" branch so trial/starter owners can run a
  // single-location restaurant without ever opening the multi-branch step.
  await db.insert(branchesTable).values({
    restaurantId: restaurant.id,
    name: "Main",
    isMain: true,
    isActive: true,
  });

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    name: ownerName,
    email: email.toLowerCase(),
    passwordHash,
    phone: normalisedPhone,
    role: "owner",
    tenantId: tenant.id,
    restaurantId: restaurant.id,
    isActive: true,
  }).returning();

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
  void sendByTemplateKey("welcome", user.email, {
    name: user.name,
    restaurant: restaurant.name,
    appName: "Khana Lagao",
    appUrl: process.env.PUBLIC_APP_URL ?? "",
  }, { tenantId: tenant.id });
  void sendByTemplateKey("trial_started", user.email, {
    name: user.name,
    trialDays: String(trialPlan?.trialDays ?? 14),
    trialEndsAt: trialEndsAt.toISOString().slice(0, 10),
    appName: "Khana Lagao",
  }, { tenantId: tenant.id });

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

router.post("/auth/login", loginLimitByIp, loginLimitByEmail, validate({ body: LoginBody }), async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));
  if (!user || !user.isActive) {
    // Equalize timing so an attacker cannot tell from the response time
    // whether the email exists or the account is disabled.
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    await recordAuditLog({
      req, module: "auth", action: "login.failed", entity: "auth",
      userId: null, userDisplay: email, role: null,
      newValue: { email, reason: !user ? "user_not_found" : "user_inactive" },
    });
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    await recordAuditLog({
      req, module: "auth", action: "login.failed", entity: "auth",
      userId: user.id, userDisplay: user.name ?? user.email, role: user.role,
      restaurantId: user.restaurantId ?? null,
      newValue: { email, reason: "bad_password" },
    });
    res.status(401).json({ error: "Invalid credentials" });
    return;
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

router.post("/auth/forgot-password", forgotLimitByIp, forgotLimitByEmail, validate({ body: ForgotPasswordBody }), async (req, res) => {
  const { email } = req.body as { email: string };
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));

  if (user) {
    const resetToken = signResetToken({ sub: user.id, email: user.email });
    if (process.env.NODE_ENV === "development") {
      console.info(`[dev-only] password-reset token for user id=${user.id}`);
    }
    const base = (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const resetLink = `${base}/reset-password?token=${encodeURIComponent(resetToken)}`;
    const [u] = await db
      .select({ name: usersTable.name, email: usersTable.email, tenantId: usersTable.tenantId })
      .from(usersTable).where(eq(usersTable.id, user.id));
    void sendByTemplateKey("password_reset", u.email, {
      name: u.name,
      resetLink,
      appName: "Khana Lagao",
    }, { tenantId: u.tenantId });
  }
  res.json({ success: true, message: "If an account with that email exists, a reset link has been sent." });
});

const ResetPasswordBodyStrict = ResetPasswordBody.extend({
  newPassword: z.string().min(8),
});

router.post("/auth/reset-password", resetLimitByIp, validate({ body: ResetPasswordBodyStrict }), async (req, res) => {
  const { token, newPassword } = req.body as { token: string; newPassword: string };
  try {
    const payload = verifyResetToken(token);
    if (payload.type !== "reset") {
      res.status(400).json({ error: "Invalid reset token" });
      return;
    }
    // Single-use reset: refuse the token if the account's passwordHash has
    // already been changed after this token was issued (iat is in seconds).
    const [existing] = await db
      .select({ updatedAt: usersTable.updatedAt, isActive: usersTable.isActive })
      .from(usersTable)
      .where(eq(usersTable.id, payload.sub));
    if (!existing || !existing.isActive) {
      res.status(400).json({ error: "Invalid or expired reset token" });
      return;
    }
    const iat = (payload as unknown as { iat?: number }).iat;
    if (iat && existing.updatedAt && Math.floor(existing.updatedAt.getTime() / 1000) > iat) {
      res.status(400).json({ error: "Invalid or expired reset token" });
      return;
    }
    const passwordHash = await hashPassword(newPassword);
    // Bump tokenVersion alongside the password change so any sessions
    // active before the reset (including ones belonging to whoever
    // compromised the account) are invalidated immediately.
    await db
      .update(usersTable)
      .set({
        passwordHash,
        tokenVersion: sql`${usersTable.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, payload.sub));
    invalidateTokenVersionCache(payload.sub);
    await recordAuditLog({
      req, module: "auth", action: "password.reset", entity: "auth",
      userId: payload.sub, userDisplay: payload.email, role: null,
    });
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Invalid or expired reset token" });
  }
});

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
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.sub));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

export default router;
