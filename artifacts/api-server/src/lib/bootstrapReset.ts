import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { usersTable } from "./db";
import { logger } from "./logger";

export async function runBootstrapPasswordReset(): Promise<void> {
  const email = (process.env.BOOTSTRAP_RESET_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.BOOTSTRAP_RESET_PASSWORD ?? "";
  if (!email || !password) return;
  if (password.length < 8) {
    logger.warn("BOOTSTRAP_RESET_PASSWORD is set but shorter than 8 chars; skipping.");
    return;
  }
  try {
    const [user] = await db
      .select({ id: usersTable.id, isSuperAdmin: usersTable.isSuperAdmin })
      .from(usersTable)
      .where(eq(usersTable.email, email));
    if (!user) {
      logger.warn({ email }, "Bootstrap reset: user not found");
      return;
    }
    if (!user.isSuperAdmin) {
      logger.warn({ email }, "Bootstrap reset: refusing to reset non-super-admin via env var");
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    await db
      .update(usersTable)
      .set({
        passwordHash: hash,
        tokenVersion: sql`${usersTable.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));
    logger.info({ email }, "Bootstrap reset: super-admin password updated. Clear BOOTSTRAP_RESET_EMAIL/BOOTSTRAP_RESET_PASSWORD now.");
  } catch (err) {
    logger.error({ err }, "Bootstrap reset failed");
  }
}
