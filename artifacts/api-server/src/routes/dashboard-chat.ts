/**
 * Dashboard AI Chat Assistant.
 *
 * A persistent chat panel that lives in the restaurant dashboard layout.
 * The model can call a small set of tenant-scoped read-only tools to look
 * up restaurant data (top sellers, low margin items, inactive customers,
 * stock to reorder, late staff, recent reviews) and can also draft copy
 * (campaign messages, review replies). Every assistant turn debits the
 * tenant's AI credit wallet via `dashboard_chat_assistant`.
 *
 * Gated by:
 *   - requireRole(owner | manager | cashier | waiter | super_admin)
 *   - validateRestaurantAccess
 *   - requirePlanFeature("dashboard_chat_enabled")
 *
 * Role gating for tools: cashier/waiter cannot access salary, staff
 * lateness or staff personal data.
 */
import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  aiChatConversationsTable,
  aiChatMessagesTable,
  ordersTable,
  orderItemsTable,
  menuItemsTable,
  inventoryItemsTable,
  recipeMappingsTable,
  customersTable,
  attendanceTable,
  staffTable,
  usersTable,
  externalReviewsTable,
  customerFeedbackTable,
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
import { logger } from "../lib/logger";

const router = Router();

const FEATURE_SLUG = "dashboard_chat_assistant";
const MAX_TOOL_ITERATIONS = 5;

// ─── Tools ───────────────────────────────────────────────────────────────────

interface ToolContext {
  tenantId: number;
  restaurantId: number;
  role: string;
  isSuperAdmin: boolean;
}

interface ToolDefinition {
  name: string;
  description: string;
  /** Roles allowed to invoke this tool. */
  allowedRoles: string[];
  /** JSON-schema-ish description of args, included in the system prompt. */
  args: string;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
}

function asInt(v: unknown, fallback: number, max?: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.max(1, Math.floor(n));
  return max ? Math.min(max, i) : i;
}

const TOOLS: ToolDefinition[] = [
  {
    name: "top_selling_items",
    description: "List the top-selling menu items in the last N days for the active restaurant by quantity and revenue.",
    allowedRoles: ["owner", "manager", "cashier", "waiter", "super_admin"],
    args: "{ days?: number (1-90, default 30), limit?: number (1-20, default 10) }",
    run: async (ctx, args) => {
      const days = asInt(args.days, 30, 90);
      const limit = asInt(args.limit, 10, 20);
      const since = new Date(Date.now() - days * 86_400_000);
      const rows = await db
        .select({
          menuItemId: orderItemsTable.menuItemId,
          name: orderItemsTable.menuItemName,
          quantity: sql<number>`coalesce(sum(${orderItemsTable.quantity}), 0)::int`,
          revenue: sql<number>`coalesce(sum(${orderItemsTable.totalPrice}), 0)::float`,
        })
        .from(orderItemsTable)
        .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
        .where(and(
          eq(ordersTable.restaurantId, ctx.restaurantId),
          gte(ordersTable.createdAt, since),
          inArray(ordersTable.status, ["completed", "served", "delivered"]),
        ))
        .groupBy(orderItemsTable.menuItemId, orderItemsTable.menuItemName)
        .orderBy(sql`sum(${orderItemsTable.quantity}) desc`)
        .limit(limit);
      return { sinceDays: days, items: rows };
    },
  },
  {
    name: "low_margin_items",
    description: "List menu items with low gross margin (price minus ingredient cost) based on the recipe mappings. Items without recipes are skipped.",
    allowedRoles: ["owner", "manager", "super_admin"],
    args: "{ limit?: number (1-20, default 10), minMarginPct?: number (margin threshold below which items are returned, default 30) }",
    run: async (ctx, args) => {
      const limit = asInt(args.limit, 10, 20);
      const threshold = Number(args.minMarginPct ?? 30);
      const items = await db
        .select({ id: menuItemsTable.id, name: menuItemsTable.name, price: menuItemsTable.price })
        .from(menuItemsTable)
        .where(and(eq(menuItemsTable.restaurantId, ctx.restaurantId), eq(menuItemsTable.isAvailable, true)))
        .limit(200);
      const out: Array<{ id: number; name: string; price: number; cost: number; marginPct: number }> = [];
      for (const it of items) {
        const recipe = await db.select({
          quantity: recipeMappingsTable.quantity,
          costPerUnit: inventoryItemsTable.costPerUnit,
        })
          .from(recipeMappingsTable)
          .innerJoin(inventoryItemsTable, eq(inventoryItemsTable.id, recipeMappingsTable.inventoryItemId))
          .where(and(
            eq(recipeMappingsTable.restaurantId, ctx.restaurantId),
            eq(recipeMappingsTable.menuItemId, it.id),
          ));
        if (recipe.length === 0) continue;
        const cost = recipe.reduce((s, r) => s + Number(r.quantity) * Number(r.costPerUnit), 0);
        const price = Number(it.price);
        if (price <= 0) continue;
        const marginPct = ((price - cost) / price) * 100;
        if (marginPct < threshold) {
          out.push({ id: it.id, name: it.name, price, cost: Math.round(cost * 100) / 100, marginPct: Math.round(marginPct * 10) / 10 });
        }
      }
      out.sort((a, b) => a.marginPct - b.marginPct);
      return { thresholdPct: threshold, items: out.slice(0, limit) };
    },
  },
  {
    name: "inactive_customers",
    description: "List customers who have not ordered in the last N days. Returns name, phone, last order date and historical spend.",
    allowedRoles: ["owner", "manager", "super_admin"],
    args: "{ days?: number (7-365, default 60), limit?: number (1-50, default 20) }",
    run: async (ctx, args) => {
      const days = asInt(args.days, 60, 365);
      const limit = asInt(args.limit, 20, 50);
      const cutoff = new Date(Date.now() - days * 86_400_000);
      const rows = await db
        .select({
          id: customersTable.id,
          name: customersTable.name,
          phone: customersTable.phone,
          totalOrders: customersTable.totalOrders,
          totalSpent: customersTable.totalSpent,
          lastOrderAt: sql<Date | null>`max(${ordersTable.createdAt})`.as("last_order_at"),
        })
        .from(customersTable)
        .leftJoin(ordersTable, eq(ordersTable.customerId, customersTable.id))
        .where(and(
          eq(customersTable.restaurantId, ctx.restaurantId),
          eq(customersTable.isActive, true),
        ))
        .groupBy(customersTable.id)
        .having(sql`max(${ordersTable.createdAt}) is null or max(${ordersTable.createdAt}) < ${cutoff}`)
        .orderBy(desc(customersTable.totalSpent))
        .limit(limit);
      return { sinceDays: days, customers: rows };
    },
  },
  {
    name: "stock_to_reorder",
    description: "List inventory items at or below their minimum stock level (reorder candidates).",
    allowedRoles: ["owner", "manager", "super_admin"],
    args: "{ limit?: number (1-50, default 25) }",
    run: async (ctx, args) => {
      const limit = asInt(args.limit, 25, 50);
      const rows = await db
        .select({
          id: inventoryItemsTable.id,
          name: inventoryItemsTable.name,
          unit: inventoryItemsTable.unit,
          currentStock: inventoryItemsTable.currentStock,
          minStockLevel: inventoryItemsTable.minStockLevel,
          reorderQuantity: inventoryItemsTable.reorderQuantity,
          costPerUnit: inventoryItemsTable.costPerUnit,
        })
        .from(inventoryItemsTable)
        .where(and(
          eq(inventoryItemsTable.restaurantId, ctx.restaurantId),
          eq(inventoryItemsTable.isActive, true),
          sql`${inventoryItemsTable.currentStock} <= ${inventoryItemsTable.minStockLevel}`,
        ))
        .orderBy(asc(inventoryItemsTable.currentStock))
        .limit(limit);
      return { items: rows };
    },
  },
  {
    name: "staff_lateness",
    description: "Summarise staff lateness (minutes late per employee) over the last N days based on attendance records.",
    allowedRoles: ["owner", "manager", "super_admin"],
    args: "{ days?: number (1-90, default 30), limit?: number (1-30, default 10) }",
    run: async (ctx, args) => {
      const days = asInt(args.days, 30, 90);
      const limit = asInt(args.limit, 10, 30);
      const since = new Date(Date.now() - days * 86_400_000);
      const rows = await db
        .select({
          userId: attendanceTable.userId,
          name: usersTable.name,
          jobTitle: staffTable.jobTitle,
          totalLateMinutes: sql<number>`coalesce(sum(${attendanceTable.lateMinutes}), 0)::int`,
          lateDays: sql<number>`coalesce(sum(case when ${attendanceTable.lateMinutes} > 0 then 1 else 0 end), 0)::int`,
        })
        .from(attendanceTable)
        .innerJoin(usersTable, eq(usersTable.id, attendanceTable.userId))
        .leftJoin(staffTable, and(eq(staffTable.userId, attendanceTable.userId), eq(staffTable.restaurantId, ctx.restaurantId)))
        .where(and(
          eq(attendanceTable.restaurantId, ctx.restaurantId),
          gte(attendanceTable.clockIn, since),
        ))
        .groupBy(attendanceTable.userId, usersTable.name, staffTable.jobTitle)
        .orderBy(sql`sum(${attendanceTable.lateMinutes}) desc nulls last`)
        .limit(limit);
      return { sinceDays: days, staff: rows.filter((r) => r.totalLateMinutes > 0) };
    },
  },
  {
    name: "recent_reviews",
    description: "Recent customer reviews and 1–3★ private feedback for the active restaurant.",
    allowedRoles: ["owner", "manager", "cashier", "waiter", "super_admin"],
    args: "{ days?: number (1-90, default 30), limit?: number (1-20, default 10) }",
    run: async (ctx, args) => {
      const days = asInt(args.days, 30, 90);
      const limit = asInt(args.limit, 10, 20);
      const since = new Date(Date.now() - days * 86_400_000);
      const ext = await db.select({
        id: externalReviewsTable.id,
        source: externalReviewsTable.source,
        author: externalReviewsTable.authorName,
        rating: externalReviewsTable.rating,
        body: externalReviewsTable.body,
        sentiment: externalReviewsTable.sentiment,
        createdAt: externalReviewsTable.createdAt,
      })
        .from(externalReviewsTable)
        .where(and(
          eq(externalReviewsTable.restaurantId, ctx.restaurantId),
          gte(externalReviewsTable.createdAt, since),
        ))
        .orderBy(desc(externalReviewsTable.createdAt))
        .limit(limit);
      const fb = await db.select({
        id: customerFeedbackTable.id,
        rating: customerFeedbackTable.rating,
        category: customerFeedbackTable.category,
        comment: customerFeedbackTable.comment,
        customerName: customerFeedbackTable.customerName,
        createdAt: customerFeedbackTable.createdAt,
      })
        .from(customerFeedbackTable)
        .where(and(
          eq(customerFeedbackTable.restaurantId, ctx.restaurantId),
          gte(customerFeedbackTable.createdAt, since),
        ))
        .orderBy(desc(customerFeedbackTable.createdAt))
        .limit(limit);
      return { external: ext, feedback: fb };
    },
  },
  {
    name: "draft_campaign_copy",
    description: "Draft short marketing copy (SMS or WhatsApp) for a campaign. Use this when the user asks to write a promo / message for customers. No data lookup is performed; this tool simply echoes the structured request back so the assistant can produce the copy in its final answer.",
    allowedRoles: ["owner", "manager", "super_admin"],
    args: "{ goal: string, audience?: string, tone?: 'friendly'|'formal'|'playful', channel?: 'sms'|'whatsapp'|'email', notes?: string }",
    run: async (_ctx, args) => {
      return { brief: args };
    },
  },
  {
    name: "draft_review_reply",
    description: "Help draft a reply to a specific customer review. Pass the review id and desired tone; the tool returns the review body so the assistant can write a tailored reply in its final answer.",
    allowedRoles: ["owner", "manager", "super_admin"],
    args: "{ reviewId: number, tone?: 'professional'|'friendly'|'apologetic'|'premium' }",
    run: async (ctx, args) => {
      const reviewId = Number(args.reviewId);
      if (!Number.isFinite(reviewId)) throw new Error("reviewId required");
      const [row] = await db.select().from(externalReviewsTable).where(and(
        eq(externalReviewsTable.id, reviewId),
        eq(externalReviewsTable.restaurantId, ctx.restaurantId),
      ));
      if (!row) throw new Error("Review not found");
      return {
        review: {
          id: row.id,
          author: row.authorName,
          rating: row.rating,
          body: row.body,
          sentiment: row.sentiment,
        },
        tone: args.tone ?? "professional",
      };
    },
  },
];

function toolsForRole(role: string, isSuperAdmin: boolean): ToolDefinition[] {
  if (isSuperAdmin) return TOOLS;
  return TOOLS.filter((t) => t.allowedRoles.includes(role));
}

function buildSystemPrompt(allowed: ToolDefinition[]): string {
  const toolDocs = allowed
    .map((t) => `- ${t.name}: ${t.description}\n  args: ${t.args}`)
    .join("\n");
  return [
    "You are the in-dashboard AI assistant for a restaurant management platform.",
    "You answer the operator's questions concisely and help them act on their business data.",
    "You have access to read-only tools that fetch live data scoped to the operator's active restaurant.",
    "",
    "Tools available:",
    toolDocs,
    "",
    "On every turn you MUST reply with strict JSON in one of these two shapes:",
    '  { "tool": "<tool_name>", "args": { ...arguments }, "thought": "<one-line reason>" }',
    '  { "answer": "<final answer in markdown>" }',
    "",
    "Rules:",
    "- Never fabricate data. If a question requires data, call the appropriate tool first.",
    "- You may call up to 4 tools in sequence before answering.",
    "- Never reveal customer phone numbers in full unless the operator explicitly asks for them.",
    "- Numbers should be formatted with thousands separators and a currency symbol (₹) where appropriate.",
    "- Keep final answers under 200 words unless asked for more detail.",
    "- If a request is outside scope (e.g. asking for legal advice), say so politely.",
  ].join("\n");
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

async function loadConversation(id: number, userId: number) {
  const [convo] = await db.select().from(aiChatConversationsTable).where(eq(aiChatConversationsTable.id, id));
  if (!convo) return null;
  if (convo.userId !== userId) return null;
  return convo;
}

async function loadMessages(conversationId: number) {
  return db.select().from(aiChatMessagesTable)
    .where(eq(aiChatMessagesTable.conversationId, conversationId))
    .orderBy(asc(aiChatMessagesTable.createdAt));
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.use(
  "/restaurants/:restaurantId/dashboard-chat/:rest",
  requireRole("owner", "manager", "cashier", "waiter", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("dashboard_chat_enabled"),
);

// List conversations for the calling user.
router.get("/restaurants/:restaurantId/dashboard-chat/conversations", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const rows = await db.select({
    id: aiChatConversationsTable.id,
    title: aiChatConversationsTable.title,
    updatedAt: aiChatConversationsTable.updatedAt,
    createdAt: aiChatConversationsTable.createdAt,
  })
    .from(aiChatConversationsTable)
    .where(eq(aiChatConversationsTable.userId, userId))
    .orderBy(desc(aiChatConversationsTable.updatedAt))
    .limit(50);
  res.json({ data: rows });
});

// Read one conversation with its messages.
router.get("/restaurants/:restaurantId/dashboard-chat/conversations/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const convo = await loadConversation(id, req.user!.id);
  if (!convo) return void res.status(404).json({ error: "Conversation not found" });
  const messages = await loadMessages(id);
  res.json({ conversation: convo, messages });
});

// Delete a conversation.
router.delete("/restaurants/:restaurantId/dashboard-chat/conversations/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const convo = await loadConversation(id, req.user!.id);
  if (!convo) return void res.status(404).json({ error: "Conversation not found" });
  await db.delete(aiChatConversationsTable).where(eq(aiChatConversationsTable.id, id));
  res.status(204).end();
});

// Send a message — runs the tool loop, persists user + assistant messages,
// debits credits.
router.post(
  "/restaurants/:restaurantId/dashboard-chat/messages",
  requireAiCredits(FEATURE_SLUG, () => ({ units: 1 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const userId = req.user!.id;
    const tenantId = req.user!.tenantId!;
    const role = req.user!.role;
    const isSuperAdmin = !!req.user!.isSuperAdmin;
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | undefined;

    const body = (req.body ?? {}) as { conversationId?: number; message?: string };
    const userMessage = String(body.message ?? "").trim();
    if (!userMessage) {
      if (reservation) await refundReservation(reservation, "empty message");
      return void res.status(400).json({ error: "Message is required" });
    }
    if (userMessage.length > 4000) {
      if (reservation) await refundReservation(reservation, "message too long");
      return void res.status(400).json({ error: "Message too long (max 4000 chars)" });
    }

    // Resolve conversation (create if not provided).
    let conversationId = body.conversationId ? Number(body.conversationId) : 0;
    if (conversationId) {
      const convo = await loadConversation(conversationId, userId);
      if (!convo) {
        if (reservation) await refundReservation(reservation, "convo not found");
        return void res.status(404).json({ error: "Conversation not found" });
      }
    } else {
      const title = userMessage.slice(0, 60);
      const [created] = await db.insert(aiChatConversationsTable)
        .values({ tenantId, restaurantId, userId, title })
        .returning();
      conversationId = created.id;
    }

    // Persist the user message immediately.
    await db.insert(aiChatMessagesTable).values({
      conversationId, role: "user", content: userMessage,
    });

    // Build LLM message history from prior + new turn.
    const history = await loadMessages(conversationId);
    const llmMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const m of history) {
      // Only include user / assistant messages in history; tool results are
      // re-emitted inline in the iterative loop below for the current turn.
      if (m.role === "user" || m.role === "assistant") {
        llmMessages.push({ role: m.role, content: m.content });
      }
    }

    const allowed = toolsForRole(role, isSuperAdmin);
    const systemPrompt = buildSystemPrompt(allowed);
    const ctx: ToolContext = { tenantId, restaurantId, role, isSuperAdmin };

    const toolCallTrace: Array<{ name: string; args: Record<string, unknown>; result?: unknown; error?: string }> = [];
    let finalAnswer: string | null = null;
    let totalIn = 0;
    let totalOut = 0;
    let lastRequestLogId: number | null = null;

    try {
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        const { data, result } = await AIProviderService.generateJson<{ tool?: string; args?: Record<string, unknown>; thought?: string; answer?: string }>(
          { featureSlug: FEATURE_SLUG, tenantId, restaurantId, userId, metadata: { conversationId } },
          { systemPrompt, messages: llmMessages, temperature: 0.4, maxTokens: 1024 },
        );
        totalIn += result.inputTokens;
        totalOut += result.outputTokens;
        lastRequestLogId = result.requestLogId;

        if (typeof data?.answer === "string" && data.answer.trim()) {
          finalAnswer = data.answer.trim();
          break;
        }

        if (typeof data?.tool === "string") {
          const tool = allowed.find((t) => t.name === data.tool);
          if (!tool) {
            const errMsg = `Tool "${data.tool}" is not available to your role.`;
            toolCallTrace.push({ name: String(data.tool), args: data.args ?? {}, error: errMsg });
            // Feed error back to model so it can recover.
            llmMessages.push({ role: "assistant", content: JSON.stringify({ tool: data.tool, args: data.args }) });
            llmMessages.push({ role: "user", content: `[tool_error] ${errMsg}` });
            continue;
          }
          let toolResult: unknown;
          try {
            toolResult = await tool.run(ctx, (data.args ?? {}) as Record<string, unknown>);
            toolCallTrace.push({ name: tool.name, args: data.args ?? {}, result: toolResult });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toolCallTrace.push({ name: tool.name, args: data.args ?? {}, error: msg });
            llmMessages.push({ role: "assistant", content: JSON.stringify({ tool: tool.name, args: data.args }) });
            llmMessages.push({ role: "user", content: `[tool_error] ${msg}` });
            continue;
          }
          // Feed tool call + result back into the conversation for the model.
          llmMessages.push({ role: "assistant", content: JSON.stringify({ tool: tool.name, args: data.args }) });
          const serialized = JSON.stringify(toolResult).slice(0, 6000);
          llmMessages.push({ role: "user", content: `[tool_result:${tool.name}] ${serialized}` });
          continue;
        }

        // Model returned neither — coerce to a final answer using whatever
        // text it produced so we don't loop forever.
        finalAnswer = result.text.trim() || "I couldn't generate a response.";
        break;
      }

      if (!finalAnswer) {
        finalAnswer = "I wasn't able to find an answer. Please rephrase or ask a more specific question.";
      }
    } catch (err) {
      logger.error({ err }, "dashboard chat AI call failed");
      if (reservation) await refundReservation(reservation, "ai call failed");
      const msg = err instanceof Error ? err.message : "AI request failed";
      return void res.status(502).json({ error: msg });
    }

    // Commit credits with the reservation amount (fixed pricing — single
    // chat turn debits the configured min charge regardless of tool count).
    if (reservation) {
      try {
        await commitReservation({
          reservation,
          actualCredits: reservation.reservedCredits,
          requestLogId: lastRequestLogId,
          userId,
        });
      } catch (err) {
        logger.warn({ err }, "dashboard chat commit failed");
      }
    }

    // Persist assistant message + bump conversation updatedAt.
    const [assistantRow] = await db.insert(aiChatMessagesTable).values({
      conversationId,
      role: "assistant",
      content: finalAnswer,
      toolCalls: toolCallTrace,
      tokensIn: totalIn,
      tokensOut: totalOut,
      creditsCharged: reservation?.reservedCredits ?? 0,
      requestLogId: lastRequestLogId,
    }).returning();

    await db.update(aiChatConversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(aiChatConversationsTable.id, conversationId));

    res.json({
      conversationId,
      message: assistantRow,
      creditsCharged: reservation?.reservedCredits ?? 0,
      toolCalls: toolCallTrace,
    });
  },
);

export default router;
