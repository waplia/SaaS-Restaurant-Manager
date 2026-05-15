import { Router, type IRouter } from "express";
import { eq, desc, and, ilike, or, sql, gte, lte, inArray } from "drizzle-orm";
import {
  db,
  leadsTable,
  leadNotesTable,
  leadActivityTable,
  blogPostsTable,
  subscriptionPlansTable,
  usersTable,
  tenantsTable,
  restaurantsTable,
  branchesTable,
} from "../lib/db";
import { authenticate } from "../middleware/authenticate";
import { sendSmsMessage } from "../lib/smsSender";
import { hashPassword } from "../lib/auth";
import { sendEmail, sendSms, sendWhatsApp } from "../lib/notifications";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Public: subscription plans (active only) ─────────────────
router.get("/marketing/plans", async (_req, res) => {
  const rows = await db
    .select()
    .from(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.isActive, true))
    .orderBy(subscriptionPlansTable.price);
  res.json(rows);
});

// ── Public: blog listing & detail ────────────────────────────
router.get("/blog/posts", async (req, res) => {
  const { category, q, limit } = req.query as { category?: string; q?: string; limit?: string };
  const conds = [eq(blogPostsTable.published, true)];
  if (category && category !== "all") conds.push(eq(blogPostsTable.category, category));
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    conds.push(or(ilike(blogPostsTable.title, term), ilike(blogPostsTable.excerpt, term))!);
  }
  const max = Math.min(Number(limit) || 50, 100);
  const rows = await db
    .select()
    .from(blogPostsTable)
    .where(and(...conds))
    .orderBy(desc(blogPostsTable.publishedAt))
    .limit(max);
  res.json(rows);
});

router.get("/blog/posts/:slug", async (req, res) => {
  const [post] = await db
    .select()
    .from(blogPostsTable)
    .where(and(eq(blogPostsTable.slug, req.params.slug), eq(blogPostsTable.published, true)));
  if (!post) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const related = await db
    .select()
    .from(blogPostsTable)
    .where(and(eq(blogPostsTable.published, true), eq(blogPostsTable.category, post.category)))
    .orderBy(desc(blogPostsTable.publishedAt))
    .limit(4);
  res.json({ post, related: related.filter((r) => r.id !== post.id).slice(0, 3) });
});

// ── Public: lead capture (with anti-spam) ────────────────────
const recentSubmissions = new Map<string, number>();
const RATE_LIMIT_MS = 10_000;

router.post("/leads", async (req, res) => {
  const body = req.body as Record<string, unknown>;

  // Honeypot field — bots fill it in
  if (typeof body.website === "string" && body.website.length > 0) {
    res.status(200).json({ success: true });
    return;
  }

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  const last = recentSubmissions.get(ip) ?? 0;
  if (Date.now() - last < RATE_LIMIT_MS) {
    res.status(429).json({ error: "Too many submissions, please wait a moment." });
    return;
  }
  recentSubmissions.set(ip, Date.now());

  const name = String(body.name ?? "").trim().slice(0, 200);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  if (!name || !email || !/.+@.+\..+/.test(email)) {
    res.status(400).json({ error: "Name and a valid email are required." });
    return;
  }

  const outletCount = body.outletCount != null && body.outletCount !== "" ? Math.max(0, Math.min(9999, Number(body.outletCount) || 0)) : null;

  const [lead] = await db
    .insert(leadsTable)
    .values({
      name,
      email,
      restaurantName: body.restaurantName ? String(body.restaurantName).slice(0, 200) : null,
      phone: body.phone ? String(body.phone).slice(0, 50) : null,
      city: body.city ? String(body.city).slice(0, 120) : null,
      outletCount,
      businessType: body.businessType ? String(body.businessType).slice(0, 80) : null,
      currentSoftware: body.currentSoftware ? String(body.currentSoftware).slice(0, 200) : null,
      preferredDateTime: body.preferredDateTime ? String(body.preferredDateTime).slice(0, 120) : null,
      features: body.features ? String(body.features).slice(0, 2000) : null,
      message: body.message ? String(body.message).slice(0, 4000) : null,
      sourcePage: body.sourcePage ? String(body.sourcePage).slice(0, 120) : "contact",
    })
    .returning();

  await db.insert(leadActivityTable).values({
    leadId: lead.id,
    actorId: null,
    type: "created",
    payload: { source: lead.sourcePage },
  });

  // Lifecycle SMS — confirm demo booked. Best-effort, never blocks the lead.
  if (lead.phone) {
    void sendSmsMessage({
      to: lead.phone,
      eventKey: "demo_booked",
      variables: {
        name: lead.name,
        when: lead.preferredDateTime ?? "soon",
        restaurant: lead.restaurantName ?? "your restaurant",
      },
    });
  }

  res.status(201).json({ success: true, id: lead.id });
});

// ─────────────────────────────────────────────────────────────
// Admin (super_admin only): lead management
// ─────────────────────────────────────────────────────────────
const adminRouter: IRouter = Router();
adminRouter.use("/admin", authenticate);
adminRouter.use("/admin", (req, res, next) => {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
});

function endOfDay(input: string): Date {
  const d = new Date(input);
  if (isNaN(d.getTime())) return new Date(input);
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) d.setUTCHours(23, 59, 59, 999);
  return d;
}

const ALLOWED_STATUSES = ["new", "contacted", "demo_scheduled", "trial_created", "converted", "lost"] as const;
type Status = typeof ALLOWED_STATUSES[number];
const STATUS_SET = new Set<Status>(ALLOWED_STATUSES);

const STATUS_TRANSITIONS: Record<Status, Status[]> = {
  new: ["contacted", "demo_scheduled", "trial_created", "converted", "lost"],
  contacted: ["demo_scheduled", "trial_created", "converted", "lost", "new"],
  demo_scheduled: ["contacted", "trial_created", "converted", "lost"],
  trial_created: ["contacted", "demo_scheduled", "converted", "lost"],
  converted: [],
  lost: ["new", "contacted"],
};

function isChannelConfigured(channel: "email" | "sms" | "whatsapp"): boolean {
  if (channel === "email") return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  if (channel === "sms") return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM);
  if (channel === "whatsapp") return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  return false;
}

async function logActivity(leadId: number, actorId: number | null, type: string, payload?: Record<string, unknown>) {
  await db.insert(leadActivityTable).values({ leadId, actorId, type, payload: payload ?? null });
}

// List leads with filters
adminRouter.get("/admin/leads", async (req, res) => {
  const { status, source, assignee, q, from, to, limit } = req.query as {
    status?: string; source?: string; assignee?: string; q?: string; from?: string; to?: string; limit?: string;
  };
  const conds = [];
  if (status && status !== "all") {
    if (status.includes(",")) {
      conds.push(inArray(leadsTable.status, status.split(",").filter(Boolean)));
    } else {
      conds.push(eq(leadsTable.status, status));
    }
  }
  if (source && source !== "all") conds.push(eq(leadsTable.sourcePage, source));
  if (assignee && assignee !== "all") {
    if (assignee === "unassigned") conds.push(sql`${leadsTable.assignedTo} IS NULL`);
    else conds.push(eq(leadsTable.assignedTo, Number(assignee)));
  }
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    conds.push(or(
      ilike(leadsTable.name, term),
      ilike(leadsTable.email, term),
      ilike(leadsTable.restaurantName, term),
      ilike(leadsTable.phone, term),
    )!);
  }
  if (from) conds.push(gte(leadsTable.createdAt, new Date(from)));
  if (to) conds.push(lte(leadsTable.createdAt, endOfDay(to)));

  const max = Math.min(Number(limit) || 500, 2000);
  const rows = await db
    .select({
      id: leadsTable.id,
      name: leadsTable.name,
      restaurantName: leadsTable.restaurantName,
      phone: leadsTable.phone,
      email: leadsTable.email,
      city: leadsTable.city,
      outletCount: leadsTable.outletCount,
      businessType: leadsTable.businessType,
      currentSoftware: leadsTable.currentSoftware,
      preferredDateTime: leadsTable.preferredDateTime,
      features: leadsTable.features,
      message: leadsTable.message,
      sourcePage: leadsTable.sourcePage,
      status: leadsTable.status,
      notes: leadsTable.notes,
      assignedTo: leadsTable.assignedTo,
      assignedToName: usersTable.name,
      followUpAt: leadsTable.followUpAt,
      followUpNote: leadsTable.followUpNote,
      convertedRestaurantId: leadsTable.convertedRestaurantId,
      createdAt: leadsTable.createdAt,
      updatedAt: leadsTable.updatedAt,
    })
    .from(leadsTable)
    .leftJoin(usersTable, eq(usersTable.id, leadsTable.assignedTo))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(leadsTable.createdAt))
    .limit(max);
  res.json(rows);
});

// Stats — counts per status (always returns all 6)
adminRouter.get("/admin/leads/stats", async (_req, res) => {
  const rows = await db
    .select({ status: leadsTable.status, count: sql<number>`count(*)::int` })
    .from(leadsTable)
    .groupBy(leadsTable.status);
  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  const byStatus = ALLOWED_STATUSES.map((s) => ({
    status: s,
    count: Number(rows.find((r) => r.status === s)?.count ?? 0),
  }));
  res.json({
    total,
    byStatus,
    channels: {
      email: isChannelConfigured("email"),
      sms: isChannelConfigured("sms"),
      whatsapp: isChannelConfigured("whatsapp"),
    },
  });
});

// Assignable internal users (super admins + owners + managers)
adminRouter.get("/admin/leads/assignees", async (_req, res) => {
  const rows = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, isSuperAdmin: usersTable.isSuperAdmin })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.isActive, true),
        or(eq(usersTable.isSuperAdmin, true), inArray(usersTable.role, ["owner", "manager", "admin"])),
      ),
    )
    .orderBy(desc(usersTable.isSuperAdmin), usersTable.name)
    .limit(100);
  res.json(rows);
});

// CSV export — must be registered BEFORE "/admin/leads/:id" so Express does
// not match "export.csv" as the :id parameter.
adminRouter.get("/admin/leads/export.csv", async (req, res) => {
  const { status, source, assignee, q, from, to } = req.query as {
    status?: string; source?: string; assignee?: string; q?: string; from?: string; to?: string;
  };
  const conds = [];
  if (status && status !== "all") {
    if (status.includes(",")) conds.push(inArray(leadsTable.status, status.split(",").filter(Boolean)));
    else conds.push(eq(leadsTable.status, status));
  }
  if (source && source !== "all") conds.push(eq(leadsTable.sourcePage, source));
  if (assignee && assignee !== "all") {
    if (assignee === "unassigned") conds.push(sql`${leadsTable.assignedTo} IS NULL`);
    else conds.push(eq(leadsTable.assignedTo, Number(assignee)));
  }
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    conds.push(or(
      ilike(leadsTable.name, term),
      ilike(leadsTable.email, term),
      ilike(leadsTable.restaurantName, term),
      ilike(leadsTable.phone, term),
    )!);
  }
  if (from) conds.push(gte(leadsTable.createdAt, new Date(from)));
  if (to) conds.push(lte(leadsTable.createdAt, endOfDay(to)));

  const rows = await db
    .select({
      id: leadsTable.id,
      name: leadsTable.name,
      email: leadsTable.email,
      phone: leadsTable.phone,
      restaurantName: leadsTable.restaurantName,
      city: leadsTable.city,
      businessType: leadsTable.businessType,
      outletCount: leadsTable.outletCount,
      sourcePage: leadsTable.sourcePage,
      status: leadsTable.status,
      assignedToName: usersTable.name,
      followUpAt: leadsTable.followUpAt,
      createdAt: leadsTable.createdAt,
    })
    .from(leadsTable)
    .leftJoin(usersTable, eq(usersTable.id, leadsTable.assignedTo))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(leadsTable.createdAt))
    .limit(10000);

  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const headers = ["id", "name", "email", "phone", "restaurant", "city", "business_type", "outlets", "source", "status", "assigned_to", "follow_up_at", "created_at"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.id, r.name, r.email, r.phone, r.restaurantName, r.city, r.businessType, r.outletCount,
      r.sourcePage, r.status, r.assignedToName, r.followUpAt, r.createdAt,
    ].map(escape).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join("\n"));
});

// Single lead with notes & activity
adminRouter.get("/admin/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [lead] = await db
    .select({
      id: leadsTable.id,
      name: leadsTable.name,
      restaurantName: leadsTable.restaurantName,
      phone: leadsTable.phone,
      email: leadsTable.email,
      city: leadsTable.city,
      outletCount: leadsTable.outletCount,
      businessType: leadsTable.businessType,
      currentSoftware: leadsTable.currentSoftware,
      preferredDateTime: leadsTable.preferredDateTime,
      features: leadsTable.features,
      message: leadsTable.message,
      sourcePage: leadsTable.sourcePage,
      status: leadsTable.status,
      notes: leadsTable.notes,
      assignedTo: leadsTable.assignedTo,
      assignedToName: usersTable.name,
      followUpAt: leadsTable.followUpAt,
      followUpNote: leadsTable.followUpNote,
      convertedRestaurantId: leadsTable.convertedRestaurantId,
      createdAt: leadsTable.createdAt,
      updatedAt: leadsTable.updatedAt,
    })
    .from(leadsTable)
    .leftJoin(usersTable, eq(usersTable.id, leadsTable.assignedTo))
    .where(eq(leadsTable.id, id));
  if (!lead) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const notes = await db
    .select({
      id: leadNotesTable.id,
      body: leadNotesTable.body,
      authorId: leadNotesTable.authorId,
      authorName: usersTable.name,
      createdAt: leadNotesTable.createdAt,
    })
    .from(leadNotesTable)
    .leftJoin(usersTable, eq(usersTable.id, leadNotesTable.authorId))
    .where(eq(leadNotesTable.leadId, id))
    .orderBy(desc(leadNotesTable.createdAt));
  const activity = await db
    .select({
      id: leadActivityTable.id,
      type: leadActivityTable.type,
      payload: leadActivityTable.payload,
      actorId: leadActivityTable.actorId,
      actorName: usersTable.name,
      createdAt: leadActivityTable.createdAt,
    })
    .from(leadActivityTable)
    .leftJoin(usersTable, eq(usersTable.id, leadActivityTable.actorId))
    .where(eq(leadActivityTable.leadId, id))
    .orderBy(desc(leadActivityTable.createdAt))
    .limit(200);
  res.json({ lead, notes, activity });
});

// Update status / notes blob (legacy patch)
adminRouter.patch("/admin/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { status, notes } = req.body as { status?: string; notes?: string };
  const update: Partial<typeof leadsTable.$inferInsert> = { updatedAt: new Date() };
  const [current] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (status && STATUS_SET.has(status as Status)) {
    if (status !== current.status) {
      const allowed = STATUS_TRANSITIONS[current.status as Status] ?? [];
      if (!allowed.includes(status as Status)) {
        res.status(400).json({ error: `Cannot move from "${current.status}" to "${status}"` });
        return;
      }
      update.status = status;
    }
  }
  if (typeof notes === "string") update.notes = notes.slice(0, 4000);
  const [row] = await db.update(leadsTable).set(update).where(eq(leadsTable.id, id)).returning();
  if (status && status !== current.status) {
    await logActivity(id, req.user!.sub, "status_changed", { from: current.status, to: status });
    logger.info({ leadId: id, by: req.user!.sub, from: current.status, to: status }, "lead.status_changed");
  }
  res.json(row);
});

// Add a dated note (timeline)
adminRouter.post("/admin/leads/:id/notes", async (req, res) => {
  const id = Number(req.params.id);
  const body = String((req.body as { body?: string }).body ?? "").trim();
  if (!Number.isFinite(id) || !body) {
    res.status(400).json({ error: "Note body is required" });
    return;
  }
  const [exists] = await db.select({ id: leadsTable.id }).from(leadsTable).where(eq(leadsTable.id, id));
  if (!exists) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [note] = await db.insert(leadNotesTable).values({
    leadId: id,
    authorId: req.user!.sub,
    body: body.slice(0, 4000),
  }).returning();
  await logActivity(id, req.user!.sub, "note_added", { noteId: note.id });
  res.status(201).json(note);
});

// Assignee
adminRouter.post("/admin/leads/:id/assignee", async (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body as { userId?: number | null };
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [current] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  let resolvedId: number | null = null;
  if (userId != null) {
    const [u] = await db
      .select({ id: usersTable.id, isActive: usersTable.isActive, isSuperAdmin: usersTable.isSuperAdmin, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, Number(userId)));
    if (!u) {
      res.status(400).json({ error: "User not found" });
      return;
    }
    if (!u.isActive) {
      res.status(400).json({ error: "User is not active" });
      return;
    }
    if (!u.isSuperAdmin && !["owner", "manager", "admin"].includes(u.role)) {
      res.status(400).json({ error: "User is not eligible to be assigned leads" });
      return;
    }
    resolvedId = u.id;
  }
  const [row] = await db.update(leadsTable)
    .set({ assignedTo: resolvedId, updatedAt: new Date() })
    .where(eq(leadsTable.id, id))
    .returning();
  await logActivity(id, req.user!.sub, "assignment_changed", { from: current.assignedTo, to: resolvedId });
  logger.info({ leadId: id, by: req.user!.sub, to: resolvedId }, "lead.assigned");
  res.json(row);
});

// Schedule / clear follow-up
adminRouter.post("/admin/leads/:id/follow-up", async (req, res) => {
  const id = Number(req.params.id);
  const { at, note } = req.body as { at?: string | null; note?: string | null };
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  let when: Date | null = null;
  if (at) {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ error: "Invalid date" });
      return;
    }
    when = d;
  }
  const [row] = await db.update(leadsTable)
    .set({ followUpAt: when, followUpNote: note ? String(note).slice(0, 1000) : null, updatedAt: new Date() })
    .where(eq(leadsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await logActivity(id, req.user!.sub, when ? "follow_up_scheduled" : "follow_up_cleared", { at: when?.toISOString() ?? null, note: note ?? null });
  res.json(row);
});

// Status change (separate from PATCH so the UI can request transitions cleanly)
adminRouter.post("/admin/leads/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const status = String((req.body as { status?: string }).status ?? "");
  if (!Number.isFinite(id) || !STATUS_SET.has(status as Status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  const [current] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (status === current.status) {
    res.json(current);
    return;
  }
  const allowed = STATUS_TRANSITIONS[current.status as Status] ?? [];
  if (!allowed.includes(status as Status)) {
    res.status(400).json({ error: `Cannot move from "${current.status}" to "${status}"` });
    return;
  }
  const [row] = await db.update(leadsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(leadsTable.id, id))
    .returning();
  await logActivity(id, req.user!.sub, "status_changed", { from: current.status, to: status });
  res.json(row);
});

// Send Email / SMS / WhatsApp from a lead
adminRouter.post("/admin/leads/:id/send", async (req, res) => {
  const id = Number(req.params.id);
  const { channel, subject, body } = req.body as { channel?: string; subject?: string; body?: string };
  if (!Number.isFinite(id) || !channel || !body) {
    res.status(400).json({ error: "channel and body are required" });
    return;
  }
  if (!["email", "sms", "whatsapp"].includes(channel)) {
    res.status(400).json({ error: "Invalid channel" });
    return;
  }
  if (!isChannelConfigured(channel as "email" | "sms" | "whatsapp")) {
    res.status(400).json({ error: `${channel} provider is not configured. Configure it in Settings first.` });
    return;
  }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  let status = "sent";
  let providerRef: string | null = null;
  let errorMsg: string | null = null;
  try {
    if (channel === "email") {
      if (!lead.email) throw new Error("Lead has no email address");
      const subj = (subject ?? "Hello from Khana Lagao").slice(0, 200);
      const html = `<div style="font-family:sans-serif">${String(body).replace(/\n/g, "<br/>")}</div>`;
      const r = await sendEmail({ to: lead.email, subject: subj, html, text: String(body) });
      providerRef = r.messageId;
    } else if (channel === "sms") {
      if (!lead.phone) throw new Error("Lead has no phone number");
      const r = await sendSms({ to: lead.phone, body: String(body) });
      providerRef = r.sid;
    } else {
      if (!lead.phone) throw new Error("Lead has no phone number");
      const r = await sendWhatsApp({ to: lead.phone, body: String(body) });
      providerRef = r.sid;
    }
  } catch (err) {
    status = "failed";
    errorMsg = (err as Error).message;
  }

  await logActivity(id, req.user!.sub, `message_${channel}`, {
    channel, subject: subject ?? null, body: String(body).slice(0, 2000),
    status, providerRef, error: errorMsg,
  });

  if (status === "failed") {
    res.status(502).json({ error: errorMsg ?? "Failed to send" });
    return;
  }
  res.json({ success: true, providerRef });
});

// Convert lead → restaurant tenant + owner
adminRouter.post("/admin/leads/:id/convert", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (lead.convertedRestaurantId) {
    res.status(409).json({ error: "Lead is already converted." });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const restaurantName = String(body.restaurantName ?? lead.restaurantName ?? lead.name ?? "").trim();
  const ownerName = String(body.ownerName ?? lead.name ?? "").trim();
  const email = String(body.email ?? lead.email ?? "").trim().toLowerCase();
  const phone = body.phone ? String(body.phone).trim() : (lead.phone ?? null);
  const city = body.city ? String(body.city).trim() : (lead.city ?? null);
  const password = String(body.password ?? "").trim();
  const planSlug = body.planSlug ? String(body.planSlug) : "free-trial";

  if (!restaurantName || !ownerName || !email) {
    res.status(400).json({ error: "restaurantName, ownerName and email are required." });
    return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: "A password of at least 8 characters is required for the new owner." });
    return;
  }

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }

  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.slug, planSlug));
  const baseSlug = restaurantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "restaurant";
  const uniqueSuffix = Date.now();
  const trialEndsAt = new Date(Date.now() + (plan?.trialDays ?? 14) * 24 * 60 * 60 * 1000);

  const passwordHash = await hashPassword(password);
  const { tenant, restaurant, owner, updated } = await db.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenantsTable).values({
      name: restaurantName,
      slug: `${baseSlug}-${uniqueSuffix}`,
      planId: plan?.id ?? null,
      planStatus: planSlug === "free-trial" ? "trial" : "active",
      trialEndsAt: planSlug === "free-trial" ? trialEndsAt : null,
      isActive: true,
    }).returning();

    const [restaurant] = await tx.insert(restaurantsTable).values({
      tenantId: tenant.id,
      name: restaurantName,
      slug: `${baseSlug}-r-${uniqueSuffix}`,
      phone: phone ?? undefined,
      email,
      city: city ?? undefined,
    }).returning();

    await tx.insert(branchesTable).values({
      restaurantId: restaurant.id,
      name: "Main",
      isMain: true,
      isActive: true,
    });

    const [owner] = await tx.insert(usersTable).values({
      name: ownerName,
      email,
      passwordHash,
      phone: phone ?? null,
      role: "owner",
      tenantId: tenant.id,
      restaurantId: restaurant.id,
      isActive: true,
    }).returning();

    const [updated] = await tx.update(leadsTable)
      .set({
        status: "converted",
        convertedRestaurantId: restaurant.id,
        updatedAt: new Date(),
      })
      .where(eq(leadsTable.id, id))
      .returning();

    return { tenant, restaurant, owner, updated };
  });

  await logActivity(id, req.user!.sub, "converted", {
    restaurantId: restaurant.id,
    tenantId: tenant.id,
    ownerUserId: owner.id,
    planSlug,
  });
  logger.info({ leadId: id, restaurantId: restaurant.id, by: req.user!.sub }, "lead.converted");

  res.status(201).json({
    lead: updated,
    restaurant: { id: restaurant.id, name: restaurant.name, slug: restaurant.slug },
    tenant: { id: tenant.id, name: tenant.name },
    owner: { id: owner.id, email: owner.email },
  });
});

// ── Admin: blog post management ───────────────────────────────
adminRouter.get("/admin/blog/posts", async (_req, res) => {
  const rows = await db.select().from(blogPostsTable).orderBy(desc(blogPostsTable.createdAt)).limit(500);
  res.json(rows);
});

adminRouter.post("/admin/blog/posts", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const slug = String(body.slug ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const title = String(body.title ?? "").trim();
  const content = String(body.content ?? "").trim();
  if (!slug || !title || !content) {
    res.status(400).json({ error: "slug, title, and content are required" });
    return;
  }
  try {
    const [row] = await db
      .insert(blogPostsTable)
      .values({
        slug,
        title: title.slice(0, 300),
        content,
        excerpt: body.excerpt ? String(body.excerpt).slice(0, 500) : null,
        coverImage: body.coverImage ? String(body.coverImage).slice(0, 500) : null,
        category: body.category ? String(body.category).slice(0, 80) : "guides",
        tags: body.tags ? String(body.tags).slice(0, 500) : null,
        author: body.author ? String(body.author).slice(0, 120) : "Khana Lagao Team",
        readMinutes: Number(body.readMinutes) || 5,
        published: body.published !== false,
      })
      .returning();
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "Slug already exists" });
  }
});

adminRouter.patch("/admin/blog/posts/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const update: Partial<typeof blogPostsTable.$inferInsert> = { updatedAt: new Date() };
  if (body.title) update.title = String(body.title).slice(0, 300);
  if (body.content !== undefined) update.content = String(body.content);
  if (body.excerpt !== undefined) update.excerpt = body.excerpt ? String(body.excerpt).slice(0, 500) : null;
  if (body.coverImage !== undefined) update.coverImage = body.coverImage ? String(body.coverImage).slice(0, 500) : null;
  if (body.category) update.category = String(body.category).slice(0, 80);
  if (body.tags !== undefined) update.tags = body.tags ? String(body.tags).slice(0, 500) : null;
  if (body.author) update.author = String(body.author).slice(0, 120);
  if (body.readMinutes != null) update.readMinutes = Number(body.readMinutes) || 5;
  if (typeof body.published === "boolean") update.published = body.published;
  const [row] = await db.update(blogPostsTable).set(update).where(eq(blogPostsTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

adminRouter.delete("/admin/blog/posts/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(blogPostsTable).where(eq(blogPostsTable.id, id));
  res.status(204).end();
});

export default router;
export { adminRouter as marketingAdminRouter };
