import { pgTable, serial, integer, text, boolean, jsonb, timestamp, decimal, index, uniqueIndex } from "drizzle-orm/pg-core";
import { restaurantsTable, branchesTable } from "./restaurants";
import { usersTable } from "./users";

// Review QR ─ owner-configured per branch. The public feedback page is keyed
// by qrCode so the same QR survives renames / branch moves.
export const reviewQrsTable = pgTable("review_qrs", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  qrCode: text("qr_code").notNull().unique(), // public token used in URL
  title: text("title").notNull().default("How was your experience?"),
  customMessage: text("custom_message"),
  thankYouMessage: text("thank_you_message").notNull().default("Thanks for your feedback!"),
  negativeFeedbackMessage: text("negative_feedback_message").notNull().default("Sorry to hear that. We'd love a chance to make it right."),
  googleReviewUrl: text("google_review_url"),
  googlePlaceId: text("google_place_id"),
  positiveThreshold: integer("positive_threshold").notNull().default(4), // ≥ this routes to Google
  showGoogleButtonOnNegative: boolean("show_google_button_on_negative").notNull().default(false),
  aiAssistEnabled: boolean("ai_assist_enabled").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  restIdx: index("review_qrs_restaurant_idx").on(t.restaurantId),
}));

export const reviewQrScansTable = pgTable("review_qr_scans", {
  id: serial("id").primaryKey(),
  qrId: integer("qr_id").notNull().references(() => reviewQrsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  event: text("event").notNull(), // scan | rated | google_redirect | submitted_negative
  rating: integer("rating"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  qrIdx: index("review_qr_scans_qr_idx").on(t.qrId, t.createdAt),
  restIdx: index("review_qr_scans_restaurant_idx").on(t.restaurantId, t.createdAt),
}));

// Private 1–3★ feedback collected via the QR funnel. Stays internal.
export const customerFeedbackTable = pgTable("customer_feedback", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  qrId: integer("qr_id").references(() => reviewQrsTable.id, { onDelete: "set null" }),
  rating: integer("rating").notNull(),
  category: text("category"), // food | staff | delivery | hygiene | pricing | other
  comment: text("comment"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  source: text("source").notNull().default("qr"), // qr | manual
  selectedTags: jsonb("selected_tags").$type<string[]>().notNull().default([]),
  aiDraftText: text("ai_draft_text"),
  aiDraftRequestLogId: integer("ai_draft_request_log_id"),
  copiedDraft: boolean("copied_draft").notNull().default(false),
  googleRedirected: boolean("google_redirected").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  restIdx: index("customer_feedback_restaurant_idx").on(t.restaurantId, t.createdAt),
  ratingIdx: index("customer_feedback_rating_idx").on(t.restaurantId, t.rating),
}));

// Reviews fetched from Google Business Profile or pasted manually for AI reply.
export const externalReviewsTable = pgTable("external_reviews", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  source: text("source").notNull().default("manual"), // manual | gbp
  externalId: text("external_id"), // GBP review name / id when applicable
  authorName: text("author_name"),
  rating: integer("rating"),
  body: text("body").notNull(),
  postedAt: timestamp("posted_at"),
  sentiment: text("sentiment"), // positive | neutral | negative | angry
  category: text("category"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  restIdx: index("external_reviews_restaurant_idx").on(t.restaurantId, t.createdAt),
  uniqExternal: uniqueIndex("external_reviews_external_idx").on(t.restaurantId, t.source, t.externalId),
}));

// AI-generated reply suggestions for a review. One review can have many
// suggestions (regenerate / different tones); only one may be marked posted.
export const reviewRepliesTable = pgTable("review_replies", {
  id: serial("id").primaryKey(),
  externalReviewId: integer("external_review_id").references(() => externalReviewsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  reviewSnapshot: text("review_snapshot"), // copy of the review body so it survives even if external row is gone
  tone: text("tone").notNull().default("professional"),
  draftReply: text("draft_reply").notNull(),
  finalReply: text("final_reply"),
  status: text("status").notNull().default("draft"), // draft | edited | posted | discarded
  postedAt: timestamp("posted_at"),
  postedBy: integer("posted_by").references(() => usersTable.id, { onDelete: "set null" }),
  postedTo: text("posted_to"), // gbp | copy | manual
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  restIdx: index("review_replies_restaurant_idx").on(t.restaurantId, t.createdAt),
}));

// Manager workflow for recovering a negative review or 1–3★ feedback.
export const feedbackRecoveryTasksTable = pgTable("feedback_recovery_tasks", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  feedbackId: integer("feedback_id").references(() => customerFeedbackTable.id, { onDelete: "set null" }),
  externalReviewId: integer("external_review_id").references(() => externalReviewsTable.id, { onDelete: "set null" }),
  category: text("category"),
  sentiment: text("sentiment"),
  aiSummary: text("ai_summary"),
  suggestedResponse: text("suggested_response"),
  suggestedCompensation: text("suggested_compensation"), // apology | discount | dessert | callback | refund_review
  status: text("status").notNull().default("new"), // new | contacted | resolved | ignored
  assignedTo: integer("assigned_to").references(() => usersTable.id, { onDelete: "set null" }),
  resolutionNotes: text("resolution_notes"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  restIdx: index("feedback_recovery_tasks_restaurant_idx").on(t.restaurantId, t.status),
}));

export type ReviewQr = typeof reviewQrsTable.$inferSelect;
export type CustomerFeedback = typeof customerFeedbackTable.$inferSelect;
export type ExternalReview = typeof externalReviewsTable.$inferSelect;
export type ReviewReply = typeof reviewRepliesTable.$inferSelect;
export type FeedbackRecoveryTask = typeof feedbackRecoveryTasksTable.$inferSelect;
