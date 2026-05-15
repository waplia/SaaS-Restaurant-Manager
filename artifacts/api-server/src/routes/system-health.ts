import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  systemLogsTable,
  notificationDeliveriesTable,
  notificationBroadcastsTable,
  type SystemLogCategory,
  type SystemLogStatus,
} from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import {
  listCronJobs,
  processStartedAt,
  recordSystemLog,
} from "../lib/systemLogs";
import { ObjectStorageService, objectStorageClient } from "../lib/objectStorage";
import { dispatchBroadcast } from "../lib/notificationCenter";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use("/admin/system-health", requireSuperAdmin);

const KNOWN_CATEGORIES = new Set<SystemLogCategory>([
  "app_error", "exception", "api_error", "payment_webhook", "job_failure",
]);
const NOTIF_CHANNELS = new Set(["sms", "whatsapp", "email"]);

// ─── Health overview ─────────────────────────────────────────────
router.get("/admin/system-health/overview", async (_req, res) => {
  const [database, storage, queue, exceptions24h] = await Promise.all([
    checkDatabase(),
    checkStorage(),
    checkQueue(),
    countRecentExceptions(),
  ]);

  const cron = listCronJobs();
  const uptime = {
    startedAt: processStartedAt.toISOString(),
    uptimeSeconds: Math.floor((Date.now() - processStartedAt.getTime()) / 1000),
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    pid: process.pid,
    memory: {
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    },
  };

  // Aggregate status: down if DB down; degraded if storage/queue degraded or exceptions seen in 24h.
  let overall: "operational" | "degraded" | "outage" = "operational";
  if (database.status === "down") overall = "outage";
  else if (
    database.status === "degraded" ||
    storage.status === "degraded" ||
    queue.status === "degraded" ||
    exceptions24h > 0 ||
    cron.some(c => c.lastStatus === "failed")
  ) overall = "degraded";

  res.json({
    overall,
    checkedAt: new Date().toISOString(),
    database,
    uptime,
    storage,
    queue,
    cron,
    exceptions: { last24h: exceptions24h },
  });
});

async function checkDatabase(): Promise<{ status: "ok" | "degraded" | "down"; latencyMs: number | null; error?: string }> {
  const t0 = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    const latency = Date.now() - t0;
    return { status: latency > 500 ? "degraded" : "ok", latencyMs: latency };
  } catch (err) {
    return { status: "down", latencyMs: null, error: (err as Error).message };
  }
}

type StorageReport = {
  status: "ok" | "degraded" | "unavailable";
  bytesUsed: number | null;
  objectCount: number | null;
  bucket: string | null;
  error?: string;
};

async function checkStorage(): Promise<StorageReport> {
  try {
    const svc = new ObjectStorageService();
    const dir = svc.getPrivateObjectDir();
    const [, bucketName] = dir.split("/").filter(Boolean);
    const bucket = objectStorageClient.bucket(bucketName!);
    let bytesUsed = 0;
    let objectCount = 0;
    // Best-effort scan; cap iterations to avoid runaway listings.
    let pageToken: string | undefined;
    for (let i = 0; i < 5; i++) {
      const [files, , apiResponse] = await bucket.getFiles({
        autoPaginate: false,
        maxResults: 1000,
        pageToken,
      }) as unknown as [Array<{ metadata: { size?: string | number } }>, unknown, { nextPageToken?: string }];
      for (const f of files) {
        objectCount++;
        const sz = Number(f.metadata?.size ?? 0);
        if (Number.isFinite(sz)) bytesUsed += sz;
      }
      pageToken = apiResponse?.nextPageToken;
      if (!pageToken) break;
    }
    return { status: "ok", bytesUsed, objectCount, bucket: bucketName ?? null };
  } catch (err) {
    return { status: "unavailable", bytesUsed: null, objectCount: null, bucket: null, error: (err as Error).message };
  }
}

async function checkQueue(): Promise<{ status: "ok" | "degraded"; pending: number; running: number; failedLast24h: number; lastDispatchAt: string | null }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [pendingRow, runningRow, failedRow, lastSent] = await Promise.all([
    db.select({ c: count() }).from(notificationBroadcastsTable).where(eq(notificationBroadcastsTable.status, "scheduled")),
    db.select({ c: count() }).from(notificationBroadcastsTable).where(eq(notificationBroadcastsTable.status, "sending")),
    db.select({ c: count() }).from(notificationBroadcastsTable)
      .where(and(eq(notificationBroadcastsTable.status, "failed"), gte(notificationBroadcastsTable.updatedAt, since))),
    db.select({ at: notificationBroadcastsTable.sentAt }).from(notificationBroadcastsTable)
      .where(eq(notificationBroadcastsTable.status, "sent"))
      .orderBy(desc(notificationBroadcastsTable.sentAt))
      .limit(1),
  ]);
  const pending = pendingRow[0]?.c ?? 0;
  const running = runningRow[0]?.c ?? 0;
  const failed = failedRow[0]?.c ?? 0;
  const lastDispatchAt = lastSent[0]?.at ? new Date(lastSent[0].at).toISOString() : null;
  return {
    status: failed > 0 || running > 5 ? "degraded" : "ok",
    pending, running, failedLast24h: failed,
    lastDispatchAt,
  };
}

async function countRecentExceptions(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db.select({ c: count() }).from(systemLogsTable)
    .where(and(eq(systemLogsTable.category, "exception"), gte(systemLogsTable.createdAt, since)));
  return rows[0]?.c ?? 0;
}

// ─── Logs (unified list) ─────────────────────────────────────────
type LogTab =
  | "app_error" | "exception" | "api_error" | "payment_webhook" | "job_failure"
  | "sms" | "whatsapp" | "email";

const ALLOWED_TABS: LogTab[] = ["app_error", "exception", "api_error", "payment_webhook", "job_failure", "sms", "whatsapp", "email"];

router.get("/admin/system-health/logs", async (req, res) => {
  const tab = String(req.query.category ?? "app_error") as LogTab;
  if (!ALLOWED_TABS.includes(tab)) {
    return void res.status(400).json({ error: `Invalid category. Use one of ${ALLOWED_TABS.join(", ")}` });
  }
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 25)));
  const offset = (page - 1) * pageSize;
  const status = (req.query.status ? String(req.query.status) : "") as "" | "success" | "failed";
  const q = req.query.q ? String(req.query.q).trim() : "";
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;

  if (tab === "sms" || tab === "whatsapp" || tab === "email") {
    return void res.json(await listNotificationLogs(tab, { page, pageSize, offset, status, q, from, to }));
  }
  return void res.json(await listSystemLogs(tab as SystemLogCategory, { page, pageSize, offset, status, q, from, to }));
});

async function listSystemLogs(
  category: SystemLogCategory,
  o: { page: number; pageSize: number; offset: number; status: string; q: string; from: Date | null; to: Date | null },
) {
  const conds: SQL[] = [eq(systemLogsTable.category, category)];
  if (o.status === "success" || o.status === "failed") conds.push(eq(systemLogsTable.status, o.status as SystemLogStatus));
  if (o.from && !Number.isNaN(o.from.getTime())) conds.push(gte(systemLogsTable.createdAt, o.from));
  if (o.to && !Number.isNaN(o.to.getTime())) conds.push(lte(systemLogsTable.createdAt, o.to));
  if (o.q) {
    const pattern = `%${o.q}%`;
    const orExpr = or(
      ilike(systemLogsTable.message, pattern),
      ilike(systemLogsTable.route, pattern),
      ilike(systemLogsTable.jobName, pattern),
    );
    if (orExpr) conds.push(orExpr);
  }
  const where = and(...conds);
  const [rows, total] = await Promise.all([
    db.select().from(systemLogsTable).where(where).orderBy(desc(systemLogsTable.createdAt)).limit(o.pageSize).offset(o.offset),
    db.select({ c: count() }).from(systemLogsTable).where(where),
  ]);
  return {
    data: rows.map(serializeSystemLog),
    page: o.page, pageSize: o.pageSize,
    total: total[0]?.c ?? 0,
  };
}

async function listNotificationLogs(
  channel: "sms" | "whatsapp" | "email",
  o: { page: number; pageSize: number; offset: number; status: string; q: string; from: Date | null; to: Date | null },
) {
  const conds: SQL[] = [eq(notificationDeliveriesTable.channel, channel)];
  if (o.status === "success") conds.push(eq(notificationDeliveriesTable.status, "sent"));
  else if (o.status === "failed") conds.push(inArray(notificationDeliveriesTable.status, ["failed", "skipped"]));
  if (o.from && !Number.isNaN(o.from.getTime())) conds.push(gte(notificationDeliveriesTable.createdAt, o.from));
  if (o.to && !Number.isNaN(o.to.getTime())) conds.push(lte(notificationDeliveriesTable.createdAt, o.to));
  if (o.q) {
    const pattern = `%${o.q}%`;
    const orExpr = or(
      ilike(notificationDeliveriesTable.recipient, pattern),
      ilike(notificationDeliveriesTable.error, pattern),
    );
    if (orExpr) conds.push(orExpr);
  }
  const where = and(...conds);
  const [rows, total] = await Promise.all([
    db.select().from(notificationDeliveriesTable).where(where).orderBy(desc(notificationDeliveriesTable.createdAt)).limit(o.pageSize).offset(o.offset),
    db.select({ c: count() }).from(notificationDeliveriesTable).where(where),
  ]);
  return {
    data: rows.map(d => ({
      id: d.id,
      category: channel,
      level: d.status === "sent" ? "info" : d.status === "skipped" ? "warn" : "error",
      status: d.status === "sent" ? "success" : d.status === "skipped" ? "skipped" : "failed",
      message: `${channel.toUpperCase()} → ${d.recipient ?? "(no recipient)"}: ${d.status}${d.error ? ` — ${d.error}` : ""}`,
      route: null,
      method: null,
      statusCode: null,
      tenantId: d.tenantId,
      userId: d.userId,
      jobName: `broadcast:${d.broadcastId}`,
      payload: { broadcastId: d.broadcastId, recipient: d.recipient, sentAt: d.sentAt, error: d.error },
      stack: null,
      source: null,
      createdAt: d.createdAt,
    })),
    page: o.page, pageSize: o.pageSize,
    total: total[0]?.c ?? 0,
  };
}

function serializeSystemLog(r: typeof systemLogsTable.$inferSelect) {
  return {
    id: r.id,
    category: r.category,
    level: r.level,
    status: r.status,
    message: r.message,
    route: r.route,
    method: r.method,
    statusCode: r.statusCode,
    tenantId: r.tenantId,
    userId: r.userId,
    jobName: r.jobName,
    payload: r.payload ?? null,
    stack: r.stack,
    source: r.source,
    createdAt: r.createdAt,
  };
}

// ─── Log detail ──────────────────────────────────────────────────
router.get("/admin/system-health/logs/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(systemLogsTable).where(eq(systemLogsTable.id, id));
  if (!row) return void res.status(404).json({ error: "Log not found" });
  res.json(serializeSystemLog(row));
});

// Detail variant for notification deliveries (sms/whatsapp/email)
router.get("/admin/system-health/notification-deliveries/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(notificationDeliveriesTable).where(eq(notificationDeliveriesTable.id, id));
  if (!row) return void res.status(404).json({ error: "Delivery not found" });
  res.json(row);
});

// ─── Retry a failed job ──────────────────────────────────────────
// Currently supports re-dispatching a notification broadcast captured by jobName "broadcast:<id>".
router.post("/admin/system-health/jobs/:id/retry", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(systemLogsTable).where(eq(systemLogsTable.id, id));
  if (!row) return void res.status(404).json({ error: "Log not found" });
  if (row.category !== "job_failure") return void res.status(400).json({ error: "Only failed jobs can be retried" });

  const jobName = row.jobName ?? "";
  const broadcastMatch = /^broadcast:(\d+)$/.exec(jobName);
  if (broadcastMatch) {
    const bid = Number(broadcastMatch[1]);
    dispatchBroadcast(bid).catch(err => logger.error({ err, broadcastId: bid }, "Manual retry dispatch failed"));
    await recordSystemLog({
      category: "job_failure",
      status: "success",
      level: "info",
      message: `Retry triggered for job ${jobName}`,
      jobName,
      userId: req.user?.sub ?? null,
    });
    return void res.json({ ok: true, retried: jobName });
  }

  return void res.status(400).json({
    error: `Retry is not supported for job "${jobName || "(unknown)"}". Manual intervention required.`,
  });
});

// ─── Stats summary (counts per category over last 24h) ───────────
router.get("/admin/system-health/log-stats", async (_req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [sysRows, notifRows] = await Promise.all([
    db.select({
      category: systemLogsTable.category,
      total: count(),
      failed: sql<number>`sum(case when ${systemLogsTable.status} = 'failed' then 1 else 0 end)::int`,
    }).from(systemLogsTable).where(gte(systemLogsTable.createdAt, since)).groupBy(systemLogsTable.category),
    db.select({
      channel: notificationDeliveriesTable.channel,
      total: count(),
      failed: sql<number>`sum(case when ${notificationDeliveriesTable.status} in ('failed','skipped') then 1 else 0 end)::int`,
    }).from(notificationDeliveriesTable)
      .where(and(gte(notificationDeliveriesTable.createdAt, since), inArray(notificationDeliveriesTable.channel, ["sms", "whatsapp", "email"])))
      .groupBy(notificationDeliveriesTable.channel),
  ]);
  const out: Record<string, { total: number; failed: number }> = {};
  for (const c of ALLOWED_TABS) out[c] = { total: 0, failed: 0 };
  for (const r of sysRows) {
    if (KNOWN_CATEGORIES.has(r.category as SystemLogCategory)) {
      out[r.category as string] = { total: Number(r.total), failed: Number(r.failed ?? 0) };
    }
  }
  for (const r of notifRows) {
    if (NOTIF_CHANNELS.has(r.channel)) {
      out[r.channel] = { total: Number(r.total), failed: Number(r.failed ?? 0) };
    }
  }
  res.json({ since: since.toISOString(), counts: out });
});

export default router;
// keep import side effects from removing asc
void asc;
