import { Router } from "express";
import crypto from "crypto";
import { eq, desc, asc, count, and, or, ilike, sql, type SQL } from "drizzle-orm";
import { db, subscriptionPlansTable, tenantsTable, usersTable, PLAN_BOOLEAN_FEATURE_KEYS, defaultFeatureFlags } from "../lib/db";
import { requireSuperAdmin, requireRole } from "../middleware/authorize";
import { sendLifecycleSms } from "../lib/smsSender";
import { hashPassword, signResetToken, signImpersonationToken } from "../lib/auth";
import { sendEmail } from "../lib/notifications";
import { sendByTemplateKey } from "../lib/emailSender";
import { logger } from "../lib/logger";
import { recordAuditLog } from "../lib/audit";

const router = Router();

const ALLOWED_CURRENCIES = ["INR", "USD"] as const;
type Currency = (typeof ALLOWED_CURRENCIES)[number];

router.get("/subscription-plans", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (_req, res) => {
  const plans = await db.select().from(subscriptionPlansTable).orderBy(subscriptionPlansTable.price);
  res.json(plans);
});

router.get("/subscription-plans/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, Number(req.params.id)));
  if (!plan) return void res.status(404).json({ error: "Not found" });
  res.json(plan);
});

// ─── Plans CRUD (super-admin only) ────────────────────────────────
function validatePlanInput(body: Record<string, unknown>, partial = false): { error?: string; data?: Record<string, unknown> } {
  const out: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) return { error: "name is required" };
    out.name = body.name.trim();
  }
  if (!partial || body.slug !== undefined) {
    if (typeof body.slug !== "string" || !/^[a-z0-9-]+$/.test(body.slug)) return { error: "slug must be lowercase alphanumeric/hyphen" };
    out.slug = body.slug;
  }
  if (!partial || body.price !== undefined) {
    const n = Number(body.price);
    if (!isFinite(n) || n < 0) return { error: "price must be a non-negative number" };
    out.price = n.toFixed(2);
  }
  if (!partial || body.currency !== undefined) {
    const c = String(body.currency ?? "INR").toUpperCase();
    if (!ALLOWED_CURRENCIES.includes(c as Currency)) return { error: `currency must be one of ${ALLOWED_CURRENCIES.join(", ")}` };
    out.currency = c;
  }
  if (body.billingPeriod !== undefined) {
    if (!["monthly", "yearly"].includes(String(body.billingPeriod))) return { error: "billingPeriod must be monthly or yearly" };
    out.billingPeriod = body.billingPeriod;
  }
  if (body.yearlyPrice !== undefined) {
    if (body.yearlyPrice === null || body.yearlyPrice === "") {
      out.yearlyPrice = null;
    } else {
      const n = Number(body.yearlyPrice);
      if (!isFinite(n) || n < 0) return { error: "yearlyPrice must be a non-negative number or null" };
      out.yearlyPrice = n.toFixed(2);
    }
  }
  for (const k of ["stripeMonthlyPriceId", "stripeYearlyPriceId", "cashfreeMonthlyPlanId", "cashfreeYearlyPlanId"] as const) {
    if (body[k] !== undefined) {
      if (body[k] === null || body[k] === "") {
        out[k] = null;
      } else if (typeof body[k] !== "string") {
        return { error: `${k} must be a string or null` };
      } else {
        out[k] = String(body[k]).trim().slice(0, 200) || null;
      }
    }
  }
  for (const k of ["maxRestaurants", "maxBranches", "maxStaff", "maxTables", "maxMenuItems", "trialDays"] as const) {
    if (body[k] !== undefined) {
      const n = Number(body[k]);
      if (!Number.isInteger(n) || n < 0) return { error: `${k} must be a non-negative integer` };
      out[k] = n;
    }
  }
  if (body.features !== undefined) {
    if (!Array.isArray(body.features) || body.features.some(f => typeof f !== "string")) return { error: "features must be string[]" };
    out.features = body.features;
  }
  if (body.featureFlags !== undefined) {
    if (!body.featureFlags || typeof body.featureFlags !== "object" || Array.isArray(body.featureFlags)) {
      return { error: "featureFlags must be an object of { [key]: boolean }" };
    }
    const cleaned: Record<string, boolean> = {};
    for (const k of PLAN_BOOLEAN_FEATURE_KEYS) {
      const v = (body.featureFlags as Record<string, unknown>)[k];
      if (typeof v === "boolean") cleaned[k] = v;
    }
    out.featureFlags = cleaned;
  } else if (!partial) {
    // New plan with no flags supplied → seed catalogue defaults so the
    // structured grid in the admin UI doesn't show "missing" everywhere.
    out.featureFlags = defaultFeatureFlags();
  }
  if (body.isActive !== undefined) out.isActive = Boolean(body.isActive);

  // ─── Khana AI plan settings ────────────────────────────────────────────────
  if (body.aiEnabled !== undefined) out.aiEnabled = Boolean(body.aiEnabled);
  if (body.aiMonthlyIncludedCredits !== undefined) {
    const n = Number(body.aiMonthlyIncludedCredits);
    if (!Number.isInteger(n) || n < 0) return { error: "aiMonthlyIncludedCredits must be a non-negative integer" };
    out.aiMonthlyIncludedCredits = n;
  }
  if (body.aiDailyRequestCap !== undefined) {
    const n = Number(body.aiDailyRequestCap ?? 0);
    if (!Number.isInteger(n) || n < 0) return { error: "aiDailyRequestCap must be a non-negative integer (0 = unlimited)" };
    out.aiDailyRequestCap = n;
  }
  if (body.aiPerFeatureMonthlyCaps !== undefined) {
    const v = body.aiPerFeatureMonthlyCaps ?? {};
    if (typeof v !== "object" || Array.isArray(v)) {
      return { error: "aiPerFeatureMonthlyCaps must be an object of { [featureSlug]: number }" };
    }
    const cleaned: Record<string, number> = {};
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) return { error: `aiPerFeatureMonthlyCaps.${k} must be a non-negative integer` };
      cleaned[String(k)] = n;
    }
    out.aiPerFeatureMonthlyCaps = cleaned;
  }
  if (body.aiFeatureToggles !== undefined) {
    const v = body.aiFeatureToggles ?? {};
    if (typeof v !== "object" || Array.isArray(v)) {
      return { error: "aiFeatureToggles must be an object of { [featureSlug]: boolean }" };
    }
    const cleaned: Record<string, boolean> = {};
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
      if (typeof raw !== "boolean") return { error: `aiFeatureToggles.${k} must be boolean` };
      cleaned[String(k)] = raw;
    }
    out.aiFeatureToggles = cleaned;
  }
  return { data: out };
}

router.post("/subscription-plans", requireSuperAdmin, async (req, res) => {
  const v = validatePlanInput(req.body);
  if (v.error || !v.data) return void res.status(400).json({ error: v.error });
  const [existing] = await db.select({ id: subscriptionPlansTable.id }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.slug, String(v.data.slug)));
  if (existing) return void res.status(409).json({ error: "A plan with this slug already exists" });
  const [plan] = await db.insert(subscriptionPlansTable).values(v.data as typeof subscriptionPlansTable.$inferInsert).returning();
  await recordAuditLog({
    req, module: "billing", action: "plan.create", entity: "subscription_plan",
    entityId: plan.id, newValue: { name: plan.name, slug: plan.slug, price: plan.price },
  });
  res.status(201).json(plan);
});

router.patch("/subscription-plans/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const v = validatePlanInput(req.body, true);
  if (v.error || !v.data) return void res.status(400).json({ error: v.error });
  if (typeof v.data.slug === "string") {
    const [clash] = await db.select({ id: subscriptionPlansTable.id })
      .from(subscriptionPlansTable)
      .where(and(eq(subscriptionPlansTable.slug, v.data.slug), sql`${subscriptionPlansTable.id} <> ${id}`));
    if (clash) return void res.status(409).json({ error: "Another plan already uses this slug." });
  }
  const [updated] = await db.update(subscriptionPlansTable)
    .set({ ...v.data, updatedAt: new Date() })
    .where(eq(subscriptionPlansTable.id, id))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req, module: "billing", action: "plan.update", entity: "subscription_plan",
    entityId: id, newValue: v.data,
  });
  res.json(updated);
});

router.post("/subscription-plans/:id/toggle-active", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, id));
  if (!plan) return void res.status(404).json({ error: "Not found" });
  const [updated] = await db.update(subscriptionPlansTable)
    .set({ isActive: !plan.isActive, updatedAt: new Date() })
    .where(eq(subscriptionPlansTable.id, id))
    .returning();
  await recordAuditLog({
    req, module: "billing", action: "plan.toggle_active", entity: "subscription_plan",
    entityId: id, oldValue: { isActive: plan.isActive }, newValue: { isActive: updated.isActive },
  });
  res.json(updated);
});

router.delete("/subscription-plans/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const [{ c }] = await db.select({ c: count() }).from(tenantsTable).where(eq(tenantsTable.planId, id));
  if (Number(c) > 0) {
    return void res.status(409).json({ error: `This plan is in use by ${c} tenant(s). Reassign or delete those tenants first.` });
  }
  const [removed] = await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, id)).returning();
  if (!removed) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "billing", action: "plan.delete", entity: "subscription_plan", entityId: id });
  res.status(204).end();
});

// ─── Tenants ──────────────────────────────────────────────────────
const SORTABLE_TENANT_COLUMNS = {
  name: tenantsTable.name,
  createdAt: tenantsTable.createdAt,
  trialEndsAt: tenantsTable.trialEndsAt,
  planStatus: tenantsTable.planStatus,
  // "plan" sorts by the joined plan name; falls back to NULL-last via the
  // secondary sort by id below.
  plan: subscriptionPlansTable.name,
} as const;
type SortableTenantColumn = keyof typeof SORTABLE_TENANT_COLUMNS;

router.get("/tenants", requireSuperAdmin, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const planIdRaw = req.query.planId;
  const sortByRaw = typeof req.query.sortBy === "string" ? req.query.sortBy : "createdAt";
  const sortDirRaw = typeof req.query.sortDir === "string" ? req.query.sortDir.toLowerCase() : "desc";
  const sortBy: SortableTenantColumn = (sortByRaw in SORTABLE_TENANT_COLUMNS)
    ? (sortByRaw as SortableTenantColumn) : "createdAt";
  const sortDir = sortDirRaw === "asc" ? "asc" : "desc";

  const conds: SQL[] = [];
  if (search) {
    const term = `%${search}%`;
    // Match across tenant name/slug AND owner name/email/phone.
    // Use a correlated EXISTS so we don't have to GROUP/DISTINCT the outer query.
    conds.push(
      or(
        ilike(tenantsTable.name, term),
        ilike(tenantsTable.slug, term),
        sql`EXISTS (
          SELECT 1 FROM ${usersTable} u
          WHERE u.tenant_id = ${tenantsTable.id}
            AND (u.name ILIKE ${term} OR u.email ILIKE ${term} OR u.phone ILIKE ${term})
        )`,
      )!,
    );
  }
  if (status === "trial" || status === "active" || status === "expired" || status === "cancelled") {
    conds.push(eq(tenantsTable.planStatus, status));
    // "active" and other live statuses exclude suspended tenants for clarity.
    if (status !== "cancelled" && status !== "expired") {
      conds.push(eq(tenantsTable.isSuspended, false));
    }
  } else if (status === "suspended") {
    conds.push(eq(tenantsTable.isSuspended, true));
  }
  if (planIdRaw !== undefined && planIdRaw !== "") {
    const pid = Number(planIdRaw);
    if (!isNaN(pid)) conds.push(eq(tenantsTable.planId, pid));
  }

  const where = conds.length ? and(...conds) : undefined;
  const sortCol = SORTABLE_TENANT_COLUMNS[sortBy];
  const orderExpr = sortDir === "asc" ? asc(sortCol) : desc(sortCol);
  // Stable secondary sort by id so paging is deterministic when the sort key has ties.
  const orderById = sortDir === "asc" ? asc(tenantsTable.id) : desc(tenantsTable.id);

  // When sorting by plan name we need to LEFT JOIN subscription_plans;
  // for other sorts we keep the simpler tenants-only query.
  const needsPlanJoin = sortBy === "plan";
  const listQuery = needsPlanJoin
    ? db.select({ tenant: tenantsTable })
        .from(tenantsTable)
        .leftJoin(subscriptionPlansTable, eq(tenantsTable.planId, subscriptionPlansTable.id))
        .where(where)
        .orderBy(orderExpr, orderById)
        .limit(limit)
        .offset(offset)
    : db.select().from(tenantsTable).where(where).orderBy(orderExpr, orderById).limit(limit).offset(offset);

  const [rowsRaw, totalRows] = await Promise.all([
    listQuery,
    db.select({ count: count() }).from(tenantsTable).where(where),
  ]);
  const rows = needsPlanJoin
    ? (rowsRaw as Array<{ tenant: typeof tenantsTable.$inferSelect }>).map((r) => r.tenant)
    : (rowsRaw as Array<typeof tenantsTable.$inferSelect>);
  res.json({ data: rows, tenants: rows, total: Number(totalRows[0]?.count ?? 0), page, limit, sortBy, sortDir });
});

router.post("/tenants", requireSuperAdmin, async (req, res) => {
  const { name, slug, planId, primaryColor, logoUrl, ownerEmail, ownerName } = req.body as {
    name?: string; slug?: string; planId?: number; primaryColor?: string; logoUrl?: string;
    ownerEmail?: string; ownerName?: string;
  };
  if (!name?.trim() || !slug?.trim()) return void res.status(400).json({ error: "name and slug are required" });
  if (!/^[a-z0-9-]+$/.test(slug)) return void res.status(400).json({ error: "slug must be lowercase alphanumeric/hyphen" });

  const [existing] = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.slug, slug));
  if (existing) return void res.status(409).json({ error: "A tenant with this slug already exists" });

  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const [tenant] = await db.insert(tenantsTable).values({
    name: name.trim(), slug, planId: planId ?? null, primaryColor: primaryColor ?? "#f97316",
    logoUrl: logoUrl ?? null, planStatus: "trial", trialEndsAt,
  }).returning();

  let ownerInviteStatus: "sent" | "skipped_existing_email" | "not_requested" = "not_requested";
  if (ownerEmail) {
    const [emailExists] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, ownerEmail));
    if (emailExists) {
      ownerInviteStatus = "skipped_existing_email";
    }
    if (!emailExists) {
      // Provision the user with a random unguessable password hash; the user
      // sets their real password via the reset-token link emailed to them.
      const placeholder = crypto.randomBytes(32).toString("hex");
      const passwordHash = await hashPassword(placeholder);
      const [newUser] = await db.insert(usersTable).values({
        name: ownerName ?? name.trim() + " Owner",
        email: ownerEmail,
        passwordHash,
        role: "owner",
        tenantId: tenant.id,
      }).returning();
      const resetToken = signResetToken({ sub: newUser.id, email: newUser.email });
      const rawAppUrl = process.env.APP_URL ?? process.env.PUBLIC_APP_URL ?? "";
      const appUrl = (() => {
        try { return rawAppUrl ? new URL(rawAppUrl).origin : ""; } catch { return ""; }
      })();
      if (!appUrl) {
        logger.warn({ tenantId: tenant.id }, "APP_URL not configured — invite email will contain a path-only reset link");
      }
      const resetLink = `${appUrl}/app/reset-password?token=${encodeURIComponent(resetToken)}`;
      await sendEmail({
        to: ownerEmail,
        subject: `You've been invited to ${name} on Khana Lagao`,
        html: `<p>Hi ${ownerName ?? "there"},</p><p>You've been invited to manage <strong>${name}</strong> on Khana Lagao.</p><p><a href="${resetLink}">Set your password and sign in</a> (link expires in 1 hour).</p>`,
        text: `You've been invited to ${name} on Khana Lagao. Set your password: ${resetLink}`,
      }).catch(() => {});
      ownerInviteStatus = "sent";
    }
  }

  await recordAuditLog({
    req, module: "tenants", action: "tenant.create", entity: "tenant", entityId: tenant.id,
    newValue: { name: tenant.name, slug: tenant.slug, planId: tenant.planId, ownerEmail: ownerEmail ?? null, ownerInviteStatus },
  });
  res.status(201).json({ ...tenant, ownerInviteStatus });
});

router.get("/tenants/:id", requireSuperAdmin, async (req, res) => {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, Number(req.params.id)));
  if (!tenant) return void res.status(404).json({ error: "Not found" });
  res.json(tenant);
});

router.patch("/tenants/:id", requireSuperAdmin, async (req, res) => {
  const tenantId = Number(req.params.id);
  const [existing] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!existing) return void res.status(404).json({ error: "Not found" });

  const { name, planId, planStatus, isActive, logoUrl, primaryColor } = req.body;
  const [before] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!before) return void res.status(404).json({ error: "Not found" });
  const [updated] = await db.update(tenantsTable)
    .set({ name, planId, planStatus, isActive, logoUrl, primaryColor, updatedAt: new Date() })
    .where(eq(tenantsTable.id, tenantId))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });

  // Plan change → email owners (upgrade vs downgrade by price comparison).
  if (planId && before.planId !== updated.planId) {
    try {
      const [oldPlan] = before.planId
        ? await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, before.planId))
        : [undefined];
      const [newPlan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, updated.planId!));
      if (newPlan) {
        const isUpgrade = !oldPlan || Number(newPlan.price) >= Number(oldPlan.price);
        const tplKey = isUpgrade ? "package_upgraded" : "package_downgraded";
        const owners = await db.select({ email: usersTable.email, name: usersTable.name })
          .from(usersTable).where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.role, "owner"), eq(usersTable.isActive, true)));
        for (const o of owners) {
          if (!o.email) continue;
          await sendByTemplateKey(tplKey, o.email, {
            name: o.name ?? "there",
            oldPlan: oldPlan?.name ?? "—",
            newPlan: newPlan.name,
            price: String(newPlan.price ?? ""),
            currency: newPlan.currency ?? "INR",
            appName: "Khana Lagao",
          }, { tenantId });
        }
      }
    } catch (err) { logger.error({ err, tenantId }, "Plan change email failed"); }
  }

  await recordAuditLog({
    req, module: "tenants", action: "tenant.update", entity: "tenant", entityId: tenantId,
    oldValue: { name: existing.name, planId: existing.planId, planStatus: existing.planStatus, isActive: existing.isActive, primaryColor: existing.primaryColor },
    newValue: { name, planId, planStatus, isActive, logoUrl, primaryColor },
  });
  res.json(updated);
});

// Super-admin "impersonate-light": mint a short-lived access token scoped to a
// tenant owner so super admins can view a tenant's app as that owner.
router.post("/tenants/:id/impersonate", requireSuperAdmin, async (req, res) => {
  const tenantId = Number(req.params.id);
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return void res.status(404).json({ error: "Tenant not found" });
  const [owner] = await db.select().from(usersTable)
    .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.role, "owner"), eq(usersTable.isActive, true)))
    .limit(1);
  if (!owner) return void res.status(404).json({ error: "Tenant has no active owner to impersonate" });
  const token = signImpersonationToken({
    sub: owner.id, email: owner.email, role: owner.role,
    tenantId: owner.tenantId, restaurantId: owner.restaurantId, isSuperAdmin: false,
  });
  logger.warn({ superAdminId: req.user?.sub, tenantId, ownerId: owner.id }, "super_admin.impersonate");
  await recordAuditLog({
    req, module: "impersonation", action: "impersonate.start", entity: "tenant", entityId: tenantId,
    newValue: { tenantId, impersonatedUserId: owner.id, impersonatedEmail: owner.email },
    details: `Super admin impersonating owner of tenant ${tenant.name}`,
  });
  res.json({ token, expiresIn: 900, owner: { id: owner.id, email: owner.email, name: owner.name } });
});

// Optional explicit "end impersonation" event so audit trail captures the bracket.
router.post("/impersonate/end", async (req, res) => {
  await recordAuditLog({
    req, module: "impersonation", action: "impersonate.end", entity: "session",
    details: "Impersonation ended",
  });
  res.json({ ok: true });
});

router.delete("/tenants/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const confirmSlug = typeof req.query.confirm === "string" ? req.query.confirm : "";
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, id));
  if (!tenant) return void res.status(404).json({ error: "Not found" });
  if (confirmSlug !== tenant.slug) {
    return void res.status(400).json({ error: `Confirmation slug does not match. Pass ?confirm=${tenant.slug} to delete this tenant.` });
  }
  try {
    await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  } catch (err) {
    return void res.status(409).json({ error: `Cannot delete: this tenant has related data (restaurants, users, etc.). Suspend it instead. (${(err as Error).message})` });
  }
  await recordAuditLog({
    req, module: "tenants", action: "tenant.delete", entity: "tenant", entityId: id,
    oldValue: { name: tenant.name, slug: tenant.slug },
  });
  res.status(204).end();
});

router.post("/tenants/:id/suspend", requireSuperAdmin, async (req, res) => {
  const tenantId = Number(req.params.id);
  const [tenantBefore] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const [updated] = await db.update(tenantsTable)
    .set({ isSuspended: true, updatedAt: new Date() })
    .where(eq(tenantsTable.id, tenantId))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });

  if (tenantBefore && !tenantBefore.isSuspended) {
    void sendLifecycleSms({
      tenantId,
      eventKey: "restaurant_suspended",
      variables: { tenant: updated.name },
    });
    try {
      const owners = await db.select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable).where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.role, "owner"), eq(usersTable.isActive, true)));
      for (const o of owners) {
        if (!o.email) continue;
        await sendByTemplateKey("restaurant_suspended", o.email, {
          name: o.name ?? "there",
          tenantName: updated.name,
          reason: typeof req.body?.reason === "string" ? req.body.reason : "Account suspended by administrator",
          supportEmail: process.env.SUPPORT_EMAIL ?? "support@khanalagao.app",
          appName: "Khana Lagao",
        }, { tenantId });
      }
    } catch (err) { logger.error({ err, tenantId }, "Suspension email failed"); }
  }

  await recordAuditLog({
    req, module: "tenants", action: "tenant.suspend", entity: "tenant", entityId: tenantId,
    newValue: { isSuspended: true },
  });
  res.json(updated);
});

router.post("/tenants/:id/activate", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const [updated] = await db.update(tenantsTable)
    .set({ isSuspended: false, isActive: true, updatedAt: new Date() })
    .where(eq(tenantsTable.id, id))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req, module: "tenants", action: "tenant.activate", entity: "tenant", entityId: id,
    newValue: { isSuspended: false, isActive: true },
  });
  res.json(updated);
});

router.get("/admin/tenant-usage", requireSuperAdmin, async (req, res) => {
  // Optional `ids=1,2,3` filter so the admin UI can fetch usage only for the
  // current page of tenants rather than every tenant in the system.
  const idsParam = typeof req.query.ids === "string" ? req.query.ids : "";
  const ids = idsParam
    ? idsParam.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const idFilter = ids.length ? sql`WHERE t.id = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})` : sql``;

  const usageRows = await db.execute<{
    tenant_id: number;
    staff_count: string;
    restaurant_count: string;
    table_count: string;
    menu_item_count: string;
  }>(sql`
    SELECT
      t.id as tenant_id,
      COUNT(DISTINCT u.id) FILTER (WHERE u.is_active = true) as staff_count,
      COUNT(DISTINCT r.id) as restaurant_count,
      COUNT(DISTINCT ft.id) FILTER (WHERE ft.is_active = true) as table_count,
      COUNT(DISTINCT mi.id) FILTER (WHERE mi.is_available = true) as menu_item_count
    FROM tenants t
    LEFT JOIN users u ON u.tenant_id = t.id
    LEFT JOIN restaurants r ON r.tenant_id = t.id
    LEFT JOIN floor_tables ft ON ft.restaurant_id = r.id
    LEFT JOIN menu_items mi ON mi.restaurant_id = r.id
    ${idFilter}
    GROUP BY t.id
  `);

  const usage: Record<number, { staffCount: number; restaurantCount: number; tableCount: number; menuItemCount: number }> = {};
  for (const row of usageRows.rows) {
    usage[row.tenant_id] = {
      staffCount: Number(row.staff_count ?? 0),
      restaurantCount: Number(row.restaurant_count ?? 0),
      tableCount: Number(row.table_count ?? 0),
      menuItemCount: Number(row.menu_item_count ?? 0),
    };
  }
  res.json(usage);
});

router.get("/admin/stats", requireSuperAdmin, async (_req, res) => {
  const [tenantStats, restaurantCount, orderStats] = await Promise.all([
    db.select().from(tenantsTable),
    db.execute<{ count: string }>(sql`SELECT COUNT(*) as count FROM restaurants`),
    db.execute<{ count: string; total: string }>(sql`SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total FROM orders`),
  ]);

  const totalTenants = tenantStats.length;
  const activeTenants = tenantStats.filter(t => t.isActive && !t.isSuspended).length;
  const trialTenants = tenantStats.filter(t => t.planStatus === "trial").length;
  const suspendedTenants = tenantStats.filter(t => t.isSuspended).length;

  res.json({
    totalTenants,
    activeTenants,
    trialTenants,
    suspendedTenants,
    totalRestaurants: Number(restaurantCount.rows[0]?.count ?? 0),
    totalOrders: Number(orderStats.rows[0]?.count ?? 0),
    totalRevenue: orderStats.rows[0]?.total ?? "0.00",
  });
});

export default router;
