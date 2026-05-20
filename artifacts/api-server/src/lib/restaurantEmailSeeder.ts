/**
 * Restaurant-side email starter pack (Task #533).
 *
 * Inserts 25 marketing/lifecycle email templates into the global
 * `email_marketing_templates` library. Restaurants can clone any of these
 * into their own campaigns from the Marketing Library tab.
 *
 * Idempotent — skips templates whose `key` already exists.
 */

import { db, emailMarketingTemplatesTable } from "./db";
import { logger } from "./logger";

interface SeedMarketingTpl {
  key: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  variables: string[];
  description?: string;
}

const SEEDS: SeedMarketingTpl[] = [
  { key: "rest_welcome_v1", name: "Welcome new customer", category: "lifecycle",
    subject: "Welcome to {{restaurant_name}}, {{customer_first_name}}!",
    body: `<p>Hi {{customer_first_name}},</p><p>We're thrilled to have you. Enjoy <strong>15% off</strong> your first order with code <strong>{{offer_code}}</strong>.</p><p>See you soon!<br/>— Team {{restaurant_name}}</p>`,
    variables: ["restaurant_name", "customer_first_name", "offer_code"] },
  { key: "rest_birthday_v1", name: "Birthday surprise", category: "lifecycle",
    subject: "🎂 Happy birthday, {{customer_first_name}}!",
    body: `<p>Hi {{customer_first_name}},</p><p>Wishing you a wonderful birthday! Drop by {{restaurant_name}} this week for a free {{loyalty_reward_name}}.</p><p>Use code <strong>{{offer_code}}</strong> — valid until {{offer_expires_on}}.</p>`,
    variables: ["customer_first_name", "restaurant_name", "loyalty_reward_name", "offer_code", "offer_expires_on"] },
  { key: "rest_anniversary_v1", name: "Anniversary offer", category: "lifecycle",
    subject: "Celebrate your special day at {{restaurant_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>Happy anniversary! Make it memorable at {{restaurant_name}} with <strong>{{offer_discount}}</strong> using code <strong>{{offer_code}}</strong>.</p>`,
    variables: ["customer_first_name", "restaurant_name", "offer_discount", "offer_code"] },
  { key: "rest_winback_30d", name: "We miss you (30 days)", category: "winback",
    subject: "It's been a while — come back to {{restaurant_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>We noticed it's been a while since your last visit. Come back and enjoy <strong>{{offer_discount}}</strong> with code <strong>{{offer_code}}</strong>.</p>`,
    variables: ["customer_first_name", "restaurant_name", "offer_discount", "offer_code"] },
  { key: "rest_winback_60d", name: "We really miss you (60 days)", category: "winback",
    subject: "{{customer_first_name}}, your favourites are calling",
    body: `<p>Hi {{customer_first_name}},</p><p>We haven't seen you in a while. Your favourites at {{restaurant_name}} are waiting — and here's <strong>{{offer_discount}}</strong> off to make it sweeter.</p>`,
    variables: ["customer_first_name", "restaurant_name", "offer_discount"] },
  { key: "rest_weekend_special", name: "Weekend special broadcast", category: "promotion",
    subject: "Weekend treat from {{restaurant_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>This weekend at {{restaurant_name}}: <strong>{{offer_title}}</strong> — {{offer_discount}}.</p><p>Use code <strong>{{offer_code}}</strong>, valid until {{offer_expires_on}}.</p>`,
    variables: ["customer_first_name", "restaurant_name", "offer_title", "offer_discount", "offer_code", "offer_expires_on"] },
  { key: "rest_flash_sale", name: "Flash sale (3-hour)", category: "promotion",
    subject: "⚡ 3-hour flash sale at {{restaurant_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>For the next 3 hours only: <strong>{{offer_discount}}</strong> on all orders. Use code <strong>{{offer_code}}</strong>.</p>`,
    variables: ["customer_first_name", "restaurant_name", "offer_discount", "offer_code"] },
  { key: "rest_festival_diwali", name: "Diwali special", category: "festival",
    subject: "Light up your Diwali with {{restaurant_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>Wishing you and your family a sparkling Diwali. Celebrate at {{restaurant_name}} with <strong>{{offer_discount}}</strong>, code <strong>{{offer_code}}</strong>.</p>`,
    variables: ["customer_first_name", "restaurant_name", "offer_discount", "offer_code"] },
  { key: "rest_festival_christmas", name: "Christmas / New Year", category: "festival",
    subject: "Holiday cheer from {{restaurant_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>Season's greetings! Treat yourself at {{restaurant_name}} with our holiday specials and {{offer_discount}} using code {{offer_code}}.</p>`,
    variables: ["customer_first_name", "restaurant_name", "offer_discount", "offer_code"] },
  { key: "rest_festival_eid", name: "Eid Mubarak", category: "festival",
    subject: "Eid Mubarak from {{restaurant_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>Eid Mubarak! Celebrate with a special menu at {{restaurant_name}} — {{offer_discount}} with code {{offer_code}}.</p>`,
    variables: ["customer_first_name", "restaurant_name", "offer_discount", "offer_code"] },
  { key: "rest_new_menu_launch", name: "New menu launch", category: "announcement",
    subject: "{{restaurant_name}} just launched a new menu!",
    body: `<p>Hi {{customer_first_name}},</p><p>We've been busy in the kitchen — and we'd love for you to be among the first to try our brand-new menu at {{restaurant_name}}.</p>`,
    variables: ["customer_first_name", "restaurant_name"] },
  { key: "rest_new_branch_open", name: "New branch opening", category: "announcement",
    subject: "New {{restaurant_name}} outlet now open!",
    body: `<p>Hi {{customer_first_name}},</p><p>We've opened a new {{restaurant_name}} at {{restaurant_address}}. Visit us and grab {{offer_discount}} with code <strong>{{offer_code}}</strong>.</p>`,
    variables: ["customer_first_name", "restaurant_name", "restaurant_address", "offer_discount", "offer_code"] },
  { key: "rest_event_invite", name: "Event invitation", category: "announcement",
    subject: "You're invited: {{campaign_name}} at {{restaurant_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>Join us for <strong>{{campaign_name}}</strong> on {{offer_expires_on}}. Limited seats — RSVP early.</p>`,
    variables: ["customer_first_name", "restaurant_name", "campaign_name", "offer_expires_on"] },
  { key: "rest_loyalty_points", name: "Loyalty points earned", category: "loyalty",
    subject: "You just earned {{loyalty_points}} points at {{restaurant_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>Nice! You earned {{loyalty_points}} points on your last order. Your total balance is now {{loyalty_points}} points.</p>`,
    variables: ["customer_first_name", "restaurant_name", "loyalty_points"] },
  { key: "rest_loyalty_tier_up", name: "Loyalty tier upgrade", category: "loyalty",
    subject: "Congrats {{customer_first_name}} — you're now {{loyalty_tier}}!",
    body: `<p>Hi {{customer_first_name}},</p><p>You've reached <strong>{{loyalty_tier}}</strong> at {{restaurant_name}} — enjoy exclusive perks on every visit.</p>`,
    variables: ["customer_first_name", "loyalty_tier", "restaurant_name"] },
  { key: "rest_referral_invite", name: "Referral invitation", category: "loyalty",
    subject: "Refer a friend, both get rewarded",
    body: `<p>Hi {{customer_first_name}},</p><p>Share your code <strong>{{loyalty_referral_code}}</strong> with a friend. They get {{offer_discount}} off their first order, and you earn loyalty points!</p>`,
    variables: ["customer_first_name", "loyalty_referral_code", "offer_discount"] },
  { key: "rest_review_request", name: "Review request", category: "feedback",
    subject: "How was your visit to {{restaurant_name}}?",
    body: `<p>Hi {{customer_first_name}},</p><p>We hope you enjoyed your meal. A 30-second review goes a long way for our team. <a href="{{restaurant_website}}/review">Share your feedback</a>.</p>`,
    variables: ["customer_first_name", "restaurant_name", "restaurant_website"] },
  { key: "rest_feedback_followup", name: "Feedback follow-up", category: "feedback",
    subject: "Quick favour, {{customer_first_name}}?",
    body: `<p>Hi {{customer_first_name}},</p><p>Your last visit to {{restaurant_name}} matters to us. Could you share a quick rating? It only takes 10 seconds.</p>`,
    variables: ["customer_first_name", "restaurant_name"] },
  { key: "rest_cart_abandoned", name: "Abandoned cart reminder", category: "lifecycle",
    subject: "Your cart at {{restaurant_name}} is waiting",
    body: `<p>Hi {{customer_first_name}},</p><p>Your favourites are still in your cart. <a href="{{restaurant_website}}/cart">Complete your order</a> in one tap.</p>`,
    variables: ["customer_first_name", "restaurant_name", "restaurant_website"] },
  { key: "rest_first_order_thanks", name: "Thanks for first order", category: "lifecycle",
    subject: "Thanks for your first order!",
    body: `<p>Hi {{customer_first_name}},</p><p>Thanks for trying {{restaurant_name}}! We'd love to see you again — here's <strong>{{offer_discount}}</strong> off your next order with code <strong>{{offer_code}}</strong>.</p>`,
    variables: ["customer_first_name", "restaurant_name", "offer_discount", "offer_code"] },
  { key: "rest_repeat_order_thanks", name: "Repeat order thanks", category: "lifecycle",
    subject: "Thanks for being a regular!",
    body: `<p>Hi {{customer_first_name}},</p><p>Thanks for ordering from {{restaurant_name}} again. Here's a token of our appreciation: {{offer_discount}} on your next visit with code {{offer_code}}.</p>`,
    variables: ["customer_first_name", "restaurant_name", "offer_discount", "offer_code"] },
  { key: "rest_seasonal_menu", name: "Seasonal menu announcement", category: "announcement",
    subject: "New seasonal menu at {{restaurant_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>The new season calls for new flavours. Explore the latest at {{restaurant_name}} starting this week.</p>`,
    variables: ["customer_first_name", "restaurant_name"] },
  { key: "rest_chef_special", name: "Chef's special spotlight", category: "promotion",
    subject: "Chef's pick this week at {{restaurant_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>This week our chef recommends a fan favourite. Reserve your table before it's gone.</p>`,
    variables: ["customer_first_name", "restaurant_name"] },
  { key: "rest_hours_changed", name: "Hours-of-operation change", category: "announcement",
    subject: "Important: updated hours at {{restaurant_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>We've updated our hours. New timings: <strong>{{order_status}}</strong>. We look forward to serving you!</p>`,
    variables: ["customer_first_name", "restaurant_name", "order_status"] },
  { key: "rest_apology_outage", name: "Apology / service outage", category: "support",
    subject: "We're sorry, {{customer_first_name}}",
    body: `<p>Hi {{customer_first_name}},</p><p>We're sorry for the recent disruption. As a small thank-you for your patience, please accept {{offer_discount}} off your next order with code {{offer_code}}.</p>`,
    variables: ["customer_first_name", "offer_discount", "offer_code"] },
];

export async function seedRestaurantEmailLibrary(): Promise<{ inserted: number; skipped: number }> {
  const existing = await db.select({ key: emailMarketingTemplatesTable.key }).from(emailMarketingTemplatesTable);
  const have = new Set(existing.map(r => r.key));
  let inserted = 0, skipped = 0;
  for (const t of SEEDS) {
    if (have.has(t.key)) { skipped++; continue; }
    const now = new Date();
    await db.insert(emailMarketingTemplatesTable).values({
      key: t.key,
      name: t.name,
      category: t.category,
      subject: t.subject,
      body: t.body,
      isGlobal: true,
      isHidden: false,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    inserted++;
  }
  logger.info({ inserted, skipped, total: SEEDS.length }, "Seeded restaurant email marketing library");
  return { inserted, skipped };
}

export const DEFAULT_RESTAURANT_EMAIL_TEMPLATE_COUNT = SEEDS.length;
