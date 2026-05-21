/**
 * Resolve a WhatsApp message body for a transactional order event by
 * looking up the restaurant's customised template first (so owners can
 * edit copy from the Template Center) and falling back to the platform
 * default. Returns null if no template is found — callers should fall
 * back to their hardcoded copy.
 *
 * For Baileys / Web-QR dispatch we don't gate on Meta approval status:
 * the message is sent as free-form text from the restaurant's own
 * scanned device, so any draft body the owner has saved is valid.
 */

import { and, eq, isNull, desc } from "drizzle-orm";
import { db, whatsappTemplatesTable } from "./db";
import { renderPlaceholders } from "./templateVariables";
import { logger } from "./logger";

export async function renderRestaurantEventBody(
  restaurantId: number,
  eventKey: string,
  positionalValues: Array<string | number | null | undefined>,
): Promise<string | null> {
  try {
    const [own] = await db.select({ bodyText: whatsappTemplatesTable.bodyText })
      .from(whatsappTemplatesTable)
      .where(and(
        eq(whatsappTemplatesTable.scope, "restaurant"),
        eq(whatsappTemplatesTable.restaurantId, restaurantId),
        eq(whatsappTemplatesTable.defaultForEvent, eventKey),
      ))
      .orderBy(desc(whatsappTemplatesTable.updatedAt))
      .limit(1);

    let body = own?.bodyText ?? null;
    if (!body) {
      const [platform] = await db.select({ bodyText: whatsappTemplatesTable.bodyText })
        .from(whatsappTemplatesTable)
        .where(and(
          eq(whatsappTemplatesTable.scope, "platform"),
          isNull(whatsappTemplatesTable.restaurantId),
          eq(whatsappTemplatesTable.defaultForEvent, eventKey),
        ))
        .limit(1);
      body = platform?.bodyText ?? null;
    }
    if (!body) return null;

    const valueMap: Record<string, string | number | null | undefined> = {};
    positionalValues.forEach((v, i) => { valueMap[String(i + 1)] = v; });
    return renderPlaceholders(body, valueMap);
  } catch (err) {
    logger.warn({ err, restaurantId, eventKey }, "renderRestaurantEventBody failed");
    return null;
  }
}
