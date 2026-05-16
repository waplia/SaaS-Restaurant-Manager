import { Router } from "express";
import { eq, and, desc, isNull, sql, inArray } from "drizzle-orm";
import {
  db, subscriptionCouponsTable, subscriptionCouponRedemptionsTable, subscriptionPlansTable,
  tenantsTable, subscriptionPaymentsTable, usersTable, auditLogsTable,
} from "../lib/db";
import { requireSuperAdmin, requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  COUPON_DISCOUNT_TYPES, normaliseCode, validateCoupon, effectiveStatus,
  recordRedemption, countPriorPayments, snapshotCoupon, type CouponDiscountType,
} from "../lib/coupons";
import { validate } from "../middleware/validate";
import { z } from "zod";

const router = Router();

const CouponPayloadBody = z.object({
  code: z.string().trim().min(2).max(40).optional(),
  discountType: z.enum(COUPON_DISCOUNT_TYPES as readonly [CouponDiscountType, ...CouponDiscountType[]]).optional(),
  discountValue: z.union([z.number(), z.string()]).optional(),
  maxUsage: z.union([z.number(), z.string(), z.null()]).optional(),
  validFrom: z.union([z.string(), z.null()]).optional(),
  validUntil: z.union([z.string(), z.null()]).optional(),
  applicablePlanIds: z.array(z.coerce.number().int().positive()).optional(),
  applicableTenantIds: z.array(z.coerce.number().int().positive()).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  notes: z.union([z.string(), z.null()]).optional(),
});

const ValidateCouponBody = z.object({
  code: z.string().trim().min(1),
  planId: z.coerce.number().int().positive().optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  action: z.enum(["payment", "trial_extension"]).optional(),
});

const ExtendTrialBody = z.object({
  code: z.string().trim().min(1).optional(),
  days: z.coerce.number().int().min(0).optional(),
}).refine((b) => b.code !== undefined || b.days !== undefined, {
  message: "Provide either a coupon code or a days value",
});

function isDiscountType(s: unknown): s is CouponDiscountType {
  return typeof s === "string" && (COUPON_DISCOUNT_TYPES as readonly string[]).includes(s);
}

function parseDateMaybe(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d;
}

function parseIntArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0);
}

function serialise(c: typeof subscriptionCouponsTable.$inferSelect) {
  return {
    id: c.id,
    code: c.code,
    discountType: c.discountType,
    discountValue: c.discountValue,
    maxUsage: c.maxUsage,
    usedCount: c.usedCount,
    validFrom: c.validFrom ? c.validFrom.toISOString() : null,
    validUntil: c.validUntil ? c.validUntil.toISOString() : null,
    applicablePlanIds: c.applicablePlanIds ?? [],
    applicableTenantIds: c.applicableTenantIds ?? [],
    status: c.status,
    notes: c.notes,
    effectiveStatus: effectiveStatus(c),
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
  };
}

// ─── Super-admin: list coupons ───────────────────────────────────
router.get("/admin/coupons", requireSuperAdmin, async (req, res) => {
  const { search, status, discountType, planId, includeDeleted } = req.query as Record<string, string | undefined>;
  const where = [includeDeleted === "true" ? undefined : isNull(subscriptionCouponsTable.deletedAt)].filter(Boolean) as ReturnType<typeof eq>[];
  if (status && status !== "all") where.push(eq(subscriptionCouponsTable.status, status));
  if (discountType && discountType !== "all" && isDiscountType(discountType)) where.push(eq(subscriptionCouponsTable.discountType, discountType));

  const rows = await db.select().from(subscriptionCouponsTable)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(subscriptionCouponsTable.createdAt))
    .limit(500);

  let filtered = rows;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r => r.code.toLowerCase().includes(q) || (r.notes ?? "").toLowerCase().includes(q));
  }
  if (planId) {
    const pid = Number(planId);
    if (Number.isInteger(pid)) {
      filtered = filtered.filter(r => r.applicablePlanIds.length === 0 || r.applicablePlanIds.includes(pid));
    }
  }

  res.json({ data: filtered.map(serialise) });
});

router.get("/admin/coupons/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(subscriptionCouponsTable).where(eq(subscriptionCouponsTable.id, id));
  if (!row) return void res.status(404).json({ error: "Coupon not found" });
  res.json(serialise(row));
});

router.get("/admin/coupons/:id/redemptions", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select({
    id: subscriptionCouponRedemptionsTable.id,
    couponId: subscriptionCouponRedemptionsTable.couponId,
    tenantId: subscriptionCouponRedemptionsTable.tenantId,
    tenantName: tenantsTable.name,
    planId: subscriptionCouponRedemptionsTable.planId,
    planName: subscriptionPlansTable.name,
    paymentId: subscriptionCouponRedemptionsTable.paymentId,
    manualRequestId: subscriptionCouponRedemptionsTable.manualRequestId,
    discountApplied: subscriptionCouponRedemptionsTable.discountApplied,
    trialDaysAdded: subscriptionCouponRedemptionsTable.trialDaysAdded,
    context: subscriptionCouponRedemptionsTable.context,
    redeemedBy: subscriptionCouponRedemptionsTable.redeemedBy,
    redeemedByName: usersTable.name,
    redeemedAt: subscriptionCouponRedemptionsTable.redeemedAt,
  }).from(subscriptionCouponRedemptionsTable)
    .leftJoin(tenantsTable, eq(tenantsTable.id, subscriptionCouponRedemptionsTable.tenantId))
    .leftJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, subscriptionCouponRedemptionsTable.planId))
    .leftJoin(usersTable, eq(usersTable.id, subscriptionCouponRedemptionsTable.redeemedBy))
    .where(eq(subscriptionCouponRedemptionsTable.couponId, id))
    .orderBy(desc(subscriptionCouponRedemptionsTable.redeemedAt))
    .limit(500);
  res.json({ data: rows });
});

// ─── Super-admin: create / update / delete ────────────────────────
async function readPayload(body: Record<string, unknown>) {
  const code = body.code === undefined ? undefined : normaliseCode(String(body.code));
  if (code !== undefined && !/^[A-Z0-9_-]{2,40}$/.test(code)) {
    throw Object.assign(new Error("Code must be 2-40 chars: A-Z, 0-9, _ or -"), { status: 400 });
  }
  const discountType = body.discountType !== undefined ? String(body.discountType) : undefined;
  if (discountType !== undefined && !isDiscountType(discountType)) {
    throw Object.assign(new Error("Invalid discountType"), { status: 400 });
  }
  const discountValueRaw = body.discountValue;
  const discountValue = discountValueRaw === undefined ? undefined : Number(discountValueRaw);
  if (discountValue !== undefined && (!isFinite(discountValue) || discountValue < 0)) {
    throw Object.assign(new Error("Invalid discountValue"), { status: 400 });
  }

  return {
    code,
    discountType,
    discountValue: discountValue === undefined ? undefined : discountValue.toFixed(2),
    maxUsage: body.maxUsage === undefined || body.maxUsage === null || body.maxUsage === "" ? null : Number(body.maxUsage),
    validFrom: parseDateMaybe(body.validFrom),
    validUntil: parseDateMaybe(body.validUntil),
    applicablePlanIds: body.applicablePlanIds === undefined ? undefined : parseIntArray(body.applicablePlanIds),
    applicableTenantIds: body.applicableTenantIds === undefined ? undefined : parseIntArray(body.applicableTenantIds),
    status: body.status === undefined ? undefined : String(body.status),
    notes: body.notes === undefined ? undefined : (body.notes === null ? null : String(body.notes)),
  };
}

router.post("/admin/coupons", requireSuperAdmin, validate({ body: CouponPayloadBody }), async (req, res) => {
  let payload;
  try { payload = await readPayload(req.body ?? {}); } catch (e) { return void res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message }); }
  if (!payload.code || !payload.discountType || payload.discountValue === undefined) {
    return void res.status(400).json({ error: "code, discountType and discountValue are required" });
  }
  // Reject collisions including soft-deleted rows so old codes can't be silently reused.
  const [existing] = await db.select({ id: subscriptionCouponsTable.id }).from(subscriptionCouponsTable).where(eq(subscriptionCouponsTable.code, payload.code));
  if (existing) return void res.status(409).json({ error: "A coupon with this code already exists" });

  const [created] = await db.insert(subscriptionCouponsTable).values({
    code: payload.code,
    discountType: payload.discountType,
    discountValue: payload.discountValue,
    maxUsage: payload.maxUsage ?? null,
    validFrom: payload.validFrom ?? null,
    validUntil: payload.validUntil ?? null,
    applicablePlanIds: payload.applicablePlanIds ?? [],
    applicableTenantIds: payload.applicableTenantIds ?? [],
    status: payload.status === "inactive" ? "inactive" : "active",
    notes: payload.notes ?? null,
    createdBy: req.user?.id ?? null,
  }).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "coupon.created",
    entity: "coupon",
    entityId: created.id,
    details: `code=${created.code} type=${created.discountType} value=${created.discountValue}`,
  });
  res.status(201).json(serialise(created));
});

router.patch("/admin/coupons/:id", requireSuperAdmin, validate({ body: CouponPayloadBody }), async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(subscriptionCouponsTable).where(eq(subscriptionCouponsTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Coupon not found" });
  if (existing.deletedAt) return void res.status(400).json({ error: "Coupon has been deleted" });

  let payload;
  try { payload = await readPayload(req.body ?? {}); } catch (e) { return void res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message }); }
  if (payload.code && payload.code !== existing.code) {
    const [collision] = await db.select({ id: subscriptionCouponsTable.id }).from(subscriptionCouponsTable).where(eq(subscriptionCouponsTable.code, payload.code));
    if (collision) return void res.status(409).json({ error: "A coupon with this code already exists" });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (payload.code !== undefined) patch.code = payload.code;
  if (payload.discountType !== undefined) patch.discountType = payload.discountType;
  if (payload.discountValue !== undefined) patch.discountValue = payload.discountValue;
  if (payload.maxUsage !== undefined) patch.maxUsage = payload.maxUsage;
  if (payload.validFrom !== undefined) patch.validFrom = payload.validFrom;
  if (payload.validUntil !== undefined) patch.validUntil = payload.validUntil;
  if (payload.applicablePlanIds !== undefined) patch.applicablePlanIds = payload.applicablePlanIds;
  if (payload.applicableTenantIds !== undefined) patch.applicableTenantIds = payload.applicableTenantIds;
  if (payload.status !== undefined) patch.status = payload.status === "inactive" ? "inactive" : "active";
  if (payload.notes !== undefined) patch.notes = payload.notes;

  const [updated] = await db.update(subscriptionCouponsTable).set(patch).where(eq(subscriptionCouponsTable.id, id)).returning();
  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "coupon.updated",
    entity: "coupon",
    entityId: id,
    details: `code=${updated.code}`,
  });
  res.json(serialise(updated));
});

router.post("/admin/coupons/:id/toggle", requireSuperAdmin, validate({ body: z.object({}).passthrough() }), async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(subscriptionCouponsTable).where(eq(subscriptionCouponsTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Coupon not found" });
  if (existing.deletedAt) return void res.status(400).json({ error: "Coupon has been deleted" });
  const next = existing.status === "active" ? "inactive" : "active";
  const [updated] = await db.update(subscriptionCouponsTable).set({ status: next, updatedAt: new Date() }).where(eq(subscriptionCouponsTable.id, id)).returning();
  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "coupon.toggled",
    entity: "coupon",
    entityId: id,
    details: `status=${next}`,
  });
  res.json(serialise(updated));
});

router.post("/admin/coupons/:id/duplicate", requireSuperAdmin, validate({ body: z.object({}).passthrough() }), async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(subscriptionCouponsTable).where(eq(subscriptionCouponsTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Coupon not found" });
  // Find a fresh code: append _COPY (or _COPYn) until unique.
  let candidate = `${existing.code}_COPY`;
  let n = 2;
  while (true) {
    const [hit] = await db.select({ id: subscriptionCouponsTable.id }).from(subscriptionCouponsTable).where(eq(subscriptionCouponsTable.code, candidate));
    if (!hit) break;
    candidate = `${existing.code}_COPY${n++}`;
    if (candidate.length > 40) candidate = candidate.slice(0, 40);
  }
  const [copy] = await db.insert(subscriptionCouponsTable).values({
    code: candidate,
    discountType: existing.discountType,
    discountValue: existing.discountValue,
    maxUsage: existing.maxUsage,
    validFrom: existing.validFrom,
    validUntil: existing.validUntil,
    applicablePlanIds: existing.applicablePlanIds,
    applicableTenantIds: existing.applicableTenantIds,
    status: "inactive",
    notes: existing.notes,
    createdBy: req.user?.id ?? null,
  }).returning();
  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "coupon.duplicated",
    entity: "coupon",
    entityId: copy.id,
    details: `from=${existing.id} code=${copy.code}`,
  });
  res.status(201).json(serialise(copy));
});

router.delete("/admin/coupons/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(subscriptionCouponsTable).where(eq(subscriptionCouponsTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Coupon not found" });
  await db.update(subscriptionCouponsTable).set({
    deletedAt: new Date(), status: "inactive", updatedAt: new Date(),
  }).where(eq(subscriptionCouponsTable.id, id));
  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "coupon.deleted",
    entity: "coupon",
    entityId: id,
    details: `code=${existing.code}`,
  });
  res.status(204).end();
});

// ─── Tenant-facing: validate a code (does NOT redeem) ────────────
// Reused both by the tenant checkout preview and the super-admin
// manual-payment / extend-trial dialogs (super admins may pass tenantId).
router.post("/coupons/validate", requireRole("owner", "manager", "super_admin"), validate({ body: ValidateCouponBody }), async (req, res) => {
  const { code, planId, tenantId: tenantIdRaw, action } = req.body as {
    code: string; planId?: number; tenantId?: number; action?: "payment" | "trial_extension";
  };

  let tenantId = req.user?.tenantId ?? null;
  if (req.user?.isSuperAdmin && tenantIdRaw) tenantId = Number(tenantIdRaw);
  if (!tenantId) return void res.status(400).json({ error: "tenantId is required" });

  let plan: { id: number; price: string } | null = null;
  if (planId) {
    const [p] = await db.select({ id: subscriptionPlansTable.id, price: subscriptionPlansTable.price }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, Number(planId)));
    if (!p) return void res.status(404).json({ error: "Plan not found" });
    plan = p;
  }
  const isFirstCycle = plan ? (await countPriorPayments(tenantId, plan.id)) === 0 : true;

  const result = await validateCoupon({ code, tenantId, plan, action, isFirstCycle });
  if (!result.ok) return void res.json({ valid: false, reason: result.reason, message: result.message });

  const r = result.resolved;
  res.json({
    valid: true,
    coupon: snapshotCoupon(r.coupon),
    discountType: r.coupon.discountType,
    discountAmount: r.discountAmount.toFixed(2),
    effectiveAmount: r.effectiveAmount.toFixed(2),
    trialDaysToAdd: r.trialDaysToAdd,
    persistOnTenant: r.persistOnTenant,
    firstCycleOnly: r.firstCycleOnly,
  });
});

// ─── Super-admin: extend a tenant's trial via coupon ─────────────
router.post("/admin/tenants/:tenantId/extend-trial", requireSuperAdmin, validate({ body: ExtendTrialBody }), async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  const { code, days: daysRaw } = req.body as { code?: string; days?: number };
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return void res.status(404).json({ error: "Tenant not found" });

  let daysToAdd = 0;
  let couponRow: typeof subscriptionCouponsTable.$inferSelect | null = null;
  if (code) {
    const result = await validateCoupon({ code, tenantId, action: "trial_extension" });
    if (!result.ok) return void res.status(400).json({ error: result.message, reason: result.reason });
    daysToAdd = result.resolved.trialDaysToAdd;
    couponRow = result.resolved.coupon;
  } else if (daysRaw && Number.isFinite(Number(daysRaw))) {
    daysToAdd = Math.max(0, Math.floor(Number(daysRaw)));
  } else {
    return void res.status(400).json({ error: "Provide either a coupon code or a days value" });
  }
  if (daysToAdd <= 0) return void res.status(400).json({ error: "Trial extension must add a positive number of days" });

  const base = tenant.trialEndsAt && tenant.trialEndsAt > new Date() ? tenant.trialEndsAt : new Date();
  const newEnd = new Date(base.getTime() + daysToAdd * 86400_000);
  await db.update(tenantsTable).set({
    trialEndsAt: newEnd,
    planStatus: "trial",
    updatedAt: new Date(),
  }).where(eq(tenantsTable.id, tenantId));

  if (couponRow) {
    await recordRedemption({
      coupon: couponRow,
      tenantId,
      planId: null,
      discountApplied: 0,
      trialDaysAdded: daysToAdd,
      context: "trial_extension",
      redeemedBy: req.user?.id ?? null,
    });
  }
  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "tenant.trial_extended",
    entity: "tenant",
    entityId: tenantId,
    details: `days=${daysToAdd}${couponRow ? ` coupon=${couponRow.code}` : ""}`,
  });
  res.json({ ok: true, trialEndsAt: newEnd.toISOString(), daysAdded: daysToAdd });
});

export default router;
