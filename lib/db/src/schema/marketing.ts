import { pgTable, serial, varchar, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { restaurantsTable } from "./restaurants";

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  restaurantName: varchar("restaurant_name", { length: 200 }),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 200 }).notNull(),
  city: varchar("city", { length: 120 }),
  outletCount: integer("outlet_count"),
  businessType: varchar("business_type", { length: 80 }),
  currentSoftware: varchar("current_software", { length: 200 }),
  preferredDateTime: varchar("preferred_date_time", { length: 120 }),
  features: text("features"),
  message: text("message"),
  sourcePage: varchar("source_page", { length: 120 }).notNull().default("contact"),
  status: varchar("status", { length: 30 }).notNull().default("new"),
  notes: text("notes"),
  assignedTo: integer("assigned_to").references(() => usersTable.id, { onDelete: "set null" }),
  followUpAt: timestamp("follow_up_at", { withTimezone: true }),
  followUpNote: text("follow_up_note"),
  convertedRestaurantId: integer("converted_restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const leadNotesTable = pgTable("lead_notes", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id").references(() => usersTable.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const leadActivityTable = pgTable("lead_activity", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  type: varchar("type", { length: 50 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const blogPostsTable = pgTable("blog_posts", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 200 }).notNull().unique(),
  title: varchar("title", { length: 300 }).notNull(),
  excerpt: text("excerpt"),
  content: text("content").notNull(),
  coverImage: varchar("cover_image", { length: 500 }),
  category: varchar("category", { length: 80 }).notNull().default("guides"),
  tags: text("tags"),
  author: varchar("author", { length: 120 }).notNull().default("TableTrack Team"),
  readMinutes: integer("read_minutes").notNull().default(5),
  published: boolean("published").notNull().default(true),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Lead = typeof leadsTable.$inferSelect;
export type NewLead = typeof leadsTable.$inferInsert;
export type LeadNote = typeof leadNotesTable.$inferSelect;
export type LeadActivity = typeof leadActivityTable.$inferSelect;
export type BlogPost = typeof blogPostsTable.$inferSelect;
export type NewBlogPost = typeof blogPostsTable.$inferInsert;
