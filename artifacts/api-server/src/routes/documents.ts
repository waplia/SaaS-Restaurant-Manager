import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { createRequire as _docsCreateRequire } from "node:module";
const archiver = _docsCreateRequire(import.meta.url)("archiver") as typeof import("archiver");
import { z } from "zod";
import { and, desc, eq, inArray, lt, lte, gte, sql, or, ilike } from "drizzle-orm";
import {
  db,
  documentsTable,
  documentVersionsTable,
  documentPermissionsTable,
  documentCategoryDefaultsTable,
  documentAuditLogTable,
  branchesTable,
  usersTable,
  type DocumentPermission,
} from "../lib/db";
import { DOCUMENT_CATEGORIES, DOCUMENT_PERMISSIONS } from "@workspace/db/schema";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { setObjectAclPolicy, getObjectAclPolicy } from "../lib/objectAcl";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { canAccess, bulkResolvePermissions, resolvePermissions, type AclContext } from "../lib/documentAcl";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const VALID_CATEGORIES = new Set<string>(DOCUMENT_CATEGORIES);
const VALID_PERMS = new Set<string>(DOCUMENT_PERMISSIONS);

function ctxOf(req: Request): AclContext {
  return {
    restaurantId: Number(req.params.restaurantId),
    userId: Number(req.user?.sub ?? 0),
    role: String(req.user?.role ?? ""),
  };
}

async function logAudit(
  req: Request,
  documentId: number | null,
  action: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(documentAuditLogTable).values({
      restaurantId: Number(req.params.restaurantId),
      documentId,
      userId: req.user?.sub ? Number(req.user.sub) : null,
      userDisplay: (req.user as { name?: string; email?: string } | undefined)?.name
        ?? (req.user as { name?: string; email?: string } | undefined)?.email
        ?? null,
      action,
      details: details ?? null,
      ipAddress: (req.ip ?? "").slice(0, 64),
    });
  } catch (err) {
    req.log.warn({ err }, "documents: audit log write failed");
  }
}

// ─────────────────────── List + filters ───────────────────────
router.get(
  "/restaurants/:restaurantId/documents",
  requireRole("owner", "manager", "accountant", "super_admin", "staff"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const ctx = ctxOf(req);
    const { category, status, branchId, q, expiring, expired } = req.query as Record<string, string | undefined>;
    const wheres = [eq(documentsTable.restaurantId, ctx.restaurantId)];
    wheres.push(eq(documentsTable.status, status && ["active", "archived"].includes(status) ? status : "active"));
    if (category && VALID_CATEGORIES.has(category)) wheres.push(eq(documentsTable.category, category));
    if (branchId && branchId !== "all") {
      const bid = Number(branchId);
      if (Number.isFinite(bid)) wheres.push(eq(documentsTable.branchId, bid));
    }
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      wheres.push(or(
        ilike(documentsTable.title, like),
        ilike(documentsTable.description, like),
        ilike(documentsTable.referenceNumber, like),
        ilike(documentsTable.issuer, like),
      )!);
    }
    const now = new Date();
    if (expired === "1") wheres.push(lt(documentsTable.expiresAt, now));
    if (expiring === "1") {
      const in30 = new Date(now.getTime() + 30 * 86_400_000);
      wheres.push(and(gte(documentsTable.expiresAt, now), lte(documentsTable.expiresAt, in30))!);
    }
    const rows = await db
      .select()
      .from(documentsTable)
      .where(and(...wheres))
      .orderBy(desc(documentsTable.updatedAt))
      .limit(500);

    const perms = await bulkResolvePermissions(ctx, rows);
    const visible = rows
      .filter(r => (perms.get(r.id)?.size ?? 0) > 0)
      .map(r => ({ ...r, permissions: Array.from(perms.get(r.id) ?? []) }));
    res.json(visible);
  },
);

// ─────────────────────── Stats / dashboard counts ───────────────────────
router.get(
  "/restaurants/:restaurantId/documents/stats",
  requireRole("owner", "manager", "accountant", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86_400_000);

    const byCategory = await db
      .select({ category: documentsTable.category, count: sql<number>`count(*)::int` })
      .from(documentsTable)
      .where(and(eq(documentsTable.restaurantId, restaurantId), eq(documentsTable.status, "active")))
      .groupBy(documentsTable.category);

    const [{ total = 0 } = { total: 0 }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(documentsTable)
      .where(and(eq(documentsTable.restaurantId, restaurantId), eq(documentsTable.status, "active")));

    const [{ expired = 0 } = { expired: 0 }] = await db
      .select({ expired: sql<number>`count(*)::int` })
      .from(documentsTable)
      .where(and(
        eq(documentsTable.restaurantId, restaurantId),
        eq(documentsTable.status, "active"),
        lt(documentsTable.expiresAt, now),
      ));

    const [{ expiring = 0 } = { expiring: 0 }] = await db
      .select({ expiring: sql<number>`count(*)::int` })
      .from(documentsTable)
      .where(and(
        eq(documentsTable.restaurantId, restaurantId),
        eq(documentsTable.status, "active"),
        gte(documentsTable.expiresAt, now),
        lte(documentsTable.expiresAt, in30),
      ));

    res.json({ total, expired, expiring, byCategory });
  },
);

// ─────────────────────── Create document (after object PUT) ───────────────────────
const CreateDocBody = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  title: z.string().min(1).max(250),
  description: z.string().max(2000).optional().nullable(),
  fileName: z.string().min(1).max(256),
  mimeType: z.string().min(1).max(128),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
  objectPath: z.string().startsWith("/objects/"),
  branchId: z.number().int().positive().nullable().optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  issuedAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  reminderDays: z.number().int().min(0).max(365).optional(),
  referenceNumber: z.string().max(120).nullable().optional(),
  issuer: z.string().max(200).nullable().optional(),
  isRequired: z.boolean().optional(),
});

router.post(
  "/restaurants/:restaurantId/documents",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const parsed = CreateDocBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid document payload", issues: parsed.error.format() });
      return;
    }
    const restaurantId = Number(req.params.restaurantId);
    const data = parsed.data;

    const typeErr = validateUpload(data.fileName, data.mimeType, data.sizeBytes);
    if (typeErr) { res.status(400).json({ error: typeErr }); return; }

    // Claim ACL on the underlying object so the storage GET endpoint will serve
    // it. CRITICAL: refuse if the object is already claimed by another tenant —
    // otherwise an attacker could insert a row referencing another restaurant's
    // object path and exfiltrate it via our download endpoint.
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(data.objectPath);
      const existing = await getObjectAclPolicy(objectFile);
      if (existing && existing.restaurantId && existing.restaurantId !== String(restaurantId)) {
        res.status(403).json({ error: "Object already owned by another tenant" });
        return;
      }
      await setObjectAclPolicy(objectFile, {
        restaurantId: String(restaurantId),
        uploaderId: req.user?.sub ? String(req.user.sub) : undefined,
        visibility: "private",
      });
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Uploaded object not found — finalize upload first" });
        return;
      }
      req.log.error({ err }, "documents: failed to set object ACL");
      res.status(500).json({ error: "Failed to claim object" });
      return;
    }

    if (data.branchId) {
      const [b] = await db.select({ id: branchesTable.id })
        .from(branchesTable)
        .where(and(eq(branchesTable.id, data.branchId), eq(branchesTable.restaurantId, restaurantId)));
      if (!b) { res.status(400).json({ error: "Invalid branchId" }); return; }
    }

    const [doc] = await db.insert(documentsTable).values({
      restaurantId,
      branchId: data.branchId ?? null,
      category: data.category,
      title: data.title,
      description: data.description ?? null,
      fileName: data.fileName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      objectPath: data.objectPath,
      tags: data.tags ?? [],
      issuedAt: data.issuedAt ? new Date(data.issuedAt) : null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      reminderDays: data.reminderDays ?? 30,
      referenceNumber: data.referenceNumber ?? null,
      issuer: data.issuer ?? null,
      isRequired: data.isRequired ?? false,
      uploadedBy: req.user?.sub ? Number(req.user.sub) : null,
      lastModifiedBy: req.user?.sub ? Number(req.user.sub) : null,
    }).returning();

    await db.insert(documentVersionsTable).values({
      documentId: doc.id,
      restaurantId,
      version: 1,
      objectPath: data.objectPath,
      fileName: data.fileName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      uploadedBy: req.user?.sub ? Number(req.user.sub) : null,
      note: "Initial upload",
    });

    await logAudit(req, doc.id, "create", { title: doc.title, category: doc.category });
    res.status(201).json(doc);
  },
);

// When the `:id` segment isn't numeric, fall through to the next matching
// route. This lets static paths like `/has-access`, `/audit-log`,
// `/bulk-delete`, `/bulk-download`, `/category-defaults` coexist with the
// generic `/documents/:id` family without strict ordering.
function numericIdGuard(req: Request, _res: Response, next: (err?: unknown) => void) {
  if (!/^\d+$/.test(req.params.id ?? "")) return next("route");
  next();
}

async function loadDoc(
  req: Request, res: Response, opts: { allowDeleted?: boolean } = {},
): Promise<typeof documentsTable.$inferSelect | null> {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return null; }
  const [doc] = await db.select().from(documentsTable)
    .where(and(eq(documentsTable.id, id), eq(documentsTable.restaurantId, restaurantId)));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return null; }
  // Soft-deleted docs are invisible to all read/download/edit paths unless
  // the caller explicitly opts in (e.g. a future restore endpoint).
  if (!opts.allowDeleted && doc.status === "deleted") {
    res.status(404).json({ error: "Document not found" });
    return null;
  }
  return doc;
}

// Allowed upload mime/extension allow-list (spec: PDF, JPG/PNG/WEBP, DOCX, XLSX).
const ALLOWED_MIMES = new Set<string>([
  "application/pdf",
  "image/jpeg", "image/png", "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword", "application/vnd.ms-excel",
]);
const ALLOWED_EXT = /\.(pdf|jpe?g|png|webp|docx?|xlsx?)$/i;
function validateUpload(fileName: string, mimeType: string, sizeBytes: number): string | null {
  const MAX = 25 * 1024 * 1024;
  if (sizeBytes > MAX) return `File exceeds ${MAX / 1024 / 1024} MB limit`;
  if (!ALLOWED_MIMES.has(mimeType)) return `Disallowed content type: ${mimeType}`;
  if (!ALLOWED_EXT.test(fileName)) return `Disallowed file extension`;
  return null;
}

// ─────────────────────── Get document (with versions + grants) ───────────────────────
router.get(
  "/restaurants/:restaurantId/documents/:id",
  numericIdGuard,
  requireRole("owner", "manager", "accountant", "super_admin", "staff"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const doc = await loadDoc(req, res);
    if (!doc) return;
    const ctx = ctxOf(req);
    const perms = await resolvePermissions(ctx, doc);
    if (!perms.has("view")) { res.status(403).json({ error: "Forbidden" }); return; }

    const [versions, grants] = await Promise.all([
      db.select().from(documentVersionsTable)
        .where(and(
          eq(documentVersionsTable.documentId, doc.id),
          eq(documentVersionsTable.restaurantId, ctx.restaurantId),
        ))
        .orderBy(desc(documentVersionsTable.version)),
      db.select().from(documentPermissionsTable)
        .where(and(
          eq(documentPermissionsTable.restaurantId, ctx.restaurantId),
          eq(documentPermissionsTable.documentId, doc.id),
        )),
    ]);
    res.json({ ...doc, permissions: Array.from(perms), versions, grants });
  },
);

// ─────────────────────── Update metadata ───────────────────────
const UpdateDocBody = CreateDocBody.partial().omit({ objectPath: true, fileName: true, mimeType: true, sizeBytes: true });

router.patch(
  "/restaurants/:restaurantId/documents/:id",
  numericIdGuard,
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const doc = await loadDoc(req, res);
    if (!doc) return;
    const ctx = ctxOf(req);
    if (!(await canAccess(ctx, doc, "edit"))) { res.status(403).json({ error: "Forbidden" }); return; }
    const parsed = UpdateDocBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid update", issues: parsed.error.format() }); return; }
    const data = parsed.data;
    const update: Partial<typeof documentsTable.$inferInsert> = {
      lastModifiedBy: req.user?.sub ? Number(req.user.sub) : null,
      updatedAt: new Date(),
    };
    if (data.category) update.category = data.category;
    if (data.title !== undefined) update.title = data.title;
    if (data.description !== undefined) update.description = data.description ?? null;
    if (data.branchId !== undefined) update.branchId = data.branchId ?? null;
    if (data.tags !== undefined) update.tags = data.tags;
    if (data.issuedAt !== undefined) update.issuedAt = data.issuedAt ? new Date(data.issuedAt) : null;
    if (data.expiresAt !== undefined) update.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    if (data.reminderDays !== undefined) update.reminderDays = data.reminderDays;
    if (data.referenceNumber !== undefined) update.referenceNumber = data.referenceNumber ?? null;
    if (data.issuer !== undefined) update.issuer = data.issuer ?? null;
    if (data.isRequired !== undefined) update.isRequired = data.isRequired;

    const [updated] = await db.update(documentsTable).set(update)
      .where(and(eq(documentsTable.id, doc.id), eq(documentsTable.restaurantId, ctx.restaurantId)))
      .returning();
    await logAudit(req, doc.id, "update", { changed: Object.keys(update) });
    res.json(updated);
  },
);

// ─────────────────────── Replace file (new version) ───────────────────────
const ReplaceFileBody = z.object({
  fileName: z.string().min(1).max(256),
  mimeType: z.string().min(1).max(128),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
  objectPath: z.string().startsWith("/objects/"),
  note: z.string().max(500).optional(),
});

router.post(
  "/restaurants/:restaurantId/documents/:id/versions",
  numericIdGuard,
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const doc = await loadDoc(req, res);
    if (!doc) return;
    const ctx = ctxOf(req);
    if (!(await canAccess(ctx, doc, "edit"))) { res.status(403).json({ error: "Forbidden" }); return; }
    const parsed = ReplaceFileBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid version payload", issues: parsed.error.format() }); return; }
    const data = parsed.data;
    const typeErr = validateUpload(data.fileName, data.mimeType, data.sizeBytes);
    if (typeErr) { res.status(400).json({ error: typeErr }); return; }
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(data.objectPath);
      const existing = await getObjectAclPolicy(objectFile);
      if (existing && existing.restaurantId && existing.restaurantId !== String(ctx.restaurantId)) {
        res.status(403).json({ error: "Object already owned by another tenant" });
        return;
      }
      await setObjectAclPolicy(objectFile, {
        restaurantId: String(ctx.restaurantId),
        uploaderId: String(ctx.userId),
        visibility: "private",
      });
    } catch (err) {
      if (err instanceof ObjectNotFoundError) { res.status(404).json({ error: "Object not found" }); return; }
      req.log.error({ err }, "documents: version ACL set failed");
      res.status(500).json({ error: "Failed to claim object" }); return;
    }
    const newVersion = doc.version + 1;
    await db.insert(documentVersionsTable).values({
      documentId: doc.id,
      restaurantId: ctx.restaurantId,
      version: newVersion,
      objectPath: data.objectPath,
      fileName: data.fileName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      uploadedBy: ctx.userId,
      note: data.note ?? null,
    });
    const [updated] = await db.update(documentsTable).set({
      version: newVersion,
      objectPath: data.objectPath,
      fileName: data.fileName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      lastModifiedBy: ctx.userId,
      updatedAt: new Date(),
    }).where(and(eq(documentsTable.id, doc.id), eq(documentsTable.restaurantId, ctx.restaurantId))).returning();
    await logAudit(req, doc.id, "version", { version: newVersion });
    res.json(updated);
  },
);

// ─────────────────────── Soft delete ───────────────────────
router.delete(
  "/restaurants/:restaurantId/documents/:id",
  numericIdGuard,
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const doc = await loadDoc(req, res);
    if (!doc) return;
    const ctx = ctxOf(req);
    if (!(await canAccess(ctx, doc, "delete"))) { res.status(403).json({ error: "Forbidden" }); return; }
    await db.update(documentsTable).set({ status: "deleted", updatedAt: new Date(), lastModifiedBy: ctx.userId })
      .where(and(eq(documentsTable.id, doc.id), eq(documentsTable.restaurantId, ctx.restaurantId)));
    await logAudit(req, doc.id, "delete");
    res.json({ ok: true });
  },
);

// ─────────────────────── Download (single) ───────────────────────
router.get(
  "/restaurants/:restaurantId/documents/:id/download",
  numericIdGuard,
  requireRole("owner", "manager", "accountant", "super_admin", "staff"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const doc = await loadDoc(req, res);
    if (!doc) return;
    const ctx = ctxOf(req);
    if (!(await canAccess(ctx, doc, "download"))) { res.status(403).json({ error: "Forbidden" }); return; }
    try {
      const versionParam = req.query.version ? Number(req.query.version) : null;
      let objectPath = doc.objectPath;
      let fileName = doc.fileName;
      let mimeType = doc.mimeType;
      if (versionParam && Number.isFinite(versionParam) && versionParam !== doc.version) {
        const [v] = await db.select().from(documentVersionsTable)
          .where(and(
            eq(documentVersionsTable.documentId, doc.id),
            eq(documentVersionsTable.restaurantId, ctx.restaurantId),
            eq(documentVersionsTable.version, versionParam),
          ));
        if (!v) { res.status(404).json({ error: "Version not found" }); return; }
        objectPath = v.objectPath; fileName = v.fileName; mimeType = v.mimeType;
      }
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${fileName.replace(/"/g, "")}"`);
      await logAudit(req, doc.id, "download", { version: versionParam ?? doc.version });
      if (response.body) {
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
      } else { res.end(); }
    } catch (err) {
      if (err instanceof ObjectNotFoundError) { res.status(404).json({ error: "File not found" }); return; }
      req.log.error({ err }, "documents: download failed");
      res.status(500).json({ error: "Download failed" });
    }
  },
);

// ─────────────────────── Bulk ZIP download ───────────────────────
const BulkBody = z.object({ ids: z.array(z.number().int().positive()).min(1).max(50) });

router.post(
  "/restaurants/:restaurantId/documents/bulk-download",
  requireRole("owner", "manager", "accountant", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const parsed = BulkBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "ids required" }); return; }
    const ctx = ctxOf(req);
    const docs = await db.select().from(documentsTable)
      .where(and(
        eq(documentsTable.restaurantId, ctx.restaurantId),
        inArray(documentsTable.id, parsed.data.ids),
      ));
    const perms = await bulkResolvePermissions(ctx, docs);
    const allowed = docs.filter(d => perms.get(d.id)?.has("download"));
    if (allowed.length === 0) { res.status(403).json({ error: "No downloadable documents" }); return; }

    // Cumulative payload cap: refuse before streaming if total exceeds 250 MB
    // (50 docs × ~50 MB max per file is unreasonable to stream synchronously).
    const TOTAL_CAP_BYTES = 250 * 1024 * 1024;
    const totalBytes = allowed.reduce((sum, d) => sum + (d.sizeBytes ?? 0), 0);
    if (totalBytes > TOTAL_CAP_BYTES) {
      res.status(413).json({ error: `Selection exceeds ${Math.round(TOTAL_CAP_BYTES / 1024 / 1024)} MB cap. Pick fewer files.` });
      return;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="documents-${Date.now()}.zip"`);
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (err) => { req.log.error({ err }, "documents: zip failed"); try { res.status(500).end(); } catch {} });
    archive.pipe(res);

    for (const d of allowed) {
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(d.objectPath);
        const stream = objectFile.createReadStream();
        const safeName = `${d.id}-${d.fileName}`.replace(/[\\/:*?"<>|]/g, "_");
        archive.append(stream, { name: safeName });
        await logAudit(req, d.id, "download", { bulk: true });
      } catch (err) {
        req.log.warn({ err, id: d.id }, "documents: skipping file in bulk zip");
      }
    }
    await archive.finalize();
  },
);

// ─────────────────────── Per-document grants ───────────────────────
const GrantBody = z.object({
  principalType: z.enum(["role", "user"]),
  principalRef: z.string().min(1).max(60),
  permission: z.enum(DOCUMENT_PERMISSIONS),
});

router.post(
  "/restaurants/:restaurantId/documents/:id/grants",
  numericIdGuard,
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const doc = await loadDoc(req, res);
    if (!doc) return;
    const ctx = ctxOf(req);
    if (!(await canAccess(ctx, doc, "edit"))) { res.status(403).json({ error: "Forbidden" }); return; }
    const parsed = GrantBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid grant", issues: parsed.error.format() }); return; }
    const g = parsed.data;
    if (g.principalType === "user") {
      const userId = Number(g.principalRef);
      if (!Number.isFinite(userId)) { res.status(400).json({ error: "principalRef must be a user id" }); return; }
      const [u] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.id, userId), eq(usersTable.restaurantId, ctx.restaurantId)));
      if (!u) { res.status(400).json({ error: "User not in this restaurant" }); return; }
    }
    // Idempotent insert — skip duplicates.
    const existing = await db.select().from(documentPermissionsTable).where(and(
      eq(documentPermissionsTable.restaurantId, ctx.restaurantId),
      eq(documentPermissionsTable.documentId, doc.id),
      eq(documentPermissionsTable.principalType, g.principalType),
      eq(documentPermissionsTable.principalRef, g.principalRef),
      eq(documentPermissionsTable.permission, g.permission),
    ));
    if (existing.length > 0) { res.json(existing[0]); return; }
    const [row] = await db.insert(documentPermissionsTable).values({
      restaurantId: ctx.restaurantId,
      documentId: doc.id,
      principalType: g.principalType,
      principalRef: g.principalRef,
      permission: g.permission,
      grantedBy: ctx.userId,
    }).returning();
    await logAudit(req, doc.id, "grant", g);
    res.status(201).json(row);
  },
);

router.delete(
  "/restaurants/:restaurantId/documents/:id/grants/:grantId",
  numericIdGuard,
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const doc = await loadDoc(req, res);
    if (!doc) return;
    const ctx = ctxOf(req);
    if (!(await canAccess(ctx, doc, "edit"))) { res.status(403).json({ error: "Forbidden" }); return; }
    const grantId = Number(req.params.grantId);
    if (!Number.isFinite(grantId)) { res.status(400).json({ error: "Invalid grantId" }); return; }
    await db.delete(documentPermissionsTable).where(and(
      eq(documentPermissionsTable.id, grantId),
      eq(documentPermissionsTable.documentId, doc.id),
      eq(documentPermissionsTable.restaurantId, ctx.restaurantId),
    ));
    await logAudit(req, doc.id, "revoke", { grantId });
    res.json({ ok: true });
  },
);

// ─────────────────────── Category defaults ───────────────────────
router.get(
  "/restaurants/:restaurantId/documents/category-defaults",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const rows = await db.select().from(documentCategoryDefaultsTable)
      .where(eq(documentCategoryDefaultsTable.restaurantId, restaurantId));
    res.json(rows);
  },
);

const CategoryDefaultBody = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  role: z.string().min(1).max(40),
  permissions: z.array(z.enum(DOCUMENT_PERMISSIONS)).max(4),
});

router.put(
  "/restaurants/:restaurantId/documents/category-defaults",
  requireRole("owner", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const parsed = CategoryDefaultBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid defaults", issues: parsed.error.format() }); return; }
    const { category, role, permissions } = parsed.data;
    const dedup = Array.from(new Set(permissions)).filter(p => VALID_PERMS.has(p)) as DocumentPermission[];
    const existing = await db.select().from(documentCategoryDefaultsTable).where(and(
      eq(documentCategoryDefaultsTable.restaurantId, restaurantId),
      eq(documentCategoryDefaultsTable.category, category),
      eq(documentCategoryDefaultsTable.role, role),
    ));
    if (existing.length > 0) {
      const [row] = await db.update(documentCategoryDefaultsTable)
        .set({ permissions: dedup, updatedAt: new Date() })
        .where(eq(documentCategoryDefaultsTable.id, existing[0].id))
        .returning();
      await logAudit(req, null, "category_default", { category, role, permissions: dedup });
      res.json(row);
      return;
    }
    const [row] = await db.insert(documentCategoryDefaultsTable).values({
      restaurantId, category, role, permissions: dedup,
    }).returning();
    await logAudit(req, null, "category_default", { category, role, permissions: dedup });
    res.status(201).json(row);
  },
);

// ─────────────────────── Has-access probe (sidebar gate) ───────────────────────
// Returns { hasAccess: true } when the caller can see at least one document.
// Used by the sidebar so non-default roles get the link only after they've
// been granted at least one document.
router.get(
  "/restaurants/:restaurantId/documents/has-access",
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ hasAccess: false }); return; }
    const ctx = ctxOf(req);
    const role = ctx.role;
    if (req.user.isSuperAdmin || ["owner", "manager", "accountant", "super_admin"].includes(role)) {
      res.json({ hasAccess: true }); return;
    }
    const [grant] = await db.select({ id: documentPermissionsTable.id })
      .from(documentPermissionsTable)
      .where(and(
        eq(documentPermissionsTable.restaurantId, ctx.restaurantId),
        or(
          and(eq(documentPermissionsTable.principalType, "role"), eq(documentPermissionsTable.principalRef, role)),
          and(eq(documentPermissionsTable.principalType, "user"), eq(documentPermissionsTable.principalRef, String(ctx.userId))),
        )!,
      ))
      .limit(1);
    const [defaultRow] = await db.select({ id: documentCategoryDefaultsTable.id })
      .from(documentCategoryDefaultsTable)
      .where(and(
        eq(documentCategoryDefaultsTable.restaurantId, ctx.restaurantId),
        eq(documentCategoryDefaultsTable.role, role),
      ))
      .limit(1);
    res.json({ hasAccess: !!grant || !!defaultRow });
  },
);

// ─────────────────────── Bulk delete ───────────────────────
const BulkDeleteBody = z.object({ ids: z.array(z.number().int().positive()).min(1).max(50) });
router.post(
  "/restaurants/:restaurantId/documents/bulk-delete",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const ctx = ctxOf(req);
    const parsed = BulkDeleteBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid ids", issues: parsed.error.format() }); return; }
    const docs = await db.select().from(documentsTable).where(and(
      eq(documentsTable.restaurantId, ctx.restaurantId),
      eq(documentsTable.status, "active"),
      inArray(documentsTable.id, parsed.data.ids),
    ));
    const perms = await bulkResolvePermissions(ctx, docs);
    const allowed = docs.filter(d => perms.get(d.id)?.has("delete"));
    const allowedIds = allowed.map(d => d.id);
    if (allowedIds.length === 0) { res.status(403).json({ error: "No deletable documents" }); return; }
    await db.update(documentsTable)
      .set({ status: "deleted", updatedAt: new Date(), lastModifiedBy: ctx.userId })
      .where(and(eq(documentsTable.restaurantId, ctx.restaurantId), inArray(documentsTable.id, allowedIds)));
    for (const id of allowedIds) await logAudit(req, id, "delete", { bulk: true });
    res.json({ ok: true, deleted: allowedIds.length, skipped: docs.length - allowedIds.length });
  },
);

// ─────────────────────── Audit log read ───────────────────────
router.get(
  "/restaurants/:restaurantId/documents/audit-log",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const documentId = req.query.documentId ? Number(req.query.documentId) : null;
    const wheres = [eq(documentAuditLogTable.restaurantId, restaurantId)];
    if (documentId && Number.isFinite(documentId)) wheres.push(eq(documentAuditLogTable.documentId, documentId));
    const rows = await db.select().from(documentAuditLogTable)
      .where(and(...wheres))
      .orderBy(desc(documentAuditLogTable.createdAt))
      .limit(500);
    res.json(rows);
  },
);

export default router;
