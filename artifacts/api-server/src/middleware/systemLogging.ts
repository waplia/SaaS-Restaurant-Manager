import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { recordSystemLog } from "../lib/systemLogs";

const HEALTH_PATHS = new Set(["/api/healthz"]);

export function apiErrorLogger(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    const code = res.statusCode;
    if (code < 400) return;
    const route = req.originalUrl?.split("?")[0] ?? req.url;
    if (HEALTH_PATHS.has(route)) return;
    recordSystemLog({
      category: "api_error",
      level: code >= 500 ? "error" : "warn",
      status: "failed",
      message: `${req.method} ${route} → ${code}`,
      route,
      method: req.method,
      statusCode: code,
      tenantId: req.user?.tenantId ?? null,
      userId: req.user?.sub ?? null,
      source: req.ip ?? null,
    }).catch(() => {});
  });
  next();
}

export const exceptionHandler: ErrorRequestHandler = (err, req, res, next) => {
  const error = err as Error & { statusCode?: number };
  const status = error.statusCode && Number.isInteger(error.statusCode) ? error.statusCode : 500;
  const route = req.originalUrl?.split("?")[0] ?? req.url;
  recordSystemLog({
    category: "exception",
    level: "fatal",
    status: "failed",
    message: error.message || "Unhandled exception",
    route,
    method: req.method,
    statusCode: status,
    tenantId: req.user?.tenantId ?? null,
    userId: req.user?.sub ?? null,
    stack: error.stack ?? null,
  }).catch(() => {});
  if (res.headersSent) return next(err);
  res.status(status).json({ error: error.message || "Internal server error" });
};

export function installProcessExceptionHandlers(): void {
  process.on("uncaughtException", (err) => {
    recordSystemLog({
      category: "exception",
      level: "fatal",
      status: "failed",
      message: `uncaughtException: ${err.message}`,
      stack: err.stack ?? null,
      source: "process",
    }).catch(() => {});
  });
  process.on("unhandledRejection", (reason) => {
    const e = reason instanceof Error ? reason : new Error(String(reason));
    recordSystemLog({
      category: "exception",
      level: "error",
      status: "failed",
      message: `unhandledRejection: ${e.message}`,
      stack: e.stack ?? null,
      source: "process",
    }).catch(() => {});
  });
}
