import { pgTable, text, serial, timestamp, integer, boolean, unique, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { restaurantsTable } from "./restaurants";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("waiter"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  isActive: boolean("is_active").notNull().default(true),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  lastLoginAt: timestamp("last_login_at"),
  // Mobile OTP / 2FA fields (Task #531). passwordHash is still notNull for
  // legacy seeded users; new OTP-registered owners get a random hash.
  mobileVerifiedAt: timestamp("mobile_verified_at"),
  emailVerifiedAt: timestamp("email_verified_at"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  twoFactorChannel: text("two_factor_channel").$type<"sms" | "email" | "whatsapp">(),
  preferredLoginMethod: text("preferred_login_method").$type<"password" | "mobile_otp" | "email_otp">().notNull().default("password"),
  // Task #538 — Google sign-in. `googleId` is the Google "sub" claim
  // (account-level stable id). `authProvider` records how the account was
  // originally created so the UI can show "Continue with Google" hints.
  googleId: text("google_id").unique(),
  authProvider: text("auth_provider").$type<"password" | "google" | "mobile_otp">().notNull().default("password"),
  // Bumped whenever the user logs out everywhere, changes/reset their
  // password, or the platform force-revokes sessions. The current value is
  // embedded in every issued JWT and re-checked in the auth middleware so
  // old tokens stop working immediately when this number changes.
  tokenVersion: integer("token_version").notNull().default(0),
  pushToken: text("push_token"),
  kitchenId: integer("kitchen_id"),
  // OTP-based password reset (Task #572). When the user requests a reset,
  // we generate a 6-digit code, bcrypt-hash it into `passwordResetCodeHash`,
  // set `passwordResetCodeExpiresAt` ~15 minutes ahead, and reset
  // `passwordResetAttempts` to 0. The reset endpoint verifies the code,
  // increments attempts on each bad try, and locks the code out after 5
  // failures. All three fields are cleared on successful reset.
  passwordResetCodeHash: text("password_reset_code_hash"),
  passwordResetCodeExpiresAt: timestamp("password_reset_code_expires_at"),
  passwordResetAttempts: integer("password_reset_attempts").notNull().default(0),
  notificationPrefs: jsonb("notification_prefs").$type<Record<string, boolean>>(),
  // Soft-delete (Task #573, account self-deletion from mobile).
  // Set when the user confirms account deletion via password+OTP.
  // `isActive` is also flipped to false so every existing
  // `isActive`-gated query (login, authenticate middleware, fanouts)
  // naturally excludes deleted users. The row is preserved so a
  // super-admin can restore it from the "Deleted accounts" panel.
  deletedAt: timestamp("deleted_at"),
  deletionReason: text("deletion_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const rolesTable = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  tenantId: integer("tenant_id").references(() => tenantsTable.id),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique().on(t.slug, t.tenantId)]);

export const permissionsTable = pgTable("permissions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const rolePermissionsTable = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").notNull().references(() => rolesTable.id),
  permissionId: integer("permission_id").notNull().references(() => permissionsTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique().on(t.roleId, t.permissionId)]);

// Tracks every issued refresh-token / login session so owners can see their
// active devices and revoke them individually. Each row is one device-login;
// the `jti` is embedded in JWTs and re-checked in `authenticate` so flipping
// `revokedAt` immediately kills only that device (unlike bumping
// `users.tokenVersion`, which signs every device out everywhere).
export const userSessionsTable = pgTable(
  "user_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    jti: text("jti").notNull().unique(),
    deviceLabel: text("device_label"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at").notNull().defaultNow(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [index("user_sessions_user_idx").on(t.userId)],
);

export type UserSession = typeof userSessionsTable.$inferSelect;

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const insertRoleSchema = createInsertSchema(rolesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof rolesTable.$inferSelect;

export const insertPermissionSchema = createInsertSchema(permissionsTable).omit({ id: true, createdAt: true });
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type Permission = typeof permissionsTable.$inferSelect;
