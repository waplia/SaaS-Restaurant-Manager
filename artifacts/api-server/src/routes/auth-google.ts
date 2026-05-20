import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import {
  db,
  usersTable,
  tenantsTable,
  restaurantsTable,
  subscriptionPlansTable,
  branchesTable,
} from "../lib/db";
import { getAppSettings } from "../lib/appSettings";
import { decryptSecret } from "../lib/aiEncryption";
import { signAccessToken, signRefreshToken } from "../lib/auth";
import { createSession } from "../lib/sessions";
import { rateLimit } from "../middleware/rateLimit";
import { validate } from "../middleware/validate";
import { recordAuditLog } from "../lib/audit";
import { sendStaffOtp, verifyStaffOtp } from "../lib/staffOtp";

const router = Router();

const googleLimit = rateLimit({ name: "auth.google.ip", windowMs: 15 * 60 * 1000, max: 30 });

const JWT_SECRET = process.env.JWT_SECRET ?? (process.env.NODE_ENV === "development" ? "tabletrack-dev-secret-change-in-production" : "");
const PENDING_TTL = "30m";
type PendingPayload = { sub: number; email: string; type: "google-pending" };

function signPendingToken(userId: number, email: string): string {
  return jwt.sign({ sub: userId, email, type: "google-pending" } satisfies PendingPayload,
    JWT_SECRET, { expiresIn: PENDING_TTL });
}
function verifyPendingToken(token: string): PendingPayload {
  const p = jwt.verify(token, JWT_SECRET) as PendingPayload;
  if (p.type !== "google-pending") throw new Error("Invalid pending token");
  return p;
}

function getRedirectUri(): string {
  const base = (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return `${base}/app/auth/google/callback`;
}

async function getGoogleClient(): Promise<OAuth2Client | null> {
  const s = await getAppSettings();
  if (!s.googleSignInEnabled || !s.googleClientId) return null;
  return new OAuth2Client(s.googleClientId);
}

function normPhoneDigits(s: string): string {
  return s.startsWith("+") ? `+${s.slice(1).replace(/\D/g, "")}` : `+${s.replace(/\D/g, "")}`;
}

async function issueFullSession(user: typeof usersTable.$inferSelect, req: Parameters<typeof createSession>[0]["req"]) {
  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  const session = await createSession({ userId: user.id, req });
  const tokenPayload = {
    sub: user.id, email: user.email, role: user.role,
    tenantId: user.tenantId, restaurantId: user.restaurantId,
    isSuperAdmin: user.isSuperAdmin, tv: user.tokenVersion,
    sid: session.id, jti: session.jti,
  };
  return {
    accessToken: signAccessToken(tokenPayload),
    refreshToken: signRefreshToken(tokenPayload),
    user: {
      id: user.id, name: user.name, email: user.email,
      role: user.role, tenantId: user.tenantId, restaurantId: user.restaurantId,
      isSuperAdmin: user.isSuperAdmin, phone: user.phone,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public config endpoint — UI uses it to know whether to show the button.
// ────────────────────────────────────────────────────────────────────────────
router.get("/auth/google/config", async (_req, res) => {
  const s = await getAppSettings();
  res.json({
    enabled: !!s.googleSignInEnabled && !!s.googleClientId,
    clientId: s.googleSignInEnabled ? s.googleClientId : null,
    redirectUri: getRedirectUri(),
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Verify a Google ID token. Outcomes:
//   • Existing user, phone OK (or requirement off)        → full session
//   • Existing user, phone required but missing           → pending session
//   • New email + signups on, phone NOT required          → full session
//   • New email + signups on, phone required              → pending session
//     (user row is created with isActive=false until phone verified)
//   • New email + signups off                             → 404
// A "pending" response carries a short-lived `pendingToken` only and no
// access/refresh tokens. The account cannot be used until the client
// completes /auth/google/pending/verify with a valid phone OTP.
// ────────────────────────────────────────────────────────────────────────────
const VerifyBody = z.object({
  idToken: z.string().min(10),
  // "login" (default) → reject if no account exists for this Google identity.
  // "register" → allowed to create a new tenant+user (still gated on
  // signupEnabled). The caller is the explicit "Sign up with Google" button.
  mode: z.enum(["login", "register"]).optional(),
});

router.post("/auth/google/verify", googleLimit, validate({ body: VerifyBody }), async (req, res) => {
  const client = await getGoogleClient();
  if (!client) {
    res.status(403).json({ error: "Google sign-in is not enabled." });
    return;
  }
  const settings = await getAppSettings();
  const { idToken, mode = "login" } = req.body as z.infer<typeof VerifyBody>;

  let payload: import("google-auth-library").TokenPayload | undefined;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: settings.googleClientId ?? undefined });
    payload = ticket.getPayload();
  } catch (err) {
    req.log.warn({ err }, "Google ID token verification failed");
    res.status(401).json({ error: "Invalid Google token." });
    return;
  }
  if (!payload || !payload.sub || !payload.email || payload.email_verified === false) {
    res.status(401).json({ error: "Google account email is not verified." });
    return;
  }
  const googleId = payload.sub;
  const email = payload.email.toLowerCase();
  const displayName = payload.name ?? payload.email;
  const requirePhone = !!settings.googleRequirePhoneAfterSignup;

  // 1) Find by googleId, then fall back to email match (silent link).
  let [user] = await db.select().from(usersTable).where(eq(usersTable.googleId, googleId));
  if (!user) {
    const [byEmail] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    // Per task spec: silently link by email ONLY when the existing account's
    // email is already verified. An unverified match is treated as a
    // potential collision — we refuse to link and tell the legitimate owner
    // to sign in with their password first so they can attach Google
    // themselves. This prevents account takeover via an attacker registering
    // with someone else's email and then "signing in with Google".
    if (byEmail) {
      if (!byEmail.emailVerifiedAt) {
        res.status(409).json({
          error: "An unverified account with that email already exists. Please sign in with your password and verify your email before linking Google.",
        });
        return;
      }
      await db.update(usersTable)
        .set({ googleId, updatedAt: new Date() })
        .where(eq(usersTable.id, byEmail.id));
      user = { ...byEmail, googleId };
    }
  }

  if (user) {
    // Disabled accounts can't sign in regardless of method (except the case
    // where they're our own "pending phone verification" account: those have
    // isActive=false and authProvider='google'. Allow the pending flow.)
    if (!user.isActive && !(user.authProvider === "google" && requirePhone && !user.phone)) {
      res.status(403).json({ error: "Your account is disabled. Please contact support." });
      return;
    }
    if (requirePhone && !user.phone) {
      res.status(200).json({
        pending: true,
        needsProfileCompletion: true,
        pendingToken: signPendingToken(user.id, user.email),
        missing: { phone: true, restaurantName: !user.restaurantId },
      });
      return;
    }
    const session = await issueFullSession(user, req);
    await recordAuditLog({
      req, module: "auth", action: "login.success", entity: "auth",
      userId: user.id, userDisplay: user.name ?? user.email,
      role: user.isSuperAdmin ? "super_admin" : user.role,
      restaurantId: user.restaurantId ?? null,
      newValue: { method: "google" },
    });
    res.json(session);
    return;
  }

  // No account — gated signup path.
  // Login attempts (mode !== "register") must NEVER create a new account.
  // Surface a clear "not registered" message so the UI can prompt the user
  // to register first.
  if (mode !== "register") {
    res.status(404).json({
      error: "Account not registered. Please register first to continue.",
      code: "account_not_registered",
    });
    return;
  }
  if (!settings.signupEnabled) {
    res.status(404).json({ error: "Account not found. Self-signup is currently disabled." });
    return;
  }

  const [trialPlan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.slug, "free-trial"));
  const trialEndsAt = new Date(Date.now() + (settings.trialDays ?? 14) * 24 * 60 * 60 * 1000);
  const placeholderName = displayName?.slice(0, 60) || email.split("@")[0];
  const baseSlug = placeholderName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "restaurant";
  const uniqueSuffix = Date.now();
  const randomPwd = `google-${googleId}-${Math.random().toString(36).slice(2)}`;
  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.default.hash(randomPwd, 10);

  let createdUser: typeof usersTable.$inferSelect;
  let createdTenant: typeof tenantsTable.$inferSelect;
  try {
    const result = await db.transaction(async (tx) => {
      const [t] = await tx.insert(tenantsTable).values({
        name: placeholderName,
        slug: `${baseSlug}-${uniqueSuffix}`,
        planId: trialPlan?.id ?? null,
        planStatus: "trial",
        trialEndsAt,
        isActive: true,
      }).returning();
      const [r] = await tx.insert(restaurantsTable).values({
        tenantId: t.id, name: placeholderName, slug: `${baseSlug}-r-${uniqueSuffix}`,
      }).returning();
      await tx.insert(branchesTable).values({ restaurantId: r.id, name: "Main", isMain: true, isActive: true });
      const [u] = await tx.insert(usersTable).values({
        name: displayName ?? placeholderName,
        email,
        passwordHash,
        role: "owner",
        tenantId: t.id,
        restaurantId: r.id,
        // Gate account activation on phone verification when required.
        isActive: !requirePhone,
        googleId,
        authProvider: "google",
        emailVerifiedAt: new Date(),
        avatarUrl: payload?.picture ?? null,
      }).returning();
      return { t, r, u };
    });
    createdUser = result.u;
    createdTenant = result.t;
  } catch (err) {
    const message = (err as Error)?.message ?? "";
    if (/duplicate key|unique/i.test(message)) {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }
    throw err;
  }

  await recordAuditLog({
    req, module: "auth", action: "register.complete", entity: "auth",
    userId: createdUser.id, userDisplay: createdUser.name ?? createdUser.email, role: createdUser.role,
    newValue: { source: "google", requirePhone },
  });

  if (requirePhone) {
    res.status(201).json({
      pending: true,
      needsProfileCompletion: true,
      pendingToken: signPendingToken(createdUser.id, createdUser.email),
      missing: { phone: true, restaurantName: true },
    });
    return;
  }
  const session = await issueFullSession(createdUser, req);
  // requirePhone is false here (the pending branch returned above), so the
  // user has a full session and there is nothing the client needs to gate
  // on. Send them straight to the dashboard.
  res.status(201).json({
    ...session,
    tenant: { id: createdTenant.id, name: createdTenant.name, planStatus: createdTenant.planStatus, trialEndsAt },
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Pending Google account: send phone OTP. Requires a valid pendingToken
// issued by /auth/google/verify above.
// ────────────────────────────────────────────────────────────────────────────
const PendingOtpBody = z.object({
  pendingToken: z.string().min(10),
  phone: z.string().trim().min(7).max(40),
  channel: z.enum(["sms", "whatsapp"]).default("sms"),
});

router.post("/auth/google/pending/request-otp", googleLimit, validate({ body: PendingOtpBody }), async (req, res) => {
  const { pendingToken, phone, channel } = req.body as z.infer<typeof PendingOtpBody>;
  let pending: PendingPayload;
  try { pending = verifyPendingToken(pendingToken); }
  catch { res.status(401).json({ error: "Session expired. Please sign in again." }); return; }
  const normalised = normPhoneDigits(phone);
  if (normalised.length < 8) { res.status(400).json({ error: "Enter a valid phone number." }); return; }
  const r = await sendStaffOtp({ channel, identifier: normalised, purpose: "register" });
  if (!r.ok) { res.status(400).json({ error: r.error ?? "Could not send code." }); return; }
  res.json({ ok: true, channel, devCode: r.devCode, pendingUserId: pending.sub });
});

// ────────────────────────────────────────────────────────────────────────────
// Pending Google account: verify phone OTP. On success: activate the user,
// store the phone, optionally rename the restaurant, and return a full
// session. This is the ONLY way a pending Google account becomes usable.
// ────────────────────────────────────────────────────────────────────────────
const PendingVerifyBody = z.object({
  pendingToken: z.string().min(10),
  phone: z.string().trim().min(7).max(40),
  code: z.string().trim().length(6),
  channel: z.enum(["sms", "whatsapp"]).default("sms"),
  restaurantName: z.string().trim().min(2).max(120).optional(),
});

router.post("/auth/google/pending/verify", googleLimit, validate({ body: PendingVerifyBody }), async (req, res) => {
  const { pendingToken, phone, code, channel, restaurantName } = req.body as z.infer<typeof PendingVerifyBody>;
  let pending: PendingPayload;
  try { pending = verifyPendingToken(pendingToken); }
  catch { res.status(401).json({ error: "Session expired. Please sign in again." }); return; }

  const normalised = normPhoneDigits(phone);
  const v = await verifyStaffOtp({ identifier: normalised, channel, purpose: "register", code });
  if (!v.ok) { res.status(401).json({ error: v.error ?? "Invalid code." }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, pending.sub));
  if (!user) { res.status(404).json({ error: "Account not found." }); return; }

  await db.update(usersTable)
    .set({ phone: normalised, isActive: true, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  if (restaurantName && user.restaurantId) {
    await db.update(restaurantsTable)
      .set({ name: restaurantName, updatedAt: new Date() })
      .where(eq(restaurantsTable.id, user.restaurantId));
    if (user.tenantId) {
      await db.update(tenantsTable)
        .set({ name: restaurantName, updatedAt: new Date() })
        .where(eq(tenantsTable.id, user.tenantId));
    }
  }

  const fresh = { ...user, phone: normalised, isActive: true };
  const session = await issueFullSession(fresh, req);
  await recordAuditLog({
    req, module: "auth", action: "register.complete-profile", entity: "auth",
    userId: user.id, userDisplay: user.email,
    newValue: { source: "google", verifiedPhone: true, restaurantNameSet: !!restaurantName },
  });
  res.json(session);
});

// ────────────────────────────────────────────────────────────────────────────
// Super-admin: "Test connection". Mounted via googleAdminRouter below.
// ────────────────────────────────────────────────────────────────────────────
export const googleAdminRouter = Router();
googleAdminRouter.post("/admin/app-settings/google/test", async (_req, res) => {
  const s = await getAppSettings();
  if (!s.googleClientId) {
    res.status(400).json({ ok: false, error: "Set the Client ID first." });
    return;
  }
  const secret = decryptSecret({
    cipher: s.googleClientSecretEnc?.cipher ?? null,
    iv: s.googleClientSecretEnc?.iv ?? null,
    tag: s.googleClientSecretEnc?.tag ?? null,
  });
  if (!secret) {
    res.status(400).json({ ok: false, error: "Set the Client Secret first." });
    return;
  }
  try {
    // Real credential check: POST a deliberately-invalid authorization code
    // to Google's token endpoint. Google distinguishes the two failure modes:
    //   • invalid_client → wrong Client ID / Secret pair (creds bad)
    //   • invalid_grant  → creds are valid but the code is wrong (expected)
    const params = new URLSearchParams({
      client_id: s.googleClientId,
      client_secret: secret,
      code: "tabletrack-connection-test-invalid-code",
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri(),
    });
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const body = await r.json().catch(() => ({})) as { error?: string; error_description?: string };
    if (body.error === "invalid_grant") {
      // Creds accepted; only the dummy code was rejected — this is success.
      res.json({ ok: true, redirectUri: getRedirectUri() });
      return;
    }
    if (body.error === "invalid_client") {
      res.status(400).json({ ok: false, error: "Google rejected the Client ID/Secret. Double-check both values." });
      return;
    }
    if (body.error === "redirect_uri_mismatch") {
      res.status(400).json({
        ok: false,
        error: `Add this redirect URI to your Google OAuth client: ${getRedirectUri()}`,
      });
      return;
    }
    res.status(400).json({ ok: false, error: body.error_description ?? body.error ?? "Unknown Google error" });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

export default router;
