/**
 * Task #587 — Per-restaurant payment-config CRUD + public checkout endpoint.
 *
 * Routes:
 *   GET  /restaurants/:restaurantId/payment-config
 *   PUT  /restaurants/:restaurantId/payment-config/settings
 *   PUT  /restaurants/:restaurantId/payment-config/methods/:type
 *   DELETE /restaurants/:restaurantId/payment-config/methods/:id
 *   PUT  /restaurants/:restaurantId/payment-config/manual-upi
 *   GET  /public/restaurants/:slug/checkout-options
 *
 * Note: secrets (manual UPI ID, etc.) are returned to authenticated admins
 * only — the public endpoint exposes nothing the customer wouldn't already
 * see at checkout.
 */
import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, restaurantsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { validate } from "../middleware/validate";
import {
  getPaymentConfig,
  getCheckoutOptions,
  updateSettings,
  upsertMethod,
  deleteMethod,
  upsertManualUpi,
} from "../lib/paymentConfig";

const router = Router();

router.use(
  "/restaurants/:restaurantId/payment-config",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

router.get("/restaurants/:restaurantId/payment-config", async (req, res) => {
  const rid = Number(req.params.restaurantId);
  try {
    const cfg = await getPaymentConfig(rid);
    res.json(cfg);
  } catch (err) {
    req.log.error({ err }, "payment-config: get failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

const SettingsBody = z.object({
  offlineEnabled: z.boolean().optional(),
  onlineEnabled: z.boolean().optional(),
  onlinePaymentSource: z.enum(["platform_gateway", "own_gateway", "manual_upi", "mixed"]).optional(),
  defaultCustomerChoice: z.enum(["pay_at_counter", "pay_online"]).optional(),
});

router.put(
  "/restaurants/:restaurantId/payment-config/settings",
  validate({ body: SettingsBody }),
  async (req, res) => {
    const rid = Number(req.params.restaurantId);
    try {
      const updated = await updateSettings(rid, req.body, req.user?.sub ?? null);
      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "payment-config: update settings failed");
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

const MethodBody = z.object({
  category: z.enum(["offline", "online"]),
  type: z.string().min(1).max(40),
  label: z.string().max(120).nullish(),
  isEnabled: z.boolean(),
  gatewayCode: z.string().max(40).nullish(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

router.put(
  "/restaurants/:restaurantId/payment-config/methods",
  validate({ body: MethodBody }),
  async (req, res) => {
    const rid = Number(req.params.restaurantId);
    try {
      const row = await upsertMethod(rid, req.body);
      res.json(row);
    } catch (err) {
      req.log.error({ err }, "payment-config: upsert method failed");
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.delete("/restaurants/:restaurantId/payment-config/methods/:id", async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const mid = Number(req.params.id);
  try {
    await deleteMethod(rid, mid);
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "payment-config: delete method failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

const ManualUpiBody = z.object({
  upiId: z.string().max(120).nullish(),
  merchantName: z.string().max(120).nullish(),
  enableDynamicQr: z.boolean().optional(),
  enableStaticQr: z.boolean().optional(),
  staticQrUrl: z.string().max(500).nullish(),
  enableIntentLink: z.boolean().optional(),
  enableCopyUpiId: z.boolean().optional(),
  requireUtr: z.boolean().optional(),
  allowScreenshotUpload: z.boolean().optional(),
  autoConfirmUnderAmount: z.number().int().min(0).nullish(),
  notes: z.string().max(2000).nullish(),
});

router.put(
  "/restaurants/:restaurantId/payment-config/manual-upi",
  validate({ body: ManualUpiBody }),
  async (req, res) => {
    const rid = Number(req.params.restaurantId);
    try {
      const row = await upsertManualUpi(rid, req.body, req.user?.sub ?? null);
      res.json(row);
    } catch (err) {
      req.log.error({ err }, "payment-config: upsert manual UPI failed");
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

// Public — no auth. Customer checkout reads this to decide what to render.
export const publicCheckoutOptionsRouter = Router();
publicCheckoutOptionsRouter.get("/public/restaurants/:slug/checkout-options", async (req, res) => {
  try {
    const [restaurant] = await db
      .select({ id: restaurantsTable.id })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.slug, req.params.slug));
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant not found" });
      return;
    }
    const opts = await getCheckoutOptions(restaurant.id);
    res.set("Cache-Control", "public, max-age=15");
    res.json(opts);
  } catch (err) {
    req.log.error({ err }, "public: checkout options failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
