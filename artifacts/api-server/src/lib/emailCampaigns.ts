/**
 * Scheduled campaign tick (Task #414). Runs from the scheduler; picks
 * up any campaigns whose `scheduledAt` is in the past and dispatches
 * them through the same send path used by the manual "Send now" route.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import {
  db,
  emailCampaignsTable,
  emailCampaignRecipientsTable,
  customersTable,
} from "./db";
import { sendEmail, renderTemplate, htmlToText } from "./emailSender";
import { logger } from "./logger";

async function resolveSegmentRecipients(restaurantId: number, segment: string) {
  const base = [
    eq(customersTable.restaurantId, restaurantId),
    eq(customersTable.emailMarketingOptIn, true),
    eq(customersTable.emailUnsubscribed, false),
  ];
  const extra: ReturnType<typeof eq>[] = [];
  if (segment === "inactive_30d") extra.push(sql`${customersTable.lastVisitAt} < NOW() - INTERVAL '30 days'` as never);
  if (segment === "new_30d") extra.push(sql`${customersTable.firstOrderAt} > NOW() - INTERVAL '30 days'` as never);
  return db.select({
    id: customersTable.id, email: customersTable.email, name: customersTable.name,
  }).from(customersTable).where(and(...base, ...extra)).limit(50_000);
}

export async function runScheduledCampaignTick(now: Date = new Date()): Promise<{ started: number }> {
  const due = await db.select().from(emailCampaignsTable)
    .where(and(eq(emailCampaignsTable.status, "scheduled"), lte(emailCampaignsTable.scheduledAt, now)))
    .limit(50);
  let started = 0;
  for (const c of due) {
    started++;
    const recipients = (await resolveSegmentRecipients(c.restaurantId, c.segment)).filter(r => !!r.email);
    await db.update(emailCampaignsTable).set({
      status: "sending", startedAt: now, recipientCount: recipients.length, updatedAt: now,
    }).where(eq(emailCampaignsTable.id, c.id));
    void (async () => {
      let sent = 0, failed = 0;
      for (const r of recipients) {
        try {
          const vars = { name: r.name ?? "there" };
          const html = renderTemplate(c.body, vars);
          const subject = renderTemplate(c.subject, vars);
          const result = await sendEmail({
            to: r.email!, subject, html, text: htmlToText(html),
            tenantId: c.tenantId, restaurantId: c.restaurantId,
            kind: "marketing", recipientType: "customer", campaignId: c.id,
          });
          await db.insert(emailCampaignRecipientsTable).values({
            campaignId: c.id, customerId: r.id, email: r.email!, name: r.name,
            status: result?.ok ? "sent" : (result?.skippedReason ?? "failed"),
            reason: result?.error ?? null, logId: result?.log?.id ?? null,
            sentAt: result?.ok ? new Date() : null,
          }).catch(() => {});
          if (result?.ok) sent++; else failed++;
        } catch (err) {
          failed++; logger.warn({ err, campaignId: c.id }, "scheduled campaign send failed");
        }
      }
      await db.update(emailCampaignsTable).set({
        status: failed === recipients.length && recipients.length > 0 ? "failed" : "sent",
        completedAt: new Date(), sentCount: sent, failedCount: failed, updatedAt: new Date(),
      }).where(eq(emailCampaignsTable.id, c.id));
    })();
  }
  if (started) logger.info({ started }, "[email-campaigns] scheduled tick");
  return { started };
}
