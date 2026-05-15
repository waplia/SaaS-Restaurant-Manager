import { Router } from "express";
import crypto from "crypto";
import { eq, desc, count, and, or, ilike, sql } from "drizzle-orm";
import { db, subscriptionPlansTable, tenantsTable, usersTable, PLAN_BOOLEAN_FEATURE_KEYS, defaultFeatureFlags } from "../lib/db";
import { requireSuperAdmin, requireRole } from "../middleware/authorize";
import { sendLifecycleSms } from "../lib/smsSender";
import { hashPassword, signResetToken, signImpersonationToken } from "../lib/auth";
import { sendEmail } from "../lib/notifications";
import { sendByTemplateKey } from "../lib/emailSender";
import { logger } from "../lib/logger";

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
  return { data: out };
}

router.post("/subscription-plans", requireSuperAdmin, async (req, res) => {
  const v = validatePlanInput(req.body);
  if (v.error || !v.data) return void res.status(400).json({ error: v.error });
  const [existing] = await db.select({ id: subscriptionPlansTable.id }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.slug, String(v.data.slug)));
  if (existing) return void res.status(409).json({ error: "A plan with this slug already exists" });
  const [plan] = await db.insert(subscriptionPlansTable).values(v.data as typeof subscriptionPlansTable.$inferInsert).returning();
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
  res.status(204).end();
});

// ─── Tenants ──────────────────────────────────────────────────────
router.get("/tenants", requireSuperAdmin, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const planIdRaw = req.query.planId;

  const conds: Parameters<typeof and>[number][] = [];
  if (search) {
    conds.push(or(ilike(tenantsTable.name, `%${search}%`), ilike(tenantsTable.slug, `%${search}%`)));
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

  const [rows, totalRows] = await Promise.all([
    db.select().from(tenantsTable).where(where).orderBy(desc(tenantsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(tenantsTable).where(where),
  ]);
  res.json({ data: rows, tenants: rows, total: Number(totalRows[0]?.count ?? 0), page, limit });
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

  res.status(201).json({ ...tenant, ownerInviteStatus });
});

router.get("/tenants/:id", requireSuperAdmin, async (req, res) => {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, Number(req.params.id)));
  if (!tenant) return void res.status(404).json({ error: "Not found" });
  res.json(tenant);
});

router.patch("/tenants/:id", requireSuperAdmin, async (req, res) => {
  const tenantId = Number(req.params.id);
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
  res.json({ token, expiresIn: 900, owner: { id: owner.id, email: owner.email, name: owner.name } });
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
  res.json(updated);
});

router.post("/tenants/:id/activate", requireSuperAdmin, async (req, res) => {
  const [updated] = await db.update(tenantsTable)
    .set({ isSuspended: false, isActive: true, updatedAt: new Date() })
    .where(eq(tenantsTable.id, Number(req.params.id)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.get("/admin/tenant-usage", requireSuperAdmin, async (_req, res) => {
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
