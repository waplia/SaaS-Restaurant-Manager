/**
 * AI Voice Order Assistant.
 *
 * POST /restaurants/:restaurantId/voice-orders/parse
 *
 * Accepts a (browser- or device-) transcribed Hindi/English/Hinglish utterance
 * along with an optional table hint, runs it through the LLM with the live
 * menu + tables as context, and returns a *structured* but *unsaved* order
 * draft. The POS / waiter app shows a confirmation modal on top of this and
 * only calls the existing POST /orders endpoint after the user confirms.
 *
 * Speech-to-text itself runs on the client (Web Speech API on the POS,
 * platform dictation on the mobile keyboard) — this keeps audio off our
 * servers and avoids a second provider integration. The endpoint also
 * accepts a free-form `language` hint that is forwarded to the LLM.
 *
 * Credits: gated by `ai_voice_order` in ai_feature_credit_rules (1 credit per
 * successful parse). Failures refund the reservation.
 *
 * Restaurant-level toggle: the route is hard-gated by the `enableVoiceOrdering`
 * column on `restaurants` so a tenant can opt out even if the plan ships AI.
 */
import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  restaurantsTable,
  menuItemsTable,
  floorTablesTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { AIProviderService } from "../lib/aiProviderService";
import {
  requireAiCredits,
  commitReservation,
  refundReservation,
  type AiCreditReservation,
} from "../lib/aiCredits";
import {
  findBestMenuMatch,
  wordToNumber,
  type MatcherMenuItem,
} from "../lib/voiceOrderMatcher";
import { recordAuditLog } from "../lib/audit";

const router: Router = Router();

router.use(
  "/restaurants/:restaurantId/voice-orders/:rest",
  requireRole("owner", "manager", "waiter", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
);

interface ParsedVoiceItem {
  menuItemId: number | null;
  nameGuess: string;
  quantity: number;
  notes: string | null;
  confidence: number;
}

interface ParsedVoiceResponse {
  transcript: string;
  language: string;
  tableId: number | null;
  tableLabel: string | null;
  items: ParsedVoiceItem[];
  unresolved: Array<{ nameGuess: string; quantity: number; notes: string | null }>;
  notes: string | null;
}

const MAX_TRANSCRIPT_CHARS = 1000;
const MAX_AUDIO_BYTES = 6 * 1024 * 1024; // 6MB

/**
 * POST /restaurants/:restaurantId/voice-orders/transcribe
 *
 * Accepts a base64-encoded audio clip (m4a/webm/wav) recorded by the mobile app
 * and returns its text transcript using OpenAI's gpt-4o-mini-transcribe via the
 * Replit AI Integrations proxy. Used by the mobile VoiceOrderModal in-app mic.
 */
router.post(
  "/restaurants/:restaurantId/voice-orders/transcribe",
  async (req: Request, res: Response) => {
    try {
      const { audioBase64, mimeType, language } = (req.body ?? {}) as {
        audioBase64?: string;
        mimeType?: string;
        language?: string;
      };
      if (!audioBase64 || typeof audioBase64 !== "string") {
        return res.status(400).json({ error: "audioBase64 is required" });
      }
      const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      if (!baseUrl || !apiKey) {
        return res.status(503).json({ error: "Voice transcription is not configured on this server." });
      }
      const cleaned = audioBase64.includes(",") ? audioBase64.split(",")[1] : audioBase64;
      const buf = Buffer.from(cleaned, "base64");
      if (buf.length === 0) return res.status(400).json({ error: "Empty audio" });
      if (buf.length > MAX_AUDIO_BYTES) return res.status(413).json({ error: "Audio too large (max 6MB)" });

      const safeMime = typeof mimeType === "string" && mimeType ? mimeType : "audio/m4a";
      const ext = safeMime.includes("webm") ? "webm" : safeMime.includes("wav") ? "wav" : safeMime.includes("mp3") ? "mp3" : "m4a";
      const blob = new Blob([buf], { type: safeMime });
      const form = new FormData();
      form.append("file", blob, `voice-order.${ext}`);
      form.append("model", "gpt-4o-mini-transcribe");
      if (typeof language === "string" && language) form.append("language", language.slice(0, 5));

      const r = await fetch(`${baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return res.status(502).json({ error: `Transcription failed: ${r.status} ${text.slice(0, 200)}` });
      }
      const data = (await r.json()) as { text?: string };
      return res.json({ transcript: (data.text ?? "").trim() });
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message });
    }
  },
);

router.post(
  "/restaurants/:restaurantId/voice-orders/parse",
  requireAiCredits("ai_voice_order", () => ({ units: 1 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;

    const refund = async (reason: string): Promise<void> => {
      if (reservation) await refundReservation(reservation, reason);
    };

    const body = req.body as {
      transcript?: unknown;
      language?: unknown;
      tableId?: unknown;
    };
    const transcript = typeof body.transcript === "string"
      ? body.transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS)
      : "";
    if (!transcript) {
      await refund("empty transcript");
      return void res.status(400).json({ error: "transcript is required" });
    }
    const language = typeof body.language === "string" && body.language.trim()
      ? body.language.trim().slice(0, 32)
      : "en-IN";
    const hintedTableId = typeof body.tableId === "number" && Number.isFinite(body.tableId)
      ? Math.trunc(body.tableId)
      : null;

    // Hard gate on the per-restaurant feature toggle.
    const [restaurant] = await db
      .select({ id: restaurantsTable.id, enableVoiceOrdering: restaurantsTable.enableVoiceOrdering })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.id, restaurantId));
    if (!restaurant) {
      await refund("restaurant not found");
      return void res.status(404).json({ error: "Restaurant not found" });
    }
    if (!restaurant.enableVoiceOrdering) {
      await refund("voice ordering disabled");
      return void res.status(403).json({
        error: "Voice ordering is disabled for this restaurant.",
        code: "VOICE_ORDERING_DISABLED",
      });
    }

    const menuRows = await db
      .select({
        id: menuItemsTable.id,
        name: menuItemsTable.name,
        price: menuItemsTable.price,
        isAvailable: menuItemsTable.isAvailable,
      })
      .from(menuItemsTable)
      .where(
        and(
          eq(menuItemsTable.restaurantId, restaurantId),
          eq(menuItemsTable.isAvailable, true),
        ),
      );
    const menuMatcher: MatcherMenuItem[] = menuRows.map((m) => ({ id: m.id, name: m.name }));
    const menuById = new Map(menuRows.map((m) => [m.id, m]));

    const tableRows = await db
      .select({
        id: floorTablesTable.id,
        tableNumber: floorTablesTable.tableNumber,
      })
      .from(floorTablesTable)
      .where(eq(floorTablesTable.restaurantId, restaurantId));

    if (menuRows.length === 0) {
      await refund("empty menu");
      return void res.status(409).json({
        error: "No available menu items to match against.",
        code: "EMPTY_MENU",
      });
    }

    const menuPromptList = menuRows
      .slice(0, 250)
      .map((m) => `- id=${m.id} | ${m.name} | ₹${m.price}`)
      .join("\n");
    const tablePromptList = tableRows
      .slice(0, 200)
      .map((t) => `- id=${t.id} | Table ${t.tableNumber}`)
      .join("\n");

    const prompt = `You are a restaurant order-entry assistant. The waiter has just spoken an order in Hindi, English, or a mix (Hinglish). Parse the transcript into structured JSON using ONLY items from the provided menu.

Transcript language hint: ${language}
Transcript: """${transcript}"""

Available menu items (id | name | price):
${menuPromptList}

Available tables (use only if the transcript clearly mentions one):
${tablePromptList || "(no tables)"}

Rules:
1. Extract the *menu items* the waiter is ordering. Map each one to the best matching menu item id from the list. If you cannot confidently map an item, set "menuItemId" to null and put your best guess in "nameGuess".
2. Resolve quantities. Hindi number words map as: ek=1, do=2, teen=3, char=4, paanch=5, chhe=6, saat=7, aath=8, nau=9, das=10. Default to 1 when unspecified. Quantities must be positive integers between 1 and 50.
3. Capture per-item notes from the transcript (e.g. "extra spicy", "no onions", "well done") in "notes". Use null when there is no instruction.
4. If the transcript mentions a table number ("table 5", "paanch number table"), set "tableId" to the matching table id; otherwise null.
5. Return order-level notes in "notes" only when the waiter said something that applies to the whole order (e.g. "make it priority"). Otherwise null.
6. Always respond with JSON ONLY in this exact shape (no markdown fence, no commentary):
{
  "tableId": number | null,
  "items": [
    { "menuItemId": number | null, "nameGuess": "string", "quantity": number, "notes": "string" | null, "confidence": number }
  ],
  "notes": "string" | null
}
"confidence" is a number in [0,1] expressing how sure you are about the menuItemId for that line.`;

    type RawItem = {
      menuItemId?: unknown;
      nameGuess?: unknown;
      quantity?: unknown;
      notes?: unknown;
      confidence?: unknown;
    };
    type RawShape = {
      tableId?: unknown;
      items?: unknown;
      notes?: unknown;
    };

    try {
      const { data, result } = await AIProviderService.generateJson<RawShape>(
        {
          featureSlug: "ai_voice_order",
          tenantId: req.user?.tenantId ?? null,
          restaurantId,
          userId: req.user?.sub ?? null,
          metadata: { transcriptChars: transcript.length, language },
        },
        {
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          maxTokens: 1200,
        },
      );

      const rawItems = Array.isArray(data?.items) ? (data.items as RawItem[]) : [];
      const items: ParsedVoiceItem[] = [];
      const unresolved: ParsedVoiceResponse["unresolved"] = [];

      for (const raw of rawItems) {
        const nameGuess = typeof raw.nameGuess === "string" ? raw.nameGuess.trim() : "";
        if (!nameGuess) continue;

        let qty: number | null = typeof raw.quantity === "number" && Number.isFinite(raw.quantity)
          ? Math.trunc(raw.quantity)
          : typeof raw.quantity === "string"
            ? wordToNumber(raw.quantity) ?? Number.parseInt(raw.quantity, 10)
            : null;
        if (qty == null || Number.isNaN(qty) || qty < 1) qty = 1;
        if (qty > 50) qty = 50;

        const notes = typeof raw.notes === "string" && raw.notes.trim()
          ? raw.notes.trim().slice(0, 240)
          : null;

        let menuItemId: number | null = typeof raw.menuItemId === "number"
          && Number.isFinite(raw.menuItemId)
          ? Math.trunc(raw.menuItemId)
          : null;
        let confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
          ? Math.max(0, Math.min(1, raw.confidence))
          : 0.5;

        // Validate / repair the LLM-supplied id and fall back to fuzzy match
        // when it is missing or hallucinated.
        if (menuItemId != null && !menuById.has(menuItemId)) {
          menuItemId = null;
          confidence = 0;
        }
        if (menuItemId == null) {
          const match = findBestMenuMatch(nameGuess, menuMatcher);
          if (match.item && match.score >= 0.55) {
            menuItemId = match.item.id;
            confidence = Math.max(confidence, match.score);
          } else {
            unresolved.push({ nameGuess, quantity: qty, notes });
            continue;
          }
        }

        items.push({ menuItemId, nameGuess, quantity: qty, notes, confidence });
      }

      // Resolve table: prefer LLM, then explicit hint from caller.
      let tableId: number | null = null;
      if (typeof data?.tableId === "number" && Number.isFinite(data.tableId)) {
        const t = Math.trunc(data.tableId);
        if (tableRows.some((r) => r.id === t)) tableId = t;
      }
      if (tableId == null && hintedTableId != null
        && tableRows.some((r) => r.id === hintedTableId)) {
        tableId = hintedTableId;
      }
      const tableLabel = tableId != null
        ? `Table ${tableRows.find((r) => r.id === tableId)?.tableNumber ?? ""}`.trim()
        : null;

      const orderNotes = typeof data?.notes === "string" && data.notes.trim()
        ? data.notes.trim().slice(0, 500)
        : null;

      if (items.length === 0 && unresolved.length === 0) {
        await refund("no items extracted");
        return void res.status(422).json({
          error: "Could not extract any items from the transcript. Please try again.",
          code: "NO_ITEMS_PARSED",
          transcript,
        });
      }

      if (reservation) {
        await commitReservation({
          reservation,
          userId: req.user?.sub ?? null,
          requestLogId: result.requestLogId,
        });
      }

      await recordAuditLog({
        req,
        module: "khana_ai",
        action: "ai_voice_order.parse",
        entity: "restaurant",
        entityId: restaurantId,
        restaurantId,
        newValue: {
          language,
          transcriptChars: transcript.length,
          items: items.length,
          unresolved: unresolved.length,
          requestLogId: result.requestLogId,
        },
      });

      const payload: ParsedVoiceResponse = {
        transcript,
        language,
        tableId,
        tableLabel,
        items,
        unresolved,
        notes: orderNotes,
      };
      res.json(payload);
    } catch (error) {
      await refund((error as Error).message ?? "provider error");
      req.log.error({ err: error }, "Voice order parsing failed");
      res.status(502).json({
        error: "AI voice parsing failed. Please try again.",
        detail: (error as Error).message ?? "provider error",
      });
    }
  },
);

export default router;
