import { Router } from "express";
import { z } from "zod";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import {
  db,
  usersTable,
  tenantsTable,
  restaurantsTable,
  subscriptionPlansTable,
  branchesTable,
  registrationSessionsTable,
  appSettingsTable,
} from "../lib/db";
import { signAccessToken, signRefreshToken, hashPassword, comparePassword } from "../lib/auth";
import { createSession } from "../lib/sessions";
import { authenticate, invalidateTokenVersionCache } from "../middleware/authenticate";
import { rateLimit } from "../middleware/rateLimit";
import { validate } from "../middleware/validate";
import { recordAuditLog } from "../lib/audit";
import { getAppSettings, isPlatformWhatsappConfigured } from "../lib/appSettings";
import { sendStaffOtp, verifyStaffOtp, normalizePhone, normalizeEmail, newRegistrationToken } from "../lib/staffOtp";
import { parsePhone } from "@workspace/phone-utils";
import { sendLifecycleSms } from "../lib/smsSender";
import { logger } from "../lib/logger";
import { sendByTemplateKey } from "../lib/emailSender";

const router = Router();

// Look up a user by phone with several common shape variants. Users
// commonly type just the local digits ("9602374514") into the login form
// while the DB stores the full E.164 ("+919602374514") or the workspace
// canonical form ("91 9602374514"). Strategy:
//  1) digits-only equality (covers "+919...", "919...", "91 9...", etc.)
//  2) digits-only suffix match (last 10 digits) — covers bare local input
//     even when several test rows share a suffix, by preferring the row
//     whose stored digits match most specifically.
async function findUserByPhoneFlexible(raw: string) {
  const normalized = normalizePhone(raw);
  const digitsOnly = normalized.replace(/[^0-9]/g, "");
  if (!digitsOnly) return undefined;

  // Exact digits-only equality — comparing digits-only on both sides so a
  // stored "+919602374514" matches a typed "919602374514" or "9602374514"
  // when the dial code is present in either side.
  let [u] = await db.select().from(usersTable)
    .where(sql`regexp_replace(coalesce(${usersTable.phone}, ''), '[^0-9]', '', 'g') = ${digitsOnly}`);
  if (u) return u;

  // Suffix match on the trailing significant digits. Use up to 10 digits
  // (standard global mobile length) and require at least 7 to avoid
  // collisions on very short inputs. When several rows match the suffix
  // (e.g. seed/test users), pick the one whose stored digits-only form
  // matches the typed digits-only form most specifically.
  if (digitsOnly.length >= 7) {
    const suffix = digitsOnly.slice(-10);
    const matches = await db.select().from(usersTable)
      .where(sql`regexp_replace(coalesce(${usersTable.phone}, ''), '[^0-9]', '', 'g') LIKE ${"%" + suffix}`);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      // Prefer a row that ends with the *full* typed digits, then the
      // shortest stored form (most likely the canonical national number,
      // not a longer test variant). This keeps the lookup deterministic.
      const ranked = matches
        .map((m) => ({ m, d: (m.phone ?? "").replace(/[^0-9]/g, "") }))
        .filter((x) => x.d.endsWith(suffix))
        .sort((a, b) => a.d.length - b.d.length);
      if (ranked.length > 0) return ranked[0].m;
    }
  }
  return undefined;
}

const otpRequestLimit = rateLimit({ name: "auth.otp.request.ip", windowMs: 60 * 1000, max: 5 });
// Per-identifier hourly cap so a single phone/email can't be hammered with
// "Resend code" clicks even across IPs. Five sends per hour mirrors the
// product spec ("5 attempts every 1 hour"). Falls back to a no-op when the
// identifier is missing — the body validator will return 400 in that case.
const otpRequestPerIdentifierLimit = rateLimit({
  name: "auth.otp.request.identifier",
  windowMs: 60 * 60 * 1000,
  max: 5,
  ignoreIp: true,
  keyExtra: (req) => {
    // Canonicalize using the same normalisers as the user-lookup / OTP-send
    // pipeline so callers can't bypass the per-identifier cap by re-encoding
    // the same phone number (e.g. "+91 98765 43210" vs "9876543210"). The
    // channel is included in the key to keep email and phone buckets
    // separate even if values would collide.
    const body = req.body as { identifier?: unknown; channel?: unknown } | undefined;
    const rawId = typeof body?.identifier === "string" ? body.identifier.trim() : "";
    if (!rawId) return null;
    const rawCh = typeof body?.channel === "string" ? body.channel : "";
    if (rawCh === "email") return `email:${normalizeEmail(rawId)}`;
    if (rawCh === "sms" || rawCh === "whatsapp") return `phone:${normalizePhone(rawId)}`;
    return null;
  },
});
const otpVerifyLimit = rateLimit({ name: "auth.otp.verify.ip", windowMs: 15 * 60 * 1000, max: 30 });
const regStartLimit = rateLimit({ name: "auth.register.start.ip", windowMs: 60 * 60 * 1000, max: 10 });

const ChannelSchema = z.enum(["sms", "email", "whatsapp"]);
const PurposeSchema = z.enum(["login", "register", "two_factor", "verify_email", "verify_mobile"]);

// ────────────────────────────────────────────────────────────────────────────
// Send a login OTP. The identifier is a phone (sms/whatsapp) or email.
// The user lookup uses the channel-appropriate column on `users`.
// ────────────────────────────────────────────────────────────────────────────
const RequestOtpBody = z.object({
  channel: ChannelSchema,
  identifier: z.string().trim().min(3).max(200),
});

router.post("/auth/request-otp", otpRequestLimit, otpRequestPerIdentifierLimit, validate({ body: RequestOtpBody }), async (req, res) => {
  const body = req.body as z.infer<typeof RequestOtpBody>;
  // If the platform doesn't have WhatsApp provider credentials, silently
  // coerce whatsapp → sms so stale clients still work.
  const channel = body.channel === "whatsapp" && !isPlatformWhatsappConfigured() ? "sms" : body.channel;
  const { identifier } = body;
  const settings = await getAppSettings();
  if (channel === "email" && !settings.authEmailOtpLoginEnabled) {
    res.status(403).json({ error: "Email OTP login is disabled by the platform." });
    return;
  }
  if ((channel === "sms" || channel === "whatsapp") && !settings.authMobileOtpLoginEnabled) {
    res.status(403).json({ error: "Mobile OTP login is disabled by the platform." });
    return;
  }

  // Look up the user. Per product decision, we trade off the small
  // enumeration risk for a clear error so legitimate users with a typo
  // (or a deleted account) don't sit forever waiting for an OTP that
  // was never sent.
  let user: typeof usersTable.$inferSelect | undefined;
  if (channel === "email") {
    [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizeEmail(identifier)));
  } else {
    user = await findUserByPhoneFlexible(identifier);
  }

  if (!user) {
    res.status(404).json({
      error: channel === "email"
        ? "No account found for this email. Please check the spelling or create a new account."
        : "No account found for this mobile number. Please check it or create a new account.",
    });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "This account has been disabled. Please contact support." });
    return;
  }

  const r = await sendStaffOtp({
    channel,
    identifier,
    purpose: "login",
    userId: user.id,
    tenantId: user.tenantId,
    restaurantId: user.restaurantId,
    name: user.name,
  });
  if (!r.ok) {
    res.status(502).json({ error: r.error ?? "Could not send code. Please try again in a minute." });
    return;
  }
  res.json({ ok: true, channel });
});

// ────────────────────────────────────────────────────────────────────────────
// Verify a login OTP, issue access/refresh tokens.
// ────────────────────────────────────────────────────────────────────────────
const VerifyOtpBody = z.object({
  channel: ChannelSchema,
  identifier: z.string().trim().min(3).max(200),
  code: z.string().trim().length(6),
});

router.post("/auth/verify-otp", otpVerifyLimit, validate({ body: VerifyOtpBody }), async (req, res) => {
  const body = req.body as z.infer<typeof VerifyOtpBody>;
  const channel = body.channel === "whatsapp" && !isPlatformWhatsappConfigured() ? "sms" : body.channel;
  const { identifier, code } = body;
  let user: typeof usersTable.$inferSelect | undefined;
  if (channel === "email") {
    [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizeEmail(identifier)));
  } else {
    user = await findUserByPhoneFlexible(identifier);
  }
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid code or account not found." });
    return;
  }

  const v = await verifyStaffOtp({ identifier, channel, purpose: "login", code });
  if (!v.ok) {
    await recordAuditLog({
      req, module: "auth", action: "otp.login.failed", entity: "auth",
      userId: user.id, userDisplay: user.name ?? user.email, role: user.role,
      newValue: { channel, error: v.error },
    });
    res.status(401).json({ error: v.error ?? "Invalid code." });
    return;
  }

  // If 2FA is enabled for this user and platform, gate before issuing tokens.
  const settings = await getAppSettings();
  if (settings.authTwoFactorEnabled && user.twoFactorEnabled && user.twoFactorChannel) {
    const twoFaIdent = user.twoFactorChannel === "email" ? (user.email ?? "") : (user.phone ?? "");
    if (twoFaIdent) {
      await sendStaffOtp({
        channel: user.twoFactorChannel,
        identifier: twoFaIdent,
        purpose: "two_factor",
        userId: user.id,
        tenantId: user.tenantId,
        restaurantId: user.restaurantId,
        name: user.name,
      });
      res.json({
        ok: true,
        requires2fa: true,
        twoFactorChannel: user.twoFactorChannel,
        userId: user.id,
        identifierHint: maskIdentifier(twoFaIdent, user.twoFactorChannel),
      });
      return;
    }
  }

  await issueLogin(req, res, user, { method: `otp_${channel}` });
});

// ────────────────────────────────────────────────────────────────────────────
// Password login that respects 2FA. (The existing /auth/login route stays for
// backwards compatibility; this one is used by the new login UI when 2FA is
// enabled for the user.)
// ────────────────────────────────────────────────────────────────────────────
// Task #538 — identifier accepts either email or phone. `email` retained for
// backwards compatibility with any clients still posting the old shape.
const PasswordLoginBody = z.object({
  identifier: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(1).max(200),
}).refine((b) => !!(b.identifier || b.email), { message: "identifier or email is required" });

router.post(
  "/auth/login-2fa",
  rateLimit({ name: "auth.login2fa.ip", windowMs: 15 * 60 * 1000, max: 20 }),
  validate({ body: PasswordLoginBody }),
  async (req, res) => {
    const { identifier, email, password } = req.body as z.infer<typeof PasswordLoginBody>;
    const raw = (identifier ?? email ?? "").trim();
    const { findUserByIdentifier } = await import("./auth");
    const user = await findUserByIdentifier(raw);
    if (!user) {
      res.status(401).json({ error: "Invalid login details" });
      return;
    }
    const ok = await comparePassword(password, user.passwordHash);
    if (!ok) {
      await recordAuditLog({
        req, module: "auth", action: "login.failed", entity: "auth",
        userId: user.id, userDisplay: user.name ?? user.email, role: user.role,
        newValue: { reason: "bad_password" },
      });
      res.status(401).json({ error: "Invalid login details" });
      return;
    }
    // Password correct — surface specific status for disabled accounts only
    // after the password check passes, per task spec.
    if (!user.isActive) {
      await recordAuditLog({
        req, module: "auth", action: "login.failed", entity: "auth",
        userId: user.id, userDisplay: user.name ?? user.email, role: user.role,
        newValue: { reason: "user_inactive" },
      });
      res.status(403).json({ error: "Your account has been disabled. Please contact support." });
      return;
    }

    const settings = await getAppSettings();
    if (settings.authTwoFactorEnabled && user.twoFactorEnabled && user.twoFactorChannel) {
      const twoFaIdent = user.twoFactorChannel === "email" ? (user.email ?? "") : (user.phone ?? "");
      if (twoFaIdent) {
        await sendStaffOtp({
          channel: user.twoFactorChannel,
          identifier: twoFaIdent,
          purpose: "two_factor",
          userId: user.id,
          tenantId: user.tenantId,
          restaurantId: user.restaurantId,
          name: user.name,
        });
        res.json({
          ok: true,
          requires2fa: true,
          twoFactorChannel: user.twoFactorChannel,
          userId: user.id,
          identifierHint: maskIdentifier(twoFaIdent, user.twoFactorChannel),
        });
        return;
      }
    }

    await issueLogin(req, res, user, { method: "password" });
  },
);

// ────────────────────────────────────────────────────────────────────────────
// Verify a 2FA code submitted after password / OTP first factor. Issues tokens
// on success.
// ────────────────────────────────────────────────────────────────────────────
const Verify2faBody = z.object({
  userId: z.number().int().positive(),
  code: z.string().trim().length(6),
});

router.post(
  "/auth/2fa/verify",
  rateLimit({ name: "auth.2fa.verify.ip", windowMs: 15 * 60 * 1000, max: 30 }),
  validate({ body: Verify2faBody }),
  async (req, res) => {
    const { userId, code } = req.body as z.infer<typeof Verify2faBody>;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user || !user.isActive || !user.twoFactorEnabled || !user.twoFactorChannel) {
      res.status(401).json({ error: "Invalid 2FA session." });
      return;
    }
    const identifier = user.twoFactorChannel === "email" ? (user.email ?? "") : (user.phone ?? "");
    const v = await verifyStaffOtp({ identifier, channel: user.twoFactorChannel, purpose: "two_factor", code });
    if (!v.ok) {
      res.status(401).json({ error: v.error ?? "Invalid 2FA code." });
      return;
    }
    await issueLogin(req, res, user, { method: "2fa" });
  },
);

// ────────────────────────────────────────────────────────────────────────────
// Authenticated 2FA management
// ────────────────────────────────────────────────────────────────────────────
const Enable2faStartBody = z.object({
  channel: z.enum(["sms", "email", "whatsapp"]),
});

router.post("/auth/2fa/enable/start", authenticate, validate({ body: Enable2faStartBody }), async (req, res) => {
  const { channel } = req.body as z.infer<typeof Enable2faStartBody>;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.sub));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const ident = channel === "email" ? user.email : user.phone;
  if (!ident) {
    res.status(400).json({
      error: channel === "email" ? "Add an email to your profile first." : "Add a phone number to your profile first.",
    });
    return;
  }
  const r = await sendStaffOtp({
    channel,
    identifier: ident,
    purpose: "two_factor",
    userId: user.id,
    tenantId: user.tenantId,
    restaurantId: user.restaurantId,
    name: user.name,
  });
  if (!r.ok) {
    res.status(400).json({ error: r.error });
    return;
  }
  res.json({ ok: true, channel });
});

const Enable2faConfirmBody = z.object({
  channel: z.enum(["sms", "email", "whatsapp"]),
  code: z.string().trim().length(6),
});

router.post("/auth/2fa/enable/confirm", authenticate, validate({ body: Enable2faConfirmBody }), async (req, res) => {
  const { channel, code } = req.body as z.infer<typeof Enable2faConfirmBody>;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.sub));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const ident = channel === "email" ? user.email : user.phone;
  if (!ident) {
    res.status(400).json({ error: "Missing channel identifier." });
    return;
  }
  const v = await verifyStaffOtp({ identifier: ident, channel, purpose: "two_factor", code });
  if (!v.ok) {
    res.status(401).json({ error: v.error ?? "Invalid code" });
    return;
  }
  await db.update(usersTable).set({
    twoFactorEnabled: true,
    twoFactorChannel: channel,
    ...(channel === "email" ? { emailVerifiedAt: new Date() } : { mobileVerifiedAt: new Date() }),
    updatedAt: new Date(),
  }).where(eq(usersTable.id, user.id));
  await recordAuditLog({
    req, module: "auth", action: "2fa.enabled", entity: "auth",
    userId: user.id, userDisplay: user.name ?? user.email, role: user.role,
    newValue: { channel },
  });
  res.json({ ok: true });
});

router.post("/auth/2fa/disable", authenticate, async (req, res) => {
  await db.update(usersTable).set({
    twoFactorEnabled: false,
    twoFactorChannel: null,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, req.user!.sub));
  await recordAuditLog({
    req, module: "auth", action: "2fa.disabled", entity: "auth",
    userId: req.user!.sub, userDisplay: req.user!.email, role: req.user!.role,
  });
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────────────
// Self-serve registration — step 1: phone + send OTP
// ────────────────────────────────────────────────────────────────────────────
const RegisterStartBody = z.object({
  countryCode: z.string().trim().min(2).max(6),
  phone: z.string().trim().min(6).max(20),
  channel: z.enum(["sms", "whatsapp"]).default("sms"),
});

router.post("/auth/register/start", regStartLimit, validate({ body: RegisterStartBody }), async (req, res) => {
  const settings = await getAppSettings();
  if (!settings.signupEnabled) {
    res.status(403).json({ error: "Signups are currently disabled by the platform administrator." });
    return;
  }
  const regBody = req.body as z.infer<typeof RegisterStartBody>;
  const channel = regBody.channel === "whatsapp" && !isPlatformWhatsappConfigured() ? "sms" : regBody.channel;
  const { countryCode, phone } = regBody;
  // Canonicalise via the shared parser so we tolerate every shape the
  // various clients can send: "+91" + "8306020200", "+91" + "918306020200"
  // (country code accidentally re-typed), "+9183" + "06020200" (mobile
  // splitPhone greedy match), or already-E.164 strings. parsePhone matches
  // the longest known dial code, so doubled prefixes collapse to one.
  const ccDigits = countryCode.replace(/\D/g, "");
  let localDigits = phone.replace(/\D/g, "").replace(/^0+/, "");
  // First pass: if the user re-typed the country code inside the phone
  // field, strip it. parsePhone alone only collapses one prefix layer.
  if (ccDigits && localDigits.startsWith(ccDigits)) {
    localDigits = localDigits.slice(ccDigits.length).replace(/^0+/, "");
  }
  // Second pass: hand the combined string to the shared parser so any
  // remaining shape (extra dial code embedded, oversized cc field, etc.)
  // collapses to the canonical form via longest-known-dial-code match.
  const parsed = parsePhone(`+${ccDigits}${localDigits}`, undefined);
  const finalCc = (parsed.country.code || ccDigits).replace(/\D/g, "");
  let finalNational = parsed.national.replace(/\D/g, "");
  // Third pass: if the parsed national still starts with the dial code
  // (e.g. caller sent "+91" + "919183…"), strip it once more.
  if (finalCc && finalNational.startsWith(finalCc)) {
    finalNational = finalNational.slice(finalCc.length).replace(/^0+/, "");
  }
  const fullPhone = normalizePhone(`+${finalCc}${finalNational}`);
  if (fullPhone.length < 8) {
    res.status(400).json({ error: "Enter a valid phone number." });
    return;
  }

  // If we already have an owner with this phone, treat it as a hint to log in.
  const [existing] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(sql`regexp_replace(coalesce(${usersTable.phone}, ''), '[^0-9+]', '', 'g') = ${fullPhone}`);
  if (existing) {
    res.status(409).json({ error: "This phone is already registered. Please sign in instead." });
    return;
  }

  const token = newRegistrationToken();
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  await db.insert(registrationSessionsTable).values({
    token, phone: fullPhone, countryCode, expiresAt,
  });

  const r = await sendStaffOtp({
    channel, identifier: fullPhone, purpose: "register",
  });
  if (!r.ok) {
    res.status(400).json({ error: r.error });
    return;
  }
  res.json({ ok: true, registrationToken: token, channel });
});

// Step 2: verify the phone OTP, mark session as mobile_verified
const RegisterVerifyBody = z.object({
  registrationToken: z.string().min(1),
  code: z.string().trim().length(6),
  channel: z.enum(["sms", "whatsapp"]).default("sms"),
});

router.post("/auth/register/verify-otp", regStartLimit, validate({ body: RegisterVerifyBody }), async (req, res) => {
  const verifyBody = req.body as z.infer<typeof RegisterVerifyBody>;
  const channel = verifyBody.channel === "whatsapp" && !isPlatformWhatsappConfigured() ? "sms" : verifyBody.channel;
  const { registrationToken, code } = verifyBody;
  const [session] = await db.select().from(registrationSessionsTable)
    .where(and(
      eq(registrationSessionsTable.token, registrationToken),
      isNull(registrationSessionsTable.consumedAt),
      gt(registrationSessionsTable.expiresAt, new Date()),
    ));
  if (!session) {
    res.status(400).json({ error: "Registration session expired. Please start over." });
    return;
  }
  const v = await verifyStaffOtp({ identifier: session.phone, channel, purpose: "register", code });
  if (!v.ok) {
    res.status(401).json({ error: v.error ?? "Invalid code" });
    return;
  }
  await db.update(registrationSessionsTable)
    .set({ mobileVerifiedAt: new Date() })
    .where(eq(registrationSessionsTable.id, session.id));
  res.json({ ok: true });
});

// Step 3: complete registration with the rest of the details
const RegisterCompleteBody = z.object({
  registrationToken: z.string().min(1),
  restaurantName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
});

router.post("/auth/register/complete", regStartLimit, validate({ body: RegisterCompleteBody }), async (req, res) => {
  const settings = await getAppSettings();
  if (!settings.signupEnabled) {
    res.status(403).json({ error: "Signups are currently disabled by the platform administrator." });
    return;
  }
  const { registrationToken, restaurantName, ownerName, email, password } = req.body as z.infer<typeof RegisterCompleteBody>;

  const [session] = await db.select().from(registrationSessionsTable)
    .where(and(
      eq(registrationSessionsTable.token, registrationToken),
      isNull(registrationSessionsTable.consumedAt),
      gt(registrationSessionsTable.expiresAt, new Date()),
    ));
  if (!session) {
    res.status(400).json({ error: "Registration session expired. Please start over." });
    return;
  }
  if (settings.authSelfRegistrationRequireMobileOtp && !session.mobileVerifiedAt) {
    res.status(400).json({ error: "Please verify your mobile number first." });
    return;
  }

  const normalisedEmail = normalizeEmail(email);
  const [existingUser] = await db.select({ id: usersTable.id })
    .from(usersTable).where(eq(usersTable.email, normalisedEmail));
  if (existingUser) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const [trialPlan] = await db.select().from(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.slug, "free-trial"));
  const trialDays = trialPlan?.trialDays ?? 14;
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
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
        subscriptionStartedAt: new Date(),
        isActive: true,
      }).returning();
      const [r] = await tx.insert(restaurantsTable).values({
        tenantId: t.id,
        name: restaurantName,
        slug: `${baseSlug}-r-${uniqueSuffix}`,
        phone: session.phone,
      }).returning();
      await tx.insert(branchesTable).values({
        restaurantId: r.id, name: "Main", isMain: true, isActive: true,
      });
      const [u] = await tx.insert(usersTable).values({
        name: ownerName,
        email: normalisedEmail,
        passwordHash,
        phone: session.phone,
        role: "owner",
        tenantId: t.id,
        restaurantId: r.id,
        isActive: true,
        mobileVerifiedAt: new Date(),
      }).returning();
      await tx.update(registrationSessionsTable)
        .set({ consumedAt: new Date(), email: normalisedEmail })
        .where(eq(registrationSessionsTable.id, session.id));
      return { t, r, u };
    });
    tenant = result.t; restaurant = result.r; user = result.u;
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    if (/duplicate key|unique constraint|users_email_unique/i.test(msg)) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    throw err;
  }

  // Grant trial plan's monthly AI credits immediately. Best-effort: failure
  // here must not break signup — the daily sweep will retry.
  try {
    const { creditMonthlyAllocation } = await import("../lib/aiCredits");
    await creditMonthlyAllocation(tenant.id);
  } catch (err) {
    logger.warn({ err, tenantId: tenant.id }, "initial AI credit allocation failed (otp signup)");
  }

  const session2 = await createSession({ userId: user.id, req });
  const tokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    restaurantId: user.restaurantId,
    isSuperAdmin: user.isSuperAdmin,
    tv: user.tokenVersion,
    sid: session2.id,
    jti: session2.jti,
  };

  // Best-effort welcome notifications (do not block). Mirror auth.ts so the
  // OTP self-serve signup path fires the same emails + automation chain
  // and surfaces any failure to the server log.
  void sendLifecycleSms({
    tenantId: tenant.id, restaurantId: restaurant.id, to: session.phone,
    eventKey: "welcome",
    variables: { name: ownerName, restaurant: restaurantName, trialDays },
  });
  void sendByTemplateKey("restaurant_welcome", user.email, {
    name: user.name, restaurant: restaurant.name,
    appName: settings.appName, appUrl: process.env.PUBLIC_APP_URL ?? "",
  }, { tenantId: tenant.id })
    .then((r) => {
      if (!r?.ok) logger.warn({ userId: user.id, to: user.email, err: r?.error, skip: r?.skippedReason }, "restaurant_welcome (otp signup) did not send");
    })
    .catch((err) => logger.error({ err, userId: user.id, to: user.email }, "restaurant_welcome (otp signup) threw"));

  void sendByTemplateKey("trial_started", user.email, {
    name: user.name,
    trialDays: String(trialDays),
    trialEndsAt: trialEndsAt.toISOString().slice(0, 10),
    appName: settings.appName,
  }, { tenantId: tenant.id })
    .then((r) => {
      if (!r?.ok) logger.warn({ userId: user.id, to: user.email, err: r?.error, skip: r?.skippedReason }, "trial_started (otp signup) did not send");
    })
    .catch((err) => logger.error({ err, userId: user.id, to: user.email }, "trial_started (otp signup) threw"));

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
      logger.warn({ err, userId: user.id }, "otp signup automation chain failed");
    }
  })();

  await recordAuditLog({
    req, module: "auth", action: "register.complete", entity: "auth",
    userId: user.id, userDisplay: user.name ?? user.email, role: user.role,
    newValue: { source: "self_serve_otp" },
  });

  res.status(201).json({
    accessToken: signAccessToken(tokenPayload),
    refreshToken: signRefreshToken(tokenPayload),
    user: {
      id: user.id, name: user.name, email: user.email,
      role: user.role, tenantId: user.tenantId, restaurantId: user.restaurantId,
      isSuperAdmin: user.isSuperAdmin,
      kitchenId: user.kitchenId ?? null,
    },
    tenant: {
      id: tenant.id, name: tenant.name, planStatus: tenant.planStatus, trialEndsAt,
    },
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Public read of auth feature flags so the login/register UI can render the
// allowed tabs.
// ────────────────────────────────────────────────────────────────────────────
router.get("/auth/settings/public", async (_req, res) => {
  const s = await getAppSettings();
  const whatsappEnabled = isPlatformWhatsappConfigured();
  res.json({
    passwordLoginEnabled: s.authPasswordLoginEnabled,
    mobileOtpLoginEnabled: s.authMobileOtpLoginEnabled,
    emailOtpLoginEnabled: s.authEmailOtpLoginEnabled,
    twoFactorEnabled: s.authTwoFactorEnabled,
    selfRegistrationRequireMobileOtp: s.authSelfRegistrationRequireMobileOtp,
    signupEnabled: s.signupEnabled,
    whatsappEnabled,
    // If WhatsApp isn't configured by the super admin, force the default
    // channel back to SMS so clients never preselect an unavailable channel.
    otpDefaultChannel: whatsappEnabled ? s.authOtpDefaultChannel : "sms",
    googleSignInEnabled: !!(s.googleSignInEnabled && s.googleClientId),
    googleClientId: s.googleSignInEnabled ? s.googleClientId : null,
    googleIosClientId: s.googleSignInEnabled ? (s.googleIosClientId ?? null) : null,
    googleAndroidClientId: s.googleSignInEnabled ? (s.googleAndroidClientId ?? null) : null,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
async function issueLogin(req: import("express").Request, res: import("express").Response, user: typeof usersTable.$inferSelect, audit: { method: string }) {
  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
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
  await recordAuditLog({
    req, module: "auth", action: "login.success", entity: "auth",
    userId: user.id, userDisplay: user.name ?? user.email,
    role: user.isSuperAdmin ? "super_admin" : user.role,
    restaurantId: user.restaurantId ?? null,
    newValue: { method: audit.method },
  });
  res.json({
    accessToken: signAccessToken(tokenPayload),
    refreshToken: signRefreshToken(tokenPayload),
    user: {
      id: user.id, name: user.name, email: user.email,
      role: user.role, tenantId: user.tenantId, restaurantId: user.restaurantId,
      isSuperAdmin: user.isSuperAdmin,
      kitchenId: user.kitchenId ?? null,
    },
  });
}

function maskIdentifier(ident: string, channel: "sms" | "email" | "whatsapp"): string {
  if (channel === "email") {
    const [name, domain] = ident.split("@");
    if (!domain) return "•••";
    const visible = name.slice(0, 2);
    return `${visible}${"•".repeat(Math.max(1, name.length - 2))}@${domain}`;
  }
  if (ident.length <= 4) return `••${ident.slice(-2)}`;
  return `${ident.slice(0, 3)}${"•".repeat(ident.length - 5)}${ident.slice(-2)}`;
}

export default router;
