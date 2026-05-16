import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

export interface ValidateOptions {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

interface ValidationIssueOut {
  location: "body" | "query" | "params";
  path: string;
  message: string;
  code: string;
}

/**
 * Strict request validator. Every POST/PUT/PATCH route on the API should
 * declare a zod schema for its body (and where applicable, query/params)
 * and wrap its handler in `validate({ body, query, params })`.
 *
 * Rejects invalid payloads with a single consistent 400 shape:
 *   { error: "Invalid request", details: [{ location, path, message, code }] }
 *
 * Successful body validation REPLACES `req.body` with the parsed value so
 * downstream handlers see coerced/typed data. Query is validated but not
 * reassigned (Express 5 exposes `req.query` as a read-only getter); use the
 * returned schema's `.parse(req.query)` inside the handler if a typed copy
 * is needed.
 */
export function validate(opts: ValidateOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const issues: ValidationIssueOut[] = [];

    if (opts.body) {
      const r = opts.body.safeParse(req.body ?? {});
      if (!r.success) {
        for (const i of r.error.issues) {
          issues.push({
            location: "body",
            path: i.path.map(String).join("."),
            message: i.message,
            code: i.code,
          });
        }
      } else {
        req.body = r.data;
      }
    }

    if (opts.query) {
      const r = opts.query.safeParse(req.query ?? {});
      if (!r.success) {
        for (const i of r.error.issues) {
          issues.push({
            location: "query",
            path: i.path.map(String).join("."),
            message: i.message,
            code: i.code,
          });
        }
      }
    }

    if (opts.params) {
      const r = opts.params.safeParse(req.params ?? {});
      if (!r.success) {
        for (const i of r.error.issues) {
          issues.push({
            location: "params",
            path: i.path.map(String).join("."),
            message: i.message,
            code: i.code,
          });
        }
      }
    }

    if (issues.length > 0) {
      res.status(400).json({ error: "Invalid request", details: issues });
      return;
    }

    next();
  };
}
