import { db, smsTemplatesTable, SMS_TEMPLATE_EVENT_KEYS, type SmsTemplateEventKey } from "./db";
import { eq } from "drizzle-orm";

interface SmsTemplateSpec {
  eventKey: SmsTemplateEventKey;
  name: string;
  body: string;
  variables: string[];
  category?: string;
}

export const DEFAULT_SMS_TEMPLATES: ReadonlyArray<SmsTemplateSpec> = Object.freeze([
  // ── Auth / OTP ─────────────────────────────────────────────
  {
    eventKey: "welcome",
    name: "Welcome new owner",
    body: "Welcome to KhanaLagao, {{name}}! Your {{trialDays}}-day free trial for {{restaurant}} is now active.",
    variables: ["name", "restaurant", "trialDays"],
  },
  {
    eventKey: "otp",
    name: "OTP verification",
    body: "{{otp}} is your verification code for KhanaLagao. Valid for 5 minutes. Do not share this code with anyone.",
    variables: ["otp"],
    category: "otp",
  },
  {
    eventKey: "password_reset_otp",
    name: "Password reset OTP",
    body: "{{otp}} is your verification code for KhanaLagao. Valid for 5 minutes. Do not share this code with anyone.",
    variables: ["otp"],
    category: "otp",
  },
  {
    eventKey: "demo_booked",
    name: "Demo booked",
    body: "Thanks {{name}}! Your KhanaLagao demo for {{restaurant}} is booked for {{when}}. We will reach out soon.",
    variables: ["name", "restaurant", "when"],
  },

  // ── Subscription / billing (owner-facing) ──────────────────
  {
    eventKey: "trial_ending",
    name: "Trial ending soon",
    body: "Hi {{tenant}}, your KhanaLagao trial ends in {{daysLeft}} day(s). Upgrade to keep your service running.",
    variables: ["tenant", "daysLeft"],
  },
  {
    eventKey: "subscription_activated",
    name: "Subscription activated",
    body: "Your KhanaLagao {{plan}} plan is now active. Next renewal: {{endsAt}}. Amount: {{currency}} {{amount}}.",
    variables: ["plan", "endsAt", "amount", "currency"],
  },
  {
    eventKey: "subscription_expired",
    name: "Subscription expired",
    body: "Your KhanaLagao subscription has expired. Renew now to restore access for {{restaurant}}.",
    variables: ["restaurant", "tenant"],
  },
  {
    eventKey: "payment_reminder",
    name: "Payment reminder",
    body: "Reminder: your KhanaLagao {{plan}} renewal of {{currency}} {{amount}} is due in {{daysLeft}} day(s) for {{tenant}}.",
    variables: ["tenant", "plan", "amount", "currency", "daysLeft"],
  },
  {
    eventKey: "payment_received",
    name: "Payment received",
    body: "Payment of {{currency}} {{amount}} received for KhanaLagao {{plan}}. Ref: {{ref}}. Thank you!",
    variables: ["amount", "currency", "plan", "ref"],
  },
  {
    eventKey: "payment_failed",
    name: "Payment failed",
    body: "Hi {{name}}, your KhanaLagao payment of {{currency}} {{amount}} for {{plan}} failed. Reason: {{reason}}. Retry: {{retryUrl}}",
    variables: ["name", "amount", "currency", "plan", "reason", "retryUrl"],
  },
  {
    eventKey: "payment_successful",
    name: "Payment successful",
    body: "Hi {{name}}, your KhanaLagao payment of {{currency}} {{amount}} for {{plan}} was successful. Invoice #{{invoiceNumber}}.",
    variables: ["name", "amount", "currency", "plan", "invoiceNumber"],
  },
  {
    eventKey: "invoice_generated",
    name: "Invoice generated",
    body: "Hi {{name}}, invoice #{{invoiceNumber}} for {{currency}} {{amount}} has been generated on KhanaLagao. View: {{invoiceUrl}}",
    variables: ["name", "invoiceNumber", "amount", "currency", "invoiceUrl"],
  },
  {
    eventKey: "plan_activated",
    name: "Plan activated",
    body: "Hi {{name}}, your KhanaLagao {{plan}} plan is now active. Next renewal: {{renewsAt}}.",
    variables: ["name", "plan", "renewsAt"],
  },
  {
    eventKey: "restaurant_suspended",
    name: "Restaurant suspended",
    body: "Heads up: {{tenant}} on KhanaLagao has been suspended. Contact support to restore service.",
    variables: ["tenant"],
  },

  // ── Customer-facing order lifecycle ────────────────────────
  {
    eventKey: "customer_order_confirmation",
    name: "Order confirmation",
    body: "Hi {{name}}, your order #{{orderNumber}} at {{restaurant}} for {{currency}} {{amount}} has been received. Thank you!",
    variables: ["name", "orderNumber", "restaurant", "amount", "currency"],
  },
  {
    eventKey: "order_ready",
    name: "Order ready",
    body: "Hi {{name}}, your order #{{orderNumber}} at {{restaurant}} is ready{{pickupNote}}. Enjoy!",
    variables: ["name", "orderNumber", "restaurant", "pickupNote"],
  },
  {
    eventKey: "order_cancelled",
    name: "Order cancelled",
    body: "Hi {{name}}, your order #{{orderNumber}} at {{restaurant}} has been cancelled. {{reason}}",
    variables: ["name", "orderNumber", "restaurant", "reason"],
  },

  // ── Reservations & events (customer-facing) ────────────────
  {
    eventKey: "reservation_reminder",
    name: "Reservation reminder",
    body: "Hi {{name}}, this is a reminder of your reservation at {{restaurant}} for {{guests}} on {{date}} at {{time}}. See you soon!",
    variables: ["name", "restaurant", "date", "time", "guests"],
  },
  {
    eventKey: "event_booking_confirmed",
    name: "Event booking confirmed",
    body: "Hi {{name}}, your event \"{{eventName}}\" at {{restaurant}} on {{eventDate}} is confirmed. We look forward to hosting you!",
    variables: ["name", "eventName", "eventDate", "restaurant"],
  },
  {
    eventKey: "event_payment_reminder",
    name: "Event payment reminder",
    body: "Hi {{name}}, the {{milestone}} payment of {{currency}} {{amount}} for \"{{eventName}}\" {{dueLabel}}. Pay: {{payUrl}}",
    variables: ["name", "eventName", "milestone", "amount", "currency", "dueLabel", "payUrl"],
  },

  // ── Loyalty & marketing ────────────────────────────────────
  {
    eventKey: "loyalty_points_earned",
    name: "Loyalty points earned",
    body: "Hi {{name}}, you earned {{points}} KhanaLagao points on order #{{orderNumber}} at {{restaurant}}. New balance: {{balance}}.",
    variables: ["name", "points", "orderNumber", "restaurant", "balance"],
  },
  {
    eventKey: "customer_winback",
    name: "Customer win-back",
    body: "Hi {{name}}, we miss you at {{restaurant}}! Come back and enjoy {{offer}}.",
    variables: ["name", "restaurant", "offer"],
    category: "promotional",
  },

  // ── Staff & ops (internal) ─────────────────────────────────
  {
    eventKey: "staff_invite",
    name: "Staff invite",
    body: "Hi {{name}}, {{inviterName}} invited you to {{restaurant}} on {{appName}} as {{role}}. Sign in at {{acceptUrl}} (use Forgot Password to set your password).",
    variables: ["name", "inviterName", "restaurant", "role", "acceptUrl", "appName"],
  },
  {
    eventKey: "staff_shift_handover",
    name: "Shift handover",
    body: "Hi {{name}}, a new shift handover for {{restaurant}} on {{date}} is ready. View it on KhanaLagao.",
    variables: ["name", "restaurant", "date"],
  },

  // ── Support (internal) ─────────────────────────────────────
  {
    eventKey: "support_ticket_created",
    name: "Support ticket created",
    body: "New KhanaLagao support ticket #{{ticketId}}: {{subjectLine}}. View: {{ticketUrl}}",
    variables: ["ticketId", "subjectLine", "ticketUrl"],
  },
  {
    eventKey: "support_ticket_replied",
    name: "Support ticket replied",
    body: "Hi {{name}}, your KhanaLagao support ticket #{{ticketId}} ({{subjectLine}}) has a new reply. View: {{ticketUrl}}",
    variables: ["name", "ticketId", "subjectLine", "ticketUrl"],
  },
  {
    eventKey: "sla_breach",
    name: "SLA breach",
    body: "SLA breach: KhanaLagao ticket #{{ticketId}} ({{subjectLine}}) overdue by {{overdueLabel}} — {{slaName}}. View: {{ticketUrl}}",
    variables: ["ticketId", "subjectLine", "slaName", "overdueLabel", "ticketUrl"],
  },

  // ── System (owner-facing) ──────────────────────────────────
  {
    eventKey: "ai_credits_low",
    name: "AI credits low",
    body: "Hi {{name}}, KhanaLagao AI credits for {{restaurant}} are low (balance: {{balance}}). Recharge: {{rechargeUrl}}",
    variables: ["name", "balance", "restaurant", "rechargeUrl"],
  },
]);

export const DEFAULT_SMS_TEMPLATE_COUNT = DEFAULT_SMS_TEMPLATES.length;

/**
 * Idempotent boot-time seeder for the SMS template catalog.
 *
 * Insert-only: if a row already exists for an event key, the row is left
 * alone so super-admin edits via the SMS Center are never overwritten.
 * The unique index on `event_key` guarantees one row per key.
 */
export async function seedDefaultSmsTemplates(): Promise<{ inserted: number; skipped: number }> {
  // Compile-time assertion: every key in the schema enum has a default row.
  const enumKeys = new Set<string>(SMS_TEMPLATE_EVENT_KEYS);
  const seedKeys = new Set<string>(DEFAULT_SMS_TEMPLATES.map(t => t.eventKey));
  for (const k of enumKeys) {
    if (!seedKeys.has(k)) {
      throw new Error(`SMS template seeder missing default for event key "${k}"`);
    }
  }

  let inserted = 0;
  let skipped = 0;
  for (const tpl of DEFAULT_SMS_TEMPLATES) {
    const existing = await db.select({ id: smsTemplatesTable.id })
      .from(smsTemplatesTable)
      .where(eq(smsTemplatesTable.eventKey, tpl.eventKey))
      .limit(1);
    if (existing.length) { skipped++; continue; }
    await db.insert(smsTemplatesTable).values({
      eventKey: tpl.eventKey,
      name: tpl.name,
      body: tpl.body,
      variables: tpl.variables,
      category: tpl.category ?? "transactional",
      isActive: true,
    }).onConflictDoNothing();
    inserted++;
  }
  return { inserted, skipped };
}
