import { eq, and, gte, sql } from "drizzle-orm";
import {
  db,
  aiProvidersTable,
  aiFeatureModelAssignmentsTable,
  aiSafetySettingsTable,
  aiRequestLogsTable,
} from "./db";
import { decryptSecret } from "./aiEncryption";
import { logger } from "./logger";
import { anthropic as anthropicProxy } from "@workspace/integrations-anthropic-ai";

export type Modality = "text" | "json" | "vision" | "image";

export interface ProviderRow {
  id: number;
  slug: string;
  kind: string;
  baseUrl: string | null;
  orgId: string | null;
  defaultModel: string | null;
  backupModel: string | null;
  timeoutMs: number;
  maxTokens: number;
  apiKey: string | null;
}

export interface CallContext {
  featureSlug: string;
  tenantId?: number | null;
  restaurantId?: number | null;
  userId?: number | null;
  metadata?: Record<string, unknown>;
}

export interface TextRequest {
  systemPrompt?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  // Override model resolution
  forceProviderId?: number;
  forceModel?: string;
}

export interface TextResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  providerSlug: string;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
}

export interface ImageRequest {
  prompt: string;
  size?: "512x512" | "1024x1024";
}
export interface ImageResult {
  b64_json: string;
  mimeType: string;
  providerSlug: string;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
}

async function loadProvider(id: number): Promise<ProviderRow | null> {
  const [row] = await db.select().from(aiProvidersTable).where(eq(aiProvidersTable.id, id));
  if (!row) return null;
  if (!row.isEnabled) return null;
  const apiKey = decryptSecret({ cipher: row.apiKeyCipher, iv: row.apiKeyIv, tag: row.apiKeyTag });
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    baseUrl: row.baseUrl,
    orgId: row.orgId,
    defaultModel: row.defaultModel,
    backupModel: row.backupModel,
    timeoutMs: row.timeoutMs,
    maxTokens: row.maxTokens,
    apiKey,
  };
}

async function loadAssignment(featureSlug: string) {
  const [row] = await db
    .select()
    .from(aiFeatureModelAssignmentsTable)
    .where(and(
      eq(aiFeatureModelAssignmentsTable.featureSlug, featureSlug),
      eq(aiFeatureModelAssignmentsTable.isEnabled, true),
    ));
  return row ?? null;
}

async function loadSafety() {
  const [row] = await db.select().from(aiSafetySettingsTable).limit(1);
  return row ?? null;
}

// Built-in policy patterns enforced when the corresponding safety toggle is on.
const POLICY_PATTERNS = {
  abuse: [/\b(kill|murder|rape|terror(?:ist)?)\b/i, /\b(slur|n[i1]gger|f[a@]gg[o0]t)\b/i],
  health: [/\bcure[sd]?\s+(cancer|diabetes|covid|aids|hiv)\b/i, /\bguarantee[sd]?\s+(weight\s*loss|cure)\b/i],
  defamation: [/\b(is\s+a\s+)?(fraud|scammer|criminal|thief|liar)\b/i],
} as const;

function checkSafety(
  text: string,
  safety: { bannedPhrases: string[]; blockAbuse: boolean; blockHealthClaims: boolean; blockDefamation: boolean } | null,
): { ok: boolean; reason?: string } {
  if (!safety) return { ok: true };
  const lower = text.toLowerCase();
  for (const phrase of safety.bannedPhrases ?? []) {
    if (phrase && lower.includes(phrase.toLowerCase())) {
      return { ok: false, reason: `banned phrase: ${phrase}` };
    }
  }
  if (safety.blockAbuse) {
    for (const re of POLICY_PATTERNS.abuse) if (re.test(text)) return { ok: false, reason: "abuse policy" };
  }
  if (safety.blockHealthClaims) {
    for (const re of POLICY_PATTERNS.health) if (re.test(text)) return { ok: false, reason: "health-claim policy" };
  }
  if (safety.blockDefamation) {
    for (const re of POLICY_PATTERNS.defamation) if (re.test(text)) return { ok: false, reason: "defamation policy" };
  }
  return { ok: true };
}

// Rate-limit pre-check based on safety settings (per-minute global, per-day per-restaurant).
async function checkRateLimit(
  ctx: CallContext,
  safety: { rateLimitPerMinute: number; rateLimitPerDayPerRestaurant: number } | null,
): Promise<{ ok: boolean; reason?: string }> {
  if (!safety) return { ok: true };
  const oneMinAgo = new Date(Date.now() - 60_000);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
    .from(aiRequestLogsTable)
    .where(gte(aiRequestLogsTable.createdAt, oneMinAgo));
  if (Number(n) >= safety.rateLimitPerMinute) {
    return { ok: false, reason: `global rate limit (${safety.rateLimitPerMinute}/min) exceeded` };
  }
  if (ctx.restaurantId) {
    const oneDayAgo = new Date(Date.now() - 86_400_000);
    const [{ n: rn }] = await db.select({ n: sql<number>`count(*)::int` })
      .from(aiRequestLogsTable)
      .where(and(
        gte(aiRequestLogsTable.createdAt, oneDayAgo),
        eq(aiRequestLogsTable.restaurantId, ctx.restaurantId),
      ));
    if (Number(rn) >= safety.rateLimitPerDayPerRestaurant) {
      return { ok: false, reason: `daily rate limit per restaurant (${safety.rateLimitPerDayPerRestaurant}) exceeded` };
    }
  }
  return { ok: true };
}

// ---------- Adapter: OpenAI-compatible (OpenAI, Groq, Mistral, OpenRouter, Perplexity, Custom) ----------
async function callOpenAICompatible(
  provider: ProviderRow,
  model: string,
  req: TextRequest,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const baseUrl = provider.baseUrl
    ?? (provider.kind === "openai" ? "https://api.openai.com/v1"
      : provider.kind === "groq" ? "https://api.groq.com/openai/v1"
      : provider.kind === "mistral" ? "https://api.mistral.ai/v1"
      : provider.kind === "openrouter" ? "https://openrouter.ai/api/v1"
      : provider.kind === "perplexity" ? "https://api.perplexity.ai"
      : null);
  if (!baseUrl) throw new Error(`No baseUrl configured for provider ${provider.slug}`);
  if (!provider.apiKey) throw new Error(`Provider ${provider.slug} has no API key`);

  const messages: Array<{ role: string; content: string }> = [];
  if (req.systemPrompt) messages.push({ role: "system", content: req.systemPrompt });
  for (const m of req.messages) messages.push({ role: m.role, content: m.content });

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: req.maxTokens ?? provider.maxTokens,
    temperature: req.temperature ?? 0.7,
  };
  if (req.jsonMode) body["response_format"] = { type: "json_object" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };
  if (provider.orgId && provider.kind === "openai") headers["OpenAI-Organization"] = provider.orgId;

  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), provider.timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      text,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  } finally {
    clearTimeout(tm);
  }
}

// ---------- Adapter: Anthropic ----------
async function callAnthropic(
  provider: ProviderRow,
  model: string,
  req: TextRequest,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  // Use admin-configured key. Allow Replit env-proxy fallback only when explicitly opted in via config.
  let client;
  if (provider.apiKey) {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    client = new Anthropic({
      apiKey: provider.apiKey,
      ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
    });
  } else if ((provider as ProviderRow & { config?: { useReplitProxy?: boolean } }).config?.useReplitProxy) {
    client = anthropicProxy;
  } else {
    throw new Error(`Anthropic provider ${provider.slug} has no API key`);
  }
  const message = await client.messages.create({
    model,
    max_tokens: req.maxTokens ?? provider.maxTokens,
    ...(req.systemPrompt ? { system: req.systemPrompt } : {}),
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  });
  const block = message.content[0];
  const text = block && block.type === "text" ? block.text : "";
  return {
    text,
    inputTokens: message.usage?.input_tokens ?? 0,
    outputTokens: message.usage?.output_tokens ?? 0,
  };
}

// ---------- Adapter: Gemini ----------
async function callGemini(
  provider: ProviderRow,
  model: string,
  req: TextRequest,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const { GoogleGenAI } = await import("@google/genai");
  const useProxy = (provider as ProviderRow & { config?: { useReplitProxy?: boolean } }).config?.useReplitProxy;
  const apiKey = provider.apiKey ?? (useProxy ? process.env["AI_INTEGRATIONS_GEMINI_API_KEY"] : undefined);
  if (!apiKey) throw new Error(`Gemini provider ${provider.slug} has no API key`);
  const cfg: { apiKey: string; httpOptions?: { baseUrl: string } } = { apiKey };
  const baseUrl = provider.baseUrl ?? (useProxy ? process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"] : undefined);
  if (baseUrl) cfg.httpOptions = { baseUrl };
  const ai = new GoogleGenAI(cfg);

  const contents = req.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const config: Record<string, unknown> = {
    maxOutputTokens: req.maxTokens ?? provider.maxTokens,
    temperature: req.temperature ?? 0.7,
  };
  if (req.systemPrompt) config["systemInstruction"] = req.systemPrompt;
  if (req.jsonMode) config["responseMimeType"] = "application/json";

  const response = await ai.models.generateContent({ model, contents, config });
  const text = response.text ?? "";
  const usage = response.usageMetadata;
  return {
    text,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}

// ---------- Adapter: Replicate (text via prediction polling) ----------
async function callReplicate(
  provider: ProviderRow,
  model: string,
  req: TextRequest,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  if (!provider.apiKey) throw new Error(`Replicate provider ${provider.slug} has no API key`);
  const baseUrl = provider.baseUrl ?? "https://api.replicate.com/v1";
  const prompt = (req.systemPrompt ? `${req.systemPrompt}\n\n` : "") + req.messages.map(m => m.content).join("\n");
  const startRes = await fetch(`${baseUrl}/models/${model}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json", Prefer: "wait" },
    body: JSON.stringify({ input: { prompt, max_new_tokens: req.maxTokens ?? provider.maxTokens, temperature: req.temperature ?? 0.7 } }),
  });
  if (!startRes.ok) throw new Error(`Replicate HTTP ${startRes.status}: ${(await startRes.text()).slice(0, 300)}`);
  const data = await startRes.json() as { status?: string; output?: unknown; error?: string };
  if (data.status === "failed" || data.error) throw new Error(`Replicate failed: ${data.error ?? "unknown"}`);
  const output = Array.isArray(data.output) ? data.output.join("") : String(data.output ?? "");
  return { text: output, inputTokens: 0, outputTokens: 0 };
}

// ---------- Adapter: Stability (image only — text not supported) ----------
async function callStabilityImage(
  provider: ProviderRow,
  prompt: string,
): Promise<{ b64_json: string; mimeType: string }> {
  if (!provider.apiKey) throw new Error(`Stability provider ${provider.slug} has no API key`);
  const baseUrl = provider.baseUrl ?? "https://api.stability.ai/v2beta";
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("output_format", "png");
  const res = await fetch(`${baseUrl}/stable-image/generate/core`, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}`, Accept: "image/*" },
    body: form,
  });
  if (!res.ok) throw new Error(`Stability HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { b64_json: buf.toString("base64"), mimeType: "image/png" };
}

async function callReplicateImage(
  provider: ProviderRow,
  model: string,
  prompt: string,
): Promise<{ b64_json: string; mimeType: string }> {
  if (!provider.apiKey) throw new Error(`Replicate provider ${provider.slug} has no API key`);
  const baseUrl = provider.baseUrl ?? "https://api.replicate.com/v1";
  const startRes = await fetch(`${baseUrl}/models/${model}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json", Prefer: "wait" },
    body: JSON.stringify({ input: { prompt } }),
  });
  if (!startRes.ok) throw new Error(`Replicate HTTP ${startRes.status}: ${(await startRes.text()).slice(0, 300)}`);
  const data = await startRes.json() as { output?: string | string[]; error?: string };
  const url = Array.isArray(data.output) ? data.output[0] : data.output;
  if (!url) throw new Error(`Replicate image failed: ${data.error ?? "no output"}`);
  const imgRes = await fetch(url);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const mimeType = imgRes.headers.get("content-type") ?? "image/png";
  return { b64_json: buf.toString("base64"), mimeType };
}

async function callTextOnce(
  provider: ProviderRow,
  model: string,
  req: TextRequest,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  switch (provider.kind) {
    case "anthropic":
      return callAnthropic(provider, model, req);
    case "gemini":
      return callGemini(provider, model, req);
    case "replicate":
      return callReplicate(provider, model, req);
    case "stability":
      throw new Error("Stability provider supports image generation only, not text");
    case "openai":
    case "groq":
    case "mistral":
    case "openrouter":
    case "perplexity":
    case "custom":
      return callOpenAICompatible(provider, model, req);
    default:
      throw new Error(`Unsupported provider kind: ${provider.kind}`);
  }
}

function estimateCost(
  provider: ProviderRow,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Best-effort using provider model cost table is loaded async; default 0.
  void provider; void model;
  // Lightweight estimate: $0.50/M input + $1.50/M output as a generic baseline.
  return (inputTokens / 1_000_000) * 0.5 + (outputTokens / 1_000_000) * 1.5;
}

async function logRequest(params: {
  ctx: CallContext;
  providerSlug: string | null;
  providerId: number | null;
  model: string | null;
  modality: Modality;
  status: "success" | "error" | "blocked";
  errorCode?: string | null;
  errorMessage?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  retries?: number;
  fallbackUsed?: boolean;
  costUsd?: number;
  prompt?: string;
  response?: string;
  storePrompt: boolean;
  storeResponse: boolean;
}) {
  try {
    const inputTokens = params.inputTokens ?? 0;
    const outputTokens = params.outputTokens ?? 0;
    await db.insert(aiRequestLogsTable).values({
      featureSlug: params.ctx.featureSlug,
      providerId: params.providerId,
      providerSlug: params.providerSlug,
      model: params.model,
      modality: params.modality,
      status: params.status,
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ?? null,
      tenantId: params.ctx.tenantId ?? null,
      restaurantId: params.ctx.restaurantId ?? null,
      userId: params.ctx.userId ?? null,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs: params.latencyMs ?? null,
      retries: params.retries ?? 0,
      fallbackUsed: params.fallbackUsed ?? false,
      costUsd: String(params.costUsd ?? 0),
      creditsUsed: 0,
      promptSnapshot: params.storePrompt && params.prompt ? params.prompt.slice(0, 8000) : null,
      responseSnapshot: params.storeResponse && params.response ? params.response.slice(0, 8000) : null,
      metadata: params.ctx.metadata ?? {},
    });
  } catch (err) {
    logger.warn({ err }, "ai request log write failed");
  }
}

// ---------- Public API ----------
export class AIProviderService {
  static async generateText(ctx: CallContext, req: TextRequest): Promise<TextResult> {
    const safety = await loadSafety();
    const storePrompt = safety?.storePrompt ?? true;
    const storeResponse = safety?.storeResponse ?? true;
    const maxRetries = safety?.maxRetries ?? 2;

    // Pre-check user input against full safety policy
    const joined = req.messages.map((m) => m.content).join("\n");
    const safe = checkSafety(joined, safety);
    if (!safe.ok) {
      await logRequest({
        ctx, providerSlug: null, providerId: null, model: null, modality: "text",
        status: "blocked", errorCode: "SAFETY_BLOCK", errorMessage: safe.reason ?? "blocked",
        storePrompt, storeResponse,
      });
      throw new Error(`AI request blocked by safety policy: ${safe.reason}`);
    }
    const rl = await checkRateLimit(ctx, safety);
    if (!rl.ok) {
      await logRequest({
        ctx, providerSlug: null, providerId: null, model: null, modality: "text",
        status: "blocked", errorCode: "RATE_LIMIT", errorMessage: rl.reason ?? "rate limited",
        storePrompt, storeResponse,
      });
      throw new Error(`AI request blocked: ${rl.reason}`);
    }

    // Resolve provider/model
    const assignment = await loadAssignment(ctx.featureSlug);
    let primaryId = req.forceProviderId ?? assignment?.primaryProviderId ?? null;
    let primaryModel = req.forceModel ?? assignment?.primaryModel ?? null;
    let fallbackId = assignment?.fallbackProviderId ?? null;
    let fallbackModel = assignment?.fallbackModel ?? null;

    if (!primaryId) {
      // Pick any enabled provider as last-ditch
      const [first] = await db.select().from(aiProvidersTable).where(eq(aiProvidersTable.isEnabled, true)).limit(1);
      if (first) { primaryId = first.id; primaryModel = first.defaultModel; }
    }
    if (!primaryId || !primaryModel) {
      const err = "No AI provider/model configured for feature " + ctx.featureSlug;
      await logRequest({
        ctx, providerSlug: null, providerId: null, model: null, modality: "text",
        status: "error", errorCode: "NO_PROVIDER", errorMessage: err,
        storePrompt, storeResponse,
      });
      throw new Error(err);
    }

    const sysPrompt = req.systemPrompt ?? assignment?.systemPrompt ?? undefined;
    const temperature = req.temperature ?? Number(assignment?.temperature ?? 0.7);
    const maxTokens = req.maxTokens ?? assignment?.maxTokens ?? 2048;
    const jsonMode = req.jsonMode ?? assignment?.jsonMode ?? false;

    const tryCall = async (id: number, model: string, fallbackUsed: boolean): Promise<TextResult> => {
      const provider = await loadProvider(id);
      if (!provider) throw new Error(`Provider ${id} not available`);
      let lastErr: unknown = null;
      let retries = 0;
      const start = Date.now();
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const out = await callTextOnce(provider, model, {
            ...req,
            systemPrompt: sysPrompt,
            temperature,
            maxTokens,
            jsonMode,
          });
          const latencyMs = Date.now() - start;
          const cost = estimateCost(provider, model, out.inputTokens, out.outputTokens);
          await logRequest({
            ctx, providerSlug: provider.slug, providerId: provider.id, model, modality: jsonMode ? "json" : "text",
            status: "success", inputTokens: out.inputTokens, outputTokens: out.outputTokens,
            latencyMs, retries, fallbackUsed, costUsd: cost,
            prompt: joined, response: out.text,
            storePrompt, storeResponse,
          });
          return {
            text: out.text,
            inputTokens: out.inputTokens,
            outputTokens: out.outputTokens,
            providerSlug: provider.slug,
            model,
            fallbackUsed,
            latencyMs,
          };
        } catch (err) {
          lastErr = err;
          retries = attempt + 1;
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
          }
        }
      }
      const latencyMs = Date.now() - start;
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      await logRequest({
        ctx, providerSlug: provider.slug, providerId: provider.id, model, modality: "text",
        status: "error", errorMessage: msg, latencyMs, retries, fallbackUsed,
        prompt: joined, storePrompt, storeResponse,
      });
      throw lastErr ?? new Error("AI call failed");
    };

    try {
      return await tryCall(primaryId, primaryModel, false);
    } catch (primaryErr) {
      if (fallbackId && fallbackModel) {
        try {
          return await tryCall(fallbackId, fallbackModel, true);
        } catch {
          throw primaryErr;
        }
      }
      throw primaryErr;
    }
  }

  static async generateJson<T = unknown>(ctx: CallContext, req: TextRequest): Promise<{ data: T; result: TextResult }> {
    const result = await this.generateText(ctx, { ...req, jsonMode: true });
    const cleaned = result.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const data = JSON.parse(cleaned) as T;
    return { data, result };
  }

  static async generateVision(ctx: CallContext, req: TextRequest & { imageDataUrl: string }): Promise<TextResult> {
    // Vision is currently routed through the same text path; callers embed image
    // descriptions as text. Full multimodal payloads to be added when an
    // assignment opts into vision in a follow-up task.
    return this.generateText(ctx, req);
  }

  static async generateImage(ctx: CallContext, req: ImageRequest): Promise<ImageResult> {
    const safety = await loadSafety();
    const storePrompt = safety?.storePrompt ?? true;
    const storeResponse = safety?.storeResponse ?? true;
    const safe = checkSafety(req.prompt, safety);
    if (!safe.ok) {
      await logRequest({
        ctx, providerSlug: null, providerId: null, model: null, modality: "image",
        status: "blocked", errorCode: "SAFETY_BLOCK", errorMessage: safe.reason ?? "blocked",
        storePrompt, storeResponse,
      });
      throw new Error(`AI image blocked: ${safe.reason}`);
    }
    const rl = await checkRateLimit(ctx, safety);
    if (!rl.ok) {
      await logRequest({
        ctx, providerSlug: null, providerId: null, model: null, modality: "image",
        status: "blocked", errorCode: "RATE_LIMIT", errorMessage: rl.reason ?? "rate limited",
        storePrompt, storeResponse,
      });
      throw new Error(`AI image blocked: ${rl.reason}`);
    }
    const assignment = await loadAssignment(ctx.featureSlug);
    const primaryId = assignment?.primaryProviderId ?? null;
    const primaryModel = assignment?.primaryModel ?? "gemini-2.5-flash-image";
    const start = Date.now();
    const runDefaultGemini = async () => {
      const { generateImage } = await import("@workspace/integrations-gemini-ai/image");
      return generateImage(req.prompt);
    };
    const callImage = async (provider: ProviderRow | null): Promise<{ b64_json: string; mimeType: string; providerSlug: string; model: string }> => {
      if (!provider) {
        const out = await runDefaultGemini();
        return { ...out, providerSlug: "gemini", model: primaryModel };
      }
      switch (provider.kind) {
        case "gemini": {
          const out = await runDefaultGemini();
          return { ...out, providerSlug: provider.slug, model: primaryModel };
        }
        case "stability": {
          const out = await callStabilityImage(provider, req.prompt);
          return { ...out, providerSlug: provider.slug, model: primaryModel };
        }
        case "replicate": {
          const out = await callReplicateImage(provider, primaryModel, req.prompt);
          return { ...out, providerSlug: provider.slug, model: primaryModel };
        }
        default:
          throw new Error(`Image generation not implemented for provider kind ${provider.kind}`);
      }
    };
    try {
      const provider = primaryId ? await loadProvider(primaryId) : null;
      if (primaryId && !provider) throw new Error("Configured image provider unavailable");
      const out = await callImage(provider);
      const latencyMs = Date.now() - start;
      await logRequest({
        ctx, providerSlug: out.providerSlug, providerId: provider?.id ?? null, model: out.model, modality: "image",
        status: "success", latencyMs, prompt: req.prompt, storePrompt, storeResponse,
        costUsd: 0.005,
      });
      return { b64_json: out.b64_json, mimeType: out.mimeType, providerSlug: out.providerSlug, model: out.model, fallbackUsed: false, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      await logRequest({
        ctx, providerSlug: null, providerId: primaryId, model: primaryModel, modality: "image",
        status: "error", errorMessage: msg, latencyMs, prompt: req.prompt,
        storePrompt, storeResponse,
      });
      throw err;
    }
  }

  static async pingProvider(providerId: number): Promise<{ ok: boolean; latencyMs: number; error?: string; model?: string }> {
    const provider = await loadProvider(providerId);
    if (!provider) {
      // Re-fetch even disabled providers for a meaningful error
      const [row] = await db.select().from(aiProvidersTable).where(eq(aiProvidersTable.id, providerId));
      if (!row) return { ok: false, latencyMs: 0, error: "Provider not found" };
      if (!row.isEnabled) return { ok: false, latencyMs: 0, error: "Provider is disabled" };
      return { ok: false, latencyMs: 0, error: "Could not load provider key" };
    }
    const model = provider.defaultModel ?? "";
    if (!model) return { ok: false, latencyMs: 0, error: "No default model configured" };
    const start = Date.now();
    try {
      if (provider.kind === "stability") {
        // Image-only provider: ping by generating a tiny prompt
        await callStabilityImage(provider, "test ping");
      } else if (provider.kind === "replicate") {
        await callReplicate(provider, model, { messages: [{ role: "user", content: "ping" }], maxTokens: 8, temperature: 0 });
      } else {
        await callTextOnce(provider, model, {
          messages: [{ role: "user", content: "ping" }],
          maxTokens: 16,
          temperature: 0,
        });
      }
      return { ok: true, latencyMs: Date.now() - start, model };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
