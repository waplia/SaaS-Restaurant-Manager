import { pgTable, serial, integer, text, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export type StaffOtpChannel = "sms" | "email" | "whatsapp";
export type StaffOtpPurpose = "login" | "register" | "two_factor" | "verify_email" | "verify_mobile" | "account_deletion";

export const staffOtpsTable = pgTable("staff_otps", {
  id: serial("id").primaryKey(),
  channel: text("channel").$type<StaffOtpChannel>().notNull(),
  purpose: text("purpose").$type<StaffOtpPurpose>().notNull().default("login"),
  identifier: text("identifier").notNull(),
  codeHash: text("code_hash").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  userId: integer("user_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byIdent: index("staff_otps_identifier_idx").on(t.identifier, t.purpose, t.createdAt),
}));

export type StaffOtp = typeof staffOtpsTable.$inferSelect;

export const registrationSessionsTable = pgTable("registration_sessions", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  phone: text("phone").notNull(),
  countryCode: text("country_code").notNull().default("+91"),
  mobileVerifiedAt: timestamp("mobile_verified_at"),
  emailVerifiedAt: timestamp("email_verified_at"),
  email: text("email"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byPhone: index("reg_sessions_phone_idx").on(t.phone, t.createdAt),
}));

export type RegistrationSession = typeof registrationSessionsTable.$inferSelect;
