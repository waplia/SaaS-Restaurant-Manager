import { eq, and } from "drizzle-orm";
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

function checkSafety(text: string, banned: string[] | undefined): { ok: boolean; reason?: string } {
  if (!banned || banned.length === 0) return { ok: true };
  const lower = text.toLowerCase();
  for (const phrase of banned) {
    if (phrase && lower.includes(phrase.toLowerCase())) {
      return { ok: false, reason: `banned phrase: ${phrase}` };
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
  // If no key set, fall through to env-based proxy client (Replit AI Integrations)
  let client;
  if (provider.apiKey) {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    client = new Anthropic({
      apiKey: provider.apiKey,
      ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
    });
  } else {
    client = anthropicProxy;
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
  const apiKey = provider.apiKey ?? process.env["AI_INTEGRATIONS_GEMINI_API_KEY"];
  if (!apiKey) throw new Error("Gemini provider has no API key");
  const cfg: { apiKey: string; httpOptions?: { baseUrl: string } } = { apiKey };
  const baseUrl = provider.baseUrl ?? process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"];
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
    const banned = safety?.bannedPhrases ?? [];

    // Pre-check user input for banned phrases
    const joined = req.messages.map((m) => m.content).join("\n");
    const safe = checkSafety(joined, banned);
    if (!safe.ok) {
      await logRequest({
        ctx, providerSlug: null, providerId: null, model: null, modality: "text",
        status: "blocked", errorCode: "SAFETY_BLOCK", errorMessage: safe.reason ?? "blocked",
        storePrompt, storeResponse,
      });
      throw new Error(`AI request blocked by safety policy: ${safe.reason}`);
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
    const banned = safety?.bannedPhrases ?? [];
    const safe = checkSafety(req.prompt, banned);
    if (!safe.ok) {
      await logRequest({
        ctx, providerSlug: null, providerId: null, model: null, modality: "image",
        status: "blocked", errorCode: "SAFETY_BLOCK", errorMessage: safe.reason ?? "blocked",
        storePrompt, storeResponse,
      });
      throw new Error(`AI image blocked: ${safe.reason}`);
    }
    const assignment = await loadAssignment(ctx.featureSlug);
    const primaryId = assignment?.primaryProviderId ?? null;
    const primaryModel = assignment?.primaryModel ?? "gemini-2.5-flash-image";
    if (!primaryId) {
      const start = Date.now();
      const { generateImage } = await import("@workspace/integrations-gemini-ai/image");
      const out = await generateImage(req.prompt);
      const latencyMs = Date.now() - start;
      await logRequest({
        ctx, providerSlug: "gemini", providerId: null, model: primaryModel, modality: "image",
        status: "success", latencyMs, prompt: req.prompt, storePrompt, storeResponse,
        costUsd: 0.005,
      });
      return { ...out, providerSlug: "gemini", model: primaryModel, fallbackUsed: false, latencyMs };
    }
    const provider = await loadProvider(primaryId);
    if (!provider) throw new Error("Provider unavailable");
    const start = Date.now();
    if (provider.kind === "gemini") {
      const { generateImage } = await import("@workspace/integrations-gemini-ai/image");
      const out = await generateImage(req.prompt);
      const latencyMs = Date.now() - start;
      await logRequest({
        ctx, providerSlug: provider.slug, providerId: provider.id, model: primaryModel, modality: "image",
        status: "success", latencyMs, prompt: req.prompt, storePrompt, storeResponse,
        costUsd: 0.005,
      });
      return { ...out, providerSlug: provider.slug, model: primaryModel, fallbackUsed: false, latencyMs };
    }
    throw new Error(`Image generation not implemented for provider kind ${provider.kind}`);
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
      const out = await callTextOnce(provider, model, {
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 16,
        temperature: 0,
      });
      const latencyMs = Date.now() - start;
      return { ok: true, latencyMs, model: model + (out.text ? "" : "") };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
