import { and, eq, isNull, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, managerOtpsTable, usersTable, restaurantsTable } from "./db";
import { sendSmsMessage } from "./smsSender";
import { logger } from "./logger";

const OTP_TTL_MS = 5 * 60_000; // 5 minutes
const MAX_ATTEMPTS = 5;

function genCode(): string {
  // 6-digit zero-padded numeric.
  return String(Math.floor(100000 + Math.random() * 900000));
}

export interface RequestOtpResult {
  ok: boolean;
  otpId?: number;
  recipient?: string;
  error?: string;
  smsLogId?: number;
}

/**
 * Generate a 6-digit manager OTP and SMS it to one of the restaurant's
 * owner/manager phones. Stores a bcrypt hash so the code is never recoverable
 * from the DB. Falls back to error when no eligible recipient phone exists.
 */
export async function requestManagerDiscountOtp(opts: {
  restaurantId: number;
  requestedByUserId: number | null;
}): Promise<RequestOtpResult> {
  const { restaurantId, requestedByUserId } = opts;

  // Pick the first manager/owner with a phone number on file.
  const candidates = await db
    .select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.restaurantId, restaurantId));
  const recipient = candidates.find(u =>
    (u.role === "owner" || u.role === "manager") &&
    typeof u.phone === "string" &&
    u.phone.trim().length >= 6,
  );
  if (!recipient || !recipient.phone) {
    return { ok: false, error: "No owner/manager with a phone number on file. Configure one in Staff settings." };
  }

  const code = genCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const [restaurant] = await db.select({ tenantId: restaurantsTable.tenantId, name: restaurantsTable.name })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));

  const [otp] = await db.insert(managerOtpsTable).values({
    restaurantId,
    purpose: "discount_approval",
    codeHash,
    recipientPhone: recipient.phone,
    recipientUserId: recipient.id,
    requestedByUserId,
    expiresAt,
  }).returning();

  const body = `${code} is your verification code for Khana Lagao. Valid for 5 minutes. Do not share this code with anyone.`;

  let smsLogId: number | undefined;
  try {
    const result = await sendSmsMessage({
      to: recipient.phone,
      body,
      eventKey: "otp",
      variables: { code, restaurant: restaurant?.name ?? "KhanaLagao" },
      tenantId: restaurant?.tenantId ?? null,
      restaurantId,
    });
    smsLogId = result.logId;
    if (!result.ok) {
      return { ok: false, otpId: otp.id, error: `Could not send SMS: ${result.error ?? "unknown"}`, smsLogId };
    }
  } catch (err) {
    logger.warn({ err, restaurantId }, "manager discount OTP send failed");
    return { ok: false, otpId: otp.id, error: (err as Error).message, smsLogId };
  }

  return { ok: true, otpId: otp.id, recipient: recipient.phone, smsLogId };
}

export interface VerifyOtpResult {
  ok: boolean;
  otpId?: number;
  error?: string;
}

/**
 * Verify a manager OTP for a discount approval. Marks it consumed atomically
 * on success so the same code can't be reused. Caller is the cashier/waiter
 * sending the request; `consumedByUserId` records them as the consumer (the
 * manager remains `recipientUserId`).
 */
export async function verifyManagerDiscountOtp(opts: {
  restaurantId: number;
  code: string;
  consumedByUserId: number | null;
}): Promise<VerifyOtpResult> {
  const code = String(opts.code ?? "").trim();
  if (!/^\d{4,8}$/.test(code)) return { ok: false, error: "Invalid OTP format" };

  const now = new Date();
  // Pull active (unconsumed, unexpired) OTPs for this restaurant; check newest first.
  const rows = await db.select().from(managerOtpsTable)
    .where(and(
      eq(managerOtpsTable.restaurantId, opts.restaurantId),
      eq(managerOtpsTable.purpose, "discount_approval"),
      isNull(managerOtpsTable.consumedAt),
      gt(managerOtpsTable.expiresAt, now),
    ))
    .orderBy(managerOtpsTable.createdAt);

  // Walk from newest to oldest.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.attemptCount >= MAX_ATTEMPTS) continue;
    const match = await bcrypt.compare(code, row.codeHash);
    if (!match) {
      await db.update(managerOtpsTable)
        .set({ attemptCount: row.attemptCount + 1 })
        .where(eq(managerOtpsTable.id, row.id));
      continue;
    }
    // Atomically consume.
    const consumed = await db.update(managerOtpsTable)
      .set({ consumedAt: new Date(), consumedByUserId: opts.consumedByUserId })
      .where(and(eq(managerOtpsTable.id, row.id), isNull(managerOtpsTable.consumedAt)))
      .returning({ id: managerOtpsTable.id });
    if (consumed.length === 0) continue; // race lost — try other rows
    return { ok: true, otpId: row.id };
  }
  return { ok: false, error: "OTP is invalid or expired" };
}
