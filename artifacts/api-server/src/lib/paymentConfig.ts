/**
 * Task #587 — Helpers for the per-restaurant Offline/Online payment refactor.
 *
 * Provides:
 *   - getPaymentConfig(restaurantId) — returns the full settings + methods +
 *     manual UPI shape used by the admin UI.
 *   - getCheckoutOptions(restaurantId) — returns ONLY the two top-level
 *     choices the customer should see (pay_at_counter + onlineMethods[]).
 *   - ensureSeeded(restaurantId) — lazy back-fill: on first read for a
 *     restaurant we seed `restaurant_payment_settings` + `payment_methods`
 *     from the legacy fields (`restaurants.enableOnlinePayment` +
 *     `acceptedPaymentMethods`) so existing tenants keep working without
 *     a manual migration step.
 *   - upsertPaymentMethods / updateSettings / upsertManualUpi — admin writes.
 *
 * The POS staff flow does NOT call into here — it continues to use
 * `restaurants.acceptedPaymentMethods` directly so this refactor stays
 * isolated to the customer-facing checkout.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  paymentMethodsTable,
  restaurantPaymentSettingsTable,
  manualUpiSettingsTable,
  restaurantsTable,
  type PaymentMethod,
  type RestaurantPaymentSettings,
  type ManualUpiSettings,
} from "./db";
import {
  getEffectiveRazorpayConfig,
  getEffectiveCashfreeConfig,
} from "./paymentSettings";
import { encryptSecret, decryptSecret } from "./aiEncryption";

export interface PaymentConfigDTO {
  settings: RestaurantPaymentSettings;
  offlineMethods: PaymentMethod[];
  onlineMethods: PaymentMethod[];
  manualUpi: ManualUpiSettings | null;
}

export interface CheckoutOnlineMethod {
  type: "platform_gateway" | "own_gateway" | "manual_upi";
  gatewayCode: string | null;
  label: string;
}

export interface CheckoutOptionsDTO {
  /** Always true; "Pay at Counter" is the universal fallback. */
  payAtCounterEnabled: boolean;
  /** Restaurant has at least one online method enabled. */
  onlineEnabled: boolean;
  /** Defaulted radio choice when both are available. */
  defaultChoice: "pay_at_counter" | "pay_online";
  /** Sub-list shown when the customer expands "Pay Online". */
  onlineMethods: CheckoutOnlineMethod[];
}

/**
 * Seed the new payment-config tables for a restaurant the first time we read
 * them. Pulls from the legacy `restaurants` columns so existing data is not
 * lost. Idempotent — only inserts when no rows exist yet for that restaurant.
 */
async function ensureSeeded(restaurantId: number): Promise<void> {
  const [existing] = await db
    .select({ rid: restaurantPaymentSettingsTable.restaurantId })
    .from(restaurantPaymentSettingsTable)
    .where(eq(restaurantPaymentSettingsTable.restaurantId, restaurantId));
  if (existing) return;

  const [restaurant] = await db
    .select({
      enableOnlinePayment: restaurantsTable.enableOnlinePayment,
      acceptedPaymentMethods: restaurantsTable.acceptedPaymentMethods,
    })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) return;

  const accepted = new Set((restaurant.acceptedPaymentMethods ?? []).map(s => s.toLowerCase()));

  await db.insert(restaurantPaymentSettingsTable).values({
    restaurantId,
    offlineEnabled: true,
    onlineEnabled: !!restaurant.enableOnlinePayment,
    onlinePaymentSource: "platform_gateway",
    defaultCustomerChoice: "pay_at_counter",
  }).onConflictDoNothing();

  const seedRows: Array<typeof paymentMethodsTable.$inferInsert> = [];
  // Offline (counter) — derived from acceptedPaymentMethods. We always
  // include `pay_at_counter` because the customer-facing radio relies on it.
  seedRows.push({ restaurantId, category: "offline", type: "pay_at_counter", isEnabled: true, sortOrder: 0 });
  if (accepted.has("cash") || accepted.size === 0) seedRows.push({ restaurantId, category: "offline", type: "cash", isEnabled: true, sortOrder: 1 });
  if (accepted.has("card")) seedRows.push({ restaurantId, category: "offline", type: "counter_card", isEnabled: true, sortOrder: 2 });
  if (accepted.has("upi")) seedRows.push({ restaurantId, category: "offline", type: "counter_upi", isEnabled: true, sortOrder: 3 });

  // Online — seed one platform_gateway entry if online payments are on.
  // The actual gateway availability comes from the super-admin provider
  // settings; we just record that the restaurant has opted in.
  if (restaurant.enableOnlinePayment) {
    seedRows.push({ restaurantId, category: "online", type: "platform_gateway", isEnabled: true, sortOrder: 0 });
  }

  if (seedRows.length > 0) {
    await db.insert(paymentMethodsTable).values(seedRows).onConflictDoNothing();
  }
}

export async function getPaymentConfig(restaurantId: number): Promise<PaymentConfigDTO> {
  await ensureSeeded(restaurantId);
  const [settings] = await db
    .select()
    .from(restaurantPaymentSettingsTable)
    .where(eq(restaurantPaymentSettingsTable.restaurantId, restaurantId));
  const methods = await db
    .select()
    .from(paymentMethodsTable)
    .where(eq(paymentMethodsTable.restaurantId, restaurantId));
  const [manualUpi] = await db
    .select()
    .from(manualUpiSettingsTable)
    .where(eq(manualUpiSettingsTable.restaurantId, restaurantId));

  // Decrypt the UPI VPA before handing the row to the admin UI. Without
  // this, upsertManualUpi clears the legacy plaintext `upiId` after writing
  // the cipher columns, so the UI would show an empty field on reload.
  const decryptedManualUpi = manualUpi
    ? { ...manualUpi, upiId: decryptManualUpi(manualUpi) }
    : null;
  return {
    settings: settings!,
    offlineMethods: methods.filter(m => m.category === "offline").sort((a, b) => a.sortOrder - b.sortOrder),
    onlineMethods: methods.filter(m => m.category === "online").sort((a, b) => a.sortOrder - b.sortOrder),
    manualUpi: decryptedManualUpi,
  };
}

/** Customer-facing collapsed view: two top-level options + online sub-list.
 *
 * Enforces `settings.onlinePaymentSource` (platform_gateway | own_gateway |
 * manual_upi | mixed) so the sub-list only shows methods that match the
 * routing source the admin chose. Without this filter the admin's source
 * choice would be purely cosmetic. */
export async function getCheckoutOptions(restaurantId: number): Promise<CheckoutOptionsDTO> {
  const cfg = await getPaymentConfig(restaurantId);
  const source = cfg.settings.onlinePaymentSource;
  const allowed = (t: string): boolean => {
    if (source === "mixed") return true;
    if (source === "platform_gateway") return t === "platform_gateway";
    if (source === "own_gateway") return t === "own_gateway";
    if (source === "manual_upi") return t === "manual_upi";
    return true;
  };
  const upiPlain = decryptManualUpi(cfg.manualUpi);
  const onlineMethods: CheckoutOnlineMethod[] = [];
  if (cfg.settings.onlineEnabled) {
    for (const m of cfg.onlineMethods) {
      if (!m.isEnabled) continue;
      if (!(m.type === "platform_gateway" || m.type === "own_gateway" || m.type === "manual_upi")) continue;
      if (!allowed(m.type)) continue;
      // Hide platform_gateway rows when no gateway is actually live, so the
      // customer never sees an option that 500s on click.
      if (m.type === "platform_gateway") {
        const [rzp, cf] = await Promise.all([getEffectiveRazorpayConfig(), getEffectiveCashfreeConfig()]);
        if (!rzp.enabled && !cf.enabled) continue;
      }
      if (m.type === "manual_upi" && !upiPlain) continue;
      onlineMethods.push({
        type: m.type,
        gatewayCode: m.gatewayCode ?? null,
        label: m.label ?? defaultLabel(m.type, m.gatewayCode),
      });
    }
  }
  return {
    payAtCounterEnabled: cfg.settings.offlineEnabled,
    onlineEnabled: onlineMethods.length > 0,
    defaultChoice: cfg.settings.defaultCustomerChoice === "pay_online" ? "pay_online" : "pay_at_counter",
    onlineMethods,
  };
}

/** Decrypt the stored UPI VPA. Prefers the encrypted-at-rest columns; falls
 *  back to the legacy plaintext column for rows that pre-date encryption. */
export function decryptManualUpi(row: ManualUpiSettings | null): string | null {
  if (!row) return null;
  if (row.upiIdCipher && row.upiIdIv && row.upiIdTag) {
    return decryptSecret({ cipher: row.upiIdCipher, iv: row.upiIdIv, tag: row.upiIdTag });
  }
  return row.upiId ?? null;
}

/** Validate a customer-requested online method against this restaurant's
 *  effective checkout options. Used by the payment-intent endpoint to refuse
 *  any source the admin hasn't enabled. Returns the resolved type+gateway
 *  pair on success, or null when the choice is invalid. */
export async function resolveCustomerOnlineMethod(
  restaurantId: number,
  requested: { paymentSource?: string | null; gatewayCode?: string | null } | undefined,
): Promise<{ type: "platform_gateway" | "own_gateway" | "manual_upi"; gatewayCode: string | null } | null> {
  const opts = await getCheckoutOptions(restaurantId);
  if (!opts.onlineEnabled || opts.onlineMethods.length === 0) return null;
  // If the customer didn't say which one (older client), take the first
  // enabled one as the implicit choice — preserves backwards compatibility
  // with the legacy "single online button" UI.
  if (!requested?.paymentSource) {
    const first = opts.onlineMethods[0];
    return { type: first.type, gatewayCode: first.gatewayCode };
  }
  const match = opts.onlineMethods.find(
    m => m.type === requested.paymentSource && (m.gatewayCode ?? null) === (requested.gatewayCode ?? null),
  );
  return match ? { type: match.type, gatewayCode: match.gatewayCode } : null;
}

function defaultLabel(type: string, gatewayCode: string | null): string {
  if (type === "manual_upi") return "UPI (Restaurant's own)";
  if (type === "own_gateway") return gatewayCode ? `Pay with ${cap(gatewayCode)}` : "Pay Online (Card / UPI / Wallet)";
  return "Pay Online (Card / UPI / Wallet)";
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

export async function updateSettings(
  restaurantId: number,
  patch: Partial<Pick<RestaurantPaymentSettings, "offlineEnabled" | "onlineEnabled" | "onlinePaymentSource" | "defaultCustomerChoice">>,
  updatedBy: number | null,
): Promise<RestaurantPaymentSettings> {
  await ensureSeeded(restaurantId);
  const [row] = await db
    .update(restaurantPaymentSettingsTable)
    .set({ ...patch, updatedBy: updatedBy ?? undefined, updatedAt: new Date() })
    .where(eq(restaurantPaymentSettingsTable.restaurantId, restaurantId))
    .returning();

  // Keep the legacy `restaurants.enableOnlinePayment` boolean in sync so the
  // existing public menu endpoint (and any reports still reading it)
  // continue to reflect the truth. Allows incremental migration.
  if (patch.onlineEnabled != null) {
    await db.update(restaurantsTable)
      .set({ enableOnlinePayment: patch.onlineEnabled })
      .where(eq(restaurantsTable.id, restaurantId));
  }
  return row;
}

export interface UpsertMethodInput {
  category: "offline" | "online";
  type: string;
  label?: string | null;
  isEnabled: boolean;
  gatewayCode?: string | null;
  sortOrder?: number;
  config?: Record<string, unknown>;
}

export async function upsertMethod(restaurantId: number, input: UpsertMethodInput): Promise<PaymentMethod> {
  await ensureSeeded(restaurantId);
  const gateway = input.gatewayCode ?? null;
  // Upsert by (restaurant, category, type, gatewayCode)
  const existing = await db
    .select()
    .from(paymentMethodsTable)
    .where(
      and(
        eq(paymentMethodsTable.restaurantId, restaurantId),
        eq(paymentMethodsTable.category, input.category),
        eq(paymentMethodsTable.type, input.type),
      ),
    );
  const match = existing.find(r => (r.gatewayCode ?? null) === gateway);
  if (match) {
    const [updated] = await db
      .update(paymentMethodsTable)
      .set({
        label: input.label ?? null,
        isEnabled: input.isEnabled,
        gatewayCode: gateway,
        sortOrder: input.sortOrder ?? match.sortOrder,
        config: input.config ?? match.config,
        updatedAt: new Date(),
      })
      .where(eq(paymentMethodsTable.id, match.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(paymentMethodsTable)
    .values({
      restaurantId,
      category: input.category,
      type: input.type,
      label: input.label ?? null,
      isEnabled: input.isEnabled,
      gatewayCode: gateway,
      sortOrder: input.sortOrder ?? 0,
      config: input.config ?? {},
    })
    .returning();
  return created;
}

export async function deleteMethod(restaurantId: number, methodId: number): Promise<void> {
  await db
    .delete(paymentMethodsTable)
    .where(and(eq(paymentMethodsTable.restaurantId, restaurantId), eq(paymentMethodsTable.id, methodId)));
}

export async function upsertManualUpi(
  restaurantId: number,
  patch: Partial<Omit<ManualUpiSettings, "restaurantId" | "createdAt" | "updatedAt" | "upiIdCipher" | "upiIdIv" | "upiIdTag">>,
  updatedBy: number | null,
): Promise<ManualUpiSettings> {
  await ensureSeeded(restaurantId);
  // Sensitive UPI VPA is encrypted at rest with AES-256-GCM. We deliberately
  // clear the legacy plaintext `upi_id` on every write so an admin rotating
  // their VPA never leaves the old one in clear text.
  const { upiId, ...rest } = patch;
  const encryptedFields: { upiId: string | null; upiIdCipher: string | null; upiIdIv: string | null; upiIdTag: string | null } | Record<string, never> =
    upiId === undefined
      ? {}
      : upiId
        ? (() => {
            const enc = encryptSecret(upiId);
            return { upiId: null, upiIdCipher: enc.cipher, upiIdIv: enc.iv, upiIdTag: enc.tag };
          })()
        : { upiId: null, upiIdCipher: null, upiIdIv: null, upiIdTag: null };

  const [existing] = await db
    .select()
    .from(manualUpiSettingsTable)
    .where(eq(manualUpiSettingsTable.restaurantId, restaurantId));
  if (existing) {
    const [updated] = await db
      .update(manualUpiSettingsTable)
      .set({ ...rest, ...encryptedFields, updatedBy: updatedBy ?? undefined, updatedAt: new Date() })
      .where(eq(manualUpiSettingsTable.restaurantId, restaurantId))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(manualUpiSettingsTable)
    .values({ restaurantId, ...rest, ...encryptedFields, updatedBy: updatedBy ?? undefined })
    .returning();
  return created;
}

/** Eager backfill: seed payment_methods + restaurant_payment_settings rows
 *  for every restaurant that doesn't yet have a settings row. Idempotent.
 *  Called on API startup so the new tables are populated for ALL tenants,
 *  not just the ones who happen to visit the admin UI. */
export async function backfillAllRestaurants(): Promise<{ seeded: number }> {
  const rows = await db.select({ id: restaurantsTable.id }).from(restaurantsTable);
  let seeded = 0;
  for (const r of rows) {
    const [has] = await db
      .select({ rid: restaurantPaymentSettingsTable.restaurantId })
      .from(restaurantPaymentSettingsTable)
      .where(eq(restaurantPaymentSettingsTable.restaurantId, r.id));
    if (has) continue;
    await ensureSeeded(r.id);
    seeded += 1;
  }
  return { seeded };
}
