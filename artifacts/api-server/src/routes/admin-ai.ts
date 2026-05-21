import { Router, type Request, type Response } from "express";
import { eq, and, desc, sql, gte, lte, like } from "drizzle-orm";
import {
  db,
  aiProvidersTable,
  aiProviderModelsTable,
  aiFeatureModelAssignmentsTable,
  aiPromptTemplatesTable,
  aiPromptTemplateVersionsTable,
  aiSafetySettingsTable,
  aiRequestLogsTable,
} from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import { encryptSecret, maskSecret } from "../lib/aiEncryption";
import { recordAuditLog } from "../lib/audit";
import { AIProviderService, defaultBaseUrlForKind } from "../lib/aiProviderService";

const router = Router();
router.use("/admin/ai", requireSuperAdmin);

const MODULE = "ai_control_center";

// ─── Providers ───────────────────────────────────────────────────────────────
function sanitizeProvider(row: typeof aiProvidersTable.$inferSelect) {
  // Strip ciphertext / iv / tag — never expose to client.
  const { apiKeyCipher, apiKeyIv, apiKeyTag, ...rest } = row;
  void apiKeyCipher; void apiKeyIv; void apiKeyTag;
  return { ...rest, apiKeyConfigured: !!row.apiKeyCipher };
}

router.get("/admin/ai/providers", async (_req, res) => {
  const rows = await db.select().from(aiProvidersTable).orderBy(aiProvidersTable.name);
  res.json(rows.map(sanitizeProvider));
});

router.post("/admin/ai/providers", async (req: Request, res: Response) => {
  const { slug, name, kind, apiKey, baseUrl, orgId, defaultModel, backupModel,
    timeoutMs, maxTokens, temperature, notes, isEnabled, config } = req.body ?? {};
  if (!slug || !name || !kind) return void res.status(400).json({ error: "slug, name, kind required" });

  const kindStr = String(kind).trim();
  const resolvedBaseUrl = (baseUrl && String(baseUrl).trim()) || defaultBaseUrlForKind(kindStr);
  const values: typeof aiProvidersTable.$inferInsert = {
    slug: String(slug).trim(),
    name: String(name).trim(),
    kind: kindStr,
    isEnabled: !!isEnabled,
    baseUrl: resolvedBaseUrl,
    orgId: orgId || null,
    defaultModel: defaultModel || null,
    backupModel: backupModel || null,
    timeoutMs: Number(timeoutMs ?? 60000),
    maxTokens: Number(maxTokens ?? 4096),
    temperature: String(temperature ?? "0.70"),
    notes: notes || null,
    status: isEnabled ? "active" : "inactive",
    config: config ?? {},
  };
  if (apiKey && typeof apiKey === "string" && apiKey.trim()) {
    const enc = encryptSecret(apiKey.trim());
    values.apiKeyCipher = enc.cipher;
    values.apiKeyIv = enc.iv;
    values.apiKeyTag = enc.tag;
    values.apiKeyMasked = maskSecret(apiKey.trim());
  }
  try {
    const [row] = await db.insert(aiProvidersTable).values(values).returning();
    await recordAuditLog({
      req, module: MODULE, action: "provider.create", entity: "ai_provider", entityId: row.id,
      newValue: { ...sanitizeProvider(row) },
      details: `Created provider ${row.slug}`,
    });
    res.json(sanitizeProvider(row));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch("/admin/ai/providers/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(aiProvidersTable).where(eq(aiProvidersTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });

  const b = req.body ?? {};
  const patch: Partial<typeof aiProvidersTable.$inferInsert> = { updatedAt: new Date() };
  for (const k of ["name", "orgId", "defaultModel", "backupModel", "notes"] as const) {
    if (k in b) (patch as Record<string, unknown>)[k] = b[k] || null;
  }
  if ("baseUrl" in b) {
    const trimmed = typeof b.baseUrl === "string" ? b.baseUrl.trim() : "";
    patch.baseUrl = trimmed || defaultBaseUrlForKind(existing.kind);
  }
  if ("isEnabled" in b) {
    patch.isEnabled = !!b.isEnabled;
    patch.status = b.isEnabled ? "active" : "inactive";
  }
  if ("timeoutMs" in b) patch.timeoutMs = Number(b.timeoutMs);
  if ("maxTokens" in b) patch.maxTokens = Number(b.maxTokens);
  if ("temperature" in b) patch.temperature = String(b.temperature);
  if ("config" in b) patch.config = b.config ?? {};
  if (b.apiKey && typeof b.apiKey === "string" && b.apiKey.trim() && b.apiKey !== existing.apiKeyMasked) {
    const enc = encryptSecret(b.apiKey.trim());
    patch.apiKeyCipher = enc.cipher;
    patch.apiKeyIv = enc.iv;
    patch.apiKeyTag = enc.tag;
    patch.apiKeyMasked = maskSecret(b.apiKey.trim());
  }
  const [row] = await db.update(aiProvidersTable).set(patch).where(eq(aiProvidersTable.id, id)).returning();
  await recordAuditLog({
    req, module: MODULE, action: "provider.update", entity: "ai_provider", entityId: id,
    oldValue: sanitizeProvider(existing), newValue: sanitizeProvider(row),
    details: `Updated provider ${row.slug}`,
  });
  res.json(sanitizeProvider(row));
});

router.delete("/admin/ai/providers/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(aiProvidersTable).where(eq(aiProvidersTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.delete(aiProvidersTable).where(eq(aiProvidersTable.id, id));
  await recordAuditLog({
    req, module: MODULE, action: "provider.delete", entity: "ai_provider", entityId: id,
    oldValue: sanitizeProvider(existing), details: `Deleted provider ${existing.slug}`,
  });
  res.json({ ok: true });
});

router.post("/admin/ai/providers/:id/test", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const result = await AIProviderService.pingProvider(id);
  await db.update(aiProvidersTable).set({
    lastTestedAt: new Date(),
    lastTestStatus: result.ok ? "success" : "error",
    lastTestLatencyMs: result.latencyMs,
    lastTestError: result.ok ? null : (result.error ?? "Unknown error"),
  }).where(eq(aiProvidersTable.id, id));
  await recordAuditLog({
    req, module: MODULE, action: "provider.test", entity: "ai_provider", entityId: id,
    newValue: result, details: result.ok ? "Provider test succeeded" : "Provider test failed",
  });
  res.json(result);
});

// ─── Provider Models ─────────────────────────────────────────────────────────
router.get("/admin/ai/providers/:id/models", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(aiProviderModelsTable).where(eq(aiProviderModelsTable.providerId, id));
  res.json(rows);
});

router.post("/admin/ai/providers/:id/models", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { model, label, modality, contextWindow, inputCostPer1k, outputCostPer1k, imageCostPerCall, isActive } = req.body ?? {};
  if (!model) return void res.status(400).json({ error: "model required" });
  try {
    const [row] = await db.insert(aiProviderModelsTable).values({
      providerId: id, model, label: label || null,
      modality: modality || "text",
      contextWindow: contextWindow ? Number(contextWindow) : null,
      inputCostPer1k: inputCostPer1k ? String(inputCostPer1k) : null,
      outputCostPer1k: outputCostPer1k ? String(outputCostPer1k) : null,
      imageCostPerCall: imageCostPerCall ? String(imageCostPerCall) : null,
      isActive: isActive !== false,
    }).returning();
    await recordAuditLog({
      req, module: MODULE, action: "provider_model.create", entity: "ai_provider_model", entityId: row.id,
      newValue: row, details: `Added model ${row.model} to provider #${id}`,
    });
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete("/admin/ai/provider-models/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(aiProviderModelsTable).where(eq(aiProviderModelsTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.delete(aiProviderModelsTable).where(eq(aiProviderModelsTable.id, id));
  await recordAuditLog({
    req, module: MODULE, action: "provider_model.delete", entity: "ai_provider_model", entityId: id,
    oldValue: existing, details: `Removed model ${existing.model}`,
  });
  res.json({ ok: true });
});

// ─── Feature Model Assignments ───────────────────────────────────────────────
router.get("/admin/ai/assignments", async (_req, res) => {
  const rows = await db.select().from(aiFeatureModelAssignmentsTable).orderBy(aiFeatureModelAssignmentsTable.featureSlug);
  res.json(rows);
});

router.post("/admin/ai/assignments", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  if (!b.featureSlug || !b.featureLabel) return void res.status(400).json({ error: "featureSlug, featureLabel required" });
  try {
    const [row] = await db.insert(aiFeatureModelAssignmentsTable).values({
      featureSlug: b.featureSlug, featureLabel: b.featureLabel,
      category: b.category ?? "general",
      modality: b.modality ?? "text",
      primaryProviderId: b.primaryProviderId ?? null,
      primaryModel: b.primaryModel ?? null,
      fallbackProviderId: b.fallbackProviderId ?? null,
      fallbackModel: b.fallbackModel ?? null,
      temperature: String(b.temperature ?? "0.70"),
      maxTokens: Number(b.maxTokens ?? 2048),
      systemPrompt: b.systemPrompt || null,
      promptTemplateId: b.promptTemplateId ?? null,
      jsonMode: !!b.jsonMode,
      visionEnabled: !!b.visionEnabled,
      imageGenEnabled: !!b.imageGenEnabled,
      isEnabled: b.isEnabled !== false,
      notes: b.notes || null,
    }).returning();
    await recordAuditLog({ req, module: MODULE, action: "assignment.create", entity: "ai_assignment", entityId: row.id, newValue: row });
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch("/admin/ai/assignments/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(aiFeatureModelAssignmentsTable).where(eq(aiFeatureModelAssignmentsTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const b = req.body ?? {};
  const patch: Partial<typeof aiFeatureModelAssignmentsTable.$inferInsert> = { updatedAt: new Date() };
  for (const k of ["featureLabel", "category", "modality", "primaryProviderId", "primaryModel",
    "fallbackProviderId", "fallbackModel", "systemPrompt", "promptTemplateId", "notes"] as const) {
    if (k in b) (patch as Record<string, unknown>)[k] = (b as Record<string, unknown>)[k] ?? null;
  }
  if ("temperature" in b) patch.temperature = String(b.temperature);
  if ("maxTokens" in b) patch.maxTokens = Number(b.maxTokens);
  if ("jsonMode" in b) patch.jsonMode = !!b.jsonMode;
  if ("visionEnabled" in b) patch.visionEnabled = !!b.visionEnabled;
  if ("imageGenEnabled" in b) patch.imageGenEnabled = !!b.imageGenEnabled;
  if ("isEnabled" in b) patch.isEnabled = !!b.isEnabled;
  const [row] = await db.update(aiFeatureModelAssignmentsTable).set(patch).where(eq(aiFeatureModelAssignmentsTable.id, id)).returning();
  await recordAuditLog({ req, module: MODULE, action: "assignment.update", entity: "ai_assignment", entityId: id, oldValue: existing, newValue: row });
  res.json(row);
});

router.delete("/admin/ai/assignments/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(aiFeatureModelAssignmentsTable).where(eq(aiFeatureModelAssignmentsTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.delete(aiFeatureModelAssignmentsTable).where(eq(aiFeatureModelAssignmentsTable.id, id));
  await recordAuditLog({ req, module: MODULE, action: "assignment.delete", entity: "ai_assignment", entityId: id, oldValue: existing });
  res.json({ ok: true });
});

// ─── Prompt Templates ────────────────────────────────────────────────────────
router.get("/admin/ai/prompts", async (_req, res) => {
  const rows = await db.select().from(aiPromptTemplatesTable).orderBy(desc(aiPromptTemplatesTable.updatedAt));
  res.json(rows);
});

router.get("/admin/ai/prompts/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [tpl] = await db.select().from(aiPromptTemplatesTable).where(eq(aiPromptTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  const versions = await db.select().from(aiPromptTemplateVersionsTable)
    .where(eq(aiPromptTemplateVersionsTable.templateId, id))
    .orderBy(desc(aiPromptTemplateVersionsTable.version));
  res.json({ template: tpl, versions });
});

router.post("/admin/ai/prompts", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  if (!b.slug || !b.name || !b.userTemplate) return void res.status(400).json({ error: "slug, name, userTemplate required" });
  try {
    const [tpl] = await db.insert(aiPromptTemplatesTable).values({
      slug: b.slug, name: b.name, description: b.description || null,
      featureSlug: b.featureSlug || null,
      outputFormat: b.outputFormat ?? "text",
      variables: Array.isArray(b.variables) ? b.variables : [],
      jsonSchema: b.jsonSchema ?? null,
      activeVersion: 1,
      isActive: b.isActive !== false,
    }).returning();
    const [ver] = await db.insert(aiPromptTemplateVersionsTable).values({
      templateId: tpl.id, version: 1,
      systemPrompt: b.systemPrompt || null,
      userTemplate: b.userTemplate,
      notes: b.notes || null,
      createdBy: req.user?.sub ?? null,
    }).returning();
    await recordAuditLog({ req, module: MODULE, action: "prompt.create", entity: "ai_prompt", entityId: tpl.id, newValue: { template: tpl, version: ver } });
    res.json({ template: tpl, version: ver });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch("/admin/ai/prompts/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(aiPromptTemplatesTable).where(eq(aiPromptTemplatesTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const b = req.body ?? {};
  const patch: Partial<typeof aiPromptTemplatesTable.$inferInsert> = { updatedAt: new Date() };
  for (const k of ["name", "description", "featureSlug", "outputFormat"] as const) {
    if (k in b) (patch as Record<string, unknown>)[k] = (b as Record<string, unknown>)[k];
  }
  if ("variables" in b) patch.variables = Array.isArray(b.variables) ? b.variables : [];
  if ("jsonSchema" in b) patch.jsonSchema = b.jsonSchema ?? null;
  if ("isActive" in b) patch.isActive = !!b.isActive;
  if ("activeVersion" in b) patch.activeVersion = Number(b.activeVersion);
  const [row] = await db.update(aiPromptTemplatesTable).set(patch).where(eq(aiPromptTemplatesTable.id, id)).returning();
  await recordAuditLog({ req, module: MODULE, action: "prompt.update", entity: "ai_prompt", entityId: id, oldValue: existing, newValue: row });
  res.json(row);
});

router.post("/admin/ai/prompts/:id/versions", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [tpl] = await db.select().from(aiPromptTemplatesTable).where(eq(aiPromptTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  const b = req.body ?? {};
  if (!b.userTemplate) return void res.status(400).json({ error: "userTemplate required" });
  const [{ maxV }] = await db.select({ maxV: sql<number>`coalesce(max(${aiPromptTemplateVersionsTable.version}), 0)` })
    .from(aiPromptTemplateVersionsTable).where(eq(aiPromptTemplateVersionsTable.templateId, id));
  const next = Number(maxV ?? 0) + 1;
  const [ver] = await db.insert(aiPromptTemplateVersionsTable).values({
    templateId: id, version: next,
    systemPrompt: b.systemPrompt || null,
    userTemplate: b.userTemplate, notes: b.notes || null,
    createdBy: req.user?.sub ?? null,
  }).returning();
  if (b.makeActive) {
    await db.update(aiPromptTemplatesTable).set({ activeVersion: next, updatedAt: new Date() }).where(eq(aiPromptTemplatesTable.id, id));
  }
  await recordAuditLog({ req, module: MODULE, action: "prompt.version.create", entity: "ai_prompt", entityId: id, newValue: ver });
  res.json(ver);
});

router.post("/admin/ai/prompts/:id/test", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [tpl] = await db.select().from(aiPromptTemplatesTable).where(eq(aiPromptTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  const [ver] = await db.select().from(aiPromptTemplateVersionsTable)
    .where(and(eq(aiPromptTemplateVersionsTable.templateId, id), eq(aiPromptTemplateVersionsTable.version, tpl.activeVersion)));
  if (!ver) return void res.status(400).json({ error: "Active version not found" });
  const vars: Record<string, string> = req.body?.variables ?? {};
  let userMsg = ver.userTemplate;
  for (const [k, v] of Object.entries(vars)) {
    userMsg = userMsg.replaceAll(`{{${k}}}`, String(v));
  }
  try {
    const result = await AIProviderService.generateText(
      { featureSlug: tpl.featureSlug ?? "prompt_test", userId: req.user?.sub ?? null, metadata: { promptTemplateId: id, version: tpl.activeVersion } },
      {
        systemPrompt: ver.systemPrompt ?? undefined,
        messages: [{ role: "user", content: userMsg }],
        jsonMode: tpl.outputFormat === "json",
      },
    );
    res.json({ ok: true, output: result.text, providerSlug: result.providerSlug, model: result.model, latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens });
  } catch (err) {
    res.status(502).json({ ok: false, error: (err as Error).message });
  }
});

router.delete("/admin/ai/prompts/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(aiPromptTemplatesTable).where(eq(aiPromptTemplatesTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.delete(aiPromptTemplatesTable).where(eq(aiPromptTemplatesTable.id, id));
  await recordAuditLog({ req, module: MODULE, action: "prompt.delete", entity: "ai_prompt", entityId: id, oldValue: existing });
  res.json({ ok: true });
});

// ─── Safety Settings (singleton) ─────────────────────────────────────────────
async function getOrCreateSafety() {
  const [row] = await db.select().from(aiSafetySettingsTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(aiSafetySettingsTable).values({}).returning();
  return created;
}

router.get("/admin/ai/safety", async (_req, res) => {
  const row = await getOrCreateSafety();
  res.json(row);
});

router.patch("/admin/ai/safety", async (req: Request, res: Response) => {
  const existing = await getOrCreateSafety();
  const b = req.body ?? {};
  const patch: Partial<typeof aiSafetySettingsTable.$inferInsert> = { updatedAt: new Date(), updatedBy: req.user?.sub ?? null };
  for (const k of ["requireApprovalReviewReplies", "requireApprovalCampaigns", "requireApprovalMenuImport",
    "blockAbuse", "blockHealthClaims", "blockDefamation", "storePrompt", "storeResponse"] as const) {
    if (k in b) (patch as Record<string, unknown>)[k] = !!b[k];
  }
  for (const k of ["maxRetries", "rateLimitPerMinute", "rateLimitPerDayPerRestaurant"] as const) {
    if (k in b) (patch as Record<string, unknown>)[k] = Number(b[k]);
  }
  if ("dataPrivacyNotice" in b) patch.dataPrivacyNotice = b.dataPrivacyNotice || null;
  if ("bannedPhrases" in b) patch.bannedPhrases = Array.isArray(b.bannedPhrases) ? b.bannedPhrases : [];
  const [row] = await db.update(aiSafetySettingsTable).set(patch).where(eq(aiSafetySettingsTable.id, existing.id)).returning();
  await recordAuditLog({ req, module: MODULE, action: "safety.update", entity: "ai_safety", entityId: row.id, oldValue: existing, newValue: row });
  res.json(row);
});

// ─── AI Logs ─────────────────────────────────────────────────────────────────
router.get("/admin/ai/logs", async (req: Request, res: Response) => {
  const limit = Math.min(200, Number(req.query["limit"] ?? 50));
  const offset = Math.max(0, Number(req.query["offset"] ?? 0));
  const conds = [] as ReturnType<typeof eq>[];
  if (req.query["featureSlug"]) conds.push(eq(aiRequestLogsTable.featureSlug, String(req.query["featureSlug"])));
  if (req.query["providerSlug"]) conds.push(eq(aiRequestLogsTable.providerSlug, String(req.query["providerSlug"])));
  if (req.query["model"]) conds.push(like(aiRequestLogsTable.model, `%${String(req.query["model"])}%`));
  if (req.query["status"]) conds.push(eq(aiRequestLogsTable.status, String(req.query["status"])));
  if (req.query["restaurantId"]) conds.push(eq(aiRequestLogsTable.restaurantId, Number(req.query["restaurantId"])));
  if (req.query["userId"]) conds.push(eq(aiRequestLogsTable.userId, Number(req.query["userId"])));
  if (req.query["from"]) conds.push(gte(aiRequestLogsTable.createdAt, new Date(String(req.query["from"]))));
  if (req.query["to"]) conds.push(lte(aiRequestLogsTable.createdAt, new Date(String(req.query["to"]))));

  const where = conds.length > 0 ? and(...conds) : undefined;
  const rows = await db.select().from(aiRequestLogsTable).where(where).orderBy(desc(aiRequestLogsTable.createdAt)).limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(aiRequestLogsTable).where(where);
  res.json({ rows, total, limit, offset });
});

router.get("/admin/ai/logs/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(aiRequestLogsTable).where(eq(aiRequestLogsTable.id, id));
  if (!row) return void res.status(404).json({ error: "Not found" });
  res.json(row);
});

// ─── Cost Reports ────────────────────────────────────────────────────────────
router.get("/admin/ai/reports/cost", async (req: Request, res: Response) => {
  const days = Math.min(365, Math.max(1, Number(req.query["days"] ?? 30)));
  const since = new Date(Date.now() - days * 86400000);

  const byProvider = await db.select({
    providerSlug: aiRequestLogsTable.providerSlug,
    requests: sql<number>`count(*)::int`,
    tokens: sql<number>`coalesce(sum(${aiRequestLogsTable.totalTokens}), 0)::int`,
    costUsd: sql<string>`coalesce(sum(${aiRequestLogsTable.costUsd}), 0)::text`,
    failed: sql<number>`count(*) filter (where ${aiRequestLogsTable.status} <> 'success')::int`,
    failedCostUsd: sql<string>`coalesce(sum(${aiRequestLogsTable.costUsd}) filter (where ${aiRequestLogsTable.status} <> 'success'), 0)::text`,
  }).from(aiRequestLogsTable)
    .where(gte(aiRequestLogsTable.createdAt, since))
    .groupBy(aiRequestLogsTable.providerSlug);

  const byModality = await db.select({
    modality: aiRequestLogsTable.modality,
    requests: sql<number>`count(*)::int`,
    costUsd: sql<string>`coalesce(sum(${aiRequestLogsTable.costUsd}), 0)::text`,
    failed: sql<number>`count(*) filter (where ${aiRequestLogsTable.status} <> 'success')::int`,
    failedCostUsd: sql<string>`coalesce(sum(${aiRequestLogsTable.costUsd}) filter (where ${aiRequestLogsTable.status} <> 'success'), 0)::text`,
  }).from(aiRequestLogsTable)
    .where(gte(aiRequestLogsTable.createdAt, since))
    .groupBy(aiRequestLogsTable.modality);

  const byMonth = await db.select({
    month: sql<string>`to_char(date_trunc('month', ${aiRequestLogsTable.createdAt}), 'YYYY-MM')`,
    requests: sql<number>`count(*)::int`,
    tokens: sql<number>`coalesce(sum(${aiRequestLogsTable.totalTokens}), 0)::int`,
    costUsd: sql<string>`coalesce(sum(${aiRequestLogsTable.costUsd}), 0)::text`,
    imageCostUsd: sql<string>`coalesce(sum(${aiRequestLogsTable.costUsd}) filter (where ${aiRequestLogsTable.modality} = 'image'), 0)::text`,
    failedCostUsd: sql<string>`coalesce(sum(${aiRequestLogsTable.costUsd}) filter (where ${aiRequestLogsTable.status} <> 'success'), 0)::text`,
  }).from(aiRequestLogsTable)
    .where(gte(aiRequestLogsTable.createdAt, since))
    .groupBy(sql`date_trunc('month', ${aiRequestLogsTable.createdAt})`)
    .orderBy(sql`date_trunc('month', ${aiRequestLogsTable.createdAt})`);

  const byFeature = await db.select({
    featureSlug: aiRequestLogsTable.featureSlug,
    requests: sql<number>`count(*)::int`,
    tokens: sql<number>`coalesce(sum(${aiRequestLogsTable.totalTokens}), 0)::int`,
    costUsd: sql<string>`coalesce(sum(${aiRequestLogsTable.costUsd}), 0)::text`,
  }).from(aiRequestLogsTable)
    .where(gte(aiRequestLogsTable.createdAt, since))
    .groupBy(aiRequestLogsTable.featureSlug);

  const byRestaurant = await db.select({
    restaurantId: aiRequestLogsTable.restaurantId,
    requests: sql<number>`count(*)::int`,
    tokens: sql<number>`coalesce(sum(${aiRequestLogsTable.totalTokens}), 0)::int`,
    costUsd: sql<string>`coalesce(sum(${aiRequestLogsTable.costUsd}), 0)::text`,
  }).from(aiRequestLogsTable)
    .where(gte(aiRequestLogsTable.createdAt, since))
    .groupBy(aiRequestLogsTable.restaurantId)
    .orderBy(sql`sum(${aiRequestLogsTable.costUsd}) desc nulls last`)
    .limit(50);

  const byDay = await db.select({
    day: sql<string>`to_char(date_trunc('day', ${aiRequestLogsTable.createdAt}), 'YYYY-MM-DD')`,
    requests: sql<number>`count(*)::int`,
    costUsd: sql<string>`coalesce(sum(${aiRequestLogsTable.costUsd}), 0)::text`,
  }).from(aiRequestLogsTable)
    .where(gte(aiRequestLogsTable.createdAt, since))
    .groupBy(sql`date_trunc('day', ${aiRequestLogsTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${aiRequestLogsTable.createdAt})`);

  res.json({ days, byProvider, byFeature, byRestaurant, byDay, byMonth, byModality });
});

// ─── Dashboard Summary ───────────────────────────────────────────────────────
router.get("/admin/ai/dashboard", async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86400000);
  const [tot] = await db.select({
    totalRequests: sql<number>`count(*)::int`,
    failedRequests: sql<number>`count(*) filter (where ${aiRequestLogsTable.status} <> 'success')::int`,
    totalTokens: sql<number>`coalesce(sum(${aiRequestLogsTable.totalTokens}), 0)::int`,
    totalCostUsd: sql<string>`coalesce(sum(${aiRequestLogsTable.costUsd}), 0)::text`,
    totalCredits: sql<number>`coalesce(sum(${aiRequestLogsTable.creditsUsed}), 0)::int`,
  }).from(aiRequestLogsTable).where(gte(aiRequestLogsTable.createdAt, since));

  const topFeatures = await db.select({
    featureSlug: aiRequestLogsTable.featureSlug,
    requests: sql<number>`count(*)::int`,
  }).from(aiRequestLogsTable)
    .where(gte(aiRequestLogsTable.createdAt, since))
    .groupBy(aiRequestLogsTable.featureSlug)
    .orderBy(sql`count(*) desc`)
    .limit(5);

  const topRestaurants = await db.select({
    restaurantId: aiRequestLogsTable.restaurantId,
    requests: sql<number>`count(*)::int`,
  }).from(aiRequestLogsTable)
    .where(gte(aiRequestLogsTable.createdAt, since))
    .groupBy(aiRequestLogsTable.restaurantId)
    .orderBy(sql`count(*) desc`)
    .limit(5);

  const providerUsage = await db.select({
    providerSlug: aiRequestLogsTable.providerSlug,
    requests: sql<number>`count(*)::int`,
  }).from(aiRequestLogsTable)
    .where(gte(aiRequestLogsTable.createdAt, since))
    .groupBy(aiRequestLogsTable.providerSlug);

  const modelUsage = await db.select({
    model: aiRequestLogsTable.model,
    requests: sql<number>`count(*)::int`,
  }).from(aiRequestLogsTable)
    .where(gte(aiRequestLogsTable.createdAt, since))
    .groupBy(aiRequestLogsTable.model)
    .orderBy(sql`count(*) desc`)
    .limit(8);

  const dailyUsage = await db.select({
    day: sql<string>`to_char(date_trunc('day', ${aiRequestLogsTable.createdAt}), 'YYYY-MM-DD')`,
    requests: sql<number>`count(*)::int`,
    costUsd: sql<string>`coalesce(sum(${aiRequestLogsTable.costUsd}), 0)::text`,
  }).from(aiRequestLogsTable)
    .where(gte(aiRequestLogsTable.createdAt, since))
    .groupBy(sql`date_trunc('day', ${aiRequestLogsTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${aiRequestLogsTable.createdAt})`);

  const [{ providers: providerCount }] = await db.select({ providers: sql<number>`count(*)::int` }).from(aiProvidersTable).where(eq(aiProvidersTable.isEnabled, true));
  const [{ assignments }] = await db.select({ assignments: sql<number>`count(*)::int` }).from(aiFeatureModelAssignmentsTable).where(eq(aiFeatureModelAssignmentsTable.isEnabled, true));

  res.json({
    summary: {
      totalRequests: tot.totalRequests,
      failedRequests: tot.failedRequests,
      totalTokens: tot.totalTokens,
      providerCostUsd: tot.totalCostUsd,
      creditsUsed: tot.totalCredits,
      activeProviders: providerCount,
      activeAssignments: assignments,
      // Revenue/profit tracked in Task #62 (credits wallet) — placeholders for now.
      aiRevenueUsd: "0",
      profitEstimateUsd: String(Number(tot.totalCostUsd) * -1),
    },
    topFeatures, topRestaurants, providerUsage, modelUsage, dailyUsage,
  });
});

export default router;
