import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { menuItemsTable } from "./menu";
import { restaurantsTable } from "./restaurants";

export const menuItemAiDraftsTable = pgTable(
  "menu_item_ai_drafts",
  {
    id: serial("id").primaryKey(),
    menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("menu_item_ai_drafts_item_kind_idx").on(t.menuItemId, t.kind, t.createdAt),
  ],
);

export type MenuItemAiDraft = typeof menuItemAiDraftsTable.$inferSelect;
