/**
 * AI-assisted email authoring helpers for the Email Center (Task #414).
 *
 * Uses `AIProviderService.generateText` so admins do not need to supply
 * an API key. If no AI provider is configured the helpers fall back to
 * a deterministic template-rewrite that keeps the UI useful.
 */
import { AIProviderService, type CallContext } from "./aiProviderService";
import { logger } from "./logger";

export type AiTone = "friendly" | "professional" | "celebratory" | "urgent" | "casual";
export type AiAction =
  | "draft" | "compose" // aliases
  | "shorten"
  | "lengthen" | "expand" // aliases
  | "rewrite"
  | "subject_lines"
  | "translate";

function normalizeAction(a: AiAction): "draft" | "shorten" | "lengthen" | "rewrite" | "subject_lines" | "translate" {
  if (a === "compose") return "draft";
  if (a === "expand") return "lengthen";
  return a;
}

export type AiAuthorInput = {
  action: AiAction;
  prompt?: string;
  subject?: string;
  body?: string;
  tone?: AiTone;
  audience?: string;
  language?: string;
  brandName?: string;
};

export type AiAuthorOutput = {
  subject?: string;
  preheader?: string;
  body: string;
  subjectVariants?: string[];
  provider?: string;
  model?: string;
};

function fallback(input: AiAuthorInput): AiAuthorOutput {
  const brand = input.brandName ?? "your restaurant";
  const tone = input.tone ?? "friendly";
  const seed = (input.prompt ?? input.body ?? "Big news from us!").slice(0, 200);
  return {
    subject: input.subject ?? `${brand}: ${seed.slice(0, 60)}`,
    preheader: `A quick note from ${brand}`,
    body: `<p>Hi {{name}},</p><p>${seed}</p><p>With ${tone} regards,<br/>${brand}</p>`,
    subjectVariants: normalizeAction(input.action) === "subject_lines"
      ? [
          `${brand}: ${seed.slice(0, 60)}`,
          `A note from ${brand}`,
          `Don't miss this from ${brand}`,
        ]
      : undefined,
  };
}

function tryJson<T = unknown>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { /* try slice */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]) as T; } catch {} }
  return null;
}

const SYSTEM = `You are an email marketing copy assistant for restaurants on a SaaS platform.
Always return STRICT JSON: { "subject": string, "preheader": string, "body": string (HTML), "subjectVariants"?: string[] }.
Use simple inline-styled HTML. Keep tone appropriate to the request. Use {{name}}, {{restaurant}} or {{offer}} as variables when relevant. Never include external scripts. Never include real customer data.`;

export async function generateEmailDraft(
  input: AiAuthorInput,
  ctx: Pick<CallContext, "tenantId" | "restaurantId" | "userId">,
): Promise<AiAuthorOutput> {
  try {
    const action = normalizeAction(input.action);
    const parts: string[] = [];
    parts.push(`Action: ${action}`);
    if (input.brandName) parts.push(`Brand: ${input.brandName}`);
    if (input.audience) parts.push(`Audience: ${input.audience}`);
    if (input.tone) parts.push(`Tone: ${input.tone}`);
    if (input.language) parts.push(`Language: ${input.language}`);
    if (input.subject) parts.push(`Current subject: ${input.subject}`);
    if (input.body) parts.push(`Current body (HTML):\n${input.body}`);
    if (input.prompt) parts.push(`Instruction: ${input.prompt}`);
    if (input.action === "subject_lines") parts.push(`Return 5 short subject line variants in subjectVariants. The body can stay empty.`);

    const out = await AIProviderService.generateText(
      { featureSlug: "email_ai_generation", tenantId: ctx.tenantId ?? null, restaurantId: ctx.restaurantId ?? null, userId: ctx.userId ?? null },
      {
        systemPrompt: SYSTEM,
        messages: [{ role: "user", content: parts.join("\n\n") }],
        jsonMode: true,
        temperature: 0.8,
        maxTokens: 1200,
      },
    );
    const parsed = tryJson<AiAuthorOutput>(out.text);
    if (!parsed) return { ...fallback(input), provider: out.providerSlug, model: out.model };
    return {
      subject: parsed.subject,
      preheader: parsed.preheader,
      body: parsed.body,
      subjectVariants: parsed.subjectVariants,
      provider: out.providerSlug,
      model: out.model,
    };
  } catch (err) {
    logger.warn({ err }, "AI email draft fell back to deterministic template");
    return fallback(input);
  }
}
