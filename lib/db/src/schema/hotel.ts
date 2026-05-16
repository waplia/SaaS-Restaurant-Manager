import { pgTable, text, serial, timestamp, integer, boolean, decimal, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

// Hotel guest profile — scoped to the tenant ("hotel") so the same guest can
// be served across every outlet (restaurant) under that hotel.
export const hotelGuestsTable = pgTable("hotel_guests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  isVip: boolean("is_vip").notNull().default(false),
  allergies: text("allergies"),
  preferences: text("preferences"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => [index("hotel_guests_tenant_idx").on(t.tenantId)]);

// A guest stay = check-in/out window in a specific room. Lightweight (this
// is not a PMS) but enough to drive folios, package entitlements and
// in-house guest lookup.
export const hotelStaysTable = pgTable("hotel_stays", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  guestId: integer("guest_id").notNull().references(() => hotelGuestsTable.id),
  roomNumber: text("room_number").notNull(),
  partySize: integer("party_size").notNull().default(1),
  checkInAt: timestamp("check_in_at").notNull().defaultNow(),
  checkOutAt: timestamp("check_out_at"),
  status: text("status").notNull().default("in_house"), // in_house | checked_out | cancelled
  packageId: integer("package_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => [
  index("hotel_stays_tenant_idx").on(t.tenantId, t.status),
  index("hotel_stays_room_idx").on(t.tenantId, t.roomNumber, t.status),
]);

// Package definition (e.g. Bed & Breakfast). `mealType` decides which
// menu category counts; `dailyEntitlement` is # covers per stay-day.
export const hotelPackagesTable = pgTable("hotel_packages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  mealType: text("meal_type").notNull().default("breakfast"), // breakfast | lunch | dinner | any
  dailyEntitlement: integer("daily_entitlement").notNull().default(2),
  windowStart: text("window_start").default("06:30"),
  windowEnd: text("window_end").default("10:30"),
  eligibleCategoryIds: jsonb("eligible_category_ids").$type<number[]>(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => [index("hotel_packages_tenant_idx").on(t.tenantId)]);

// Per-stay daily ledger of entitlement consumption — used to know how many
// covers remain in today's window.
export const hotelPackageConsumptionsTable = pgTable("hotel_package_consumptions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  stayId: integer("stay_id").notNull().references(() => hotelStaysTable.id),
  packageId: integer("package_id").notNull().references(() => hotelPackagesTable.id),
  consumedOn: text("consumed_on").notNull(), // YYYY-MM-DD in hotel local TZ
  qty: integer("qty").notNull().default(1),
  orderId: integer("order_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => [index("hotel_pkg_consumption_idx").on(t.stayId, t.consumedOn)]);

// One folio per stay (or banquet event). Holds the running balance and
// status. Closing it produces an invoice and zeroes the balance.
export const hotelFoliosTable = pgTable("hotel_folios", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  stayId: integer("stay_id").references(() => hotelStaysTable.id),
  banquetEventId: integer("banquet_event_id"),
  status: text("status").notNull().default("open"), // open | closed
  balance: decimal("balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalCharges: decimal("total_charges", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalPayments: decimal("total_payments", { precision: 12, scale: 2 }).notNull().default("0.00"),
  closedAt: timestamp("closed_at"),
  invoiceNumber: text("invoice_number"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => [
  index("hotel_folios_tenant_idx").on(t.tenantId, t.status),
  index("hotel_folios_stay_idx").on(t.stayId),
]);

// Single source of truth for every line that hits a folio: orders posted
// to room, mini-bar postings, banquet roll-ups, comps and payments at
// settlement. `restaurantId` records the originating outlet for rollups.
export const hotelFolioLinesTable = pgTable("hotel_folio_lines", {
  id: serial("id").primaryKey(),
  folioId: integer("folio_id").notNull().references(() => hotelFoliosTable.id),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id),
  kind: text("kind").notNull(), // charge | payment | discount | comp
  source: text("source").notNull(), // order | minibar | housekeeping | banquet | adjustment | settlement
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  orderId: integer("order_id"),
  refType: text("ref_type"),
  refId: integer("ref_id"),
  recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => [
  index("hotel_folio_lines_folio_idx").on(t.folioId, t.createdAt),
  index("hotel_folio_lines_tenant_idx").on(t.tenantId, t.createdAt),
]);

// Banquet event tab — links to existing reservation if any. Has its own
// folio that consolidates fired orders. On close, optionally rolls into
// the host stay's folio or closes as its own invoice.
export const hotelBanquetEventsTable = pgTable("hotel_banquet_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  reservationId: integer("reservation_id"),
  name: text("name").notNull(),
  hostStayId: integer("host_stay_id").references(() => hotelStaysTable.id),
  hostName: text("host_name"),
  hostPhone: text("host_phone"),
  partySize: integer("party_size").notNull().default(1),
  scheduledAt: timestamp("scheduled_at"),
  status: text("status").notNull().default("open"), // open | closed | cancelled
  folioId: integer("folio_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => [index("hotel_banquet_tenant_idx").on(t.tenantId, t.status)]);

// Manual mini-bar posting — placeholder hand-off for a future inventory-
// backed mini-bar module. Lands as a folio line and a payments ledger row.
export const hotelMinibarPostingsTable = pgTable("hotel_minibar_postings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  stayId: integer("stay_id").notNull().references(() => hotelStaysTable.id),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull().default("0.00"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  notes: text("notes"),
  postedByUserId: integer("posted_by_user_id").references(() => usersTable.id),
  folioLineId: integer("folio_line_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => [index("hotel_minibar_stay_idx").on(t.stayId)]);

// Lightweight food request raised from a housekeeping screen. Becomes a
// kitchen order tagged "Housekeeping" and posts to the room folio when
// completed.
export const hotelHousekeepingRequestsTable = pgTable("hotel_housekeeping_requests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  stayId: integer("stay_id").notNull().references(() => hotelStaysTable.id),
  description: text("description").notNull(),
  status: text("status").notNull().default("new"), // new | in_progress | delivered | cancelled
  orderId: integer("order_id"),
  requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => [index("hotel_housekeeping_tenant_idx").on(t.tenantId, t.status)]);

export const insertHotelGuestSchema = createInsertSchema(hotelGuestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHotelGuest = z.infer<typeof insertHotelGuestSchema>;
export type HotelGuest = typeof hotelGuestsTable.$inferSelect;

export const insertHotelStaySchema = createInsertSchema(hotelStaysTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHotelStay = z.infer<typeof insertHotelStaySchema>;
export type HotelStay = typeof hotelStaysTable.$inferSelect;

export const insertHotelPackageSchema = createInsertSchema(hotelPackagesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHotelPackage = z.infer<typeof insertHotelPackageSchema>;
export type HotelPackage = typeof hotelPackagesTable.$inferSelect;

export const insertHotelFolioSchema = createInsertSchema(hotelFoliosTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHotelFolio = z.infer<typeof insertHotelFolioSchema>;
export type HotelFolio = typeof hotelFoliosTable.$inferSelect;
export type HotelFolioLine = typeof hotelFolioLinesTable.$inferSelect;

export const insertHotelBanquetEventSchema = createInsertSchema(hotelBanquetEventsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHotelBanquetEvent = z.infer<typeof insertHotelBanquetEventSchema>;
export type HotelBanquetEvent = typeof hotelBanquetEventsTable.$inferSelect;

export type HotelMinibarPosting = typeof hotelMinibarPostingsTable.$inferSelect;
export type HotelHousekeepingRequest = typeof hotelHousekeepingRequestsTable.$inferSelect;
