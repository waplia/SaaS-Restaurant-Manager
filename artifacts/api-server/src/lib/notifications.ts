import nodemailer from "nodemailer";
import { logger } from "./logger";
import { premiumLayout } from "./emailSender";

const SMTP_HOST = process.env.SMTP_HOST ?? "";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const SMTP_FROM = process.env.SMTP_FROM ?? "noreply@khanalagao.app";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ messageId: string | null }> {
  const t = getTransporter();
  if (!t) {
    if (process.env.NOTIFICATIONS_ALLOW_STUBS === "1") {
      logger.info({ to: opts.to, subject: opts.subject }, "[Email stub] Would send email");
      return { messageId: null };
    }
    throw new Error("Email provider not configured (set SMTP_HOST/SMTP_USER/SMTP_PASS)");
  }
  try {
    const info = await t.sendMail({ from: SMTP_FROM, ...opts });
    return { messageId: info?.messageId ?? null };
  } catch (err) {
    logger.error({ err, to: opts.to }, "Failed to send email");
    throw err;
  }
}

export async function sendWhatsApp(opts: {
  to: string;
  body: string;
}): Promise<{ sid: string | null }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    if (process.env.NOTIFICATIONS_ALLOW_STUBS === "1") {
      logger.info({ to: opts.to, body: opts.body }, "[WhatsApp stub] Would send WhatsApp message");
      return { sid: null };
    }
    throw new Error("WhatsApp provider not configured (set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)");
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const formBody = new URLSearchParams({
    From: TWILIO_WHATSAPP_FROM,
    To: `whatsapp:${opts.to}`,
    Body: opts.body,
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      },
      body: formBody.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, text }, "Twilio WhatsApp error");
      throw new Error(`Twilio WhatsApp error ${res.status}: ${text}`);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { sid: typeof json.sid === "string" ? json.sid : null };
  } catch (err) {
    logger.error({ err, to: opts.to }, "Failed to send WhatsApp message");
    throw err;
  }
}

export async function sendSms(opts: {
  to: string;
  body: string;
}): Promise<{ sid: string | null }> {
  const TWILIO_SMS_FROM = process.env.TWILIO_SMS_FROM ?? "";
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_SMS_FROM) {
    if (process.env.NOTIFICATIONS_ALLOW_STUBS === "1") {
      logger.info({ to: opts.to, body: opts.body }, "[SMS stub] Would send SMS");
      return { sid: null };
    }
    throw new Error("SMS provider not configured (set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_SMS_FROM)");
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const formBody = new URLSearchParams({ From: TWILIO_SMS_FROM, To: opts.to, Body: opts.body });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      },
      body: formBody.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, text }, "Twilio SMS error");
      throw new Error(`Twilio SMS error ${res.status}: ${text}`);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { sid: typeof json.sid === "string" ? json.sid : null };
  } catch (err) {
    logger.error({ err, to: opts.to }, "Failed to send SMS");
    throw err;
  }
}

export async function sendPush(opts: {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const tokens = (Array.isArray(opts.to) ? opts.to : [opts.to]).filter(t => typeof t === "string" && t.startsWith("ExponentPushToken"));
  if (tokens.length === 0) {
    throw new Error("No valid Expo push tokens");
  }
  const messages = tokens.map(token => ({
    to: token,
    sound: "default",
    title: opts.title,
    body: opts.body,
    data: opts.data ?? {},
  }));
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, text }, "Expo push error");
      throw new Error(`Expo push error ${res.status}: ${text}`);
    }
  } catch (err) {
    logger.error({ err }, "Failed to send push notification");
    throw err;
  }
}

// ─── Builder helpers ──────────────────────────────────────────────
// These wrap their body content in the shared `premiumLayout()` so even the
// legacy call sites that still hand-build emails inherit the KhanaLagao card
// look. Newer call sites should prefer `sendByTemplateKey(...)` directly,
// which renders the Super-Admin-editable template instead of these builders.

export function orderConfirmationEmail(opts: {
  customerName: string;
  orderNumber: string;
  restaurantName: string;
  items: string[];
  total: string;
}): { subject: string; html: string; text: string } {
  const subject = `Order Confirmed — ${opts.orderNumber} at ${opts.restaurantName}`;
  const itemList = opts.items.map(i => `<li>${i}</li>`).join("");
  return {
    subject,
    text: `Hi ${opts.customerName}, your order ${opts.orderNumber} has been confirmed. Total: ₹${opts.total}`,
    html: premiumLayout({
      preheader: `Order #${opts.orderNumber} at ${opts.restaurantName}`,
      heading: "Order confirmed",
      intro: `Hi <strong>${opts.customerName}</strong>, your order at <strong>${opts.restaurantName}</strong> is confirmed.`,
      bodyHtml: `<p style="margin:0 0 8px 0"><strong>Order #${opts.orderNumber}</strong></p><ul>${itemList}</ul><p style="margin:8px 0 0 0;font-size:16px"><strong>Total: ₹${opts.total}</strong></p>`,
      appName: "Khana Lagao",
    }),
  };
}

export function lowStockEmail(opts: {
  restaurantName: string;
  items: Array<{ name: string; quantity: number; unit: string; threshold: number }>;
}): { subject: string; html: string; text: string } {
  const rows = opts.items.map(i => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #FDE6CC">${i.name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #FDE6CC;color:#dc2626">${i.quantity} ${i.unit}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #FDE6CC;color:#6B7280">${i.threshold} ${i.unit}</td>
    </tr>`).join("");
  const subject = `⚠️ Low Stock Alert — ${opts.restaurantName}`;
  return {
    subject,
    text: `Low stock alert at ${opts.restaurantName}: ${opts.items.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(", ")}`,
    html: premiumLayout({
      preheader: subject,
      heading: "Low stock alert",
      intro: `The following items at <strong>${opts.restaurantName}</strong> are running low.`,
      bodyHtml: `<table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#FFF7ED">
          <th style="padding:8px 12px;text-align:left">Item</th>
          <th style="padding:8px 12px;text-align:left">Current Stock</th>
          <th style="padding:8px 12px;text-align:left">Threshold</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
      footerNote: "Please reorder soon to avoid running out.",
      appName: "Khana Lagao",
    }),
  };
}

export function autoDraftPOEmail(opts: {
  restaurantName: string;
  suppliers: Array<{ supplierName: string; itemCount: number; items: string[] }>;
}): { subject: string; html: string; text: string } {
  const totalDrafts = opts.suppliers.length;
  const blocks = opts.suppliers.map(s => `
    <div style="margin:12px 0;padding:12px;border:1px solid #FDE6CC;border-radius:8px;background:#FFFBF5">
      <strong>${s.supplierName}</strong> — ${s.itemCount} item${s.itemCount === 1 ? "" : "s"}
      <ul style="margin:6px 0 0 18px;color:#1F2937">${s.items.map(n => `<li>${n}</li>`).join("")}</ul>
    </div>`).join("");
  const subject = `📝 ${totalDrafts} auto-drafted purchase order${totalDrafts === 1 ? "" : "s"} — ${opts.restaurantName}`;
  return {
    subject,
    text: `${totalDrafts} draft purchase order${totalDrafts === 1 ? "" : "s"} were created from low-stock items at ${opts.restaurantName}. Review and send.`,
    html: premiumLayout({
      preheader: subject,
      heading: "Auto-drafted purchase orders",
      intro: `${totalDrafts} draft purchase order${totalDrafts === 1 ? "" : "s"} ${totalDrafts === 1 ? "was" : "were"} created from low-stock items at <strong>${opts.restaurantName}</strong>. Review and click send when ready.`,
      bodyHtml: blocks,
      footerNote: "Manage them in Inventory → Purchase Orders.",
      appName: "Khana Lagao",
    }),
  };
}

export function dailySummaryEmail(opts: {
  restaurantName: string;
  date: string;
  totalOrders: number;
  totalRevenue: string;
  topItems: string[];
}): { subject: string; html: string; text: string } {
  const items = opts.topItems.map(i => `<li>${i}</li>`).join("");
  const subject = `📊 Daily Sales Summary — ${opts.restaurantName} — ${opts.date}`;
  return {
    subject,
    text: `Daily summary for ${opts.restaurantName} on ${opts.date}: ${opts.totalOrders} orders, ₹${opts.totalRevenue} revenue.`,
    html: premiumLayout({
      preheader: subject,
      heading: "Daily sales summary",
      intro: `<strong>${opts.restaurantName}</strong> — ${opts.date}`,
      bodyHtml: `<table style="width:100%">
          <tr><td>Total Orders</td><td><strong>${opts.totalOrders}</strong></td></tr>
          <tr><td>Total Revenue</td><td><strong>₹${opts.totalRevenue}</strong></td></tr>
        </table>${opts.topItems.length ? `<p style="margin-top:12px"><strong>Top Items:</strong></p><ul>${items}</ul>` : ""}`,
      footerNote: "Generated automatically by Khana Lagao.",
      appName: "Khana Lagao",
    }),
  };
}

export function reservationEmail(opts: {
  customerName: string;
  restaurantName: string;
  date: string;
  time: string;
  guests: number;
}): { subject: string; html: string; text: string } {
  const subject = `Reservation Confirmed — ${opts.restaurantName}`;
  return {
    subject,
    text: `Hi ${opts.customerName}, your reservation at ${opts.restaurantName} for ${opts.guests} guests on ${opts.date} at ${opts.time} is confirmed.`,
    html: premiumLayout({
      preheader: subject,
      heading: "Reservation confirmed",
      intro: `Hi <strong>${opts.customerName}</strong>, your reservation at <strong>${opts.restaurantName}</strong> is confirmed.`,
      bodyHtml: `<ul>
        <li>Date: <strong>${opts.date}</strong></li>
        <li>Time: <strong>${opts.time}</strong></li>
        <li>Guests: <strong>${opts.guests}</strong></li>
      </ul>`,
      footerNote: "We look forward to seeing you!",
      appName: "Khana Lagao",
    }),
  };
}
