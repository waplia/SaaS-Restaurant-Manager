/**
 * Tenant-facing Khana AI module endpoints (sit alongside menu-ai.ts):
 *   - GET    /restaurants/:rid/ai/settings            — load per-restaurant prefs
 *   - PUT    /restaurants/:rid/ai/settings            — update prefs
 *   - GET    /restaurants/:rid/ai/usage-summary       — daily counts + breakdown
 *   - GET    /restaurants/:rid/ai/recent-generations  — recent menu-item drafts
 */
import { Router, type Request, type Response } from "express";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import {
  db,
  restaurantAiSettingsTable,
  aiRequestLogsTable,
  aiCreditTransactionsTable,
  menuItemAiDraftsTable,
  menuItemsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { recordAuditLog } from "../lib/audit";

const router = Router();

router.use(
  "/restaurants/:restaurantId/ai/:rest",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
);

// ─── Per-restaurant AI settings ──────────────────────────────────────────────

async function loadOrCreateSettings(restaurantId: number) {
  const [existing] = await db.select().from(restaurantAiSettingsTable)
    .where(eq(restaurantAiSettingsTable.restaurantId, restaurantId));
  if (existing) return existing;
  const [created] = await db.insert(restaurantAiSettingsTable)
    .values({ restaurantId })
    .onConflictDoNothing({ target: restaurantAiSettingsTable.restaurantId })
    .returning();
  if (created) return created;
  // Lost the upsert race — re-read.
  const [row] = await db.select().from(restaurantAiSettingsTable)
    .where(eq(restaurantAiSettingsTable.restaurantId, restaurantId));
  return row;
}

router.get("/restaurants/:restaurantId/ai/settings", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const row = await loadOrCreateSettings(restaurantId);
  res.json(row);
});

router.put("/restaurants/:restaurantId/ai/settings", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const old = await loadOrCreateSettings(restaurantId);
  const b = (req.body ?? {}) as {
    defaultTone?: string; defaultLanguage?: string; defaultLength?: string;
    requireApprovalForDescriptions?: boolean; requireApprovalForImages?: boolean;
    featureToggles?: Record<string, boolean>;
  };
  const update: Partial<typeof restaurantAiSettingsTable.$inferInsert> = { updatedAt: new Date() };
  if (b.defaultTone != null) update.defaultTone = String(b.defaultTone);
  if (b.defaultLanguage != null) update.defaultLanguage = String(b.defaultLanguage);
  if (b.defaultLength != null) update.defaultLength = String(b.defaultLength);
  if (b.requireApprovalForDescriptions != null) update.requireApprovalForDescriptions = !!b.requireApprovalForDescriptions;
  if (b.requireApprovalForImages != null) update.requireApprovalForImages = !!b.requireApprovalForImages;
  if (b.featureToggles && typeof b.featureToggles === "object") {
    update.featureToggles = Object.fromEntries(
      Object.entries(b.featureToggles).map(([k, v]) => [String(k), !!v]),
    );
  }
  const [row] = await db.update(restaurantAiSettingsTable)
    .set(update).where(eq(restaurantAiSettingsTable.restaurantId, restaurantId)).returning();
  await recordAuditLog({
    req, module: "khana_ai", action: "settings.update",
    entity: "restaurant_ai_settings", entityId: row.id,
    oldValue: old, newValue: row,
  });
  res.json(row);
});

// ─── Usage summary (last 30 days, grouped by feature + status) ───────────────

router.get("/restaurants/:restaurantId/ai/usage-summary", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Per-feature counts (success vs error vs blocked)
  const byFeature = await db.select({
    featureSlug: aiRequestLogsTable.featureSlug,
    status: aiRequestLogsTable.status,
    count: sql<number>`count(*)::int`,
    creditsUsed: sql<number>`coalesce(sum(${aiRequestLogsTable.creditsUsed}), 0)::int`,
  }).from(aiRequestLogsTable)
    .where(and(
      eq(aiRequestLogsTable.restaurantId, restaurantId),
      gte(aiRequestLogsTable.createdAt, since),
    ))
    .groupBy(aiRequestLogsTable.featureSlug, aiRequestLogsTable.status);

  // Daily timeline (success only)
  const byDay = await db.execute(sql`
    SELECT
      to_char(date_trunc('day', ${aiRequestLogsTable.createdAt}), 'YYYY-MM-DD') AS day,
      ${aiRequestLogsTable.featureSlug} AS feature,
      count(*)::int AS count,
      coalesce(sum(${aiRequestLogsTable.creditsUsed}), 0)::int AS credits
    FROM ${aiRequestLogsTable}
    WHERE ${aiRequestLogsTable.restaurantId} = ${restaurantId}
      AND ${aiRequestLogsTable.createdAt} >= ${since}
      AND ${aiRequestLogsTable.status} = 'success'
    GROUP BY 1, 2
    ORDER BY 1
  `);

  // Wallet credit deltas (debits) over the same window — restaurant-scoped
  // by joining transactions to their originating request log so multi-
  // restaurant tenants don't blend each other's spend.
  const debits = await db.select({
    featureSlug: aiCreditTransactionsTable.featureSlug,
    spent: sql<number>`coalesce(sum(case when ${aiCreditTransactionsTable.credits} < 0 then -${aiCreditTransactionsTable.credits} else 0 end), 0)::int`,
  }).from(aiCreditTransactionsTable)
    .innerJoin(aiRequestLogsTable, eq(aiRequestLogsTable.id, aiCreditTransactionsTable.requestLogId))
    .where(and(
      eq(aiRequestLogsTable.restaurantId, restaurantId),
      gte(aiCreditTransactionsTable.createdAt, since),
    ))
    .groupBy(aiCreditTransactionsTable.featureSlug);

  res.json({
    sinceDays: days,
    byFeature,
    byDay: (byDay as unknown as { rows: Array<{ day: string; feature: string; count: number; credits: number }> }).rows,
    debits,
  });
});

// ─── Recent generations (drafts) ─────────────────────────────────────────────

router.get("/restaurants/:restaurantId/ai/recent-generations", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
  const rows = await db.select({
    id: menuItemAiDraftsTable.id,
    kind: menuItemAiDraftsTable.kind,
    payload: menuItemAiDraftsTable.payload,
    createdAt: menuItemAiDraftsTable.createdAt,
    menuItemId: menuItemAiDraftsTable.menuItemId,
    itemName: menuItemsTable.name,
  }).from(menuItemAiDraftsTable)
    .leftJoin(menuItemsTable, eq(menuItemsTable.id, menuItemAiDraftsTable.menuItemId))
    .where(eq(menuItemAiDraftsTable.restaurantId, restaurantId))
    .orderBy(desc(menuItemAiDraftsTable.createdAt))
    .limit(limit);
  res.json({ data: rows });
});

// ─── Paginated, filterable transactions (full history, server-side) ──────────
//
// /ai/wallet returns only the last 25 entries — fine for the wallet preview
// but unsuitable for the Usage page's filter/CSV-export workflow which needs
// to operate on the entire history. This endpoint replaces that for paginated
// access. Restaurant-scoped debits are joined to ai_request_logs so multi-
// restaurant tenants don't leak each other's spend; non-debit, wallet-level
// rows (recharge / bonus / monthly_allocation / manual_*) are included for
// the tenant since the wallet itself is per-tenant.

router.get("/restaurants/:restaurantId/ai/transactions", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = req.user?.tenantId ?? null;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });

  const q = req.query;
  const page = Math.max(1, Number(q.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)));
  const featureSlug = q.feature ? String(q.feature) : null;
  const type = q.type ? String(q.type) : null;
  const from = q.from ? new Date(String(q.from)) : null;
  const to = q.to ? new Date(String(q.to) + "T23:59:59.999Z") : null;

  // First find the restaurant-scoped request log ids in the (optional) date
  // range so we can include the matching debit rows alongside tenant-level
  // rows that have no requestLogId (recharge/bonus/etc.).
  const logFilters = [eq(aiRequestLogsTable.restaurantId, restaurantId)];
  if (from) logFilters.push(gte(aiRequestLogsTable.createdAt, from));
  if (to) logFilters.push(lte(aiRequestLogsTable.createdAt, to));
  const restaurantLogIds = await db
    .select({ id: aiRequestLogsTable.id })
    .from(aiRequestLogsTable)
    .where(and(...logFilters));
  const logIdSet = restaurantLogIds.map((r) => r.id);

  const where = [eq(aiCreditTransactionsTable.tenantId, tenantId)];
  if (featureSlug) where.push(eq(aiCreditTransactionsTable.featureSlug, featureSlug));
  if (type) where.push(eq(aiCreditTransactionsTable.type, type));
  if (from) where.push(gte(aiCreditTransactionsTable.createdAt, from));
  if (to) where.push(lte(aiCreditTransactionsTable.createdAt, to));

  // Restaurant scoping for debits: keep transactions whose requestLogId
  // belongs to this restaurant, OR transactions that have no requestLogId
  // (those are tenant-wide wallet ops — recharge / bonus / manual / etc.).
  const restaurantOrTenantWide = sql`(
    ${aiCreditTransactionsTable.requestLogId} IS NULL
    OR ${aiCreditTransactionsTable.requestLogId} IN (${sql.join(
      logIdSet.length > 0 ? logIdSet.map((id) => sql`${id}`) : [sql`NULL`],
      sql`, `,
    )})
  )`;
  where.push(restaurantOrTenantWide);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiCreditTransactionsTable)
    .where(and(...where));

  const rows = await db
    .select()
    .from(aiCreditTransactionsTable)
    .where(and(...where))
    .orderBy(desc(aiCreditTransactionsTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.json({
    data: rows,
    page,
    pageSize,
    total: count,
    totalPages: Math.max(1, Math.ceil(count / pageSize)),
  });
});

export default router;
