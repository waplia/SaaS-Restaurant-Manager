/**
 * Super-admin endpoints for the Khana AI credit economy:
 *   - Feature credit rules (CRUD with global/plan/restaurant scope)
 *   - Recharge packages (CRUD)
 *   - Tenant wallets (list, view, manual adjust, block, beta features)
 */
import { Router, type Request, type Response } from "express";
import { eq, and, desc, sql, like } from "drizzle-orm";
import {
  db,
  aiCreditWalletsTable,
  aiCreditTransactionsTable,
  aiFeatureCreditRulesTable,
  aiRechargePackagesTable,
  aiMonthlyAllocationsTable,
  tenantsTable,
  subscriptionPlansTable,
  usersTable,
} from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import { recordAuditLog } from "../lib/audit";
import { sendByTemplateKey } from "../lib/emailSender";
import { logger } from "../lib/logger";
import {
  getOrCreateWallet,
  summarizeWallet,
  adjustWallet,
  setWalletBlocked,
  setWalletBetaFeatures,
  applyRecharge,
  creditMonthlyAllocation,
  listTransactions,
} from "../lib/aiCredits";

const router = Router();
router.use("/admin/ai", requireSuperAdmin);

const MODULE = "ai_credits";

// ─── Feature Credit Rules ────────────────────────────────────────────────────

/** Public API shape for a credit rule — exposes UI-friendly aliases on top of the schema. */
function shapeRule(r: typeof aiFeatureCreditRulesTable.$inferSelect) {
  return {
    ...r,
    // UI aliases (kept stable across schema renames):
    label: r.featureLabel,
    description: r.description,
    unitType: r.unitType,
    minimumCredits: r.minCharge,
    freeAllowancePerMonth: r.freeMonthlyQuota,
  };
}

router.get("/admin/ai/credit-rules", async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const [rows, totalRow] = await Promise.all([
    db.select().from(aiFeatureCreditRulesTable).orderBy(aiFeatureCreditRulesTable.featureSlug).limit(limit).offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(aiFeatureCreditRulesTable),
  ]);
  res.json({ rows: rows.map(shapeRule), total: Number(totalRow[0]?.c ?? 0), limit, offset });
});

router.post("/admin/ai/credit-rules", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  if (!b.featureSlug) return void res.status(400).json({ error: "featureSlug is required" });
  const scopeType = String(b.scopeType ?? "global");
  if (!["global", "plan", "restaurant"].includes(scopeType)) {
    return void res.status(400).json({ error: "scopeType must be global, plan or restaurant" });
  }
  // Accept both schema names and the UI aliases.
  const featureLabel = String(b.featureLabel ?? b.label ?? "").trim();
  const minCharge = Number(b.minCharge ?? b.minimumCredits ?? 1);
  const freeMonthlyQuota = Number(b.freeMonthlyQuota ?? b.freeAllowancePerMonth ?? 0);
  const description = b.description ?? b.notes ?? null;
  try {
    const [row] = await db.insert(aiFeatureCreditRulesTable).values({
      featureSlug: String(b.featureSlug).trim(),
      featureLabel,
      description,
      scopeType,
      scopeId: scopeType === "global" ? null : (b.scopeId != null ? Number(b.scopeId) : null),
      pricingMode: String(b.pricingMode ?? "fixed"),
      unitType: String(b.unitType ?? "request"),
      creditsPerUnit: String(b.creditsPerUnit ?? "1"),
      minCharge,
      maxPerRequest: b.maxPerRequest != null ? Number(b.maxPerRequest) : null,
      freeMonthlyQuota,
      isActive: b.isActive !== false,
      notes: b.notes ?? null,
      createdBy: req.user?.sub ?? null,
    }).returning();
    await recordAuditLog({ req, module: MODULE, action: "rule.create", entity: "ai_credit_rule", entityId: row.id, newValue: row });
    res.status(201).json(shapeRule(row));
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return void res.status(409).json({ error: "A rule for this feature & scope already exists" });
    throw err;
  }
});

router.patch("/admin/ai/credit-rules/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [old] = await db.select().from(aiFeatureCreditRulesTable).where(eq(aiFeatureCreditRulesTable.id, id));
  if (!old) return void res.status(404).json({ error: "Not found" });
  const b = req.body ?? {};
  const update: Partial<typeof aiFeatureCreditRulesTable.$inferInsert> = { updatedAt: new Date() };
  if (b.featureLabel != null || b.label != null) update.featureLabel = String(b.featureLabel ?? b.label).trim();
  if (b.description !== undefined) update.description = b.description ?? null;
  if (b.unitType != null) update.unitType = String(b.unitType);
  if (b.pricingMode != null) update.pricingMode = String(b.pricingMode);
  if (b.creditsPerUnit != null) update.creditsPerUnit = String(b.creditsPerUnit);
  if (b.minCharge != null || b.minimumCredits != null) update.minCharge = Number(b.minCharge ?? b.minimumCredits);
  if (b.maxPerRequest !== undefined) update.maxPerRequest = b.maxPerRequest != null ? Number(b.maxPerRequest) : null;
  if (b.freeMonthlyQuota != null || b.freeAllowancePerMonth != null) {
    update.freeMonthlyQuota = Number(b.freeMonthlyQuota ?? b.freeAllowancePerMonth);
  }
  if (b.isActive != null) update.isActive = !!b.isActive;
  if (b.notes !== undefined) update.notes = b.notes ?? null;
  const [row] = await db.update(aiFeatureCreditRulesTable).set(update).where(eq(aiFeatureCreditRulesTable.id, id)).returning();
  await recordAuditLog({ req, module: MODULE, action: "rule.update", entity: "ai_credit_rule", entityId: id, oldValue: old, newValue: row });
  res.json(shapeRule(row));
});

router.delete("/admin/ai/credit-rules/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [old] = await db.select().from(aiFeatureCreditRulesTable).where(eq(aiFeatureCreditRulesTable.id, id));
  if (!old) return void res.status(404).json({ error: "Not found" });
  await db.delete(aiFeatureCreditRulesTable).where(eq(aiFeatureCreditRulesTable.id, id));
  await recordAuditLog({ req, module: MODULE, action: "rule.delete", entity: "ai_credit_rule", entityId: id, oldValue: old });
  res.json({ ok: true });
});

// ─── Plan default credits ────────────────────────────────────────────────────
// Per-subscription-plan defaults that govern how many AI credits each tenant
// on that plan is granted each month (`aiMonthlyIncludedCredits`), plus the
// plan-level AI toggle and the daily request cap. Used by the admin AI center
// "Plan Credits" tab so super-admins can dial these knobs without editing
// every plan record manually.

router.get("/admin/ai/plan-credits", async (_req: Request, res: Response) => {
  const rows = await db.select({
    id: subscriptionPlansTable.id,
    name: subscriptionPlansTable.name,
    slug: subscriptionPlansTable.slug,
    price: subscriptionPlansTable.price,
    currency: subscriptionPlansTable.currency,
    billingPeriod: subscriptionPlansTable.billingPeriod,
    isActive: subscriptionPlansTable.isActive,
    aiEnabled: subscriptionPlansTable.aiEnabled,
    aiMonthlyIncludedCredits: subscriptionPlansTable.aiMonthlyIncludedCredits,
    aiDailyRequestCap: subscriptionPlansTable.aiDailyRequestCap,
  }).from(subscriptionPlansTable).orderBy(subscriptionPlansTable.price);
  res.json({ rows });
});

router.patch("/admin/ai/plan-credits/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [old] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, id));
  if (!old) return void res.status(404).json({ error: "Plan not found" });
  const b = req.body ?? {};
  const update: Partial<typeof subscriptionPlansTable.$inferInsert> = { updatedAt: new Date() };
  if (b.aiEnabled != null) update.aiEnabled = !!b.aiEnabled;
  if (b.aiMonthlyIncludedCredits != null) {
    const n = Number(b.aiMonthlyIncludedCredits);
    if (!Number.isFinite(n) || n < 0) return void res.status(400).json({ error: "aiMonthlyIncludedCredits must be a non-negative number" });
    update.aiMonthlyIncludedCredits = Math.floor(n);
  }
  if (b.aiDailyRequestCap != null) {
    const n = Number(b.aiDailyRequestCap);
    if (!Number.isFinite(n) || n < 0) return void res.status(400).json({ error: "aiDailyRequestCap must be a non-negative number" });
    update.aiDailyRequestCap = Math.floor(n);
  }
  const [row] = await db.update(subscriptionPlansTable).set(update).where(eq(subscriptionPlansTable.id, id)).returning();
  await recordAuditLog({
    req, module: MODULE, action: "plan_credits.update", entity: "subscription_plan", entityId: id,
    oldValue: { aiEnabled: old.aiEnabled, aiMonthlyIncludedCredits: old.aiMonthlyIncludedCredits, aiDailyRequestCap: old.aiDailyRequestCap },
    newValue: { aiEnabled: row.aiEnabled, aiMonthlyIncludedCredits: row.aiMonthlyIncludedCredits, aiDailyRequestCap: row.aiDailyRequestCap },
  });
  res.json({
    id: row.id, name: row.name, slug: row.slug, price: row.price, currency: row.currency,
    billingPeriod: row.billingPeriod, isActive: row.isActive,
    aiEnabled: row.aiEnabled,
    aiMonthlyIncludedCredits: row.aiMonthlyIncludedCredits,
    aiDailyRequestCap: row.aiDailyRequestCap,
  });
});

// ─── Recharge Packages ───────────────────────────────────────────────────────

router.get("/admin/ai/recharge-packages", async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const [rows, totalRow] = await Promise.all([
    db.select().from(aiRechargePackagesTable).orderBy(aiRechargePackagesTable.sortOrder, aiRechargePackagesTable.price).limit(limit).offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(aiRechargePackagesTable),
  ]);
  res.json({ rows, total: Number(totalRow[0]?.c ?? 0), limit, offset });
});
// schema already exposes isFeatured & showToRestaurants — UI consumes both.

router.post("/admin/ai/recharge-packages", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  if (!b.slug || !b.name || !b.credits || !b.price) {
    return void res.status(400).json({ error: "slug, name, credits and price are required" });
  }
  try {
    const [row] = await db.insert(aiRechargePackagesTable).values({
      slug: String(b.slug).trim(),
      name: String(b.name).trim(),
      description: b.description ?? null,
      credits: Number(b.credits),
      bonusCredits: Number(b.bonusCredits ?? 0),
      price: String(b.price),
      currency: String(b.currency ?? "INR").toUpperCase(),
      validityDays: b.validityDays != null ? Number(b.validityDays) : null,
      isActive: b.isActive !== false,
      isFeatured: !!b.isFeatured,
      showToRestaurants: b.showToRestaurants !== false,
      sortOrder: Number(b.sortOrder ?? 0),
      createdBy: req.user?.sub ?? null,
    }).returning();
    await recordAuditLog({ req, module: MODULE, action: "package.create", entity: "ai_recharge_package", entityId: row.id, newValue: row });
    res.status(201).json(row);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return void res.status(409).json({ error: "Slug already exists" });
    throw err;
  }
});

router.patch("/admin/ai/recharge-packages/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [old] = await db.select().from(aiRechargePackagesTable).where(eq(aiRechargePackagesTable.id, id));
  if (!old) return void res.status(404).json({ error: "Not found" });
  const b = req.body ?? {};
  const update: Partial<typeof aiRechargePackagesTable.$inferInsert> = { updatedAt: new Date() };
  if (b.name != null) update.name = String(b.name).trim();
  if (b.description !== undefined) update.description = b.description ?? null;
  if (b.credits != null) update.credits = Number(b.credits);
  if (b.bonusCredits != null) update.bonusCredits = Number(b.bonusCredits);
  if (b.price != null) update.price = String(b.price);
  if (b.currency != null) update.currency = String(b.currency).toUpperCase();
  if (b.validityDays !== undefined) update.validityDays = b.validityDays != null ? Number(b.validityDays) : null;
  if (b.isActive != null) update.isActive = !!b.isActive;
  if (b.isFeatured != null) update.isFeatured = !!b.isFeatured;
  if (b.showToRestaurants != null) update.showToRestaurants = !!b.showToRestaurants;
  if (b.sortOrder != null) update.sortOrder = Number(b.sortOrder);
  const [row] = await db.update(aiRechargePackagesTable).set(update).where(eq(aiRechargePackagesTable.id, id)).returning();
  await recordAuditLog({ req, module: MODULE, action: "package.update", entity: "ai_recharge_package", entityId: id, oldValue: old, newValue: row });
  res.json(row);
});

router.delete("/admin/ai/recharge-packages/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [old] = await db.select().from(aiRechargePackagesTable).where(eq(aiRechargePackagesTable.id, id));
  if (!old) return void res.status(404).json({ error: "Not found" });
  await db.delete(aiRechargePackagesTable).where(eq(aiRechargePackagesTable.id, id));
  await recordAuditLog({ req, module: MODULE, action: "package.delete", entity: "ai_recharge_package", entityId: id, oldValue: old });
  res.json({ ok: true });
});

// ─── Wallets ─────────────────────────────────────────────────────────────────

/** Compute lifetime purchased credits per wallet by summing recharge transactions. */
async function lifetimePurchasedByWallet(walletIds: number[]): Promise<Record<number, number>> {
  if (walletIds.length === 0) return {};
  const rows = await db.select({
    walletId: aiCreditTransactionsTable.walletId,
    total: sql<number>`coalesce(sum(${aiCreditTransactionsTable.credits}), 0)::int`,
  }).from(aiCreditTransactionsTable)
    .where(and(
      eq(aiCreditTransactionsTable.type, "recharge"),
      sql`${aiCreditTransactionsTable.walletId} = ANY(${sql.raw(`ARRAY[${walletIds.join(",")}]::int[]`)})`,
    ))
    .groupBy(aiCreditTransactionsTable.walletId);
  const map: Record<number, number> = {};
  for (const r of rows) map[r.walletId] = Number(r.total) || 0;
  return map;
}

function shapeWalletRow(row: {
  tenantId: number; tenantName: string | null; planStatus: string | null; planName: string | null; aiEnabled: boolean | null;
  walletId: number | null;
  monthlyIncludedCredits: number | null; purchasedCredits: number | null; bonusCredits: number | null;
  reservedCredits: number | null; usedCredits: number | null; isBlocked: boolean | null;
  betaFeatures: string[] | null; purchasedExpiresAt: Date | null; updatedAt: Date | null;
}, lifetimePurchased: number) {
  const monthly = row.monthlyIncludedCredits ?? 0;
  const purchased = row.purchasedCredits ?? 0;
  const bonus = row.bonusCredits ?? 0;
  const reserved = row.reservedCredits ?? 0;
  return {
    walletId: row.walletId, tenantId: row.tenantId, tenantName: row.tenantName,
    planStatus: row.planStatus, planName: row.planName, aiEnabled: !!row.aiEnabled,
    balance: Math.max(0, monthly + bonus + purchased - reserved),
    monthlyBalance: monthly, purchasedBalance: purchased, bonusBalance: bonus,
    reservedCredits: reserved,
    lifetimeCreditsUsed: row.usedCredits ?? 0,
    lifetimeCreditsPurchased: lifetimePurchased,
    isBlocked: !!row.isBlocked,
    betaFeatures: row.betaFeatures ?? [],
    purchasedExpiresAt: row.purchasedExpiresAt,
    updatedAt: row.updatedAt,
  };
}

router.get("/admin/ai/wallets", async (req: Request, res: Response) => {
  const search = String(req.query.search ?? "").trim();
  const where = search
    ? like(sql`lower(${tenantsTable.name})`, `%${search.toLowerCase()}%`)
    : undefined;

  const rows = await db.select({
    tenantId: tenantsTable.id,
    tenantName: tenantsTable.name,
    planStatus: tenantsTable.planStatus,
    planName: subscriptionPlansTable.name,
    aiEnabled: subscriptionPlansTable.aiEnabled,
    walletId: aiCreditWalletsTable.id,
    monthlyIncludedCredits: aiCreditWalletsTable.monthlyIncludedCredits,
    purchasedCredits: aiCreditWalletsTable.purchasedCredits,
    bonusCredits: aiCreditWalletsTable.bonusCredits,
    reservedCredits: aiCreditWalletsTable.reservedCredits,
    usedCredits: aiCreditWalletsTable.usedCredits,
    isBlocked: aiCreditWalletsTable.isBlocked,
    betaFeatures: aiCreditWalletsTable.betaFeatures,
    purchasedExpiresAt: aiCreditWalletsTable.purchasedExpiresAt,
    updatedAt: aiCreditWalletsTable.updatedAt,
  }).from(tenantsTable)
    .leftJoin(aiCreditWalletsTable, eq(aiCreditWalletsTable.tenantId, tenantsTable.id))
    .leftJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, tenantsTable.planId))
    .where(where)
    .orderBy(tenantsTable.name)
    .limit(200);

  const walletIds = rows.map(r => r.walletId).filter((x): x is number => typeof x === "number");
  const lifetimeMap = await lifetimePurchasedByWallet(walletIds);

  res.json(rows.map(r => shapeWalletRow(r, r.walletId ? (lifetimeMap[r.walletId] ?? 0) : 0)));
});

router.get("/admin/ai/wallets/:tenantId", async (req: Request, res: Response) => {
  const tenantId = Number(req.params.tenantId);
  const [tenant] = await db.select({
    id: tenantsTable.id, name: tenantsTable.name, planId: tenantsTable.planId, planStatus: tenantsTable.planStatus,
    planName: subscriptionPlansTable.name,
    aiEnabled: subscriptionPlansTable.aiEnabled,
    aiMonthlyIncludedCredits: subscriptionPlansTable.aiMonthlyIncludedCredits,
    aiDailyRequestCap: subscriptionPlansTable.aiDailyRequestCap,
  }).from(tenantsTable)
    .leftJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, tenantsTable.planId))
    .where(eq(tenantsTable.id, tenantId));
  if (!tenant) return void res.status(404).json({ error: "Tenant not found" });

  const wallet = await getOrCreateWallet(tenantId);
  const transactions = await listTransactions(wallet.id, 100);
  const allocations = await db.select().from(aiMonthlyAllocationsTable)
    .where(eq(aiMonthlyAllocationsTable.tenantId, tenantId))
    .orderBy(desc(aiMonthlyAllocationsTable.periodStart)).limit(12);
  const lifetimeMap = await lifetimePurchasedByWallet([wallet.id]);
  const rechargePackages = await db.select().from(aiRechargePackagesTable)
    .where(eq(aiRechargePackagesTable.isActive, true))
    .orderBy(aiRechargePackagesTable.sortOrder, aiRechargePackagesTable.price);

  const walletRow = shapeWalletRow({
    tenantId, tenantName: tenant.name, planStatus: tenant.planStatus, planName: tenant.planName,
    aiEnabled: tenant.aiEnabled, walletId: wallet.id,
    monthlyIncludedCredits: wallet.monthlyIncludedCredits, purchasedCredits: wallet.purchasedCredits,
    bonusCredits: wallet.bonusCredits, reservedCredits: wallet.reservedCredits,
    usedCredits: wallet.usedCredits, isBlocked: wallet.isBlocked,
    betaFeatures: wallet.betaFeatures, purchasedExpiresAt: wallet.purchasedExpiresAt,
    updatedAt: wallet.updatedAt,
  }, lifetimeMap[wallet.id] ?? 0);

  res.json({
    tenant,
    wallet: walletRow,
    recentTransactions: transactions.map(t => ({
      id: t.id, createdAt: t.createdAt, type: t.type,
      featureSlug: t.featureSlug, creditsDelta: String(t.credits),
      description: t.notes,
    })),
    rechargePackages,
    allocations,
  });
});

router.post("/admin/ai/wallets/:tenantId/adjust", async (req: Request, res: Response) => {
  const tenantId = Number(req.params.tenantId);
  const b = req.body ?? {};
  const bucket = String(b.bucket ?? "bonus");
  // Accept both `delta`/`reason` and the UI's `credits`/`description` aliases.
  const delta = Number(b.delta ?? b.credits);
  const reason = String(b.reason ?? b.description ?? "").trim();
  if (!["monthly", "bonus", "purchased"].includes(bucket)) return void res.status(400).json({ error: "Invalid bucket" });
  if (!Number.isFinite(delta) || delta === 0) return void res.status(400).json({ error: "delta (or credits) must be a non-zero number" });
  if (!reason) return void res.status(400).json({ error: "reason (or description) is required" });

  const expiresAt = b.expiresAt ? new Date(b.expiresAt) : undefined;
  const updated = await adjustWallet({
    tenantId, bucket: bucket as "monthly" | "bonus" | "purchased",
    delta, reason, adminUserId: req.user?.sub ?? null, expiresAt,
  });
  await recordAuditLog({
    req, module: MODULE, action: "wallet.adjust", entity: "ai_credit_wallet", entityId: updated.id,
    newValue: { tenantId, bucket, delta, reason, expiresAt },
  });
  // Notify the tenant owner that their AI credit balance was adjusted by a
  // super-admin. Positive deltas use `ai_credits_added`; negatives use
  // `ai_credits_exhausted` only when the bucket is now zero, otherwise we
  // skip (a quiet reduction shouldn't ping the owner unless it bottoms out).
  try {
    const [owner] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.role, "owner")))
      .limit(1);
    const [tenantRow] = await db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    const restaurantName = tenantRow?.name ?? "your restaurant";
    const rechargeUrl = `${(process.env.PUBLIC_APP_URL ?? "https://khanalagao.app").replace(/\/$/, "")}/settings/ai-credits`;
    if (owner?.email) {
      const balance = summarizeWallet(updated);
      if (delta > 0) {
        void sendByTemplateKey("ai_credits_added", owner.email, {
          name: owner.name ?? owner.email,
          credits: String(delta),
          bucket,
          reason,
          balance: String(balance.available ?? balance.bonus ?? 0),
          restaurant: restaurantName,
          appName: "Khana Lagao",
        }, { tenantId, recipientType: "user" });
      } else if (delta < 0 && Number(balance.available ?? 0) <= 0) {
        void sendByTemplateKey("ai_credits_exhausted", owner.email, {
          name: owner.name ?? owner.email,
          restaurant: restaurantName,
          rechargeUrl,
          appName: "Khana Lagao",
        }, { tenantId, recipientType: "user" });
      }
    }
  } catch (err) {
    logger.warn({ err, tenantId }, "ai_credits_added/exhausted email skipped");
  }
  res.json({ wallet: updated, balance: summarizeWallet(updated) });
});

router.post("/admin/ai/wallets/:tenantId/block", async (req: Request, res: Response) => {
  const tenantId = Number(req.params.tenantId);
  const isBlocked = !!req.body?.isBlocked;
  const reason = (req.body?.reason as string | undefined) ?? null;
  const updated = await setWalletBlocked(tenantId, isBlocked, reason, req.user?.sub ?? null);
  await recordAuditLog({
    req, module: MODULE, action: isBlocked ? "wallet.block" : "wallet.unblock",
    entity: "ai_credit_wallet", entityId: updated.id, newValue: { tenantId, reason },
  });
  res.json({ wallet: updated, balance: summarizeWallet(updated) });
});

router.post("/admin/ai/wallets/:tenantId/beta-features", async (req: Request, res: Response) => {
  const tenantId = Number(req.params.tenantId);
  const features = Array.isArray(req.body?.betaFeatures) ? req.body.betaFeatures.map((f: unknown) => String(f)) : [];
  const updated = await setWalletBetaFeatures(tenantId, features, req.user?.sub ?? null);
  await recordAuditLog({
    req, module: MODULE, action: "wallet.beta_change", entity: "ai_credit_wallet", entityId: updated.id,
    newValue: { tenantId, features },
  });
  res.json({ wallet: updated });
});

router.post("/admin/ai/wallets/:tenantId/recharge", async (req: Request, res: Response) => {
  const tenantId = Number(req.params.tenantId);
  const packageId = Number(req.body?.packageId);
  if (!packageId) return void res.status(400).json({ error: "packageId is required" });
  const result = await applyRecharge({
    tenantId, packageId, adminUserId: req.user?.sub ?? null,
    notes: `Manual recharge by super-admin`,
  });
  await recordAuditLog({
    req, module: MODULE, action: "wallet.manual_recharge", entity: "ai_credit_wallet", entityId: result.wallet.id,
    newValue: { tenantId, packageId, creditsAdded: result.creditsAdded, bonusAdded: result.bonusAdded },
  });
  // Notify the tenant owner of the recharge so they see the new balance
  // reflected in their inbox via the Super-Admin-editable
  // `ai_credits_recharged` template.
  try {
    const [owner] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.role, "owner")))
      .limit(1);
    const [tenantRow] = await db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    const [pkgRow] = await db.select({ name: aiRechargePackagesTable.name })
      .from(aiRechargePackagesTable).where(eq(aiRechargePackagesTable.id, packageId));
    if (owner?.email) {
      void sendByTemplateKey("ai_credits_recharged", owner.email, {
        name: owner.name ?? owner.email,
        credits: String(result.creditsAdded ?? 0),
        bonus: String(result.bonusAdded ?? 0),
        balance: String(summarizeWallet(result.wallet).available ?? 0),
        packageName: pkgRow?.name ?? "Recharge",
        restaurant: tenantRow?.name ?? "your restaurant",
        appName: "Khana Lagao",
      }, { tenantId, recipientType: "user" });
    }
  } catch (err) {
    logger.warn({ err, tenantId }, "ai_credits_recharged email skipped");
  }
  res.json({ wallet: result.wallet, balance: summarizeWallet(result.wallet) });
});

router.post("/admin/ai/wallets/:tenantId/allocate-monthly", async (req: Request, res: Response) => {
  const tenantId = Number(req.params.tenantId);
  // Idempotent on (tenantId, current renewal-cycle periodStart) — safe to call any time.
  const r = await creditMonthlyAllocation(tenantId);
  await recordAuditLog({
    req, module: MODULE, action: "wallet.allocate_monthly", entity: "tenant", entityId: tenantId,
    newValue: r,
  });
  res.json(r);
});

// ─── Aggregate ledger (audit-style read-only) ────────────────────────────────

router.get("/admin/ai/ledger", async (req: Request, res: Response) => {
  const limit = Math.min(500, Math.max(10, Number(req.query.limit ?? 100)));
  const filters = [] as Array<ReturnType<typeof eq>>;
  if (req.query.tenantId) filters.push(eq(aiCreditTransactionsTable.tenantId, Number(req.query.tenantId)));
  if (req.query.type) filters.push(eq(aiCreditTransactionsTable.type, String(req.query.type)));
  if (req.query.featureSlug) filters.push(eq(aiCreditTransactionsTable.featureSlug, String(req.query.featureSlug)));
  const whereClause = filters.length ? and(...filters) : undefined;
  const rows = await db.select({
    id: aiCreditTransactionsTable.id,
    walletId: aiCreditTransactionsTable.walletId,
    tenantId: aiCreditTransactionsTable.tenantId,
    tenantName: tenantsTable.name,
    type: aiCreditTransactionsTable.type,
    featureSlug: aiCreditTransactionsTable.featureSlug,
    credits: aiCreditTransactionsTable.credits,
    bucket: aiCreditTransactionsTable.bucket,
    balanceAfter: aiCreditTransactionsTable.balanceAfter,
    notes: aiCreditTransactionsTable.notes,
    createdBy: aiCreditTransactionsTable.createdBy,
    createdByEmail: usersTable.email,
    createdAt: aiCreditTransactionsTable.createdAt,
  }).from(aiCreditTransactionsTable)
    .leftJoin(tenantsTable, eq(tenantsTable.id, aiCreditTransactionsTable.tenantId))
    .leftJoin(usersTable, eq(usersTable.id, aiCreditTransactionsTable.createdBy))
    .where(whereClause)
    .orderBy(desc(aiCreditTransactionsTable.createdAt))
    .limit(limit);
  // UI-friendly aliases on top of the raw transaction shape.
  res.json(rows.map(r => ({
    ...r,
    creditsDelta: String(r.credits),
    description: r.notes,
    pricePaid: null, // gateway price is tracked on ai_credit_recharges, not per-transaction
  })));
});

export default router;
