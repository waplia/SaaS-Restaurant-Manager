import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { authenticate } from "../middleware/authenticate";
import { requireSuperAdmin } from "../middleware/authorize";
import { db, auditLogsTable } from "../lib/db";
import { validate } from "../middleware/validate";
import {
  createBackup, deleteBackup, listBackups, getBackup, streamBackupForDownload,
  getOrCreateSchedule, updateSchedule,
  getS3Config, setSystemSetting, testS3Connection, DEFAULT_S3_CONFIG,
  cacheClearAll, listCronJobs, getQueueStatus, retryFailedQueue,
  getStorageUsage, getEnvironmentStatus, pingDb, pingObjectStorage, getAppVersion,
} from "../lib/maintenance";

const router = Router();

// All maintenance endpoints require an authenticated super-admin.
router.use("/admin/maintenance", authenticate, requireSuperAdmin);

async function audit(req: Request, action: string, entityId: number | null, details: unknown): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      restaurantId: null,
      userId: req.user?.sub ?? null,
      action,
      entity: "maintenance",
      entityId,
      details: typeof details === "string" ? details : JSON.stringify(details),
      ipAddress: (req.ip ?? null) as string | null,
    });
  } catch { /* audit failures shouldn't block the action */ }
}

// ─── Backups ──────────────────────────────────────────────────────
router.get("/admin/maintenance/backups", async (_req, res) => {
  const rows = await listBackups();
  res.json({ data: rows });
});

const CreateBackupBody = z.object({
  type: z.enum(["db", "files", "full"]),
  destination: z.enum(["local", "s3", "dropbox", "gdrive"]).default("local"),
});
router.post("/admin/maintenance/backups", validate({ body: CreateBackupBody }), async (req, res) => {
  const data = req.body as z.infer<typeof CreateBackupBody>;
  if (data.destination === "dropbox" || data.destination === "gdrive") {
    return void res.status(400).json({ error: `${data.destination} destination is not yet enabled — coming soon` });
  }
  const row = await createBackup({
    type: data.type,
    destination: data.destination,
    userId: req.user?.sub ?? null,
    source: "manual",
  });
  await audit(req, "backup.create", row.id, { type: data.type, destination: data.destination, status: row.status });
  res.json(row);
});

router.get("/admin/maintenance/backups/:id/download", async (req, res) => {
  const id = Number(req.params.id);
  const backup = await getBackup(id);
  if (!backup) return void res.status(404).json({ error: "Not found" });
  if (backup.status !== "completed") return void res.status(400).json({ error: `Backup is ${backup.status}` });
  try {
    const { stream, filename, size } = await streamBackupForDownload(backup);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    if (size) res.setHeader("Content-Length", String(size));
    await audit(req, "backup.download", id, { filename });
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete("/admin/maintenance/backups/:id", async (req, res) => {
  const id = Number(req.params.id);
  const ok = await deleteBackup(id);
  if (!ok) return void res.status(404).json({ error: "Not found" });
  await audit(req, "backup.delete", id, {});
  res.json({ ok: true });
});

const RestoreBody = z.object({ confirm: z.string().optional() });
router.post("/admin/maintenance/backups/:id/restore", validate({ body: RestoreBody }), async (req, res) => {
  const id = Number(req.params.id);
  const confirm = String((req.body as { confirm?: string } | undefined)?.confirm ?? "");
  if (confirm !== "RESTORE") {
    return void res.status(400).json({ error: 'Confirmation phrase "RESTORE" required' });
  }
  await audit(req, "backup.restore_attempt", id, { note: "Restore requested but not yet enabled" });
  res.status(501).json({
    ok: false,
    error: "Restore is not yet enabled — please contact engineering",
  });
});

// ─── Schedule ─────────────────────────────────────────────────────
router.get("/admin/maintenance/schedule", async (_req, res) => {
  const sched = await getOrCreateSchedule();
  res.json(sched);
});

const ScheduleBody = z.object({
  enabled: z.boolean().optional(),
  frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  retentionCount: z.number().int().min(1).max(365).optional(),
  includes: z.enum(["db", "files", "full"]).optional(),
  destination: z.enum(["local", "s3", "dropbox", "gdrive"]).optional(),
});
router.put("/admin/maintenance/schedule", validate({ body: ScheduleBody }), async (req, res) => {
  const data = req.body as z.infer<typeof ScheduleBody>;
  if (data.destination === "dropbox" || data.destination === "gdrive") {
    return void res.status(400).json({ error: `${data.destination} destination is not yet enabled` });
  }
  const updated = await updateSchedule({ ...data, updatedBy: req.user?.sub });
  await audit(req, "backup.schedule_update", updated.id, data);
  res.json(updated);
});

// ─── Destinations / S3 settings ───────────────────────────────────
router.get("/admin/maintenance/destinations/s3", async (_req, res) => {
  const cfg = await getS3Config();
  // Mask the secret on read.
  res.json({ ...cfg, secretAccessKey: cfg.secretAccessKey ? "********" : "" });
});

const S3Body = z.object({
  enabled: z.boolean().optional(),
  bucket: z.string().optional(),
  region: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  prefix: z.string().optional(),
});
router.put("/admin/maintenance/destinations/s3", validate({ body: S3Body }), async (req, res) => {
  const data = req.body as z.infer<typeof S3Body>;
  const current = await getS3Config();
  const next = { ...DEFAULT_S3_CONFIG, ...current, ...data };
  // Preserve existing secret if client posted the masked placeholder.
  if (data.secretAccessKey === "********" || data.secretAccessKey === undefined) {
    next.secretAccessKey = current.secretAccessKey;
  }
  await setSystemSetting("s3_backup", next, req.user?.sub);
  await audit(req, "backup.s3_settings_update", null, { ...next, secretAccessKey: "[redacted]" });
  res.json({ ...next, secretAccessKey: next.secretAccessKey ? "********" : "" });
});

router.post("/admin/maintenance/destinations/s3/test", validate({ body: S3Body.partial() }), async (req, res) => {
  const data = req.body as z.infer<typeof S3Body>;
  const current = await getS3Config();
  const merged = {
    ...DEFAULT_S3_CONFIG,
    ...current,
    ...data,
  };
  if (data.secretAccessKey === "********" || data.secretAccessKey === undefined) {
    merged.secretAccessKey = current.secretAccessKey;
  }
  const result = await testS3Connection(merged);
  res.json(result);
});

const EmptyBody = z.object({}).passthrough();

// ─── Maintenance actions ──────────────────────────────────────────
router.post("/admin/maintenance/cache/clear", validate({ body: EmptyBody }), async (req, res) => {
  const cleared = cacheClearAll();
  await audit(req, "maintenance.cache_clear", null, { cleared });
  res.json({ ok: true, cleared });
});

router.post("/admin/maintenance/queue/retry-failed", validate({ body: EmptyBody }), async (req, res) => {
  const out = await retryFailedQueue();
  await audit(req, "maintenance.queue_retry", null, out);
  res.json(out);
});

// ─── System status ────────────────────────────────────────────────
router.get("/admin/maintenance/status", async (_req, res) => {
  const [storage, queue, dbOk, storageOk] = await Promise.all([
    getStorageUsage(), getQueueStatus(), pingDb(), pingObjectStorage(),
  ]);
  res.json({
    cron: listCronJobs(),
    queue,
    storage,
    app: getAppVersion(),
    environment: { ...getEnvironmentStatus(), dbOk, objectStorageOk: storageOk },
  });
});

export default router;
