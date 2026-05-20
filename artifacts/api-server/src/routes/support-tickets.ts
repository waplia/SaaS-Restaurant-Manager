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
  supportCallbackRequestsTable,
  supportSlaSettingsTable,
  notificationsTable,
  auditLogsTable,
  tenantsTable,
  usersTable,
  type SupportTicket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
  type TicketEventType,
  type SupportCallbackRequest,
  type SlaEscalationMatrix,
  type SlaTierMap,
} from "../lib/db";
import { requireSuperAdmin, requireRole } from "../middleware/authorize";
import { sanitizeStoredUpload, UploadValidationError, assertAllowedContentType } from "../lib/uploadSanitizer";
import {
  computeSlaInfo,
  getCategoryById,
  getSlaSettings,
  resolveEffectiveSla,
  getTenantSupportTier,
  describeTierCapabilities,
  getTierConfig,
  escalationStepsFor,
  HOUR_MS,
  isOpenStatus,
} from "../lib/supportSla";
import { recordAuditLog } from "../lib/audit";
import { sendEmail } from "../lib/notifications";
import { sendByTemplateKey } from "../lib/emailSender";
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

async function notifyAdmins(title: string, message: string, ticketId: number, templateKey: string = "support_ticket_created") {
  // In-app notifications are scoped to a restaurantId — for admin alerts we
  // have no restaurant context, so we email super-admins instead and rely on
  // their visiting the ticket queue. (Restaurant-side notifications still go
  // into notificationsTable with the requester's restaurantId.)
  const admins = await db.select({ email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(and(eq(usersTable.isSuperAdmin, true), eq(usersTable.isActive, true)));
  for (const a of admins) {
    sendByTemplateKey(templateKey, a.email, {
      name: a.name ?? "there",
      ticketId,
      subjectLine: title,
      reply: message,
      ticketUrl: `${process.env.APP_URL ?? ""}/app/admin/support/${ticketId}`,
    }, { recipientType: "support" })
      .catch(err => logger.warn({ err }, "support: admin email notify failed"));
  }
}

async function notifyTenant(tenantId: number, type: string, title: string, message: string, ticketId: number, templateKey: string = "support_ticket_replied") {
  const users = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, restaurantId: usersTable.restaurantId })
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
    sendByTemplateKey(templateKey, u.email, {
      name: u.name ?? "there",
      ticketId,
      subjectLine: title,
      reply: message,
      ticketUrl: `${process.env.APP_URL ?? ""}/app/support/${ticketId}`,
    }, { tenantId, recipientType: "user" })
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
  const numFields = [
    "lowFirstResponseHours", "normalFirstResponseHours", "highFirstResponseHours", "urgentFirstResponseHours",
    "lowResolutionHours", "normalResolutionHours", "highResolutionHours", "urgentResolutionHours",
    "maxAttachmentMb",
  ] as const;
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of numFields) {
    const v = body[f];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return void res.status(400).json({ error: `${f} must be a non-negative number` });
    patch[f] = Math.round(n);
  }
  // Task #436 — escalation matrix, tier multipliers, status page config.
  if (body.escalationMatrix !== undefined) {
    if (typeof body.escalationMatrix !== "object" || body.escalationMatrix === null) {
      return void res.status(400).json({ error: "escalationMatrix must be an object" });
    }
    patch.escalationMatrix = body.escalationMatrix as SlaEscalationMatrix;
  }
  if (body.tierConfig !== undefined) {
    if (typeof body.tierConfig !== "object" || body.tierConfig === null) {
      return void res.status(400).json({ error: "tierConfig must be an object" });
    }
    patch.tierConfig = body.tierConfig as SlaTierMap;
  }
  if (body.liveChatUrl !== undefined) patch.liveChatUrl = body.liveChatUrl == null ? null : String(body.liveChatUrl).slice(0, 512);
  if (body.statusPageEnabled !== undefined) patch.statusPageEnabled = Boolean(body.statusPageEnabled);
  if (body.statusPageTitle !== undefined) patch.statusPageTitle = String(body.statusPageTitle).slice(0, 256);
  if (body.statusPageDescription !== undefined) patch.statusPageDescription = String(body.statusPageDescription).slice(0, 2048);

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
  const { subject, description, categoryId, priority, attachments, isEmergency } = req.body as {
    subject?: string; description?: string; categoryId?: number; priority?: TicketPriority;
    attachments?: Array<{ objectPath: string; fileName: string; contentType: string; size: number }>;
    isEmergency?: boolean;
  };
  if (!subject?.trim() || !description?.trim()) return void res.status(400).json({ error: "subject and description are required" });
  const cat = await getCategoryById(categoryId);
  const settings = await getSlaSettings();
  // Resolve tier first so emergency / priority decisions can be gated on it.
  const tier = await getTenantSupportTier(tenantId);
  const tierCfg = getTierConfig(settings, tier);
  let emergency = false;
  let effectivePriority: TicketPriority = isPriority(priority) ? priority : (cat?.defaultPriority ?? "normal");
  if (isEmergency === true) {
    if (!tierCfg.emergencyEnabled) {
      return void res.status(403).json({ error: "POS emergency tickets are not available on your current support tier." });
    }
    emergency = true;
    effectivePriority = "urgent";
  }
  const sla = resolveEffectiveSla({ priority: effectivePriority, category: cat, ticketFirstResponseHours: null, ticketResolutionHours: null, settings, tier });
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
    isEmergency: emergency,
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

// ──────────────────────────────────────────────────────────────────
// Task #436 — Support tier / capabilities (tenant-visible)
// ──────────────────────────────────────────────────────────────────
router.get("/support/sla-tier", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant scope" });
  const settings = await getSlaSettings();
  const tier = await getTenantSupportTier(tenantId);
  const caps = describeTierCapabilities(settings, tier);
  res.json({
    ...caps,
    escalationMatrix: settings.escalationMatrix ?? {},
    statusPageEnabled: settings.statusPageEnabled,
  });
});

// ──────────────────────────────────────────────────────────────────
// Task #436 — Customer Satisfaction (CSAT)
// ──────────────────────────────────────────────────────────────────
router.post("/support/tickets/:id/satisfaction", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const ticket = await loadTicketForRequester(req, id, true);
  if (!ticket) return void res.status(404).json({ error: "Not found" });
  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    return void res.status(400).json({ error: "Ratings can only be left on resolved or closed tickets" });
  }
  if (ticket.satisfactionRating) {
    return void res.status(409).json({ error: "A rating has already been submitted for this ticket" });
  }
  const { rating, comment } = req.body as { rating?: number; comment?: string };
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return void res.status(400).json({ error: "rating must be an integer between 1 and 5" });
  const trimmedComment = typeof comment === "string" ? comment.trim().slice(0, 2000) : null;
  const [updated] = await db.update(supportTicketsTable).set({
    satisfactionRating: r,
    satisfactionComment: trimmedComment || null,
    satisfactionAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(supportTicketsTable.id, id)).returning();
  const actor = actorInfo(req);
  await logAudit({ userId: actor.id, action: "support.ticket.satisfaction", ticketId: id, details: `rating=${r}` });
  res.json(await serializeTicket(updated));
});

// ──────────────────────────────────────────────────────────────────
// Task #436 — Phone callback queue (tenant)
// ──────────────────────────────────────────────────────────────────
router.get("/support/callback-requests", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant scope" });
  const rows = await db.select().from(supportCallbackRequestsTable)
    .where(eq(supportCallbackRequestsTable.tenantId, tenantId))
    .orderBy(desc(supportCallbackRequestsTable.createdAt))
    .limit(50);
  res.json({ data: rows });
});

router.post("/support/callback-requests", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant scope" });
  // Gate behind the tenant's tier.
  const settings = await getSlaSettings();
  const tier = await getTenantSupportTier(tenantId);
  const tierCfg = getTierConfig(settings, tier);
  if (!tierCfg.callbackEnabled) {
    return void res.status(403).json({ error: "Phone callbacks are not available on your current support tier." });
  }
  const { phone, preferredTime, topic, notes } = req.body as { phone?: string; preferredTime?: string; topic?: string; notes?: string };
  if (!phone?.trim()) return void res.status(400).json({ error: "phone is required" });
  const actor = actorInfo(req);
  const [created] = await db.insert(supportCallbackRequestsTable).values({
    tenantId,
    requesterId: actor.id,
    requesterName: actor.name,
    phone: phone.trim().slice(0, 64),
    preferredTime: preferredTime?.trim().slice(0, 256) || null,
    topic: topic?.trim().slice(0, 256) || null,
    notes: notes?.trim().slice(0, 2000) || null,
  }).returning();
  await recordAuditLog({ req, module: "support", action: "callback.create", entity: "support_callback_request", entityId: created.id, newValue: created });
  notifyAdmins(`New callback request from ${actor.name ?? "tenant"}`, `Phone: ${created.phone}. Preferred time: ${created.preferredTime ?? "ASAP"}. Topic: ${created.topic ?? "—"}`, created.id).catch(() => {});
  res.status(201).json(created);
});

// ──────────────────────────────────────────────────────────────────
// Task #436 — Phone callback queue (super-admin)
// ──────────────────────────────────────────────────────────────────
router.get("/admin/support/callback-requests", requireSuperAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const conds: SQL[] = [];
  if (["pending", "acknowledged", "scheduled", "completed", "cancelled"].includes(status)) {
    conds.push(eq(supportCallbackRequestsTable.status, status));
  }
  const rows: SupportCallbackRequest[] = await db.select().from(supportCallbackRequestsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(supportCallbackRequestsTable.createdAt))
    .limit(200);
  // Enrich with tenant name in one extra query.
  const tenantIds = Array.from(new Set(rows.map(r => r.tenantId)));
  const tenants = tenantIds.length
    ? await db.select({ id: tenantsTable.id, name: tenantsTable.name }).from(tenantsTable).where(inArray(tenantsTable.id, tenantIds))
    : [];
  const tenantMap = new Map(tenants.map(t => [t.id, t.name]));
  res.json({ data: rows.map(r => ({ ...r, tenantName: tenantMap.get(r.tenantId) ?? null })) });
});

router.patch("/admin/support/callback-requests/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [old] = await db.select().from(supportCallbackRequestsTable).where(eq(supportCallbackRequestsTable.id, id));
  if (!old) return void res.status(404).json({ error: "Not found" });
  const { status, handlerNote } = req.body as { status?: string; handlerNote?: string };
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (status !== undefined) {
    if (!["pending", "acknowledged", "scheduled", "completed", "cancelled"].includes(status)) {
      return void res.status(400).json({ error: "Invalid status" });
    }
    patch.status = status;
    if (status === "acknowledged" && !old.acknowledgedAt) patch.acknowledgedAt = new Date();
    if ((status === "completed" || status === "cancelled") && !old.completedAt) patch.completedAt = new Date();
    const actor = actorInfo(req);
    patch.handlerId = actor.id;
  }
  if (handlerNote !== undefined) patch.handlerNote = handlerNote == null ? null : String(handlerNote).slice(0, 2000);
  const [updated] = await db.update(supportCallbackRequestsTable).set(patch).where(eq(supportCallbackRequestsTable.id, id)).returning();
  await recordAuditLog({ req, module: "support", action: "callback.update", entity: "support_callback_request", entityId: id, oldValue: old, newValue: updated });
  res.json(updated);
});

/* ------------------------------------------------------------------ *
 * Task #436 — SLA breach escalation sweep.
 *
 * Called on a cron (every 5 min). For each open ticket:
 *   1. If we've crossed first-response or resolution due time and haven't
 *      yet logged a breach event, fire one and email the tenant + admins.
 *   2. Walk the per-priority escalation matrix and fire each step whose
 *      `afterMinutes` is reached, bumping `escalationLevel` once per step.
 *
 * Idempotent within a single sweep window thanks to the *_breach_notified_at
 * + escalation_level columns.
 * ------------------------------------------------------------------ */
export async function runSupportSlaBreachSweep(now: Date = new Date()): Promise<{ scanned: number; breaches: number; escalations: number }> {
  const settings = await getSlaSettings();
  const rows = await db.select().from(supportTicketsTable).where(sql`${supportTicketsTable.status} NOT IN ('resolved','closed')`);
  let breaches = 0;
  let escalations = 0;
  for (const t of rows) {
    const info = computeSlaInfo(t, now);
    const patch: Record<string, unknown> = {};

    if (info.firstResponseBreached && !t.firstResponseBreachNotifiedAt) {
      patch.firstResponseBreachNotifiedAt = now;
      breaches++;
      await logEvent({ ticketId: t.id, type: "sla_breached", actor: { id: null, isAdmin: true, name: "SLA monitor" }, toValue: "first_response" });
      notifyTenant(t.tenantId, "support_ticket", `Ticket ${t.ticketNumber} — first-response SLA breached`,
        `We've missed the first-response window on your ticket "${t.subject}". Our team has been alerted.`, t.id).catch(() => {});
      notifyAdmins(`SLA breach (first response): ${t.ticketNumber}`, `Ticket "${t.subject}" exceeded its first-response SLA.`, t.id).catch(() => {});
    }
    if (info.resolutionBreached && !t.resolutionBreachNotifiedAt) {
      patch.resolutionBreachNotifiedAt = now;
      breaches++;
      await logEvent({ ticketId: t.id, type: "sla_breached", actor: { id: null, isAdmin: true, name: "SLA monitor" }, toValue: "resolution" });
      notifyTenant(t.tenantId, "support_ticket", `Ticket ${t.ticketNumber} — resolution SLA breached`,
        `Resolution on your ticket "${t.subject}" is overdue. Our team has been alerted.`, t.id).catch(() => {});
      notifyAdmins(`SLA breach (resolution): ${t.ticketNumber}`, `Ticket "${t.subject}" exceeded its resolution SLA.`, t.id).catch(() => {});
    }

    // Escalation steps — keyed on minutes past whichever due time is more overdue.
    const overdueMs = Math.max(
      info.firstResponseRemainingMs !== null ? -info.firstResponseRemainingMs : 0,
      info.resolutionRemainingMs    !== null ? -info.resolutionRemainingMs    : 0,
    );
    const overdueMin = Math.floor(overdueMs / 60_000);
    if (overdueMin > 0) {
      const steps = escalationStepsFor(settings, t.priority);
      // `escalationLevel` is the number of steps already fired for this ticket.
      const nextStepIdx = t.escalationLevel ?? 0;
      let firedThisRun = nextStepIdx;
      for (let i = nextStepIdx; i < steps.length; i++) {
        const step = steps[i];
        if (overdueMin >= step.afterMinutes) {
          for (const email of step.notifyEmails) {
            // Route via the editable `sla_breach` template so escalations
            // share the premium layout, honour the Super Admin–configured
            // provider, and land in email_logs.
            const overdueLabel = overdueMin >= 60
              ? `${Math.floor(overdueMin / 60)}h ${overdueMin % 60}m`
              : `${overdueMin}m`;
            const ticketUrl = `${(process.env.PUBLIC_APP_URL ?? "https://khanalagao.app").replace(/\/$/, "")}/admin/support/${t.id}`;
            sendByTemplateKey("sla_breach", email, {
              name: "Team",
              ticketId: t.ticketNumber,
              subjectLine: t.subject,
              slaName: `${step.label ?? `Step ${i + 1}`} (priority ${t.priority}${t.isEmergency ? ", POS emergency" : ""})`,
              overdueLabel,
              ticketUrl,
              appName: "Khana Lagao",
            }).catch(err => logger.warn({ err, ticketId: t.id, email }, "[support] escalation email failed"));
          }
          await logEvent({ ticketId: t.id, type: "sla_breached", actor: { id: null, isAdmin: true, name: "SLA monitor" }, toValue: `escalation_l${i + 1}` });
          firedThisRun = i + 1;
          escalations++;
        } else {
          break; // steps are sorted ascending; no further step is ready.
        }
      }
      if (firedThisRun !== (t.escalationLevel ?? 0)) {
        patch.escalationLevel = firedThisRun;
        patch.lastEscalatedAt = now;
      }
    }

    if (Object.keys(patch).length > 0) {
      await db.update(supportTicketsTable).set({ ...patch, updatedAt: now }).where(eq(supportTicketsTable.id, t.id));
    }
  }
  return { scanned: rows.length, breaches, escalations };
}

// Make TS happy with the unused import in production builds.
void isOpenStatus;

export default router;
