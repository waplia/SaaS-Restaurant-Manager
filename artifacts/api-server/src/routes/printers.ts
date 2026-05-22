/**
 * Printer Settings + Print Jobs queue (Task #599).
 *
 * Exposes a unified printer registry and an HTTP-driven print queue that the
 * mobile app, browser admin, and desktop print bridge all share. The actual
 * "byte transport" (Bluetooth / USB / LAN socket / browser dialog) is
 * implemented by the client; this endpoint surface is the system of record.
 *
 * Surface:
 *   GET    /restaurants/:r/printers                  → list
 *   POST   /restaurants/:r/printers                  → create
 *   PATCH  /restaurants/:r/printers/:id              → update / enable / disable
 *   DELETE /restaurants/:r/printers/:id              → soft-delete
 *   POST   /restaurants/:r/printers/:id/set-default  → default per role+branch
 *   POST   /restaurants/:r/printers/:id/test-print   → enqueues a test job
 *   POST   /restaurants/:r/printers/:id/status       → mobile/desktop reports status
 *   GET    /restaurants/:r/printers/resolve          → station-routing helper
 *
 *   GET    /restaurants/:r/print-jobs                → queue/history list
 *   POST   /restaurants/:r/print-jobs                → enqueue a job
 *   POST   /restaurants/:r/print-jobs/:id/claim      → worker claims for printing
 *   POST   /restaurants/:r/print-jobs/:id/complete   → worker marks printed
 *   POST   /restaurants/:r/print-jobs/:id/fail       → worker reports failure
 *   POST   /restaurants/:r/print-jobs/:id/retry      → manual retry
 *   POST   /restaurants/:r/print-jobs/:id/cancel     → manual cancel
 *   POST   /restaurants/:r/print-jobs/:id/reprint    → re-queues a finished job
 */
import { Router } from "express";
import { and, eq, isNull, desc, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db, printersTable, printJobsTable, kitchensTable, branchesTable,
  ordersTable, restaurantSettingsTable,
  PRINTER_ROLES, PRINTER_CONNECTIONS, PRINTER_PAPER_SIZES, PRINT_JOB_TYPES,
  type PrinterRole, type Printer, type PrintJob,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { validate } from "../middleware/validate";
import { recordAuditLog } from "../lib/audit";
import { broadcastEvent } from "../lib/socketio";

const router = Router();

const READ_ROLES = ["owner", "manager", "waiter", "cashier", "kitchen", "delivery_executive", "super_admin"] as const;
const WRITE_ROLES = ["owner", "manager", "super_admin"] as const;
const PRINT_ROLES = ["owner", "manager", "cashier", "kitchen", "waiter", "super_admin"] as const;

router.use("/restaurants/:restaurantId/printers", requireRole(...READ_ROLES), validateRestaurantAccess);
router.use("/restaurants/:restaurantId/print-jobs", requireRole(...READ_ROLES), validateRestaurantAccess);

function canWrite(req: { user?: { role?: string; isSuperAdmin?: boolean } }): boolean {
  return Boolean(req.user?.isSuperAdmin || (req.user?.role && (WRITE_ROLES as readonly string[]).includes(req.user.role)));
}
function canPrint(req: { user?: { role?: string; isSuperAdmin?: boolean } }): boolean {
  return Boolean(req.user?.isSuperAdmin || (req.user?.role && (PRINT_ROLES as readonly string[]).includes(req.user.role)));
}

/**
 * Per-print-type RBAC. Owners/managers/super-admins can print anything; line
 * staff can only print artifacts that match their job. This is enforced at
 * every enqueue/test/reprint entry point so a cashier can't trigger a kitchen
 * KOT (and vice-versa) by hand-crafting an API call.
 */
function canPrintType(
  req: { user?: { role?: string; isSuperAdmin?: boolean } },
  printType: string,
): boolean {
  if (req.user?.isSuperAdmin) return true;
  const role = req.user?.role;
  if (!role) return false;
  if (role === "owner" || role === "manager") return true;
  // Normalise reprint variants to their base type for the matrix.
  const base = printType.replace(/^reprint_/, "");
  const matrix: Record<string, string[]> = {
    bill: ["cashier"],
    receipt: ["cashier"],
    token: ["cashier", "waiter"],
    upi_qr: ["cashier", "waiter"],
    kot: ["kitchen", "chef", "captain", "waiter"],
    cancelled_kot: ["kitchen", "chef", "captain", "waiter"],
    modified_kot: ["kitchen", "chef", "captain", "waiter"],
    test: ["cashier", "waiter", "kitchen", "chef"],
  };
  return matrix[base]?.includes(role) ?? false;
}

const ConnectionSchema = z.object({
  address: z.string().optional(),
  deviceName: z.string().optional(),
  vendorId: z.string().optional(),
  productId: z.string().optional(),
  host: z.string().optional(),
  port: z.coerce.number().int().positive().optional(),
}).partial().passthrough();

const CreatePrinterBody = z.object({
  name: z.string().trim().min(1).max(120),
  connectionType: z.enum(PRINTER_CONNECTIONS as [string, ...string[]]),
  role: z.enum(PRINTER_ROLES as [string, ...string[]]),
  paperSize: z.enum(PRINTER_PAPER_SIZES as [string, ...string[]]).default("80mm"),
  branchId: z.coerce.number().int().positive().nullable().optional(),
  kitchenId: z.coerce.number().int().positive().nullable().optional(),
  connection: ConnectionSchema.optional(),
  isDefault: z.boolean().optional(),
  autoPrint: z.boolean().optional(),
  enabled: z.boolean().optional(),
  copies: z.coerce.number().int().min(1).max(10).optional(),
  charactersPerLine: z.coerce.number().int().min(16).max(96).optional(),
  feedLines: z.coerce.number().int().min(0).max(10).optional(),
  cutPaper: z.boolean().optional(),
  cashDrawerKick: z.boolean().optional(),
  buzzer: z.boolean().optional(),
});
const UpdatePrinterBody = CreatePrinterBody.partial();

async function validateRefs(restaurantId: number, branchId: number | null | undefined, kitchenId: number | null | undefined): Promise<string | null> {
  if (branchId != null) {
    const [b] = await db.select({ id: branchesTable.id }).from(branchesTable)
      .where(and(eq(branchesTable.id, branchId), eq(branchesTable.restaurantId, restaurantId)));
    if (!b) return "branchId not found in this restaurant";
  }
  if (kitchenId != null) {
    const [k] = await db.select({ id: kitchensTable.id }).from(kitchensTable)
      .where(and(eq(kitchensTable.id, kitchenId), eq(kitchensTable.restaurantId, restaurantId)));
    if (!k) return "kitchenId not found in this restaurant";
  }
  return null;
}

// ─── LIST ────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/printers", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { branchId, role, connectionType, includeDeleted } = req.query;
  const conds = [eq(printersTable.restaurantId, restaurantId)];
  if (!includeDeleted) conds.push(isNull(printersTable.deletedAt));
  if (branchId && branchId !== "all") conds.push(eq(printersTable.branchId, Number(branchId)));
  if (role) conds.push(eq(printersTable.role, String(role) as never));
  if (connectionType) conds.push(eq(printersTable.connectionType, String(connectionType) as never));
  const rows = await db.select().from(printersTable).where(and(...conds))
    .orderBy(desc(printersTable.isDefault), printersTable.name);
  res.json(rows);
});

// `/resolve` MUST be registered before `/:id` — otherwise Express matches
// "resolve" as the numeric printer id and the routing helper returns 404.
router.get("/restaurants/:restaurantId/printers/resolve", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const role = String(req.query.role ?? "") as PrinterRole;
  const kitchenId = req.query.kitchenId ? Number(req.query.kitchenId) : null;
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const printer = await resolvePrinterFor({ restaurantId, role, kitchenId, branchId });
  res.json({ printer });
});

router.get("/restaurants/:restaurantId/printers/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return void res.status(404).json({ error: "Not found" });
  const [p] = await db.select().from(printersTable)
    .where(and(eq(printersTable.id, id), eq(printersTable.restaurantId, restaurantId)));
  if (!p) return void res.status(404).json({ error: "Not found" });
  res.json(p);
});

// ─── CREATE ──────────────────────────────────────────────────────────────
router.post("/restaurants/:restaurantId/printers", validate({ body: CreatePrinterBody }), async (req, res) => {
  if (!canWrite(req)) return void res.status(403).json({ error: "Insufficient permissions" });
  const restaurantId = Number(req.params.restaurantId);
  const body = req.body as z.infer<typeof CreatePrinterBody>;

  const err = await validateRefs(restaurantId, body.branchId ?? null, body.kitchenId ?? null);
  if (err) return void res.status(400).json({ error: err });

  // If isDefault, clear other defaults for the same role+branch
  if (body.isDefault) {
    await clearDefaultsFor(restaurantId, body.role as PrinterRole, body.branchId ?? null);
  }

  const [row] = await db.insert(printersTable).values({
    restaurantId,
    branchId: body.branchId ?? null,
    kitchenId: body.kitchenId ?? null,
    name: body.name,
    connectionType: body.connectionType as never,
    role: body.role as never,
    paperSize: (body.paperSize ?? "80mm") as never,
    connection: body.connection ?? {},
    isDefault: !!body.isDefault,
    autoPrint: !!body.autoPrint,
    enabled: body.enabled ?? true,
    copies: body.copies ?? 1,
    charactersPerLine: body.charactersPerLine ?? (body.paperSize === "58mm" ? 32 : 48),
    feedLines: body.feedLines ?? 3,
    cutPaper: body.cutPaper ?? true,
    cashDrawerKick: !!body.cashDrawerKick,
    buzzer: !!body.buzzer,
  }).returning();

  await recordAuditLog({
    req, module: "printers", action: "printer.added", entity: "printer",
    entityId: row.id, restaurantId, newValue: redactConnection(row),
  });
  broadcastEvent(restaurantId, "printer:changed", { id: row.id });
  res.status(201).json(row);
});

// ─── UPDATE ──────────────────────────────────────────────────────────────
router.patch("/restaurants/:restaurantId/printers/:id", validate({ body: UpdatePrinterBody }), async (req, res) => {
  if (!canWrite(req)) return void res.status(403).json({ error: "Insufficient permissions" });
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const body = req.body as z.infer<typeof UpdatePrinterBody>;

  const [existing] = await db.select().from(printersTable)
    .where(and(eq(printersTable.id, id), eq(printersTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });

  const err = await validateRefs(restaurantId, body.branchId ?? existing.branchId, body.kitchenId ?? existing.kitchenId);
  if (err) return void res.status(400).json({ error: err });

  if (body.isDefault) {
    await clearDefaultsFor(
      restaurantId,
      (body.role as PrinterRole) ?? existing.role,
      body.branchId !== undefined ? body.branchId ?? null : existing.branchId,
      id,
    );
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["name","connectionType","role","paperSize","connection","isDefault","autoPrint",
      "enabled","copies","charactersPerLine","feedLines","cutPaper","cashDrawerKick","buzzer",
      "branchId","kitchenId"] as const) {
    if ((body as Record<string, unknown>)[k] !== undefined) {
      updates[k] = (body as Record<string, unknown>)[k];
    }
  }
  const [updated] = await db.update(printersTable).set(updates)
    .where(eq(printersTable.id, id)).returning();

  await recordAuditLog({
    req, module: "printers", action: "printer.updated", entity: "printer",
    entityId: id, restaurantId,
    oldValue: redactConnection(existing), newValue: redactConnection(updated),
  });
  broadcastEvent(restaurantId, "printer:changed", { id });
  res.json(updated);
});

// ─── DELETE ──────────────────────────────────────────────────────────────
router.delete("/restaurants/:restaurantId/printers/:id", async (req, res) => {
  if (!canWrite(req)) return void res.status(403).json({ error: "Insufficient permissions" });
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [existing] = await db.select().from(printersTable)
    .where(and(eq(printersTable.id, id), eq(printersTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.update(printersTable).set({
    deletedAt: new Date(), enabled: false, isDefault: false, updatedAt: new Date(),
  }).where(eq(printersTable.id, id));
  await recordAuditLog({
    req, module: "printers", action: "printer.deleted", entity: "printer",
    entityId: id, restaurantId, oldValue: redactConnection(existing),
  });
  broadcastEvent(restaurantId, "printer:changed", { id });
  res.json({ ok: true });
});

// ─── SET DEFAULT ─────────────────────────────────────────────────────────
router.post("/restaurants/:restaurantId/printers/:id/set-default", async (req, res) => {
  if (!canWrite(req)) return void res.status(403).json({ error: "Insufficient permissions" });
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [p] = await db.select().from(printersTable)
    .where(and(eq(printersTable.id, id), eq(printersTable.restaurantId, restaurantId), isNull(printersTable.deletedAt)));
  if (!p) return void res.status(404).json({ error: "Not found" });
  await clearDefaultsFor(restaurantId, p.role, p.branchId, id);
  await db.update(printersTable).set({ isDefault: true, updatedAt: new Date() })
    .where(eq(printersTable.id, id));
  await recordAuditLog({
    req, module: "printers", action: "printer.role_changed",
    entity: "printer", entityId: id, restaurantId,
    details: `Set as default ${p.role} printer`,
  });
  res.json({ ok: true });
});

// ─── STATUS REPORT (from mobile/desktop) ─────────────────────────────────
const StatusBody = z.object({
  status: z.enum([
    "unknown","connected","disconnected","permission_required",
    "test_passed","test_failed","offline",
  ]),
  error: z.string().max(2000).nullable().optional(),
});
router.post("/restaurants/:restaurantId/printers/:id/status", validate({ body: StatusBody }), async (req, res) => {
  // Status mutations come from the worker device (mobile/desktop) that
  // physically owns the printer. Gate to printing-capable roles so a pure
  // read role (e.g. delivery_executive) cannot poison printer state or
  // generate fake audit entries.
  if (!canPrint(req)) return void res.status(403).json({ error: "Insufficient permissions" });
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const body = req.body as z.infer<typeof StatusBody>;
  const [p] = await db.select().from(printersTable)
    .where(and(eq(printersTable.id, id), eq(printersTable.restaurantId, restaurantId), isNull(printersTable.deletedAt)));
  if (!p) return void res.status(404).json({ error: "Not found" });
  const updates: Record<string, unknown> = { status: body.status, updatedAt: new Date() };
  if (body.status === "test_passed" || body.status === "test_failed") {
    updates.lastTestAt = new Date();
    updates.lastTestError = body.status === "test_failed" ? (body.error ?? "Test failed") : null;
  }
  await db.update(printersTable).set(updates).where(eq(printersTable.id, id));
  await recordAuditLog({
    req, module: "printers",
    action: body.status === "connected" ? "printer.connected"
      : body.status === "test_passed" ? "printer.test_print"
      : body.status === "test_failed" ? "printer.print_failed"
      : "printer.status",
    entity: "printer", entityId: id, restaurantId,
    details: `Status -> ${body.status}${body.error ? `: ${body.error}` : ""}`,
  });
  broadcastEvent(restaurantId, "printer:status", { id, status: body.status });
  res.json({ ok: true });
});

// ─── TEST PRINT ──────────────────────────────────────────────────────────
router.post("/restaurants/:restaurantId/printers/:id/test-print", async (req, res) => {
  if (!canPrintType(req, "test")) return void res.status(403).json({ error: "Insufficient permissions" });
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [p] = await db.select().from(printersTable)
    .where(and(eq(printersTable.id, id), eq(printersTable.restaurantId, restaurantId), isNull(printersTable.deletedAt)));
  if (!p) return void res.status(404).json({ error: "Not found" });
  if (!p.enabled) return void res.status(400).json({ error: "Printer is disabled" });

  const [job] = await db.insert(printJobsTable).values({
    restaurantId,
    branchId: p.branchId,
    printerId: id,
    printType: "test",
    payload: {
      type: "test",
      payload: { paperSize: p.paperSize, name: p.name },
    },
    status: "queued",
    copies: 1,
    requestedBy: req.user?.sub ?? null,
    requestedByName: req.user?.email ?? null,
  }).returning();

  await recordAuditLog({
    req, module: "printers", action: "printer.test_print",
    entity: "printer", entityId: id, restaurantId,
    details: `Test print queued (job #${job.id})`,
  });
  broadcastEvent(restaurantId, "print-job:new", { id: job.id, printerId: id });
  res.json({ queued: true, jobId: job.id });
});

// ─── PRINT JOBS — LIST ───────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/print-jobs", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status, printerId, printType } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const conds = [eq(printJobsTable.restaurantId, restaurantId)];
  if (status) conds.push(eq(printJobsTable.status, String(status) as never));
  if (printerId) conds.push(eq(printJobsTable.printerId, Number(printerId)));
  if (printType) conds.push(eq(printJobsTable.printType, String(printType) as never));
  const rows = await db.select().from(printJobsTable).where(and(...conds))
    .orderBy(desc(printJobsTable.createdAt)).limit(limit);
  res.json(rows);
});

// ─── ENQUEUE ─────────────────────────────────────────────────────────────
const EnqueueBody = z.object({
  printType: z.enum(PRINT_JOB_TYPES as [string, ...string[]]),
  printerId: z.coerce.number().int().positive().nullable().optional(),
  role: z.enum(PRINTER_ROLES as [string, ...string[]]).optional(),
  kitchenId: z.coerce.number().int().positive().nullable().optional(),
  branchId: z.coerce.number().int().positive().nullable().optional(),
  orderId: z.coerce.number().int().positive().nullable().optional(),
  invoiceNumber: z.string().max(120).nullable().optional(),
  kotNumber: z.string().max(120).nullable().optional(),
  payload: z.record(z.unknown()),
  copies: z.coerce.number().int().min(1).max(10).optional(),
  maxRetries: z.coerce.number().int().min(0).max(10).optional(),
  dedupeKey: z.string().max(200).nullable().optional(),
});

router.post("/restaurants/:restaurantId/print-jobs", validate({ body: EnqueueBody }), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const body = req.body as z.infer<typeof EnqueueBody>;
  if (!canPrintType(req, body.printType)) {
    return void res.status(403).json({ error: `Your role cannot print ${body.printType}` });
  }

  let printerId = body.printerId ?? null;
  // Tenant-integrity guard: a caller-supplied printerId must belong to THIS
  // restaurant and be a live, enabled printer. Otherwise we silently fall
  // through to role-based resolution so the request can still succeed
  // (or be marked failed below) — but we never queue a job against a
  // foreign or deleted printer.
  if (printerId) {
    const owned = await getPrinter(restaurantId, printerId);
    if (!owned || !owned.enabled) {
      printerId = null;
    }
  }
  if (!printerId && body.role) {
    const p = await resolvePrinterFor({
      restaurantId,
      role: body.role as PrinterRole,
      kitchenId: body.kitchenId ?? null,
      branchId: body.branchId ?? null,
    });
    printerId = p?.id ?? null;
  }

  // Dedup
  if (body.dedupeKey) {
    const [dup] = await db.select().from(printJobsTable).where(and(
      eq(printJobsTable.restaurantId, restaurantId),
      eq(printJobsTable.dedupeKey, body.dedupeKey),
      inArray(printJobsTable.status, ["queued","printing","printed","retrying"] as never),
    )).limit(1);
    if (dup) {
      return void res.json({ jobId: dup.id, deduped: true });
    }
  }

  const printer = printerId ? await getPrinter(restaurantId, printerId) : null;
  const copies = body.copies ?? printer?.copies ?? 1;

  const [job] = await db.insert(printJobsTable).values({
    restaurantId,
    branchId: body.branchId ?? printer?.branchId ?? null,
    printerId,
    printType: body.printType as never,
    orderId: body.orderId ?? null,
    invoiceNumber: body.invoiceNumber ?? null,
    kotNumber: body.kotNumber ?? null,
    kitchenId: body.kitchenId ?? null,
    payload: body.payload,
    status: printerId ? "queued" : "failed",
    error: printerId ? null : "No printer configured for this role/station",
    copies,
    maxRetries: body.maxRetries ?? 3,
    dedupeKey: body.dedupeKey ?? null,
    requestedBy: req.user?.sub ?? null,
    requestedByName: req.user?.email ?? null,
  }).returning();

  await recordAuditLog({
    req, module: "printers", action: `print.${body.printType}.queued`,
    entity: "print_job", entityId: job.id, restaurantId,
    details: `Queued ${body.printType}${printer ? ` to ${printer.name}` : " (no printer)"}`,
  });

  if (printerId) broadcastEvent(restaurantId, "print-job:new", { id: job.id, printerId });
  res.status(201).json(job);
});

// ─── CLAIM / COMPLETE / FAIL / RETRY / CANCEL / REPRINT ──────────────────
// These three endpoints are the "worker" surface: the device that physically
// owns a printer (mobile app, desktop bridge) claims a job, prints it, and
// reports back. They mutate operational state so they're gated to printing
// roles + the original requester's restaurant scope. Only roles that are
// allowed to print at all (owner / manager / cashier / kitchen / waiter /
// chef / captain / super_admin) may flip job state — keeps a logged-in
// delivery executive or pure-read role from poisoning the queue.
router.post("/restaurants/:restaurantId/print-jobs/:id/claim", async (req, res) => {
  if (!canPrint(req)) return void res.status(403).json({ error: "Insufficient permissions" });
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [job] = await db.select().from(printJobsTable)
    .where(and(eq(printJobsTable.id, id), eq(printJobsTable.restaurantId, restaurantId)));
  if (!job) return void res.status(404).json({ error: "Not found" });
  if (!["queued","retrying"].includes(job.status)) {
    return void res.status(409).json({ error: `Cannot claim job in status ${job.status}` });
  }
  // Honour exponential backoff: a job that just failed schedules its next
  // attempt via `nextAttemptAt`. Refuse to claim before that window so the
  // worker can't tight-loop on a flaky printer.
  if (job.nextAttemptAt && job.nextAttemptAt.getTime() > Date.now()) {
    return void res.status(409).json({
      error: "Backoff in effect",
      nextAttemptAt: job.nextAttemptAt.toISOString(),
    });
  }
  // Atomic compare-and-set so two workers can't both grab the same job.
  const [updated] = await db.update(printJobsTable).set({
    status: "printing", startedAt: new Date(), updatedAt: new Date(),
  }).where(and(
    eq(printJobsTable.id, id),
    inArray(printJobsTable.status, ["queued", "retrying"] as never),
  )).returning();
  if (!updated) {
    return void res.status(409).json({ error: "Job was claimed by another worker" });
  }
  res.json(updated);
});

const CompleteBody = z.object({ copiesPrinted: z.coerce.number().int().positive().optional() });
router.post("/restaurants/:restaurantId/print-jobs/:id/complete", validate({ body: CompleteBody }), async (req, res) => {
  if (!canPrint(req)) return void res.status(403).json({ error: "Insufficient permissions" });
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [job] = await db.select().from(printJobsTable)
    .where(and(eq(printJobsTable.id, id), eq(printJobsTable.restaurantId, restaurantId)));
  if (!job) return void res.status(404).json({ error: "Not found" });
  // Strict state transition: only a job currently being printed can complete.
  // This stops a stale worker from "completing" a job that was already
  // cancelled or has already been marked printed by someone else.
  if (job.status !== "printing") {
    return void res.status(409).json({ error: `Cannot complete job in status ${job.status}` });
  }
  const copiesPrinted = req.body?.copiesPrinted ?? job.copies;
  const [updated] = await db.update(printJobsTable).set({
    status: "printed", completedAt: new Date(),
    copiesPrinted, error: null, updatedAt: new Date(),
  }).where(and(
    eq(printJobsTable.id, id), eq(printJobsTable.status, "printing"),
  )).returning();
  if (!updated) {
    return void res.status(409).json({ error: "Job status changed concurrently" });
  }
  await recordAuditLog({
    req, module: "printers", action: `print.${job.printType}.completed`,
    entity: "print_job", entityId: id, restaurantId,
    details: `Printed ${copiesPrinted} copy(ies)`,
  });
  broadcastEvent(restaurantId, "print-job:done", { id });
  res.json(updated);
});

const FailBody = z.object({ error: z.string().min(1).max(2000) });
router.post("/restaurants/:restaurantId/print-jobs/:id/fail", validate({ body: FailBody }), async (req, res) => {
  if (!canPrint(req)) return void res.status(403).json({ error: "Insufficient permissions" });
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [job] = await db.select().from(printJobsTable)
    .where(and(eq(printJobsTable.id, id), eq(printJobsTable.restaurantId, restaurantId)));
  if (!job) return void res.status(404).json({ error: "Not found" });
  // Strict state transition: a worker can only report failure for the
  // job it is currently holding (status = "printing"). Refuse to flip a
  // cancelled or already-printed job into a failed/retrying state.
  if (job.status !== "printing") {
    return void res.status(409).json({ error: `Cannot fail job in status ${job.status}` });
  }
  const nextCount = job.retryCount + 1;
  const willRetry = nextCount <= job.maxRetries;
  // Exponential backoff: 10s, 30s, 90s, ... capped at 15 minutes.
  const backoffMs = Math.min(15 * 60_000, 10_000 * Math.pow(3, nextCount - 1));
  const [updated] = await db.update(printJobsTable).set({
    status: willRetry ? "retrying" : "failed",
    error: req.body.error,
    retryCount: nextCount,
    nextAttemptAt: willRetry ? new Date(Date.now() + backoffMs) : null,
    updatedAt: new Date(),
  }).where(and(
    eq(printJobsTable.id, id), eq(printJobsTable.status, "printing"),
  )).returning();
  if (!updated) {
    return void res.status(409).json({ error: "Job status changed concurrently" });
  }
  await recordAuditLog({
    req, module: "printers", action: "print.failed",
    entity: "print_job", entityId: id, restaurantId,
    details: req.body.error,
  });
  broadcastEvent(restaurantId, "print-job:fail", { id, willRetry });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/print-jobs/:id/retry", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [existing] = await db.select().from(printJobsTable)
    .where(and(eq(printJobsTable.id, id), eq(printJobsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (!canPrintType(req, existing.printType)) {
    return void res.status(403).json({ error: `Your role cannot retry ${existing.printType}` });
  }
  // Manual retry clears the backoff window so a human can override the
  // exponential schedule when they've fixed the printer themselves.
  const [updated] = await db.update(printJobsTable).set({
    status: "queued", error: null, nextAttemptAt: null, updatedAt: new Date(),
  }).where(eq(printJobsTable.id, id)).returning();
  broadcastEvent(restaurantId, "print-job:new", { id, printerId: updated.printerId });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/print-jobs/:id/cancel", async (req, res) => {
  if (!canWrite(req)) return void res.status(403).json({ error: "Insufficient permissions" });
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [updated] = await db.update(printJobsTable).set({
    status: "cancelled", updatedAt: new Date(),
  }).where(and(
    eq(printJobsTable.id, id), eq(printJobsTable.restaurantId, restaurantId),
  )).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/print-jobs/:id/reprint", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [job] = await db.select().from(printJobsTable)
    .where(and(eq(printJobsTable.id, id), eq(printJobsTable.restaurantId, restaurantId)));
  if (!job) return void res.status(404).json({ error: "Not found" });
  if (!canPrintType(req, job.printType)) {
    return void res.status(403).json({ error: `Your role cannot reprint ${job.printType}` });
  }
  // Re-validate the original printer: it may have been deleted or disabled
  // since the original job ran. Fall through to a fresh resolution so we
  // never re-queue against a stale printer reference.
  let printerId: number | null = null;
  if (job.printerId) {
    const owned = await getPrinter(restaurantId, job.printerId);
    if (owned && owned.enabled) printerId = owned.id;
  }
  if (!printerId) {
    // Map every KOT variant (kot / reprint_kot / cancelled_kot / modified_kot)
    // back to a "kot" printer role; tokens to "token"; everything else to
    // "bill". `startsWith("kot")` alone would miss cancelled_kot / modified_kot.
    const t = job.printType;
    const role: PrinterRole =
      t === "kot" || t === "reprint_kot" || t === "cancelled_kot" || t === "modified_kot"
        ? "kot"
        : t === "token"
          ? "token"
          : "bill";
    const p = await resolvePrinterFor({
      restaurantId, role,
      kitchenId: job.kitchenId, branchId: job.branchId,
    });
    printerId = p?.id ?? null;
  }
  const reprintType = job.printType === "bill" ? "reprint_bill"
    : job.printType === "kot" ? "reprint_kot"
    : job.printType;
  // Parity with the main enqueue path: if nothing resolves, mark the new
  // job as failed with an explicit error rather than leaving a "queued" job
  // pointing at no printer.
  const [next] = await db.insert(printJobsTable).values({
    restaurantId, branchId: job.branchId, printerId,
    printType: reprintType as never,
    orderId: job.orderId, invoiceNumber: job.invoiceNumber, kotNumber: job.kotNumber,
    kitchenId: job.kitchenId, payload: job.payload,
    status: printerId ? "queued" : "failed",
    error: printerId ? null : "No printer configured for this role/station",
    copies: 1, maxRetries: job.maxRetries,
    requestedBy: req.user?.sub ?? null,
    requestedByName: req.user?.email ?? null,
  }).returning();
  await recordAuditLog({
    req, module: "printers", action: `print.${reprintType}`,
    entity: "print_job", entityId: next.id, restaurantId,
    details: `Reprint of job #${id}`,
  });
  broadcastEvent(restaurantId, "print-job:new", { id: next.id, printerId: next.printerId });
  res.json(next);
});

// ─── helpers ─────────────────────────────────────────────────────────────
async function clearDefaultsFor(
  restaurantId: number, role: PrinterRole, branchId: number | null, exceptId?: number,
): Promise<void> {
  const conds = [
    eq(printersTable.restaurantId, restaurantId),
    eq(printersTable.role, role),
    eq(printersTable.isDefault, true),
  ];
  if (branchId == null) conds.push(isNull(printersTable.branchId));
  else conds.push(eq(printersTable.branchId, branchId));
  if (exceptId) conds.push(sql`${printersTable.id} <> ${exceptId}`);
  await db.update(printersTable).set({ isDefault: false, updatedAt: new Date() })
    .where(and(...conds));
}

async function getPrinter(restaurantId: number, id: number): Promise<Printer | null> {
  const [p] = await db.select().from(printersTable)
    .where(and(eq(printersTable.id, id), eq(printersTable.restaurantId, restaurantId), isNull(printersTable.deletedAt)));
  return p ?? null;
}

/**
 * Station-aware resolution. The lookup ladder is intentionally narrow at
 * each step — we never silently route a print job *into* a different branch
 * than the one that requested it, because a Mumbai cashier hitting a Delhi
 * kitchen printer would be a real-world disaster.
 *
 *   1. Enabled printer pinned to (role, kitchenId) — must match branchId
 *      when one was supplied.
 *   2. Default printer for (role, branchId).
 *   3. Restaurant-level default for the role (printers with branchId = null
 *      only — i.e. shared "no-branch" defaults).
 *   4. Any enabled printer for the role with branchId = null. Cross-branch
 *      fallback is explicitly avoided: if a branch has no printer of its
 *      own and no shared default exists, the resolver returns null and the
 *      enqueue path marks the job as `failed` with a clear message.
 */
export async function resolvePrinterFor(args: {
  restaurantId: number;
  role: PrinterRole;
  kitchenId: number | null;
  branchId: number | null;
}): Promise<Printer | null> {
  const { restaurantId, role, kitchenId, branchId } = args;
  const base = [
    eq(printersTable.restaurantId, restaurantId),
    eq(printersTable.role, role),
    eq(printersTable.enabled, true),
    isNull(printersTable.deletedAt),
  ];
  // 1. Pinned to the requesting station. When a branch is specified the
  //    pinned printer must belong to that branch (or be branch-agnostic).
  if (kitchenId != null) {
    const conds = [...base, eq(printersTable.kitchenId, kitchenId)];
    if (branchId != null) {
      conds.push(or(
        eq(printersTable.branchId, branchId),
        isNull(printersTable.branchId),
      )!);
    }
    const [p] = await db.select().from(printersTable).where(and(...conds))
      .orderBy(desc(printersTable.isDefault)).limit(1);
    if (p) return p;
  }
  // 2. Default for the explicit branch.
  if (branchId != null) {
    const [p] = await db.select().from(printersTable).where(and(...base,
      eq(printersTable.branchId, branchId), eq(printersTable.isDefault, true),
    )).limit(1);
    if (p) return p;
  }
  // 3. Restaurant-level default — only printers with no branch assignment,
  //    never a default printer that belongs to a *different* branch.
  const [p] = await db.select().from(printersTable).where(and(
    ...base, isNull(printersTable.branchId), eq(printersTable.isDefault, true),
  )).limit(1);
  if (p) return p;
  // 4. Last resort: any enabled, branch-agnostic printer for the role.
  const [any] = await db.select().from(printersTable).where(and(
    ...base, isNull(printersTable.branchId),
  )).limit(1);
  return any ?? null;
}

function redactConnection(p: Printer): Partial<Printer> {
  // Connection params may include addresses etc — fine to log, no secrets.
  return p;
}

export default router;
