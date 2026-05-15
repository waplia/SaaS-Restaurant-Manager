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
import { authenticate } from "../middleware/authenticate";
import { sendByTemplateKey } from "../lib/emailSender";
import { getAppSettings } from "../lib/appSettings";

import { sendLifecycleSms } from "../lib/smsSender";

const router = Router();

router.post("/auth/register", async (req, res) => {
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

router.post("/auth/login", async (req, res) => {
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
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

  const tokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    restaurantId: user.restaurantId,
    isSuperAdmin: user.isSuperAdmin,
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

router.post("/auth/refresh", async (req, res) => {
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
    const tokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      restaurantId: user.restaurantId,
      isSuperAdmin: user.isSuperAdmin,
    };
    res.json({
      accessToken: signAccessToken(tokenPayload),
      refreshToken: signRefreshToken(tokenPayload),
    });
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

router.post("/auth/logout", (_req, res) => {
  res.json({ success: true });
});

router.post("/auth/forgot-password", async (req, res) => {
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

router.post("/auth/reset-password", async (req, res) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token || !newPassword) {
    res.status(400).json({ error: "token and newPassword are required" });
    return;
  }
  try {
    const payload = verifyResetToken(token);
    if (payload.type !== "reset") {
      res.status(400).json({ error: "Invalid reset token" });
      return;
    }
    const passwordHash = await hashPassword(newPassword);
    await db
      .update(usersTable)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(usersTable.id, payload.sub));
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
