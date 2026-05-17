/**
 * Catalogue of audit-log entity strings introduced by the Task #365
 * advanced-feature plumbing. The audit table stores `entity` as a free-form
 * string column rather than a Postgres enum, so this file is the single
 * source of truth that domain tasks should import when writing audit rows
 * for the new modules. Keeping the strings centralized avoids drift between
 * the writer (api routes) and any future viewer/filter UI.
 */

export const NEW_AUDIT_ENTITIES = {
  // Operations Intelligence
  DIGITAL_TWIN_EVENT: "digital_twin_event",
  PANIC_BUTTON: "panic_button",
  SHIFT_HANDOVER: "shift_handover",
  DAILY_BRIEFING: "daily_briefing",
  CLOSING_CHECKLIST: "closing_checklist",
  CHECKLIST_SUBMISSION: "checklist_submission",
  MANAGER_APPROVAL: "manager_approval",
  INCIDENT: "incident",

  // Kitchen & Quality
  CLEANING_TASK: "cleaning_task",
  CLEANING_LOG: "cleaning_log",
  TEMPERATURE_LOG: "temperature_log",
  EQUIPMENT_ASSET: "equipment_asset",
  EQUIPMENT_MAINTENANCE: "equipment_maintenance",
  TASTE_TEST: "taste_test",
  ACCURACY_EVENT: "accuracy_event",

  // Menu Intelligence
  MENU_AB_TEST: "menu_ab_test",
  MENU_MODIFIER_TEMPLATE: "menu_modifier_template",
  MENU_TASTE_PROFILE: "menu_taste_profile",
  MENU_GROUP_QR_SESSION: "menu_group_qr_session",
  MENU_LIFECYCLE_TRANSITION: "menu_lifecycle_transition",
  MENU_LAUNCH: "menu_launch",
  MENU_PHOTO_APPROVAL: "menu_photo_approval",
  BRAND_ASSET: "brand_asset",

  // Customer Intelligence
  CUSTOMER_BLACKLIST_ENTRY: "customer_blacklist_entry",
  CUSTOMER_MOOD: "customer_mood",
  COMPLAINT_ESCALATION: "complaint_escalation",
  LOST_SALE: "lost_sale",
  ABANDONED_CART: "abandoned_cart",

  // Inventory Control
  PACKAGING_ITEM: "packaging_item",
  CONDIMENT_USAGE: "condiment_usage",
  PORTION_DRIFT_ALERT: "portion_drift_alert",
  RECIPE_VERSION: "recipe_version",

  // Marketing
  FESTIVAL_OFFER: "festival_offer",
  OFFER_CONFLICT: "offer_conflict",
  MARGIN_FLOOR: "margin_floor",
  UPSELL_RULE: "upsell_rule",

  // Delivery
  DELIVERY_QUEUE_RULE: "delivery_queue_rule",
  PREORDER_WINDOW: "preorder_window",
  DELIVERY_ZONE: "delivery_zone",

  // Staff
  TABLE_PLAN: "table_plan",
  TIP_DISTRIBUTION: "tip_distribution",
  STAFF_LEADERBOARD: "staff_leaderboard",
} as const;

export type NewAuditEntity = (typeof NEW_AUDIT_ENTITIES)[keyof typeof NEW_AUDIT_ENTITIES];

/**
 * Standard audit action verbs that the new modules should use. Existing
 * routes already use `created` / `updated` / `deleted` / `approved` /
 * `rejected` strings — these constants exist so new code references the
 * same canonical spellings.
 */
export const AUDIT_ACTIONS = {
  CREATED: "created",
  UPDATED: "updated",
  DELETED: "deleted",
  APPROVED: "approved",
  REJECTED: "rejected",
  ESCALATED: "escalated",
  CLOSED: "closed",
  TRIGGERED: "triggered",
  RESOLVED: "resolved",
  PUBLISHED: "published",
  ARCHIVED: "archived",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
