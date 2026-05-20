/**
 * Meta WhatsApp template create/edit/sync extensions (Task #533).
 * Lives separately from lib/whatsapp.ts to keep the original sender path
 * narrow. Used by the Template Center routes.
 */

import type { WhatsAppTemplate } from "@workspace/db/schema";
import { getPlatformSettings, resolveCredsForRestaurant } from "./whatsapp";
import { variablesToPositionalExamples } from "./templateVariables";
import { logger } from "./logger";

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v20.0";

interface ResolvedTplCreds { accessToken: string; wabaId: string; }

/**
 * Resolve Meta WABA credentials for template CRUD calls.
 *
 * Important: most restaurants do NOT own Meta credentials — they piggy-back
 * on the platform's WABA (`usePlatformAccount = true`, the default). So for
 * `scope = "restaurant"` we MUST go through `resolveCredsForRestaurant`,
 * which already implements the platform-vs-restaurant fallback used by the
 * message sender. Falling back to the platform row keeps the
 * clone → submit-for-review → super-admin-approve → Meta submit flow
 * working for tenants that don't have their own WABA.
 */
async function resolveTplCreds(scope: "platform" | "restaurant", restaurantId: number | null): Promise<ResolvedTplCreds> {
  if (scope === "platform") {
    const row = await getPlatformSettings();
    if (!row?.accessToken || !row?.wabaId) {
      throw new Error("Platform WhatsApp Business Account credentials are not configured (need access token + WABA id).");
    }
    return { accessToken: row.accessToken, wabaId: row.wabaId };
  }

  if (restaurantId == null) {
    throw new Error("restaurantId is required for restaurant-scope template credentials.");
  }
  const creds = await resolveCredsForRestaurant(restaurantId);
  if (!creds.accessToken || !creds.wabaId) {
    const hint = creds.source === "platform"
      ? "Restaurant uses the platform WhatsApp account but the platform WABA is not fully configured."
      : "Restaurant uses its own WhatsApp account but is missing access token or WABA id.";
    throw new Error(`WhatsApp Business Account credentials are not configured. ${hint}`);
  }
  return { accessToken: creds.accessToken, wabaId: creds.wabaId };
}

async function metaCall<T>(path: string, accessToken: string, init: RequestInit & { method: string }): Promise<T> {
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const err = (json as { error?: { message?: string } } | null)?.error?.message ?? text ?? `HTTP ${res.status}`;
    throw new Error(`Meta API ${res.status}: ${err}`);
  }
  return (json ?? {}) as T;
}

interface MetaComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  text?: string;
  example?: { header_text?: string[]; header_handle?: string[]; body_text?: string[][] };
  buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
}

/**
 * Build the Meta `components` array from our normalized template fields.
 * Sample values are taken from sampleValuesJson when present, otherwise
 * computed from the variable mapping.
 */
export function buildMetaComponents(t: Partial<WhatsAppTemplate>): MetaComponent[] {
  const out: MetaComponent[] = [];

  // Header
  const headerType = (t.headerType ?? "none").toUpperCase();
  if (headerType === "TEXT" && t.headerText) {
    const sample = (t.sampleValuesJson?.header ?? []) as string[];
    out.push({
      type: "HEADER",
      format: "TEXT",
      text: t.headerText,
      ...(sample.length ? { example: { header_text: sample } } : {}),
    });
  } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType) && t.headerMediaUrl) {
    out.push({
      type: "HEADER",
      format: headerType as "IMAGE" | "VIDEO" | "DOCUMENT",
      example: { header_handle: [t.headerMediaUrl] },
    });
  }

  // Body
  if (t.bodyText) {
    const examples = variablesToPositionalExamples((t.variablesJson ?? []) as Array<Record<string, unknown>>);
    const body: MetaComponent = { type: "BODY", text: t.bodyText };
    if (examples.length > 0) body.example = { body_text: [examples] };
    out.push(body);
  }

  // Footer
  if (t.footerText) {
    out.push({ type: "FOOTER", text: t.footerText });
  }

  // Buttons
  const buttons = (t.buttonsJson ?? []) as Array<Record<string, unknown>>;
  if (buttons.length > 0) {
    out.push({
      type: "BUTTONS",
      buttons: buttons.map(b => {
        const type = String(b.type);
        const base = { type: type.toUpperCase(), text: String(b.text ?? "") };
        if (type === "url") return { ...base, url: String(b.url ?? "") };
        if (type === "phone_number") return { ...base, phone_number: String(b.phone ?? "") };
        return base;
      }),
    });
  }

  return out;
}

interface MetaSubmitResponse {
  id?: string;
  status?: string;
  category?: string;
}

/** Create (submit) a new template to Meta for review. */
export async function createTemplateInMeta(
  scope: "platform" | "restaurant",
  restaurantId: number | null,
  t: Partial<WhatsAppTemplate>,
): Promise<{ metaTemplateId: string | null; status: string; raw: MetaSubmitResponse }> {
  const creds = await resolveTplCreds(scope, restaurantId);
  const components = buildMetaComponents(t);
  const payload = {
    name: t.name,
    language: t.language ?? "en",
    category: (t.category ?? "UTILITY").toUpperCase(),
    components,
  };
  logger.info({ name: t.name, scope, restaurantId }, "Submitting WhatsApp template to Meta");
  const res = await metaCall<MetaSubmitResponse>(`/${creds.wabaId}/message_templates`, creds.accessToken, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    metaTemplateId: res.id ?? null,
    status: (res.status ?? "pending").toLowerCase(),
    raw: res,
  };
}

/** Edit an existing template in Meta (only certain fields are editable). */
export async function editTemplateInMeta(
  scope: "platform" | "restaurant",
  restaurantId: number | null,
  metaTemplateId: string,
  t: Partial<WhatsAppTemplate>,
): Promise<{ status: string; raw: MetaSubmitResponse }> {
  const creds = await resolveTplCreds(scope, restaurantId);
  const components = buildMetaComponents(t);
  const payload = {
    category: (t.category ?? "UTILITY").toUpperCase(),
    components,
  };
  const res = await metaCall<MetaSubmitResponse>(`/${metaTemplateId}`, creds.accessToken, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { status: (res.status ?? "pending").toLowerCase(), raw: res };
}

/** Delete a template from Meta (uses ?name= query). */
export async function deleteTemplateInMeta(
  scope: "platform" | "restaurant",
  restaurantId: number | null,
  name: string,
): Promise<void> {
  const creds = await resolveTplCreds(scope, restaurantId);
  await metaCall(`/${creds.wabaId}/message_templates?name=${encodeURIComponent(name)}`, creds.accessToken, { method: "DELETE" });
}

/** Re-fetch a single template's status from Meta. */
export async function fetchSingleTemplateStatus(
  scope: "platform" | "restaurant",
  restaurantId: number | null,
  name: string,
  language: string,
): Promise<{ status: string; raw: Record<string, unknown> | null }> {
  const creds = await resolveTplCreds(scope, restaurantId);
  const res = await metaCall<{ data?: Array<{ name?: string; language?: string; status?: string }> }>(
    `/${creds.wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=name,language,status,category,components`,
    creds.accessToken,
    { method: "GET" },
  );
  const match = (res.data ?? []).find(r => r.name === name && r.language === language);
  return {
    status: (match?.status ?? "pending").toLowerCase(),
    raw: match as Record<string, unknown> | null,
  };
}
