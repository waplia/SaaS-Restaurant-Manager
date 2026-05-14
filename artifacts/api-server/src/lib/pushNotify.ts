import { eq, and, or, isNull, inArray } from "drizzle-orm";
import { db, usersTable, userDevicesTable } from "./db";
import { sendPush } from "./notifications";
import { logger } from "./logger";

export type PushType = "waiter_call" | "new_order" | "reservation" | "leave_decision" | "leave_request" | "payroll";

interface PushTargetFilter {
  restaurantId: number;
  roles: string[];
  type: PushType;
  kitchenId?: number | null;
}

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Send a push notification to all devices belonging to users matching the
 * given role/restaurant/kitchen filter, respecting per-user mute preferences.
 */
export async function pushToStaff(filter: PushTargetFilter, payload: PushPayload): Promise<void> {
  const { restaurantId, roles, type, kitchenId } = filter;
  if (roles.length === 0) return;

  const baseConds = [
    eq(usersTable.restaurantId, restaurantId),
    eq(usersTable.isActive, true),
    inArray(usersTable.role, roles),
  ];
  if (kitchenId != null) {
    baseConds.push(or(isNull(usersTable.kitchenId), eq(usersTable.kitchenId, kitchenId))!);
  }

  const candidates = await db
    .select({
      id: usersTable.id,
      notificationPrefs: usersTable.notificationPrefs,
    })
    .from(usersTable)
    .where(and(...baseConds));

  const targetUserIds = candidates
    .filter(u => {
      const prefs = (u.notificationPrefs ?? {}) as Record<string, boolean>;
      // Default ON unless explicitly muted (false).
      return prefs[type] !== false;
    })
    .map(u => u.id);

  if (targetUserIds.length === 0) return;

  const devices = await db
    .select({ token: userDevicesTable.token })
    .from(userDevicesTable)
    .where(inArray(userDevicesTable.userId, targetUserIds));

  const tokens = devices.map(d => d.token).filter(t => typeof t === "string" && t.length > 0);
  if (tokens.length === 0) return;

  try {
    await sendPush({
      to: tokens,
      title: payload.title,
      body: payload.body,
      data: { ...payload.data, type },
    });
  } catch (err) {
    logger.error({ err, type, restaurantId }, "pushToStaff failed");
  }
}

/**
 * Send a push notification to specific users (e.g. notify the requester of a
 * leave decision). Respects per-user mute preferences for the given type.
 */
export async function pushToUserIds(userIds: number[], type: PushType, payload: PushPayload): Promise<void> {
  if (userIds.length === 0) return;
  const users = await db
    .select({ id: usersTable.id, notificationPrefs: usersTable.notificationPrefs })
    .from(usersTable)
    .where(and(inArray(usersTable.id, userIds), eq(usersTable.isActive, true)));
  const targets = users
    .filter(u => ((u.notificationPrefs ?? {}) as Record<string, boolean>)[type] !== false)
    .map(u => u.id);
  if (targets.length === 0) return;

  const devices = await db
    .select({ token: userDevicesTable.token })
    .from(userDevicesTable)
    .where(inArray(userDevicesTable.userId, targets));
  const tokens = devices.map(d => d.token).filter(t => typeof t === "string" && t.length > 0);
  if (tokens.length === 0) return;

  try {
    await sendPush({ to: tokens, title: payload.title, body: payload.body, data: { ...payload.data, type } });
  } catch (err) {
    logger.error({ err, type, userIds: targets }, "pushToUserIds failed");
  }
}
