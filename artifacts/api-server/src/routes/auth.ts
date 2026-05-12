import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, tenantsTable, restaurantsTable, subscriptionPlansTable } from "../lib/db";
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

const router = Router();

router.post("/auth/register", async (req, res) => {
  const { restaurantName, ownerName, email, password } = req.body as {
    restaurantName?: string;
    ownerName?: string;
    email?: string;
    password?: string;
  };

  if (!restaurantName || !ownerName || !email || !password) {
    res.status(400).json({ error: "restaurantName, ownerName, email and password are required" });
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

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    name: ownerName,
    email: email.toLowerCase(),
    passwordHash,
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
    const _resetToken = signResetToken({ sub: user.id, email: user.email });
    if (process.env.NODE_ENV === "development") {
      console.info(`[dev-only] password-reset token for user id=${user.id}`);
    }
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
