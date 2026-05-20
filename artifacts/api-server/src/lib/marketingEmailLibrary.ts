/**
 * Premium global email marketing template library.
 *
 * Beautifully designed, email-client-safe HTML templates (table layout +
 * inline styles) that restaurants can clone from the Marketing Library tab.
 *
 * Each template ships with:
 *   - a compelling subject + preheader
 *   - a hero banner with the restaurant brand color
 *   - rich body copy with merge-fields ({{customer_first_name}}, etc.)
 *   - a primary CTA button with a sensible default link
 *   - a footer with unsubscribe link
 *
 * Idempotent — keys are unique; existing rows are left untouched.
 */

import { db, emailMarketingTemplatesTable } from "./db";
import { logger } from "./logger";

interface PremiumTpl {
  key: string;
  name: string;
  category: string;
  subject: string;
  preheader: string;
  hero: string;          // <h1> text inside hero band
  body: string;          // already-wrapped HTML inserted into body section
  ctaLabel: string;
  ctaUrl: string;
  businessTypes?: string[]; // restaurant | cafe | bakery | cloud_kitchen | bar | qsr | fine_dining | catering | tiffin
  brandColor?: string;
}

// ─── HTML wrapper (email-client safe: tables + inline styles) ──────
function wrap(t: PremiumTpl): string {
  // Concrete fallback color (orange brand). Merge-fields can't be safely used
  // inside CSS values because the campaign renderer doesn't substitute tokens
  // mid-style. Restaurants who want a different brand color can edit the
  // template after cloning.
  const brand = t.brandColor ?? "#f97316";
  const heroBg = brand;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(t.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(t.preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f5;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td style="background:${heroBg};padding:32px 28px;text-align:center;color:#ffffff;">
        <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.85;margin-bottom:8px;">{{restaurant_name}}</div>
        <h1 style="margin:0;font-size:28px;line-height:1.25;font-weight:700;color:#ffffff;">${t.hero}</h1>
      </td></tr>
      <tr><td style="padding:32px 28px 8px 28px;font-size:16px;line-height:1.65;color:#111827;">
        ${t.body}
      </td></tr>
      <tr><td align="center" style="padding:8px 28px 36px 28px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:10px;background:${brand};">
          <a href="${t.ctaUrl}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(t.ctaLabel)}</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:0 28px 24px 28px;font-size:13px;color:#6b7280;line-height:1.6;text-align:center;">
        Questions? Reply to this email or call us at {{restaurant_phone}}.<br/>
        We can't wait to see you at {{restaurant_name}}.
      </td></tr>
      <tr><td style="background:#f9fafb;padding:20px 28px;font-size:12px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;">
        {{restaurant_name}} · {{restaurant_address}}<br/>
        You're receiving this because you opted in to updates from us.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]!);
}

// ─── 30 premium templates ──────────────────────────────────────────
const PREMIUM: PremiumTpl[] = [
  {
    key: "premium_welcome_v2", name: "Premium · Welcome new customer", category: "lifecycle",
    subject: "Welcome to {{restaurant_name}}, {{customer_first_name}} — here's 15% off 🎉",
    preheader: "A warm hello and a little something to start your journey with us.",
    hero: "Welcome to the family",
    body: `<p>Hi {{customer_first_name}},</p>
<p>We're delighted to welcome you to <strong>{{restaurant_name}}</strong>. To kick things off, enjoy <strong>15% off</strong> your first order with the code below.</p>
<p style="background:#fef3c7;border:1px dashed #f59e0b;border-radius:10px;padding:14px 18px;text-align:center;font-size:18px;font-weight:700;letter-spacing:2px;color:#92400e;">{{offer_code}}</p>
<p>Whether you're dining in, ordering online, or grabbing a quick bite — we've got you covered.</p>`,
    ctaLabel: "Start your first order", ctaUrl: "{{restaurant_website}}",
  },
  {
    key: "premium_birthday_v2", name: "Premium · Birthday surprise", category: "lifecycle",
    subject: "🎂 Happy birthday, {{customer_first_name}} — a sweet surprise inside",
    preheader: "Your birthday treat from everyone at {{restaurant_name}}.",
    hero: "Happy birthday!",
    body: `<p>Dear {{customer_first_name}},</p>
<p>Wishing you a fantastic year ahead. As our birthday gift to you, please accept a complimentary <strong>{{loyalty_reward_name}}</strong> on your next visit — on us.</p>
<p style="background:#fef3c7;border:1px dashed #f59e0b;border-radius:10px;padding:14px 18px;text-align:center;font-size:18px;font-weight:700;letter-spacing:2px;color:#92400e;">{{offer_code}}</p>
<p>Valid until <strong>{{offer_expires_on}}</strong>. We hope to be part of your celebration!</p>`,
    ctaLabel: "Book your birthday table", ctaUrl: "{{restaurant_website}}/reserve",
  },
  {
    key: "premium_anniversary_v2", name: "Premium · Anniversary celebration", category: "lifecycle",
    subject: "Make your anniversary unforgettable at {{restaurant_name}}",
    preheader: "A special candlelit experience, just for two.",
    hero: "Cheers to many more",
    body: `<p>Dear {{customer_first_name}},</p>
<p>Happy anniversary! Celebrate this milestone with a romantic evening at {{restaurant_name}}. Enjoy <strong>{{offer_discount}}</strong> with code <strong>{{offer_code}}</strong> — plus a complimentary dessert for the lovebirds.</p>
<p>We'll set the mood; you just bring the smiles.</p>`,
    ctaLabel: "Reserve your table", ctaUrl: "{{restaurant_website}}/reserve",
  },
  {
    key: "premium_winback_30", name: "Premium · We miss you (30-day)", category: "winback",
    subject: "It's been a while, {{customer_first_name}} — let's catch up",
    preheader: "A welcome-back gift to bring you home.",
    hero: "We've missed you",
    body: `<p>Hi {{customer_first_name}},</p>
<p>We noticed it's been a few weeks since your last order with us, and we'd love to have you back at {{restaurant_name}}. As a thank-you for being a valued customer, here's <strong>{{offer_discount}}</strong> on your next order.</p>
<p style="background:#fef3c7;border:1px dashed #f59e0b;border-radius:10px;padding:14px 18px;text-align:center;font-size:18px;font-weight:700;letter-spacing:2px;color:#92400e;">{{offer_code}}</p>`,
    ctaLabel: "Order now", ctaUrl: "{{restaurant_website}}",
  },
  {
    key: "premium_winback_60", name: "Premium · We really miss you (60-day)", category: "winback",
    subject: "{{customer_first_name}}, your favourites are calling 🍴",
    preheader: "Two months without you — let's fix that today.",
    hero: "Come back home",
    body: `<p>Hi {{customer_first_name}},</p>
<p>It's been two months since we last served you — and your favourites at {{restaurant_name}} haven't been the same without you. Here's a generous <strong>{{offer_discount}}</strong> off your next order to make returning easy.</p>
<p style="background:#fef3c7;border:1px dashed #f59e0b;border-radius:10px;padding:14px 18px;text-align:center;font-size:18px;font-weight:700;letter-spacing:2px;color:#92400e;">{{offer_code}}</p>`,
    ctaLabel: "Reclaim my favourites", ctaUrl: "{{restaurant_website}}",
  },
  {
    key: "premium_winback_90", name: "Premium · Last-chance win-back (90-day)", category: "winback",
    subject: "One last invitation, {{customer_first_name}}",
    preheader: "Our most generous offer ever — for you, today only.",
    hero: "One last invitation",
    body: `<p>Hi {{customer_first_name}},</p>
<p>It's been three months. Before we say goodbye, we'd love to invite you back with our most generous offer yet: <strong>{{offer_discount}}</strong> off, no minimum.</p>
<p>Use code <strong>{{offer_code}}</strong> before <strong>{{offer_expires_on}}</strong>. If we don't hear from you, we'll quietly stop emailing — but we'll always be here when you're ready.</p>`,
    ctaLabel: "Yes, send me the menu", ctaUrl: "{{restaurant_website}}",
  },
  {
    key: "premium_weekend_special", name: "Premium · Weekend special broadcast", category: "promotion",
    subject: "{{offer_title}} this weekend at {{restaurant_name}}",
    preheader: "Plan your weekend around something delicious.",
    hero: "{{offer_title}}",
    body: `<p>Hi {{customer_first_name}},</p>
<p>The weekend is calling. Drop by {{restaurant_name}} for our <strong>{{offer_title}}</strong> and enjoy <strong>{{offer_discount}}</strong> on the entire menu.</p>
<p style="background:#fef3c7;border:1px dashed #f59e0b;border-radius:10px;padding:14px 18px;text-align:center;font-size:18px;font-weight:700;letter-spacing:2px;color:#92400e;">{{offer_code}}</p>
<p>Valid until {{offer_expires_on}}.</p>`,
    ctaLabel: "Book a table", ctaUrl: "{{restaurant_website}}/reserve",
  },
  {
    key: "premium_flash_sale", name: "Premium · 3-hour flash sale", category: "promotion",
    subject: "⚡ 3 hours only — {{offer_discount}} off at {{restaurant_name}}",
    preheader: "Quick, quick — the clock is ticking.",
    hero: "Flash sale: 3 hours",
    body: `<p>Hi {{customer_first_name}},</p>
<p>For the next 3 hours only, enjoy <strong>{{offer_discount}}</strong> off everything on the {{restaurant_name}} menu.</p>
<p style="background:#fef3c7;border:1px dashed #f59e0b;border-radius:10px;padding:14px 18px;text-align:center;font-size:18px;font-weight:700;letter-spacing:2px;color:#92400e;">{{offer_code}}</p>
<p>No minimum order. Online & dine-in. Tick-tock!</p>`,
    ctaLabel: "Grab the deal", ctaUrl: "{{restaurant_website}}",
  },
  {
    key: "premium_diwali", name: "Premium · Diwali special", category: "festival",
    subject: "✨ Light up Diwali with {{restaurant_name}}",
    preheader: "Festive flavours, sweet beginnings — celebrate with us.",
    hero: "Shubh Deepavali",
    body: `<p>Dear {{customer_first_name}},</p>
<p>May this Diwali fill your home with light, your heart with joy, and your table with the finest food.</p>
<p>Celebrate with our specially curated festive menu and enjoy <strong>{{offer_discount}}</strong> with code <strong>{{offer_code}}</strong>.</p>
<p>From all of us at {{restaurant_name}} — wishing you a warm and sparkling Diwali.</p>`,
    ctaLabel: "Explore festive menu", ctaUrl: "{{restaurant_website}}/menu",
  },
  {
    key: "premium_christmas", name: "Premium · Christmas & New Year", category: "festival",
    subject: "🎄 Merry Christmas from {{restaurant_name}}",
    preheader: "Festive feasts to gather, share, and remember.",
    hero: "Merry Christmas",
    body: `<p>Dear {{customer_first_name}},</p>
<p>Season's greetings from our family to yours. This Christmas, let us take care of the cooking. Our festive menu is now available — perfect for cosy dinners or grand celebrations.</p>
<p>Use code <strong>{{offer_code}}</strong> for <strong>{{offer_discount}}</strong>.</p>`,
    ctaLabel: "View festive menu", ctaUrl: "{{restaurant_website}}/menu",
  },
  {
    key: "premium_eid", name: "Premium · Eid Mubarak", category: "festival",
    subject: "Eid Mubarak from {{restaurant_name}} 🌙",
    preheader: "A festive Iftar & Eid menu, lovingly prepared.",
    hero: "Eid Mubarak",
    body: `<p>Dear {{customer_first_name}},</p>
<p>Eid Mubarak from everyone at {{restaurant_name}}. Celebrate this blessed occasion with our specially curated Eid menu — slow-cooked biryanis, kebabs, and the sweetest sheer khurma.</p>
<p>Enjoy <strong>{{offer_discount}}</strong> with code <strong>{{offer_code}}</strong>.</p>`,
    ctaLabel: "Reserve your Eid table", ctaUrl: "{{restaurant_website}}/reserve",
  },
  {
    key: "premium_new_year", name: "Premium · New Year's Eve invite", category: "festival",
    subject: "🥂 NYE at {{restaurant_name}} — book before seats vanish",
    preheader: "DJ, special menu, midnight bubbly. Your seat awaits.",
    hero: "New Year's Eve",
    body: `<p>Hi {{customer_first_name}},</p>
<p>Ring in the new year with us! Our New Year's Eve package includes a 5-course tasting menu, live music, and complimentary bubbly at midnight.</p>
<p>Limited seats — book your table before <strong>{{offer_expires_on}}</strong>.</p>`,
    ctaLabel: "Reserve NYE table", ctaUrl: "{{restaurant_website}}/reserve",
  },
  {
    key: "premium_valentines", name: "Premium · Valentine's Day", category: "festival",
    subject: "💝 A Valentine's night to remember at {{restaurant_name}}",
    preheader: "A candlelit dinner for two, with a surprise dessert.",
    hero: "Just for two",
    body: `<p>Dear {{customer_first_name}},</p>
<p>Treat someone special this Valentine's. Our intimate 4-course menu — curated by the chef — comes with a complimentary dessert and rose for every couple.</p>
<p>Tables fill up quickly. Reserve early.</p>`,
    ctaLabel: "Book Valentine's table", ctaUrl: "{{restaurant_website}}/reserve",
  },
  {
    key: "premium_mothers_day", name: "Premium · Mother's Day brunch", category: "festival",
    subject: "Celebrate Mom at {{restaurant_name}} this Mother's Day",
    preheader: "A special brunch menu — because she deserves it.",
    hero: "For the heart of the family",
    body: `<p>Hi {{customer_first_name}},</p>
<p>This Mother's Day, give Mom the gift of a beautiful brunch she doesn't have to cook. Our special menu includes her favourites, a complimentary dessert, and a fresh bouquet for every mom at the table.</p>`,
    ctaLabel: "Reserve brunch", ctaUrl: "{{restaurant_website}}/reserve",
  },
  {
    key: "premium_new_menu_launch", name: "Premium · New menu launch", category: "announcement",
    subject: "✨ Our new menu is here, {{customer_first_name}}",
    preheader: "Months of testing, tasting, and tweaking — finally yours.",
    hero: "A new chapter",
    body: `<p>Hi {{customer_first_name}},</p>
<p>We've been busy in the kitchen, and we're thrilled to unveil our brand-new menu at {{restaurant_name}}. Expect bold flavours, seasonal ingredients, and a few surprises from the chef.</p>
<p>As a valued regular, you're among the first to try it. We'd love to hear what you think.</p>`,
    ctaLabel: "Explore the new menu", ctaUrl: "{{restaurant_website}}/menu",
  },
  {
    key: "premium_seasonal_menu", name: "Premium · Seasonal menu drop", category: "announcement",
    subject: "The {{offer_title}} menu has landed",
    preheader: "Fresh ingredients, seasonal flavours, limited time.",
    hero: "Seasonal · {{offer_title}}",
    body: `<p>Hi {{customer_first_name}},</p>
<p>The season is changing, and so is our menu. We've added dishes built around the freshest seasonal produce — available only for a few short weeks at {{restaurant_name}}.</p>`,
    ctaLabel: "See what's new", ctaUrl: "{{restaurant_website}}/menu",
  },
  {
    key: "premium_chef_special", name: "Premium · Chef's special this week", category: "promotion",
    subject: "👨‍🍳 This week the chef picks for you",
    preheader: "A limited-run dish you won't want to miss.",
    hero: "Chef's pick of the week",
    body: `<p>Hi {{customer_first_name}},</p>
<p>Every week, our head chef puts something extraordinary on the menu — and only for a few days. This week's pick is a fan favourite returning by popular demand.</p>
<p>Available only until <strong>{{offer_expires_on}}</strong>.</p>`,
    ctaLabel: "Reserve your table", ctaUrl: "{{restaurant_website}}/reserve",
  },
  {
    key: "premium_new_branch", name: "Premium · New branch / outlet opening", category: "announcement",
    subject: "🎉 New {{restaurant_name}} outlet now open at {{restaurant_address}}",
    preheader: "Come celebrate with us — opening-week treats inside.",
    hero: "We've grown",
    body: `<p>Hi {{customer_first_name}},</p>
<p>We're thrilled to announce that {{restaurant_name}} just opened a new outlet at <strong>{{restaurant_address}}</strong>. To celebrate, every guest gets <strong>{{offer_discount}}</strong> off through opening week.</p>
<p>Use code <strong>{{offer_code}}</strong>.</p>`,
    ctaLabel: "Find directions", ctaUrl: "{{restaurant_website}}/locations",
  },
  {
    key: "premium_event_invite", name: "Premium · Event / tasting invite", category: "announcement",
    subject: "You're invited: {{campaign_name}} at {{restaurant_name}}",
    preheader: "An intimate evening of food, drinks, and great company.",
    hero: "{{campaign_name}}",
    body: `<p>Dear {{customer_first_name}},</p>
<p>You're personally invited to <strong>{{campaign_name}}</strong> at {{restaurant_name}} on {{offer_expires_on}}. Expect a curated menu, paired drinks, and a memorable evening.</p>
<p>Seats are limited. RSVP early to secure yours.</p>`,
    ctaLabel: "RSVP now", ctaUrl: "{{restaurant_website}}/events",
  },
  {
    key: "premium_loyalty_points", name: "Premium · Loyalty points earned", category: "loyalty",
    subject: "You earned {{loyalty_points}} points at {{restaurant_name}} 🌟",
    preheader: "Your rewards balance just got bigger.",
    hero: "You're earning rewards",
    body: `<p>Hi {{customer_first_name}},</p>
<p>Nice work — you just earned <strong>{{loyalty_points}} points</strong> on your last visit. Your rewards add up fast: redeem for free items, discounts, and member-only perks.</p>`,
    ctaLabel: "View my rewards", ctaUrl: "{{restaurant_website}}/loyalty",
  },
  {
    key: "premium_loyalty_tier_up", name: "Premium · Loyalty tier upgrade", category: "loyalty",
    subject: "🎖️ Welcome to {{loyalty_tier}}, {{customer_first_name}}",
    preheader: "Bigger rewards, exclusive perks — you've earned it.",
    hero: "Welcome to {{loyalty_tier}}",
    body: `<p>Hi {{customer_first_name}},</p>
<p>Congratulations — you've reached <strong>{{loyalty_tier}}</strong> at {{restaurant_name}}. This tier unlocks bigger point multipliers, priority seating, and exclusive member-only events.</p>
<p>Thank you for being one of our most valued guests.</p>`,
    ctaLabel: "See your perks", ctaUrl: "{{restaurant_website}}/loyalty",
  },
  {
    key: "premium_referral", name: "Premium · Referral invitation", category: "loyalty",
    subject: "Share the love — refer a friend, both get rewarded",
    preheader: "Your friends get a treat. You earn points. Everyone wins.",
    hero: "Share, save, repeat",
    body: `<p>Hi {{customer_first_name}},</p>
<p>Got friends who love good food? Share your personal code <strong>{{loyalty_referral_code}}</strong> with them. They'll get <strong>{{offer_discount}}</strong> off their first order, and you'll earn bonus loyalty points for every friend who joins.</p>`,
    ctaLabel: "Share my code", ctaUrl: "{{restaurant_website}}/refer",
  },
  {
    key: "premium_review_request", name: "Premium · Review request", category: "feedback",
    subject: "How was your visit to {{restaurant_name}}?",
    preheader: "30 seconds of your time goes a long way for us.",
    hero: "Your voice matters",
    body: `<p>Hi {{customer_first_name}},</p>
<p>We hope you enjoyed your recent meal with us. A short review on Google or our website would mean the world to our small team — and helps other food lovers find us.</p>
<p>Thank you for being part of our community.</p>`,
    ctaLabel: "Leave a review", ctaUrl: "{{restaurant_website}}/review",
  },
  {
    key: "premium_cart_abandon", name: "Premium · Abandoned cart reminder", category: "lifecycle",
    subject: "Still hungry? Your cart at {{restaurant_name}} is waiting 🛒",
    preheader: "Complete your order in one tap.",
    hero: "Don't go hungry",
    body: `<p>Hi {{customer_first_name}},</p>
<p>You left some delicious items in your cart at {{restaurant_name}}. They're still there — and ready to be on their way to you within minutes.</p>`,
    ctaLabel: "Finish my order", ctaUrl: "{{restaurant_website}}/cart",
  },
  {
    key: "premium_first_order_thanks", name: "Premium · Thanks for first order", category: "lifecycle",
    subject: "Thanks for your first order, {{customer_first_name}}! 🙌",
    preheader: "Here's a little something for next time.",
    hero: "Thanks for trying us",
    body: `<p>Hi {{customer_first_name}},</p>
<p>Thank you for choosing {{restaurant_name}} for your first order. We hope every bite hit the spot.</p>
<p>As a thank-you, here's <strong>{{offer_discount}}</strong> off your next order with code <strong>{{offer_code}}</strong>.</p>`,
    ctaLabel: "Order again", ctaUrl: "{{restaurant_website}}",
  },
  {
    key: "premium_repeat_order_thanks", name: "Premium · Repeat customer thank-you", category: "lifecycle",
    subject: "Thank you for being a regular 💛",
    preheader: "Loyal guests like you are why we exist.",
    hero: "You're one of our favourites",
    body: `<p>Hi {{customer_first_name}},</p>
<p>Thank you for ordering from {{restaurant_name}} again. Regulars like you are the reason we love what we do. Here's a small token of appreciation: <strong>{{offer_discount}}</strong> off your next visit with code <strong>{{offer_code}}</strong>.</p>`,
    ctaLabel: "Use my reward", ctaUrl: "{{restaurant_website}}",
  },
  {
    key: "premium_membership_invite", name: "Premium · Membership invitation", category: "membership",
    subject: "An exclusive invitation to join {{restaurant_name}} membership",
    preheader: "Members-only perks, priority seating, and double points.",
    hero: "Members eat better",
    body: `<p>Dear {{customer_first_name}},</p>
<p>Because you're one of our most loyal guests, we'd like to invite you to join the {{restaurant_name}} membership programme. Members enjoy:</p>
<ul style="padding-left:20px;line-height:1.8;">
  <li>Double loyalty points on every visit</li>
  <li>Priority seating, even on weekends</li>
  <li>Invitations to chef's table & tasting nights</li>
  <li>A complimentary birthday dinner each year</li>
</ul>`,
    ctaLabel: "Join the membership", ctaUrl: "{{restaurant_website}}/membership",
  },
  {
    key: "premium_catering_pitch", name: "Premium · Catering & private events", category: "catering",
    subject: "Planning something special? We cater 🎉",
    preheader: "From boardroom lunches to weddings — we've got you.",
    hero: "Let us cater your next event",
    body: `<p>Hi {{customer_first_name}},</p>
<p>From intimate gatherings to grand celebrations, {{restaurant_name}} caters events of every shape and size. Our team will work with you on menu, logistics, and service so you can simply enjoy the day.</p>
<p>Tell us about your event and we'll put together a custom quote within 24 hours.</p>`,
    ctaLabel: "Request a quote", ctaUrl: "{{restaurant_website}}/catering",
    businessTypes: ["restaurant", "catering", "fine_dining", "cloud_kitchen"],
  },
  {
    key: "premium_tiffin_subscription", name: "Premium · Tiffin subscription pitch", category: "tiffin",
    subject: "Home-style meals, delivered daily — try our tiffin service",
    preheader: "Healthy. Hot. On time. Every single day.",
    hero: "Daily tiffin, made with love",
    body: `<p>Hi {{customer_first_name}},</p>
<p>Skip the cooking. Our daily tiffin from {{restaurant_name}} is freshly prepared, packed hot, and delivered right when you need it. Vegetarian, non-vegetarian, and Jain options available.</p>
<p>Start with a <strong>7-day trial pack</strong> for just {{offer_discount}} off.</p>`,
    ctaLabel: "Start my trial", ctaUrl: "{{restaurant_website}}/tiffin",
    businessTypes: ["tiffin", "cloud_kitchen", "restaurant"],
  },
  {
    key: "premium_apology_outage", name: "Premium · Service hiccup apology", category: "support",
    subject: "We owe you an apology, {{customer_first_name}}",
    preheader: "And a small something to make it right.",
    hero: "We're sorry",
    body: `<p>Hi {{customer_first_name}},</p>
<p>Recently, your experience with {{restaurant_name}} fell short of the standard we set for ourselves — and we're genuinely sorry.</p>
<p>As a small gesture, please accept <strong>{{offer_discount}}</strong> off your next order with code <strong>{{offer_code}}</strong>. We'd love a second chance to win you back.</p>`,
    ctaLabel: "Give us another go", ctaUrl: "{{restaurant_website}}",
  },
  {
    key: "premium_hours_changed", name: "Premium · Hours / availability update", category: "announcement",
    subject: "Updated hours at {{restaurant_name}}",
    preheader: "A quick heads-up so you don't miss us.",
    hero: "New hours",
    body: `<p>Hi {{customer_first_name}},</p>
<p>A quick update: our hours at {{restaurant_name}} have changed. New timings: <strong>{{order_status}}</strong>.</p>
<p>We look forward to serving you — please give us a call or check our website if you're ever unsure.</p>`,
    ctaLabel: "See full hours", ctaUrl: "{{restaurant_website}}",
  },
];

export async function seedPremiumMarketingLibrary(): Promise<{ inserted: number; skipped: number }> {
  const existing = await db.select({ key: emailMarketingTemplatesTable.key }).from(emailMarketingTemplatesTable);
  const have = new Set(existing.map(r => r.key));
  let inserted = 0, skipped = 0;
  for (const t of PREMIUM) {
    if (have.has(t.key)) { skipped++; continue; }
    const now = new Date();
    await db.insert(emailMarketingTemplatesTable).values({
      key: t.key,
      name: t.name,
      category: t.category,
      subject: t.subject,
      preheader: t.preheader,
      body: wrap(t),
      ctaLabel: t.ctaLabel,
      ctaUrl: t.ctaUrl,
      brandColor: t.brandColor ?? "#f97316",
      businessTypes: t.businessTypes ?? [],
      isGlobal: true,
      isHidden: false,
      isAiGenerated: false,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    inserted++;
  }
  logger.info({ inserted, skipped, total: PREMIUM.length }, "Seeded premium marketing email library");
  return { inserted, skipped };
}

export const PREMIUM_MARKETING_TEMPLATE_COUNT = PREMIUM.length;
