/**
 * Task #506 — WhatsApp provider abstraction.
 *
 * The dispatcher in `whatsapp.ts` picks one of these implementations per
 * send based on the restaurant's `providerType`:
 *   - "cloud_api" → Meta WhatsApp Cloud API (unchanged from before).
 *   - "web_qr"    → Baileys session (see whatsappWebQr.ts).
 *   - "disabled"  → blocks at dispatcher; no provider runs.
 *
 * Keeping this as a thin interface lets callers branch on the chosen
 * pipeline without leaking Cloud API or Baileys types upstream.
 */
import type { ResolvedWhatsAppCreds } from "./whatsapp";

export type WhatsAppProviderType = "cloud_api" | "web_qr" | "disabled";

export interface ProviderSendInput {
  restaurantId: number | null;
  to: string;
  body?: string;
  templateName?: string;
  templateLanguage?: string;
  templateVariables?: string[];
}

export interface ProviderSendResult {
  messageId: string | null;
}

export interface WhatsAppProvider {
  type: WhatsAppProviderType;
  /** Returns true if the provider is wired up for this restaurant (creds present, session connected, etc.). */
  isReady(restaurantId: number | null, creds: ResolvedWhatsAppCreds | null): Promise<boolean>;
  send(input: ProviderSendInput, creds: ResolvedWhatsAppCreds | null): Promise<ProviderSendResult>;
}
