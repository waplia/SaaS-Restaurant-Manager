/**
 * Task #674 — Bill Templates API.
 *
 * Endpoints (all under /api):
 *   GET    /restaurants/:rid/bill-templates                — list (auto-seeds defaults)
 *   POST   /restaurants/:rid/bill-templates                — create
 *   GET    /restaurants/:rid/bill-templates/:id            — fetch one
 *   PUT    /restaurants/:rid/bill-templates/:id            — update
 *   DELETE /restaurants/:rid/bill-templates/:id            — delete (system rows can't be deleted)
 *   GET    /restaurants/:rid/bill-templates/channels       — channel→template map
 *   PUT    /restaurants/:rid/bill-templates/channels       — set channel assignments
 *   POST   /restaurants/:rid/bill-templates/:id/preview    — render a sample bill (HTML)
 *   GET    /restaurants/:rid/orders/:orderId/bill-render   — render real order bill (HTML)
 *
 * The render endpoints are the single source of truth used by web POS,
 * desktop POS, mobile, the QR receipt link, A4 download, WhatsApp share,
 * and email — they all fetch HTML from here so a template change reflects
 * everywhere immediately.
 */
import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, billTemplatesTable, ordersTable, printersTable, printJobsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  ensureSeededTemplates,
  getChannelAssignments,
  setChannelAssignments,
  resolveTemplateForChannel,
  getTemplateById,
} from "../lib/billTemplates";
import { getOrBuildBillSnapshot, buildSampleBillSnapshot } from "../lib/billSnapshot";
import { renderBillHTML, renderBillText } from "../lib/billRender";
import { sendEmail, sendWhatsApp } from "../lib/notifications";
import { recordAuditLog } from "../lib/audit";
import { broadcastEvent } from "../lib/socketio";
import { BILL_CHANNELS, type BillChannel } from "@workspace/db/schema";

const router = Router();

router.get(
  "/restaurants/:restaurantId/bill-templates",
  requireRole("owner", "manager", "cashier", "waiter", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const templates = await ensureSeededTemplates(restaurantId);
    const channels = await getChannelAssignments(restaurantId);
    res.json({ templates, channels: channels.channels, availableChannels: BILL_CHANNELS });
  },
);

router.get(
  "/restaurants/:restaurantId/bill-templates/channels",
  requireRole("owner", "manager", "cashier", "waiter", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const channels = await getChannelAssignments(restaurantId);
    res.json({ channels: channels.channels, availableChannels: BILL_CHANNELS });
  },
);

router.put(
  "/restaurants/:restaurantId/bill-templates/channels",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const patch = (req.body?.channels ?? req.body ?? {}) as Record<string, number | null>;
    const saved = await setChannelAssignments(restaurantId, patch as Partial<Record<BillChannel, number | null>>, req.user?.sub ?? null);
    res.json({ channels: saved.channels, availableChannels: BILL_CHANNELS });
  },
);

router.post(
  "/restaurants/:restaurantId/bill-templates",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const b = req.body ?? {};
    if (!b.key || !b.name || !b.paperSize) {
      return void res.status(400).json({ error: "key, name and paperSize are required" });
    }
    const [created] = await db
      .insert(billTemplatesTable)
      .values({
        restaurantId,
        key: String(b.key),
        name: String(b.name),
        description: b.description ?? null,
        paperSize: String(b.paperSize),
        layout: b.layout ?? {},
        isDefault: !!b.isDefault,
        isSystem: false,
      })
      .returning();
    res.status(201).json(created);
  },
);

router.get(
  "/restaurants/:restaurantId/bill-templates/:id",
  requireRole("owner", "manager", "cashier", "waiter", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const t = await getTemplateById(restaurantId, id);
    if (!t) return void res.status(404).json({ error: "Template not found" });
    res.json(t);
  },
);

router.put(
  "/restaurants/:restaurantId/bill-templates/:id",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const b = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (b.name !== undefined) patch.name = String(b.name);
    if (b.description !== undefined) patch.description = b.description;
    if (b.paperSize !== undefined) patch.paperSize = String(b.paperSize);
    if (b.layout !== undefined) patch.layout = b.layout;
    if (b.isDefault !== undefined) patch.isDefault = !!b.isDefault;
    const [updated] = await db
      .update(billTemplatesTable)
      .set(patch)
      .where(and(eq(billTemplatesTable.id, id), eq(billTemplatesTable.restaurantId, restaurantId)))
      .returning();
    if (!updated) return void res.status(404).json({ error: "Template not found" });
    res.json(updated);
  },
);

router.delete(
  "/restaurants/:restaurantId/bill-templates/:id",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const t = await getTemplateById(restaurantId, id);
    if (!t) return void res.status(404).json({ error: "Template not found" });
    if (t.isSystem) {
      return void res.status(400).json({ error: "System templates cannot be deleted — edit them instead." });
    }
    await db.delete(billTemplatesTable).where(eq(billTemplatesTable.id, id));
    res.json({ ok: true });
  },
);

/**
 * Preview a template using a synthetic sample bill. Used by the editor
 * "Preview" / "Sample PDF" / "Send test invoice" actions.
 */
router.post(
  "/restaurants/:restaurantId/bill-templates/:id/preview",
  requireRole("owner", "manager", "cashier", "waiter", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const template = await getTemplateById(restaurantId, id);
    if (!template) return void res.status(404).json({ error: "Template not found" });
    const snapshot = await buildSampleBillSnapshot(restaurantId);
    if (!snapshot) return void res.status(404).json({ error: "Restaurant not found" });
    const html = renderBillHTML(snapshot, template, { watermark: "PREVIEW" });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  },
);

/**
 * Task #677 — Send a sample invoice to a chosen phone (WhatsApp) or email.
 * Renders the template against the synthetic sample snapshot and ships the
 * resulting HTML so owners can see exactly what customers will receive.
 */
router.post(
  "/restaurants/:restaurantId/bill-templates/:id/send-test",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const channel = String(req.body?.channel ?? "").toLowerCase();
    const to = String(req.body?.to ?? "").trim();
    if (!to) return void res.status(400).json({ error: "Recipient is required" });
    if (channel !== "whatsapp" && channel !== "email") {
      return void res.status(400).json({ error: "channel must be 'whatsapp' or 'email'" });
    }
    const template = await getTemplateById(restaurantId, id);
    if (!template) return void res.status(404).json({ error: "Template not found" });
    const snapshot = await buildSampleBillSnapshot(restaurantId);
    if (!snapshot) return void res.status(404).json({ error: "Restaurant not found" });
    const html = renderBillHTML(snapshot, template, { watermark: "TEST INVOICE" });
    const text = renderBillText(snapshot, template);

    try {
      if (channel === "email") {
        await sendEmail({
          to,
          subject: `Test invoice — ${template.name}`,
          html,
          text,
        });
      } else {
        const previewLine = `Test invoice from ${snapshot.restaurant.name} using template "${template.name}". Total: ${snapshot.totals.grandTotal.toFixed(2)} ${snapshot.restaurant.currency || "INR"}.`;
        await sendWhatsApp({
          to,
          body: `${previewLine}\n\n${text}`,
          restaurantId,
          meta: { kind: "bill_template_test", templateId: id },
        });
      }
      await recordAuditLog({
        req, module: "bill-templates", action: "bill_template.test_sent",
        entity: "bill_template", entityId: id, restaurantId,
        details: `Sent test invoice via ${channel} to ${to}`,
      });
      res.json({ ok: true, channel, to });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Send failed" });
    }
  },
);

/**
 * Task #677 — Queue a "Test print" job for the chosen printer using the
 * template's sample snapshot. The desktop bridge / mobile app picks the
 * job up via the existing print-job queue.
 */
router.post(
  "/restaurants/:restaurantId/bill-templates/:id/test-print",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const printerId = Number(req.body?.printerId);
    if (!printerId) return void res.status(400).json({ error: "printerId is required" });

    const [printer] = await db.select().from(printersTable)
      .where(and(
        eq(printersTable.id, printerId),
        eq(printersTable.restaurantId, restaurantId),
        isNull(printersTable.deletedAt),
      ));
    if (!printer) return void res.status(404).json({ error: "Printer not found" });
    if (!printer.enabled) return void res.status(400).json({ error: "Printer is disabled" });

    const template = await getTemplateById(restaurantId, id);
    if (!template) return void res.status(404).json({ error: "Template not found" });
    const snapshot = await buildSampleBillSnapshot(restaurantId);
    if (!snapshot) return void res.status(404).json({ error: "Restaurant not found" });
    const html = renderBillHTML(snapshot, template, { watermark: "TEST PRINT" });
    const text = renderBillText(snapshot, template);

    const [job] = await db.insert(printJobsTable).values({
      restaurantId,
      branchId: printer.branchId,
      printerId,
      printType: "test",
      payload: {
        type: "bill_template_test",
        templateId: id,
        templateName: template.name,
        paperSize: template.paperSize,
        html,
        text,
      },
      status: "queued",
      copies: 1,
      requestedBy: req.user?.sub ?? null,
      requestedByName: req.user?.email ?? null,
    }).returning();

    await recordAuditLog({
      req, module: "bill-templates", action: "bill_template.test_print",
      entity: "bill_template", entityId: id, restaurantId,
      details: `Queued test print for printer #${printerId} (job #${job.id})`,
    });
    broadcastEvent(restaurantId, "print-job:new", { id: job.id, printerId });
    res.json({ ok: true, jobId: job.id });
  },
);

/**
 * Render the bill for a real order using the channel-mapped template (or
 * a specific templateId if provided). Honours the frozen snapshot when
 * present, otherwise computes one on the fly.
 *
 * `?format=json` returns `{ html, text, snapshot, template }` for callers
 * that want to embed; default returns just HTML so the URL works as a
 * direct `<a href>` / iframe src / `Linking.openURL` / WhatsApp share link.
 */
router.get(
  "/restaurants/:restaurantId/orders/:orderId/bill-render",
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const orderId = Number(req.params.orderId);
    const channel = (typeof req.query.channel === "string" ? req.query.channel : "web_pos") as BillChannel;
    const templateIdQ = req.query.templateId ? Number(req.query.templateId) : null;

    const [order] = await db
      .select({ id: ordersTable.id, restaurantId: ordersTable.restaurantId })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));
    if (!order || order.restaurantId !== restaurantId) {
      return void res.status(404).json({ error: "Order not found" });
    }

    const snapshot = await getOrBuildBillSnapshot(orderId);
    if (!snapshot) return void res.status(404).json({ error: "Order not found" });

    const template = templateIdQ
      ? await getTemplateById(restaurantId, templateIdQ)
      : await resolveTemplateForChannel(restaurantId, channel);
    if (!template) return void res.status(404).json({ error: "No template available for this channel" });

    const html = renderBillHTML(snapshot, template);
    if (req.query.format === "json") {
      const text = renderBillText(snapshot, template);
      return void res.json({ html, text, snapshot, template });
    }
    if (req.query.format === "text") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return void res.send(renderBillText(snapshot, template));
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  },
);

export default router;
