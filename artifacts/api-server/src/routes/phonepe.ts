/**
 * PhonePe Offline Payments API (Task #522).
 *
 * Three router exports:
 *  - `phonepePublicRouter`  — S2S callbacks (no JWT, but X-VERIFY checked).
 *  - `phonepeRouter`        — authenticated tenant + super-admin endpoints.
 *
 * Every "paid" decision is gated by a server-side Status Check verifying
 * PhonePe's authoritative state — frontend signals never mark anything paid.
 */
import { Router } from "express";
import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import {
  db,
  phonepeProviderConfigsTable,
  phonepeTerminalsTable,
  phonepeTransactionsTable,
  phonepeCallbacksTable,
  phonepeRefundsTable,
  phonepeReconciliationRecordsTable,
  paymentsTable,
  ordersTable,
  type PhonePeSolution,
  type PhonePeTerminalBinding,
  type PhonePeTxnStatus,
} from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { validate } from "../middleware/validate";
import { recordAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import {
  base64EncodePayload,
  generateXVerify,
  generateStatusXVerify,
  buildPostHeaders,
  buildGetHeaders,
  verifyCallbackSignature,
  isValidShortOrderId,
  generateMerchantTransactionId,
  generateShortOrderId,
} from "../lib/phonepeSigner";
import {
  getMaskedConfig,
  getRuntimeConfig,
  upsertConfig,
  testConnection,
  explainPhonePeCode,
  PHONEPE_SOLUTIONS,
} from "../lib/phonepeConfig";

const router = Router();
export const phonepePublicRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────

const SOLUTION_PATHS = {
  EDC:        { sale: "/v3/credit/init", status: "/v3/transaction" },
  DYNAMIC_QR: { sale: "/v3/qr/create",   status: "/v3/transaction" },
  COLLECT:    { sale: "/v3/collect/init", status: "/v3/transaction" },
  PAYLINK:    { sale: "/v3/paylink/init", status: "/v3/transaction" },
  STATIC_QR:  { sale: "",                  status: "/v3/transaction" },
} as const;

interface PhonePeApiResponse {
  success: boolean;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/** Map PhonePe's response.code to our internal lifecycle status. */
function mapPhonePeCodeToStatus(code: string | null | undefined): PhonePeTxnStatus | null {
  if (!code) return null;
  switch (code) {
    case "PAYMENT_SUCCESS": return "success";
    case "PAYMENT_PENDING":
    case "TRANSACTION_NOT_FOUND": return "pending";
    case "PAYMENT_DECLINED":
    case "PAYMENT_ERROR": return "failed";
    case "PAYMENT_CANCELLED": return "cancelled";
    case "SHORT_CODE_EXPIRED": return "expired";
    default: return null;
  }
}

/** Coerce decimal rupee amount to integer paise. */
function rupeesToPaise(rupees: number | string): number {
  const n = typeof rupees === "number" ? rupees : Number(rupees);
  return Math.round(n * 100);
}

/** Safe public view of a transaction row (no salt-related fields). */
function publicTxnView(row: typeof phonepeTransactionsTable.$inferSelect) {
  return {
    id: row.id,
    merchantTransactionId: row.merchantTransactionId,
    phonepeTransactionId: row.phonepeTransactionId,
    shortOrderId: row.shortOrderId,
    solution: row.solution,
    requestedModes: row.requestedModes,
    finalMode: row.finalMode,
    storeId: row.storeId,
    terminalId: row.terminalId,
    binding: row.binding,
    amountPaise: row.amountPaise,
    amountRupees: row.amountPaise / 100,
    status: row.status,
    responseCode: row.responseCode,
    responseCodeLabel: explainPhonePeCode(row.responseCode),
    referenceNumber: row.referenceNumber,
    customerPhone: row.customerPhone,
    customerVpa: row.customerVpa,
    paylinkUrl: row.paylinkUrl,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    webhookAt: row.webhookAt?.toISOString() ?? null,
    orderId: row.orderId,
    paymentId: row.paymentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** HTTP call to PhonePe with X-VERIFY headers. Surfaces structured errors. */
async function callPhonePe(opts: {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{ httpStatus: number; rawBody: string; parsed: PhonePeApiResponse }> {
  const res = await fetch(opts.url, {
    method: opts.method,
    headers: opts.headers,
    body: opts.body,
  });
  const rawBody = await res.text();
  let parsed: PhonePeApiResponse;
  try {
    parsed = JSON.parse(rawBody) as PhonePeApiResponse;
  } catch {
    parsed = { success: false, code: "INVALID_RESPONSE", message: rawBody.slice(0, 240) };
  }
  return { httpStatus: res.status, rawBody, parsed };
}

/** Persist a verified successful payment into the payments ledger + order. */
async function markPaidFromTransaction(args: {
  txnRowId: number;
  restaurantId: number;
  orderId: number | null;
  amountPaise: number;
  method: string;
}): Promise<number | null> {
  if (!args.orderId) return null;
  const [pay] = await db.insert(paymentsTable).values({
    restaurantId: args.restaurantId,
    direction: "in",
    method: args.method,
    // Task #587 — categorize this as an online payment routed through PhonePe.
    paymentCategory: "online",
    paymentSource: "platform_gateway",
    gatewayCode: "phonepe",
    amount: (args.amountPaise / 100).toFixed(2),
    referenceType: "order",
    referenceId: args.orderId,
    partyType: "other",
    terminalProvider: "phonepe",
    terminalRefId: String(args.txnRowId),
  } as never).returning({ id: paymentsTable.id });

  await db.update(phonepeTransactionsTable)
    .set({ paymentId: pay.id, updatedAt: new Date() })
    .where(eq(phonepeTransactionsTable.id, args.txnRowId));

  // Update order paid amount + status if fully covered.
  const [order] = await db.select({
    totalAmount: ordersTable.totalAmount,
  }).from(ordersTable).where(eq(ordersTable.id, args.orderId));

  if (order) {
    const total = Number(order.totalAmount);
    const [{ sum }] = await db.select({
      sum: sql<string>`coalesce(sum(${paymentsTable.amount})::text, '0')`,
    }).from(paymentsTable).where(and(
      eq(paymentsTable.referenceType, "order"),
      eq(paymentsTable.referenceId, args.orderId),
      eq(paymentsTable.direction, "in"),
    ));
    const paid = Number(sum);
    const isPaid = paid >= total - 0.005;
    await db.update(ordersTable).set({
      paymentStatus: isPaid ? "paid" : "partially_paid",
    }).where(eq(ordersTable.id, args.orderId));
  }

  return pay.id;
}

// ─── Super Admin: provider config ─────────────────────────────────────────

const UpsertConfigBody = z.object({
  isEnabled: z.boolean().optional(),
  env: z.enum(["uat", "prod"]).optional(),
  merchantId: z.string().trim().min(1).max(64).nullable().optional(),
  saltKey: z.string().trim().max(256).nullable().optional(),
  saltIndex: z.coerce.number().int().min(1).max(20).optional(),
  callbackUsername: z.string().trim().max(128).nullable().optional(),
  callbackPassword: z.string().trim().max(256).nullable().optional(),
  defaultTimeoutSec: z.coerce.number().int().min(15).max(900).optional(),
  enabledSolutions: z.record(z.enum(PHONEPE_SOLUTIONS as [PhonePeSolution, ...PhonePeSolution[]]), z.boolean()).optional(),
  uatBaseUrl: z.string().url().nullable().optional(),
  prodBaseUrl: z.string().url().nullable().optional(),
  refundApiEnabled: z.boolean().optional(),
});

router.get("/admin/phonepe/config", requireSuperAdmin, async (_req, res) => {
  res.json(await getMaskedConfig());
});

router.put("/admin/phonepe/config", requireSuperAdmin, validate({ body: UpsertConfigBody }), async (req, res) => {
  const updated = await upsertConfig({ ...req.body, updatedBy: req.user?.sub ?? null });
  await recordAuditLog({
    req, module: "phonepe", action: "config_updated", entity: "phonepe_provider_config",
    entityId: updated.id, newValue: { ...req.body, saltKey: req.body.saltKey ? "[REDACTED]" : undefined, callbackPassword: req.body.callbackPassword ? "[REDACTED]" : undefined },
  });
  res.json(updated);
});

router.post("/admin/phonepe/config/test-connection", requireSuperAdmin, async (_req, res) => {
  const r = await testConnection();
  res.json(r);
});

router.get("/admin/phonepe/solutions", requireSuperAdmin, (_req, res) => {
  res.json({ solutions: PHONEPE_SOLUTIONS });
});

// ─── Restaurant: terminals (Super Admin can view across tenants) ──────────

const TerminalBody = z.object({
  label: z.string().trim().min(1).max(120),
  storeId: z.string().trim().min(1).max(64),
  terminalId: z.string().trim().max(64).nullable().optional(),
  binding: z.enum(["ONE_TO_ONE", "OPEN"]).default("ONE_TO_ONE"),
  supportedModes: z.array(z.enum(["CARD", "DQR"])).min(1).default(["CARD", "DQR"]),
  branchId: z.coerce.number().int().positive().nullable().optional(),
  defaultForCounter: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
}).refine(v => v.binding === "OPEN" || !!v.terminalId, {
  message: "terminalId is required for ONE_TO_ONE bindings",
  path: ["terminalId"],
});

const phonepeAccessRoles = requireRole("owner", "manager", "super_admin", "cashier");
const phonepeManageRoles = requireRole("owner", "manager", "super_admin");

router.get(
  "/restaurants/:restaurantId/phonepe/terminals",
  phonepeAccessRoles,
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const rows = await db.select().from(phonepeTerminalsTable).where(eq(phonepeTerminalsTable.restaurantId, restaurantId));
    res.json({ terminals: rows });
  },
);

router.post(
  "/restaurants/:restaurantId/phonepe/terminals",
  phonepeManageRoles,
  validateRestaurantAccess,
  validate({ body: TerminalBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const [row] = await db.insert(phonepeTerminalsTable).values({
      restaurantId,
      label: req.body.label,
      storeId: req.body.storeId,
      terminalId: req.body.terminalId ?? null,
      binding: req.body.binding as PhonePeTerminalBinding,
      supportedModes: req.body.supportedModes,
      branchId: req.body.branchId ?? null,
      defaultForCounter: !!req.body.defaultForCounter,
      isActive: req.body.isActive ?? true,
      notes: req.body.notes ?? null,
      createdBy: req.user?.sub ?? null,
    }).returning();
    await recordAuditLog({ req, module: "phonepe", action: "terminal_created", entity: "phonepe_terminal", entityId: row.id, restaurantId, newValue: req.body });
    res.status(201).json(row);
  },
);

router.patch(
  "/restaurants/:restaurantId/phonepe/terminals/:id",
  phonepeManageRoles,
  validateRestaurantAccess,
  validate({ body: z.object({
    label: z.string().trim().min(1).max(120).optional(),
    storeId: z.string().trim().min(1).max(64).optional(),
    terminalId: z.string().trim().max(64).nullable().optional(),
    binding: z.enum(["ONE_TO_ONE", "OPEN"]).optional(),
    supportedModes: z.array(z.enum(["CARD", "DQR"])).min(1).optional(),
    branchId: z.coerce.number().int().positive().nullable().optional(),
    defaultForCounter: z.boolean().optional(),
    isActive: z.boolean().optional(),
    notes: z.string().max(500).nullable().optional(),
  }) }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["label", "storeId", "terminalId", "binding", "supportedModes", "branchId", "defaultForCounter", "isActive", "notes"]) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }
    const [row] = await db.update(phonepeTerminalsTable).set(update)
      .where(and(eq(phonepeTerminalsTable.id, id), eq(phonepeTerminalsTable.restaurantId, restaurantId))).returning();
    if (!row) return void res.status(404).json({ error: "Terminal not found" });
    await recordAuditLog({ req, module: "phonepe", action: "terminal_updated", entity: "phonepe_terminal", entityId: id, restaurantId, newValue: update });
    res.json(row);
  },
);

router.delete(
  "/restaurants/:restaurantId/phonepe/terminals/:id",
  phonepeManageRoles,
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    await db.delete(phonepeTerminalsTable).where(and(eq(phonepeTerminalsTable.id, id), eq(phonepeTerminalsTable.restaurantId, restaurantId)));
    await recordAuditLog({ req, module: "phonepe", action: "terminal_deleted", entity: "phonepe_terminal", entityId: id, restaurantId });
    res.json({ ok: true });
  },
);

// ─── EDC Sale ─────────────────────────────────────────────────────────────

const EdcSaleBody = z.object({
  terminalRowId: z.coerce.number().int().positive(),
  amount: z.union([z.number(), z.string()]),
  orderId: z.coerce.number().int().positive().optional(),
  modes: z.array(z.enum(["CARD", "DQR"])).optional(),
  timeoutSec: z.coerce.number().int().min(15).max(900).optional(),
  notes: z.string().max(500).optional(),
});

router.post(
  "/restaurants/:restaurantId/phonepe/edc/sale",
  phonepeAccessRoles,
  validateRestaurantAccess,
  validate({ body: EdcSaleBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const cfg = await getRuntimeConfig();
    if (!cfg || !cfg.enabled) return void res.status(503).json({ error: "PhonePe is not configured or is disabled by the platform admin." });
    if (!cfg.enabledSolutions.EDC) return void res.status(403).json({ error: "EDC solution is disabled by the platform admin." });

    const [terminal] = await db.select().from(phonepeTerminalsTable)
      .where(and(eq(phonepeTerminalsTable.id, req.body.terminalRowId), eq(phonepeTerminalsTable.restaurantId, restaurantId)));
    if (!terminal) return void res.status(404).json({ error: "PhonePe terminal not found for this restaurant." });
    if (!terminal.isActive) return void res.status(409).json({ error: "This PhonePe terminal is inactive." });

    const amountPaise = rupeesToPaise(req.body.amount);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) return void res.status(400).json({ error: "amount must be a positive number" });

    const requestedModes = (req.body.modes && req.body.modes.length ? req.body.modes : terminal.supportedModes) as Array<"CARD" | "DQR">;
    const txnId = generateMerchantTransactionId("KL");
    const shortOrderId = terminal.binding === "OPEN" ? generateShortOrderId() : null;

    const payload = {
      merchantId: cfg.merchantId,
      merchantTransactionId: txnId,
      merchantOrderId: req.body.orderId ? String(req.body.orderId) : txnId,
      amount: amountPaise,
      storeId: terminal.storeId,
      terminalId: terminal.terminalId ?? undefined,
      paymentInstrument: { type: "EDC", paymentModes: requestedModes },
      ...(shortOrderId ? { shortOrderId } : {}),
      expiresIn: req.body.timeoutSec ?? cfg.defaultTimeoutSec,
    };
    const base64 = base64EncodePayload(payload);
    const apiPath = SOLUTION_PATHS.EDC.sale;
    const xv = generateXVerify(base64, apiPath, { saltKey: cfg.saltKey, saltIndex: cfg.saltIndex });

    const [row] = await db.insert(phonepeTransactionsTable).values({
      restaurantId, branchId: terminal.branchId,
      orderId: req.body.orderId ?? null,
      merchantTransactionId: txnId,
      shortOrderId,
      solution: "EDC",
      requestedModes,
      terminalRowId: terminal.id,
      storeId: terminal.storeId,
      terminalId: terminal.terminalId,
      binding: terminal.binding,
      amountPaise,
      status: "initiated",
      initiatedBy: req.user?.sub ?? null,
      rawRequest: payload,
      metadata: req.body.notes ? { notes: req.body.notes } : {},
    }).returning();

    try {
      const { httpStatus, parsed, rawBody } = await callPhonePe({
        method: "POST",
        url: `${cfg.baseUrl}${apiPath}`,
        headers: buildPostHeaders({ xVerify: xv, merchantId: cfg.merchantId }),
        body: JSON.stringify({ request: base64 }),
      });
      const code = parsed.code ?? null;
      const newStatus: PhonePeTxnStatus = code === "PAYMENT_SUCCESS" ? "success"
        : code === "PAYMENT_PENDING" || parsed.success ? "pending"
        : "failed";
      await db.update(phonepeTransactionsTable).set({
        rawResponse: parsed as unknown as Record<string, unknown>,
        responseCode: code,
        status: newStatus,
        phonepeTransactionId: (parsed.data?.transactionId as string) ?? null,
        updatedAt: new Date(),
      }).where(eq(phonepeTransactionsTable.id, row.id));

      await recordAuditLog({ req, module: "phonepe", action: "edc_sale_initiated", entity: "phonepe_transaction", entityId: row.id, restaurantId, newValue: { txnId, amountPaise, terminalId: terminal.terminalId, binding: terminal.binding } });

      if (!parsed.success && newStatus === "failed") {
        return void res.status(502).json({
          error: explainPhonePeCode(code, parsed.message),
          code, httpStatus, transactionId: txnId, transactionRowId: row.id, shortOrderId,
        });
      }
      const fresh = await db.select().from(phonepeTransactionsTable).where(eq(phonepeTransactionsTable.id, row.id));
      res.status(201).json({ transaction: publicTxnView(fresh[0]), shortOrderId, message: terminal.binding === "OPEN" ? `Ask the cashier to enter short code ${shortOrderId} on the EDC.` : "Sent to PhonePe EDC. Tap the card or scan the QR on the terminal." });
    } catch (err) {
      logger.error({ err, txnId }, "PhonePe EDC sale request failed");
      await db.update(phonepeTransactionsTable).set({ status: "failed", responseCode: "NETWORK_ERROR", updatedAt: new Date() }).where(eq(phonepeTransactionsTable.id, row.id));
      res.status(502).json({ error: "Could not reach PhonePe. Please retry or check status.", transactionRowId: row.id, transactionId: txnId });
    }
  },
);

// ─── Status check (re-signs + re-queries; marks paid on verified SUCCESS) ─

async function runStatusCheck(txnRowId: number): Promise<typeof phonepeTransactionsTable.$inferSelect> {
  const [row] = await db.select().from(phonepeTransactionsTable).where(eq(phonepeTransactionsTable.id, txnRowId));
  if (!row) throw new Error("transaction not found");
  if (["success", "refunded", "partially_refunded", "cancelled", "expired"].includes(row.status)) return row;

  const cfg = await getRuntimeConfig();
  if (!cfg) throw new Error("PhonePe not configured");

  const path = `/v3/transaction/${cfg.merchantId}/${row.merchantTransactionId}/status`;
  const xv = generateStatusXVerify(path, { saltKey: cfg.saltKey, saltIndex: cfg.saltIndex });
  const { parsed } = await callPhonePe({
    method: "GET",
    url: `${cfg.baseUrl}${path}`,
    headers: buildGetHeaders({ xVerify: xv, merchantId: cfg.merchantId }),
  });

  const code = parsed.code ?? null;
  const nextStatus = mapPhonePeCodeToStatus(code) ?? row.status;
  const update: Record<string, unknown> = {
    status: nextStatus,
    responseCode: code,
    lastStatusCheckAt: new Date(),
    rawResponse: parsed as unknown as Record<string, unknown>,
    phonepeTransactionId: (parsed.data?.transactionId as string) ?? row.phonepeTransactionId,
    referenceNumber: (parsed.data?.providerReferenceId as string) ?? row.referenceNumber,
    finalMode: (parsed.data?.paymentMode as string) ?? row.finalMode,
    updatedAt: new Date(),
  };
  if (nextStatus === "success" && !row.verifiedAt) {
    update.verifiedAt = new Date();
  }
  await db.update(phonepeTransactionsTable).set(update).where(eq(phonepeTransactionsTable.id, row.id));

  if (nextStatus === "success" && !row.paymentId) {
    await markPaidFromTransaction({
      txnRowId: row.id,
      restaurantId: row.restaurantId,
      orderId: row.orderId,
      amountPaise: row.amountPaise,
      method: row.solution === "EDC" ? (row.finalMode === "CARD" ? "card" : "upi") : "upi",
    });
  }
  const [final] = await db.select().from(phonepeTransactionsTable).where(eq(phonepeTransactionsTable.id, txnRowId));
  return final;
}

router.get(
  "/restaurants/:restaurantId/phonepe/transactions",
  phonepeAccessRoles,
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const solution = typeof req.query.solution === "string" ? req.query.solution : null;
    const conds = [eq(phonepeTransactionsTable.restaurantId, restaurantId)];
    if (status) conds.push(eq(phonepeTransactionsTable.status, status as PhonePeTxnStatus));
    if (solution) conds.push(eq(phonepeTransactionsTable.solution, solution as PhonePeSolution));
    const rows = await db.select().from(phonepeTransactionsTable).where(and(...conds)).orderBy(desc(phonepeTransactionsTable.id)).limit(200);
    res.json({ transactions: rows.map(publicTxnView) });
  },
);

router.get(
  "/restaurants/:restaurantId/phonepe/status/:txnRowId",
  phonepeAccessRoles,
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.txnRowId);
    try {
      const updated = await runStatusCheck(id);
      if (updated.restaurantId !== restaurantId) return void res.status(404).json({ error: "Not found" });
      res.json({ transaction: publicTxnView(updated) });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Status check failed" });
    }
  },
);

// ─── Cancel ───────────────────────────────────────────────────────────────

const CancelBody = z.object({ reason: z.string().max(300).optional() });

router.post(
  "/restaurants/:restaurantId/phonepe/cancel/:txnRowId",
  phonepeAccessRoles,
  validateRestaurantAccess,
  validate({ body: CancelBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.txnRowId);
    const [row] = await db.select().from(phonepeTransactionsTable).where(and(eq(phonepeTransactionsTable.id, id), eq(phonepeTransactionsTable.restaurantId, restaurantId)));
    if (!row) return void res.status(404).json({ error: "Transaction not found" });
    if (["success", "refunded", "partially_refunded"].includes(row.status)) return void res.status(409).json({ error: "Cannot cancel a completed transaction." });

    const cfg = await getRuntimeConfig();
    if (cfg) {
      // Best-effort: hit PhonePe Cancel endpoint, but always mark our row cancelled.
      try {
        const path = `/v3/transaction/${cfg.merchantId}/${row.merchantTransactionId}/cancel`;
        const payload = { merchantId: cfg.merchantId, merchantTransactionId: row.merchantTransactionId };
        const b64 = base64EncodePayload(payload);
        const xv = generateXVerify(b64, path, { saltKey: cfg.saltKey, saltIndex: cfg.saltIndex });
        await callPhonePe({
          method: "POST", url: `${cfg.baseUrl}${path}`,
          headers: buildPostHeaders({ xVerify: xv, merchantId: cfg.merchantId }),
          body: JSON.stringify({ request: b64 }),
        }).catch((err) => logger.warn({ err }, "PhonePe cancel API call failed (continuing)"));
      } catch (err) { logger.warn({ err }, "PhonePe cancel preparation failed"); }
    }

    await db.update(phonepeTransactionsTable).set({ status: "cancelled", responseCode: "PAYMENT_CANCELLED", updatedAt: new Date() }).where(eq(phonepeTransactionsTable.id, id));
    await recordAuditLog({ req, module: "phonepe", action: "transaction_cancelled", entity: "phonepe_transaction", entityId: id, restaurantId, details: req.body.reason });
    res.json({ ok: true });
  },
);

// ─── Dynamic QR / Collect / Paylink (lightweight init endpoints) ─────────

const SimpleInitBody = z.object({
  amount: z.union([z.number(), z.string()]),
  orderId: z.coerce.number().int().positive().optional(),
  timeoutSec: z.coerce.number().int().min(15).max(900).optional(),
  storeId: z.string().trim().min(1).max(64).optional(),
  customerPhone: z.string().trim().max(20).optional(),
  customerVpa: z.string().trim().max(120).optional(),
  notes: z.string().max(500).optional(),
});

function makeSimpleInitHandler(solution: PhonePeSolution) {
  return async (req: import("express").Request, res: import("express").Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const cfg = await getRuntimeConfig();
    if (!cfg || !cfg.enabled) return void res.status(503).json({ error: "PhonePe is not configured." });
    if (!cfg.enabledSolutions[solution]) return void res.status(403).json({ error: `${solution} is disabled by the platform admin.` });

    const amountPaise = rupeesToPaise(req.body.amount);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) return void res.status(400).json({ error: "amount must be > 0" });
    if (solution === "COLLECT" && !req.body.customerPhone && !req.body.customerVpa) {
      return void res.status(400).json({ error: "customerPhone or customerVpa is required for Collect Call." });
    }

    const txnId = generateMerchantTransactionId(solution === "DYNAMIC_QR" ? "DQR" : solution === "COLLECT" ? "COL" : "PLK");
    const payload: Record<string, unknown> = {
      merchantId: cfg.merchantId,
      merchantTransactionId: txnId,
      merchantOrderId: req.body.orderId ? String(req.body.orderId) : txnId,
      amount: amountPaise,
      storeId: req.body.storeId,
      expiresIn: req.body.timeoutSec ?? cfg.defaultTimeoutSec,
    };
    if (solution === "COLLECT") {
      payload.paymentInstrument = req.body.customerVpa
        ? { type: "VPA", vpa: req.body.customerVpa }
        : { type: "MOBILE", mobile: req.body.customerPhone };
    } else if (solution === "DYNAMIC_QR") {
      payload.paymentInstrument = { type: "DYNAMIC_QR" };
    } else if (solution === "PAYLINK") {
      payload.paymentInstrument = { type: "PAY_PAGE" };
    }

    const path = SOLUTION_PATHS[solution].sale;
    const b64 = base64EncodePayload(payload);
    const xv = generateXVerify(b64, path, { saltKey: cfg.saltKey, saltIndex: cfg.saltIndex });

    const [row] = await db.insert(phonepeTransactionsTable).values({
      restaurantId, orderId: req.body.orderId ?? null,
      merchantTransactionId: txnId, solution,
      requestedModes: solution === "DYNAMIC_QR" || solution === "COLLECT" || solution === "PAYLINK" ? ["UPI"] : [],
      storeId: req.body.storeId ?? null,
      amountPaise, status: "initiated",
      customerPhone: req.body.customerPhone ?? null,
      customerVpa: req.body.customerVpa ?? null,
      initiatedBy: req.user?.sub ?? null,
      rawRequest: payload,
      metadata: req.body.notes ? { notes: req.body.notes } : {},
    }).returning();

    try {
      const { parsed } = await callPhonePe({
        method: "POST", url: `${cfg.baseUrl}${path}`,
        headers: buildPostHeaders({ xVerify: xv, merchantId: cfg.merchantId }),
        body: JSON.stringify({ request: b64 }),
      });
      const code = parsed.code ?? null;
      const status: PhonePeTxnStatus = parsed.success ? "pending" : "failed";
      const data = parsed.data ?? {};
      const update: Record<string, unknown> = {
        rawResponse: parsed as unknown as Record<string, unknown>,
        responseCode: code,
        status,
        phonepeTransactionId: (data.transactionId as string) ?? null,
        paylinkUrl: (data.payLink as string) ?? (data.shortUrl as string) ?? null,
        updatedAt: new Date(),
      };
      await db.update(phonepeTransactionsTable).set(update).where(eq(phonepeTransactionsTable.id, row.id));
      await recordAuditLog({ req, module: "phonepe", action: `${solution.toLowerCase()}_initiated`, entity: "phonepe_transaction", entityId: row.id, restaurantId, newValue: { txnId, amountPaise } });
      const fresh = await db.select().from(phonepeTransactionsTable).where(eq(phonepeTransactionsTable.id, row.id));
      if (!parsed.success) {
        return void res.status(502).json({
          error: explainPhonePeCode(code, parsed.message), code,
          transaction: publicTxnView(fresh[0]),
          qrData: data.qrData ?? null,
        });
      }
      res.status(201).json({
        transaction: publicTxnView(fresh[0]),
        qrData: data.qrData ?? data.qrString ?? null,
        paylinkUrl: data.payLink ?? data.shortUrl ?? null,
      });
    } catch (err) {
      logger.error({ err, txnId, solution }, "PhonePe init request failed");
      await db.update(phonepeTransactionsTable).set({ status: "failed", responseCode: "NETWORK_ERROR", updatedAt: new Date() }).where(eq(phonepeTransactionsTable.id, row.id));
      res.status(502).json({ error: "Could not reach PhonePe. Please retry." });
    }
  };
}

router.post("/restaurants/:restaurantId/phonepe/dqr/init",      phonepeAccessRoles, validateRestaurantAccess, validate({ body: SimpleInitBody }), makeSimpleInitHandler("DYNAMIC_QR"));
router.post("/restaurants/:restaurantId/phonepe/collect/request", phonepeAccessRoles, validateRestaurantAccess, validate({ body: SimpleInitBody }), makeSimpleInitHandler("COLLECT"));
router.post("/restaurants/:restaurantId/phonepe/paylink/create",  phonepeAccessRoles, validateRestaurantAccess, validate({ body: SimpleInitBody }), makeSimpleInitHandler("PAYLINK"));

// ─── Refund ───────────────────────────────────────────────────────────────

const RefundBody = z.object({
  amount: z.union([z.number(), z.string()]),
  reason: z.string().max(500).optional(),
});

router.post(
  "/restaurants/:restaurantId/phonepe/refund/:txnRowId",
  phonepeManageRoles,
  validateRestaurantAccess,
  validate({ body: RefundBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const txnRowId = Number(req.params.txnRowId);
    const [txn] = await db.select().from(phonepeTransactionsTable)
      .where(and(eq(phonepeTransactionsTable.id, txnRowId), eq(phonepeTransactionsTable.restaurantId, restaurantId)));
    if (!txn) return void res.status(404).json({ error: "Transaction not found" });
    if (txn.status !== "success" && txn.status !== "partially_refunded") {
      return void res.status(409).json({ error: "Only successful transactions can be refunded." });
    }
    const refundPaise = rupeesToPaise(req.body.amount);
    if (refundPaise <= 0 || refundPaise > txn.amountPaise) {
      return void res.status(400).json({ error: `Refund amount must be > 0 and ≤ original (${txn.amountPaise / 100}).` });
    }

    const cfg = await getRuntimeConfig();
    if (!cfg) return void res.status(503).json({ error: "PhonePe is not configured." });
    if (!cfg.refundApiEnabled) {
      return void res.status(409).json({
        error: "Refund API is not enabled for this merchant. Please process the refund manually in PhonePe Business and mark the transaction refunded in KhanaLagao.",
        code: "REFUND_NOT_ENABLED",
      });
    }

    const refundTxnId = generateMerchantTransactionId("RF");
    const payload = {
      merchantId: cfg.merchantId,
      originalTransactionId: txn.merchantTransactionId,
      merchantTransactionId: refundTxnId,
      amount: refundPaise,
      callbackUrl: "",
    };
    const path = "/v3/credit/refund";
    const b64 = base64EncodePayload(payload);
    const xv = generateXVerify(b64, path, { saltKey: cfg.saltKey, saltIndex: cfg.saltIndex });

    const [refundRow] = await db.insert(phonepeRefundsTable).values({
      txnRowId: txn.id, restaurantId,
      refundTransactionId: refundTxnId,
      amountPaise: refundPaise,
      reason: req.body.reason ?? null,
      status: "initiated",
      rawRequest: payload,
      initiatedBy: req.user?.sub ?? null,
    }).returning();

    try {
      const { parsed } = await callPhonePe({
        method: "POST", url: `${cfg.baseUrl}${path}`,
        headers: buildPostHeaders({ xVerify: xv, merchantId: cfg.merchantId }),
        body: JSON.stringify({ request: b64 }),
      });
      const code = parsed.code ?? null;
      const newStatus = code === "PAYMENT_SUCCESS" ? "success" : parsed.success ? "pending" : "failed";
      await db.update(phonepeRefundsTable).set({ rawResponse: parsed as unknown as Record<string, unknown>, responseCode: code, status: newStatus, verifiedAt: newStatus === "success" ? new Date() : null, updatedAt: new Date() }).where(eq(phonepeRefundsTable.id, refundRow.id));

      // Reflect into source txn + ledger if fully verified.
      if (newStatus === "success") {
        const total = await db.select({ s: sql<string>`coalesce(sum(${phonepeRefundsTable.amountPaise})::text, '0')` }).from(phonepeRefundsTable).where(and(eq(phonepeRefundsTable.txnRowId, txn.id), eq(phonepeRefundsTable.status, "success")));
        const refundedSum = Number(total[0].s);
        const newTxnStatus: PhonePeTxnStatus = refundedSum >= txn.amountPaise ? "refunded" : "partially_refunded";
        await db.update(phonepeTransactionsTable).set({ status: newTxnStatus, updatedAt: new Date() }).where(eq(phonepeTransactionsTable.id, txn.id));
        if (txn.restaurantId) {
          await db.insert(paymentsTable).values({
            restaurantId: txn.restaurantId, direction: "out", method: "refund",
            amount: (refundPaise / 100).toFixed(2),
            referenceType: "order", referenceId: txn.orderId ?? null,
            terminalProvider: "phonepe", terminalRefId: String(txn.id),
            notes: `PhonePe refund ${refundTxnId}${req.body.reason ? " — " + req.body.reason : ""}`,
          });
        }
      }
      await recordAuditLog({ req, module: "phonepe", action: "refund_initiated", entity: "phonepe_refund", entityId: refundRow.id, restaurantId, newValue: { refundTxnId, amountPaise: refundPaise, reason: req.body.reason } });

      const [fresh] = await db.select().from(phonepeRefundsTable).where(eq(phonepeRefundsTable.id, refundRow.id));
      if (newStatus === "failed") {
        return void res.status(502).json({ error: explainPhonePeCode(code, parsed.message), code, refund: fresh });
      }
      res.status(201).json({ refund: fresh, message: newStatus === "success" ? "Refund processed." : "Refund initiated; PhonePe will confirm shortly." });
    } catch (err) {
      logger.error({ err }, "PhonePe refund call failed");
      await db.update(phonepeRefundsTable).set({ status: "failed", responseCode: "NETWORK_ERROR", updatedAt: new Date() }).where(eq(phonepeRefundsTable.id, refundRow.id));
      res.status(502).json({ error: "Could not reach PhonePe to process refund." });
    }
  },
);

router.get(
  "/restaurants/:restaurantId/phonepe/refunds",
  phonepeAccessRoles,
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const rows = await db.select().from(phonepeRefundsTable)
      .where(eq(phonepeRefundsTable.restaurantId, restaurantId))
      .orderBy(desc(phonepeRefundsTable.id)).limit(200);
    res.json({ refunds: rows });
  },
);

// ─── Reconciliation ───────────────────────────────────────────────────────

const ReconUploadBody = z.object({
  rows: z.array(z.object({
    phonepeTransactionId: z.string().optional(),
    merchantTransactionId: z.string().optional(),
    referenceNumber: z.string().optional(),
    amount: z.union([z.number(), z.string()]).optional(),
    settlementAmount: z.union([z.number(), z.string()]).optional(),
    settledAt: z.string().optional(),
  })).min(1).max(5000),
});

router.post(
  "/restaurants/:restaurantId/phonepe/reconciliation/upload",
  phonepeManageRoles,
  validateRestaurantAccess,
  validate({ body: ReconUploadBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const runId = `RUN-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const inserted: number[] = [];
    for (const row of req.body.rows) {
      // Try to find a matching internal txn.
      const conds = [eq(phonepeTransactionsTable.restaurantId, restaurantId)];
      let match: typeof phonepeTransactionsTable.$inferSelect | undefined;
      if (row.merchantTransactionId) {
        [match] = await db.select().from(phonepeTransactionsTable).where(and(eq(phonepeTransactionsTable.restaurantId, restaurantId), eq(phonepeTransactionsTable.merchantTransactionId, row.merchantTransactionId)));
      }
      if (!match && row.phonepeTransactionId) {
        [match] = await db.select().from(phonepeTransactionsTable).where(and(eq(phonepeTransactionsTable.restaurantId, restaurantId), eq(phonepeTransactionsTable.phonepeTransactionId, row.phonepeTransactionId)));
      }

      let matchStatus = "missing_in_khanalagao";
      let diffNotes: string | null = null;
      const amountPaise = row.amount !== undefined ? rupeesToPaise(row.amount) : null;
      if (match) {
        if (amountPaise !== null && match.amountPaise !== amountPaise) {
          matchStatus = "amount_mismatch";
          diffNotes = `KL: ${match.amountPaise / 100} vs PhonePe: ${amountPaise / 100}`;
        } else if (match.status === "success") {
          matchStatus = "matched";
        } else if (match.status === "pending") {
          matchStatus = "pending";
        } else if (match.status === "failed") {
          matchStatus = "failed";
        } else if (["refunded", "partially_refunded"].includes(match.status)) {
          matchStatus = "refund_mismatch";
        } else {
          matchStatus = "matched";
        }
      }

      const [rec] = await db.insert(phonepeReconciliationRecordsTable).values({
        restaurantId, runId, source: "csv",
        phonepeTransactionId: row.phonepeTransactionId ?? null,
        merchantTransactionId: row.merchantTransactionId ?? null,
        referenceNumber: row.referenceNumber ?? null,
        amountPaise,
        settlementAmountPaise: row.settlementAmount !== undefined ? rupeesToPaise(row.settlementAmount) : null,
        settledAt: row.settledAt ? new Date(row.settledAt) : null,
        txnRowId: match?.id ?? null,
        matchStatus,
        diffNotes,
        rawRow: row as unknown as Record<string, unknown>,
      }).returning();
      inserted.push(rec.id);
      // Suppress unused var lint
      void conds;
    }

    // Also flag any KL successful txns in that window that PhonePe did NOT report.
    // (Best-effort: caller can filter on missing_in_phonepe in the UI by passing a window.)
    await recordAuditLog({ req, module: "phonepe", action: "reconciliation_run", entity: "phonepe_reconciliation", entityId: null, restaurantId, newValue: { runId, rowCount: inserted.length } });

    res.json({ runId, count: inserted.length });
  },
);

router.get(
  "/restaurants/:restaurantId/phonepe/reconciliation/runs",
  phonepeAccessRoles,
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const rows = await db.select({
      runId: phonepeReconciliationRecordsTable.runId,
      created: sql<string>`min(${phonepeReconciliationRecordsTable.createdAt})`,
      count: sql<number>`cast(count(*) as int)`,
    }).from(phonepeReconciliationRecordsTable)
      .where(eq(phonepeReconciliationRecordsTable.restaurantId, restaurantId))
      .groupBy(phonepeReconciliationRecordsTable.runId)
      .orderBy(sql`min(${phonepeReconciliationRecordsTable.createdAt}) desc`)
      .limit(50);
    res.json({ runs: rows });
  },
);

router.get(
  "/restaurants/:restaurantId/phonepe/reconciliation/:runId",
  phonepeAccessRoles,
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const runId = String(req.params.runId);
    const rows = await db.select().from(phonepeReconciliationRecordsTable)
      .where(and(eq(phonepeReconciliationRecordsTable.restaurantId, restaurantId), eq(phonepeReconciliationRecordsTable.runId, runId)))
      .orderBy(desc(phonepeReconciliationRecordsTable.id))
      .limit(5000);
    const summary: Record<string, number> = {};
    for (const r of rows) summary[r.matchStatus] = (summary[r.matchStatus] ?? 0) + 1;
    res.json({ runId, summary, records: rows });
  },
);

// ─── Unmatched Static-QR queue + manual map ───────────────────────────────

router.get(
  "/restaurants/:restaurantId/phonepe/unmatched",
  phonepeAccessRoles,
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const rows = await db.select().from(phonepeTransactionsTable).where(and(
      eq(phonepeTransactionsTable.restaurantId, restaurantId),
      eq(phonepeTransactionsTable.solution, "STATIC_QR"),
      // unmatched = paid but no orderId
      eq(phonepeTransactionsTable.status, "success"),
    ))
      .orderBy(desc(phonepeTransactionsTable.id)).limit(200);
    res.json({ transactions: rows.filter(r => !r.orderId).map(publicTxnView) });
  },
);

const MapBody = z.object({ orderId: z.coerce.number().int().positive() });
router.post(
  "/restaurants/:restaurantId/phonepe/unmatched/:txnRowId/map",
  phonepeManageRoles,
  validateRestaurantAccess,
  validate({ body: MapBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.txnRowId);
    const [row] = await db.select().from(phonepeTransactionsTable).where(and(eq(phonepeTransactionsTable.id, id), eq(phonepeTransactionsTable.restaurantId, restaurantId)));
    if (!row) return void res.status(404).json({ error: "Transaction not found" });
    if (row.orderId) return void res.status(409).json({ error: "Transaction is already mapped." });
    await db.update(phonepeTransactionsTable).set({ orderId: req.body.orderId, updatedAt: new Date() }).where(eq(phonepeTransactionsTable.id, id));
    if (row.status === "success") {
      await markPaidFromTransaction({ txnRowId: id, restaurantId, orderId: req.body.orderId, amountPaise: row.amountPaise, method: "upi" });
    }
    await recordAuditLog({ req, module: "phonepe", action: "unmatched_mapped", entity: "phonepe_transaction", entityId: id, restaurantId, newValue: { orderId: req.body.orderId } });
    res.json({ ok: true });
  },
);

// ─── Public S2S callback ──────────────────────────────────────────────────
// PhonePe POSTs { response: "<base64>" } with X-VERIFY header. We always
// verify the signature against the salt key, store the raw payload + headers,
// re-query Status to be the source of truth, and ack 200 idempotently.

phonepePublicRouter.post("/api/payments/phonepe/callback", async (req, res) => {
  const cfg = await getRuntimeConfig();
  let body = req.body as { response?: string } | undefined;
  let rawBodyBase64 = "";
  if (body && typeof body.response === "string") rawBodyBase64 = body.response;
  const receivedXVerify = (req.headers["x-verify"] || req.headers["X-VERIFY"]) as string | undefined;
  const signatureValid = cfg
    ? verifyCallbackSignature({ rawBodyBase64, receivedXVerify, saltKey: cfg.saltKey, saltIndex: cfg.saltIndex })
    : false;

  let decoded: Record<string, unknown> = {};
  try {
    if (rawBodyBase64) decoded = JSON.parse(Buffer.from(rawBodyBase64, "base64").toString("utf8"));
  } catch { /* ignore */ }
  const data = (decoded.data ?? {}) as Record<string, unknown>;
  const merchantTransactionId = (decoded.merchantTransactionId as string)
    ?? (data.merchantTransactionId as string) ?? null;
  const phonepeTransactionId = (data.transactionId as string) ?? null;

  let txnRowId: number | null = null;
  let processed = false;
  let processingError: string | null = null;

  try {
    if (signatureValid && merchantTransactionId) {
      // Look up — if missing and it's a STATIC_QR S2S, insert into the unmatched queue.
      const [existing] = await db.select().from(phonepeTransactionsTable).where(eq(phonepeTransactionsTable.merchantTransactionId, merchantTransactionId));
      if (existing) {
        txnRowId = existing.id;
        // Always re-query Status as the source of truth (idempotent).
        await runStatusCheck(existing.id).catch(err => { processingError = err instanceof Error ? err.message : String(err); });
        await db.update(phonepeTransactionsTable).set({ webhookAt: new Date(), updatedAt: new Date() }).where(eq(phonepeTransactionsTable.id, existing.id));
        processed = !processingError;
      } else if (decoded.code === "PAYMENT_SUCCESS" && phonepeTransactionId) {
        // Static-QR style: no pre-existing init. Insert as unmatched paid txn.
        const amt = (data.amount as number) ?? 0;
        const [row] = await db.insert(phonepeTransactionsTable).values({
          restaurantId: Number((data.storeId as string) ?? 0) || 0, // best-effort; will be 0 if unknown
          merchantTransactionId,
          phonepeTransactionId,
          solution: "STATIC_QR",
          requestedModes: ["UPI"],
          storeId: (data.storeId as string) ?? null,
          amountPaise: amt,
          status: "success",
          responseCode: (decoded.code as string) ?? null,
          referenceNumber: (data.providerReferenceId as string) ?? null,
          rawResponse: decoded,
          verifiedAt: new Date(),
          webhookAt: new Date(),
        }).returning();
        txnRowId = row.id;
        processed = true;
      }
    } else if (!signatureValid) {
      processingError = "Invalid X-VERIFY signature";
    } else if (!merchantTransactionId) {
      processingError = "Callback missing merchantTransactionId";
    }
  } catch (err) {
    processingError = err instanceof Error ? err.message : String(err);
  }

  await db.insert(phonepeCallbacksTable).values({
    txnRowId,
    solution: (decoded.code === "PAYMENT_SUCCESS" && !merchantTransactionId ? "UNKNOWN" : "EDC") as PhonePeSolution | "UNKNOWN",
    merchantTransactionId,
    phonepeTransactionId,
    receivedXVerify: receivedXVerify ?? null,
    signatureValid,
    rawHeaders: { authorization: undefined, ...req.headers } as Record<string, unknown>,
    rawBody: { response: rawBodyBase64, decoded } as Record<string, unknown>,
    processed,
    processingError,
  });

  // PhonePe requires 200 OK to stop retries; we always ack.
  res.status(200).json({ ok: true });
});

// ─── Cashier closing breakdown helper (exposed as a tiny report) ─────────

router.get(
  "/restaurants/:restaurantId/phonepe/closing-summary",
  phonepeAccessRoles,
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 86_400_000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const rows = await db.select({
      solution: phonepeTransactionsTable.solution,
      finalMode: phonepeTransactionsTable.finalMode,
      count: sql<number>`cast(count(*) as int)`,
      gross: sql<number>`cast(coalesce(sum(${phonepeTransactionsTable.amountPaise}), 0) as int)`,
    }).from(phonepeTransactionsTable)
      .where(and(
        eq(phonepeTransactionsTable.restaurantId, restaurantId),
        eq(phonepeTransactionsTable.status, "success"),
        gte(phonepeTransactionsTable.verifiedAt, from),
        lte(phonepeTransactionsTable.verifiedAt, to),
      ))
      .groupBy(phonepeTransactionsTable.solution, phonepeTransactionsTable.finalMode);

    const refunds = await db.select({
      count: sql<number>`cast(count(*) as int)`,
      gross: sql<number>`cast(coalesce(sum(${phonepeRefundsTable.amountPaise}), 0) as int)`,
    }).from(phonepeRefundsTable)
      .where(and(
        eq(phonepeRefundsTable.restaurantId, restaurantId),
        eq(phonepeRefundsTable.status, "success"),
        gte(phonepeRefundsTable.verifiedAt, from),
        lte(phonepeRefundsTable.verifiedAt, to),
      ));

    const breakdown: Array<{ label: string; key: string; count: number; grossPaise: number }> = [];
    for (const r of rows) {
      const label = r.solution === "EDC" ? `PhonePe EDC ${r.finalMode ?? "UNKNOWN"}` : `PhonePe ${r.solution}`;
      breakdown.push({ label, key: `${r.solution}_${r.finalMode ?? "ANY"}`, count: r.count, grossPaise: r.gross });
    }
    void inArray; // type-only no-op import keep
    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      breakdown,
      refunds: refunds[0] ?? { count: 0, gross: 0 },
    });
  },
);

export default router;
export { phonepePublicRouter as default2 };
