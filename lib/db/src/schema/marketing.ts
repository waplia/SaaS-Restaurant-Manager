import { pgTable, serial, varchar, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
export type BlogPost = typeof blogPostsTable.$inferSelect;
export type NewBlogPost = typeof blogPostsTable.$inferInsert;
