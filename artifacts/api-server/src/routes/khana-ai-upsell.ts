/**
 * Khana AI — Upsell Engine
 *
 * - POST /restaurants/:rid/ai-ops/upsell/suggest         (3 credits, AI-generated rule batch)
 * - GET  /restaurants/:rid/ai-ops/upsell/suggestions     (list AI batches)
 * - PATCH /.../upsell/suggestions/:id                    (dismiss/save)
 * - GET/POST/PATCH/DELETE /restaurants/:rid/ai-ops/upsell/rules
 * - POST /restaurants/:rid/ai-ops/upsell/evaluate        (server-side cart evaluator, no credit)
 * - POST /restaurants/:rid/ai-ops/upsell/events          (impression / accept / convert log)
 * - GET  /restaurants/:rid/ai-ops/upsell/performance     (events aggregated)
 *
 * Plus a public, auth-less mirror for QR menu:
 * - POST /public/restaurants/:rid/upsell/evaluate
 * - POST /public/restaurants/:rid/upsell/events
 */
import { Router, type Request, type Response } from "express";
import { eq, and, desc, gte, sql, inArray } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  menuItemsTable,
  menuCategoriesTable,
  ordersTable,
  orderItemsTable,
  branchesTable,
  aiUpsellRulesTable,
  aiUpsellSuggestionsTable,
  aiUpsellEventsTable,
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
import { recordAuditLog } from "../lib/audit";

const router = Router();

router.use(
  "/restaurants/:restaurantId/ai-ops/upsell:rest",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
);
router.use(
  "/restaurants/:restaurantId/ai-ops/upsell/:rest",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
);

function hashInputs(obj: unknown): string {
  return crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

const TRIGGER_TYPES = new Set([
  "item_in_cart",
  "category_in_cart",
  "cart_total_below_threshold",
  "time_of_day",
  "customer_segment",
]);
const CHANNELS = new Set(["pos", "qr", "both"]);

interface CartLine { menuItemId: number; quantity: number; unitPrice: number; }
interface CartContext {
  channel: "pos" | "qr";
  items: CartLine[];
  total: number;
  customerSegment?: "new" | "returning" | "vip" | null;
  nowMinutes?: number; // minutes since midnight (local)
}

interface RuleRow {
  id: number;
  restaurantId: number;
  branchId: number | null;
  name: string;
  channel: string;
  priority: number;
  isEnabled: boolean;
  triggerType: string;
  triggerConfig: unknown;
  suggestedItemIds: unknown;
  message: string | null;
}

function ruleMatchesCart(rule: RuleRow, ctx: CartContext): boolean {
  if (!rule.isEnabled) return false;
  if (rule.channel !== "both" && rule.channel !== ctx.channel) return false;
  const cfg = (rule.triggerConfig as Record<string, unknown>) ?? {};
  const itemIds = new Set(ctx.items.map((i) => i.menuItemId));
  switch (rule.triggerType) {
    case "item_in_cart": {
      const ids = Array.isArray(cfg.menuItemIds) ? (cfg.menuItemIds as unknown[]).map(Number) : [];
      return ids.some((id) => itemIds.has(id));
    }
    case "category_in_cart": {
      const cats = Array.isArray(cfg.categoryIds) ? (cfg.categoryIds as unknown[]).map(Number) : [];
      const ctxCats = new Set(((ctx as unknown as { categoryIds?: number[] }).categoryIds) ?? []);
      return cats.some((c) => ctxCats.has(c));
    }
    case "cart_total_below_threshold": {
      const threshold = Number(cfg.threshold ?? 0);
      return threshold > 0 && ctx.total > 0 && ctx.total < threshold;
    }
    case "time_of_day": {
      const start = Number(cfg.startMinutes ?? 0);
      const end = Number(cfg.endMinutes ?? 1440);
      const now = ctx.nowMinutes ?? new Date().getHours() * 60 + new Date().getMinutes();
      return start <= end ? now >= start && now < end : now >= start || now < end;
    }
    case "customer_segment": {
      const segs = Array.isArray(cfg.segments) ? (cfg.segments as unknown[]).map(String) : [];
      return ctx.customerSegment ? segs.includes(ctx.customerSegment) : false;
    }
    default: return false;
  }
}

async function loadActiveRules(restaurantId: number, branchId?: number | null): Promise<RuleRow[]> {
  const rows = await db.select().from(aiUpsellRulesTable).where(and(
    eq(aiUpsellRulesTable.restaurantId, restaurantId),
    eq(aiUpsellRulesTable.isEnabled, true),
  )).orderBy(desc(aiUpsellRulesTable.priority));
  // A rule applies if it is global (rule.branchId == null) OR
  // it targets the same branch as the active cart's branch.
  return rows.filter((r) => r.branchId == null || r.branchId === branchId) as unknown as RuleRow[];
}

async function evaluateRulesForCart(restaurantId: number, ctx: CartContext, branchId?: number | null) {
  const rules = await loadActiveRules(restaurantId, branchId);
  // Pre-compute category set so category_in_cart checks work.
  const itemIds = ctx.items.map((i) => i.menuItemId);
  let categoryIds: number[] = [];
  if (itemIds.length > 0) {
    const items = await db.select({ id: menuItemsTable.id, categoryId: menuItemsTable.categoryId })
      .from(menuItemsTable).where(and(
        inArray(menuItemsTable.id, itemIds),
        eq(menuItemsTable.restaurantId, restaurantId),
      ));
    categoryIds = Array.from(new Set(items.map((i) => i.categoryId).filter((x): x is number => x != null)));
  }
  const ctxWithCats = { ...ctx, categoryIds } as CartContext & { categoryIds: number[] };

  const matched: { rule: RuleRow; suggestedItemIds: number[] }[] = [];
  const seenItemIds = new Set<number>(itemIds);
  for (const r of rules) {
    if (r.channel !== "both" && r.channel !== ctx.channel) continue;
    if (!ruleMatchesCart(r, ctxWithCats)) continue;
    const ids = Array.isArray(r.suggestedItemIds) ? (r.suggestedItemIds as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : [];
    // Don't suggest items already in cart.
    const filtered = ids.filter((id) => !seenItemIds.has(id));
    if (filtered.length === 0) continue;
    matched.push({ rule: r, suggestedItemIds: filtered });
    if (matched.length >= 3) break;
  }

  // Hydrate suggested items
  const allIds = Array.from(new Set(matched.flatMap((m) => m.suggestedItemIds)));
  const itemsById = new Map<number, { id: number; name: string; price: string; imageUrl: string | null }>();
  if (allIds.length > 0) {
    const rows = await db.select({
      id: menuItemsTable.id, name: menuItemsTable.name, price: menuItemsTable.price, imageUrl: menuItemsTable.imageUrl,
    }).from(menuItemsTable).where(and(
      inArray(menuItemsTable.id, allIds),
      eq(menuItemsTable.restaurantId, restaurantId),
      eq(menuItemsTable.isAvailable, true),
    ));
    for (const r of rows) itemsById.set(r.id, r);
  }
  return matched.map((m) => ({
    ruleId: m.rule.id,
    ruleName: m.rule.name,
    message: m.rule.message,
    triggerType: m.rule.triggerType,
    items: m.suggestedItemIds.map((id) => itemsById.get(id)).filter((x): x is { id: number; name: string; price: string; imageUrl: string | null } => !!x),
  })).filter((m) => m.items.length > 0);
}

// ────────────────────────── AI Suggestion Generator ──────────────────────────

router.post(
  "/restaurants/:restaurantId/ai-ops/upsell/suggest",
  requireAiCredits("ai_upsell_suggest", () => ({ units: 1 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;
    try {
      const since = new Date(Date.now() - 90 * 86_400_000);
      const [items, categories, coOccur] = await Promise.all([
        db.select({
          id: menuItemsTable.id,
          name: menuItemsTable.name,
          price: menuItemsTable.price,
          categoryId: menuItemsTable.categoryId,
        }).from(menuItemsTable).where(and(
          eq(menuItemsTable.restaurantId, restaurantId),
          eq(menuItemsTable.isAvailable, true),
        )),
        db.select({ id: menuCategoriesTable.id, name: menuCategoriesTable.name })
          .from(menuCategoriesTable).where(eq(menuCategoriesTable.restaurantId, restaurantId)),
        db.select({
          menuItemId: orderItemsTable.menuItemId,
          orderId: orderItemsTable.orderId,
          qty: orderItemsTable.quantity,
        }).from(orderItemsTable)
          .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
          .where(and(
            eq(ordersTable.restaurantId, restaurantId),
            gte(ordersTable.createdAt, since),
          )).limit(5000),
      ]);

      // Build a lightweight pair-frequency map for the model.
      const itemById = new Map(items.map((i) => [i.id, i]));
      const itemsByOrder = new Map<number, Set<number>>();
      for (const r of coOccur) {
        if (!itemById.has(r.menuItemId)) continue;
        const set = itemsByOrder.get(r.orderId) ?? new Set<number>();
        set.add(r.menuItemId);
        itemsByOrder.set(r.orderId, set);
      }
      const pairCount = new Map<string, number>();
      for (const set of itemsByOrder.values()) {
        const arr = Array.from(set);
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const a = Math.min(arr[i], arr[j]); const b = Math.max(arr[i], arr[j]);
            const k = `${a}|${b}`;
            pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
          }
        }
      }
      const topPairs = Array.from(pairCount.entries())
        .sort((a, b) => b[1] - a[1]).slice(0, 25)
        .map(([k, c]) => {
          const [a, b] = k.split("|").map(Number);
          return { a, b, count: c, aName: itemById.get(a)?.name, bName: itemById.get(b)?.name };
        });

      const itemLines = items.slice(0, 80).map((i) => `  - id=${i.id} name="${i.name}" price=${i.price} cat=${i.categoryId ?? "null"}`).join("\n") || "  (no items)";
      const catLines = categories.map((c) => `  - id=${c.id} name="${c.name}"`).join("\n") || "  (no categories)";
      const pairLines = topPairs.map((p) => `  - ${p.aName} (id=${p.a}) + ${p.bName} (id=${p.b}): ordered together ${p.count}×`).join("\n") || "  (insufficient order history)";

      const prompt = `You are a restaurant upsell strategist. Propose 4-6 high-impact upsell rules that nudge guests to add complementary items at the cart step (POS or QR menu).

Menu items (sample):
${itemLines}

Categories:
${catLines}

Top item co-occurrences (last 30 days):
${pairLines}

Return ONLY JSON:
{
  "rules": [
    {
      "name": "<short rule name>",
      "channel": "pos" | "qr" | "both",
      "priority": 50,
      "triggerType": "item_in_cart" | "category_in_cart" | "cart_total_below_threshold" | "time_of_day" | "customer_segment",
      "triggerConfig": {
        // item_in_cart: { "menuItemIds": [<id>...] }
        // category_in_cart: { "categoryIds": [<id>...] }
        // cart_total_below_threshold: { "threshold": <number> }
        // time_of_day: { "startMinutes": <0-1439>, "endMinutes": <0-1439> }
        // customer_segment: { "segments": ["new"|"returning"|"vip"] }
      },
      "suggestedItemIds": [<id>...],
      "message": "<short suggestion line shown to guest, e.g. 'Add fries for ₹49?'>",
      "rationale": "<1 sentence why this should work>",
      "expectedLiftPct": <0-30 estimated % uplift to order value>,
      "confidence": <0-1 your confidence the rule will perform>

    }
  ]
}

Rules:
- Use ONLY item ids from the menu list above.
- Don't suggest items that are already the trigger.
- Prefer items with strong co-occurrence.
- Keep messages under 60 characters.
- Mix triggers — at least one cart_total_below_threshold and one time_of_day rule if reasonable.
- JSON only, no markdown.`;

      const inputsHash = hashInputs({ itemCount: items.length, pairCount: topPairs.length });
      const { data, result } = await AIProviderService.generateJson<{ rules?: unknown }>({
        featureSlug: "ai_upsell_suggest",
        tenantId: req.user?.tenantId ?? null,
        restaurantId,
        userId: req.user?.sub ?? null,
        metadata: { inputsHash, itemCount: items.length },
      }, {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 2000,
      });

      const rawRules = Array.isArray(data.rules) ? data.rules : [];
      const validIds = new Set(items.map((i) => i.id));
      const validCats = new Set(categories.map((c) => c.id));
      const cleanedRules = rawRules.map((raw) => {
        const r = raw as Record<string, unknown>;
        const triggerType = String(r.triggerType ?? "");
        if (!TRIGGER_TYPES.has(triggerType)) return null;
        const channel = String(r.channel ?? "both");
        const ch = CHANNELS.has(channel) ? channel : "both";
        const cfgRaw = (r.triggerConfig as Record<string, unknown>) ?? {};
        const cfg: Record<string, unknown> = {};
        if (triggerType === "item_in_cart") {
          const ids = Array.isArray(cfgRaw.menuItemIds) ? (cfgRaw.menuItemIds as unknown[]).map(Number).filter((n) => validIds.has(n)) : [];
          if (ids.length === 0) return null;
          cfg.menuItemIds = ids;
        } else if (triggerType === "category_in_cart") {
          const ids = Array.isArray(cfgRaw.categoryIds) ? (cfgRaw.categoryIds as unknown[]).map(Number).filter((n) => validCats.has(n)) : [];
          if (ids.length === 0) return null;
          cfg.categoryIds = ids;
        } else if (triggerType === "cart_total_below_threshold") {
          const t = Number(cfgRaw.threshold);
          if (!Number.isFinite(t) || t <= 0) return null;
          cfg.threshold = t;
        } else if (triggerType === "time_of_day") {
          const s = Number(cfgRaw.startMinutes); const e = Number(cfgRaw.endMinutes);
          if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
          cfg.startMinutes = Math.max(0, Math.min(1439, s));
          cfg.endMinutes = Math.max(0, Math.min(1440, e));
        } else if (triggerType === "customer_segment") {
          const segs = Array.isArray(cfgRaw.segments) ? (cfgRaw.segments as unknown[]).map(String).filter((s) => ["new", "returning", "vip"].includes(s)) : [];
          if (segs.length === 0) return null;
          cfg.segments = segs;
        }
        const sugIds = Array.isArray(r.suggestedItemIds) ? (r.suggestedItemIds as unknown[]).map(Number).filter((n) => validIds.has(n)) : [];
        if (sugIds.length === 0) return null;
        return {
          name: String(r.name ?? "Upsell rule").slice(0, 80),
          channel: ch,
          priority: Math.max(0, Math.min(100, Number(r.priority) || 50)),
          triggerType,
          triggerConfig: cfg,
          suggestedItemIds: sugIds.slice(0, 5),
          message: r.message ? String(r.message).slice(0, 120) : null,
          rationale: r.rationale ? String(r.rationale).slice(0, 200) : null,
          expectedLiftPct: Math.max(0, Math.min(50, Number(r.expectedLiftPct) || 0)),
          confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.5)),
        };
      }).filter((x): x is NonNullable<typeof x> => x !== null).slice(0, 6);

      const payload = { rules: cleanedRules };
      const [row] = await db.insert(aiUpsellSuggestionsTable).values({
        restaurantId, inputsHash, payload,
        confidence: cleanedRules.length > 0 ? "0.70" : "0.20",
        status: "active",
        requestLogId: result.requestLogId,
        generatedBy: req.user?.sub ?? null,
      }).returning();

      if (reservation) {
        await commitReservation({ reservation, userId: req.user?.sub ?? null, requestLogId: result.requestLogId });
      }
      await recordAuditLog({
        req, module: "khana_ai", action: "upsell.suggest",
        entity: "ai_upsell_suggestion", entityId: row.id,
        newValue: { ruleCount: cleanedRules.length, requestLogId: result.requestLogId },
      });
      res.json({ suggestion: row });
    } catch (err) {
      if (reservation) await refundReservation(reservation, (err as Error).message ?? "provider error");
      req.log.error({ err }, "AI upsell suggest failed");
      await recordAuditLog({
        req, module: "khana_ai", action: "upsell.suggest_failed",
        entity: "ai_upsell_suggestion",
        newValue: { error: (err as Error).message ?? "provider error" },
      });
      res.status(502).json({ error: "Failed to generate upsell suggestions" });
    }
  },
);

router.get("/restaurants/:restaurantId/ai-ops/upsell/suggestions", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = String(req.query.status ?? "active");
  const rows = await db.select().from(aiUpsellSuggestionsTable).where(and(
    eq(aiUpsellSuggestionsTable.restaurantId, restaurantId),
    eq(aiUpsellSuggestionsTable.status, status),
  )).orderBy(desc(aiUpsellSuggestionsTable.generatedAt)).limit(25);
  res.json({ data: rows });
});

router.patch("/restaurants/:restaurantId/ai-ops/upsell/suggestions/:id", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { status, notes, dismissIndex } = (req.body ?? {}) as {
    status?: string; notes?: string; dismissIndex?: number;
  };
  if (status && !new Set(["active", "saved", "dismissed"]).has(status)) {
    return void res.status(400).json({ error: "Invalid status" });
  }

  // Per-rule dismiss: drop the rule at index from the payload.
  if (dismissIndex != null) {
    const [cur] = await db.select().from(aiUpsellSuggestionsTable).where(and(
      eq(aiUpsellSuggestionsTable.id, id),
      eq(aiUpsellSuggestionsTable.restaurantId, restaurantId),
    ));
    if (!cur) return void res.status(404).json({ error: "Not found" });
    const payload = (cur.payload as { rules?: unknown[] }) ?? {};
    const rules = Array.isArray(payload.rules) ? payload.rules.slice() : [];
    if (dismissIndex < 0 || dismissIndex >= rules.length) {
      return void res.status(400).json({ error: "Invalid index" });
    }
    rules.splice(dismissIndex, 1);
    const newPayload = { ...payload, rules };
    const newStatus = rules.length === 0 ? "dismissed" : cur.status;
    const [row] = await db.update(aiUpsellSuggestionsTable)
      .set({ payload: newPayload, status: newStatus, updatedAt: new Date() })
      .where(eq(aiUpsellSuggestionsTable.id, id)).returning();
    await recordAuditLog({
      req, module: "khana_ai", action: "upsell.suggestion.rule_dismiss",
      entity: "ai_upsell_suggestion", entityId: id, newValue: { dismissIndex },
    });
    return void res.json({ suggestion: row });
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (status) update.status = status;
  if (notes != null) update.notes = String(notes).slice(0, 1000);
  const [row] = await db.update(aiUpsellSuggestionsTable).set(update)
    .where(and(eq(aiUpsellSuggestionsTable.id, id), eq(aiUpsellSuggestionsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req, module: "khana_ai", action: `upsell.suggestion.${status ?? "update"}`,
    entity: "ai_upsell_suggestion", entityId: row.id, newValue: { status, notes },
  });
  res.json({ suggestion: row });
});

// ────────────────────────── Rules CRUD ──────────────────────────

interface RulePatch {
  name?: string;
  channel?: string;
  priority?: number;
  isEnabled?: boolean;
  triggerType?: string;
  triggerConfig?: unknown;
  suggestedItemIds?: unknown;
  message?: string | null;
  branchId?: number | null;
  source?: string;
  suggestionId?: number | null;
}

async function filterOwnedItemIds(restaurantId: number, ids: unknown): Promise<number[]> {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const nums = (ids as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return [];
  const rows = await db.select({ id: menuItemsTable.id })
    .from(menuItemsTable)
    .where(and(inArray(menuItemsTable.id, nums), eq(menuItemsTable.restaurantId, restaurantId)));
  const ok = new Set(rows.map((r) => r.id));
  return nums.filter((n) => ok.has(n));
}

async function filterOwnedCategoryIds(restaurantId: number, ids: unknown): Promise<number[]> {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const nums = (ids as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return [];
  const rows = await db.select({ id: menuCategoriesTable.id })
    .from(menuCategoriesTable)
    .where(and(inArray(menuCategoriesTable.id, nums), eq(menuCategoriesTable.restaurantId, restaurantId)));
  const ok = new Set(rows.map((r) => r.id));
  return nums.filter((n) => ok.has(n));
}

// Scrubs trigger config + suggestedItemIds so all referenced item/category IDs
// belong to the current restaurant. Returns the cleaned norm or an error.
async function scrubRuleForRestaurant(restaurantId: number, norm: Record<string, unknown>): Promise<Record<string, unknown> | { error: string }> {
  if (norm.suggestedItemIds !== undefined) {
    norm.suggestedItemIds = await filterOwnedItemIds(restaurantId, norm.suggestedItemIds);
  }
  const cfg = (norm.triggerConfig ?? {}) as Record<string, unknown>;
  const triggerType = norm.triggerType as string | undefined;
  if (triggerType === "item_in_cart" && cfg.itemIds !== undefined) {
    cfg.itemIds = await filterOwnedItemIds(restaurantId, cfg.itemIds);
    if ((cfg.itemIds as number[]).length === 0) return { error: "No valid itemIds for this restaurant" };
  }
  if (triggerType === "category_in_cart" && cfg.categoryIds !== undefined) {
    cfg.categoryIds = await filterOwnedCategoryIds(restaurantId, cfg.categoryIds);
    if ((cfg.categoryIds as number[]).length === 0) return { error: "No valid categoryIds for this restaurant" };
  }
  norm.triggerConfig = cfg;
  return norm;
}

async function assertBranchOwnership(restaurantId: number, branchId: unknown): Promise<{ ok: true; branchId: number | null } | { ok: false; error: string }> {
  if (branchId == null || branchId === "") return { ok: true, branchId: null };
  const id = Number(branchId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid branchId" };
  const [row] = await db.select({ id: branchesTable.id })
    .from(branchesTable)
    .where(and(eq(branchesTable.id, id), eq(branchesTable.restaurantId, restaurantId)));
  if (!row) return { ok: false, error: "branchId does not belong to this restaurant" };
  return { ok: true, branchId: id };
}

function normalizeRule(input: RulePatch): Record<string, unknown> | { error: string } {
  const out: Record<string, unknown> = {};
  if (input.name != null) out.name = String(input.name).slice(0, 80);
  if (input.channel != null) {
    if (!CHANNELS.has(input.channel)) return { error: "Invalid channel" };
    out.channel = input.channel;
  }
  if (input.priority != null) out.priority = Math.max(0, Math.min(100, Number(input.priority) || 0));
  if (input.isEnabled != null) out.isEnabled = !!input.isEnabled;
  if (input.triggerType != null) {
    if (!TRIGGER_TYPES.has(input.triggerType)) return { error: "Invalid triggerType" };
    out.triggerType = input.triggerType;
  }
  if (input.triggerConfig != null) out.triggerConfig = input.triggerConfig;
  if (input.suggestedItemIds != null) {
    const ids = Array.isArray(input.suggestedItemIds)
      ? (input.suggestedItemIds as unknown[]).map(Number).filter((n) => Number.isFinite(n))
      : [];
    out.suggestedItemIds = ids.slice(0, 5);
  }
  if (input.message !== undefined) out.message = input.message ? String(input.message).slice(0, 120) : null;
  if (input.branchId !== undefined) out.branchId = input.branchId;
  if (input.source != null) out.source = String(input.source).slice(0, 30);
  if (input.suggestionId !== undefined) out.suggestionId = input.suggestionId;
  return out;
}

router.get("/restaurants/:restaurantId/ai-ops/upsell/rules", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(aiUpsellRulesTable)
    .where(eq(aiUpsellRulesTable.restaurantId, restaurantId))
    .orderBy(desc(aiUpsellRulesTable.priority), desc(aiUpsellRulesTable.createdAt));
  res.json({ data: rows });
});

router.post("/restaurants/:restaurantId/ai-ops/upsell/rules", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const norm = normalizeRule((req.body ?? {}) as RulePatch);
  if ("error" in norm) return void res.status(400).json(norm);
  if (!norm.name || !norm.triggerType) return void res.status(400).json({ error: "name and triggerType required" });
  if (norm.branchId !== undefined) {
    const check = await assertBranchOwnership(restaurantId, norm.branchId);
    if (!check.ok) return void res.status(400).json({ error: check.error });
    norm.branchId = check.branchId;
  }
  const scrubbed = await scrubRuleForRestaurant(restaurantId, norm);
  if ("error" in scrubbed) return void res.status(400).json(scrubbed);
  const [row] = await db.insert(aiUpsellRulesTable).values({
    restaurantId,
    name: norm.name as string,
    channel: (norm.channel as string) ?? "both",
    priority: (norm.priority as number) ?? 50,
    isEnabled: norm.isEnabled !== false,
    triggerType: norm.triggerType as string,
    triggerConfig: (norm.triggerConfig as object) ?? {},
    suggestedItemIds: (norm.suggestedItemIds as object) ?? [],
    message: (norm.message as string | null) ?? null,
    branchId: (norm.branchId as number | null) ?? null,
    source: (norm.source as string) ?? "manual",
    suggestionId: (norm.suggestionId as number | null) ?? null,
    createdBy: req.user?.sub ?? null,
  }).returning();
  await recordAuditLog({
    req, module: "khana_ai", action: "upsell.rule.create",
    entity: "ai_upsell_rule", entityId: row.id, newValue: row,
  });
  res.json({ rule: row });
});

router.patch("/restaurants/:restaurantId/ai-ops/upsell/rules/:id", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const norm = normalizeRule((req.body ?? {}) as RulePatch);
  if ("error" in norm) return void res.status(400).json(norm);
  if (norm.branchId !== undefined) {
    const check = await assertBranchOwnership(restaurantId, norm.branchId);
    if (!check.ok) return void res.status(400).json({ error: check.error });
    norm.branchId = check.branchId;
  }
  const scrubbed = await scrubRuleForRestaurant(restaurantId, norm);
  if ("error" in scrubbed) return void res.status(400).json(scrubbed);
  const [row] = await db.update(aiUpsellRulesTable).set({ ...norm, updatedAt: new Date() })
    .where(and(eq(aiUpsellRulesTable.id, id), eq(aiUpsellRulesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req, module: "khana_ai", action: "upsell.rule.update",
    entity: "ai_upsell_rule", entityId: row.id, newValue: norm,
  });
  res.json({ rule: row });
});

router.delete("/restaurants/:restaurantId/ai-ops/upsell/rules/:id", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db.delete(aiUpsellRulesTable)
    .where(and(eq(aiUpsellRulesTable.id, id), eq(aiUpsellRulesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req, module: "khana_ai", action: "upsell.rule.delete",
    entity: "ai_upsell_rule", entityId: id, oldValue: row,
  });
  res.json({ deleted: true });
});

// Bulk-promote multiple AI-suggested rules from a batch (or all of them).
router.post("/restaurants/:restaurantId/ai-ops/upsell/suggestions/:id/accept-bulk", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const indicesIn = (req.body ?? {}).indices as unknown;
  const [sug] = await db.select().from(aiUpsellSuggestionsTable).where(and(
    eq(aiUpsellSuggestionsTable.id, id),
    eq(aiUpsellSuggestionsTable.restaurantId, restaurantId),
  ));
  if (!sug) return void res.status(404).json({ error: "Suggestion not found" });
  const payload = sug.payload as { rules?: Array<Record<string, unknown>> };
  const allRules = payload?.rules ?? [];
  const indices = Array.isArray(indicesIn)
    ? (indicesIn as unknown[]).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < allRules.length)
    : allRules.map((_, i) => i);
  if (indices.length === 0) return void res.status(400).json({ error: "No rules selected" });

  const created: unknown[] = [];
  const skipped: number[] = [];
  for (const idx of indices) {
    const rule = allRules[idx];
    const norm = normalizeRule(rule as RulePatch);
    if ("error" in norm) { skipped.push(idx); continue; }
    const scrubbed = await scrubRuleForRestaurant(restaurantId, norm);
    if ("error" in scrubbed) { skipped.push(idx); continue; }
    const [row] = await db.insert(aiUpsellRulesTable).values({
      restaurantId,
      name: (norm.name as string) ?? "AI Upsell rule",
      channel: (norm.channel as string) ?? "both",
      priority: (norm.priority as number) ?? 50,
      isEnabled: true,
      triggerType: norm.triggerType as string,
      triggerConfig: (norm.triggerConfig as object) ?? {},
      suggestedItemIds: (norm.suggestedItemIds as object) ?? [],
      message: (norm.message as string | null) ?? null,
      source: "ai",
      suggestionId: sug.id,
      createdBy: req.user?.sub ?? null,
    }).returning();
    created.push(row);
  }
  await recordAuditLog({
    req, module: "khana_ai", action: "upsell.suggestion.bulk_accept",
    entity: "ai_upsell_suggestion", entityId: sug.id,
    newValue: { suggestionId: sug.id, indices, createdCount: created.length, skipped },
  });
  res.json({ created, skipped });
});

// Promote a single AI-suggested rule into an active rule (no AI cost).
router.post("/restaurants/:restaurantId/ai-ops/upsell/suggestions/:id/accept", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const idx = Number((req.body ?? {}).index ?? 0);
  const [sug] = await db.select().from(aiUpsellSuggestionsTable).where(and(
    eq(aiUpsellSuggestionsTable.id, id),
    eq(aiUpsellSuggestionsTable.restaurantId, restaurantId),
  ));
  if (!sug) return void res.status(404).json({ error: "Suggestion not found" });
  const payload = sug.payload as { rules?: Array<Record<string, unknown>> };
  const rule = payload?.rules?.[idx];
  if (!rule) return void res.status(400).json({ error: "Invalid rule index" });
  const norm = normalizeRule(rule as RulePatch);
  if ("error" in norm) return void res.status(400).json(norm);
  const scrubbed = await scrubRuleForRestaurant(restaurantId, norm);
  if ("error" in scrubbed) return void res.status(400).json(scrubbed);
  const [row] = await db.insert(aiUpsellRulesTable).values({
    restaurantId,
    name: (norm.name as string) ?? "AI Upsell rule",
    channel: (norm.channel as string) ?? "both",
    priority: (norm.priority as number) ?? 50,
    isEnabled: true,
    triggerType: norm.triggerType as string,
    triggerConfig: (norm.triggerConfig as object) ?? {},
    suggestedItemIds: (norm.suggestedItemIds as object) ?? [],
    message: (norm.message as string | null) ?? null,
    source: "ai",
    suggestionId: sug.id,
    createdBy: req.user?.sub ?? null,
  }).returning();
  await recordAuditLog({
    req, module: "khana_ai", action: "upsell.suggestion.accept",
    entity: "ai_upsell_rule", entityId: row.id, newValue: { suggestionId: sug.id, ruleIndex: idx },
  });
  res.json({ rule: row });
});

// ────────────────────────── Cart Evaluator (private) ──────────────────────────

router.post("/restaurants/:restaurantId/ai-ops/upsell/evaluate", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const body = (req.body ?? {}) as Partial<CartContext> & { branchId?: number | null };
  const channel = body.channel === "qr" ? "qr" : "pos";
  const items = Array.isArray(body.items) ? body.items.map((i) => ({
    menuItemId: Number(i.menuItemId), quantity: Number(i.quantity) || 1, unitPrice: Number(i.unitPrice) || 0,
  })).filter((i) => Number.isFinite(i.menuItemId) && i.menuItemId > 0) : [];
  const total = Number(body.total) || items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const ctx: CartContext = {
    channel, items, total,
    customerSegment: body.customerSegment ?? null,
    nowMinutes: body.nowMinutes,
  };
  const matches = await evaluateRulesForCart(restaurantId, ctx, body.branchId ?? null);
  res.json({ suggestions: matches });
});

// ────────────────────────── Event Logging ──────────────────────────

router.post("/restaurants/:restaurantId/ai-ops/upsell/events", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  await logUpsellEvent(restaurantId, req.body ?? {});
  res.json({ ok: true });
});

async function logUpsellEvent(
  restaurantId: number,
  body: Record<string, unknown>,
  opts: { isPublic?: boolean } = {},
): Promise<void> {
  const events = Array.isArray(body.events) ? body.events as Record<string, unknown>[] : [body];
  // Cap batch size to limit abuse on the public path.
  const capped = opts.isPublic ? events.slice(0, 25) : events.slice(0, 200);

  // Pre-validate ruleId / orderId / menuItemId belong to the same restaurant.
  const ruleIds = Array.from(new Set(capped.map(e => Number(e.ruleId)).filter(n => Number.isFinite(n) && n > 0)));
  const orderIds = Array.from(new Set(capped.map(e => Number(e.orderId)).filter(n => Number.isFinite(n) && n > 0)));
  const menuItemIds = Array.from(new Set(capped.map(e => Number(e.menuItemId)).filter(n => Number.isFinite(n) && n > 0)));
  const validRuleIds = ruleIds.length
    ? new Set((await db.select({ id: aiUpsellRulesTable.id }).from(aiUpsellRulesTable).where(and(
        inArray(aiUpsellRulesTable.id, ruleIds),
        eq(aiUpsellRulesTable.restaurantId, restaurantId),
      ))).map(r => r.id))
    : new Set<number>();
  const validOrderIds = orderIds.length
    ? new Set((await db.select({ id: ordersTable.id }).from(ordersTable).where(and(
        inArray(ordersTable.id, orderIds),
        eq(ordersTable.restaurantId, restaurantId),
      ))).map(r => r.id))
    : new Set<number>();
  const validMenuItemIds = menuItemIds.length
    ? new Set((await db.select({ id: menuItemsTable.id }).from(menuItemsTable).where(and(
        inArray(menuItemsTable.id, menuItemIds),
        eq(menuItemsTable.restaurantId, restaurantId),
      ))).map(r => r.id))
    : new Set<number>();

  for (const ev of capped) {
    const eventType = String(ev.eventType ?? "");
    if (!["impression", "accept", "convert", "dismiss"].includes(eventType)) continue;
    let channel = String(ev.channel ?? "pos");
    if (!["pos", "qr"].includes(channel)) channel = "pos";
    if (opts.isPublic) channel = "qr"; // public path is QR menu only.
    const ruleIdRaw = ev.ruleId != null ? Number(ev.ruleId) : null;
    const orderIdRaw = ev.orderId != null ? Number(ev.orderId) : null;
    const menuItemIdRaw = ev.menuItemId != null ? Number(ev.menuItemId) : null;
    const ruleId = ruleIdRaw && validRuleIds.has(ruleIdRaw) ? ruleIdRaw : null;
    const orderId = orderIdRaw && validOrderIds.has(orderIdRaw) ? orderIdRaw : null;
    const menuItemId = menuItemIdRaw && validMenuItemIds.has(menuItemIdRaw) ? menuItemIdRaw : null;
    // Public callers cannot self-report revenue (would let attackers inflate metrics).
    const revenue = opts.isPublic ? 0 : (Number(ev.revenue) || 0);
    await db.insert(aiUpsellEventsTable).values({
      restaurantId,
      ruleId,
      orderId,
      menuItemId,
      channel,
      eventType,
      revenue: revenue.toFixed(2),
      metadata: (ev.metadata as object) ?? {},
    });
  }
}

// ────────────────────────── Performance ──────────────────────────

router.get("/restaurants/:restaurantId/ai-ops/upsell/performance", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.max(1, Math.min(90, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 86_400_000);
  const channelFilter = String(req.query.channel ?? "all");
  const branchFilter = req.query.branchId != null ? Number(req.query.branchId) : null;

  const conds = [
    eq(aiUpsellEventsTable.restaurantId, restaurantId),
    gte(aiUpsellEventsTable.createdAt, since),
  ];
  if (channelFilter === "pos" || channelFilter === "qr") {
    conds.push(eq(aiUpsellEventsTable.channel, channelFilter));
  }
  // Branch filter scopes to rules belonging to that branch (or null = all branches).
  let branchRuleIds: number[] | null = null;
  if (branchFilter && Number.isFinite(branchFilter)) {
    const rs = await db.select({ id: aiUpsellRulesTable.id }).from(aiUpsellRulesTable).where(and(
      eq(aiUpsellRulesTable.restaurantId, restaurantId),
      eq(aiUpsellRulesTable.branchId, branchFilter),
    ));
    branchRuleIds = rs.map((r) => r.id);
    if (branchRuleIds.length === 0) branchRuleIds = [-1]; // force empty result
    conds.push(inArray(aiUpsellEventsTable.ruleId, branchRuleIds));
  }

  const byRule = await db.select({
    ruleId: aiUpsellEventsTable.ruleId,
    eventType: aiUpsellEventsTable.eventType,
    count: sql<number>`count(*)::int`,
    revenue: sql<string>`coalesce(sum(${aiUpsellEventsTable.revenue}), 0)`,
  }).from(aiUpsellEventsTable).where(and(...conds))
    .groupBy(aiUpsellEventsTable.ruleId, aiUpsellEventsTable.eventType);

  const byChannel = await db.select({
    channel: aiUpsellEventsTable.channel,
    eventType: aiUpsellEventsTable.eventType,
    count: sql<number>`count(*)::int`,
    revenue: sql<string>`coalesce(sum(${aiUpsellEventsTable.revenue}), 0)`,
  }).from(aiUpsellEventsTable).where(and(...conds))
    .groupBy(aiUpsellEventsTable.channel, aiUpsellEventsTable.eventType);

  // Daily time-series
  const series = await db.select({
    day: sql<string>`to_char(date_trunc('day', ${aiUpsellEventsTable.createdAt}), 'YYYY-MM-DD')`,
    eventType: aiUpsellEventsTable.eventType,
    count: sql<number>`count(*)::int`,
    revenue: sql<string>`coalesce(sum(${aiUpsellEventsTable.revenue}), 0)`,
  }).from(aiUpsellEventsTable).where(and(...conds))
    .groupBy(sql`date_trunc('day', ${aiUpsellEventsTable.createdAt})`, aiUpsellEventsTable.eventType)
    .orderBy(sql`date_trunc('day', ${aiUpsellEventsTable.createdAt})`);

  const rules = await db.select({ id: aiUpsellRulesTable.id, name: aiUpsellRulesTable.name })
    .from(aiUpsellRulesTable).where(eq(aiUpsellRulesTable.restaurantId, restaurantId));
  const ruleNames = new Map(rules.map((r) => [r.id, r.name]));

  res.json({
    sinceDays: days,
    channelFilter,
    branchId: branchFilter,
    byRule: byRule.map((r) => ({ ...r, ruleName: r.ruleId ? ruleNames.get(r.ruleId) ?? null : null })),
    byChannel,
    series,
  });
});

// ────────────────────────── Public (QR menu) endpoints ──────────────────────────
//
// These are mounted on the SAME router but use a `/public/...` prefix that
// bypasses the restaurant-scoped auth middleware above (auth gate matches
// `/restaurants/:restaurantId/ai-ops/upsell...`). The api-server mounts this
// router AFTER `authenticate`, so we attach a separate public router below
// that's exported alongside.

export const publicUpsellRouter = Router();

publicUpsellRouter.post("/public/restaurants/:restaurantId/upsell/evaluate", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const body = (req.body ?? {}) as Partial<CartContext>;
  const items = Array.isArray(body.items) ? body.items.map((i) => ({
    menuItemId: Number(i.menuItemId), quantity: Number(i.quantity) || 1, unitPrice: Number(i.unitPrice) || 0,
  })).filter((i) => Number.isFinite(i.menuItemId) && i.menuItemId > 0) : [];
  const total = Number(body.total) || items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const ctx: CartContext = { channel: "qr", items, total, customerSegment: body.customerSegment ?? null, nowMinutes: body.nowMinutes };
  const matches = await evaluateRulesForCart(restaurantId, ctx, null);
  res.json({ suggestions: matches });
});

publicUpsellRouter.post("/public/restaurants/:restaurantId/upsell/events", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  await logUpsellEvent(restaurantId, req.body ?? {}, { isPublic: true });
  res.json({ ok: true });
});

export default router;
