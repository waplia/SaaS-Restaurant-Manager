import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  accountingConnectionsTable,
  accountingTaxMappingsTable,
  accountingLedgerMappingsTable,
  accountingAccountMappingsTable,
  accountingExportRunsTable,
  type AccountingTarget,
  type AccountingDataset,
  type AccountingFormat,
} from "../db";
import { ObjectStorageService } from "../objectStorage";
import { setObjectAclPolicy } from "../objectAcl";
import { logger } from "../logger";
import { buildDataset } from "./datasets";
import { render, type MappingLookup } from "./renderers";
import { ConfigurationRequiredError, getTargetCatalog } from "./types";
import { pushToTarget } from "./pushAdapters";

export interface RunExportArgs {
  restaurantId: number;
  target: AccountingTarget;
  dataset: AccountingDataset;
  format: AccountingFormat;
  dateFrom: string;
  dateTo: string;
  pushMode: "file" | "push";
  createdBy?: number | null;
}

export interface RunExportResult {
  runId: number;
  status: "succeeded" | "failed" | "configuration_required";
  fileUrl: string | null;
  fileName: string | null;
  rowCount: number;
  error: string | null;
  pushResponse: Record<string, unknown> | null;
}

export async function runExport(args: RunExportArgs): Promise<RunExportResult> {
  const { restaurantId, target, dataset, format, dateFrom, dateTo, pushMode, createdBy } = args;

  const [run] = await db.insert(accountingExportRunsTable).values({
    restaurantId, target, dataset, format, dateFrom, dateTo,
    pushMode, status: "running", createdBy: createdBy ?? null,
  }).returning();

  try {
    const [conn] = await db.select().from(accountingConnectionsTable).where(and(
      eq(accountingConnectionsTable.restaurantId, restaurantId),
      eq(accountingConnectionsTable.target, target),
    ));
    const config = (conn?.config ?? {}) as Record<string, unknown>;

    if (pushMode === "push") {
      const catalog = getTargetCatalog(target);
      if (!catalog.supportsPush) throw new Error(`Target ${target} does not support API push`);
      const required = catalog.connectionFields.filter((f) => f.required).map((f) => f.key);
      const missing = required.filter((k) => !config[k] || String(config[k]).trim() === "");
      if (missing.length) throw new ConfigurationRequiredError(target, missing);
    }

    const mappings = await loadMappings(restaurantId, target);
    const rows = await buildDataset({ restaurantId, dataset, dateFrom, dateTo });
    const rendered = await render({ target, dataset, format, rows, mappings, config });

    let fileUrl: string | null = null;
    let pushResponse: Record<string, unknown> | null = null;

    if (pushMode === "push") {
      const result = await pushToTarget({ target, config, payload: rendered.buffer.toString("utf8"), fileName: rendered.fileName });
      pushResponse = { ok: result.ok, status: result.status, body: result.body };
      if (!result.ok) throw new Error(`Push failed: HTTP ${result.status} ${result.body.slice(0, 200)}`);
    }

    // Always also produce a downloadable file (even on push) — the user wants both.
    fileUrl = await uploadExportFile({ restaurantId, run: run.id, file: rendered, createdBy });

    const [updated] = await db.update(accountingExportRunsTable).set({
      status: "succeeded",
      fileUrl,
      fileName: rendered.fileName,
      rowCount: rows.length,
      pushResponse,
      finishedAt: new Date(),
    }).where(eq(accountingExportRunsTable.id, run.id)).returning();

    return {
      runId: updated.id,
      status: "succeeded",
      fileUrl: updated.fileUrl,
      fileName: updated.fileName,
      rowCount: updated.rowCount,
      error: null,
      pushResponse,
    };
  } catch (err) {
    const isConfig = err instanceof ConfigurationRequiredError;
    const message = err instanceof Error ? err.message : String(err);
    const [updated] = await db.update(accountingExportRunsTable).set({
      status: isConfig ? "configuration_required" : "failed",
      error: message,
      finishedAt: new Date(),
    }).where(eq(accountingExportRunsTable.id, run.id)).returning();

    if (!isConfig) logger.error({ err, target, dataset }, "accounting export failed");

    return {
      runId: updated.id,
      status: isConfig ? "configuration_required" : "failed",
      fileUrl: null,
      fileName: null,
      rowCount: 0,
      error: message,
      pushResponse: null,
    };
  }
}

async function loadMappings(restaurantId: number, target: AccountingTarget): Promise<MappingLookup> {
  const [taxRows, ledgerRows, accountRows] = await Promise.all([
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
  const taxMap = new Map(taxRows.map((r) => [r.sourceCode, r.targetCode]));
  const ledgerMap = new Map(ledgerRows.map((r) => [r.sourceLedger, r.targetLedger]));
  const accountMap = new Map(accountRows.map((r) => [`${r.partyType}:${r.partyKey}`, r.targetAccount]));
  return {
    tax: (k) => taxMap.get(k) ?? null,
    ledger: (k) => ledgerMap.get(k) ?? null,
    account: (t, k) => accountMap.get(`${t}:${k}`) ?? null,
  };
}

interface UploadArgs {
  restaurantId: number;
  run: number;
  file: { buffer: Buffer; contentType: string; fileName: string };
  createdBy?: number | null;
}

async function uploadExportFile({ restaurantId, run, file, createdBy }: UploadArgs): Promise<string> {
  const storage = new ObjectStorageService();
  const dir = storage.getPrivateObjectDir().replace(/\/$/, "");
  const objectId = `accounting/${restaurantId}/${run}-${randomUUID()}-${file.fileName}`;
  const fullPath = `${dir}/${objectId}`;
  const { parseObjectPath, objectStorageClient } = await import("../objectStorage");
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const bucket = objectStorageClient.bucket(bucketName);
  const handle = bucket.file(objectName);
  await handle.save(file.buffer, {
    contentType: file.contentType,
    resumable: false,
    metadata: { contentType: file.contentType },
  });
  await setObjectAclPolicy(handle, {
    restaurantId: String(restaurantId),
    uploaderId: createdBy ? String(createdBy) : undefined,
    visibility: "private",
  });
  return `/objects/${objectId}`;
}
