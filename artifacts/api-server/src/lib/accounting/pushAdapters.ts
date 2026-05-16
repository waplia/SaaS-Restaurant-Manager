import type { AccountingTarget } from "../db";
import { ConfigurationRequiredError } from "./types";

export interface PushArgs {
  target: AccountingTarget;
  config: Record<string, unknown>;
  payload: unknown;
  fileName: string;
}

export interface PushResult {
  ok: boolean;
  status: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * Push a rendered payload to a remote accounting target. Real OAuth flows for
 * Zoho/QuickBooks are stubbed — we POST to the documented JSON endpoints with
 * the supplied refresh token treated as a bearer (the user is expected to wire
 * up real token-exchange in a follow-up). Generic API just POSTs JSON.
 *
 * Throws ConfigurationRequiredError when required config fields are missing.
 */
export async function pushToTarget(args: PushArgs): Promise<PushResult> {
  const { target, config, payload } = args;

  if (target === "api") {
    const url = String(config.endpointUrl ?? "");
    const token = String(config.bearerToken ?? "");
    const missing: string[] = [];
    if (!url) missing.push("endpointUrl");
    if (!token) missing.push("bearerToken");
    if (missing.length) throw new ConfigurationRequiredError(target, missing);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    };
    const extra = String(config.extraHeaders ?? "").trim();
    if (extra) {
      for (const part of extra.split(",")) {
        const idx = part.indexOf(":");
        if (idx > 0) headers[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
      }
    }
    return doFetch(url, headers, payload);
  }

  if (target === "zoho_books") {
    const missing = required(config, ["organizationId", "clientId", "clientSecret", "refreshToken"]);
    if (missing.length) throw new ConfigurationRequiredError(target, missing);
    const region = String(config.region ?? "in");
    const url = `https://www.zohoapis.${region}/books/v3/journals?organization_id=${encodeURIComponent(String(config.organizationId))}`;
    return doFetch(url, {
      "Content-Type": "application/json",
      "Authorization": `Zoho-oauthtoken ${config.refreshToken}`,
    }, payload);
  }

  if (target === "quickbooks") {
    const missing = required(config, ["realmId", "clientId", "clientSecret", "refreshToken"]);
    if (missing.length) throw new ConfigurationRequiredError(target, missing);
    const url = `https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(String(config.realmId))}/journalentry?minorversion=70`;
    return doFetch(url, {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${config.refreshToken}`,
    }, payload);
  }

  throw new Error(`pushToTarget: target ${target} does not support API push`);
}

function required(config: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((k) => !config[k] || String(config[k]).trim() === "");
}

async function doFetch(url: string, headers: Record<string, string>, payload: unknown): Promise<PushResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const body = await res.text();
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { respHeaders[k] = v; });
    return { ok: res.ok, status: res.status, body: body.slice(0, 4000), headers: respHeaders };
  } finally {
    clearTimeout(timer);
  }
}
