import { AIProviderService } from "./aiProviderService";
import { logger } from "./logger";
import type { AlertCandidate } from "./fraudDetection";

function templateSummary(c: AlertCandidate): string {
  const ev = c.evidence as Record<string, unknown>;
  const subj = c.subjectUserId ? `staff #${c.subjectUserId}` : "system";
  switch (c.detector) {
    case "excessive_discounts":
      return `Cashier ${subj} applied ${ev.discountPercent ?? c.score}% in discounts (₹${Number(ev.totalDiscount ?? 0).toFixed(2)}) across ${ev.orderCount ?? "?"} orders in the last ${ev.windowHours ?? 24}h — exceeds ${c.threshold}% threshold.`;
    case "void_bills":
      return `User ${subj} voided ${ev.voidCount} bills totalling ₹${Number(ev.voidAmount ?? 0).toFixed(2)} in the last ${ev.windowHours ?? 24}h — exceeds ${c.threshold} void threshold.`;
    case "cancelled_kots":
      return `Waiter ${subj} cancelled ${ev.cancelCount} kitchen tickets in the last ${ev.windowHours ?? 24}h — exceeds ${c.threshold} threshold.`;
    case "refund_abuse":
      return `User ${subj} processed ${ev.refundCount} refunds (₹${Number(ev.refundTotal ?? 0).toFixed(2)}) in the last ${ev.windowDays ?? 7} days — exceeds ${c.threshold} threshold.`;
    case "cash_mismatch":
      return `Cash register session #${ev.sessionId} closed with a variance of ₹${Number(ev.overShort ?? 0).toFixed(2)} (expected ₹${Number(ev.expectedCash ?? 0).toFixed(2)}, actual ₹${Number(ev.actualCash ?? 0).toFixed(2)}).`;
    case "manual_attendance_edits":
      return `Manager ${subj} made ${ev.editCount} manual attendance edits in the last ${ev.windowDays ?? 7} days — exceeds ${c.threshold} threshold.`;
    case "inventory_mismatch":
      return `Inventory item #${ev.inventoryItemId}: actual consumption (${Number(ev.actual ?? 0).toFixed(2)}) deviated ${ev.variancePercent}% from recipe-based expected (${Number(ev.expected ?? 0).toFixed(2)}).`;
    case "unusual_free_items":
      return `Waiter ${subj} added ${ev.freeItemLineCount} zero-price items (qty ${ev.freeQuantity}) in the last ${ev.windowHours ?? 24}h — exceeds ${c.threshold} threshold.`;
    default:
      return `Anomaly detected for ${c.detector} (score=${c.score}, threshold=${c.threshold}).`;
  }
}

export async function generateFraudAiSummary(
  restaurantId: number,
  c: AlertCandidate,
): Promise<{ summary: string; fallback: boolean }> {
  const fallback = templateSummary(c);
  try {
    const result = await AIProviderService.generateText(
      { featureSlug: "fraud_alert_summary", restaurantId, metadata: { detector: c.detector } },
      {
        systemPrompt:
          "You are a restaurant operations auditor. Given a fraud-detection signal, write a single concise sentence (under 40 words) describing what looks suspicious and the key numbers. Do NOT speculate intent. Plain text, no markdown.",
        messages: [{
          role: "user",
          content: `Detector: ${c.detector}\nSeverity: ${c.severity}\nScore: ${c.score}\nThreshold: ${c.threshold}\nEvidence: ${JSON.stringify(c.evidence)}`,
        }],
        temperature: 0.2,
        maxTokens: 120,
      },
    );
    const text = (result.text || "").trim();
    if (!text) return { summary: fallback, fallback: true };
    return { summary: text, fallback: false };
  } catch (err) {
    logger.warn({ err, detector: c.detector, restaurantId }, "[fraud] AI summary failed; using template");
    return { summary: fallback, fallback: true };
  }
}
