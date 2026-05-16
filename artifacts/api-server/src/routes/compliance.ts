import { Router } from "express";
import { eq, and, desc, lte, gte, sql, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  complianceDocumentsTable,
  complianceContactsTable,
  restaurantSettingsTable,
  usersTable,
  restaurantsTable,
  COMPLIANCE_DOC_TYPES,
  COMPLIANCE_REQUIRED_BY_COUNTRY,
  type ComplianceDocType,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { requirePlanFeature } from "../middleware/planFeature";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { recordAuditLog } from "../lib/audit";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy } from "../lib/objectAcl";

const router = Router();
const objectStorage = new ObjectStorageService();

router.use(
  "/restaurants/:restaurantId/compliance",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("compliance_manager"),
);

const COUNTRY_REQUIRED = COMPLIANCE_REQUIRED_BY_COUNTRY;
const COMPLIANCE_SECTIONS = [
  "compliance_country",
  "compliance_tax",
  "compliance_tip",
  "compliance_service_charge",
  "compliance_allergens",
  "compliance_privacy",
] as const;
type ComplianceSection = typeof COMPLIANCE_SECTIONS[number];

async function assertFileUrlOwnership(restaurantId: number, fileUrl: unknown): Promise<void> {
  if (fileUrl == null || fileUrl === "") return;
  if (typeof fileUrl !== "string" || !fileUrl.startsWith("/objects/")) {
    throw new Error("invalid_file_url");
  }
  try {
    const file = await objectStorage.getObjectEntityFile(fileUrl);
    const acl = await getObjectAclPolicy(file);
    if (!acl || acl.restaurantId !== String(restaurantId)) throw new Error("invalid_file_url");
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new Error("invalid_file_url");
    throw err;
  }
}

async function getCountry(restaurantId: number): Promise<string> {
  const [row] = await db.select().from(restaurantSettingsTable)
    .where(and(eq(restaurantSettingsTable.restaurantId, restaurantId), eq(restaurantSettingsTable.section, "compliance_country")));
  const data = (row?.data ?? {}) as { country?: string };
  if (data.country) return data.country;
  const [r] = await db.select({ country: restaurantsTable.country }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  return r?.country ?? "IN";
}

const docBodySchema = z.object({
  type: z.enum(COMPLIANCE_DOC_TYPES),
  title: z.string().max(256).optional().nullable(),
  documentNumber: z.string().max(128).optional().nullable(),
  issuingAuthority: z.string().max(256).optional().nullable(),
  issueDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
  renewalCost: z.union([z.string(), z.number()]).optional().nullable(),
  linkedVendorId: z.number().int().optional().nullable(),
  linkedStaffId: z.number().int().optional().nullable(),
  status: z.string().max(32).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---- Documents CRUD ----

router.get("/restaurants/:restaurantId/compliance/documents", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const conds = [eq(complianceDocumentsTable.restaurantId, restaurantId)];
  if (type && (COMPLIANCE_DOC_TYPES as readonly string[]).includes(type)) {
    conds.push(eq(complianceDocumentsTable.type, type));
  }
  const rows = await db.select().from(complianceDocumentsTable)
    .where(and(...conds))
    .orderBy(desc(complianceDocumentsTable.expiryDate));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/compliance/documents", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = docBodySchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  try {
    await assertFileUrlOwnership(restaurantId, parsed.data.fileUrl);
  } catch {
    return void res.status(400).json({ error: "invalid_file_url" });
  }
  const [row] = await db.insert(complianceDocumentsTable).values({
    restaurantId,
    type: parsed.data.type,
    title: parsed.data.title ?? null,
    documentNumber: parsed.data.documentNumber ?? null,
    issuingAuthority: parsed.data.issuingAuthority ?? null,
    issueDate: toDate(parsed.data.issueDate ?? null),
    expiryDate: toDate(parsed.data.expiryDate ?? null),
    fileUrl: parsed.data.fileUrl ?? null,
    renewalCost: parsed.data.renewalCost != null ? String(parsed.data.renewalCost) : null,
    linkedVendorId: parsed.data.linkedVendorId ?? null,
    linkedStaffId: parsed.data.linkedStaffId ?? null,
    status: parsed.data.status ?? "active",
    notes: parsed.data.notes ?? null,
  }).returning();
  await recordAuditLog({
    req, module: "compliance", action: "document.create", entity: "compliance_document",
    entityId: row?.id, restaurantId, newValue: row,
  });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/compliance/documents/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const parsed = docBodySchema.partial().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  if (parsed.data.fileUrl !== undefined) {
    try { await assertFileUrlOwnership(restaurantId, parsed.data.fileUrl); }
    catch { return void res.status(400).json({ error: "invalid_file_url" }); }
  }
  const [existing] = await db.select().from(complianceDocumentsTable)
    .where(and(eq(complianceDocumentsTable.id, id), eq(complianceDocumentsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.type !== undefined) updates.type = parsed.data.type;
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.documentNumber !== undefined) updates.documentNumber = parsed.data.documentNumber;
  if (parsed.data.issuingAuthority !== undefined) updates.issuingAuthority = parsed.data.issuingAuthority;
  if (parsed.data.issueDate !== undefined) updates.issueDate = toDate(parsed.data.issueDate);
  if (parsed.data.expiryDate !== undefined) {
    updates.expiryDate = toDate(parsed.data.expiryDate);
    // Reset reminder cadence when expiry changes
    updates.lastReminderStage = null;
    updates.lastReminderAt = null;
    updates.reminderDismissedUntil = null;
  }
  if (parsed.data.fileUrl !== undefined) updates.fileUrl = parsed.data.fileUrl;
  if (parsed.data.renewalCost !== undefined) updates.renewalCost = parsed.data.renewalCost != null ? String(parsed.data.renewalCost) : null;
  if (parsed.data.linkedVendorId !== undefined) updates.linkedVendorId = parsed.data.linkedVendorId;
  if (parsed.data.linkedStaffId !== undefined) updates.linkedStaffId = parsed.data.linkedStaffId;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
  const [updated] = await db.update(complianceDocumentsTable).set(updates)
    .where(and(eq(complianceDocumentsTable.id, id), eq(complianceDocumentsTable.restaurantId, restaurantId)))
    .returning();
  await recordAuditLog({
    req, module: "compliance", action: "document.update", entity: "compliance_document",
    entityId: id, restaurantId, oldValue: existing, newValue: updated,
  });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/compliance/documents/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [existing] = await db.select().from(complianceDocumentsTable)
    .where(and(eq(complianceDocumentsTable.id, id), eq(complianceDocumentsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.delete(complianceDocumentsTable)
    .where(and(eq(complianceDocumentsTable.id, id), eq(complianceDocumentsTable.restaurantId, restaurantId)));
  await recordAuditLog({
    req, module: "compliance", action: "document.delete", entity: "compliance_document",
    entityId: id, restaurantId, oldValue: existing,
  });
  res.status(204).send();
});

router.post("/restaurants/:restaurantId/compliance/documents/:id/dismiss", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const days = Math.max(1, Math.min(365, Number(req.body?.days) || 7));
  const until = new Date(Date.now() + days * 86_400_000);
  await db.update(complianceDocumentsTable)
    .set({ reminderDismissedUntil: until, updatedAt: new Date() })
    .where(and(eq(complianceDocumentsTable.id, id), eq(complianceDocumentsTable.restaurantId, restaurantId)));
  await recordAuditLog({
    req, module: "compliance", action: "document.dismiss_reminder", entity: "compliance_document",
    entityId: id, restaurantId, newValue: { until: until.toISOString() },
  });
  res.json({ ok: true, reminderDismissedUntil: until.toISOString() });
});

// ---- Dashboard summary ----

router.get("/restaurants/:restaurantId/compliance/summary", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const country = await getCountry(restaurantId);
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86_400_000);

  const docs = await db.select().from(complianceDocumentsTable)
    .where(eq(complianceDocumentsTable.restaurantId, restaurantId));

  let valid = 0, expiringSoon = 0, expired = 0;
  const upcoming: typeof docs = [];
  for (const d of docs) {
    if (!d.expiryDate) { valid++; continue; }
    if (d.expiryDate < now) expired++;
    else if (d.expiryDate <= in30) { expiringSoon++; upcoming.push(d); }
    else valid++;
  }
  upcoming.sort((a, b) => (a.expiryDate?.getTime() ?? 0) - (b.expiryDate?.getTime() ?? 0));

  const presentTypes = new Set(docs.filter(d => d.status === "active").map(d => d.type));
  const required = COUNTRY_REQUIRED[country] ?? [];
  const missing = required.filter(t => !presentTypes.has(t));

  res.json({
    country,
    counts: { total: docs.length, valid, expiringSoon, expired, missing: missing.length },
    upcoming: upcoming.slice(0, 20),
    expiredList: docs.filter(d => d.expiryDate && d.expiryDate < now)
      .sort((a, b) => (a.expiryDate?.getTime() ?? 0) - (b.expiryDate?.getTime() ?? 0)),
    missingRequired: missing,
    requiredForCountry: required,
  });
});

// ---- Settings ----

router.get("/restaurants/:restaurantId/compliance/settings", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(restaurantSettingsTable)
    .where(eq(restaurantSettingsTable.restaurantId, restaurantId));
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if ((COMPLIANCE_SECTIONS as readonly string[]).includes(r.section)) {
      out[r.section] = r.data;
    }
  }
  res.json(out);
});

const settingsBody = z.record(z.string(), z.unknown());

router.put("/restaurants/:restaurantId/compliance/settings/:section", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const section = req.params.section as ComplianceSection;
  if (!(COMPLIANCE_SECTIONS as readonly string[]).includes(section)) {
    return void res.status(400).json({ error: "Unknown compliance section" });
  }
  const parsed = settingsBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body" });

  const [existing] = await db.select().from(restaurantSettingsTable)
    .where(and(eq(restaurantSettingsTable.restaurantId, restaurantId), eq(restaurantSettingsTable.section, section)));

  if (existing) {
    await db.update(restaurantSettingsTable).set({
      data: parsed.data, updatedBy: req.user?.sub ?? null, updatedAt: new Date(),
    }).where(and(eq(restaurantSettingsTable.restaurantId, restaurantId), eq(restaurantSettingsTable.section, section)));
  } else {
    await db.insert(restaurantSettingsTable).values({
      restaurantId, section, data: parsed.data, updatedBy: req.user?.sub ?? null,
    });
  }
  // Mirror tax payload into the legacy "taxes" section so the existing POS/billing
  // flow keeps reading the configured rates without code changes there.
  if (section === "compliance_tax") {
    const [legacyTaxes] = await db.select().from(restaurantSettingsTable)
      .where(and(eq(restaurantSettingsTable.restaurantId, restaurantId), eq(restaurantSettingsTable.section, "taxes")));
    const merged = { ...(legacyTaxes?.data as Record<string, unknown> ?? {}), ...parsed.data };
    if (legacyTaxes) {
      await db.update(restaurantSettingsTable).set({ data: merged, updatedBy: req.user?.sub ?? null, updatedAt: new Date() })
        .where(and(eq(restaurantSettingsTable.restaurantId, restaurantId), eq(restaurantSettingsTable.section, "taxes")));
    } else {
      await db.insert(restaurantSettingsTable).values({ restaurantId, section: "taxes", data: merged, updatedBy: req.user?.sub ?? null });
    }
  }
  await recordAuditLog({
    req, module: "compliance", action: `settings.update.${section}`, entity: "compliance_settings",
    restaurantId, oldValue: existing?.data, newValue: parsed.data,
  });
  res.json({ ok: true, section, data: parsed.data });
});

// ---- Compliance contacts ----

router.get("/restaurants/:restaurantId/compliance/contacts", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select({
    id: complianceContactsTable.id,
    userId: complianceContactsTable.userId,
    name: usersTable.name,
    email: usersTable.email,
    phone: usersTable.phone,
    role: usersTable.role,
  }).from(complianceContactsTable)
    .leftJoin(usersTable, eq(complianceContactsTable.userId, usersTable.id))
    .where(eq(complianceContactsTable.restaurantId, restaurantId));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/compliance/contacts", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.body?.userId);
  if (!Number.isFinite(userId) || userId <= 0) return void res.status(400).json({ error: "userId required" });
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return void res.status(404).json({ error: "User not found" });
  const [restaurant] = await db.select({ tenantId: restaurantsTable.tenantId })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (user.tenantId !== restaurant?.tenantId) return void res.status(403).json({ error: "Cross-tenant user" });
  try {
    const [row] = await db.insert(complianceContactsTable).values({ restaurantId, userId }).returning();
    await recordAuditLog({
      req, module: "compliance", action: "contact.add", entity: "compliance_contact",
      entityId: row?.id, restaurantId, newValue: { userId },
    });
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "Contact already exists" });
  }
});

router.delete("/restaurants/:restaurantId/compliance/contacts/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  await db.delete(complianceContactsTable)
    .where(and(eq(complianceContactsTable.id, id), eq(complianceContactsTable.restaurantId, restaurantId)));
  await recordAuditLog({
    req, module: "compliance", action: "contact.remove", entity: "compliance_contact",
    entityId: id, restaurantId,
  });
  res.status(204).send();
});

export default router;

// ---- Reminder cron entry point ----

import { sendEmail } from "../lib/notifications";
import { notificationsTable } from "../lib/db";
import { logger } from "../lib/logger";

interface ReminderResult { evaluated: number; remindersSent: number; }

/**
 * Scans all compliance documents and emits reminders at the configured cadence
 * (60/30/15/7/1 days before expiry, on expiry day, and weekly thereafter).
 * Idempotent within each cadence stage via lastReminderStage/lastReminderAt.
 */
export async function runComplianceReminderTick(now: Date = new Date()): Promise<ReminderResult> {
  const docs = await db.select().from(complianceDocumentsTable)
    .where(and(eq(complianceDocumentsTable.status, "active"), isNotNull(complianceDocumentsTable.expiryDate)));
  let remindersSent = 0;
  for (const d of docs) {
    if (!d.expiryDate) continue;
    if (d.reminderDismissedUntil && d.reminderDismissedUntil > now) continue;
    const msToExpiry = d.expiryDate.getTime() - now.getTime();
    const daysToExpiry = Math.ceil(msToExpiry / 86_400_000);
    let stage: string | null = null;
    if (daysToExpiry === 60) stage = "60d";
    else if (daysToExpiry === 30) stage = "30d";
    else if (daysToExpiry === 15) stage = "15d";
    else if (daysToExpiry === 7) stage = "7d";
    else if (daysToExpiry === 1) stage = "1d";
    else if (daysToExpiry === 0) stage = "today";
    else if (daysToExpiry < 0) {
      // Overdue: weekly nag
      const last = d.lastReminderAt;
      if (!last || now.getTime() - last.getTime() >= 7 * 86_400_000) stage = `overdue-${Math.abs(daysToExpiry)}d`;
    }
    if (!stage) continue;
    if (d.lastReminderStage === stage) continue;

    try {
      await sendComplianceReminder(d, daysToExpiry, now);
      await db.update(complianceDocumentsTable)
        .set({ lastReminderStage: stage, lastReminderAt: now, updatedAt: new Date() })
        .where(eq(complianceDocumentsTable.id, d.id));
      remindersSent++;
    } catch (err) {
      logger.warn({ err, docId: d.id }, "compliance reminder send failed");
    }
  }
  return { evaluated: docs.length, remindersSent };
}

async function sendComplianceReminder(
  doc: typeof complianceDocumentsTable.$inferSelect,
  daysToExpiry: number,
  now: Date,
): Promise<void> {
  const status = daysToExpiry < 0 ? `overdue by ${Math.abs(daysToExpiry)} day(s)` :
                 daysToExpiry === 0 ? "expires today" :
                 `expires in ${daysToExpiry} day(s)`;
  const title = `Compliance: ${doc.title ?? doc.type.toUpperCase()} ${status}`;
  const message = `${doc.title ?? doc.type.toUpperCase()}${doc.documentNumber ? ` (${doc.documentNumber})` : ""} ${status}. Expiry: ${doc.expiryDate?.toISOString().slice(0, 10) ?? "—"}.`;

  // In-app notification
  await db.insert(notificationsTable).values({
    restaurantId: doc.restaurantId,
    type: "compliance_expiry",
    title,
    message,
    entityId: doc.id,
    entityType: "compliance_document",
  }).catch(err => logger.warn({ err }, "compliance: insert notification failed"));

  // Resolve recipients: owners + tagged compliance contacts
  const owners = await db.select({ email: usersTable.email, name: usersTable.name, phone: usersTable.phone })
    .from(usersTable)
    .where(and(eq(usersTable.restaurantId, doc.restaurantId), eq(usersTable.role, "owner"), eq(usersTable.isActive, true)));
  const contacts = await db.select({ email: usersTable.email, name: usersTable.name, phone: usersTable.phone })
    .from(complianceContactsTable)
    .leftJoin(usersTable, eq(complianceContactsTable.userId, usersTable.id))
    .where(eq(complianceContactsTable.restaurantId, doc.restaurantId));
  const recipients = [...owners, ...contacts.filter(c => c.email)];
  const emails = Array.from(new Set(recipients.map(r => r.email).filter((e): e is string => !!e)));

  for (const email of emails) {
    await sendEmail({
      to: email,
      subject: title,
      text: message,
      html: `<p>${message}</p>${doc.notes ? `<p><em>${doc.notes}</em></p>` : ""}<p style="color:#888;font-size:0.85em">Open Compliance → Documents to review or upload a renewed copy.</p>`,
    }).catch(err => logger.warn({ err, email }, "compliance reminder email failed"));
  }

  // Best-effort WhatsApp / SMS — guarded so missing config doesn't break the tick
  try {
    const phones = Array.from(new Set(recipients.map(r => r.phone).filter((p): p is string => !!p)));
    if (phones.length > 0) {
      const { sendBroadcastWhatsApp } = await import("../lib/whatsapp");
      for (const to of phones) {
        await sendBroadcastWhatsApp({
          restaurantId: doc.restaurantId,
          to,
          event: "compliance_expiry",
          body: message,
          templateVars: { title, status },
        }).catch(() => {});
      }
    }
  } catch { /* whatsapp optional */ }

  void now;
}
