import { Router, type IRouter } from "express";
import { eq, desc, and, ilike, or, sql } from "drizzle-orm";
import { db, leadsTable, blogPostsTable } from "../lib/db";
import { authenticate } from "../middleware/authenticate";

const router: IRouter = Router();

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

  res.status(201).json({ success: true, id: lead.id });
});

// ── Admin (super_admin only): lead management ─────────────────
const adminRouter: IRouter = Router();
adminRouter.use(authenticate);
adminRouter.use((req, res, next) => {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
});

adminRouter.get("/admin/leads", async (req, res) => {
  const { status, q } = req.query as { status?: string; q?: string };
  const conds = [];
  if (status && status !== "all") conds.push(eq(leadsTable.status, status));
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    conds.push(or(ilike(leadsTable.name, term), ilike(leadsTable.email, term), ilike(leadsTable.restaurantName, term))!);
  }
  const rows = await db
    .select()
    .from(leadsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(leadsTable.createdAt))
    .limit(500);
  res.json(rows);
});

adminRouter.get("/admin/leads/stats", async (_req, res) => {
  const rows = await db
    .select({ status: leadsTable.status, count: sql<number>`count(*)::int` })
    .from(leadsTable)
    .groupBy(leadsTable.status);
  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  res.json({ total, byStatus: rows });
});

adminRouter.patch("/admin/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { status, notes } = req.body as { status?: string; notes?: string };
  const allowed = ["new", "contacted", "demo_scheduled", "converted", "lost"];
  const update: Partial<typeof leadsTable.$inferInsert> = { updatedAt: new Date() };
  if (status && allowed.includes(status)) update.status = status;
  if (typeof notes === "string") update.notes = notes.slice(0, 4000);
  const [row] = await db.update(leadsTable).set(update).where(eq(leadsTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
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
        author: body.author ? String(body.author).slice(0, 120) : "TableTrack Team",
        readMinutes: Number(body.readMinutes) || 5,
        published: body.published !== false,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
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
