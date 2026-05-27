/**
 * Shared helper for printing/sharing a real, server-rendered bill from any
 * mobile screen (waiter, cashier, etc).
 *
 * Why this exists:
 *   Earlier flows did `Share.share({ message: url })` or built ad-hoc text,
 *   so the recipient just got a *link* or a plain-text receipt — not the
 *   actual rendered bill. This helper always pulls the real HTML from
 *   `/orders/:id/bill-render` and:
 *     - on native: hands it to `expo-print` (AirPrint / Android Print) so
 *       it opens the OS print sheet with a fully styled receipt and can
 *       go to any AirPrint / networked printer, save as PDF, or share to
 *       WhatsApp from the print preview.
 *     - on web:    opens the rendered bill URL in a new tab where the
 *       browser's native print dialog can pick it up.
 *
 * Callers should NOT build their own text receipt — that defeats the
 * unified bill-template system and ignores per-outlet branding/logo.
 */
import { Platform, Share } from "react-native";
import * as Print from "expo-print";
import { Alert } from "@/components/ui/AppAlert";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

export type BillPrintChannel = "mobile_share" | "pos_thermal" | "whatsapp" | "email" | "thermal_80" | "a4_invoice" | "a5_invoice";

export interface PrintBillOptions {
  restaurantId: number | string;
  orderId: number | string;
  orderNumber?: string | number;
  accessToken?: string | null;
  /** Channel template to use; defaults to `mobile_share`. */
  channel?: BillPrintChannel;
  /**
   * When true (default on native) and the user has a custom share intent
   * in mind, allow the post-print "share PDF" fallback. The OS print sheet
   * already exposes Save to Files / AirDrop / WhatsApp, so most callers
   * don't need this.
   */
  alsoShareLink?: boolean;
}

export interface PrintBillResult {
  ok: boolean;
  /** Transport actually used. */
  transport: "system" | "browser" | "share" | "cancelled";
  error?: string;
}

/**
 * Fetch the rendered HTML for an order's bill from the API.
 *
 * Returns the raw HTML string (already styled per the channel template),
 * or throws on failure so callers can show a toast / alert.
 */
async function fetchBillHtml(
  restaurantId: number | string,
  orderId: number | string,
  channel: BillPrintChannel,
  accessToken: string | null | undefined,
): Promise<string> {
  const base = getApiBaseUrl();
  const url = `${base}/api/restaurants/${restaurantId}/orders/${orderId}/bill-render?channel=${encodeURIComponent(channel)}`;
  const res = await fetch(url, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `Bill render failed (${res.status})`);
  }
  return await res.text();
}

/**
 * Print a real, server-rendered bill. Uses expo-print on native, opens the
 * URL in a new tab on web. Falls back to sharing the URL if everything
 * else fails on native (e.g. expo-print rejects).
 */
export async function printBill(opts: PrintBillOptions): Promise<PrintBillResult> {
  const channel = opts.channel ?? "mobile_share";
  const title = opts.orderNumber != null ? `Bill — Order #${opts.orderNumber}` : "Bill";

  // Web: fetch the rendered HTML *with the bearer token* (the API route
  // is auth-protected, so a raw `Linking.openURL` would 401) and open it
  // as a blob URL in a new tab. The new tab auto-triggers `window.print`
  // so the browser's print dialog comes up with the styled bill ready
  // to go.
  if (Platform.OS === "web") {
    let html: string;
    try {
      html = await fetchBillHtml(opts.restaurantId, opts.orderId, channel, opts.accessToken);
    } catch (err) {
      Alert.alert("Print", `Could not load the bill. ${(err as Error).message}`);
      return { ok: false, transport: "browser", error: (err as Error).message };
    }
    try {
      // Inject a print trigger so the new tab opens straight into the
      // browser print dialog. Keep it after `load` so styles + logo are
      // applied before printing.
      const withAutoPrint = html.includes("__tt_autoprint__")
        ? html
        : html.replace(
            /<\/body>/i,
            `<script id="__tt_autoprint__">window.addEventListener("load",()=>setTimeout(()=>window.print(),250));</script></body>`,
          );
      const blob = new Blob([withAutoPrint], { type: "text/html" });
      const blobUrl = URL.createObjectURL(blob);
      const win = typeof window !== "undefined"
        ? window.open(blobUrl, "_blank")
        : null;
      if (!win) {
        URL.revokeObjectURL(blobUrl);
        Alert.alert("Pop-up blocked", "Allow pop-ups for this site to print the bill.");
        return { ok: false, transport: "browser", error: "popup_blocked" };
      }
      // Revoke after the new tab has had time to load the blob.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      return { ok: true, transport: "browser" };
    } catch (err) {
      Alert.alert("Print", "Could not open the print preview.");
      return { ok: false, transport: "browser", error: (err as Error).message };
    }
  }

  // Native: fetch HTML and route through the OS print sheet so the user
  // gets a real rendered receipt (AirPrint / Android Print / Save PDF).
  let html: string;
  try {
    html = await fetchBillHtml(opts.restaurantId, opts.orderId, channel, opts.accessToken);
  } catch (err) {
    Alert.alert("Print", `Could not load the bill. ${(err as Error).message}`);
    return { ok: false, transport: "system", error: (err as Error).message };
  }

  try {
    await Print.printAsync({ html });
    return { ok: true, transport: "system" };
  } catch (err) {
    const msg = (err as Error).message || "";
    if (/cancel/i.test(msg)) {
      return { ok: false, transport: "cancelled", error: "Print cancelled" };
    }
    // Last-resort fallback: share the HTML as a printable message so
    // the user can still get the bill out. We intentionally do NOT
    // share the /bill-render URL — it's auth-protected, recipients
    // outside the app can't open it.
    if (opts.alsoShareLink !== false) {
      try {
        await Share.share({ message: html, title });
        return { ok: true, transport: "share" };
      } catch {
        /* fall through */
      }
    }
    Alert.alert("Print", `Could not print the bill. ${msg || "Please try again."}`);
    return { ok: false, transport: "system", error: msg };
  }
}
