import { Router } from "express";
import { eq, and, ilike, or, count, desc, sql, gte, lte, inArray } from "drizzle-orm";
import {
  db,
  customersTable, couponsTable, notificationsTable, loyaltyTransactionsTable,
  customerAddressesTable,
  customerTagsTable, customerTagAssignmentsTable,
  customerNotesTable, customerComplaintsTable,
  ordersTable, orderItemsTable,
  customerFeedbackTable, externalReviewsTable,
  usersTable,
  restaurantsTable,
} from "../lib/db";
import { normalizePhone, DEFAULT_ISO } from "@workspace/phone-utils";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { recordAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), validateRestaurantAccess);

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Look up a restaurant's configured ISO-2 country, used as the fallback
 * region when parsing inbound phone numbers that don't have a `+`-prefix.
 * Falls back to {@link DEFAULT_ISO} when the restaurant or column is null.
 */
async function getRestaurantCountry(restaurantId: number): Promise<string> {
  const [row] = await db
    .select({ country: restaurantsTable.country })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  return row?.country ?? DEFAULT_ISO;
}

const PREFERRED_CHANNELS = ["whatsapp", "sms", "email", "call", "none"] as const;
type PreferredChannel = (typeof PREFERRED_CHANNELS)[number];

const COMPLAINT_STATUSES = ["open", "in_progress", "resolved"] as const;
const COMPLAINT_CHANNELS = ["in_person", "phone", "whatsapp", "email", "review", "other"] as const;

const NOTE_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Returns "VALID" string, the literal `null` (clear value), or null sentinel for "invalid". */
function parseDateOnly(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: "must be a YYYY-MM-DD string or null" };
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) iso = v;
  else {
    const d = new Date(v);
    if (isNaN(d.getTime())) return { ok: false, error: "not a parseable date" };
    iso = d.toISOString().slice(0, 10);
  }
  // sanity: reject absurd years (DOB before 1900 or future > today + 1y for anniversary edge)
  const year = Number(iso.slice(0, 4));
  if (year < 1900 || year > new Date().getFullYear() + 1) {
    return { ok: false, error: `year ${year} is out of range` };
  }
  return { ok: true, value: iso };
}

/**
 * Loyalty tiers — mirrors lib/loyalty.ts thresholds.
 * Used by the list filter so callers can pass tier=silver|gold|bronze
 * without knowing the exact point cutoffs.
 */
const LOYALTY_TIERS = {
  bronze: 0,
  silver: 1000,
  gold: 5000,
} as const;
type LoyaltyTier = keyof typeof LOYALTY_TIERS;

async function loadTagsForCustomers(customerIds: number[], restaurantId: number): Promise<Map<number, Array<{ id: number; name: string }>>> {
  const out = new Map<number, Array<{ id: number; name: string }>>();
  if (customerIds.length === 0) return out;
  const rows = await db.select({
    customerId: customerTagAssignmentsTable.customerId,
    tagId: customerTagsTable.id,
    name: customerTagsTable.name,
  }).from(customerTagAssignmentsTable)
    .innerJoin(customerTagsTable, eq(customerTagAssignmentsTable.tagId, customerTagsTable.id))
    .where(and(
      inArray(customerTagAssignmentsTable.customerId, customerIds),
      eq(customerTagAssignmentsTable.restaurantId, restaurantId),
    ));
  for (const r of rows) {
    const list = out.get(r.customerId) ?? [];
    list.push({ id: r.tagId, name: r.name });
    out.set(r.customerId, list);
  }
  return out;
}

interface DerivedMetrics {
  averageOrderValue: number;
  visitFrequencyDays: number | null;
  lifetimeDays: number | null;
}

function computeDerivedMetrics(customer: { totalOrders: number; totalSpent: string; firstOrderAt: Date | null; lastVisitAt: Date | null }): DerivedMetrics {
  const totalOrders = customer.totalOrders ?? 0;
  const totalSpent = Number(customer.totalSpent ?? 0);
  const aov = totalOrders > 0 ? totalSpent / totalOrders : 0;
  let freq: number | null = null;
  if (totalOrders > 1 && customer.firstOrderAt && customer.lastVisitAt) {
    const span = customer.lastVisitAt.getTime() - customer.firstOrderAt.getTime();
    if (span > 0) freq = span / (1000 * 60 * 60 * 24) / Math.max(1, totalOrders - 1);
  }
  let lifetime: number | null = null;
  if (customer.firstOrderAt) {
    lifetime = (Date.now() - customer.firstOrderAt.getTime()) / (1000 * 60 * 60 * 24);
  }
  return {
    averageOrderValue: Number(aov.toFixed(2)),
    visitFrequencyDays: freq !== null ? Number(freq.toFixed(1)) : null,
    lifetimeDays: lifetime !== null ? Math.round(lifetime) : null,
  };
}

// ─── Customer list & CRUD ──────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/customers", async (req, res) => {
  const {
    search, page, limit,
    tag, tier, vip, preferredChannel, whatsappOptIn,
    hasComplaints, lastVisitFrom, lastVisitTo,
    birthdayMonth, anniversaryMonth,
  } = req.query;
  const pg = Number(page) || 1;
  const lim = Number(limit) || 20;
  const offset = (pg - 1) * lim;
  const restaurantId = Number(req.params.restaurantId);

  const conditions = [eq(customersTable.restaurantId, restaurantId)] as Parameters<typeof and>[0][];
  if (search) conditions.push(or(ilike(customersTable.name, `%${search}%`), ilike(customersTable.phone, `%${search}%`)) as Parameters<typeof and>[0]);
  if (vip === "true") conditions.push(eq(customersTable.isVip, true));
  if (typeof preferredChannel === "string" && (PREFERRED_CHANNELS as readonly string[]).includes(preferredChannel)) {
    conditions.push(eq(customersTable.preferredChannel, preferredChannel));
  }
  if (whatsappOptIn === "true") conditions.push(eq(customersTable.whatsappOptIn, true));
  if (whatsappOptIn === "false") conditions.push(eq(customersTable.whatsappOptIn, false));
  if (lastVisitFrom && typeof lastVisitFrom === "string") {
    const d = new Date(lastVisitFrom);
    if (!isNaN(d.getTime())) conditions.push(gte(customersTable.lastVisitAt, d));
  }
  if (lastVisitTo && typeof lastVisitTo === "string") {
    const d = new Date(lastVisitTo);
    if (!isNaN(d.getTime())) conditions.push(lte(customersTable.lastVisitAt, d));
  }
  if (birthdayMonth && Number(birthdayMonth) >= 1 && Number(birthdayMonth) <= 12) {
    conditions.push(sql`EXTRACT(MONTH FROM ${customersTable.birthday}) = ${Number(birthdayMonth)}`);
  }
  if (anniversaryMonth && Number(anniversaryMonth) >= 1 && Number(anniversaryMonth) <= 12) {
    conditions.push(sql`EXTRACT(MONTH FROM ${customersTable.anniversary}) = ${Number(anniversaryMonth)}`);
  }
  if (hasComplaints === "true") {
    conditions.push(sql`EXISTS (SELECT 1 FROM ${customerComplaintsTable} WHERE ${customerComplaintsTable.customerId} = ${customersTable.id} AND ${customerComplaintsTable.status} <> 'resolved')`);
  }
  // Loyalty tier filter — accepts named tier (bronze|silver|gold) OR a raw
  // tierMin point threshold. Named tier maps to the canonical thresholds in
  // lib/loyalty.ts so the UI doesn't need to know the cutoffs. Named tiers
  // are EXACT bucket matches (silver excludes gold) so dashboard counts add
  // up to the total customer count without double-counting.
  if (tier && typeof tier === "string" && tier in LOYALTY_TIERS) {
    const min = LOYALTY_TIERS[tier as LoyaltyTier];
    const orderedTiers = (Object.entries(LOYALTY_TIERS) as Array<[LoyaltyTier, number]>)
      .sort((a, b) => a[1] - b[1]);
    const next = orderedTiers.find(([, threshold]) => threshold > min);
    conditions.push(sql`${customersTable.loyaltyPoints} >= ${min}`);
    if (next) conditions.push(sql`${customersTable.loyaltyPoints} < ${next[1]}`);
  } else if (req.query.tierMin !== undefined) {
    const tierMin = Number(req.query.tierMin);
    if (Number.isFinite(tierMin) && tierMin > 0) {
      conditions.push(sql`${customersTable.loyaltyPoints} >= ${tierMin}`);
    }
  }
  // Tag filter — by tag id (exact match) or tag name (case-insensitive).
  if (tag && typeof tag === "string") {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${customerTagAssignmentsTable} a
      INNER JOIN ${customerTagsTable} t ON t.id = a.tag_id
      WHERE a.customer_id = ${customersTable.id}
        AND a.restaurant_id = ${restaurantId}
        AND lower(t.name) = lower(${tag})
    )`);
  }

  const [rows, totalRows] = await Promise.all([
    db.select().from(customersTable).where(and(...conditions)).orderBy(desc(customersTable.createdAt)).limit(lim).offset(offset),
    db.select({ count: count() }).from(customersTable).where(and(...conditions)),
  ]);

  const tagMap = await loadTagsForCustomers(rows.map(r => r.id), restaurantId);
  const enriched = rows.map(c => ({
    ...c,
    tags: tagMap.get(c.id) ?? [],
    ...computeDerivedMetrics(c),
  }));

  res.json({ data: enriched, total: totalRows[0]?.count ?? 0 });
});

router.post("/restaurants/:restaurantId/customers", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const { name, email, phone, address, notes } = req.body;
  const restaurantId = Number(req.params.restaurantId);
  // Legacy `customers.notes` is no longer written — all freeform notes live
  // in the timestamped `customer_notes` log.
  // Normalise to canonical "+<dial> <national>" using the restaurant's
  // configured country as the fallback for national-only input.
  const normalizedPhone = phone
    ? normalizePhone(phone, await getRestaurantCountry(restaurantId))
    : phone;
  const [customer] = await db.insert(customersTable)
    .values({ restaurantId, name, email, phone: normalizedPhone, address })
    .returning();

  if (notes && typeof notes === "string" && notes.trim()) {
    await db.insert(customerNotesTable).values({
      customerId: customer.id,
      restaurantId,
      authorUserId: req.user?.sub ?? null,
      body: notes.trim(),
    });
  }
  res.status(201).json(customer);
});

router.get("/restaurants/:restaurantId/customers/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!customer) return void res.status(404).json({ error: "Not found" });

  // Tags
  const tagMap = await loadTagsForCustomers([customerId], restaurantId);
  const tags = tagMap.get(customerId) ?? [];

  // Favorite items — top 5 by order count + qty for paid orders.
  const favorites = await db.select({
    menuItemId: orderItemsTable.menuItemId,
    name: orderItemsTable.menuItemName,
    orderCount: sql<number>`COUNT(DISTINCT ${ordersTable.id})`.as("orderCount"),
    quantity: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)`.as("quantity"),
    lastOrderedAt: sql<Date | null>`MAX(${ordersTable.createdAt})`.as("lastOrderedAt"),
  })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
    .where(and(eq(ordersTable.customerId, customerId), eq(ordersTable.restaurantId, restaurantId)))
    .groupBy(orderItemsTable.menuItemId, orderItemsTable.menuItemName)
    .orderBy(desc(sql`COUNT(DISTINCT ${ordersTable.id})`), desc(sql`SUM(${orderItemsTable.quantity})`))
    .limit(5);

  // Recent complaints
  const complaints = await db.select().from(customerComplaintsTable)
    .where(eq(customerComplaintsTable.customerId, customerId))
    .orderBy(desc(customerComplaintsTable.createdAt))
    .limit(20);

  // In-store feedback — match by phone (strongest signal) OR case-insensitive
  // name match. (The feedback schema doesn't store an email column, so phone
  // is the most reliable join key when available.)
  const feedbackConds: Parameters<typeof or>[0][] = [];
  if (customer.phone) feedbackConds.push(eq(customerFeedbackTable.customerPhone, customer.phone));
  if (customer.name) feedbackConds.push(sql`lower(${customerFeedbackTable.customerName}) = lower(${customer.name})`);
  let feedback: Array<typeof customerFeedbackTable.$inferSelect> = [];
  if (feedbackConds.length > 0) {
    feedback = await db.select().from(customerFeedbackTable)
      .where(and(eq(customerFeedbackTable.restaurantId, restaurantId), or(...feedbackConds)!))
      .orderBy(desc(customerFeedbackTable.createdAt))
      .limit(20);
  }

  // External reviews — case-insensitive author-name match plus a body scan
  // for the customer's phone or email (some reviewers leave contact info in
  // the comment, especially for delivery complaints). The DB column is `body`
  // but the API contract exposes it as `comment` so the UI can render feedback
  // and external reviews uniformly.
  const externalConds: Parameters<typeof or>[0][] = [];
  if (customer.name) externalConds.push(sql`lower(${externalReviewsTable.authorName}) = lower(${customer.name})`);
  if (customer.phone) externalConds.push(sql`${externalReviewsTable.body} ILIKE ${"%" + customer.phone + "%"}`);
  if (customer.email) externalConds.push(sql`${externalReviewsTable.body} ILIKE ${"%" + customer.email + "%"}`);
  let externalReviews: Array<{
    id: number; rating: number | null; comment: string | null;
    postedAt: Date | null; source: string; authorName: string | null;
  }> = [];
  if (externalConds.length > 0) {
    externalReviews = await db.select({
      id: externalReviewsTable.id,
      rating: externalReviewsTable.rating,
      comment: externalReviewsTable.body,
      postedAt: externalReviewsTable.postedAt,
      source: externalReviewsTable.source,
      authorName: externalReviewsTable.authorName,
    }).from(externalReviewsTable)
      .where(and(eq(externalReviewsTable.restaurantId, restaurantId), or(...externalConds)!))
      .orderBy(desc(externalReviewsTable.postedAt))
      .limit(20);
  }

  res.json({
    ...customer,
    tags,
    ...computeDerivedMetrics(customer),
    favoriteItems: favorites,
    recentComplaints: complaints,
    recentReviews: {
      feedback,
      external: externalReviews,
    },
  });
});

router.patch("/restaurants/:restaurantId/customers/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const [existing] = await db.select().from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });

  const {
    name, email, phone, address, loyaltyPoints, isActive, isVip,
    preferredChannel, whatsappOptIn, whatsappOptInSource,
    birthday, anniversary,
    allergies, preferredTableId,
  } = req.body as Record<string, unknown>;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email;
  if (phone !== undefined) {
    updates.phone = phone
      ? normalizePhone(String(phone), await getRestaurantCountry(restaurantId))
      : phone;
  }
  if (address !== undefined) updates.address = address;
  if (loyaltyPoints !== undefined) updates.loyaltyPoints = Number(loyaltyPoints);
  // Note: the legacy `notes` field is no longer writable through this route.
  // All freeform notes are now stored in customer_notes via /:id/notes.
  if (isActive !== undefined) updates.isActive = !!isActive;
  if (isVip !== undefined) updates.isVip = !!isVip;
  if (allergies !== undefined) updates.allergies = allergies == null ? null : String(allergies).slice(0, 500);
  if (preferredTableId !== undefined) {
    updates.preferredTableId = preferredTableId == null || preferredTableId === "" ? null : Number(preferredTableId) || null;
  }

  if (preferredChannel !== undefined) {
    if (!(PREFERRED_CHANNELS as readonly string[]).includes(String(preferredChannel))) {
      return void res.status(400).json({ error: `preferredChannel must be one of ${PREFERRED_CHANNELS.join(", ")}` });
    }
    updates.preferredChannel = preferredChannel as PreferredChannel;
  }

  if (birthday !== undefined) {
    const r = parseDateOnly(birthday);
    if (!r.ok) return void res.status(400).json({ error: `birthday: ${r.error}` });
    updates.birthday = r.value;
  }
  if (anniversary !== undefined) {
    const r = parseDateOnly(anniversary);
    if (!r.ok) return void res.status(400).json({ error: `anniversary: ${r.error}` });
    updates.anniversary = r.value;
  }

  // WhatsApp opt-in: when toggling to true, source is required and we stamp time.
  // Toggling to false clears the timestamp/source for compliance.
  if (whatsappOptIn !== undefined) {
    const next = !!whatsappOptIn;
    if (next && !existing.whatsappOptIn) {
      const src = typeof whatsappOptInSource === "string" ? whatsappOptInSource.trim() : "";
      if (!src) return void res.status(400).json({ error: "whatsappOptInSource is required when enabling WhatsApp opt-in" });
      updates.whatsappOptIn = true;
      updates.whatsappOptInAt = new Date();
      updates.whatsappOptInSource = src;
    } else if (!next && existing.whatsappOptIn) {
      updates.whatsappOptIn = false;
      updates.whatsappOptInAt = null;
      updates.whatsappOptInSource = null;
    }
  }

  const [updated] = await db.update(customersTable).set(updates)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)))
    .returning();

  // Audit any change touching opt-in/preferences/milestones for compliance traceability.
  const auditedKeys = ["preferredChannel", "whatsappOptIn", "whatsappOptInAt", "whatsappOptInSource", "birthday", "anniversary", "allergies", "preferredTableId", "isVip"];
  if (auditedKeys.some(k => k in updates)) {
    await recordAuditLog({
      req,
      module: "customers",
      action: "update_preferences",
      entity: "customer",
      entityId: customerId,
      restaurantId,
      oldValue: Object.fromEntries(auditedKeys.map(k => [k, (existing as Record<string, unknown>)[k]])),
      newValue: Object.fromEntries(auditedKeys.filter(k => k in updates).map(k => [k, updates[k]])),
    });
  }

  res.json(updated);
});

// ─── Tags ──────────────────────────────────────────────────────────────────

async function listTagDictionary(restaurantId: number, search: unknown) {
  const conds = [eq(customerTagsTable.restaurantId, restaurantId)] as Parameters<typeof and>[0][];
  if (search && typeof search === "string") conds.push(ilike(customerTagsTable.name, `%${search}%`));
  return db.select().from(customerTagsTable).where(and(...conds)).orderBy(customerTagsTable.name).limit(100);
}

router.get("/restaurants/:restaurantId/customer-tags", async (req, res) => {
  res.json(await listTagDictionary(Number(req.params.restaurantId), req.query.search));
});

// Documented contract path. `/customer-tags` retained as a back-compat alias
// to avoid breaking existing clients/tests during rollout.
router.get("/restaurants/:restaurantId/customers/tags", async (req, res) => {
  res.json(await listTagDictionary(Number(req.params.restaurantId), req.query.search));
});

router.get("/restaurants/:restaurantId/customers/:id/tags", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const map = await loadTagsForCustomers([customerId], restaurantId);
  res.json(map.get(customerId) ?? []);
});

router.post("/restaurants/:restaurantId/customers/:id/tags", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const raw = String(req.body?.name ?? "").trim();
  if (!raw) return void res.status(400).json({ error: "Tag name required" });
  if (raw.length > 40) return void res.status(400).json({ error: "Tag name too long" });

  // Verify customer belongs to restaurant.
  const [c] = await db.select({ id: customersTable.id }).from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Customer not found" });

  // Upsert tag in dictionary.
  const [tag] = await db.insert(customerTagsTable)
    .values({ restaurantId, name: raw })
    .onConflictDoUpdate({
      target: [customerTagsTable.restaurantId, customerTagsTable.name],
      set: { name: raw },
    })
    .returning();

  await db.insert(customerTagAssignmentsTable).values({
    customerId, tagId: tag.id, restaurantId,
  }).onConflictDoNothing();

  await recordAuditLog({ req, module: "customers", action: "tag_add", entity: "customer", entityId: customerId, restaurantId, newValue: { tag: raw } });
  res.status(201).json(tag);
});

router.delete("/restaurants/:restaurantId/customers/:id/tags/:tagId", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const tagId = Number(req.params.tagId);
  await db.delete(customerTagAssignmentsTable).where(and(
    eq(customerTagAssignmentsTable.customerId, customerId),
    eq(customerTagAssignmentsTable.tagId, tagId),
    eq(customerTagAssignmentsTable.restaurantId, restaurantId),
  ));
  await recordAuditLog({ req, module: "customers", action: "tag_remove", entity: "customer", entityId: customerId, restaurantId, oldValue: { tagId } });
  res.status(204).send();
});

// ─── Notes (timestamped log) ───────────────────────────────────────────────

router.get("/restaurants/:restaurantId/customers/:id/notes", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const rows = await db.select({
    id: customerNotesTable.id,
    customerId: customerNotesTable.customerId,
    body: customerNotesTable.body,
    authorUserId: customerNotesTable.authorUserId,
    authorName: usersTable.name,
    createdAt: customerNotesTable.createdAt,
    updatedAt: customerNotesTable.updatedAt,
  }).from(customerNotesTable)
    .leftJoin(usersTable, eq(usersTable.id, customerNotesTable.authorUserId))
    .where(and(eq(customerNotesTable.customerId, customerId), eq(customerNotesTable.restaurantId, restaurantId)))
    .orderBy(desc(customerNotesTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/customers/:id/notes", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const body = String(req.body?.body ?? "").trim();
  if (!body) return void res.status(400).json({ error: "Note body required" });

  const [c] = await db.select({ id: customersTable.id }).from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Customer not found" });

  const [note] = await db.insert(customerNotesTable).values({
    customerId, restaurantId,
    authorUserId: req.user?.sub ?? null,
    body,
  }).returning();
  res.status(201).json(note);
});

router.patch("/restaurants/:restaurantId/customers/:id/notes/:noteId", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const noteId = Number(req.params.noteId);
  const body = String(req.body?.body ?? "").trim();
  if (!body) return void res.status(400).json({ error: "Note body required" });

  const [existing] = await db.select().from(customerNotesTable).where(and(
    eq(customerNotesTable.id, noteId),
    eq(customerNotesTable.customerId, customerId),
    eq(customerNotesTable.restaurantId, restaurantId),
  ));
  if (!existing) return void res.status(404).json({ error: "Note not found" });

  // Only the original author may edit, and only within the edit window.
  const isAuthor = existing.authorUserId && existing.authorUserId === req.user?.sub;
  const isAdmin = req.user?.role === "owner" || req.user?.role === "manager" || req.user?.isSuperAdmin;
  const withinWindow = Date.now() - existing.createdAt.getTime() <= NOTE_EDIT_WINDOW_MS;
  if (!isAdmin && !(isAuthor && withinWindow)) {
    return void res.status(403).json({ error: "Notes can only be edited by the author within 15 minutes" });
  }

  const [updated] = await db.update(customerNotesTable).set({ body, updatedAt: new Date() })
    .where(eq(customerNotesTable.id, noteId)).returning();
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/customers/:id/notes/:noteId", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const noteId = Number(req.params.noteId);
  await db.delete(customerNotesTable).where(and(
    eq(customerNotesTable.id, noteId),
    eq(customerNotesTable.customerId, customerId),
    eq(customerNotesTable.restaurantId, restaurantId),
  ));
  res.status(204).send();
});

// ─── Complaints ────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/customers/:id/complaints", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const rows = await db.select({
    id: customerComplaintsTable.id,
    customerId: customerComplaintsTable.customerId,
    channel: customerComplaintsTable.channel,
    summary: customerComplaintsTable.summary,
    details: customerComplaintsTable.details,
    status: customerComplaintsTable.status,
    handledByUserId: customerComplaintsTable.handledByUserId,
    handledByName: usersTable.name,
    resolvedAt: customerComplaintsTable.resolvedAt,
    resolutionNotes: customerComplaintsTable.resolutionNotes,
    createdAt: customerComplaintsTable.createdAt,
    updatedAt: customerComplaintsTable.updatedAt,
  }).from(customerComplaintsTable)
    .leftJoin(usersTable, eq(usersTable.id, customerComplaintsTable.handledByUserId))
    .where(and(eq(customerComplaintsTable.customerId, customerId), eq(customerComplaintsTable.restaurantId, restaurantId)))
    .orderBy(desc(customerComplaintsTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/customers/:id/complaints", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const { channel, summary, details } = req.body as Record<string, unknown>;
  const sum = String(summary ?? "").trim();
  if (!sum) return void res.status(400).json({ error: "Complaint summary required" });
  const ch = typeof channel === "string" && (COMPLAINT_CHANNELS as readonly string[]).includes(channel) ? channel : "in_person";

  const [c] = await db.select({ id: customersTable.id }).from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Customer not found" });

  const [row] = await db.insert(customerComplaintsTable).values({
    customerId, restaurantId,
    channel: ch,
    summary: sum,
    details: typeof details === "string" ? details : null,
    handledByUserId: req.user?.sub ?? null,
  }).returning();
  await recordAuditLog({ req, module: "customers", action: "complaint_create", entity: "complaint", entityId: row.id, restaurantId, newValue: { summary: sum, channel: ch } });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/customers/:id/complaints/:complaintId", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const complaintId = Number(req.params.complaintId);
  const { status, resolutionNotes, summary, details, channel } = req.body as Record<string, unknown>;

  const [existing] = await db.select().from(customerComplaintsTable).where(and(
    eq(customerComplaintsTable.id, complaintId),
    eq(customerComplaintsTable.customerId, customerId),
    eq(customerComplaintsTable.restaurantId, restaurantId),
  ));
  if (!existing) return void res.status(404).json({ error: "Complaint not found" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status !== undefined) {
    if (!(COMPLAINT_STATUSES as readonly string[]).includes(String(status))) {
      return void res.status(400).json({ error: `status must be one of ${COMPLAINT_STATUSES.join(", ")}` });
    }
    updates.status = status;
    if (status === "resolved" && !existing.resolvedAt) {
      updates.resolvedAt = new Date();
      updates.handledByUserId = req.user?.sub ?? existing.handledByUserId;
    }
    if (status !== "resolved") updates.resolvedAt = null;
  }
  if (resolutionNotes !== undefined) updates.resolutionNotes = String(resolutionNotes);
  if (summary !== undefined) updates.summary = String(summary);
  if (details !== undefined) updates.details = String(details);
  if (channel !== undefined && (COMPLAINT_CHANNELS as readonly string[]).includes(String(channel))) updates.channel = channel;

  const [updated] = await db.update(customerComplaintsTable).set(updates)
    .where(eq(customerComplaintsTable.id, complaintId)).returning();
  await recordAuditLog({ req, module: "customers", action: "complaint_update", entity: "complaint", entityId: complaintId, restaurantId, oldValue: { status: existing.status }, newValue: { status: updates.status ?? existing.status } });
  res.json(updated);
});

// ─── Reviews aggregate ─────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/customers/:id/reviews", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!customer) return void res.status(404).json({ error: "Not found" });

  // Mirror the richer matching used by GET /customers/:id so the dedicated
  // reviews endpoint stays consistent with the profile aggregate.
  const feedbackConds: Parameters<typeof or>[0][] = [];
  if (customer.phone) feedbackConds.push(eq(customerFeedbackTable.customerPhone, customer.phone));
  if (customer.name) feedbackConds.push(sql`lower(${customerFeedbackTable.customerName}) = lower(${customer.name})`);
  const feedback = feedbackConds.length > 0
    ? await db.select().from(customerFeedbackTable)
      .where(and(eq(customerFeedbackTable.restaurantId, restaurantId), or(...feedbackConds)!))
      .orderBy(desc(customerFeedbackTable.createdAt))
      .limit(50)
    : [];

  const externalConds: Parameters<typeof or>[0][] = [];
  if (customer.name) externalConds.push(sql`lower(${externalReviewsTable.authorName}) = lower(${customer.name})`);
  if (customer.phone) externalConds.push(sql`${externalReviewsTable.body} ILIKE ${"%" + customer.phone + "%"}`);
  if (customer.email) externalConds.push(sql`${externalReviewsTable.body} ILIKE ${"%" + customer.email + "%"}`);
  const external = externalConds.length > 0
    ? await db.select({
        id: externalReviewsTable.id,
        rating: externalReviewsTable.rating,
        comment: externalReviewsTable.body,
        postedAt: externalReviewsTable.postedAt,
        source: externalReviewsTable.source,
        authorName: externalReviewsTable.authorName,
      }).from(externalReviewsTable)
      .where(and(eq(externalReviewsTable.restaurantId, restaurantId), or(...externalConds)!))
      .orderBy(desc(externalReviewsTable.postedAt))
      .limit(50)
    : [];
  res.json({ feedback, external });
});

// ─── Loyalty (unchanged) ───────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/customers/:id/loyalty", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!customer) return void res.status(404).json({ error: "Not found" });
  const transactions = await db.select().from(loyaltyTransactionsTable).where(and(eq(loyaltyTransactionsTable.customerId, customerId), eq(loyaltyTransactionsTable.restaurantId, restaurantId))).orderBy(desc(loyaltyTransactionsTable.createdAt)).limit(50);
  res.json({ balance: customer.loyaltyPoints, transactions });
});

router.post("/restaurants/:restaurantId/customers/:id/loyalty", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { points, type, reason, orderId } = req.body;
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);

  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!customer) return void res.status(404).json({ error: "Not found" });

  const delta = type === "redeem" ? -Math.abs(Number(points)) : Math.abs(Number(points));
  const newBalance = Math.max(0, customer.loyaltyPoints + delta);

  await db.update(customersTable).set({ loyaltyPoints: newBalance, updatedAt: new Date() }).where(eq(customersTable.id, customerId));
  const [tx] = await db.insert(loyaltyTransactionsTable).values({ customerId, restaurantId, points: delta, type: type ?? "earn", reason, orderId }).returning();
  res.status(201).json({ balance: newBalance, transaction: tx });
});

// ─── Coupons (unchanged) ───────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/coupons", async (req, res) => {
  const rows = await db.select().from(couponsTable).where(eq(couponsTable.restaurantId, Number(req.params.restaurantId)));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/coupons", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { code, discountType, discountValue, minOrderAmount, maxDiscountAmount, usageLimit, validFrom, validTo, force } = req.body;
  const restaurantId = Number(req.params.restaurantId);

  // Conflict pre-check: surface any other active coupon that overlaps in
  // validity window and discount type so the operator notices a stacking
  // risk *before* saving. Recorded into the audit log + offer_conflict_checks
  // table by the helper. Caller can pass `force:true` to override.
  try {
    const { detectCouponConflictsBeforeSave } = await import("./advanced-growth");
    const newFrom = validFrom ? new Date(validFrom) : new Date();
    const newTo = validTo ? new Date(validTo) : null;
    const conflicts = await detectCouponConflictsBeforeSave({
      restaurantId, code: String(code).toUpperCase(), discountType, validFrom: newFrom, validTo: newTo,
    });
    if (conflicts.length > 0 && !force) {
      res.status(409).json({ error: "Offer conflict detected", conflicts, hint: "Resubmit with force:true to save anyway." });
      return;
    }
  } catch (err) {
    // Conflict check is best-effort — never block coupon creation if the
    // advanced-growth module is unavailable in this build. Log so an
    // operator can investigate when the safeguard silently goes offline.
    logger.warn({ err, restaurantId, code }, "[coupon.save] offer-conflict precheck failed; allowing save");
  }

  const [coupon] = await db.insert(couponsTable).values({ restaurantId, code: code.toUpperCase(), discountType, discountValue, minOrderAmount, maxDiscountAmount, usageLimit, validFrom: validFrom ? new Date(validFrom) : new Date(), validTo: validTo ? new Date(validTo) : undefined }).returning();
  res.status(201).json(coupon);
});

router.patch("/restaurants/:restaurantId/coupons/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { isActive, validTo, usageLimit } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (isActive !== undefined) updates.isActive = isActive;
  if (validTo) updates.validTo = new Date(validTo);
  if (usageLimit !== undefined) updates.usageLimit = usageLimit;
  const [updated] = await db.update(couponsTable).set(updates).where(and(eq(couponsTable.id, Number(req.params.id)), eq(couponsTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/coupons/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.update(couponsTable).set({ isActive: false }).where(and(eq(couponsTable.id, Number(req.params.id)), eq(couponsTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

router.post("/restaurants/:restaurantId/coupons/validate", async (req, res) => {
  const { code, orderAmount } = req.body;
  const restaurantId = Number(req.params.restaurantId);
  const now = new Date();

  const [coupon] = await db.select().from(couponsTable).where(and(eq(couponsTable.restaurantId, restaurantId), eq(couponsTable.code, code.toUpperCase()), eq(couponsTable.isActive, true)));
  if (!coupon) return void res.json({ valid: false, discountAmount: "0.00", message: "Invalid coupon code" });
  if (coupon.validTo && new Date(coupon.validTo) < now) return void res.json({ valid: false, discountAmount: "0.00", message: "Coupon expired" });
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) return void res.json({ valid: false, discountAmount: "0.00", message: "Coupon usage limit reached" });
  if (coupon.minOrderAmount && Number(orderAmount) < Number(coupon.minOrderAmount)) return void res.json({ valid: false, discountAmount: "0.00", message: `Minimum order amount is ${coupon.minOrderAmount}` });

  let discount = 0;
  if (coupon.discountType === "percentage") discount = (Number(orderAmount) * Number(coupon.discountValue)) / 100;
  else discount = Number(coupon.discountValue);
  if (coupon.maxDiscountAmount) discount = Math.min(discount, Number(coupon.maxDiscountAmount));

  // Margin-floor enforcement: if any active floor would be breached by this
  // discounted order, block the coupon. An override is permitted only when
  // ALL of the following are true:
  //   1. The caller is authenticated as owner / manager / super_admin
  //   2. The caller supplies a non-empty `overrideReason`
  //   3. The caller sets `acceptMarginRisk:true` (explicit opt-in)
  // Every override is recorded in the audit log. Infra errors fail-open
  // (don't block the till) but never fail-open on a successful violation.
  let marginWarning: { floorPct: number; effectivePct: number; message: string } | null = null;
  try {
    const { enforceMarginFloorAtCheckout, recordMarginOverrideAudit } = await import("./advanced-growth");
    const effectiveAmount = Number(orderAmount) - discount;
    const check = await enforceMarginFloorAtCheckout({
      restaurantId, orderAmount: Number(orderAmount), discountedAmount: effectiveAmount,
    });
    if (check.violates) {
      const body = (req.body ?? {}) as { acceptMarginRisk?: unknown; overrideReason?: unknown };
      const wantsOverride = Boolean(body.acceptMarginRisk);
      const reason = typeof body.overrideReason === "string" ? body.overrideReason.trim() : "";
      const reqUser = (req as { user?: { role?: string; isSuperAdmin?: boolean } }).user;
      const isManager = !!reqUser && (reqUser.isSuperAdmin || reqUser.role === "owner" || reqUser.role === "manager" || reqUser.role === "super_admin");
      if (!wantsOverride) {
        return void res.json({
          valid: false, discountAmount: "0.00",
          message: `This discount drops effective margin to ${check.effectivePct.toFixed(1)}% — below the configured floor of ${check.floorPct.toFixed(1)}%. A manager override (acceptMarginRisk + overrideReason) is required to apply.`,
          marginViolation: { floorPct: check.floorPct, effectivePct: check.effectivePct },
        });
      }
      if (!isManager) {
        return void res.status(403).json({
          valid: false, discountAmount: "0.00",
          error: "Manager role required to override margin floor",
          marginViolation: { floorPct: check.floorPct, effectivePct: check.effectivePct },
        });
      }
      if (reason.length < 5) {
        return void res.status(400).json({
          valid: false, discountAmount: "0.00",
          error: "overrideReason of at least 5 characters required",
          marginViolation: { floorPct: check.floorPct, effectivePct: check.effectivePct },
        });
      }
      await recordMarginOverrideAudit({
        req, restaurantId, code: String(code).toUpperCase(), orderAmount: Number(orderAmount),
        discountedAmount: effectiveAmount, floorPct: check.floorPct, effectivePct: check.effectivePct, reason,
      });
      marginWarning = { floorPct: check.floorPct, effectivePct: check.effectivePct, message: "Manager override applied; reason recorded in audit log." };
    }
  } catch (err) {
    // Margin enforcement is a guardrail, not a hard dependency — if the
    // floor lookup itself errors we log and fall through so the till keeps
    // working. Successful violations above still block deterministically.
    logger.warn({ err, restaurantId, code }, "[coupon.validate] margin-floor enforcement errored; allowing checkout");
  }

  res.json({ valid: true, discountAmount: discount.toFixed(2), message: marginWarning?.message ?? null, marginWarning });
});

// ─── Addresses (unchanged) ─────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/customers/:id/addresses", async (req, res) => {
  const customerId = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);
  const addresses = await db.select().from(customerAddressesTable)
    .where(and(eq(customerAddressesTable.customerId, customerId), eq(customerAddressesTable.restaurantId, restaurantId)))
    .orderBy(desc(customerAddressesTable.createdAt));
  res.json(addresses);
});

router.post("/restaurants/:restaurantId/customers/:id/addresses", async (req, res) => {
  const customerId = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);
  const { address, label, isDefault } = req.body;
  if (isDefault) {
    await db.update(customerAddressesTable).set({ isDefault: false })
      .where(and(eq(customerAddressesTable.customerId, customerId), eq(customerAddressesTable.restaurantId, restaurantId)));
  }
  const [newAddr] = await db.insert(customerAddressesTable).values({
    customerId, restaurantId, address, label: label ?? "Home", isDefault: isDefault ?? false,
  }).returning();
  res.status(201).json(newAddr);
});

router.patch("/restaurants/:restaurantId/customers/:id/addresses/:addressId", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const customerId = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);
  const addressId = Number(req.params.addressId);
  const { address, label, isDefault } = req.body;
  if (isDefault) {
    await db.update(customerAddressesTable).set({ isDefault: false })
      .where(and(eq(customerAddressesTable.customerId, customerId), eq(customerAddressesTable.restaurantId, restaurantId)));
  }
  const updates: Record<string, unknown> = {};
  if (address !== undefined) updates.address = address;
  if (label !== undefined) updates.label = label;
  if (isDefault !== undefined) updates.isDefault = isDefault;
  const [updated] = await db.update(customerAddressesTable).set(updates)
    .where(and(
      eq(customerAddressesTable.id, addressId),
      eq(customerAddressesTable.customerId, customerId),
      eq(customerAddressesTable.restaurantId, restaurantId),
    )).returning();
  if (!updated) return void res.status(404).json({ error: "Address not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/customers/:id/addresses/:addressId", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const customerId = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);
  const addressId = Number(req.params.addressId);
  await db.delete(customerAddressesTable)
    .where(and(
      eq(customerAddressesTable.id, addressId),
      eq(customerAddressesTable.customerId, customerId),
      eq(customerAddressesTable.restaurantId, restaurantId),
    ));
  res.status(204).send();
});

// ─── Notifications (unchanged) ─────────────────────────────────────────────

router.get("/restaurants/:restaurantId/notifications", async (req, res) => {
  const { unreadOnly } = req.query;
  const restaurantId = Number(req.params.restaurantId);
  const conditions: ReturnType<typeof eq>[] = [eq(notificationsTable.restaurantId, restaurantId)];
  if (unreadOnly === "true") conditions.push(eq(notificationsTable.isRead, false));
  const rows = await db.select().from(notificationsTable).where(and(...conditions)).orderBy(desc(notificationsTable.createdAt)).limit(50);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/notifications/send", requireRole("owner", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { type, title, message, entityId, entityType, emailRecipients, whatsappRecipients } = req.body as {
    type: string;
    title: string;
    message: string;
    entityId?: number;
    entityType?: string;
    emailRecipients?: string[];
    whatsappRecipients?: string[];
  };

  if (!type || !title || !message) {
    return void res.status(400).json({ error: "type, title, and message are required" });
  }

  const [notification] = await db.insert(notificationsTable).values({
    restaurantId,
    type,
    title,
    message,
    entityId: entityId ?? null,
    entityType: entityType ?? null,
  }).returning();

  const { broadcastEvent } = await import("../lib/socketio");
  broadcastEvent(restaurantId, "notification:new", { type, id: notification.id });

  if (emailRecipients?.length) {
    const { sendEmail } = await import("../lib/notifications");
    for (const to of emailRecipients) {
      sendEmail({ to, subject: title, html: `<p>${message}</p>`, text: message }).catch(console.error);
    }
  }

  if (whatsappRecipients?.length) {
    const { sendWhatsApp } = await import("../lib/notifications");
    for (const to of whatsappRecipients) {
      sendWhatsApp({ to, body: `${title}: ${message}` }).catch(console.error);
    }
  }

  res.status(201).json(notification);
});

router.post("/restaurants/:restaurantId/notifications/mark-read", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const { ids, all } = req.body;
  const restaurantId = Number(req.params.restaurantId);
  if (all) {
    const result = await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.restaurantId, restaurantId));
    return void res.json({ updated: result.rowCount ?? 0 });
  }
  if (ids?.length) {
    let updated = 0;
    for (const id of ids as number[]) {
      await db.update(notificationsTable).set({ isRead: true }).where(and(eq(notificationsTable.id, id), eq(notificationsTable.restaurantId, restaurantId)));
      updated++;
    }
    return void res.json({ updated });
  }
  res.json({ updated: 0 });
});

export default router;
