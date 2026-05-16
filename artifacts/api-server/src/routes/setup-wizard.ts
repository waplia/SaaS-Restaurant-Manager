/**
 * AI Setup Wizard endpoints. Backs the new-restaurant signup flow:
 *   GET    /restaurants/:restaurantId/setup-wizard          load saved answers + status
 *   PATCH  /restaurants/:restaurantId/setup-wizard          save partial answers (resumable)
 *   POST   /restaurants/:restaurantId/setup-wizard/generate run AI generation + apply
 *   POST   /restaurants/:restaurantId/setup-wizard/complete mark onboarding done (go live)
 *
 * Wizard answers + last-run summary are persisted in `restaurant_settings`
 * under the `setup_wizard` section so the UI is fully resumable across
 * sessions and devices.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  restaurantsTable,
  restaurantSettingsTable,
  tenantsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { recordAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import { runSetupWizardGeneration, type WizardAnswers, type WizardSummary } from "../lib/setupGenerator";

const router = Router();

router.use(
  "/restaurants/:restaurantId/setup-wizard",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

interface WizardState {
  answers: WizardAnswers;
  step: number;
  status: "idle" | "running" | "done" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  summary: WizardSummary | null;
}

const EMPTY: WizardState = {
  answers: {},
  step: 0,
  status: "idle",
  startedAt: null,
  completedAt: null,
  error: null,
  summary: null,
};

async function loadWizard(restaurantId: number): Promise<WizardState> {
  const [row] = await db.select().from(restaurantSettingsTable).where(and(
    eq(restaurantSettingsTable.restaurantId, restaurantId),
    eq(restaurantSettingsTable.section, "setup_wizard"),
  ));
  if (!row) return { ...EMPTY };
  const d = (row.data ?? {}) as Partial<WizardState>;
  return {
    answers: (d.answers ?? {}) as WizardAnswers,
    step: typeof d.step === "number" ? d.step : 0,
    status: (d.status as WizardState["status"]) ?? "idle",
    startedAt: d.startedAt ?? null,
    completedAt: d.completedAt ?? null,
    error: d.error ?? null,
    summary: (d.summary as WizardSummary | null) ?? null,
  };
}

async function saveWizard(restaurantId: number, userId: number, state: WizardState): Promise<void> {
  await db.insert(restaurantSettingsTable).values({
    restaurantId, section: "setup_wizard", data: state as unknown as Record<string, unknown>, updatedBy: userId,
  }).onConflictDoUpdate({
    target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
    set: { data: state as unknown as Record<string, unknown>, updatedBy: userId, updatedAt: new Date() },
  });
}

router.get("/restaurants/:restaurantId/setup-wizard", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) return void res.status(404).json({ error: "Not found" });
  const [tenant] = await db.select({ onboardingCompletedAt: tenantsTable.onboardingCompletedAt }).from(tenantsTable).where(eq(tenantsTable.id, restaurant.tenantId));
  const state = await loadWizard(restaurantId);
  res.json({
    ...state,
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      city: restaurant.city,
      country: restaurant.country,
      currency: restaurant.currency,
      taxRate: restaurant.taxRate,
      googleReviewLink: restaurant.googleReviewLink,
      acceptedPaymentMethods: restaurant.acceptedPaymentMethods,
    },
    onboardingCompletedAt: tenant?.onboardingCompletedAt ?? null,
  });
});

router.patch("/restaurants/:restaurantId/setup-wizard", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = req.user!.sub;
  const body = req.body as { answers?: Partial<WizardAnswers>; step?: number };
  const current = await loadWizard(restaurantId);
  const next: WizardState = {
    ...current,
    answers: { ...current.answers, ...(body.answers ?? {}) },
    step: typeof body.step === "number" ? body.step : current.step,
  };
  await saveWizard(restaurantId, userId, next);
  res.json(next);
});

router.post("/restaurants/:restaurantId/setup-wizard/generate", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = req.user!.sub;
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) return void res.status(404).json({ error: "Not found" });

  const current = await loadWizard(restaurantId);
  const incomingAnswers = (req.body?.answers ?? {}) as Partial<WizardAnswers>;
  const answers: WizardAnswers = { ...current.answers, ...incomingAnswers };

  // Spec: only restaurant type and tax are mandatory. Everything else is
  // optional / has a sensible default.
  if (!answers.restaurantType) {
    return void res.status(400).json({ error: "Restaurant type is required", code: "MISSING_RESTAURANT_TYPE" });
  }
  if (typeof answers.taxRate !== "number" || answers.taxRate < 0) {
    return void res.status(400).json({ error: "Default tax rate is required", code: "MISSING_TAX_RATE" });
  }

  const startedState: WizardState = {
    ...current, answers, status: "running", startedAt: new Date().toISOString(), error: null,
  };
  await saveWizard(restaurantId, userId, startedState);

  try {
    const summary = await runSetupWizardGeneration({
      tenantId: restaurant.tenantId,
      restaurantId,
      userId,
      answers,
    });
    const doneState: WizardState = {
      ...startedState, status: "done", summary, completedAt: new Date().toISOString(), error: null,
    };
    await saveWizard(restaurantId, userId, doneState);
    await recordAuditLog({
      req, module: "onboarding", action: "setup_wizard.generate", entity: "restaurant",
      entityId: restaurantId, restaurantId, targetRestaurantId: restaurantId,
      newValue: { summary },
    });
    res.json(doneState);
  } catch (err) {
    const e = err as { code?: string; status?: number; message?: string };
    const failState: WizardState = {
      ...startedState, status: "failed", error: e?.message ?? "Generation failed",
    };
    await saveWizard(restaurantId, userId, failState);
    logger.error({ err, restaurantId }, "setup wizard generation failed");
    res.status(e?.status ?? 500).json({ error: failState.error, code: e?.code ?? null, state: failState });
  }
});

router.post("/restaurants/:restaurantId/setup-wizard/complete", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = req.user!.sub;
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) return void res.status(404).json({ error: "Not found" });

  const current = await loadWizard(restaurantId);
  if (current.status !== "done") {
    return void res.status(409).json({ error: "Run the AI generation step before going live", code: "WIZARD_NOT_GENERATED" });
  }

  const now = new Date();
  await db.update(tenantsTable).set({ onboardingCompletedAt: now, updatedAt: now })
    .where(eq(tenantsTable.id, restaurant.tenantId));

  await saveWizard(restaurantId, userId, { ...current, completedAt: now.toISOString() });

  await recordAuditLog({
    req, module: "onboarding", action: "setup_wizard.complete", entity: "tenant",
    entityId: restaurant.tenantId, restaurantId, targetRestaurantId: restaurantId,
    newValue: { onboardingCompletedAt: now.toISOString() },
  });

  res.json({ ok: true, onboardingCompletedAt: now.toISOString() });
});

export default router;
