import { spawn } from "node:child_process";
import { promises as fs, createWriteStream, createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "module";
const archiver = createRequire(import.meta.url)("archiver") as typeof import("archiver");
import { eq, desc, sql, count } from "drizzle-orm";
import { S3Client, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadBucketCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { db, backupsTable, backupScheduleTable, systemSettingsTable, notificationDeliveriesTable, notificationBroadcastsTable } from "./db";
import { logger } from "./logger";
import type { BackupType, BackupDestination, Backup } from "@workspace/db/schema";

export const BACKUP_DIR = process.env["BACKUP_DIR"] || path.join(os.tmpdir(), "tabletrack-backups");
export const UPLOAD_DIR = process.env["PRIVATE_OBJECT_DIR"] || path.join(os.tmpdir(), "tabletrack-uploads");

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// ─── In-memory caches & registries ────────────────────────────────
type CacheEntry = { value: unknown; expiresAt: number };
const memoryCache = new Map<string, CacheEntry>();

export function cacheGet<T>(key: string): T | undefined {
  const e = memoryCache.get(key);
  if (!e) return undefined;
  if (e.expiresAt && e.expiresAt < Date.now()) { memoryCache.delete(key); return undefined; }
  return e.value as T;
}
export function cacheSet(key: string, value: unknown, ttlMs = 60_000): void {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
export function cacheClearAll(): number {
  const n = memoryCache.size;
  memoryCache.clear();
  return n;
}

export type CronJobStatus = {
  name: string;
  schedule: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  status: "ok" | "failed" | "pending";
  lastError?: string | null;
};

const cronRegistry = new Map<string, CronJobStatus>();

export function registerCronJob(name: string, schedule: string): void {
  if (!cronRegistry.has(name)) {
    cronRegistry.set(name, { name, schedule, lastRunAt: null, nextRunAt: null, status: "pending" });
  } else {
    const existing = cronRegistry.get(name)!;
    existing.schedule = schedule;
  }
}

export function recordCronRun(name: string, ok: boolean, error?: string, nextRunAt?: Date | null): void {
  const job = cronRegistry.get(name) ?? { name, schedule: "?", lastRunAt: null, nextRunAt: null, status: "pending" as const };
  job.lastRunAt = new Date().toISOString();
  job.status = ok ? "ok" : "failed";
  job.lastError = ok ? null : (error ?? "unknown");
  if (nextRunAt) job.nextRunAt = nextRunAt.toISOString();
  cronRegistry.set(name, job);
}

export function listCronJobs(): CronJobStatus[] {
  return Array.from(cronRegistry.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// Wrap node-cron's schedule in a small helper that records last/next runs and
// catches errors so we can surface them on the maintenance page.
import cron from "node-cron";
type ScheduleOptions = { timezone?: string; scheduled?: boolean };
export function registerScheduledJob(
  name: string,
  expr: string,
  fn: () => Promise<void> | void,
  opts?: ScheduleOptions,
): ReturnType<typeof cron.schedule> {
  registerCronJob(name, expr);
  return cron.schedule(expr, async () => {
    try {
      await fn();
      recordCronRun(name, true);
    } catch (err) {
      recordCronRun(name, false, (err as Error).message);
      logger.error({ err, job: name }, "Scheduled job failed");
      throw err;
    }
  }, opts);
}

// ─── System settings (key/value) ──────────────────────────────────
export async function getSystemSetting<T = unknown>(key: string): Promise<T | null> {
  const [row] = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.key, key));
  return (row?.value as T) ?? null;
}

export async function setSystemSetting(key: string, value: unknown, userId?: number): Promise<void> {
  await db.insert(systemSettingsTable)
    .values({ key, value: value as object, updatedBy: userId ?? null })
    .onConflictDoUpdate({
      target: systemSettingsTable.key,
      set: { value: value as object, updatedBy: userId ?? null, updatedAt: new Date() },
    });
}

export type S3Config = {
  enabled: boolean;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
};

export const DEFAULT_S3_CONFIG: S3Config = {
  enabled: false, bucket: "", region: "us-east-1", accessKeyId: "", secretAccessKey: "", prefix: "tabletrack-backups/",
};

export async function getS3Config(): Promise<S3Config> {
  const stored = (await getSystemSetting<Partial<S3Config>>("s3_backup")) ?? {};
  return { ...DEFAULT_S3_CONFIG, ...stored };
}

function makeS3Client(cfg: S3Config): S3Client {
  return new S3Client({
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

export async function testS3Connection(cfg: S3Config): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
    return { ok: false, error: "Bucket, access key, and secret are required" };
  }
  try {
    const client = makeS3Client(cfg);
    await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Backup operations ────────────────────────────────────────────
function timestampSuffix(): string {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, "-").replace("Z", "");
}

async function pgDumpToFile(target: string): Promise<void> {
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) throw new Error("DATABASE_URL not configured");
  await ensureDir(path.dirname(target));
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(target);
    const child = spawn("pg_dump", ["--no-owner", "--no-privileges", "--clean", "--if-exists", dbUrl], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.pipe(out);
    child.stderr.on("data", c => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      out.end();
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

async function archiveDirToFile(srcDir: string, target: string): Promise<void> {
  await ensureDir(path.dirname(target));
  // If source doesn't exist, create an empty tar.gz so the row is still meaningful.
  try { await fs.access(srcDir); } catch { await ensureDir(srcDir); }
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(target);
    const archive = archiver("tar", { gzip: true, gzipOptions: { level: 6 } });
    out.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(out);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}

async function uploadFileToS3(filePath: string, key: string, cfg: S3Config): Promise<void> {
  const client = makeS3Client(cfg);
  const stream = createReadStream(filePath);
  const upload = new Upload({
    client,
    params: { Bucket: cfg.bucket, Key: key, Body: stream },
  });
  await upload.done();
}

export async function createBackup(opts: {
  type: BackupType;
  destination: BackupDestination;
  userId?: number | null;
  source?: string;
}): Promise<Backup> {
  if (opts.destination === "dropbox" || opts.destination === "gdrive") {
    throw new Error(`Destination "${opts.destination}" is not yet enabled`);
  }
  await ensureDir(BACKUP_DIR);

  const [row] = await db.insert(backupsTable).values({
    type: opts.type,
    destination: opts.destination,
    status: "running",
    createdBy: opts.userId ?? null,
    source: opts.source ?? "manual",
  }).returning();

  const id = row!.id;
  const stamp = timestampSuffix();
  let totalSize = 0;
  let localPath: string | null = null;
  let remoteKey: string | null = null;

  try {
    const tmpFiles: string[] = [];
    if (opts.type === "db" || opts.type === "full") {
      const f = path.join(BACKUP_DIR, `db-${id}-${stamp}.sql`);
      await pgDumpToFile(f);
      tmpFiles.push(f);
    }
    if (opts.type === "files" || opts.type === "full") {
      const f = path.join(BACKUP_DIR, `files-${id}-${stamp}.tar.gz`);
      await archiveDirToFile(UPLOAD_DIR, f);
      tmpFiles.push(f);
    }

    let finalLocal: string;
    if (tmpFiles.length === 1) {
      finalLocal = tmpFiles[0]!;
    } else {
      finalLocal = path.join(BACKUP_DIR, `full-${id}-${stamp}.tar.gz`);
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(finalLocal);
        const archive = archiver("tar", { gzip: true });
        out.on("close", () => resolve());
        archive.on("error", reject);
        archive.pipe(out);
        for (const f of tmpFiles) archive.file(f, { name: path.basename(f) });
        archive.finalize();
      });
      // Drop intermediate dump files now that they're inside the combined archive.
      for (const f of tmpFiles) await fs.unlink(f).catch(() => {});
    }

    const stat = await fs.stat(finalLocal);
    totalSize = stat.size;

    if (opts.destination === "s3") {
      const cfg = await getS3Config();
      if (!cfg.enabled) throw new Error("S3 destination is not enabled in settings");
      const ok = await testS3Connection(cfg);
      if (!ok.ok) throw new Error(`S3 not reachable: ${ok.error}`);
      const key = `${cfg.prefix.replace(/\/+$/, "")}/${path.basename(finalLocal)}`;
      await uploadFileToS3(finalLocal, key, cfg);
      remoteKey = key;
      localPath = finalLocal; // keep local copy for download convenience
    } else {
      localPath = finalLocal;
    }

    const [updated] = await db.update(backupsTable).set({
      status: "completed",
      filePath: localPath,
      remoteKey,
      size: totalSize,
      completedAt: new Date(),
    }).where(eq(backupsTable.id, id)).returning();
    return updated!;
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ err, backupId: id }, "Backup failed");
    const [updated] = await db.update(backupsTable).set({
      status: "failed",
      error: msg,
      completedAt: new Date(),
    }).where(eq(backupsTable.id, id)).returning();
    return updated!;
  }
}

export async function deleteBackup(id: number): Promise<boolean> {
  const [row] = await db.select().from(backupsTable).where(eq(backupsTable.id, id));
  if (!row) return false;
  if (row.filePath) await fs.unlink(row.filePath).catch(() => {});
  if (row.remoteKey) {
    const cfg = await getS3Config();
    if (cfg.enabled && cfg.bucket) {
      try {
        const client = makeS3Client(cfg);
        await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: row.remoteKey }));
      } catch (err) {
        logger.warn({ err, backupId: id }, "Failed to delete S3 object");
      }
    }
  }
  await db.delete(backupsTable).where(eq(backupsTable.id, id));
  return true;
}

export async function listBackups(limit = 100): Promise<Backup[]> {
  return db.select().from(backupsTable).orderBy(desc(backupsTable.createdAt)).limit(limit);
}

export async function getBackup(id: number): Promise<Backup | null> {
  const [row] = await db.select().from(backupsTable).where(eq(backupsTable.id, id));
  return row ?? null;
}

export async function streamBackupForDownload(backup: Backup): Promise<{ stream: NodeJS.ReadableStream; filename: string; size: number }> {
  const filename = backup.filePath ? path.basename(backup.filePath)
    : backup.remoteKey ? path.basename(backup.remoteKey)
    : `backup-${backup.id}.bin`;
  if (backup.filePath) {
    try {
      await fs.access(backup.filePath);
      return { stream: createReadStream(backup.filePath), filename, size: backup.size };
    } catch { /* fall through to S3 */ }
  }
  if (backup.remoteKey) {
    const cfg = await getS3Config();
    if (!cfg.enabled) throw new Error("S3 not configured");
    const client = makeS3Client(cfg);
    const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: backup.remoteKey }));
    if (!res.Body) throw new Error("Empty response from S3");
    return { stream: res.Body as NodeJS.ReadableStream, filename, size: Number(res.ContentLength ?? backup.size) };
  }
  throw new Error("Backup file is missing");
}

// ─── Schedule & retention ─────────────────────────────────────────
export async function getOrCreateSchedule() {
  const [row] = await db.select().from(backupScheduleTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(backupScheduleTable).values({}).returning();
  return created!;
}

export async function updateSchedule(patch: Partial<Pick<typeof backupScheduleTable.$inferSelect,
  "enabled" | "frequency" | "timeOfDay" | "retentionCount" | "includes" | "destination">> & { updatedBy?: number }) {
  const current = await getOrCreateSchedule();
  const next = computeNextRun({ ...current, ...patch } as typeof current);
  const [updated] = await db.update(backupScheduleTable)
    .set({
      ...patch,
      nextRunAt: next,
      updatedAt: new Date(),
    })
    .where(eq(backupScheduleTable.id, current.id))
    .returning();
  return updated!;
}

function computeNextRun(s: { enabled: boolean; frequency: string; timeOfDay: string }): Date | null {
  if (!s.enabled) return null;
  const [hh, mm] = (s.timeOfDay ?? "02:00").split(":").map(n => Number(n));
  const next = new Date();
  next.setSeconds(0, 0);
  next.setHours(hh ?? 2, mm ?? 0, 0, 0);
  if (next.getTime() <= Date.now()) {
    if (s.frequency === "weekly") next.setDate(next.getDate() + 7);
    else if (s.frequency === "monthly") next.setMonth(next.getMonth() + 1);
    else next.setDate(next.getDate() + 1);
  }
  return next;
}

export async function applyRetention(): Promise<number> {
  const sched = await getOrCreateSchedule();
  const keep = Math.max(1, sched.retentionCount);
  const rows = await db.select().from(backupsTable)
    .where(eq(backupsTable.source, "scheduled"))
    .orderBy(desc(backupsTable.createdAt));
  const toDelete = rows.slice(keep);
  let deleted = 0;
  for (const r of toDelete) {
    if (await deleteBackup(r.id)) deleted++;
  }
  return deleted;
}

export async function runScheduledBackupTick(): Promise<void> {
  const sched = await getOrCreateSchedule();
  if (!sched.enabled) return;
  if (!sched.nextRunAt || sched.nextRunAt.getTime() > Date.now()) return;
  logger.info({ schedule: sched }, "Running scheduled backup");
  await createBackup({ type: sched.includes, destination: sched.destination, source: "scheduled", userId: null });
  const next = computeNextRun(sched);
  await db.update(backupScheduleTable).set({ lastRunAt: new Date(), nextRunAt: next }).where(eq(backupScheduleTable.id, sched.id));
  await applyRetention();
}

// ─── Status helpers ───────────────────────────────────────────────
async function dirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) total += await dirSize(full);
      else if (e.isFile()) {
        const stat = await fs.stat(full).catch(() => null);
        if (stat) total += stat.size;
      }
    }
  } catch { /* ignore */ }
  return total;
}

export async function getStorageUsage(): Promise<{
  backupsBytes: number;
  uploadsBytes: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  s3Bytes: number | null;
  s3Configured: boolean;
}> {
  const [backupsBytes, uploadsBytes] = await Promise.all([dirSize(BACKUP_DIR), dirSize(UPLOAD_DIR)]);
  // Disk free/total via statfs (Node 18+)
  let diskTotalBytes = 0, diskFreeBytes = 0;
  try {
    const sf = await (fs as unknown as { statfs: (p: string) => Promise<{ bsize: number; blocks: number; bfree: number }> }).statfs(BACKUP_DIR);
    diskTotalBytes = sf.bsize * sf.blocks;
    diskFreeBytes = sf.bsize * sf.bfree;
  } catch { /* statfs unavailable */ }

  let s3Bytes: number | null = null;
  const cfg = await getS3Config();
  if (cfg.enabled && cfg.bucket) {
    try {
      const client = makeS3Client(cfg);
      let total = 0, token: string | undefined;
      do {
        const res = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: cfg.prefix, ContinuationToken: token }));
        for (const o of res.Contents ?? []) total += Number(o.Size ?? 0);
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      s3Bytes = total;
    } catch (err) {
      logger.warn({ err }, "Failed to compute S3 usage");
    }
  }
  return { backupsBytes, uploadsBytes, diskTotalBytes, diskFreeBytes, s3Bytes, s3Configured: cfg.enabled };
}

const BOOT_TIME = Date.now();
export function getEnvironmentStatus(): {
  nodeVersion: string;
  envName: string;
  uptimeSeconds: number;
  hostname: string;
} {
  return {
    nodeVersion: process.version,
    envName: process.env["NODE_ENV"] ?? "development",
    uptimeSeconds: Math.floor((Date.now() - BOOT_TIME) / 1000),
    hostname: os.hostname(),
  };
}

export async function pingDb(): Promise<boolean> {
  try { await db.execute(sql`SELECT 1`); return true; } catch { return false; }
}

export async function pingObjectStorage(): Promise<boolean> {
  try {
    await ensureDir(UPLOAD_DIR);
    return true;
  } catch { return false; }
}

export function getAppVersion(): { version: string; commit: string | null; buildDate: string | null; buildEnv: string } {
  const pkg = (() => {
    try {
      // Read version from runtime cwd's package.json fallback
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return { version: process.env["APP_VERSION"] ?? "0.0.0" };
    } catch { return { version: "0.0.0" }; }
  })();
  return {
    version: pkg.version,
    commit: process.env["GIT_COMMIT"] ?? process.env["REPLIT_DEPLOYMENT_ID"] ?? null,
    buildDate: process.env["BUILD_DATE"] ?? null,
    buildEnv: process.env["NODE_ENV"] ?? "development",
  };
}

// Background queue stats: derive from the broadcast deliveries table since
// that is the project's main background queue. Returns a rolled-up snapshot.
export async function getQueueStatus(): Promise<{
  pending: number;
  processing: number;
  failed: number;
  recentFailures: { broadcastId: number; channel: string; error: string | null; createdAt: string }[];
}> {
  try {
    const rows = await db
      .select({ status: notificationDeliveriesTable.status, c: count() })
      .from(notificationDeliveriesTable)
      .groupBy(notificationDeliveriesTable.status);
    let pending = 0, processing = 0, failed = 0;
    for (const r of rows) {
      const s = String(r.status);
      const n = Number(r.c);
      if (s === "pending" || s === "queued") pending += n;
      else if (s === "sent") processing += 0;
      else if (s === "failed") failed += n;
    }
    const broadcasts = await db.select({ status: notificationBroadcastsTable.status, c: count() })
      .from(notificationBroadcastsTable).groupBy(notificationBroadcastsTable.status);
    for (const b of broadcasts) {
      if (b.status === "sending") processing += Number(b.c);
      if (b.status === "scheduled") pending += Number(b.c);
    }
    const recent = await db.select({
      id: notificationDeliveriesTable.id,
      broadcastId: notificationDeliveriesTable.broadcastId,
      channel: notificationDeliveriesTable.channel,
      error: notificationDeliveriesTable.error,
      createdAt: notificationDeliveriesTable.createdAt,
    })
      .from(notificationDeliveriesTable)
      .where(eq(notificationDeliveriesTable.status, "failed"))
      .orderBy(desc(notificationDeliveriesTable.createdAt))
      .limit(10);
    return {
      pending, processing, failed,
      recentFailures: recent.map(r => ({
        broadcastId: r.broadcastId ?? 0,
        channel: String(r.channel),
        error: r.error,
        createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
      })),
    };
  } catch (err) {
    logger.warn({ err }, "Failed to compute queue status");
    return { pending: 0, processing: 0, failed: 0, recentFailures: [] };
  }
}

export async function retryFailedQueue(): Promise<{ retried: number }> {
  try {
    const res = await db.update(notificationDeliveriesTable)
      .set({ status: "pending", error: null })
      .where(eq(notificationDeliveriesTable.status, "failed"))
      .returning({ id: notificationDeliveriesTable.id });
    return { retried: res.length };
  } catch (err) {
    logger.warn({ err }, "Failed to retry failed deliveries");
    return { retried: 0 };
  }
}
