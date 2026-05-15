import { Router } from "express";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  db,
  emailProvidersTable,
  emailTemplatesTable,
  emailLogsTable,
  auditLogsTable,
  tenantsTable,
  type EmailDriver,
  type EmailLogStatus,
} from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import {
  sendEmailViaProvider,
  getProviderById,
  renderTemplate,
  htmlToText,
  maskProviderConfig,
  mergeProviderConfig,
  sendByTemplateKey,
  DEFAULT_TEMPLATES,
} from "../lib/emailSender";
import { usersTable } from "../lib/db";
import { logger } from "../lib/logger";

const router = Router();

const ALLOWED_DRIVERS: EmailDriver[] = ["smtp", "sendgrid", "mailgun", "ses", "custom"];
const ALLOWED_STATUSES: EmailLogStatus[] = ["queued", "sent", "delivered", "bounced", "failed"];

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function maskRow(row: typeof emailProvidersTable.$inferSelect) {
  return { ...row, config: maskProviderConfig(row.driver, row.config) };
}

// ─── Providers ───────────────────────────────────────────────────
router.get("/admin/email/providers", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(emailProvidersTable).orderBy(desc(emailProvidersTable.isDefault), emailProvidersTable.id);
  res.json({ data: rows.map(maskRow) });
});

router.post("/admin/email/providers", requireSuperAdmin, async (req, res) => {
  const { name, driver, config, fromName, fromEmail, replyTo, isEnabled, isDefault } = req.body as {
    name?: string; driver?: EmailDriver; config?: Record<string, unknown>;
    fromName?: string; fromEmail?: string; replyTo?: string | null;
    isEnabled?: boolean; isDefault?: boolean;
  };
  if (!name || !driver || !ALLOWED_DRIVERS.includes(driver)) {
    return void res.status(400).json({ error: "name and a valid driver are required" });
  }
  if (!isEmail(fromEmail)) return void res.status(400).json({ error: "A valid fromEmail is required" });
  if (replyTo && !isEmail(replyTo)) return void res.status(400).json({ error: "replyTo must be a valid email" });

  const [created] = await db.insert(emailProvidersTable).values({
    name,
    driver,
    config: config ?? {},
    fromName: fromName ?? "",
    fromEmail: fromEmail!,
    replyTo: replyTo ?? null,
    isEnabled: isEnabled ?? true,
    isDefault: false,
    createdBy: req.user?.id ?? null,
  }).returning();

  if (isDefault) {
    await db.update(emailProvidersTable).set({ isDefault: false, updatedAt: new Date() })
      .where(sql`${emailProvidersTable.id} <> ${created.id}`);
    await db.update(emailProvidersTable).set({ isDefault: true, updatedAt: new Date() })
      .where(eq(emailProvidersTable.id, created.id));
    created.isDefault = true;
  }

  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "email_provider.created",
    entity: "email_provider",
    entityId: created.id,
    details: `driver=${driver} name=${name}`,
  });

  res.status(201).json(maskRow(created));
});

router.put("/admin/email/providers/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(emailProvidersTable).where(eq(emailProvidersTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });

  const { name, config, fromName, fromEmail, replyTo, isEnabled } = req.body as {
    name?: string; config?: Record<string, unknown>;
    fromName?: string; fromEmail?: string; replyTo?: string | null;
    isEnabled?: boolean;
  };
  if (fromEmail !== undefined && !isEmail(fromEmail)) {
    return void res.status(400).json({ error: "fromEmail must be a valid email" });
  }
  if (replyTo && !isEmail(replyTo)) return void res.status(400).json({ error: "replyTo must be a valid email" });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) patch.name = name;
  if (fromName !== undefined) patch.fromName = fromName;
  if (fromEmail !== undefined) patch.fromEmail = fromEmail;
  if (replyTo !== undefined) patch.replyTo = replyTo;
  if (isEnabled !== undefined) patch.isEnabled = isEnabled;
  if (config !== undefined) patch.config = mergeProviderConfig(existing.driver, existing.config, config);

  const [updated] = await db.update(emailProvidersTable).set(patch).where(eq(emailProvidersTable.id, id)).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "email_provider.updated",
    entity: "email_provider",
    entityId: id,
  });

  res.json(maskRow(updated));
});

router.post("/admin/email/providers/:id/set-default", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(emailProvidersTable).where(eq(emailProvidersTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (!existing.isEnabled) return void res.status(400).json({ error: "Enable the provider before making it default" });

  await db.update(emailProvidersTable).set({ isDefault: false, updatedAt: new Date() })
    .where(sql`${emailProvidersTable.id} <> ${id}`);
  const [updated] = await db.update(emailProvidersTable).set({ isDefault: true, updatedAt: new Date() })
    .where(eq(emailProvidersTable.id, id)).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "email_provider.set_default",
    entity: "email_provider",
    entityId: id,
  });

  res.json(maskRow(updated));
});

router.delete("/admin/email/providers/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  // Detach logs (preserve history) before deleting the provider.
  await db.update(emailLogsTable).set({ providerId: null }).where(eq(emailLogsTable.providerId, id));
  await db.delete(emailProvidersTable).where(eq(emailProvidersTable.id, id));
  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "email_provider.deleted",
    entity: "email_provider",
    entityId: id,
  });
  res.json({ ok: true });
});

router.post("/admin/email/providers/:id/test", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { to, subject, body } = req.body as { to?: string; subject?: string; body?: string };
  if (!isEmail(to)) return void res.status(400).json({ error: "A valid recipient email is required" });
  const provider = await getProviderById(id);
  if (!provider) return void res.status(404).json({ error: "Provider not found" });
  const result = await sendEmailViaProvider(provider, {
    to: to!,
    subject: subject || `Test email from ${provider.name}`,
    html: body || `<p>This is a test email from <strong>${provider.name}</strong> via the ${provider.driver.toUpperCase()} driver.</p>`,
  });
  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "email_provider.test_sent",
    entity: "email_provider",
    entityId: id,
    details: `to=${to} ok=${result.ok}`,
  });
  if (result.ok) res.json({ ok: true, providerMessageId: result.providerMessageId, logId: result.log.id });
  else res.status(502).json({ ok: false, error: result.error, logId: result.log.id });
});

// ─── Templates ───────────────────────────────────────────────────
router.get("/admin/email/templates", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(emailTemplatesTable).orderBy(emailTemplatesTable.name);
  res.json({ data: rows, defaults: DEFAULT_TEMPLATES.map(t => ({ key: t.key, name: t.name, event: t.event })) });
});

router.post("/admin/email/templates", requireSuperAdmin, async (req, res) => {
  const { key, name, event, subject, body, variables, isEnabled } = req.body as {
    key?: string; name?: string; event?: string;
    subject?: string; body?: string; variables?: string[]; isEnabled?: boolean;
  };
  if (!key || !name) return void res.status(400).json({ error: "key and name are required" });
  try {
    const [created] = await db.insert(emailTemplatesTable).values({
      key,
      name,
      event: event ?? null,
      subject: subject ?? "",
      body: body ?? "",
      variables: Array.isArray(variables) ? variables : [],
      isEnabled: isEnabled ?? true,
      createdBy: req.user?.id ?? null,
    }).returning();
    await db.insert(auditLogsTable).values({
      userId: req.user?.id ?? null,
      action: "email_template.created",
      entity: "email_template",
      entityId: created.id,
      details: `key=${key}`,
    });
    res.status(201).json(created);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return void res.status(409).json({ error: "A template with that key already exists" });
    }
    throw err;
  }
});

router.put("/admin/email/templates/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { name, event, subject, body, variables, isEnabled } = req.body as {
    name?: string; event?: string; subject?: string; body?: string;
    variables?: string[]; isEnabled?: boolean;
  };
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) patch.name = name;
  if (event !== undefined) patch.event = event;
  if (subject !== undefined) patch.subject = subject;
  if (body !== undefined) patch.body = body;
  if (variables !== undefined) patch.variables = Array.isArray(variables) ? variables : [];
  if (isEnabled !== undefined) patch.isEnabled = isEnabled;
  const [updated] = await db.update(emailTemplatesTable).set(patch).where(eq(emailTemplatesTable.id, id)).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "email_template.updated",
    entity: "email_template",
    entityId: id,
  });
  res.json(updated);
});

router.delete("/admin/email/templates/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  await db.update(emailLogsTable).set({ templateId: null }).where(eq(emailLogsTable.templateId, id));
  await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "email_template.deleted",
    entity: "email_template",
    entityId: id,
  });
  res.json({ ok: true });
});

router.post("/admin/email/templates/:id/preview", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  const sample = (req.body?.sample ?? {}) as Record<string, unknown>;
  const vars: Record<string, unknown> = {};
  for (const v of tpl.variables ?? []) {
    vars[v] = sample[v] ?? `{${v}}`;
  }
  for (const [k, v] of Object.entries(sample)) vars[k] = v;
  const subject = renderTemplate(tpl.subject, vars);
  const html = renderTemplate(tpl.body, vars);
  res.json({ subject, html, text: htmlToText(html) });
});

router.post("/admin/email/templates/:id/test", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { to, sample, providerId } = req.body as { to?: string; sample?: Record<string, unknown>; providerId?: number };
  if (!isEmail(to)) return void res.status(400).json({ error: "A valid recipient email is required" });
  const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Not found" });

  let provider = providerId ? await getProviderById(providerId) : null;
  if (!provider) {
    const enabled = await db.select().from(emailProvidersTable).where(eq(emailProvidersTable.isEnabled, true));
    provider = enabled.find(p => p.isDefault) ?? enabled[0] ?? null;
  }
  if (!provider) return void res.status(400).json({ error: "No active email provider configured. Add one in the Providers tab." });

  const vars: Record<string, unknown> = { ...(sample ?? {}) };
  const subject = renderTemplate(tpl.subject, vars);
  const html = renderTemplate(tpl.body, vars);
  const result = await sendEmailViaProvider(provider, {
    to: to!, subject, html, text: htmlToText(html),
    templateKey: tpl.key, templateId: tpl.id,
  });
  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "email_template.test_sent",
    entity: "email_template",
    entityId: id,
    details: `to=${to} ok=${result.ok}`,
  });
  if (result.ok) res.json({ ok: true, providerMessageId: result.providerMessageId, logId: result.log.id });
  else res.status(502).json({ ok: false, error: result.error, logId: result.log.id });
});

// ─── Logs ────────────────────────────────────────────────────────
router.get("/admin/email/logs", requireSuperAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const provider = typeof req.query.provider === "string" ? req.query.provider : "all";
  const tenantId = parseId(req.query.tenantId);
  const templateKey = typeof req.query.template === "string" && req.query.template !== "all" ? req.query.template : null;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const conds: SQL[] = [];
  if (status !== "all" && (ALLOWED_STATUSES as string[]).includes(status)) {
    conds.push(eq(emailLogsTable.status, status as EmailLogStatus));
  }
  if (provider !== "all") {
    const pid = parseId(provider);
    if (pid) conds.push(eq(emailLogsTable.providerId, pid));
    else conds.push(eq(emailLogsTable.providerDriver, provider as EmailDriver));
  }
  if (tenantId) conds.push(eq(emailLogsTable.tenantId, tenantId));
  if (templateKey) conds.push(eq(emailLogsTable.templateKey, templateKey));
  if (search) {
    conds.push(sql`(${emailLogsTable.recipient} ILIKE ${"%" + search + "%"} OR ${emailLogsTable.subject} ILIKE ${"%" + search + "%"} OR ${emailLogsTable.error} ILIKE ${"%" + search + "%"})`);
  }
  if (from && !Number.isNaN(from.getTime())) conds.push(sql`${emailLogsTable.createdAt} >= ${from}`);
  if (to && !Number.isNaN(to.getTime())) conds.push(sql`${emailLogsTable.createdAt} <= ${to}`);

  const where = conds.length ? and(...conds) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(emailLogsTable)
    .where(where);

  const rows = await db.select({
    id: emailLogsTable.id,
    tenantId: emailLogsTable.tenantId,
    tenantName: tenantsTable.name,
    recipient: emailLogsTable.recipient,
    templateKey: emailLogsTable.templateKey,
    templateId: emailLogsTable.templateId,
    providerId: emailLogsTable.providerId,
    providerDriver: emailLogsTable.providerDriver,
    subject: emailLogsTable.subject,
    status: emailLogsTable.status,
    providerMessageId: emailLogsTable.providerMessageId,
    error: emailLogsTable.error,
    retryOf: emailLogsTable.retryOf,
    sentAt: emailLogsTable.sentAt,
    createdAt: emailLogsTable.createdAt,
  })
    .from(emailLogsTable)
    .leftJoin(tenantsTable, eq(tenantsTable.id, emailLogsTable.tenantId))
    .where(where)
    .orderBy(desc(emailLogsTable.createdAt))
    .limit(limit)
    .offset(offset);
  res.json({ data: rows, total, limit, offset });
});

async function retryLog(logId: number, userId: number | null): Promise<{ ok: boolean; error?: string; newLogId?: number }> {
  const [log] = await db.select().from(emailLogsTable).where(eq(emailLogsTable.id, logId));
  if (!log) return { ok: false, error: "Log not found" };
  if (log.status === "sent" || log.status === "delivered") return { ok: false, error: "This email already succeeded" };

  let html: string;
  let subject: string;
  let templateId: number | null = log.templateId;
  let templateKey: string | null = log.templateKey;
  if (log.templateId) {
    const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, log.templateId));
    if (tpl) {
      subject = tpl.subject;
      html = tpl.body;
      templateId = tpl.id;
      templateKey = tpl.key;
    } else {
      subject = log.subject ?? "(retry)";
      html = `<p>(Original template was deleted; retry without rendering.)</p>`;
    }
  } else {
    subject = log.subject ?? "(retry)";
    html = `<p>(No template attached to original log — retry without body.)</p>`;
  }

  let provider = log.providerId ? await getProviderById(log.providerId) : null;
  if (!provider) {
    const enabled = await db.select().from(emailProvidersTable).where(eq(emailProvidersTable.isEnabled, true));
    provider = enabled.find(p => p.isDefault) ?? enabled[0] ?? null;
  }
  if (!provider) return { ok: false, error: "No active email provider configured" };

  const result = await sendEmailViaProvider(provider, {
    to: log.recipient, subject, html, text: htmlToText(html),
    tenantId: log.tenantId, templateKey, templateId, retryOf: log.id,
  });
  await db.insert(auditLogsTable).values({
    userId,
    action: "email_log.retried",
    entity: "email_log",
    entityId: log.id,
    details: `ok=${result.ok}`,
  });
  return { ok: result.ok, error: result.error, newLogId: result.log.id };
}

router.post("/admin/email/logs/:id/retry", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const out = await retryLog(id, req.user?.id ?? null);
  if (out.ok) res.json(out);
  else res.status(400).json(out);
});

// Send an announcement (any template, typically `feature_announcement`) to a
// single recipient or broadcast to all active tenant owners.
router.post("/admin/email/announcements", requireSuperAdmin, async (req, res) => {
  const body = req.body as {
    templateKey?: string;
    audience?: "all_tenants" | "tenants" | "single";
    tenantIds?: number[];
    recipient?: string;
    variables?: Record<string, unknown>;
  };
  const templateKey = typeof body.templateKey === "string" ? body.templateKey : "";
  if (!templateKey) return void res.status(400).json({ error: "templateKey is required" });
  const vars = (body.variables && typeof body.variables === "object") ? body.variables as Record<string, unknown> : {};
  const audience = body.audience ?? (body.recipient ? "single" : "all_tenants");

  let recipients: { email: string; name: string | null; tenantId: number | null }[] = [];
  if (audience === "single") {
    if (!body.recipient) return void res.status(400).json({ error: "recipient is required for single audience" });
    recipients = [{ email: body.recipient, name: null, tenantId: null }];
  } else {
    const conds: SQL[] = [
      eq(usersTable.role, "owner"),
      eq(usersTable.isActive, true),
      eq(tenantsTable.isActive, true),
      eq(tenantsTable.isSuspended, false),
    ];
    if (audience === "tenants" && Array.isArray(body.tenantIds) && body.tenantIds.length) {
      conds.push(sql`${usersTable.tenantId} = ANY(${body.tenantIds})`);
    }
    const rows = await db.select({
      email: usersTable.email, name: usersTable.name, tenantId: usersTable.tenantId,
    })
      .from(usersTable)
      .innerJoin(tenantsTable, eq(tenantsTable.id, usersTable.tenantId))
      .where(and(...conds));
    recipients = rows.filter(r => !!r.email) as typeof recipients;
  }

  let sent = 0, failed = 0;
  for (const r of recipients) {
    try {
      const out = await sendByTemplateKey(templateKey, r.email, {
        name: r.name ?? "there",
        appName: "Khana Lagao",
        ...vars,
      }, { tenantId: r.tenantId ?? undefined });
      if (out?.ok) sent++; else failed++;
    } catch (err) {
      failed++;
      logger.error({ err, recipient: r.email }, "Announcement send threw");
    }
  }

  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "email_announcement.sent",
    entity: "email_template",
    entityId: null,
    details: `template=${templateKey} audience=${audience} sent=${sent} failed=${failed} total=${recipients.length}`,
  });

  res.json({ templateKey, audience, total: recipients.length, sent, failed });
});

router.post("/admin/email/logs/retry", requireSuperAdmin, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(Number).filter(Number.isInteger) : [];
  if (ids.length === 0) return void res.status(400).json({ error: "Provide an ids array" });
  let succeeded = 0, failed = 0;
  for (const id of ids) {
    try {
      const out = await retryLog(id, req.user?.id ?? null);
      if (out.ok) succeeded++; else failed++;
    } catch (err) {
      failed++;
      logger.error({ err, id }, "Bulk retry threw");
    }
  }
  res.json({ retried: ids.length, succeeded, failed });
});

export default router;
