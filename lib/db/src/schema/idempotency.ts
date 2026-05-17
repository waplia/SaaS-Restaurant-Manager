import { pgTable, text, integer, timestamp, jsonb, uniqueIndex, serial } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

/**
 * Server-side idempotency cache for POS writes that may be retried by
 * the offline queue (web + mobile). When the client sends
 * `X-Idempotency-Key`, the middleware stores the (restaurantId, key)
 * pair along with the response so a duplicate retry — caused by a lost
 * response or an online flush of a previously-queued write — replays
 * the same response instead of producing duplicate orders/payments.
 *
 * Keys are scoped per restaurant. The `route` column is informational
 * so we can audit which endpoint produced the original write.
 */
export const idempotencyKeysTable = pgTable("idempotency_keys", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  key: text("key").notNull(),
  route: text("route").notNull(),
  method: text("method").notNull(),
  userId: integer("user_id").references(() => usersTable.id),
  statusCode: integer("status_code").notNull(),
  responseBody: jsonb("response_body"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniquePerRestaurant: uniqueIndex("idempotency_keys_restaurant_key_idx").on(t.restaurantId, t.key),
}));
