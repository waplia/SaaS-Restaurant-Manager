import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import {
  db,
  tenantsTable,
  restaurantsTable,
  usersTable,
  notificationsTable,
  notificationBroadcastsTable,
  notificationDeliveriesTable,
  notificationTemplatesTable,
  userDevicesTable,
  type AudienceFilter,
  type BroadcastChannel,
  type NotificationBroadcast,
  type NotificationDelivery,
} from "./db";
import { sendEmail, sendSms, sendWhatsApp, sendPush } from "./notifications";
import { logger } from "./logger";

export type ResolvedRecipient = {
  tenantId: number;
  userId: number | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  restaurantIds: number[];
  pushTokens: string[];
};

type SendResult = {
  status: "sent" | "failed" | "skipped";
  recipient: string | null;
  error?: string;
  providerMessageId?: string | null;
};

function nonEmpty<T>(arr: T[] | undefined | null): arr is T[] {
  return Array.isArray(arr) && arr.length > 0;
}

/**
 * Resolves a combinable audience filter into a deduplicated list of
 * tenant-scoped recipients. All populated criteria are AND-ed; within
 * a single criterion the values are OR-ed. An empty filter matches
 * all active tenants.
 */
export async function resolveAudience(filter: AudienceFilter): Promise<ResolvedRecipient[]> {
  const tenantConditions: SQL[] = [eq(tenantsTable.isActive, true)];
  if (nonEmpty(filter.tenantIds)) tenantConditions.push(inArray(tenantsTable.id, filter.tenantIds));
  if (nonEmpty(filter.planIds)) tenantConditions.push(inArray(tenantsTable.planId, filter.planIds));
  if (nonEmpty(filter.planStatuses)) tenantConditions.push(inArray(tenantsTable.planStatus, filter.planStatuses));

  let tenantIds: number[] = [];
  const baseRows = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(and(...tenantConditions));
  tenantIds = baseRows.map(r => r.id);

  // Geographic narrowing intersects with tenants that have restaurants in the requested countries/cities.
  if (nonEmpty(filter.countries) || nonEmpty(filter.cities)) {
    const geoConditions: SQL[] = [];
    if (nonEmpty(filter.countries)) geoConditions.push(inArray(restaurantsTable.country, filter.countries));
    if (nonEmpty(filter.cities)) geoConditions.push(inArray(restaurantsTable.city, filter.cities));
    const geoRows = await db.selectDistinct({ id: restaurantsTable.tenantId })
      .from(restaurantsTable).where(and(...geoConditions));
    const geoSet = new Set(geoRows.map(r => r.id));
    tenantIds = tenantIds.filter(id => geoSet.has(id));
  }

  tenantIds = Array.from(new Set(tenantIds));
  if (tenantIds.length === 0) return [];

  // Resolve users for the tenant set, optionally narrowed by role.
  const userConditions: SQL[] = [
    isNotNull(usersTable.tenantId),
    inArray(usersTable.tenantId, tenantIds),
  ];
  if (nonEmpty(filter.roles)) {
    userConditions.push(inArray(usersTable.role, filter.roles));
  } else {
    // Default contact: tenant owner.
    userConditions.push(eq(usersTable.role, "owner"));
  }
  const users = await db.select({
    id: usersTable.id,
    tenantId: usersTable.tenantId,
    name: usersTable.name,
    email: usersTable.email,
    phone: usersTable.phone,
  }).from(usersTable).where(and(...userConditions));

  // Tenants with no matching user still receive in-app delivery via their restaurants.
  const tenantsWithUser = new Set(users.map(u => u.tenantId).filter((x): x is number => x !== null));
  const ownerlessTenants = tenantIds.filter(id => !tenantsWithUser.has(id));

  return await attachRestaurantsAndDevices([
    ...users.map(u => ({
      tenantId: u.tenantId as number,
      userId: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
    })),
    ...ownerlessTenants.map(tenantId => ({
      tenantId,
      userId: null,
      name: null,
      email: null,
      phone: null,
    })),
  ]);
}

async function attachRestaurantsAndDevices(
  rows: Array<Omit<ResolvedRecipient, "restaurantIds" | "pushTokens">>,
): Promise<ResolvedRecipient[]> {
  const tenantIds = Array.from(new Set(rows.map(r => r.tenantId).filter(Boolean)));
  const userIds = Array.from(new Set(rows.map(r => r.userId).filter((x): x is number => x !== null)));

  const restaurantRows = tenantIds.length
    ? await db.select({ id: restaurantsTable.id, tenantId: restaurantsTable.tenantId })
        .from(restaurantsTable).where(inArray(restaurantsTable.tenantId, tenantIds))
    : [];
  const restaurantsByTenant = new Map<number, number[]>();
  for (const r of restaurantRows) {
    const arr = restaurantsByTenant.get(r.tenantId) ?? [];
    arr.push(r.id);
    restaurantsByTenant.set(r.tenantId, arr);
  }

  const deviceRows = userIds.length
    ? await db.select({ userId: userDevicesTable.userId, token: userDevicesTable.token })
        .from(userDevicesTable).where(inArray(userDevicesTable.userId, userIds))
    : [];
  const tokensByUser = new Map<number, string[]>();
  for (const d of deviceRows) {
    if (!d.token) continue;
    const arr = tokensByUser.get(d.userId) ?? [];
    arr.push(d.token);
    tokensByUser.set(d.userId, arr);
  }

  return rows.map(r => ({
    ...r,
    restaurantIds: restaurantsByTenant.get(r.tenantId) ?? [],
    pushTokens: r.userId ? (tokensByUser.get(r.userId) ?? []) : [],
  }));
}

function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

/**
 * Send a broadcast to all resolved recipients across the requested channels.
 * Atomic claim ensures only one caller can transition draft|scheduled → sending.
 * Finalizer guarantees a terminal status (sent|failed) so rows never get stuck in "sending".
 */
export async function dispatchBroadcast(broadcastId: number): Promise<void> {
  const claimed = await db.update(notificationBroadcastsTable)
    .set({ status: "sending", updatedAt: new Date() })
    .where(and(
      eq(notificationBroadcastsTable.id, broadcastId),
      inArray(notificationBroadcastsTable.status, ["draft", "scheduled"]),
    ))
    .returning();
  if (claimed.length === 0) {
    logger.warn({ broadcastId }, "Skipping broadcast — already in flight, sent, or cancelled");
    return;
  }
  const bc = claimed[0];

  let success = 0, failure = 0;
  let recipients: ResolvedRecipient[] = [];
  let terminalStatus: "sent" | "failed" = "sent";
  let dispatchErr: unknown = null;

  try {
    recipients = await resolveAudience(bc.audience);

    for (const r of recipients) {
      const vars: Record<string, string> = {
        userName: r.name ?? "",
        userEmail: r.email ?? "",
      };
      const subject = renderTemplate(bc.subject ?? bc.title, vars);
      const message = renderTemplate(bc.message, vars);

      for (const channel of bc.channels) {
        const out = await sendOnChannel(bc, channel, r, subject, message);
        try {
          await db.insert(notificationDeliveriesTable).values({
            broadcastId: bc.id,
            channel,
            tenantId: r.tenantId,
            userId: r.userId,
            recipient: out.recipient,
            status: out.status,
            error: out.error ?? null,
            providerMessageId: out.providerMessageId ?? null,
            sentAt: out.status === "sent" ? new Date() : null,
          });
        } catch (insertErr) {
          logger.error({ insertErr, broadcastId, channel }, "Failed to record delivery row");
        }
        if (out.status === "sent") success++;
        else if (out.status === "failed") failure++;
      }
    }
  } catch (err) {
    dispatchErr = err;
    terminalStatus = "failed";
    logger.error({ err, broadcastId }, "Broadcast dispatch loop failed");
  } finally {
    try {
      await db.update(notificationBroadcastsTable).set({
        status: terminalStatus,
        sentAt: terminalStatus === "sent" ? new Date() : null,
        totalRecipients: recipients.length,
        successCount: success,
        failureCount: failure,
        updatedAt: new Date(),
      }).where(eq(notificationBroadcastsTable.id, broadcastId));
    } catch (finalErr) {
      logger.error({ finalErr, broadcastId }, "Failed to finalize broadcast status");
    }
  }

  if (dispatchErr) throw dispatchErr;
  logger.info({ broadcastId, recipients: recipients.length, success, failure }, "Broadcast dispatched");
}

async function sendOnChannel(
  bc: NotificationBroadcast,
  channel: BroadcastChannel,
  r: ResolvedRecipient,
  subject: string,
  message: string,
): Promise<SendResult> {
  try {
    if (channel === "in_app") {
      if (r.restaurantIds.length === 0) return { status: "skipped", recipient: null, error: "No restaurants for tenant" };
      await db.insert(notificationsTable).values(r.restaurantIds.map(rid => ({
        restaurantId: rid,
        type: bc.priority === "urgent" ? "admin.broadcast.urgent" : "admin.broadcast",
        title: subject,
        message,
        entityId: bc.id,
        entityType: "notification_broadcast",
      })));
      return { status: "sent", recipient: `tenant:${r.tenantId}`, providerMessageId: null };
    }
    if (channel === "email") {
      if (!r.email) return { status: "skipped", recipient: null, error: "No email" };
      const result = await sendEmail({ to: r.email, subject, html: `<div style="font-family:sans-serif">${message.replace(/\n/g, "<br/>")}</div>`, text: message });
      return { status: "sent", recipient: r.email, providerMessageId: result?.messageId ?? null };
    }
    if (channel === "sms") {
      if (!r.phone) return { status: "skipped", recipient: null, error: "No phone" };
      const result = await sendSms({ to: r.phone, body: `${subject}\n\n${message}` });
      return { status: "sent", recipient: r.phone, providerMessageId: result?.sid ?? null };
    }
    if (channel === "whatsapp") {
      if (!r.phone) return { status: "skipped", recipient: null, error: "No phone" };
      const result = await sendWhatsApp({ to: r.phone, body: `*${subject}*\n\n${message}` });
      return { status: "sent", recipient: r.phone, providerMessageId: result?.sid ?? null };
    }
    if (channel === "push") {
      if (r.pushTokens.length === 0) return { status: "skipped", recipient: null, error: "No push tokens" };
      await sendPush({ to: r.pushTokens, title: subject, body: message, data: { broadcastId: bc.id, priority: bc.priority } });
      return { status: "sent", recipient: `${r.pushTokens.length} device(s)`, providerMessageId: null };
    }
    return { status: "skipped", recipient: null, error: `Unknown channel ${channel}` };
  } catch (err) {
    return { status: "failed", recipient: null, error: (err as Error).message };
  }
}

/**
 * Re-attempt a single delivery row. Only failed deliveries can be retried —
 * skipped rows have a permanent reason (no contact info) and would corrupt
 * aggregate counters if treated as a failure→success transition.
 */
export async function retryDelivery(deliveryId: number): Promise<NotificationDelivery> {
  const [delivery] = await db.select().from(notificationDeliveriesTable).where(eq(notificationDeliveriesTable.id, deliveryId));
  if (!delivery) throw new Error("Delivery not found");
  if (delivery.status !== "failed") {
    throw new Error(`Only failed deliveries can be retried (current status: ${delivery.status})`);
  }
  const [bc] = await db.select().from(notificationBroadcastsTable).where(eq(notificationBroadcastsTable.id, delivery.broadcastId));
  if (!bc) throw new Error("Broadcast not found");

  // Rebuild the recipient context for this single user/tenant.
  let recipientCtx: ResolvedRecipient;
  if (delivery.userId) {
    const [u] = await db.select({
      id: usersTable.id, tenantId: usersTable.tenantId, name: usersTable.name,
      email: usersTable.email, phone: usersTable.phone,
    }).from(usersTable).where(eq(usersTable.id, delivery.userId));
    if (!u) throw new Error("Recipient user no longer exists");
    [recipientCtx] = await attachRestaurantsAndDevices([{
      tenantId: u.tenantId as number, userId: u.id, name: u.name, email: u.email, phone: u.phone,
    }]);
  } else if (delivery.tenantId) {
    [recipientCtx] = await attachRestaurantsAndDevices([{
      tenantId: delivery.tenantId, userId: null, name: null, email: null, phone: null,
    }]);
  } else {
    throw new Error("Delivery has no tenant or user context");
  }

  const subject = bc.subject ?? bc.title;
  const out = await sendOnChannel(bc, delivery.channel, recipientCtx, subject, bc.message);

  const [updated] = await db.update(notificationDeliveriesTable).set({
    status: out.status,
    error: out.error ?? null,
    recipient: out.recipient,
    providerMessageId: out.providerMessageId ?? delivery.providerMessageId,
    sentAt: out.status === "sent" ? new Date() : delivery.sentAt,
  }).where(eq(notificationDeliveriesTable.id, deliveryId)).returning();

  // Counter math: previous status was "failed" (enforced above). Adjust only
  // when the new status is "sent" (failure → success). Other outcomes
  // (still failed, or skipped — though skipped should be rare on retry)
  // leave aggregates untouched.
  if (out.status === "sent") {
    await db.update(notificationBroadcastsTable).set({
      successCount: sql`${notificationBroadcastsTable.successCount} + 1`,
      failureCount: sql`greatest(${notificationBroadcastsTable.failureCount} - 1, 0)`,
      updatedAt: new Date(),
    }).where(eq(notificationBroadcastsTable.id, bc.id));
  }

  return updated;
}

/**
 * Resend all failed deliveries for a broadcast. Returns the number of
 * deliveries retried and how many succeeded on the second attempt.
 */
export async function resendFailedDeliveries(broadcastId: number): Promise<{ retried: number; succeeded: number; failed: number }> {
  const failedRows = await db.select({ id: notificationDeliveriesTable.id })
    .from(notificationDeliveriesTable)
    .where(and(
      eq(notificationDeliveriesTable.broadcastId, broadcastId),
      eq(notificationDeliveriesTable.status, "failed"),
    ));
  let succeeded = 0, failed = 0;
  for (const row of failedRows) {
    try {
      const updated = await retryDelivery(row.id);
      if (updated.status === "sent") succeeded++;
      else failed++;
    } catch (err) {
      failed++;
      logger.error({ err, deliveryId: row.id }, "Resend-failed retry threw");
    }
  }
  return { retried: failedRows.length, succeeded, failed };
}

/**
 * Seeds a small library of common admin broadcast templates the first time
 * the table is empty. Slugs are unique and idempotent. Safe to call on every boot.
 */
export async function seedDefaultTemplates(): Promise<void> {
  const existing = await db.select({ id: notificationTemplatesTable.id }).from(notificationTemplatesTable).limit(1);
  if (existing.length > 0) return;
  const defaults = [
    { name: "Welcome message", slug: "welcome", channel: "email" as const,
      subject: "Welcome to TableTrack, {{userName}}!",
      body: "Hi {{userName}},\n\nThanks for joining TableTrack. Your account is ready — sign in to set up your first restaurant.\n\nNeed help? Just reply to this email." },
    { name: "Trial ending soon", slug: "trial-ending", channel: "email" as const,
      subject: "Your TableTrack trial ends in 3 days",
      body: "Hi {{userName}},\n\nYour free trial ends in 3 days. Upgrade now to keep all your data, staff and integrations active without interruption." },
    { name: "Plan upgraded", slug: "plan-upgraded", channel: "in_app" as const,
      subject: "Plan upgraded — welcome aboard!",
      body: "Your subscription has been upgraded successfully. Enjoy the new limits and features." },
    { name: "Payment failed", slug: "payment-failed", channel: "email" as const,
      subject: "We couldn't process your payment",
      body: "Hi {{userName}},\n\nWe were unable to charge your card on file. Please update your billing details to avoid service interruption." },
    { name: "Scheduled maintenance", slug: "maintenance", channel: "in_app" as const,
      subject: "Scheduled maintenance",
      body: "We'll be performing scheduled maintenance soon. The platform may be briefly unavailable. Thanks for your patience." },
    { name: "New feature announcement", slug: "feature-announcement", channel: "in_app" as const,
      subject: "Something new just landed",
      body: "We've shipped a new capability we think you'll love. Open the app to check it out." },
  ];
  for (const t of defaults) {
    try {
      await db.insert(notificationTemplatesTable).values({
        ...t, variables: ["userName"], createdBy: null,
      });
    } catch (err) {
      logger.warn({ err, slug: t.slug }, "Default template seed skipped (likely already exists)");
    }
  }
  logger.info({ count: defaults.length }, "Seeded default notification templates");
}

let schedulerStarted = false;

/** Polls for due scheduled broadcasts every minute and dispatches them. */
export function startBroadcastScheduler(intervalMs = 60_000): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const tick = async () => {
    try {
      const due = await db.select({ id: notificationBroadcastsTable.id })
        .from(notificationBroadcastsTable)
        .where(and(
          eq(notificationBroadcastsTable.status, "scheduled"),
          sql`${notificationBroadcastsTable.scheduledAt} <= now()`,
        ));
      for (const row of due) {
        try { await dispatchBroadcast(row.id); }
        catch (err) { logger.error({ err, broadcastId: row.id }, "Scheduled broadcast failed"); }
      }
    } catch (err) {
      logger.error({ err }, "Broadcast scheduler tick failed");
    }
  };
  setInterval(tick, intervalMs).unref();
  logger.info({ intervalMs }, "Broadcast scheduler started");
}
