import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  supportTicketCategoriesTable,
  supportTicketsTable,
  supportTicketRepliesTable,
  supportTicketAttachmentsTable,
  supportTicketEventsTable,
  notificationsTable,
  auditLogsTable,
  tenantsTable,
  usersTable,
  type SupportTicket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
  type TicketEventType,
} from "../lib/db";
import { requireSuperAdmin, requireRole } from "../middleware/authorize";
import { sanitizeStoredUpload, UploadValidationError, assertAllowedContentType } from "../lib/uploadSanitizer";
import {
  computeSlaInfo,
  getCategoryById,
  getSlaSettings,
  resolveEffectiveSla,
  HOUR_MS,
  isOpenStatus,
} from "../lib/supportSla";
import { recordAuditLog } from "../lib/audit";
import { sendEmail } from "../lib/notifications";
import { logger } from "../lib/logger";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { setObjectAclPolicy, getObjectAclPolicy } from "../lib/objectAcl";

const router = Router();
const objectStorageService = new ObjectStorageService();

const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];
const STATUSES: TicketStatus[] = ["open", "pending", "in_progress", "waiting_customer", "resolved", "closed"];

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isPriority(s: unknown): s is TicketPriority {
  return typeof s === "string" && (PRIORITIES as string[]).includes(s);
}

function isStatus(s: unknown): s is TicketStatus {
  return typeof s === "string" && (STATUSES as string[]).includes(s);
}

function actorInfo(req: { user?: { sub?: number; id?: number; isSuperAdmin?: boolean; name?: string | null; email?: string } }) {
  const id = req.user?.sub ?? req.user?.id ?? null;
  const isAdmin = !!req.user?.isSuperAdmin;
  const name = req.user?.name ?? req.user?.email ?? null;
  return { id, isAdmin, name };
}

async function nextTicketNumber(): Promise<string> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(supportTicketsTable);
  const seq = (Number(count) || 0) + 1;
  const year = new Date().getFullYear();
  return `T-${year}-${String(seq).padStart(5, "0")}`;
}

interface SerializedTicket extends SupportTicket {
  category: TicketCategory | null;
  requester: { id: number; name: string; email: string } | null;
  assignee: { id: number; name: string; email: string } | null;
  tenant: { id: number; name: string; slug: string } | null;
  sla: ReturnType<typeof computeSlaInfo>;
  replyCount: number;
  unreadInternalNotes?: number;
}

async function serializeTicket(ticket: SupportTicket, opts: { includeInternalCount?: boolean } = {}): Promise<SerializedTicket> {
  const [category, requester, assignee, tenant, replyCountRow] = await Promise.all([
    ticket.categoryId ? db.select().from(supportTicketCategoriesTable).where(eq(supportTicketCategoriesTable.id, ticket.categoryId)).then(r => r[0] ?? null) : Promise.resolve(null),
    ticket.requesterId ? db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, ticket.requesterId)).then(r => r[0] ?? null) : Promise.resolve(null),
    ticket.assigneeId ? db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, ticket.assigneeId)).then(r => r[0] ?? null) : Promise.resolve(null),
    db.select({ id: tenantsTable.id, name: tenantsTable.name, slug: tenantsTable.slug }).from(tenantsTable).where(eq(tenantsTable.id, ticket.tenantId)).then(r => r[0] ?? null),
    db.select({ count: sql<number>`count(*)::int` }).from(supportTicketRepliesTable).where(eq(supportTicketRepliesTable.ticketId, ticket.id)),
  ]);
  return {
    ...ticket,
    category,
    requester,
    assignee,
    tenant,
    sla: computeSlaInfo(ticket),
    replyCount: Number(replyCountRow[0]?.count ?? 0),
    ...(opts.includeInternalCount ? { unreadInternalNotes: 0 } : {}),
  };
}

async function logEvent(input: {
  ticketId: number;
  type: TicketEventType;
  actor: { id: number | null; isAdmin: boolean; name: string | null };
  fromValue?: string | null;
  toValue?: string | null;
  meta?: Record<string, unknown>;
}) {
  await db.insert(supportTicketEventsTable).values({
    ticketId: input.ticketId,
    type: input.type,
    actorId: input.actor.id ?? null,
    actorName: input.actor.name,
    actorIsAdmin: input.actor.isAdmin,
    fromValue: input.fromValue ?? null,
    toValue: input.toValue ?? null,
    meta: input.meta ?? null,
  });
}

async function logAudit(input: { userId: number | null; action: string; ticketId: number; details?: string }) {
  await db.insert(auditLogsTable).values({
    userId: input.userId,
    action: input.action,
    entity: "support_ticket",
    entityId: input.ticketId,
    details: input.details ?? null,
  });
}

async function notifyAdmins(title: string, message: string, ticketId: number) {
  // In-app notifications are scoped to a restaurantId — for admin alerts we
  // have no restaurant context, so we email super-admins instead and rely on
  // their visiting the ticket queue. (Restaurant-side notifications still go
  // into notificationsTable with the requester's restaurantId.)
  const admins = await db.select({ email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(and(eq(usersTable.isSuperAdmin, true), eq(usersTable.isActive, true)));
  for (const a of admins) {
    sendEmail({ to: a.email, subject: title, html: `<p>${message}</p><p>Ticket #${ticketId}</p>`, text: `${message}\nTicket #${ticketId}` })
      .catch(err => logger.warn({ err }, "support: admin email notify failed"));
  }
}

async function notifyTenant(tenantId: number, type: string, title: string, message: string, ticketId: number) {
  const users = await db.select({ id: usersTable.id, email: usersTable.email, restaurantId: usersTable.restaurantId })
    .from(usersTable)
    .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true), inArray(usersTable.role, ["owner", "manager"])));
  // Use the first restaurant we can find as a "home" for in-app delivery.
  for (const u of users) {
    if (u.restaurantId) {
      await db.insert(notificationsTable).values({
        restaurantId: u.restaurantId,
        type,
        title,
        message,
        entityId: ticketId,
        entityType: "support_ticket",
      }).catch(err => logger.warn({ err }, "support: in-app notify failed"));
    }
    sendEmail({ to: u.email, subject: title, html: `<p>${message}</p><p>Ticket #${ticketId}</p>`, text: `${message}\nTicket #${ticketId}` })
      .catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────
// Categories CRUD (super-admin)
// ──────────────────────────────────────────────────────────────────
router.get("/admin/support/categories", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(supportTicketCategoriesTable).orderBy(supportTicketCategoriesTable.sortOrder, supportTicketCategoriesTable.name);
  res.json({ data: rows });
});

router.post("/admin/support/categories", requireSuperAdmin, async (req, res) => {
  const { name, slug, description, defaultPriority, firstResponseHours, resolutionHours, isActive, sortOrder } = req.body as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) return void res.status(400).json({ error: "name is required" });
  if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) return void res.status(400).json({ error: "slug must be lowercase alphanumeric/hyphen" });
  if (defaultPriority !== undefined && !isPriority(defaultPriority)) return void res.status(400).json({ error: "Invalid defaultPriority" });
  try {
    const [created] = await db.insert(supportTicketCategoriesTable).values({
      name: name.trim(),
      slug,
      description: typeof description === "string" ? description : null,
      defaultPriority: (defaultPriority as TicketPriority) ?? "normal",
      firstResponseHours: firstResponseHours == null ? null : Number(firstResponseHours),
      resolutionHours: resolutionHours == null ? null : Number(resolutionHours),
      isActive: isActive === undefined ? true : Boolean(isActive),
      sortOrder: Number(sortOrder ?? 0),
    }).returning();
    await recordAuditLog({
      req,
      module: "support",
      action: "category.create",
      entity: "support_ticket_category",
      entityId: created.id,
      newValue: created,
    });
    res.status(201).json(created);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return void res.status(409).json({ error: "A category with this slug already exists" });
    throw err;
  }
});

router.patch("/admin/support/categories/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { name, description, defaultPriority, firstResponseHours, resolutionHours, isActive, sortOrder } = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof name === "string") patch.name = name.trim();
  if (description !== undefined) patch.description = description == null ? null : String(description);
  if (defaultPriority !== undefined) {
    if (!isPriority(defaultPriority)) return void res.status(400).json({ error: "Invalid defaultPriority" });
    patch.defaultPriority = defaultPriority;
  }
  if (firstResponseHours !== undefined) patch.firstResponseHours = firstResponseHours == null ? null : Number(firstResponseHours);
  if (resolutionHours !== undefined) patch.resolutionHours = resolutionHours == null ? null : Number(resolutionHours);
  if (isActive !== undefined) patch.isActive = Boolean(isActive);
  if (sortOrder !== undefined) patch.sortOrder = Number(sortOrder);
  const [old] = await db.select().from(supportTicketCategoriesTable).where(eq(supportTicketCategoriesTable.id, id));
  const [updated] = await db.update(supportTicketCategoriesTable).set(patch).where(eq(supportTicketCategoriesTable.id, id)).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req,
    module: "support",
    action: "category.update",
    entity: "support_ticket_category",
    entityId: id,
    oldValue: old,
    newValue: updated,
  });
  res.json(updated);
});

router.delete("/admin/support/categories/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [old] = await db.select().from(supportTicketCategoriesTable).where(eq(supportTicketCategoriesTable.id, id));
  // Detach tickets so we don't violate FK; then delete.
  await db.update(supportTicketsTable).set({ categoryId: null }).where(eq(supportTicketsTable.categoryId, id));
  const [removed] = await db.delete(supportTicketCategoriesTable).where(eq(supportTicketCategoriesTable.id, id)).returning();
  if (!removed) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req,
    module: "support",
    action: "category.delete",
    entity: "support_ticket_category",
    entityId: id,
    oldValue: old,
  });
  res.json({ ok: true });
});

// Public-ish: tenants need the category list for the "New Ticket" form.
router.get("/support/categories", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (_req, res) => {
  const rows = await db.select().from(supportTicketCategoriesTable)
    .where(eq(supportTicketCategoriesTable.isActive, true))
    .orderBy(supportTicketCategoriesTable.sortOrder, supportTicketCategoriesTable.name);
  res.json({ data: rows });
});

// ──────────────────────────────────────────────────────────────────
// SLA settings (super-admin)
// ──────────────────────────────────────────────────────────────────
router.get("/admin/support/sla-settings", requireSuperAdmin, async (_req, res) => {
  const settings = await getSlaSettings();
  res.json(settings);
});

router.put("/admin/support/sla-settings", requireSuperAdmin, async (req, res) => {
  const settings = await getSlaSettings();
  const fields = [
    "lowFirstResponseHours", "normalFirstResponseHours", "highFirstResponseHours", "urgentFirstResponseHours",
    "lowResolutionHours", "normalResolutionHours", "highResolutionHours", "urgentResolutionHours",
    "maxAttachmentMb",
  ] as const;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of fields) {
    const v = (req.body as Record<string, unknown>)[f];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return void res.status(400).json({ error: `${f} must be a non-negative number` });
    patch[f] = Math.round(n);
  }
  const { supportSlaSettingsTable } = await import("../lib/db");
  const [updated] = await db.update(supportSlaSettingsTable).set(patch).where(eq(supportSlaSettingsTable.id, settings.id)).returning();
  await recordAuditLog({
    req,
    module: "support",
    action: "sla_settings.update",
    entity: "support_sla_settings",
    entityId: settings.id,
    oldValue: settings,
    newValue: updated,
  });
  res.json(updated);
});

// ──────────────────────────────────────────────────────────────────
// Tenant-scoped: list / create / view / reply
// ──────────────────────────────────────────────────────────────────
router.get("/support/tickets", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant scope" });
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const conds: SQL[] = [eq(supportTicketsTable.tenantId, tenantId)];
  if (isStatus(status)) conds.push(eq(supportTicketsTable.status, status));
  const rows = await db.select().from(supportTicketsTable).where(and(...conds)).orderBy(desc(supportTicketsTable.updatedAt));
  const data = await Promise.all(rows.map(r => serializeTicket(r)));
  res.json({ data });
});

router.post("/support/tickets", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant scope" });
  const { subject, description, categoryId, priority, attachments } = req.body as {
    subject?: string; description?: string; categoryId?: number; priority?: TicketPriority;
    attachments?: Array<{ objectPath: string; fileName: string; contentType: string; size: number }>;
  };
  if (!subject?.trim() || !description?.trim()) return void res.status(400).json({ error: "subject and description are required" });
  const cat = await getCategoryById(categoryId);
  const effectivePriority: TicketPriority = isPriority(priority) ? priority : (cat?.defaultPriority ?? "normal");
  const settings = await getSlaSettings();
  const sla = resolveEffectiveSla({ priority: effectivePriority, category: cat, ticketFirstResponseHours: null, ticketResolutionHours: null, settings });
  const now = new Date();
  const ticketNumber = await nextTicketNumber();
  const [ticket] = await db.insert(supportTicketsTable).values({
    ticketNumber,
    tenantId,
    requesterId: req.user!.sub ?? null,
    categoryId: cat?.id ?? null,
    subject: subject.trim(),
    description: description.trim(),
    status: "open",
    priority: effectivePriority,
    firstResponseDueAt: new Date(now.getTime() + sla.firstResponseHours * HOUR_MS),
    resolutionDueAt: new Date(now.getTime() + sla.resolutionHours * HOUR_MS),
  }).returning();

  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (!a?.objectPath) continue;
      await db.insert(supportTicketAttachmentsTable).values({
        ticketId: ticket.id,
        uploadedById: req.user!.sub ?? null,
        fileName: String(a.fileName).slice(0, 256),
        contentType: String(a.contentType).slice(0, 128),
        size: Math.max(0, Math.floor(Number(a.size) || 0)),
        objectPath: String(a.objectPath),
        isInternal: false,
      });
    }
  }

  const actor = actorInfo(req);
  await logEvent({ ticketId: ticket.id, type: "created", actor });
  await logAudit({ userId: actor.id, action: "support.ticket.created", ticketId: ticket.id, details: `subject="${ticket.subject}" priority=${ticket.priority}` });
  notifyAdmins(`New support ticket: ${ticket.subject}`, `A new ticket was opened by ${actor.name ?? "a user"}.`, ticket.id).catch(() => {});

  const data = await serializeTicket(ticket);
  res.status(201).json(data);
});

async function loadTicketForRequester(req: { user?: { tenantId?: number | null; isSuperAdmin?: boolean } }, id: number, tenantScoped: boolean): Promise<SupportTicket | null> {
  const [t] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!t) return null;
  if (tenantScoped) {
    if (req.user?.tenantId !== t.tenantId) return null;
  }
  return t;
}

async function loadTicketEnvelope(ticket: SupportTicket, hideInternal: boolean) {
  const [replies, attachments, events] = await Promise.all([
    db.select().from(supportTicketRepliesTable)
      .where(hideInternal ? and(eq(supportTicketRepliesTable.ticketId, ticket.id), eq(supportTicketRepliesTable.isInternal, false)) : eq(supportTicketRepliesTable.ticketId, ticket.id))
      .orderBy(supportTicketRepliesTable.createdAt),
    db.select().from(supportTicketAttachmentsTable)
      .where(hideInternal ? and(eq(supportTicketAttachmentsTable.ticketId, ticket.id), eq(supportTicketAttachmentsTable.isInternal, false)) : eq(supportTicketAttachmentsTable.ticketId, ticket.id))
      .orderBy(supportTicketAttachmentsTable.createdAt),
    db.select().from(supportTicketEventsTable)
      .where(eq(supportTicketEventsTable.ticketId, ticket.id))
      .orderBy(supportTicketEventsTable.createdAt),
  ]);
  const visibleEvents = hideInternal ? events.filter(e => e.type !== "internal_note_added") : events;
  return { replies, attachments, events: visibleEvents };
}

router.get("/support/tickets/:id", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const ticket = await loadTicketForRequester(req, id, true);
  if (!ticket) return void res.status(404).json({ error: "Not found" });
  const [serialized, env] = await Promise.all([serializeTicket(ticket), loadTicketEnvelope(ticket, true)]);
  res.json({ ticket: serialized, ...env });
});

router.post("/support/tickets/:id/replies", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const ticket = await loadTicketForRequester(req, id, true);
  if (!ticket) return void res.status(404).json({ error: "Not found" });
  const { body, attachments } = req.body as { body?: string; attachments?: Array<{ objectPath: string; fileName: string; contentType: string; size: number }> };
  if (!body?.trim()) return void res.status(400).json({ error: "body required" });
  const actor = actorInfo(req);

  const [reply] = await db.insert(supportTicketRepliesTable).values({
    ticketId: ticket.id,
    authorId: actor.id ?? null,
    authorName: actor.name,
    authorIsAdmin: false,
    isInternal: false,
    body: body.trim(),
  }).returning();

  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (!a?.objectPath) continue;
      await db.insert(supportTicketAttachmentsTable).values({
        ticketId: ticket.id, replyId: reply.id, uploadedById: actor.id,
        fileName: String(a.fileName).slice(0, 256), contentType: String(a.contentType).slice(0, 128),
        size: Math.max(0, Math.floor(Number(a.size) || 0)), objectPath: String(a.objectPath), isInternal: false,
      });
    }
  }

  // Customer reply un-pauses the SLA if it was waiting on them.
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (ticket.status === "waiting_customer") {
    if (ticket.pausedAt) {
      patch.pausedMs = ticket.pausedMs + Math.max(0, Date.now() - ticket.pausedAt.getTime());
      patch.pausedAt = null;
    }
    patch.status = "open";
  } else if (ticket.status === "resolved" || ticket.status === "closed") {
    patch.status = "open";
    patch.resolvedAt = null;
    patch.closedAt = null;
    await logEvent({ ticketId: ticket.id, type: "reopened", actor });
  }
  await db.update(supportTicketsTable).set(patch).where(eq(supportTicketsTable.id, ticket.id));
  await logEvent({ ticketId: ticket.id, type: "reply_posted", actor });
  await logAudit({ userId: actor.id, action: "support.ticket.reply", ticketId: ticket.id });
  res.status(201).json(reply);
});

const RequestUploadBody = z.object({
  name: z.string().min(1).max(256),
  size: z.number().int().positive().max(50 * 1024 * 1024),
  contentType: z.string().min(1).max(128),
});

router.post("/support/tickets/uploads/request-url", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const parsed = RequestUploadBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid file metadata" });
  const settings = await getSlaSettings();
  if (parsed.data.size > settings.maxAttachmentMb * 1024 * 1024) {
    return void res.status(413).json({ error: `File exceeds the ${settings.maxAttachmentMb} MB limit` });
  }
  // Support attachments are limited to images and PDFs. Reject other claimed
  // content types up-front rather than burning bandwidth on an upload that
  // would only be deleted at finalize-time anyway.
  try {
    assertAllowedContentType(parsed.data.contentType, ["image", "pdf"]);
  } catch (err) {
    if (err instanceof UploadValidationError) return void res.status(err.statusCode).json({ error: err.message });
    throw err;
  }
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    req.log?.error({ err }, "Support upload url failed");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.post("/support/tickets/uploads/finalize", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const objectPath = String((req.body as { objectPath?: string })?.objectPath ?? "");
  if (!objectPath.startsWith("/objects/")) return void res.status(400).json({ error: "Invalid objectPath" });
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const settings = await getSlaSettings();
    try {
      await sanitizeStoredUpload(objectFile, {
        allowedKinds: ["image", "pdf"],
        maxBytes: settings.maxAttachmentMb * 1024 * 1024,
      });
    } catch (sanErr) {
      if (sanErr instanceof UploadValidationError) {
        return void res.status(sanErr.statusCode).json({ error: sanErr.message });
      }
      throw sanErr;
    }
    const existing = await getObjectAclPolicy(objectFile);
    if (!existing) {
      // Tag with a synthetic "support:<tenantId>" owner so later support reads can authorize.
      await setObjectAclPolicy(objectFile, {
        restaurantId: `support:${req.user?.tenantId ?? "anon"}`,
        uploaderId: req.user?.sub ? String(req.user.sub) : undefined,
        visibility: "private",
      });
    }
    res.json({ ok: true, objectPath });
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return void res.status(404).json({ error: "Object not found" });
    req.log?.error({ err }, "Support upload finalize failed");
    res.status(500).json({ error: "Failed to finalize upload" });
  }
});

// Stream a ticket attachment (auth + ticket-scope check on every read).
router.get("/support/tickets/:id/attachments/:attachmentId/download", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const id = parseId(req.params.id);
  const aid = parseId(req.params.attachmentId);
  if (!id || !aid) return void res.status(400).json({ error: "Invalid id" });
  const [t] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!t) return void res.status(404).json({ error: "Not found" });
  if (!req.user?.isSuperAdmin && req.user?.tenantId !== t.tenantId) return void res.status(403).json({ error: "Forbidden" });
  const [att] = await db.select().from(supportTicketAttachmentsTable)
    .where(and(eq(supportTicketAttachmentsTable.id, aid), eq(supportTicketAttachmentsTable.ticketId, id)));
  if (!att) return void res.status(404).json({ error: "Attachment not found" });
  if (att.isInternal && !req.user?.isSuperAdmin) return void res.status(403).json({ error: "Forbidden" });
  try {
    const file = await objectStorageService.getObjectEntityFile(att.objectPath);
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", `attachment; filename="${att.fileName.replace(/"/g, "")}"`);
    if (response.body) {
      const { Readable } = await import("stream");
      const stream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      stream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return void res.status(404).json({ error: "Object missing" });
    req.log?.error({ err }, "support attachment download failed");
    res.status(500).json({ error: "Failed to download" });
  }
});

// ──────────────────────────────────────────────────────────────────
// Super-admin: list / view / mutate
// ──────────────────────────────────────────────────────────────────
router.get("/admin/support/tickets", requireSuperAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const priority = typeof req.query.priority === "string" ? req.query.priority : "all";
  const categoryId = parseId(req.query.categoryId);
  const tenantId = parseId(req.query.tenantId);
  const assigneeId = parseId(req.query.assigneeId);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const slaBreach = req.query.slaBreach === "true";
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const conds: SQL[] = [];
  if (isStatus(status)) conds.push(eq(supportTicketsTable.status, status));
  if (isPriority(priority)) conds.push(eq(supportTicketsTable.priority, priority));
  if (categoryId) conds.push(eq(supportTicketsTable.categoryId, categoryId));
  if (tenantId) conds.push(eq(supportTicketsTable.tenantId, tenantId));
  if (assigneeId) conds.push(eq(supportTicketsTable.assigneeId, assigneeId));
  if (search) {
    const expr = or(
      ilike(supportTicketsTable.subject, `%${search}%`),
      ilike(supportTicketsTable.ticketNumber, `%${search}%`),
      ilike(supportTicketsTable.description, `%${search}%`),
    );
    if (expr) conds.push(expr);
  }
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select().from(supportTicketsTable).where(where).orderBy(desc(supportTicketsTable.updatedAt)).limit(limit).offset(offset);
  const totalRow = await db.select({ count: sql<number>`count(*)::int` }).from(supportTicketsTable).where(where);

  let data = await Promise.all(rows.map(r => serializeTicket(r)));
  if (slaBreach) data = data.filter(t => t.sla.firstResponseBreached || t.sla.resolutionBreached);

  // Counters per status (across all matching filters except status).
  const countConds = conds.filter(c => !String(c).includes('"status"'));
  const counterRows = await db
    .select({ status: supportTicketsTable.status, count: sql<number>`count(*)::int` })
    .from(supportTicketsTable)
    .where(countConds.length ? and(...countConds) : undefined)
    .groupBy(supportTicketsTable.status);
  const counters: Record<string, number> = {};
  for (const s of STATUSES) counters[s] = 0;
  for (const row of counterRows) counters[row.status] = Number(row.count) || 0;

  // SLA breach count needs to be computed in JS.
  const allOpen = await db.select().from(supportTicketsTable)
    .where(and(...countConds, sql`${supportTicketsTable.status} NOT IN ('resolved','closed')`));
  const breachingCount = allOpen.filter(r => {
    const info = computeSlaInfo(r);
    return info.firstResponseBreached || info.resolutionBreached;
  }).length;

  res.json({ data, total: Number(totalRow[0]?.count ?? 0), limit, offset, counters, breachingCount });
});

router.get("/admin/support/tickets/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [t] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!t) return void res.status(404).json({ error: "Not found" });
  const [serialized, env] = await Promise.all([serializeTicket(t), loadTicketEnvelope(t, false)]);
  res.json({ ticket: serialized, ...env });
});

router.patch("/admin/support/tickets/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [t] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!t) return void res.status(404).json({ error: "Not found" });
  const actor = actorInfo(req);

  const { status, priority, categoryId, assigneeId, slaFirstResponseHours, slaResolutionHours } = req.body as {
    status?: TicketStatus; priority?: TicketPriority; categoryId?: number | null;
    assigneeId?: number | null; slaFirstResponseHours?: number | null; slaResolutionHours?: number | null;
  };

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const events: Array<Parameters<typeof logEvent>[0]> = [];

  if (status !== undefined) {
    if (!isStatus(status)) return void res.status(400).json({ error: "Invalid status" });
    if (status !== t.status) {
      patch.status = status;
      events.push({ ticketId: t.id, type: "status_changed", actor, fromValue: t.status, toValue: status });
      // SLA pause handling.
      const wasPaused = t.status === "waiting_customer";
      const willPause = status === "waiting_customer";
      if (wasPaused && !willPause && t.pausedAt) {
        patch.pausedMs = t.pausedMs + Math.max(0, Date.now() - t.pausedAt.getTime());
        patch.pausedAt = null;
      }
      if (!wasPaused && willPause) {
        patch.pausedAt = new Date();
      }
      if (status === "resolved" && !t.resolvedAt) patch.resolvedAt = new Date();
      if (status === "closed" && !t.closedAt) patch.closedAt = new Date();
      if (status !== "resolved" && status !== "closed" && (t.resolvedAt || t.closedAt)) {
        patch.resolvedAt = null;
        patch.closedAt = null;
        events.push({ ticketId: t.id, type: "reopened", actor });
      }
    }
  }
  if (priority !== undefined) {
    if (!isPriority(priority)) return void res.status(400).json({ error: "Invalid priority" });
    if (priority !== t.priority) {
      patch.priority = priority;
      events.push({ ticketId: t.id, type: "priority_changed", actor, fromValue: t.priority, toValue: priority });
    }
  }
  if (categoryId !== undefined) {
    if (categoryId !== t.categoryId) {
      patch.categoryId = categoryId;
      events.push({ ticketId: t.id, type: "category_changed", actor, fromValue: String(t.categoryId ?? ""), toValue: String(categoryId ?? "") });
    }
  }
  if (assigneeId !== undefined) {
    if (assigneeId !== t.assigneeId) {
      patch.assigneeId = assigneeId;
      events.push({ ticketId: t.id, type: "assignee_changed", actor, fromValue: String(t.assigneeId ?? ""), toValue: String(assigneeId ?? "") });
    }
  }
  if (slaFirstResponseHours !== undefined) patch.slaFirstResponseHours = slaFirstResponseHours == null ? null : Math.max(0, Number(slaFirstResponseHours));
  if (slaResolutionHours !== undefined) patch.slaResolutionHours = slaResolutionHours == null ? null : Math.max(0, Number(slaResolutionHours));

  // Recompute SLA dues if priority/category/per-ticket-overrides changed.
  if (patch.priority || "categoryId" in patch || "slaFirstResponseHours" in patch || "slaResolutionHours" in patch) {
    const settings = await getSlaSettings();
    const cat = await getCategoryById((patch.categoryId as number | null) ?? t.categoryId);
    const eff = resolveEffectiveSla({
      priority: (patch.priority as TicketPriority) ?? t.priority,
      category: cat,
      ticketFirstResponseHours: (patch.slaFirstResponseHours as number | null | undefined) ?? t.slaFirstResponseHours,
      ticketResolutionHours: (patch.slaResolutionHours as number | null | undefined) ?? t.slaResolutionHours,
      settings,
    });
    const base = t.createdAt;
    patch.firstResponseDueAt = new Date(base.getTime() + eff.firstResponseHours * HOUR_MS);
    patch.resolutionDueAt = new Date(base.getTime() + eff.resolutionHours * HOUR_MS);
  }

  const [updated] = await db.update(supportTicketsTable).set(patch).where(eq(supportTicketsTable.id, id)).returning();
  for (const e of events) await logEvent(e);
  await logAudit({ userId: actor.id, action: "support.ticket.updated", ticketId: id, details: events.map(e => `${e.type}:${e.fromValue ?? ""}->${e.toValue ?? ""}`).join("; ") || undefined });

  // Tenant-facing notification on status / assignee changes.
  for (const e of events) {
    if (e.type === "status_changed") {
      notifyTenant(updated.tenantId, "support_ticket", `Ticket ${updated.ticketNumber} status: ${e.toValue}`, `An admin updated your ticket status to ${e.toValue}.`, updated.id).catch(() => {});
    }
  }

  const data = await serializeTicket(updated);
  res.json(data);
});

router.post("/admin/support/tickets/:id/replies", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [t] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!t) return void res.status(404).json({ error: "Not found" });
  const { body, isInternal, attachments } = req.body as { body?: string; isInternal?: boolean; attachments?: Array<{ objectPath: string; fileName: string; contentType: string; size: number }> };
  if (!body?.trim()) return void res.status(400).json({ error: "body required" });
  const actor = actorInfo(req);
  const internal = !!isInternal;

  const [reply] = await db.insert(supportTicketRepliesTable).values({
    ticketId: t.id,
    authorId: actor.id ?? null,
    authorName: actor.name,
    authorIsAdmin: true,
    isInternal: internal,
    body: body.trim(),
  }).returning();

  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (!a?.objectPath) continue;
      await db.insert(supportTicketAttachmentsTable).values({
        ticketId: t.id, replyId: reply.id, uploadedById: actor.id,
        fileName: String(a.fileName).slice(0, 256), contentType: String(a.contentType).slice(0, 128),
        size: Math.max(0, Math.floor(Number(a.size) || 0)), objectPath: String(a.objectPath), isInternal: internal,
      });
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (!internal) {
    if (!t.firstResponseAt) patch.firstResponseAt = new Date();
    // Public admin reply moves status to waiting_customer if it was open/in_progress.
    if (t.status === "open" || t.status === "pending" || t.status === "in_progress") {
      patch.status = "waiting_customer";
      patch.pausedAt = new Date();
      await logEvent({ ticketId: t.id, type: "status_changed", actor, fromValue: t.status, toValue: "waiting_customer" });
    }
  }
  await db.update(supportTicketsTable).set(patch).where(eq(supportTicketsTable.id, t.id));
  await logEvent({ ticketId: t.id, type: internal ? "internal_note_added" : "reply_posted", actor });
  await logAudit({ userId: actor.id, action: internal ? "support.ticket.internal_note" : "support.ticket.admin_reply", ticketId: t.id });

  if (!internal) {
    notifyTenant(t.tenantId, "support_ticket", `Reply on ticket ${t.ticketNumber}`, `An admin replied to your ticket "${t.subject}".`, t.id).catch(() => {});
  }

  res.status(201).json(reply);
});

router.post("/admin/support/tickets/:id/close", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [t] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!t) return void res.status(404).json({ error: "Not found" });
  const actor = actorInfo(req);
  const [updated] = await db.update(supportTicketsTable)
    .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
    .where(eq(supportTicketsTable.id, id)).returning();
  await logEvent({ ticketId: id, type: "status_changed", actor, fromValue: t.status, toValue: "closed" });
  await logAudit({ userId: actor.id, action: "support.ticket.closed", ticketId: id });
  res.json(await serializeTicket(updated));
});

router.post("/admin/support/tickets/:id/reopen", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [t] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!t) return void res.status(404).json({ error: "Not found" });
  const actor = actorInfo(req);
  const [updated] = await db.update(supportTicketsTable)
    .set({ status: "open", resolvedAt: null, closedAt: null, updatedAt: new Date() })
    .where(eq(supportTicketsTable.id, id)).returning();
  await logEvent({ ticketId: id, type: "reopened", actor, fromValue: t.status, toValue: "open" });
  await logAudit({ userId: actor.id, action: "support.ticket.reopened", ticketId: id });
  res.json(await serializeTicket(updated));
});

// Super-admin assignee picker — list of super admins.
router.get("/admin/support/admins", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.isSuperAdmin, true), eq(usersTable.isActive, true)))
    .orderBy(usersTable.name);
  res.json({ data: rows });
});

// Tenant picker for the admin filter.
router.get("/admin/support/tenants", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select({ id: tenantsTable.id, name: tenantsTable.name, slug: tenantsTable.slug })
    .from(tenantsTable)
    .orderBy(tenantsTable.name);
  res.json({ data: rows });
});

// Make TS happy with the unused import in production builds.
void isOpenStatus;

export default router;
