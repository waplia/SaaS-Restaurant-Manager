import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  db,
  customerUsersTable,
  customerUserLinksTable,
  customerOtpsTable,
  customersTable,
} from "./db";
import { sendSmsMessage } from "./smsSender";
import { logger } from "./logger";

const isDev = process.env.NODE_ENV === "development";
const SECRET = process.env.JWT_SECRET ?? (isDev ? "tabletrack-dev-secret-change-in-production" : "");
if (!SECRET) throw new Error("JWT_SECRET is required");

const ACCESS_EXPIRY = "30d";
const OTP_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const SALT_ROUNDS = 10;

export interface CustomerJwtPayload {
  sub: number;             // customer_user_id
  phone: string;
  type: "customer_access";
  tv: number;              // token version
}

export function signCustomerToken(payload: Omit<CustomerJwtPayload, "type">): string {
  return jwt.sign({ ...payload, type: "customer_access" }, SECRET, { expiresIn: ACCESS_EXPIRY });
}

export function verifyCustomerToken(token: string): CustomerJwtPayload {
  return jwt.verify(token, SECRET) as unknown as CustomerJwtPayload;
}

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

function genCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export interface OtpRequestResult {
  ok: boolean;
  otpId?: number;
  error?: string;
  /** Only populated in development for easier local testing. */
  devCode?: string;
}

export async function requestCustomerOtp(rawPhone: string): Promise<OtpRequestResult> {
  const phone = normalizePhone(rawPhone);
  if (phone.length < 7) return { ok: false, error: "Enter a valid phone number." };
  const code = genCode();
  const codeHash = await bcrypt.hash(code, SALT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const [otp] = await db.insert(customerOtpsTable).values({
    channel: "sms",
    identifier: phone,
    codeHash,
    expiresAt,
  }).returning();

  const body = `${code} is your TableTrack loyalty wallet code. Expires in 5 minutes.`;
  try {
    const send = await sendSmsMessage({
      to: phone,
      body,
      eventKey: "otp",
      variables: { code },
    });
    if (!send.ok) {
      logger.warn({ err: send.error, phone: phone.slice(-4) }, "Wallet OTP SMS failed; returning ok in dev");
      if (!isDev) {
        return { ok: false, otpId: otp.id, error: "Could not send SMS. Please try again." };
      }
    }
  } catch (err) {
    logger.warn({ err }, "Wallet OTP send threw");
    if (!isDev) return { ok: false, otpId: otp.id, error: "Could not send SMS. Please try again." };
  }

  return { ok: true, otpId: otp.id, devCode: isDev ? code : undefined };
}

export interface VerifyOtpResult {
  ok: boolean;
  token?: string;
  customerUser?: { id: number; phone: string; name: string | null; email: string | null };
  error?: string;
  /** Set when login was attempted but no account exists for the phone. */
  code?: "account_not_registered";
}

export interface VerifyOtpOptions {
  /** When true, the caller is the explicit "register" flow and a new
   * customer_users row may be created if none exists. When false (default),
   * unknown phones are rejected so login does not silently create accounts. */
  allowCreate?: boolean;
  /** Display name to set on a newly-created account (register flow only). */
  name?: string | null;
}

export async function verifyCustomerOtp(
  rawPhone: string,
  code: string,
  opts: VerifyOtpOptions = {},
): Promise<VerifyOtpResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone || !code) return { ok: false, error: "Phone and code are required." };

  const [otp] = await db.select().from(customerOtpsTable)
    .where(and(
      eq(customerOtpsTable.identifier, phone),
      isNull(customerOtpsTable.consumedAt),
      gt(customerOtpsTable.expiresAt, new Date()),
    ))
    .orderBy(desc(customerOtpsTable.id))
    .limit(1);

  if (!otp) return { ok: false, error: "No active code found. Request a new one." };
  if (otp.attemptCount >= MAX_ATTEMPTS) return { ok: false, error: "Too many attempts. Request a new code." };

  const match = await bcrypt.compare(code, otp.codeHash);
  if (!match) {
    await db.update(customerOtpsTable)
      .set({ attemptCount: otp.attemptCount + 1 })
      .where(eq(customerOtpsTable.id, otp.id));
    return { ok: false, error: "Incorrect code. Please try again." };
  }

  // Find or (only when explicitly allowed) create the customer_users row.
  // Login flow must NOT silently create accounts — surface a clear error
  // so the UI can route the user to the register screen instead.
  //
  // IMPORTANT: do NOT consume the OTP here. If we mark it consumed before
  // confirming the account exists / will be created, the wallet UI's
  // "no account → register with the code you already entered" flow would
  // fail because the same code can't be re-verified by /wallet/auth/register.
  // The OTP is consumed below, once we know this call is about to succeed.
  let [user] = await db.select().from(customerUsersTable).where(eq(customerUsersTable.phone, phone));
  if (!user) {
    if (!opts.allowCreate) {
      return {
        ok: false,
        error: "Account not registered. Please register first to continue.",
        code: "account_not_registered",
      };
    }
    [user] = await db.insert(customerUsersTable).values({
      phone,
      name: opts.name?.trim() || null,
    }).returning();
  }

  // Account confirmed — burn the OTP so it can't be replayed.
  await db.update(customerOtpsTable)
    .set({ consumedAt: new Date() })
    .where(eq(customerOtpsTable.id, otp.id));
  await db.update(customerUsersTable)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(customerUsersTable.id, user.id));

  // Backfill: link any existing `customers` rows that share this phone to the
  // customer_user. This is how the wallet aggregates balances across
  // restaurants the person has already visited.
  const matchingCustomers = await db.select({ id: customersTable.id, restaurantId: customersTable.restaurantId })
    .from(customersTable)
    .where(eq(customersTable.phone, phone));
  for (const c of matchingCustomers) {
    await db.insert(customerUserLinksTable).values({
      customerUserId: user.id,
      customerId: c.id,
      restaurantId: c.restaurantId,
    }).onConflictDoNothing();
  }

  const token = signCustomerToken({ sub: user.id, phone: user.phone, tv: user.tokenVersion });
  return {
    ok: true,
    token,
    customerUser: { id: user.id, phone: user.phone, name: user.name, email: user.email },
  };
}
