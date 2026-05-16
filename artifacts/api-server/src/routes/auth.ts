import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, tenantsTable, restaurantsTable, subscriptionPlansTable, branchesTable } from "../lib/db";
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

router.post("/auth/register", registerLimitByIp, async (req, res) => {
  const settings = await getAppSettings();
  if (!settings.signupEnabled) {
    res.status(403).json({ error: "Signups are currently disabled by the platform administrator." });
    return;
  }
  const { restaurantName, ownerName, email, password, phone } = req.body as {
    restaurantName?: string;
    ownerName?: string;
    email?: string;
    password?: string;
    phone?: string;
  };

  if (!restaurantName || !ownerName || !email || !password) {
    res.status(400).json({ error: "restaurantName, ownerName, email and password are required" });
    return;
  }
  // Phone is optional but, if provided, must include the country code.
  // Stored as e.g. "+91 9876543210" — server stays format-agnostic, just ensures '+'.
  const normalisedPhone = phone?.trim() ? phone.trim() : null;
  if (normalisedPhone && !normalisedPhone.startsWith("+")) {
    res.status(400).json({ error: "Phone must include a country code, e.g. +91 9876543210" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
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

  const tokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    restaurantId: user.restaurantId,
    isSuperAdmin: user.isSuperAdmin,
    tv: user.tokenVersion,
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

router.post("/auth/login", loginLimitByIp, loginLimitByEmail, async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

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

  const tokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    restaurantId: user.restaurantId,
    isSuperAdmin: user.isSuperAdmin,
    tv: user.tokenVersion,
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

router.post("/auth/refresh", refreshLimitByIp, async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    res.status(400).json({ error: "refreshToken is required" });
    return;
  }
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
    const tokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      restaurantId: user.restaurantId,
      isSuperAdmin: user.isSuperAdmin,
      tv: user.tokenVersion,
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
  // next request doesn't serve a stale value.
  const userId = req.user!.sub;
  await db
    .update(usersTable)
    .set({ tokenVersion: sql`${usersTable.tokenVersion} + 1`, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  invalidateTokenVersionCache(userId);
  await recordAuditLog({ req, module: "auth", action: "logout", entity: "auth" });
  res.json({ success: true });
});

// Self-service password change for any authenticated user. Requires the
// current password (so a stolen-but-still-valid access token cannot be used
// to silently swap the password). Bumps tokenVersion so every other session
// for this user — including the one used to make this request, before it
// receives the new tokens below — is invalidated immediately.
const changePasswordLimitByIp = rateLimit({ name: "auth.change.ip", windowMs: 15 * 60 * 1000, max: 10 });
router.post("/auth/change-password", authenticate, changePasswordLimitByIp, async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }
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

router.post("/auth/forgot-password", forgotLimitByIp, forgotLimitByEmail, async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }
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

router.post("/auth/reset-password", resetLimitByIp, async (req, res) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token || !newPassword) {
    res.status(400).json({ error: "token and newPassword are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
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
