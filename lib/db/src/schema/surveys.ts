import { pgTable, serial, integer, text, boolean, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const surveysTable = pgTable("surveys", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  thankYouMessage: text("thank_you_message").notNull().default("Thanks for your feedback!"),
  collectName: boolean("collect_name").notNull().default(true),
  collectPhone: boolean("collect_phone").notNull().default(false),
  collectTableNumber: boolean("collect_table_number").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  responseCount: integer("response_count").notNull().default(0),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  restIdx: index("surveys_restaurant_idx").on(t.restaurantId),
  tenantIdx: index("surveys_tenant_idx").on(t.tenantId),
}));

export const surveyQuestionsTable = pgTable("survey_questions", {
  id: serial("id").primaryKey(),
  surveyId: integer("survey_id").notNull().references(() => surveysTable.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  type: text("type").notNull(),
  label: text("label").notNull(),
  required: boolean("required").notNull().default(false),
  options: jsonb("options").$type<string[]>().notNull().default([]),
  scaleMin: integer("scale_min"),
  scaleMax: integer("scale_max"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  surveyIdx: index("survey_questions_survey_idx").on(t.surveyId, t.sortOrder),
}));

export const surveyResponsesTable = pgTable("survey_responses", {
  id: serial("id").primaryKey(),
  surveyId: integer("survey_id").notNull().references(() => surveysTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  respondentName: text("respondent_name"),
  respondentPhone: text("respondent_phone"),
  tableNumber: text("table_number"),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
  ipHash: text("ip_hash"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
}, (t) => ({
  surveyIdx: index("survey_responses_survey_idx").on(t.surveyId, t.submittedAt),
  restIdx: index("survey_responses_restaurant_idx").on(t.restaurantId, t.submittedAt),
}));

export type Survey = typeof surveysTable.$inferSelect;
export type SurveyQuestion = typeof surveyQuestionsTable.$inferSelect;
export type SurveyResponse = typeof surveyResponsesTable.$inferSelect;

export const SURVEY_TYPES = ["food_quality", "service_quality", "cleanliness", "ambience", "staff_rating", "nps", "suggestion_box"] as const;
export type SurveyType = typeof SURVEY_TYPES[number];

export const SURVEY_QUESTION_TYPES = ["rating_5", "rating_10", "nps", "text_short", "text_long", "single_choice"] as const;
export type SurveyQuestionType = typeof SURVEY_QUESTION_TYPES[number];
