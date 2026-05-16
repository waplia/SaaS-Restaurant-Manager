import { db } from "./db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Ensures Postgres extensions and trigram indexes used by admin search are
 * present. Safe to run on every boot — uses IF NOT EXISTS everywhere.
 *
 * Trigram (pg_trgm) indexes keep `ILIKE '%foo%'` queries fast on the tenants
 * list as the dataset grows past a few thousand rows.
 */
export async function ensureSearchIndexes(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS tenants_name_trgm_idx ON tenants USING gin (name gin_trgm_ops)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS tenants_slug_trgm_idx ON tenants USING gin (slug gin_trgm_ops)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS users_email_trgm_idx ON users USING gin (email gin_trgm_ops)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS users_name_trgm_idx ON users USING gin (name gin_trgm_ops)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS users_phone_trgm_idx ON users USING gin (phone gin_trgm_ops) WHERE phone IS NOT NULL`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON users (tenant_id) WHERE tenant_id IS NOT NULL`);
  logger.info("Tenant search trigram indexes ensured");
}
