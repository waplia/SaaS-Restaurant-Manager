/**
 * Physical card terminal provider abstraction (Task #420).
 *
 * The platform exposes one HTTP surface for accepting card-present payments
 * regardless of which terminal vendor a restaurant uses. Each provider
 * implements the same contract; only Stripe is wired to a real SDK today —
 * Square / Clover / Custom return a structured `not_configured` response so
 * the UI can render the "Configuration required" empty state without crashing.
 */
import Stripe from "stripe";

export type TerminalProviderId = "stripe" | "square" | "clover" | "phonepe" | "custom";

export const TERMINAL_PROVIDERS: TerminalProviderId[] = ["stripe", "square", "clover", "phonepe", "custom"];

export interface TerminalDeviceRef {
  deviceId: number;
  restaurantId: number;
  provider: TerminalProviderId;
  /** Provider-specific reader/terminal identifier persisted in device.metadata. */
  externalId: string | null;
}

export interface ChargeRequest {
  amountMinor: number;
  currency: string;
  tipMinor?: number;
  orderId?: number;
  metadata?: Record<string, string>;
}

export interface ChargeResult {
  status: "succeeded" | "pending" | "failed" | "not_configured";
  providerRef: string | null;
  receiptUrl: string | null;
  /** Stripe-only: PI client_secret for browser SDK (Tap-to-Pay / Bluetooth). */
  clientSecret?: string | null;
  message?: string;
}

export interface ProcessOnReaderResult {
  status: "succeeded" | "pending" | "failed" | "not_configured";
  message?: string;
}

export interface RefundRequest {
  providerRef: string;
  amountMinor: number;
  reason?: string;
}

export interface RefundResult {
  status: "succeeded" | "pending" | "failed" | "not_configured";
  providerRef: string | null;
  message?: string;
}

export interface TerminalProvider {
  id: TerminalProviderId;
  label: string;
  isConfigured(): boolean;
  /** Stripe-only: returns a short-lived connection token for the JS SDK. */
  createConnectionToken?(): Promise<{ secret: string } | { error: string }>;
  charge(device: TerminalDeviceRef, req: ChargeRequest): Promise<ChargeResult>;
  refund(device: TerminalDeviceRef, req: RefundRequest): Promise<RefundResult>;
  /** Drive an Internet-class reader (e.g. WisePOS E) to process a PI it was issued.
   *  Implementations should also poll the upstream resource until terminal state is
   *  resolved or the timeout is reached. */
  processOnReader?(device: TerminalDeviceRef, providerRef: string, timeoutMs?: number): Promise<ProcessOnReaderResult>;
}

// ─── Stripe Terminal (real) ──────────────────────────────────────────────
const stripeProvider: TerminalProvider = {
  id: "stripe",
  label: "Stripe Terminal",
  isConfigured() {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  },
  async createConnectionToken() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return { error: "stripe_not_configured" };
    try {
      const stripe = new Stripe(key);
      const token = await stripe.terminal.connectionTokens.create();
      return { secret: token.secret };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "failed_to_create_token" };
    }
  },
  async charge(device, req) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      return { status: "not_configured", providerRef: null, receiptUrl: null, message: "STRIPE_SECRET_KEY not set" };
    }
    try {
      const stripe = new Stripe(key);
      const amount = req.amountMinor + (req.tipMinor ?? 0);
      const intent = await stripe.paymentIntents.create({
        amount,
        currency: req.currency.toLowerCase(),
        payment_method_types: ["card_present"],
        capture_method: "automatic",
        metadata: {
          ...(req.metadata ?? {}),
          terminalDeviceId: String(device.deviceId),
          restaurantId: String(device.restaurantId),
          ...(req.orderId ? { orderId: String(req.orderId) } : {}),
        },
      });
      // The reader (Internet-class) is driven by `processOnReader` below;
      // browser SDKs (Tap-to-Pay / Bluetooth) consume `clientSecret` directly.
      return { status: "pending", providerRef: intent.id, receiptUrl: null, clientSecret: intent.client_secret };
    } catch (e) {
      return { status: "failed", providerRef: null, receiptUrl: null, message: e instanceof Error ? e.message : "charge_failed" };
    }
  },
  async processOnReader(device, providerRef, timeoutMs = 60_000) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return { status: "not_configured", message: "STRIPE_SECRET_KEY not set" };
    if (!device.externalId) return { status: "failed", message: "Reader has no Stripe reader id (tmr_…) on its pairing" };
    try {
      const stripe = new Stripe(key);
      // Tell the physical reader to process the given PI. The reader prompts the
      // customer to tap/insert — fails fast if the reader is offline or busy.
      await stripe.terminal.readers.processPaymentIntent(device.externalId, { payment_intent: providerRef });

      // Poll PI status until succeeded / failed / timeout.
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const pi = await stripe.paymentIntents.retrieve(providerRef);
        if (pi.status === "succeeded") return { status: "succeeded" };
        if (pi.status === "canceled" || pi.status === "requires_payment_method") {
          return { status: "failed", message: `Reader returned status ${pi.status}` };
        }
        await new Promise(r => setTimeout(r, 1500));
      }
      return { status: "pending", message: "Reader did not finish within timeout" };
    } catch (e) {
      return { status: "failed", message: e instanceof Error ? e.message : "process_on_reader_failed" };
    }
  },
  async refund(_device, req) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      return { status: "not_configured", providerRef: null, message: "STRIPE_SECRET_KEY not set" };
    }
    try {
      const stripe = new Stripe(key);
      const refund = await stripe.refunds.create({
        payment_intent: req.providerRef,
        amount: req.amountMinor,
        reason: req.reason === "fraudulent" || req.reason === "duplicate" ? req.reason : undefined,
      });
      return { status: refund.status === "succeeded" ? "succeeded" : "pending", providerRef: refund.id };
    } catch (e) {
      return { status: "failed", providerRef: null, message: e instanceof Error ? e.message : "refund_failed" };
    }
  },
};

// ─── Stub providers ──────────────────────────────────────────────────────
function makeStub(id: TerminalProviderId, label: string, envHint: string): TerminalProvider {
  return {
    id,
    label,
    isConfigured() {
      // Stubs are intentionally never "configured" — the UI shows the
      // "Configuration required" state until a real implementation lands.
      return false;
    },
    async charge() {
      return {
        status: "not_configured",
        providerRef: null,
        receiptUrl: null,
        message: `${label} integration is a stub. Set ${envHint} and implement provider to enable.`,
      };
    },
    async refund() {
      return {
        status: "not_configured",
        providerRef: null,
        message: `${label} integration is a stub. Set ${envHint} and implement provider to enable.`,
      };
    },
  };
}

const squareProvider = makeStub("square", "Square Terminal", "SQUARE_ACCESS_TOKEN");
const cloverProvider = makeStub("clover", "Clover", "CLOVER_API_TOKEN");
const customProvider = makeStub("custom", "Custom / Webhook", "CUSTOM_TERMINAL_WEBHOOK_URL");

// PhonePe Offline — a real provider but configured via Super Admin → Provider
// Center (db-backed config + per-restaurant store/terminal mapping rows),
// not via env vars. The actual charge/refund flow runs through the dedicated
// /api/payments/phonepe/* routes; this adapter entry exists so the terminal
// registry is aware of PhonePe for listing + future polymorphic charging.
const phonepeProvider: TerminalProvider = {
  id: "phonepe",
  label: "PhonePe Offline",
  isConfigured() {
    // Truthful runtime check would hit the DB; the registry call sites accept
    // a synchronous answer, so we report `false` here and the dedicated
    // /api/payments/phonepe/config endpoint exposes the real status.
    return false;
  },
  async charge() {
    return {
      status: "not_configured",
      providerRef: null,
      receiptUrl: null,
      message: "Use the PhonePe Offline endpoints under /api/payments/phonepe/*.",
    };
  },
  async refund() {
    return {
      status: "not_configured",
      providerRef: null,
      message: "Refund PhonePe payments via /api/payments/phonepe/refund.",
    };
  },
};

const REGISTRY: Record<TerminalProviderId, TerminalProvider> = {
  stripe: stripeProvider,
  square: squareProvider,
  clover: cloverProvider,
  phonepe: phonepeProvider,
  custom: customProvider,
};

export function getTerminalProvider(id: TerminalProviderId): TerminalProvider {
  return REGISTRY[id];
}

export function isTerminalProviderId(v: unknown): v is TerminalProviderId {
  return typeof v === "string" && (TERMINAL_PROVIDERS as string[]).includes(v);
}

export function listTerminalProviders(): Array<{ id: TerminalProviderId; label: string; configured: boolean }> {
  return TERMINAL_PROVIDERS.map((id) => ({
    id,
    label: REGISTRY[id].label,
    configured: REGISTRY[id].isConfigured(),
  }));
}
