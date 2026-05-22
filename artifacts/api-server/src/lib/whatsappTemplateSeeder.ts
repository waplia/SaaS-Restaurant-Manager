/**
 * Seeder for the 40 default WhatsApp templates (Task #533).
 *
 * Names match the spec exactly (see `.local/tasks/task-533.md` §10):
 *   A. Authentication (5)  — khanalagao_*
 *   B. Restaurant Utility (15) — restaurant_*
 *   C. Internal/Staff Utility (5) — staff_* / owner_* / support_*
 *   D. Marketing (15) — restaurant_*_offer / promo / launch / cart / sale
 *
 * All seeds land as `scope='platform'`, `status='draft'`,
 * `createdBySuperAdmin=true`. They are never auto-submitted to Meta;
 * Super Admin reviews and clicks Submit explicitly.
 *
 * Idempotent: skips templates whose name already exists at platform scope.
 *
 * Compliance notes baked into the seeds:
 *  - MARKETING templates include an opt-out line ("Reply STOP to unsubscribe")
 *    so the compliance checker passes without manual edits.
 *  - UTILITY templates avoid promotional language (no "off", "discount",
 *    "sale", "coupon", "promo", percentage offers, etc.).
 *  - AUTHENTICATION templates contain only OTP/security wording and a {{1}}
 *    code placeholder.
 *  - Every {{n}} placeholder has a mapped variable with a sample value.
 */

import { db, whatsappTemplatesTable } from "./db";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "./logger";

interface SeedTpl {
  name: string;
  description: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  defaultForEvent?: string;
  language?: string;
  headerType?: "none" | "text" | "image";
  headerText?: string;
  bodyText: string;
  footerText?: string;
  buttons?: Array<{ type: "quick_reply" | "url" | "phone_number"; text: string; url?: string; phone?: string }>;
  variables: Array<{ index: number; key: string; label: string; example: string }>;
  allowRestaurantEdit?: boolean;
}

function samplesFromVars(vars: SeedTpl["variables"], header?: string[]): { header?: string[]; body?: string[] } {
  const out: { header?: string[]; body?: string[] } = {};
  if (header && header.length) out.header = header;
  if (vars.length) out.body = vars.sort((a, b) => a.index - b.index).map(v => v.example);
  return out;
}

// Standard opt-out line appended to every MARKETING template body so the
// compliance check passes; restaurants can remove it only if they replace
// it with a quick-reply opt-out button.
const OPT_OUT = " Reply STOP to unsubscribe.";

const SEEDS: SeedTpl[] = [
  // ════════════════════════════════════════════════════════════
  // A. AUTHENTICATION (5)
  // ════════════════════════════════════════════════════════════
  {
    name: "khanalagao_login_otp",
    description: "OTP for customer/owner login.",
    category: "AUTHENTICATION",
    defaultForEvent: "auth.otp_login",
    bodyText: "{{1}} is your KhanaLagao login verification code. It expires in {{2}} minutes. Do not share this code with anyone.",
    variables: [
      { index: 1, key: "otp_code", label: "OTP code", example: "846123" },
      { index: 2, key: "otp_ttl_minutes", label: "Minutes to expire", example: "10" },
    ],
  },
  {
    name: "khanalagao_signup_otp",
    description: "OTP for new account signup.",
    category: "AUTHENTICATION",
    defaultForEvent: "auth.signup_otp",
    bodyText: "{{1}} is your KhanaLagao signup verification code. It expires in {{2}} minutes. Do not share this code with anyone.",
    variables: [
      { index: 1, key: "otp_code", label: "OTP code", example: "274910" },
      { index: 2, key: "otp_ttl_minutes", label: "Minutes to expire", example: "10" },
    ],
  },
  {
    name: "khanalagao_2fa_otp",
    description: "Two-factor authentication code.",
    category: "AUTHENTICATION",
    defaultForEvent: "auth.two_factor_otp",
    bodyText: "{{1}} is your KhanaLagao two-factor security code. It expires in {{2}} minutes. Do not share this code with anyone.",
    variables: [
      { index: 1, key: "otp_code", label: "2FA code", example: "563412" },
      { index: 2, key: "otp_ttl_minutes", label: "Minutes to expire", example: "5" },
    ],
  },
  {
    name: "khanalagao_password_reset_otp",
    description: "Password reset verification code.",
    category: "AUTHENTICATION",
    defaultForEvent: "auth.password_reset",
    bodyText: "{{1}} is your KhanaLagao password reset verification code. It expires in {{2}} minutes. Do not share this code with anyone.",
    variables: [
      { index: 1, key: "otp_code", label: "Reset code", example: "918273" },
      { index: 2, key: "otp_ttl_minutes", label: "Minutes to expire", example: "15" },
    ],
  },
  {
    name: "khanalagao_new_device_otp",
    description: "New-device sign-in verification code.",
    category: "AUTHENTICATION",
    defaultForEvent: "auth.new_device_otp",
    bodyText: "{{1}} is your KhanaLagao new-device sign-in verification code. It expires in {{2}} minutes. Do not share this code with anyone.",
    variables: [
      { index: 1, key: "otp_code", label: "Sign-in code", example: "112358" },
      { index: 2, key: "otp_ttl_minutes", label: "Minutes to expire", example: "10" },
    ],
  },

  // ════════════════════════════════════════════════════════════
  // B. RESTAURANT UTILITY (15)
  // ════════════════════════════════════════════════════════════
  {
    name: "restaurant_order_placed",
    description: "Sent the moment a customer places an order (before payment / staff acceptance).",
    category: "UTILITY",
    defaultForEvent: "order.placed",
    bodyText: "Hi {{1}}, we've received your order #{{2}} at {{3}}. Total: {{4}}. We'll send another update when the kitchen starts preparing it.",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "order_number", label: "Order number", example: "1042" },
      { index: 3, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 4, key: "order_total", label: "Order total", example: "₹650" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_order_confirmed",
    description: "Order confirmation to customer (payment received).",
    category: "UTILITY",
    defaultForEvent: "order.confirmed",
    bodyText: "Hi {{1}}, your order #{{2}} at {{3}} is confirmed. Total: {{4}}. Thank you!",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "order_number", label: "Order number", example: "1042" },
      { index: 3, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 4, key: "order_total", label: "Order total", example: "₹650" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_order_preparing",
    description: "Order is being prepared.",
    category: "UTILITY",
    defaultForEvent: "order.preparing",
    bodyText: "Hi {{1}}, the kitchen has started preparing your order #{{2}} at {{3}}. Estimated time: {{4}} minutes.",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "order_number", label: "Order number", example: "1042" },
      { index: 3, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 4, key: "order_eta_minutes", label: "ETA minutes", example: "20" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_order_ready",
    description: "Order ready notification.",
    category: "UTILITY",
    defaultForEvent: "order.ready",
    bodyText: "Hi {{1}}, your order #{{2}} at {{3}} is ready. Please collect it at the counter.",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "order_number", label: "Order number", example: "1042" },
      { index: 3, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_takeaway_ready",
    description: "Takeaway ready for pickup.",
    category: "UTILITY",
    defaultForEvent: "order.takeaway_ready",
    bodyText: "Hi {{1}}, your takeaway order #{{2}} from {{3}} is packed and ready for pickup.",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "order_number", label: "Order number", example: "1042" },
      { index: 3, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
    ],
  },
  {
    name: "restaurant_delivery_update",
    description: "Delivery status update.",
    category: "UTILITY",
    defaultForEvent: "order.delivery_update",
    bodyText: "Hi {{1}}, your order #{{2}} from {{3}} is now {{4}}. Estimated arrival: {{5}} minutes.",
    buttons: [{ type: "url", text: "Track order", url: "https://example.com/track/{{1}}" }],
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "order_number", label: "Order number", example: "1042" },
      { index: 3, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 4, key: "order_status", label: "Status", example: "out for delivery" },
      { index: 5, key: "order_eta_minutes", label: "ETA minutes", example: "12" },
    ],
  },
  {
    name: "restaurant_payment_link",
    description: "Payment link for an outstanding bill.",
    category: "UTILITY",
    defaultForEvent: "billing.payment_link",
    bodyText: "Hi {{1}}, your bill at {{2}} is {{3}}. Please complete payment using the link below.",
    buttons: [{ type: "url", text: "Pay now", url: "https://example.com/pay/{{1}}" }],
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "invoice_amount", label: "Amount due", example: "₹1,250" },
    ],
  },
  {
    name: "restaurant_invoice_sent",
    description: "Invoice/receipt sent after order.",
    category: "UTILITY",
    defaultForEvent: "billing.invoice_sent",
    bodyText: "Hi {{1}}, your invoice {{2}} for {{3}} from {{4}} is ready. View it using the link below.",
    buttons: [{ type: "url", text: "View invoice", url: "https://example.com/invoice/{{1}}" }],
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "invoice_number", label: "Invoice number", example: "INV-00045" },
      { index: 3, key: "invoice_amount", label: "Invoice amount", example: "₹1,250" },
      { index: 4, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
    ],
  },
  {
    name: "restaurant_reservation_confirmed",
    description: "Reservation confirmation.",
    category: "UTILITY",
    defaultForEvent: "reservation.confirmed",
    bodyText: "Hi {{1}}, your reservation at {{2}} for {{3}} on {{4}} is confirmed. We look forward to seeing you.",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "order_items_count", label: "Guests", example: "4 guests" },
      { index: 4, key: "offer_expires_on", label: "Date/time", example: "Fri 23 May, 8:00 PM" },
    ],
  },
  {
    name: "restaurant_reservation_reminder",
    description: "Reservation reminder.",
    category: "UTILITY",
    defaultForEvent: "reservation.reminder",
    bodyText: "Hi {{1}}, this is a reminder of your reservation at {{2}} on {{3}} for {{4}}.",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "offer_expires_on", label: "Date/time", example: "Fri 23 May, 8:00 PM" },
      { index: 4, key: "order_items_count", label: "Guests", example: "4 guests" },
    ],
  },
  {
    name: "restaurant_review_request",
    description: "Post-order review request.",
    category: "UTILITY",
    defaultForEvent: "review.request",
    bodyText: "Hi {{1}}, thanks for ordering from {{2}}. Could you take a moment to share your feedback using the link below?",
    buttons: [{ type: "url", text: "Share feedback", url: "https://example.com/review/{{1}}" }],
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
    ],
  },
  {
    name: "restaurant_refund_processed",
    description: "Refund processed for an order.",
    category: "UTILITY",
    defaultForEvent: "order.refunded",
    bodyText: "Hi {{1}}, a refund of {{2}} for order #{{3}} at {{4}} has been processed. It may take 5–10 business days to reflect.",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "order_total", label: "Refund amount", example: "₹650" },
      { index: 3, key: "order_number", label: "Order number", example: "1042" },
      { index: 4, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
    ],
  },
  {
    name: "restaurant_loyalty_points_update",
    description: "Loyalty point balance update.",
    category: "UTILITY",
    defaultForEvent: "loyalty.points_update",
    bodyText: "Hi {{1}}, you earned {{2}} loyalty points on order #{{3}} at {{4}}. New balance: {{5}}.",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "loyalty_points", label: "Points earned", example: "65" },
      { index: 3, key: "order_number", label: "Order number", example: "1042" },
      { index: 4, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 5, key: "loyalty_points", label: "Total balance", example: "1,250" },
    ],
  },
  {
    name: "restaurant_tiffin_plan_reminder",
    description: "Reminder before a tiffin plan delivery window.",
    category: "UTILITY",
    defaultForEvent: "tiffin.reminder",
    bodyText: "Hi {{1}}, your {{2}} tiffin from {{3}} is scheduled to arrive around {{4}}. Reply here if you need to skip today.",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "order_status", label: "Meal", example: "lunch" },
      { index: 3, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 4, key: "offer_expires_on", label: "Delivery time", example: "12:30 PM" },
    ],
  },
  {
    name: "restaurant_event_booking_confirmed",
    description: "Event/private dining booking confirmed.",
    category: "UTILITY",
    defaultForEvent: "event.booking_confirmed",
    bodyText: "Hi {{1}}, your event booking at {{2}} for {{3}} on {{4}} is confirmed. Booking reference: {{5}}.",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "order_items_count", label: "Guests", example: "20 guests" },
      { index: 4, key: "offer_expires_on", label: "Date", example: "Sat 31 May, 7:00 PM" },
      { index: 5, key: "order_number", label: "Reference", example: "EVT-2026-018" },
    ],
  },
  {
    name: "restaurant_quote_followup",
    description: "Follow-up on a catering/event quotation.",
    category: "UTILITY",
    defaultForEvent: "lead.quote_followup",
    bodyText: "Hi {{1}}, this is {{2}} following up on the quotation we shared for your enquiry. Please let us know if you have any questions.",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
    ],
  },

  // ════════════════════════════════════════════════════════════
  // C. INTERNAL / STAFF UTILITY (5)
  // ════════════════════════════════════════════════════════════
  {
    // Sent by /restaurants/:id/staff create flow when the inviter provided
    // a phone number. UTILITY (not AUTHENTICATION) because it isn't an OTP.
    name: "khanalagao_staff_invite",
    description: "Invitation to a newly-added staff member with sign-in link.",
    category: "UTILITY",
    defaultForEvent: "staff.invite",
    bodyText: "Hi {{1}}, {{2}} added you to {{3}} on {{6}} as {{4}}. Sign in here: {{5}} — use Forgot Password to set your password.",
    variables: [
      { index: 1, key: "name", label: "Staff name", example: "Ravi" },
      { index: 2, key: "inviterName", label: "Inviter", example: "Anita" },
      { index: 3, key: "restaurant", label: "Restaurant", example: "Spice Garden" },
      { index: 4, key: "role", label: "Role", example: "waiter" },
      { index: 5, key: "acceptUrl", label: "Sign-in URL", example: "https://app.khanalagao.com/app/forgot-password?email=ravi@example.com" },
      { index: 6, key: "appName", label: "App name", example: "KhanaLagao" },
    ],
  },
  {
    name: "staff_shift_reminder",
    description: "Reminder for staff shift.",
    category: "UTILITY",
    defaultForEvent: "staff.shift_reminder",
    bodyText: "Hi {{1}}, your shift at {{2}} starts at {{3}}. Please reach the venue 10 minutes early.",
    variables: [
      { index: 1, key: "customer_first_name", label: "Staff name", example: "Ravi" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "offer_expires_on", label: "Shift start", example: "Today, 6:00 PM" },
    ],
  },
  {
    name: "staff_task_assigned",
    description: "Task assigned to staff member.",
    category: "UTILITY",
    defaultForEvent: "staff.task_assigned",
    bodyText: "Hi {{1}}, a new task has been assigned to you at {{2}}: {{3}}. Due by {{4}}.",
    variables: [
      { index: 1, key: "customer_first_name", label: "Staff name", example: "Ravi" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "order_status", label: "Task summary", example: "Restock cold storage" },
      { index: 4, key: "offer_expires_on", label: "Due by", example: "Today, 10:00 PM" },
    ],
  },
  {
    name: "owner_low_stock_alert",
    description: "Inventory low stock alert for owner.",
    category: "UTILITY",
    defaultForEvent: "inventory.low_stock",
    bodyText: "Hi {{1}}, low stock alert at {{2}}: {{3}} is below the reorder level. Current stock: {{4}}.",
    variables: [
      { index: 1, key: "customer_first_name", label: "Owner name", example: "Owner" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "order_status", label: "Item", example: "Basmati rice (5kg)" },
      { index: 4, key: "order_items_count", label: "Stock left", example: "3 packs" },
    ],
  },
  {
    name: "owner_daily_summary",
    description: "Daily summary digest for owner.",
    category: "UTILITY",
    defaultForEvent: "tenant.daily_summary",
    bodyText: "Daily summary for {{1}}: orders {{2}}, revenue {{3}}, average ticket {{4}}.",
    variables: [
      { index: 1, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 2, key: "order_items_count", label: "Order count", example: "84" },
      { index: 3, key: "order_total", label: "Revenue", example: "₹48,200" },
      { index: 4, key: "order_total", label: "Avg ticket", example: "₹574" },
    ],
  },
  {
    name: "support_ticket_update",
    description: "Support ticket status update.",
    category: "UTILITY",
    defaultForEvent: "support.ticket_update",
    bodyText: "Hi {{1}}, your support ticket #{{2}} has been updated to status: {{3}}. Reply here if you need more help.",
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "order_number", label: "Ticket id", example: "8421" },
      { index: 3, key: "order_status", label: "Status", example: "Resolved" },
    ],
  },

  // ════════════════════════════════════════════════════════════
  // D. MARKETING (15) — all include opt-out for compliance
  // ════════════════════════════════════════════════════════════
  {
    name: "restaurant_weekend_offer",
    description: "Weekend promotional broadcast.",
    category: "MARKETING",
    defaultForEvent: "marketing.weekend_offer",
    bodyText: "Hi {{1}}, this weekend at {{2}} enjoy {{3}} with code {{4}}." + OPT_OUT,
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "offer_title", label: "Offer", example: "a buy-one-get-one biryani" },
      { index: 4, key: "offer_code", label: "Offer code", example: "WKND26" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_birthday_offer",
    description: "Birthday celebration + offer.",
    category: "MARKETING",
    defaultForEvent: "customer.birthday",
    bodyText: "Happy birthday {{1}}! 🎂 Celebrate with us at {{2}} and enjoy {{3}} using code {{4}}." + OPT_OUT,
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "loyalty_reward_name", label: "Gift", example: "a complimentary dessert" },
      { index: 4, key: "offer_code", label: "Offer code", example: "BDAY26" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_anniversary_offer",
    description: "Anniversary celebration + offer.",
    category: "MARKETING",
    defaultForEvent: "customer.anniversary",
    bodyText: "Happy anniversary {{1}}! Mark the day with us at {{2}} — {{3}} with code {{4}}." + OPT_OUT,
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "offer_title", label: "Offer", example: "a complimentary cake" },
      { index: 4, key: "offer_code", label: "Offer code", example: "ANNIV26" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_winback_offer",
    description: "Win-back inactive customers.",
    category: "MARKETING",
    defaultForEvent: "customer.winback",
    bodyText: "Hi {{1}}, we miss you at {{2}}. Come back this week and enjoy {{3}} with code {{4}}." + OPT_OUT,
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "offer_title", label: "Offer", example: "a complimentary starter" },
      { index: 4, key: "offer_code", label: "Offer code", example: "COMEBACK" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_new_item_launch",
    description: "New menu item launch.",
    category: "MARKETING",
    defaultForEvent: "marketing.new_item_launch",
    bodyText: "Exciting news {{1}}! {{2}} just launched {{3}}. Be among the first to try it." + OPT_OUT,
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "offer_title", label: "New item", example: "a Truffle Mushroom Risotto" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_festival_offer",
    description: "Festival-themed offer.",
    category: "MARKETING",
    defaultForEvent: "marketing.festival_offer",
    bodyText: "{{1}} wishes you a joyous {{2}}! Celebrate at {{3}} with {{4}} using code {{5}}." + OPT_OUT,
    variables: [
      { index: 1, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 2, key: "campaign_name", label: "Festival", example: "Diwali" },
      { index: 3, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 4, key: "offer_title", label: "Offer", example: "a festival thali" },
      { index: 5, key: "offer_code", label: "Offer code", example: "DIWALI26" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_loyalty_reward",
    description: "Loyalty reward earned promotion.",
    category: "MARKETING",
    defaultForEvent: "loyalty.reward_unlocked",
    bodyText: "Way to go {{1}}! You've unlocked {{2}} at {{3}}. Show this message on your next visit to redeem." + OPT_OUT,
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "loyalty_reward_name", label: "Reward", example: "a complimentary mango lassi" },
      { index: 3, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_membership_offer",
    description: "Membership / subscription offer.",
    category: "MARKETING",
    defaultForEvent: "marketing.membership_offer",
    bodyText: "Hi {{1}}, become a {{2}} member at {{3}} and enjoy {{4}}. Join using code {{5}}." + OPT_OUT,
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "plan_name", label: "Membership name", example: "Gold" },
      { index: 3, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 4, key: "offer_title", label: "Perk", example: "year-round priority seating" },
      { index: 5, key: "offer_code", label: "Offer code", example: "GOLD26" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_abandoned_cart",
    description: "Abandoned cart reminder.",
    category: "MARKETING",
    defaultForEvent: "marketing.cart_abandoned",
    bodyText: "Hi {{1}}, your favourites at {{2}} are still in your cart. Finish your order in one tap." + OPT_OUT,
    buttons: [{ type: "url", text: "Resume order", url: "https://example.com/cart" }],
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_flash_sale",
    description: "Limited-time flash sale broadcast.",
    category: "MARKETING",
    defaultForEvent: "marketing.flash_sale",
    bodyText: "⚡ Flash event at {{1}} — {{2}} for the next {{3}}. Use code {{4}}." + OPT_OUT,
    variables: [
      { index: 1, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 2, key: "offer_title", label: "Offer", example: "a buy-one-get-one main" },
      { index: 3, key: "order_eta_minutes", label: "Window", example: "3 hours" },
      { index: 4, key: "offer_code", label: "Offer code", example: "FLASH26" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_tiffin_promo",
    description: "Tiffin plan promotional broadcast.",
    category: "MARKETING",
    defaultForEvent: "marketing.tiffin_promo",
    bodyText: "Hi {{1}}, try our {{2}} tiffin plan at {{3}} starting at {{4}} per week. Code {{5}} for first-week perks." + OPT_OUT,
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "plan_name", label: "Plan name", example: "Home-style North Indian" },
      { index: 3, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 4, key: "plan_amount", label: "Price", example: "₹1,199" },
      { index: 5, key: "offer_code", label: "Offer code", example: "TIFFIN26" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_catering_promo",
    description: "Catering services promotion.",
    category: "MARKETING",
    defaultForEvent: "marketing.catering_promo",
    bodyText: "Hi {{1}}, planning an event? {{2}} offers full catering from {{3}}. Mention code {{4}} for priority booking." + OPT_OUT,
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "plan_amount", label: "Per-head price", example: "₹499 per head" },
      { index: 4, key: "offer_code", label: "Offer code", example: "CATER26" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_review_boost_offer",
    description: "Review-based loyalty offer.",
    category: "MARKETING",
    defaultForEvent: "marketing.review_boost",
    bodyText: "Hi {{1}}, share a quick review of {{2}} and we'll add {{3}} loyalty points to your account." + OPT_OUT,
    buttons: [{ type: "url", text: "Share review", url: "https://example.com/review/{{1}}" }],
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "loyalty_points", label: "Bonus points", example: "100" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_happy_hour",
    description: "Happy hour broadcast.",
    category: "MARKETING",
    defaultForEvent: "marketing.happy_hour",
    bodyText: "Hi {{1}}, happy hour at {{2}} runs from {{3}} today — {{4}}. See you there!" + OPT_OUT,
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 3, key: "offer_expires_on", label: "Hours", example: "5–8 PM" },
      { index: 4, key: "offer_title", label: "Highlight", example: "buy-one-get-one mocktails" },
    ],
    allowRestaurantEdit: true,
  },
  {
    name: "restaurant_combo_offer",
    description: "Combo meal promotion.",
    category: "MARKETING",
    defaultForEvent: "marketing.combo_offer",
    bodyText: "Hi {{1}}, try our new {{2}} combo at {{3}} for {{4}}. Use code {{5}}." + OPT_OUT,
    variables: [
      { index: 1, key: "customer_first_name", label: "First name", example: "Anita" },
      { index: 2, key: "offer_title", label: "Combo name", example: "Family Feast" },
      { index: 3, key: "restaurant_name", label: "Restaurant", example: "Spice Garden" },
      { index: 4, key: "plan_amount", label: "Combo price", example: "₹999" },
      { index: 5, key: "offer_code", label: "Offer code", example: "COMBO26" },
    ],
    allowRestaurantEdit: true,
  },
];

export async function seedDefaultWhatsAppTemplates(): Promise<{ inserted: number; skipped: number }> {
  if (SEEDS.length === 0) return { inserted: 0, skipped: 0 };

  const existing = await db.select({ name: whatsappTemplatesTable.name, language: whatsappTemplatesTable.language })
    .from(whatsappTemplatesTable)
    .where(and(eq(whatsappTemplatesTable.scope, "platform"), isNull(whatsappTemplatesTable.restaurantId)));
  const haveKey = new Set(existing.map(r => `${r.name}::${r.language}`));

  let inserted = 0, skipped = 0;
  for (const t of SEEDS) {
    const lang = t.language ?? "en";
    if (haveKey.has(`${t.name}::${lang}`)) { skipped++; continue; }
    const bodyPreview = t.bodyText.replace(/\s+/g, " ").slice(0, 500);
    const samples = samplesFromVars(t.variables, t.headerType === "text" && t.headerText ? [t.variables[0]?.example ?? "example"] : undefined);
    await db.insert(whatsappTemplatesTable).values({
      scope: "platform",
      restaurantId: null,
      name: t.name,
      language: lang,
      category: t.category,
      status: "draft",
      bodyPreview,
      defaultForEvent: t.defaultForEvent ?? null,
      description: t.description,
      headerType: t.headerType ?? "none",
      headerText: t.headerText ?? null,
      headerMediaUrl: null,
      bodyText: t.bodyText,
      footerText: t.footerText ?? null,
      buttonsJson: t.buttons ?? [],
      variablesJson: t.variables,
      sampleValuesJson: samples,
      allowRestaurantEdit: t.allowRestaurantEdit ?? false,
      assignedPlansJson: [],
      assignedRestaurantsJson: [],
      raw: {},
      metaResponseJson: {},
      createdBySuperAdmin: true,
    }).onConflictDoNothing();
    inserted++;
  }
  logger.info({ inserted, skipped, total: SEEDS.length }, "Seeded default WhatsApp templates");
  return { inserted, skipped };
}

export const DEFAULT_WHATSAPP_TEMPLATE_COUNT = SEEDS.length;
