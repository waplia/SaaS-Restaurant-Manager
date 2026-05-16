import { Router } from "express";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requestManagerDiscountOtp } from "../lib/managerOtp";
import { loadDiscountsConfig } from "../lib/discounts";
import { recordAuditLog } from "../lib/audit";
import { validate } from "../middleware/validate";
import { z } from "zod";

const router = Router();

const DiscountOtpRequestBody = z.object({}).passthrough();

router.use(
  "/restaurants/:restaurantId/manager-otp",
  requireRole("owner", "manager", "super_admin", "waiter", "cashier"),
  validateRestaurantAccess,
);

// Request a manager OTP for a high-value discount approval. Sent via SMS to
// the first owner/manager with a phone number on file. Caller (cashier/waiter)
// then enters the SMS-delivered code into the POS to authorize the discount.
router.post("/restaurants/:restaurantId/manager-otp/discount-request", validate({ body: DiscountOtpRequestBody }), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const cfg = await loadDiscountsConfig(restaurantId);
  if (!cfg.otpEnabled) {
    return void res.status(409).json({
      error: "OTP approval is not enabled. Enable it in Settings → Discounts.",
      code: "OTP_NOT_ENABLED",
    });
  }
  const result = await requestManagerDiscountOtp({
    restaurantId,
    requestedByUserId: req.user?.sub ?? null,
  });
  await recordAuditLog({
    req, module: "discounts", action: "discount.otp_requested", entity: "manager_otp",
    entityId: result.otpId ?? null, restaurantId, targetRestaurantId: restaurantId,
    newValue: { ok: result.ok, recipient: result.recipient ? `***${result.recipient.slice(-4)}` : null, error: result.error ?? null },
  });
  if (!result.ok) {
    return void res.status(400).json({ error: result.error ?? "Could not send OTP", code: "OTP_SEND_FAILED" });
  }
  res.json({
    ok: true,
    otpId: result.otpId,
    // Mask the recipient — we still want the cashier to know *some* manager
    // was notified, but not see the full phone number.
    recipientMasked: result.recipient ? `***${result.recipient.slice(-4)}` : null,
    expiresInSec: 300,
  });
});

export default router;
