import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
// `isNotNull` retained for owners filter
void isNotNull;
import {
  db,
  tenantsTable,
  restaurantsTable,
  usersTable,
  notificationsTable,
  notificationBroadcastsTable,
  notificationDeliveriesTable,
  userDevicesTable,
  type AudienceFilter,
  type BroadcastChannel,
  type NotificationBroadcast,
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

/**
 * Resolves an audience filter into a deduplicated list of tenant-scoped recipients.
 * Each row represents one user (typically tenant owner / manager) plus the set
 * of restaurants belonging to their tenant (for in-app fan-out).
 */
export async function resolveAudience(filter: AudienceFilter): Promise<ResolvedRecipient[]> {
  // Find target tenant IDs first.
  let tenantIds: number[] = [];

  if (filter.type === "all") {
    const rows = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.isActive, true));
    tenantIds = rows.map(r => r.id);
  } else if (filter.type === "tenants") {
    tenantIds = (filter.ids ?? []).filter(n => Number.isFinite(n));
  } else if (filter.type === "plan_status") {
    const statuses = (filter.values ?? []).filter(Boolean);
    if (statuses.length === 0) return [];
    const rows = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(inArray(tenantsTable.planStatus, statuses));
    tenantIds = rows.map(r => r.id);
  } else if (filter.type === "plan") {
    const planIds = (filter.ids ?? []).filter(n => Number.isFinite(n));
    if (planIds.length === 0) return [];
    const rows = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(inArray(tenantsTable.planId, planIds));
    tenantIds = rows.map(r => r.id);
  } else if (filter.type === "country" || filter.type === "city") {
    const values = (filter.values ?? []).filter(Boolean);
    if (values.length === 0) return [];
    const col = filter.type === "country" ? restaurantsTable.country : restaurantsTable.city;
    const rows = await db.selectDistinct({ id: restaurantsTable.tenantId }).from(restaurantsTable).where(inArray(col, values));
    tenantIds = rows.map(r => r.id);
  } else if (filter.type === "role") {
    // Special case: dispatch to all users matching a role across all tenants.
    const roles = (filter.values ?? []).filter(Boolean);
    if (roles.length === 0) return [];
    const users = await db.select({
      id: usersTable.id,
      tenantId: usersTable.tenantId,
      name: usersTable.name,
      email: usersTable.email,
      phone: usersTable.phone,
    }).from(usersTable).where(and(inArray(usersTable.role, roles), isNotNull(usersTable.tenantId)));
    return await attachRestaurantsAndDevices(users.map(u => ({
      tenantId: u.tenantId as number,
      userId: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
    })));
  }

  tenantIds = Array.from(new Set(tenantIds));
  if (tenantIds.length === 0) return [];

  // Default contact for tenant-scoped channels: the tenant's owner user(s).
  const owners = await db.select({
    id: usersTable.id,
    tenantId: usersTable.tenantId,
    name: usersTable.name,
    email: usersTable.email,
    phone: usersTable.phone,
  }).from(usersTable).where(and(eq(usersTable.role, "owner"), inArray(usersTable.tenantId, tenantIds)));

  // Tenants without an owner user still get in-app delivery via their restaurants — represent them with a null user.
  const tenantsWithOwner = new Set(owners.map(o => o.tenantId).filter((x): x is number => x !== null));
  const ownerlessTenants = tenantIds.filter(id => !tenantsWithOwner.has(id));

  return await attachRestaurantsAndDevices([
    ...owners.map(o => ({
      tenantId: o.tenantId as number,
      userId: o.id,
      name: o.name,
      email: o.email,
      phone: o.phone,
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
 * Writes one notificationDeliveriesTable row per (recipient × channel) and
 * updates the broadcast aggregate counts.
 */
export async function dispatchBroadcast(broadcastId: number): Promise<void> {
  // Atomic state transition: only one caller can flip draft|scheduled → sending.
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
    const channels = bc.channels;

    for (const r of recipients) {
      const vars: Record<string, string> = {
        tenantName: "",
        userName: r.name ?? "",
        userEmail: r.email ?? "",
      };
      const subject = renderTemplate(bc.subject ?? bc.title, vars);
      const message = renderTemplate(bc.message, vars);

      for (const channel of channels) {
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
): Promise<{ status: "sent" | "failed" | "skipped"; recipient: string | null; error?: string }> {
  try {
    if (channel === "in_app") {
      if (r.restaurantIds.length === 0) return { status: "skipped", recipient: null, error: "No restaurants for tenant" };
      await db.insert(notificationsTable).values(r.restaurantIds.map(rid => ({
        restaurantId: rid,
        type: "admin.broadcast",
        title: subject,
        message,
        entityId: bc.id,
        entityType: "notification_broadcast",
      })));
      return { status: "sent", recipient: `tenant:${r.tenantId}` };
    }
    if (channel === "email") {
      if (!r.email) return { status: "skipped", recipient: null, error: "No email" };
      await sendEmail({ to: r.email, subject, html: `<div style="font-family:sans-serif">${message.replace(/\n/g, "<br/>")}</div>`, text: message });
      return { status: "sent", recipient: r.email };
    }
    if (channel === "sms") {
      if (!r.phone) return { status: "skipped", recipient: null, error: "No phone" };
      await sendSms({ to: r.phone, body: `${subject}\n\n${message}` });
      return { status: "sent", recipient: r.phone };
    }
    if (channel === "whatsapp") {
      if (!r.phone) return { status: "skipped", recipient: null, error: "No phone" };
      await sendWhatsApp({ to: r.phone, body: `*${subject}*\n\n${message}` });
      return { status: "sent", recipient: r.phone };
    }
    if (channel === "push") {
      if (r.pushTokens.length === 0) return { status: "skipped", recipient: null, error: "No push tokens" };
      await sendPush({ to: r.pushTokens, title: subject, body: message, data: { broadcastId: bc.id } });
      return { status: "sent", recipient: `${r.pushTokens.length} device(s)` };
    }
    return { status: "skipped", recipient: null, error: `Unknown channel ${channel}` };
  } catch (err) {
    return { status: "failed", recipient: null, error: (err as Error).message };
  }
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
