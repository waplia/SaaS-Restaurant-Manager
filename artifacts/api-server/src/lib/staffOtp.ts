import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, staffOtpsTable, type StaffOtpChannel, type StaffOtpPurpose } from "./db";
import { sendSmsMessage } from "./smsSender";
import { sendByTemplateKey } from "./emailSender";
import { sendWhatsAppMessage } from "./whatsapp";
import { getAppSettings } from "./appSettings";
import { logger } from "./logger";

const OTP_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const SALT_ROUNDS = 10;

export function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function genCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export interface StaffOtpSendInput {
  channel: StaffOtpChannel;
  identifier: string;
  purpose: StaffOtpPurpose;
  userId?: number | null;
  tenantId?: number | null;
  restaurantId?: number | null;
  name?: string | null;
}

export interface StaffOtpSendResult {
  ok: boolean;
  otpId?: number;
  error?: string;
  channel: StaffOtpChannel;
}

export async function sendStaffOtp(input: StaffOtpSendInput): Promise<StaffOtpSendResult> {
  const settings = await getAppSettings();
  const channel = input.channel;
  const identifier = channel === "email" ? normalizeEmail(input.identifier) : normalizePhone(input.identifier);
  const isLogin = input.purpose === "login";

  if (channel === "email") {
    if (isLogin && !settings.authEmailOtpLoginEnabled) {
      return { ok: false, error: "Email OTP login is disabled by the platform.", channel };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
      return { ok: false, error: "Enter a valid email address.", channel };
    }
  } else {
    if (isLogin && !settings.authMobileOtpLoginEnabled) {
      return { ok: false, error: "Mobile OTP login is disabled by the platform.", channel };
    }
    if (identifier.length < 7) return { ok: false, error: "Enter a valid phone number.", channel };
  }

  const code = genCode();
  const codeHash = await bcrypt.hash(code, SALT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const [otp] = await db.insert(staffOtpsTable).values({
    channel,
    purpose: input.purpose,
    identifier,
    codeHash,
    expiresAt,
    userId: input.userId ?? null,
    metadata: { tenantId: input.tenantId ?? null, restaurantId: input.restaurantId ?? null },
  }).returning();

  const appName = settings.appName || "KhanaLagao";
  const variables = { otp: code, code, name: input.name ?? "there", appName, minutes: 5 };
  const fallbackBody = `${code} is your verification code for KhanaLagao. Valid for 5 minutes. Do not share this code with anyone.`;

  try {
    if (channel === "sms") {
      const r = await sendSmsMessage({
        to: identifier,
        body: fallbackBody,
        eventKey: "otp",
        variables,
        tenantId: input.tenantId ?? null,
        restaurantId: input.restaurantId ?? null,
      });
      if (!r.ok) {
        return { ok: false, otpId: otp.id, error: "Could not send SMS. Please try again.", channel };
      }
    } else if (channel === "whatsapp") {
      const r = await sendWhatsAppMessage({
        restaurantId: input.restaurantId ?? null,
        tenantId: input.tenantId ?? null,
        to: identifier,
        body: fallbackBody,
        category: "transactional",
        skipQuota: true,
      });
      if (r.status !== "sent") {
        return { ok: false, otpId: otp.id, error: r.error ?? "Could not send WhatsApp message.", channel };
      }
    } else if (channel === "email") {
      // Route every staff OTP through the Super Admin–editable templates so
      // the email lands in `email_logs` with a `template_key`, the premium
      // layout, and the right kind. Login OTPs use `otp_login`; everything
      // else (verify / 2FA / register) uses `otp_verification`.
      // Canonical template keys (Task #546): map each OTP purpose to its
      // Super Admin–editable template. Falls back to legacy keys if the
      // canonical row isn't present yet.
      const templateKey = (() => {
        switch (input.purpose) {
          case "login": return "login_otp";
          case "register": return "signup_verification_otp";
          case "two_factor": return "two_factor_otp";
          case "verify_email":
          case "verify_mobile":
          default: return "signup_verification_otp";
        }
      })();
      const r = await sendByTemplateKey(templateKey, identifier, {
        name: input.name ?? "there",
        otp: code,
        ttlMinutes: 5,
        appName,
      }, {
        tenantId: input.tenantId ?? null,
        restaurantId: input.restaurantId ?? null,
        kind: "transactional",
        recipientType: "user",
      });
      // No hard-coded HTML fallback: if the template is missing/disabled or
      // the provider isn't configured, `sendByTemplateKey` already wrote a
      // failed `email_logs` row, so we just surface a loud error to the
      // caller. This keeps every OTP send centrally managed by Super Admin.
      if (!r || !r.ok) {
        return { ok: false, otpId: otp.id, error: "Could not send email. Please try again.", channel };
      }
    }
  } catch (err) {
    logger.warn({ err }, "Staff OTP send threw");
    return { ok: false, otpId: otp.id, error: "Could not send code. Please try again.", channel };
  }

  return { ok: true, otpId: otp.id, channel };
}

export interface VerifyStaffOtpResult {
  ok: boolean;
  error?: string;
  otp?: typeof staffOtpsTable.$inferSelect;
}

export async function verifyStaffOtp(input: {
  identifier: string;
  channel: StaffOtpChannel;
  purpose: StaffOtpPurpose;
  code: string;
}): Promise<VerifyStaffOtpResult> {
  const identifier = input.channel === "email" ? normalizeEmail(input.identifier) : normalizePhone(input.identifier);
  if (!identifier || !input.code) return { ok: false, error: "Code is required." };

  const [otp] = await db.select().from(staffOtpsTable)
    .where(and(
      eq(staffOtpsTable.identifier, identifier),
      eq(staffOtpsTable.purpose, input.purpose),
      eq(staffOtpsTable.channel, input.channel),
      isNull(staffOtpsTable.consumedAt),
      gt(staffOtpsTable.expiresAt, new Date()),
    ))
    .orderBy(desc(staffOtpsTable.id))
    .limit(1);

  if (!otp) return { ok: false, error: "No active code found. Request a new one." };
  if (otp.attemptCount >= MAX_ATTEMPTS) return { ok: false, error: "Too many attempts. Request a new code." };

  const match = await bcrypt.compare(input.code, otp.codeHash);
  if (!match) {
    await db.update(staffOtpsTable)
      .set({ attemptCount: otp.attemptCount + 1 })
      .where(eq(staffOtpsTable.id, otp.id));
    return { ok: false, error: "Incorrect code. Please try again." };
  }

  const [consumed] = await db.update(staffOtpsTable)
    .set({ consumedAt: new Date() })
    .where(eq(staffOtpsTable.id, otp.id))
    .returning();

  return { ok: true, otp: consumed };
}

export function newRegistrationToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}
