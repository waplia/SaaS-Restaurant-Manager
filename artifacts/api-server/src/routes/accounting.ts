import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  accountingConnectionsTable,
  accountingTaxMappingsTable,
  accountingLedgerMappingsTable,
  accountingAccountMappingsTable,
  accountingExportRunsTable,
  ACCOUNTING_TARGETS,
  ACCOUNTING_DATASETS,
  ACCOUNTING_FORMATS,
  type AccountingTarget,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { recordAuditLog } from "../lib/audit";
import { TARGET_CATALOG, getTargetCatalog, defaultFormat } from "../lib/accounting/types";
import { runExport } from "../lib/accounting/runner";

const router: IRouter = Router();

const SECRET_KEYS = new Set(["clientSecret", "refreshToken", "bearerToken"]);
const targetSchema = z.enum(ACCOUNTING_TARGETS);
const datasetSchema = z.enum(ACCOUNTING_DATASETS);
const formatSchema = z.enum(ACCOUNTING_FORMATS);

function maskConfig(target: AccountingTarget, config: Record<string, unknown>): Record<string, unknown> {
  const catalog = getTargetCatalog(target);
  const out: Record<string, unknown> = {};
  for (const f of catalog.connectionFields) {
    const v = config[f.key];
    if (v == null || v === "") {
      out[f.key] = "";
    } else if (f.secret || SECRET_KEYS.has(f.key)) {
      const s = String(v);
      out[f.key] = s.length <= 4 ? "••••" : `••••${s.slice(-4)}`;
    } else {
      out[f.key] = v;
    }
  }
  return out;
}

function configStatus(target: AccountingTarget, config: Record<string, unknown>): "configured" | "configuration_required" | "not_configured" {
  const catalog = getTargetCatalog(target);
  const required = catalog.connectionFields.filter((f) => f.required);
  if (required.length === 0) return "configured";
  const missing = required.filter((f) => !config[f.key] || String(config[f.key]).trim() === "");
  if (missing.length === required.length) return "not_configured";
  if (missing.length > 0) return "configuration_required";
  return "configured";
}

router.use(
  "/restaurants/:restaurantId/accounting",
  requireRole("owner", "manager", "accountant", "super_admin"),
  validateRestaurantAccess,
);

// ─── Catalog ─────────────────────────────────────────────
router.get("/restaurants/:restaurantId/accounting/targets", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const conns = await db.select().from(accountingConnectionsTable).where(eq(accountingConnectionsTable.restaurantId, restaurantId));
  const byTarget = new Map(conns.map((c) => [c.target, c]));
  const out = TARGET_CATALOG.map((c) => {
    const conn = byTarget.get(c.target);
    const config = (conn?.config ?? {}) as Record<string, unknown>;
    return {
      target: c.target,
      label: c.label,
      description: c.description,
      formats: c.formats,
      supportsPush: c.supportsPush,
      status: configStatus(c.target, config),
      lastTestedAt: conn?.lastTestedAt ?? null,
      lastTestResult: conn?.lastTestResult ?? null,
    };
  });
  res.json(out);
});

router.get("/restaurants/:restaurantId/accounting/targets/:target", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = targetSchema.safeParse(req.params.target);
  if (!parsed.success) return void res.status(404).json({ error: "Unknown target" });
  const target = parsed.data;
  const catalog = getTargetCatalog(target);
  const [conn] = await db.select().from(accountingConnectionsTable).where(and(
    eq(accountingConnectionsTable.restaurantId, restaurantId),
    eq(accountingConnectionsTable.target, target),
  ));
  const config = (conn?.config ?? {}) as Record<string, unknown>;
  res.json({
    catalog,
    connection: {
      status: configStatus(target, config),
      config: maskConfig(target, config),
      lastTestedAt: conn?.lastTestedAt ?? null,
      lastTestResult: conn?.lastTestResult ?? null,
    },
  });
});

// ─── Connection ─────────────────────────────────────────
router.put("/restaurants/:restaurantId/accounting/targets/:target/connection",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const parsed = targetSchema.safeParse(req.params.target);
    if (!parsed.success) return void res.status(404).json({ error: "Unknown target" });
    const target = parsed.data;
    const catalog = getTargetCatalog(target);
    const body = z.object({ config: z.record(z.string(), z.unknown()) }).safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "config object required" });

    // Merge: preserve existing secret values when client sent the masked placeholder.
    const [existing] = await db.select().from(accountingConnectionsTable).where(and(
      eq(accountingConnectionsTable.restaurantId, restaurantId),
      eq(accountingConnectionsTable.target, target),
    ));
    const existingConfig = (existing?.config ?? {}) as Record<string, unknown>;
    const mergedConfig: Record<string, unknown> = {};
    for (const f of catalog.connectionFields) {
      const incoming = body.data.config[f.key];
      if (typeof incoming === "string" && incoming.startsWith("••••")) {
        mergedConfig[f.key] = existingConfig[f.key] ?? "";
      } else {
        mergedConfig[f.key] = incoming ?? "";
      }
    }
    const status = configStatus(target, mergedConfig);

    const values = {
      restaurantId, target, status,
      config: mergedConfig,
      updatedBy: req.user?.sub ?? null,
    };

    if (existing) {
      await db.update(accountingConnectionsTable).set({ ...values, updatedAt: new Date() }).where(eq(accountingConnectionsTable.id, existing.id));
    } else {
      await db.insert(accountingConnectionsTable).values(values);
    }

    await recordAuditLog({
      req, module: "accounting", action: existing ? "update" : "create",
      entity: "accounting_connection", entityId: existing?.id ?? null, restaurantId,
      newValue: { target, status }, details: `Saved ${target} connection (${status})`,
    });

    res.json({ status, config: maskConfig(target, mergedConfig) });
  },
);

router.post("/restaurants/:restaurantId/accounting/targets/:target/test",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const parsed = targetSchema.safeParse(req.params.target);
    if (!parsed.success) return void res.status(404).json({ error: "Unknown target" });
    const target = parsed.data;
    const [conn] = await db.select().from(accountingConnectionsTable).where(and(
      eq(accountingConnectionsTable.restaurantId, restaurantId),
      eq(accountingConnectionsTable.target, target),
    ));
    const config = (conn?.config ?? {}) as Record<string, unknown>;
    const status = configStatus(target, config);
    let result: string;
    if (status === "configured") {
      result = `Configuration looks complete for ${target}. (Live credential validation is not implemented; treat this as a dry-run.)`;
    } else if (status === "configuration_required") {
      const missing = getTargetCatalog(target).connectionFields.filter((f) => f.required && (!config[f.key] || String(config[f.key]).trim() === "")).map((f) => f.key);
      result = `Configuration required: missing ${missing.join(", ")}.`;
    } else {
      result = `Not configured.`;
    }
    if (conn) {
      await db.update(accountingConnectionsTable).set({
        lastTestedAt: new Date(),
        lastTestResult: result,
      }).where(eq(accountingConnectionsTable.id, conn.id));
    }
    res.json({ status, message: result });
  },
);

// ─── Mappings ───────────────────────────────────────────
const mappingKindSchema = z.enum(["tax", "ledger", "account"]);

router.get("/restaurants/:restaurantId/accounting/targets/:target/mappings", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = targetSchema.safeParse(req.params.target);
  if (!parsed.success) return void res.status(404).json({ error: "Unknown target" });
  const target = parsed.data;
  const [tax, ledger, account] = await Promise.all([
    db.select().from(accountingTaxMappingsTable).where(and(
      eq(accountingTaxMappingsTable.restaurantId, restaurantId),
      eq(accountingTaxMappingsTable.target, target),
    )),
    db.select().from(accountingLedgerMappingsTable).where(and(
      eq(accountingLedgerMappingsTable.restaurantId, restaurantId),
      eq(accountingLedgerMappingsTable.target, target),
    )),
    db.select().from(accountingAccountMappingsTable).where(and(
      eq(accountingAccountMappingsTable.restaurantId, restaurantId),
      eq(accountingAccountMappingsTable.target, target),
    )),
  ]);
  res.json({ tax, ledger, account });
});

router.put("/restaurants/:restaurantId/accounting/targets/:target/mappings/:kind",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const parsedTarget = targetSchema.safeParse(req.params.target);
    const parsedKind = mappingKindSchema.safeParse(req.params.kind);
    if (!parsedTarget.success || !parsedKind.success) return void res.status(404).json({ error: "Unknown target/kind" });
    const target = parsedTarget.data;
    const kind = parsedKind.data;

    const itemsSchema = kind === "tax"
      ? z.array(z.object({ sourceCode: z.string().min(1), targetCode: z.string().min(1), label: z.string().nullish() }))
      : kind === "ledger"
      ? z.array(z.object({ sourceLedger: z.string().min(1), targetLedger: z.string().min(1), notes: z.string().nullish() }))
      : z.array(z.object({ partyType: z.string().min(1), partyKey: z.string().min(1), targetAccount: z.string().min(1), notes: z.string().nullish() }));

    const body = z.object({ items: itemsSchema }).safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "Invalid items", details: body.error.flatten() });

    if (kind === "tax") {
      await db.delete(accountingTaxMappingsTable).where(and(
        eq(accountingTaxMappingsTable.restaurantId, restaurantId),
        eq(accountingTaxMappingsTable.target, target),
      ));
      if (body.data.items.length) {
        await db.insert(accountingTaxMappingsTable).values(body.data.items.map((it) => ({
          restaurantId, target,
          sourceCode: (it as { sourceCode: string }).sourceCode,
          targetCode: (it as { targetCode: string }).targetCode,
          label: (it as { label?: string | null }).label ?? null,
        })));
      }
    } else if (kind === "ledger") {
      await db.delete(accountingLedgerMappingsTable).where(and(
        eq(accountingLedgerMappingsTable.restaurantId, restaurantId),
        eq(accountingLedgerMappingsTable.target, target),
      ));
      if (body.data.items.length) {
        await db.insert(accountingLedgerMappingsTable).values(body.data.items.map((it) => ({
          restaurantId, target,
          sourceLedger: (it as { sourceLedger: string }).sourceLedger,
          targetLedger: (it as { targetLedger: string }).targetLedger,
          notes: (it as { notes?: string | null }).notes ?? null,
        })));
      }
    } else {
      await db.delete(accountingAccountMappingsTable).where(and(
        eq(accountingAccountMappingsTable.restaurantId, restaurantId),
        eq(accountingAccountMappingsTable.target, target),
      ));
      if (body.data.items.length) {
        await db.insert(accountingAccountMappingsTable).values(body.data.items.map((it) => ({
          restaurantId, target,
          partyType: (it as { partyType: string }).partyType,
          partyKey: (it as { partyKey: string }).partyKey,
          targetAccount: (it as { targetAccount: string }).targetAccount,
          notes: (it as { notes?: string | null }).notes ?? null,
        })));
      }
    }

    await recordAuditLog({
      req, module: "accounting", action: "update",
      entity: `accounting_${kind}_mapping`, restaurantId,
      newValue: { target, count: body.data.items.length },
      details: `Replaced ${kind} mappings for ${target} (${body.data.items.length} entries)`,
    });

    res.json({ ok: true, count: body.data.items.length });
  },
);

// ─── Exports ────────────────────────────────────────────
router.get("/restaurants/:restaurantId/accounting/targets/:target/exports", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = targetSchema.safeParse(req.params.target);
  if (!parsed.success) return void res.status(404).json({ error: "Unknown target" });
  const rows = await db.select().from(accountingExportRunsTable).where(and(
    eq(accountingExportRunsTable.restaurantId, restaurantId),
    eq(accountingExportRunsTable.target, parsed.data),
  )).orderBy(desc(accountingExportRunsTable.startedAt)).limit(50);
  res.json(rows);
});

const triggerBody = z.object({
  dataset: datasetSchema,
  format: formatSchema.optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pushMode: z.enum(["file", "push"]).default("file"),
});

router.post("/restaurants/:restaurantId/accounting/targets/:target/exports",
  requireRole("owner", "manager", "accountant", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const parsedTarget = targetSchema.safeParse(req.params.target);
    if (!parsedTarget.success) return void res.status(404).json({ error: "Unknown target" });
    const target = parsedTarget.data;
    const body = triggerBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "Invalid request", details: body.error.flatten() });
    const catalog = getTargetCatalog(target);
    const format = body.data.format ?? defaultFormat(target, body.data.dataset);
    if (!catalog.formats[body.data.dataset].includes(format)) {
      return void res.status(400).json({ error: `Format ${format} is not supported for ${target}/${body.data.dataset}` });
    }

    const result = await runExport({
      restaurantId, target,
      dataset: body.data.dataset,
      format,
      dateFrom: body.data.dateFrom,
      dateTo: body.data.dateTo,
      pushMode: body.data.pushMode,
      createdBy: req.user?.sub ?? null,
    });

    await recordAuditLog({
      req, module: "accounting", action: "export",
      entity: "accounting_export_run", entityId: result.runId, restaurantId,
      newValue: { target, dataset: body.data.dataset, format, status: result.status, rowCount: result.rowCount },
      details: `Export ${target}/${body.data.dataset} ${result.status}`,
    });

    res.status(result.status === "succeeded" ? 200 : 422).json(result);
  },
);

export default router;
