/**
 * Task #436 — Public status page + super-admin incident authoring.
 *
 * - `publicSupportStatusRouter` exposes `/public/status` without auth so
 *   tenants (and the world) can see active/recent incidents.
 * - `default` (admin) router carries the CRUD for super-admins.
 */
import { Router } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  supportIncidentsTable,
  supportIncidentUpdatesTable,
  type SupportIncidentStatus,
  type SupportIncidentSeverity,
} from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import { getSlaSettings } from "../lib/supportSla";
import { recordAuditLog } from "../lib/audit";

const STATUSES: SupportIncidentStatus[] = ["investigating", "identified", "monitoring", "resolved"];
const SEVERITIES: SupportIncidentSeverity[] = ["minor", "major", "critical"];

function isStatus(s: unknown): s is SupportIncidentStatus { return typeof s === "string" && (STATUSES as string[]).includes(s); }
function isSeverity(s: unknown): s is SupportIncidentSeverity { return typeof s === "string" && (SEVERITIES as string[]).includes(s); }

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function loadEnvelope(incidentId: number) {
  const updates = await db.select().from(supportIncidentUpdatesTable)
    .where(eq(supportIncidentUpdatesTable.incidentId, incidentId))
    .orderBy(desc(supportIncidentUpdatesTable.createdAt));
  return { updates };
}

/* --------------------------- PUBLIC --------------------------- */

export const publicSupportStatusRouter = Router();

/**
 * GET /public/status — open status page payload.
 *
 * Returns the configured page title + description, all unresolved incidents
 * (with full update threads), and the most recent resolved incidents from
 * the trailing 30 days. We deliberately omit author identity to avoid
 * leaking staff PII to the public.
 */
publicSupportStatusRouter.get("/public/status", async (_req, res) => {
  const settings = await getSlaSettings();
  if (!settings.statusPageEnabled) {
    return void res.status(404).json({ error: "Status page disabled" });
  }
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // Only surface incidents flagged isPublished=true on the public status page
  // so admins can draft incidents privately before going live.
  const [active, recent] = await Promise.all([
    db.select().from(supportIncidentsTable)
      .where(and(sql`${supportIncidentsTable.status} <> 'resolved'`, eq(supportIncidentsTable.isPublished, true)))
      .orderBy(desc(supportIncidentsTable.startedAt)),
    db.select().from(supportIncidentsTable)
      .where(and(eq(supportIncidentsTable.status, "resolved"), eq(supportIncidentsTable.isPublished, true), gte(supportIncidentsTable.startedAt, thirtyDaysAgo)))
      .orderBy(desc(supportIncidentsTable.startedAt))
      .limit(20),
  ]);
  const all = [...active, ...recent];
  const envelopes = await Promise.all(all.map(async i => ({ ...i, ...(await loadEnvelope(i.id)) })));
  // Operational health rollup — green if no active incidents.
  const worst: SupportIncidentSeverity | "none" = active.length === 0
    ? "none"
    : active.some(i => i.severity === "critical") ? "critical"
    : active.some(i => i.severity === "major")    ? "major"
    : "minor";
  res.json({
    title: settings.statusPageTitle,
    description: settings.statusPageDescription,
    overallSeverity: worst,
    active: envelopes.filter(e => e.status !== "resolved"),
    recent: envelopes.filter(e => e.status === "resolved"),
  });
});

/* --------------------------- ADMIN --------------------------- */

const adminRouter = Router();

adminRouter.get("/admin/support/incidents", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(supportIncidentsTable).orderBy(desc(supportIncidentsTable.startedAt)).limit(200);
  const data = await Promise.all(rows.map(async r => ({ ...r, ...(await loadEnvelope(r.id)) })));
  res.json({ data });
});

/**
 * GET /admin/support/incidents/:id — full incident envelope.
 *
 * Frontend `IncidentDetail` expands a row and pulls `{ incident, updates }`
 * here to render the timeline. Without this endpoint the admin UI returned
 * 404 on expand. See code-review follow-up for task #436.
 */
adminRouter.get("/admin/support/incidents/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [incident] = await db.select().from(supportIncidentsTable).where(eq(supportIncidentsTable.id, id));
  if (!incident) return void res.status(404).json({ error: "Not found" });
  const { updates } = await loadEnvelope(id);
  res.json({ incident, updates });
});

adminRouter.post("/admin/support/incidents", requireSuperAdmin, async (req, res) => {
  const { title, body, status, severity, affectedComponents, isPublished } = req.body as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim()) return void res.status(400).json({ error: "title required" });
  if (typeof body !== "string"  || !body.trim())  return void res.status(400).json({ error: "body required" });
  const finalStatus: SupportIncidentStatus = isStatus(status) ? status : "investigating";
  const finalSeverity: SupportIncidentSeverity = isSeverity(severity) ? severity : "minor";
  const components = Array.isArray(affectedComponents) ? affectedComponents.filter(s => typeof s === "string") as string[] : [];
  const published = typeof isPublished === "boolean" ? isPublished : true;

  const [created] = await db.insert(supportIncidentsTable).values({
    title: title.trim(),
    body: body.trim(),
    status: finalStatus,
    severity: finalSeverity,
    affectedComponents: components,
    isPublished: published,
    createdBy: (req.user as { sub?: number; id?: number } | undefined)?.sub ?? (req.user as { id?: number } | undefined)?.id ?? null,
  }).returning();
  // Mirror the body into the timeline as the seed update so the status page reads consistently.
  await db.insert(supportIncidentUpdatesTable).values({
    incidentId: created.id,
    status: finalStatus,
    body: body.trim(),
    createdBy: created.createdBy,
  });
  await recordAuditLog({ req, module: "support", action: "incident.create", entity: "support_incident", entityId: created.id, newValue: created });
  res.status(201).json({ ...created, ...(await loadEnvelope(created.id)) });
});

adminRouter.patch("/admin/support/incidents/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [old] = await db.select().from(supportIncidentsTable).where(eq(supportIncidentsTable.id, id));
  if (!old) return void res.status(404).json({ error: "Not found" });
  const { title, body, status, severity, affectedComponents, isPublished } = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof title === "string" && title.trim()) patch.title = title.trim();
  if (typeof body  === "string" && body.trim())  patch.body  = body.trim();
  if (isStatus(status)) {
    patch.status = status;
    if (status === "resolved" && !old.resolvedAt) patch.resolvedAt = new Date();
    if (status !== "resolved" && old.resolvedAt) patch.resolvedAt = null;
  }
  if (isSeverity(severity)) patch.severity = severity;
  if (Array.isArray(affectedComponents)) patch.affectedComponents = affectedComponents.filter(s => typeof s === "string") as string[];
  if (typeof isPublished === "boolean") patch.isPublished = isPublished;
  const [updated] = await db.update(supportIncidentsTable).set(patch).where(eq(supportIncidentsTable.id, id)).returning();
  await recordAuditLog({ req, module: "support", action: "incident.update", entity: "support_incident", entityId: id, oldValue: old, newValue: updated });
  res.json({ ...updated, ...(await loadEnvelope(id)) });
});

adminRouter.post("/admin/support/incidents/:id/updates", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { status, body } = req.body as Record<string, unknown>;
  if (typeof body !== "string" || !body.trim()) return void res.status(400).json({ error: "body required" });
  const finalStatus: SupportIncidentStatus = isStatus(status) ? status : "investigating";
  const userId = (req.user as { sub?: number; id?: number } | undefined)?.sub ?? (req.user as { id?: number } | undefined)?.id ?? null;
  const [created] = await db.insert(supportIncidentUpdatesTable).values({
    incidentId: id, status: finalStatus, body: body.trim(), createdBy: userId,
  }).returning();
  const patch: Record<string, unknown> = { status: finalStatus, updatedAt: new Date() };
  if (finalStatus === "resolved") patch.resolvedAt = new Date();
  await db.update(supportIncidentsTable).set(patch).where(eq(supportIncidentsTable.id, id));
  await recordAuditLog({ req, module: "support", action: "incident.update.post", entity: "support_incident", entityId: id, newValue: created });
  res.status(201).json(created);
});

adminRouter.delete("/admin/support/incidents/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [old] = await db.select().from(supportIncidentsTable).where(eq(supportIncidentsTable.id, id));
  await db.delete(supportIncidentsTable).where(eq(supportIncidentsTable.id, id));
  await recordAuditLog({ req, module: "support", action: "incident.delete", entity: "support_incident", entityId: id, oldValue: old });
  res.json({ ok: true });
});

export default adminRouter;
