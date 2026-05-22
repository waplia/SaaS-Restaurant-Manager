import { eq, and, or, isNull, inArray } from "drizzle-orm";
import { db, usersTable, userDevicesTable } from "./db";
import { sendPush } from "./notifications";
import { logger } from "./logger";

export type PushType = "waiter_call" | "new_order" | "reservation" | "leave_decision" | "leave_request" | "payroll" | "fraud_alert" | "kitchen_delay" | "panic_alert" | "approval_request" | "incident_reported" | "temperature_alert";

/**
 * Map each push type to the bundled mobile sound + Android channel so the
 * tone matches the web client (see
 * `restaurant-platform/src/lib/notificationSound.ts`):
 *
 *   - `new-order`   → triumphant 3s arpeggio (playNewOrderChime)
 *   - `notification`→ softer 2-note ping     (playNotificationChime)
 *
 * The same files are bundled with the Expo app
 * (`tabletrack-mobile/assets/sounds/`) and the matching Android
 * notification channels are registered in `tabletrack-mobile/app/_layout.tsx`.
 */
function soundForType(type: PushType): { sound: string; channelId: string } {
  switch (type) {
    case "new_order":
      // Mirrors web socket("order:new") → playNewOrderChime()
      return { sound: "new-order.wav", channelId: "new-order" };
    case "waiter_call":
    case "kitchen_delay":
    case "panic_alert":
    case "fraud_alert":
    case "approval_request":
    case "incident_reported":
    case "temperature_alert":
    case "reservation":
    case "leave_request":
    case "leave_decision":
    case "payroll":
    default:
      // Mirrors every other web socket event that calls playNotificationChime()
      return { sound: "notification.wav", channelId: "notification" };
  }
}

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
    const { sound, channelId } = soundForType(type);
    await sendPush({
      to: tokens,
      title: payload.title,
      body: payload.body,
      data: { ...payload.data, type },
      sound,
      channelId,
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
    const { sound, channelId } = soundForType(type);
    await sendPush({
      to: tokens,
      title: payload.title,
      body: payload.body,
      data: { ...payload.data, type },
      sound,
      channelId,
    });
  } catch (err) {
    logger.error({ err, type, userIds: targets }, "pushToUserIds failed");
  }
}
