import nodemailer from "nodemailer";
import { logger } from "./logger";

const SMTP_HOST = process.env.SMTP_HOST ?? "";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const SMTP_FROM = process.env.SMTP_FROM ?? "noreply@tabletrack.app";

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
}): Promise<void> {
  const t = getTransporter();
  if (!t) {
    logger.info({ to: opts.to, subject: opts.subject }, "[Email stub] Would send email");
    return;
  }
  try {
    await t.sendMail({ from: SMTP_FROM, ...opts });
  } catch (err) {
    logger.error({ err, to: opts.to }, "Failed to send email");
  }
}

export async function sendWhatsApp(opts: {
  to: string;
  body: string;
}): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    logger.info({ to: opts.to, body: opts.body }, "[WhatsApp stub] Would send WhatsApp message");
    return;
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
    }
  } catch (err) {
    logger.error({ err, to: opts.to }, "Failed to send WhatsApp message");
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
    logger.info({ to: opts.to, title: opts.title }, "[Push stub] No valid Expo push tokens");
    return;
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
    }
  } catch (err) {
    logger.error({ err }, "Failed to send push notification");
  }
}

export function orderConfirmationEmail(opts: {
  customerName: string;
  orderNumber: string;
  restaurantName: string;
  items: string[];
  total: string;
}): { subject: string; html: string; text: string } {
  const itemList = opts.items.map(i => `<li>${i}</li>`).join("");
  return {
    subject: `Order Confirmed — ${opts.orderNumber} at ${opts.restaurantName}`,
    text: `Hi ${opts.customerName}, your order ${opts.orderNumber} has been confirmed. Total: ₹${opts.total}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#f97316">Order Confirmed!</h2>
        <p>Hi <strong>${opts.customerName}</strong>,</p>
        <p>Your order <strong>#${opts.orderNumber}</strong> at <strong>${opts.restaurantName}</strong> has been confirmed.</p>
        <ul>${itemList}</ul>
        <p style="font-size:1.1em"><strong>Total: ₹${opts.total}</strong></p>
        <p style="color:#888;font-size:0.85em">Thank you for dining with us!</p>
      </div>`,
  };
}

export function lowStockEmail(opts: {
  restaurantName: string;
  items: Array<{ name: string; quantity: number; unit: string; threshold: number }>;
}): { subject: string; html: string; text: string } {
  const rows = opts.items.map(i => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${i.name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#dc2626">${i.quantity} ${i.unit}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#888">${i.threshold} ${i.unit}</td>
    </tr>`).join("");
  return {
    subject: `⚠️ Low Stock Alert — ${opts.restaurantName}`,
    text: `Low stock alert at ${opts.restaurantName}: ${opts.items.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(", ")}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#dc2626">⚠️ Low Stock Alert</h2>
        <p>The following items at <strong>${opts.restaurantName}</strong> are running low:</p>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#fef2f2">
            <th style="padding:8px 12px;text-align:left">Item</th>
            <th style="padding:8px 12px;text-align:left">Current Stock</th>
            <th style="padding:8px 12px;text-align:left">Threshold</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#888;font-size:0.85em;margin-top:16px">Please reorder soon to avoid running out.</p>
      </div>`,
  };
}

export function autoDraftPOEmail(opts: {
  restaurantName: string;
  suppliers: Array<{ supplierName: string; itemCount: number; items: string[] }>;
}): { subject: string; html: string; text: string } {
  const totalDrafts = opts.suppliers.length;
  const blocks = opts.suppliers.map(s => `
    <div style="margin:12px 0;padding:12px;border:1px solid #eee;border-radius:8px">
      <strong>${s.supplierName}</strong> — ${s.itemCount} item${s.itemCount === 1 ? "" : "s"}
      <ul style="margin:6px 0 0 18px;color:#555">${s.items.map(n => `<li>${n}</li>`).join("")}</ul>
    </div>`).join("");
  return {
    subject: `📝 ${totalDrafts} auto-drafted purchase order${totalDrafts === 1 ? "" : "s"} — ${opts.restaurantName}`,
    text: `${totalDrafts} draft purchase order${totalDrafts === 1 ? "" : "s"} were created from low-stock items at ${opts.restaurantName}. Review and send.`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#f97316">📝 Auto-drafted Purchase Orders</h2>
        <p>${totalDrafts} draft purchase order${totalDrafts === 1 ? "" : "s"} ${totalDrafts === 1 ? "was" : "were"} created from low-stock items at <strong>${opts.restaurantName}</strong>. Review and click send when ready.</p>
        ${blocks}
        <p style="color:#888;font-size:0.85em">Manage them in Inventory → Purchase Orders.</p>
      </div>`,
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
  return {
    subject: `📊 Daily Sales Summary — ${opts.restaurantName} — ${opts.date}`,
    text: `Daily summary for ${opts.restaurantName} on ${opts.date}: ${opts.totalOrders} orders, ₹${opts.totalRevenue} revenue.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#f97316">📊 Daily Sales Summary</h2>
        <p><strong>${opts.restaurantName}</strong> — ${opts.date}</p>
        <table style="width:100%">
          <tr><td>Total Orders</td><td><strong>${opts.totalOrders}</strong></td></tr>
          <tr><td>Total Revenue</td><td><strong>₹${opts.totalRevenue}</strong></td></tr>
        </table>
        ${opts.topItems.length ? `<p><strong>Top Items:</strong></p><ul>${items}</ul>` : ""}
        <p style="color:#888;font-size:0.85em">Generated automatically by TableTrack.</p>
      </div>`,
  };
}

export function reservationEmail(opts: {
  customerName: string;
  restaurantName: string;
  date: string;
  time: string;
  guests: number;
}): { subject: string; html: string; text: string } {
  return {
    subject: `Reservation Confirmed — ${opts.restaurantName}`,
    text: `Hi ${opts.customerName}, your reservation at ${opts.restaurantName} for ${opts.guests} guests on ${opts.date} at ${opts.time} is confirmed.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#f97316">Reservation Confirmed</h2>
        <p>Hi <strong>${opts.customerName}</strong>,</p>
        <p>Your reservation at <strong>${opts.restaurantName}</strong> is confirmed:</p>
        <ul>
          <li>Date: <strong>${opts.date}</strong></li>
          <li>Time: <strong>${opts.time}</strong></li>
          <li>Guests: <strong>${opts.guests}</strong></li>
        </ul>
        <p style="color:#888;font-size:0.85em">We look forward to seeing you!</p>
      </div>`,
  };
}
