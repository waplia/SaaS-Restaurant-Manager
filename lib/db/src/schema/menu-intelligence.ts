import { pgTable, text, serial, timestamp, integer, boolean, decimal, jsonb, index } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { menuItemsTable, menusTable } from "./menu";
import { customersTable } from "./customers";
import { usersTable } from "./users";

// ─── Menu Heatmap + Search Analytics ──────────────────────────────
// Generic event log fed by QR-menu impressions/clicks, order joins.
export const menuItemEventsTable = pgTable(
  "menu_item_events",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    menuItemId: integer("menu_item_id").references(() => menuItemsTable.id),
    sessionId: text("session_id"),
    tableId: integer("table_id"),
    eventType: text("event_type").notNull(), // impression | click | add_to_cart | order
    variantKey: text("variant_key"), // for A/B
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    rstIdx: index("menu_item_events_restaurant_idx").on(t.restaurantId, t.createdAt),
    itemIdx: index("menu_item_events_item_idx").on(t.menuItemId),
  }),
);

export const menuSearchesTable = pgTable(
  "menu_searches",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    query: text("query").notNull(),
    normalizedQuery: text("normalized_query").notNull(),
    resultsCount: integer("results_count").notNull().default(0),
    sessionId: text("session_id"),
    tableId: integer("table_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    rstIdx: index("menu_searches_restaurant_idx").on(t.restaurantId, t.createdAt),
    normIdx: index("menu_searches_norm_idx").on(t.normalizedQuery),
  }),
);

// ─── QR Menu A/B Tests ────────────────────────────────────────────
export const menuAbExperimentsTable = pgTable("menu_ab_experiments", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id),
  name: text("name").notNull(),
  hypothesis: text("hypothesis"),
  variantAName: text("variant_a_name").notNull().default("Control"),
  variantBName: text("variant_b_name").notNull().default("Variant B"),
  variantAPrice: decimal("variant_a_price", { precision: 10, scale: 2 }),
  variantBPrice: decimal("variant_b_price", { precision: 10, scale: 2 }),
  variantADescription: text("variant_a_description"),
  variantBDescription: text("variant_b_description"),
  status: text("status").notNull().default("draft"), // draft | running | completed | archived
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  winnerVariant: text("winner_variant"), // a | b | null
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const menuAbAssignmentsTable = pgTable(
  "menu_ab_assignments",
  {
    id: serial("id").primaryKey(),
    experimentId: integer("experiment_id").notNull().references(() => menuAbExperimentsTable.id),
    sessionId: text("session_id").notNull(),
    variant: text("variant").notNull(), // a | b
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    orders: integer("orders").notNull().default(0),
    revenue: decimal("revenue", { precision: 10, scale: 2 }).notNull().default("0"),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  },
  (t) => ({
    expSessIdx: index("menu_ab_assign_exp_sess_idx").on(t.experimentId, t.sessionId),
  }),
);

// ─── Smart Modifier Templates ─────────────────────────────────────
export const modifierTemplatesTable = pgTable("modifier_templates", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  // Array of groups, each with options. Mirrors existing modifier_groups shape.
  groups: jsonb("groups").notNull().default([]),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Customer Taste Profiles ──────────────────────────────────────
export const customerTasteProfilesTable = pgTable("customer_taste_profiles", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  spicyTolerance: integer("spicy_tolerance"), // 0-5
  sweetPreference: integer("sweet_preference"), // 0-5
  preferredCuisines: text("preferred_cuisines").array().default([]),
  dietary: text("dietary").array().default([]), // veg, vegan, jain, halal, gluten_free
  allergens: text("allergens").array().default([]),
  dislikedIngredients: text("disliked_ingredients").array().default([]),
  favoriteItemIds: integer("favorite_item_ids").array().default([]),
  notes: text("notes"),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Group Ordering QR + Split Cart ───────────────────────────────
export const menuGroupSessionsTable = pgTable("menu_group_sessions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  tableId: integer("table_id"),
  code: text("code").notNull().unique(),
  status: text("status").notNull().default("open"), // open | checked_out | cancelled
  splitMode: text("split_mode").notNull().default("single"), // single | split
  createdAt: timestamp("created_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const menuGroupMembersTable = pgTable("menu_group_members", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => menuGroupSessionsTable.id),
  guestName: text("guest_name").notNull(),
  guestKey: text("guest_key").notNull(),
  isHost: boolean("is_host").notNull().default(false),
  cart: jsonb("cart").notNull().default([]),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
});

// ─── Menu Item Lifecycle ──────────────────────────────────────────
export const menuItemLifecycleTable = pgTable("menu_item_lifecycle_history", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id),
  fromState: text("from_state"),
  toState: text("to_state").notNull(), // draft | live | 86d | retired
  reason: text("reason"),
  changedBy: integer("changed_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── New Item Launch Tracker ──────────────────────────────────────
export const menuItemLaunchesTable = pgTable("menu_item_launches", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id),
  launchedAt: timestamp("launched_at").notNull().defaultNow(),
  targetOrders: integer("target_orders"),
  targetRevenue: decimal("target_revenue", { precision: 10, scale: 2 }),
  trackingWindowDays: integer("tracking_window_days").notNull().default(30),
  notes: text("notes"),
  status: text("status").notNull().default("active"), // active | success | underperforming | archived
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Photo Approval Queue ─────────────────────────────────────────
export const menuPhotoSubmissionsTable = pgTable("menu_photo_submissions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  menuItemId: integer("menu_item_id").references(() => menuItemsTable.id),
  imageUrl: text("image_url").notNull(),
  caption: text("caption"),
  submittedBy: integer("submitted_by").references(() => usersTable.id),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  reviewedBy: integer("reviewed_by").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Brand Asset Library ──────────────────────────────────────────
export const brandAssetsTable = pgTable("brand_assets", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // logo | font | dish_photo | color_palette | other
  fileUrl: text("file_url"),
  thumbnailUrl: text("thumbnail_url"),
  meta: jsonb("meta"),
  tags: text("tags").array().default([]),
  uploadedBy: integer("uploaded_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
