import { db, systemLogsTable } from "./db";
import type { InsertSystemLog, SystemLogCategory, SystemLogLevel, SystemLogStatus } from "./db";
import { logger } from "./logger";

export type RecordSystemLogInput = {
  category: SystemLogCategory;
  message: string;
  level?: SystemLogLevel;
  status?: SystemLogStatus;
  source?: string | null;
  route?: string | null;
  method?: string | null;
  statusCode?: number | null;
  tenantId?: number | null;
  userId?: number | null;
  jobName?: string | null;
  payload?: unknown;
  stack?: string | null;
};

export async function recordSystemLog(input: RecordSystemLogInput): Promise<void> {
  try {
    const row: InsertSystemLog = {
      category: input.category,
      level: input.level ?? (input.status === "success" ? "info" : "error"),
      status: input.status ?? "failed",
      message: input.message.length > 4000 ? input.message.slice(0, 4000) : input.message,
      source: input.source ?? null,
      route: input.route ?? null,
      method: input.method ?? null,
      statusCode: input.statusCode ?? null,
      tenantId: input.tenantId ?? null,
      userId: input.userId ?? null,
      jobName: input.jobName ?? null,
      payload: (input.payload ?? null) as InsertSystemLog["payload"],
      stack: input.stack ?? null,
    };
    await db.insert(systemLogsTable).values(row);
  } catch (err) {
    // Never let logging errors crash the request path.
    logger.warn({ err }, "Failed to persist system log");
  }
}

// ─── Cron / Job registry ──────────────────────────────────────────
export type CronEntry = {
  name: string;
  schedule: string;
  description?: string;
  lastRunAt: Date | null;
  lastStatus: "ok" | "failed" | null;
  lastError: string | null;
  lastDurationMs: number | null;
};

const cronRegistry: Map<string, CronEntry> = new Map();

export function registerCron(name: string, schedule: string, description?: string): void {
  if (!cronRegistry.has(name)) {
    cronRegistry.set(name, {
      name, schedule, description,
      lastRunAt: null, lastStatus: null, lastError: null, lastDurationMs: null,
    });
  }
}

export async function runTrackedCron(name: string, fn: () => Promise<void>): Promise<void> {
  const entry = cronRegistry.get(name);
  const started = Date.now();
  try {
    await fn();
    if (entry) {
      entry.lastRunAt = new Date();
      entry.lastStatus = "ok";
      entry.lastError = null;
      entry.lastDurationMs = Date.now() - started;
    }
  } catch (err) {
    if (entry) {
      entry.lastRunAt = new Date();
      entry.lastStatus = "failed";
      entry.lastError = (err as Error).message;
      entry.lastDurationMs = Date.now() - started;
    }
    await recordSystemLog({
      category: "job_failure",
      level: "error",
      status: "failed",
      jobName: name,
      message: `Cron job "${name}" failed: ${(err as Error).message}`,
      stack: (err as Error).stack ?? null,
      payload: { schedule: entry?.schedule },
    });
    throw err;
  }
}

export function listCronJobs(): CronEntry[] {
  return Array.from(cronRegistry.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Process startup tracking ────────────────────────────────────
export const processStartedAt = new Date();
