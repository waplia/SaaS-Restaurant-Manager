/**
 * Physical card terminal endpoints (Task #420).
 *
 * Surface:
 *   GET    /restaurants/:r/terminals                  → list paired terminals
 *   GET    /restaurants/:r/terminals/providers        → provider config status
 *   POST   /restaurants/:r/terminals/pair             → pair a new terminal
 *   POST   /restaurants/:r/terminals/:id/unpair       → unpair (soft-delete)
 *   POST   /restaurants/:r/terminals/connection-token → Stripe Terminal token
 *   POST   /restaurants/:r/terminals/:id/charge       → start card-present PI
 *   POST   /restaurants/:r/terminals/:id/refund       → refund a prior charge
 *   GET    /restaurants/:r/terminals/payments-by-device → device-wise report
 */
import { Router } from "express";
import { and, eq, isNull, gte, lte, sql, desc } from "drizzle-orm";
import {
  db, devicesTable, paymentsTable, ordersTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { validate } from "../middleware/validate";
import { z } from "zod";
import { recordAuditLog } from "../lib/audit";
import {
  getTerminalProvider, isTerminalProviderId, listTerminalProviders,
  type TerminalProviderId,
} from "../lib/terminalProviders";
import { generateRegistrationToken, setDeviceStatus } from "../lib/devices";
import Stripe from "stripe";

const router = Router();

// All terminal endpoints are tenant-scoped + plan-gated + role-gated.
router.use(
  "/restaurants/:restaurantId/terminals",
  requireRole("owner", "manager", "cashier", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("card_terminal"),
);

// Pairing / unpairing / refunds are management actions — owner/manager only.
const WRITE_ROLES = ["owner", "manager", "super_admin"] as const;
function canWrite(role: string | undefined, isSuper: boolean | undefined): boolean {
  return Boolean(isSuper || (role && (WRITE_ROLES as readonly string[]).includes(role)));
}
// Charging a card at POS is a cashier action — they need to run charge,
// drive the reader, and confirm the resulting payment.
const CHARGE_ROLES = ["owner", "manager", "cashier", "super_admin"] as const;
function canCharge(role: string | undefined, isSuper: boolean | undefined): boolean {
  return Boolean(isSuper || (role && (CHARGE_ROLES as readonly string[]).includes(role)));
}

interface TerminalMeta {
  provider?: TerminalProviderId;
  externalId?: string | null;
  serial?: string | null;
  model?: string | null;
}

function readMeta(metadata: unknown): TerminalMeta {
  if (metadata && typeof metadata === "object") return metadata as TerminalMeta;
  return {};
}

// ─── Providers list ──────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/terminals/providers", async (_req, res) => {
  res.json({ providers: listTerminalProviders() });
});

// ─── List paired terminals ───────────────────────────────────────────────
router.get("/restaurants/:restaurantId/terminals", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(devicesTable)
    .where(and(
      eq(devicesTable.restaurantId, restaurantId),
      eq(devicesTable.type, "card_terminal"),
      isNull(devicesTable.deletedAt),
    ))
    .orderBy(desc(devicesTable.createdAt));
  res.json(rows.map(r => ({ ...r, terminal: readMeta(r.metadata) })));
});

// ─── Pair ────────────────────────────────────────────────────────────────
const PairBody = z.object({
  name: z.string().min(1).max(120),
  provider: z.enum(["stripe", "square", "clover", "custom"]),
  externalId: z.string().max(200).nullable().optional(),
  branchId: z.coerce.number().int().positive().nullable().optional(),
  serial: z.string().max(120).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
});

router.post(
  "/restaurants/:restaurantId/terminals/pair",
  validate({ body: PairBody }),
  async (req, res) => {
    if (!canWrite(req.user?.role, req.user?.isSuperAdmin)) {
      return void res.status(403).json({ error: "Insufficient permissions" });
    }
    const restaurantId = Number(req.params.restaurantId);
    const { name, provider, externalId, branchId, serial, model } = req.body as z.infer<typeof PairBody>;

    if (!isTerminalProviderId(provider)) {
      return void res.status(400).json({ error: "invalid provider" });
    }

    const metadata: TerminalMeta = {
      provider,
      externalId: externalId ?? null,
      serial: serial ?? null,
      model: model ?? null,
    };

    const [row] = await db.insert(devicesTable).values({
      restaurantId,
      branchId: branchId ?? null,
      type: "card_terminal",
      name,
      status: "pairing",
      registrationToken: generateRegistrationToken(),
      pairedAt: new Date(),
      metadata: metadata as Record<string, unknown>,
    }).returning();

    await recordAuditLog({
      req, module: "terminals", action: "pair",
      entity: "device", entityId: row.id, restaurantId,
      details: `Paired ${provider} terminal "${name}"`,
      newValue: metadata,
    });

    res.status(201).json({ ...row, terminal: metadata });
  },
);

// ─── Unpair ──────────────────────────────────────────────────────────────
router.post("/restaurants/:restaurantId/terminals/:id/unpair", async (req, res) => {
  if (!canWrite(req.user?.role, req.user?.isSuperAdmin)) {
    return void res.status(403).json({ error: "Insufficient permissions" });
  }
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [device] = await db.select().from(devicesTable)
    .where(and(eq(devicesTable.id, id), eq(devicesTable.restaurantId, restaurantId)));
  if (!device || device.type !== "card_terminal") {
    return void res.status(404).json({ error: "Terminal not found" });
  }
  await db.update(devicesTable).set({
    deletedAt: new Date(),
    status: "offline",
    updatedAt: new Date(),
  }).where(eq(devicesTable.id, id));

  await recordAuditLog({
    req, module: "terminals", action: "unpair",
    entity: "device", entityId: id, restaurantId,
    details: `Unpaired terminal "${device.name}"`,
    oldValue: readMeta(device.metadata),
  });

  res.json({ ok: true });
});

// ─── Stripe Terminal connection token ────────────────────────────────────
router.post("/restaurants/:restaurantId/terminals/connection-token", async (_req, res) => {
  const provider = getTerminalProvider("stripe");
  if (!provider.createConnectionToken) {
    return void res.status(400).json({ error: "provider_unsupported" });
  }
  const result = await provider.createConnectionToken();
  if ("error" in result) {
    return void res.status(503).json({ error: result.error });
  }
  res.json(result);
});

// ─── Charge via terminal ─────────────────────────────────────────────────
const ChargeBody = z.object({
  orderId: z.coerce.number().int().positive(),
  amountMinor: z.coerce.number().int().nonnegative(),
  tipMinor: z.coerce.number().int().nonnegative().optional(),
  currency: z.string().min(3).max(3).default("inr"),
});

router.post(
  "/restaurants/:restaurantId/terminals/:id/charge",
  validate({ body: ChargeBody }),
  async (req, res) => {
    if (!canCharge(req.user?.role, req.user?.isSuperAdmin)) {
      return void res.status(403).json({ error: "Insufficient permissions" });
    }
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { orderId, amountMinor, tipMinor, currency } = req.body as z.infer<typeof ChargeBody>;

    const [device] = await db.select().from(devicesTable)
      .where(and(eq(devicesTable.id, id), eq(devicesTable.restaurantId, restaurantId), isNull(devicesTable.deletedAt)));
    if (!device || device.type !== "card_terminal") {
      return void res.status(404).json({ error: "Terminal not found" });
    }
    const meta = readMeta(device.metadata);
    const providerId = meta.provider ?? "stripe";
    const provider = getTerminalProvider(providerId);

    const result = await provider.charge(
      { deviceId: id, restaurantId, provider: providerId, externalId: meta.externalId ?? null },
      { amountMinor, tipMinor, currency, orderId, metadata: {} },
    );

    if (result.status === "not_configured") {
      return void res.status(503).json({
        error: "Configuration required",
        provider: providerId,
        message: result.message,
      });
    }
    if (result.status === "failed") {
      return void res.status(502).json({ error: result.message ?? "Charge failed" });
    }

    res.json({
      status: result.status,
      providerRef: result.providerRef,
      receiptUrl: result.receiptUrl,
      clientSecret: result.clientSecret ?? null,
      provider: providerId,
      deviceId: id,
    });
  },
);

// ─── Run a PI on an Internet-class reader (WisePOS E, etc.) ──────────────
// Browser SDK readers (Tap-to-Pay / Bluetooth) drive themselves on the client
// — they don't need this endpoint. Internet readers do: this server call
// pushes the PaymentIntent to the physical reader and waits for status.
const RunOnReaderBody = z.object({ providerRef: z.string().min(1) });
router.post(
  "/restaurants/:restaurantId/terminals/:id/run-on-reader",
  validate({ body: RunOnReaderBody }),
  async (req, res) => {
    if (!canCharge(req.user?.role, req.user?.isSuperAdmin)) {
      return void res.status(403).json({ error: "Insufficient permissions" });
    }
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { providerRef } = req.body as z.infer<typeof RunOnReaderBody>;
    const [device] = await db.select().from(devicesTable)
      .where(and(eq(devicesTable.id, id), eq(devicesTable.restaurantId, restaurantId), isNull(devicesTable.deletedAt)));
    if (!device || device.type !== "card_terminal") {
      return void res.status(404).json({ error: "Terminal not found" });
    }
    const meta = readMeta(device.metadata);
    const providerId = meta.provider ?? "stripe";
    const provider = getTerminalProvider(providerId);
    if (!provider.processOnReader) {
      return void res.status(501).json({ error: `Provider ${providerId} does not support server-driven readers` });
    }
    const result = await provider.processOnReader(
      { deviceId: id, restaurantId, provider: providerId, externalId: meta.externalId ?? null },
      providerRef,
    );
    if (result.status === "not_configured") {
      return void res.status(503).json({ error: "Configuration required", provider: providerId, message: result.message });
    }
    if (result.status === "failed") {
      await setDeviceStatus({ deviceId: id, restaurantId, status: "error", reason: result.message ?? "reader_failed" });
      return void res.status(502).json({ error: result.message ?? "Reader failed" });
    }
    res.json({ status: result.status });
  },
);

// ─── Recent terminal payments (for refund picker in Settings) ────────────
router.get("/restaurants/:restaurantId/terminals/:id/recent-payments", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const rows = await db.select({
    id: paymentsTable.id,
    amount: paymentsTable.amount,
    direction: paymentsTable.direction,
    paymentDate: paymentsTable.paymentDate,
    referenceId: paymentsTable.referenceId,
    terminalRefId: paymentsTable.terminalRefId,
    notes: paymentsTable.notes,
  })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.restaurantId, restaurantId),
      eq(paymentsTable.deviceId, id),
    ))
    .orderBy(desc(paymentsTable.paymentDate))
    .limit(25);
  res.json({ data: rows });
});

// ─── Refund via terminal ─────────────────────────────────────────────────
const RefundBody = z.object({
  paymentId: z.coerce.number().int().positive(),
  amountMinor: z.coerce.number().int().positive(),
  reason: z.string().max(200).optional(),
});

router.post(
  "/restaurants/:restaurantId/terminals/:id/refund",
  validate({ body: RefundBody }),
  async (req, res) => {
    if (!canWrite(req.user?.role, req.user?.isSuperAdmin)) {
      return void res.status(403).json({ error: "Insufficient permissions" });
    }
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { paymentId, amountMinor, reason } = req.body as z.infer<typeof RefundBody>;

    const [device] = await db.select().from(devicesTable)
      .where(and(eq(devicesTable.id, id), eq(devicesTable.restaurantId, restaurantId), isNull(devicesTable.deletedAt)));
    if (!device || device.type !== "card_terminal") {
      return void res.status(404).json({ error: "Terminal not found" });
    }
    const meta = readMeta(device.metadata);
    const providerId = meta.provider ?? "stripe";

    // Bind the refund to *this* terminal: the original payment must be tagged
    // with the same deviceId AND provider as the route. Without this, a manager
    // could refund a payment that was processed on a different terminal.
    const [payment] = await db.select().from(paymentsTable)
      .where(and(
        eq(paymentsTable.id, paymentId),
        eq(paymentsTable.restaurantId, restaurantId),
        eq(paymentsTable.deviceId, id),
        eq(paymentsTable.direction, "in"),
      ));
    if (!payment) return void res.status(404).json({ error: "Payment not found on this terminal" });
    if (!payment.terminalRefId) {
      return void res.status(400).json({ error: "Payment has no terminal reference to refund" });
    }
    if (payment.terminalProvider && payment.terminalProvider !== providerId) {
      return void res.status(400).json({ error: "Payment was processed on a different provider" });
    }

    // Compute remaining refundable balance = original − Σ already-refunded for
    // the same providerRef. Refund rows are recorded as direction='out' with
    // the same terminalRefId lineage (terminalRefId on refunds is the Stripe
    // refund id, so we sum rows whose `notes` reference this payment OR whose
    // referenceId/referenceType match). Safest: sum direction='out' rows that
    // share deviceId + referenceType/referenceId AND were tagged on the same
    // original providerRef via notes — but the simplest sound check is to sum
    // all out-direction rows that reference the same original payment.
    const priorRefunds = await db.select({
      total: sql<string>`cast(coalesce(sum(${paymentsTable.amount}), 0) as text)`,
    }).from(paymentsTable)
      .where(and(
        eq(paymentsTable.restaurantId, restaurantId),
        eq(paymentsTable.deviceId, id),
        eq(paymentsTable.direction, "out"),
        sql`${paymentsTable.notes} LIKE ${`Terminal refund of payment #${payment.id}%`}`,
      ));
    const refundedSoFarMinor = Math.round(Number(priorRefunds[0]?.total ?? "0") * 100);
    const originalMinor = Math.round(Number(payment.amount) * 100);
    const remainingMinor = originalMinor - refundedSoFarMinor;
    if (remainingMinor <= 0) {
      return void res.status(400).json({ error: "Payment is already fully refunded" });
    }
    if (amountMinor > remainingMinor) {
      return void res.status(400).json({
        error: `Refund exceeds remaining refundable amount (₹${(remainingMinor / 100).toFixed(2)} left)`,
      });
    }

    const provider = getTerminalProvider(providerId);
    const result = await provider.refund(
      { deviceId: id, restaurantId, provider: providerId, externalId: meta.externalId ?? null },
      { providerRef: payment.terminalRefId, amountMinor, reason },
    );

    if (result.status === "not_configured") {
      return void res.status(503).json({ error: "Configuration required", provider: providerId, message: result.message });
    }
    if (result.status === "failed") {
      return void res.status(502).json({ error: result.message ?? "Refund failed" });
    }

    // Record refund as a negative-direction payment with the device tagged
    const [refundRow] = await db.insert(paymentsTable).values({
      restaurantId,
      direction: "out",
      method: "card",
      amount: (amountMinor / 100).toFixed(2),
      paymentDate: new Date(),
      partyType: payment.partyType,
      partyId: payment.partyId,
      partyName: payment.partyName,
      referenceType: payment.referenceType,
      referenceId: payment.referenceId,
      notes: `Terminal refund of payment #${payment.id}${reason ? ` — ${reason}` : ""}`,
      recordedBy: req.user?.sub ?? null,
      deviceId: id,
      terminalProvider: providerId,
      terminalRefId: result.providerRef,
    }).returning();

    await recordAuditLog({
      req, module: "terminals", action: "refund",
      entity: "payment", entityId: payment.id, restaurantId,
      details: `Refunded ₹${(amountMinor / 100).toFixed(2)} on ${providerId} terminal "${device.name}"`,
      newValue: { refundPaymentId: refundRow.id, providerRef: result.providerRef, reason },
    });

    res.status(201).json({ status: result.status, refund: refundRow, providerRef: result.providerRef });
  },
);

// ─── Device-wise payment report ──────────────────────────────────────────
router.get("/restaurants/:restaurantId/terminals/payments-by-device", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = req.query;
  const conditions = [
    eq(paymentsTable.restaurantId, restaurantId),
    sql`${paymentsTable.deviceId} IS NOT NULL`,
  ];
  if (from) conditions.push(gte(paymentsTable.paymentDate, new Date(String(from))));
  if (to) {
    const toDate = new Date(String(to));
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(paymentsTable.paymentDate, toDate));
  }

  const rows = await db.select({
    deviceId: paymentsTable.deviceId,
    terminalProvider: paymentsTable.terminalProvider,
    direction: paymentsTable.direction,
    count: sql<number>`cast(count(*) as int)`,
    total: sql<string>`cast(coalesce(sum(${paymentsTable.amount}), 0) as text)`,
  }).from(paymentsTable).where(and(...conditions))
    .groupBy(paymentsTable.deviceId, paymentsTable.terminalProvider, paymentsTable.direction);

  // Resolve device names
  const ids = [...new Set(rows.map(r => r.deviceId!).filter(Boolean))];
  const devices = ids.length
    ? await db.select({ id: devicesTable.id, name: devicesTable.name, metadata: devicesTable.metadata })
        .from(devicesTable)
        .where(and(eq(devicesTable.restaurantId, restaurantId)))
    : [];
  const nameMap = new Map(devices.map(d => [d.id, { name: d.name, provider: readMeta(d.metadata).provider }]));

  type Bucket = {
    deviceId: number;
    deviceName: string;
    provider: string | null;
    grossIn: number;
    refundsOut: number;
    txCount: number;
    refundCount: number;
  };
  const buckets = new Map<number, Bucket>();
  for (const r of rows) {
    const id = r.deviceId!;
    let b = buckets.get(id);
    if (!b) {
      const m = nameMap.get(id);
      b = {
        deviceId: id,
        deviceName: m?.name ?? `Device #${id}`,
        provider: r.terminalProvider ?? m?.provider ?? null,
        grossIn: 0, refundsOut: 0, txCount: 0, refundCount: 0,
      };
      buckets.set(id, b);
    }
    if (r.direction === "in") { b.grossIn += Number(r.total); b.txCount += r.count; }
    else { b.refundsOut += Number(r.total); b.refundCount += r.count; }
  }

  const report = [...buckets.values()].map(b => ({
    ...b,
    grossIn: b.grossIn.toFixed(2),
    refundsOut: b.refundsOut.toFixed(2),
    net: (b.grossIn - b.refundsOut).toFixed(2),
  }));

  res.json({ data: report.sort((a, b) => Number(b.net) - Number(a.net)) });
});

// ─── Confirm a terminal charge ───────────────────────────────────────────
//
// This is the **sole** finalizer for terminal payments — the POS terminal flow
// never falls back to /orders/:id/pay. The endpoint:
//   1. Verifies the providerRef against the upstream provider (Stripe → fetches
//      the PaymentIntent, checks status === "succeeded", amount and metadata
//      match the request). Stub providers are rejected outright.
//   2. Refuses duplicates (a payment row with the same terminalRefId already
//      exists for this restaurant).
//   3. Inserts the payment ledger row and marks the order paid/partial.
//
// Without (1), a client could POST any string as `providerRef` and mark an
// order paid for free.
const ConfirmBody = z.object({
  orderId: z.coerce.number().int().positive(),
  providerRef: z.string().min(1),
  amountMinor: z.coerce.number().int().positive(),
  tipMinor: z.coerce.number().int().nonnegative().optional(),
  receiptUrl: z.string().url().nullable().optional(),
});

router.post(
  "/restaurants/:restaurantId/terminals/:id/confirm",
  validate({ body: ConfirmBody }),
  async (req, res) => {
    if (!canCharge(req.user?.role, req.user?.isSuperAdmin)) {
      return void res.status(403).json({ error: "Insufficient permissions" });
    }
    const restaurantId = Number(req.params.restaurantId);
    const deviceId = Number(req.params.id);
    const { orderId, providerRef, amountMinor, tipMinor, receiptUrl: clientReceiptUrl } =
      req.body as z.infer<typeof ConfirmBody>;
    const totalMinor = amountMinor + (tipMinor ?? 0);

    const [device] = await db.select().from(devicesTable)
      .where(and(eq(devicesTable.id, deviceId), eq(devicesTable.restaurantId, restaurantId), isNull(devicesTable.deletedAt)));
    if (!device || device.type !== "card_terminal") {
      return void res.status(404).json({ error: "Terminal not found" });
    }
    const meta = readMeta(device.metadata);
    const providerId = meta.provider ?? "stripe";

    const [order] = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
    if (!order) return void res.status(404).json({ error: "Order not found" });

    // Refuse duplicate confirms — same terminalRefId already finalized.
    const [existing] = await db.select({ id: paymentsTable.id }).from(paymentsTable)
      .where(and(
        eq(paymentsTable.restaurantId, restaurantId),
        eq(paymentsTable.terminalRefId, providerRef),
        eq(paymentsTable.direction, "in"),
      ));
    if (existing) {
      return void res.status(409).json({ error: "This payment has already been confirmed", paymentId: existing.id });
    }

    // ── Provider-side verification ────────────────────────────────────
    let verifiedAmountMinor = totalMinor;
    let verifiedReceiptUrl: string | null = clientReceiptUrl ?? null;
    if (providerId === "stripe") {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) return void res.status(503).json({ error: "Stripe not configured on server" });
      try {
        const stripe = new Stripe(key);
        const intent = await stripe.paymentIntents.retrieve(providerRef, { expand: ["latest_charge"] });
        if (intent.status !== "succeeded") {
          return void res.status(400).json({ error: `PaymentIntent not succeeded (status=${intent.status})` });
        }
        // Require the metadata we wrote at /charge time — this proves the PI
        // was originated by *this* terminal flow for *this* tenant + order
        // + device. Without strict checks, a legitimate but unrelated PI
        // (e.g. an online card payment) could be used to mark any order paid.
        const piRestaurant = intent.metadata?.restaurantId;
        const piOrder = intent.metadata?.orderId;
        const piDevice = intent.metadata?.terminalDeviceId;
        if (!piRestaurant || !piOrder || !piDevice) {
          return void res.status(403).json({
            error: "PaymentIntent is missing required terminal metadata (restaurantId/orderId/terminalDeviceId)",
          });
        }
        if (piRestaurant !== String(restaurantId)) {
          return void res.status(403).json({ error: "PaymentIntent belongs to a different restaurant" });
        }
        if (piOrder !== String(orderId)) {
          return void res.status(403).json({ error: "PaymentIntent is for a different order" });
        }
        if (piDevice !== String(deviceId)) {
          return void res.status(403).json({ error: "PaymentIntent was created on a different terminal" });
        }
        // Enforce card-present provenance — refuses online or other PI types.
        const types = intent.payment_method_types ?? [];
        if (!types.includes("card_present")) {
          return void res.status(403).json({ error: "PaymentIntent is not a card-present terminal charge" });
        }
        // Trust the provider's amount over the client-supplied one.
        verifiedAmountMinor = intent.amount_received || intent.amount;
        const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
        verifiedReceiptUrl = charge?.receipt_url ?? clientReceiptUrl ?? null;
      } catch (e) {
        return void res.status(502).json({ error: e instanceof Error ? e.message : "Failed to verify with Stripe" });
      }
    } else {
      // Stub providers cannot produce a real charge, so /confirm is rejected
      // until the provider implementation lands.
      return void res.status(503).json({ error: "Configuration required", provider: providerId });
    }

    const [payment] = await db.insert(paymentsTable).values({
      restaurantId,
      direction: "in",
      method: "card",
      amount: (verifiedAmountMinor / 100).toFixed(2),
      paymentDate: new Date(),
      partyType: order.customerId ? "customer" : "other",
      partyId: order.customerId ?? null,
      partyName: order.customerName ?? null,
      referenceType: "order",
      referenceId: order.id,
      notes: verifiedReceiptUrl ? `Terminal receipt: ${verifiedReceiptUrl}` : `Terminal payment via ${device.name}`,
      recordedBy: req.user?.sub ?? null,
      deviceId,
      terminalProvider: providerId,
      terminalRefId: providerRef,
    }).returning();

    const orderTotalMinor = Math.round(Number(order.totalAmount) * 100);
    const fullyPaid = verifiedAmountMinor >= orderTotalMinor;
    await db.update(ordersTable).set({
      paymentStatus: fullyPaid ? "paid" : "partial",
      paymentMethod: "card",
      status: fullyPaid && order.status !== "cancelled" ? "completed" : order.status,
      stripePaymentId: providerRef,
      updatedAt: new Date(),
    }).where(eq(ordersTable.id, order.id));

    await setDeviceStatus({ deviceId, restaurantId, status: "online", reason: "terminal_charge" });

    await recordAuditLog({
      req, module: "terminals", action: "charge",
      entity: "payment", entityId: payment.id, restaurantId,
      details: `Terminal charge ₹${(verifiedAmountMinor / 100).toFixed(2)} on ${providerId} (${device.name})`,
      newValue: { orderId, providerRef, amountMinor: verifiedAmountMinor },
    });

    res.status(201).json({ payment, receiptUrl: verifiedReceiptUrl, fullyPaid });
  },
);

export default router;
