import { eq, and, lte, gte, isNull, sql } from "drizzle-orm";
import {
  db, tiffinSubscriptionsTable, tiffinInvoicesTable, customersTable, restaurantsTable,
} from "../lib/db";
import { sendSms, sendWhatsApp, sendEmail } from "./../lib/notifications";
import { logger } from "./../lib/logger";
import { generateInvoiceForSubscription } from "./tiffin";

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

/**
 * Daily reminders for outstanding tiffin invoices:
 *   T-3: 3 days before due date
 *   T-0: on due date
 *   T+2: 2 days after due date (escalation)
 */
export async function runTiffinBillingRemindersTick(): Promise<{ sent: number; scanned: number }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t3 = new Date(today); t3.setDate(t3.getDate() + 3);
  const tMinus2 = new Date(today); tMinus2.setDate(tMinus2.getDate() - 2);

  const invoices = await db.select({
    inv: tiffinInvoicesTable,
    cust: customersTable,
  }).from(tiffinInvoicesTable)
    .leftJoin(customersTable, eq(customersTable.id, tiffinInvoicesTable.customerId))
    .where(and(
      sql`${tiffinInvoicesTable.status} != 'paid'`,
      sql`${tiffinInvoicesTable.status} != 'void'`,
    ));

  let sent = 0;
  for (const { inv, cust } of invoices) {
    if (!cust) continue;
    const due = inv.dueDate; // YYYY-MM-DD string
    const dueYmd = ymd(today);
    const t3Ymd = ymd(t3);
    const tm2Ymd = ymd(tMinus2);

    let stage: "t3" | "t0" | "t2" | null = null;
    if (due === t3Ymd && !inv.reminderT3SentAt) stage = "t3";
    else if (due === dueYmd && !inv.reminderT0SentAt) stage = "t0";
    else if (due === tm2Ymd && !inv.reminderT2SentAt) stage = "t2";
    if (!stage) continue;

    const stageLabel =
      stage === "t3" ? "due in 3 days" :
      stage === "t0" ? "due today" :
      "overdue by 2 days";
    const body = `Hi ${cust.name}, your tiffin bill ${inv.invoiceNumber} of ₹${inv.total} is ${stageLabel}. Thanks!`;
    try {
      if (cust.phone) {
        try { await sendSms({ to: cust.phone, body }); } catch { /* swallow */ }
        try { await sendWhatsApp({ to: cust.phone, body }); } catch { /* swallow */ }
      }
      if (cust.email) {
        try {
          await sendEmail({
            to: cust.email,
            subject: `Tiffin bill ${inv.invoiceNumber} — ${stageLabel}`,
            html: `<p>${body}</p>`,
            text: body,
          });
        } catch { /* swallow */ }
      }
      const patch: Record<string, Date> = {};
      if (stage === "t3") patch.reminderT3SentAt = new Date();
      if (stage === "t0") patch.reminderT0SentAt = new Date();
      if (stage === "t2") patch.reminderT2SentAt = new Date();
      await db.update(tiffinInvoicesTable).set(patch).where(eq(tiffinInvoicesTable.id, inv.id));
      sent++;
    } catch (err) {
      logger.warn({ err, invoiceId: inv.id }, "[tiffin] reminder send failed");
    }
  }
  return { sent, scanned: invoices.length };
}

/** Generate invoices for the prior calendar month for all active subscriptions. */
export async function runTiffinMonthlyInvoicesTick(): Promise<{ created: number }> {
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0); // last day prior month
  const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const start = ymd(periodStart);
  const end = ymd(periodEnd);

  const subs = await db.select().from(tiffinSubscriptionsTable)
    .where(sql`${tiffinSubscriptionsTable.status} != 'cancelled'`);
  let created = 0;
  for (const s of subs) {
    try {
      const r = await generateInvoiceForSubscription(s.restaurantId, s.id, start, end);
      if (r) created++;
    } catch (err) {
      logger.warn({ err, subscriptionId: s.id }, "[tiffin] invoice gen failed");
    }
  }
  return { created };
}
