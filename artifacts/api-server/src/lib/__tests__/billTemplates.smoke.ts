// Task #674 — Smoke test for the unified bill template system.
//   pnpm --filter @workspace/api-server exec tsx \
//     src/lib/__tests__/billTemplates.smoke.ts <restaurantId> [orderId]
//
// Verifies:
//   • System defaults seed correctly (all 8 templates present, idempotent).
//   • Channel mapping read/write round-trips through restaurant_settings.
//   • resolveTemplateForChannel falls back to per-channel defaults when no
//     explicit assignment exists.
//   • buildBillSnapshot produces a canonical snapshot whose totals match
//     subtotal + tax + service + delivery + tip - discount + roundOff.
//   • renderBillHTML returns a non-empty document containing the order
//     number and the restaurant name (basic shape check).
import { db, ordersTable } from "../db";
import { eq } from "drizzle-orm";
import {
  ensureSeededTemplates,
  SYSTEM_DEFAULT_TEMPLATES,
  resolveTemplateForChannel,
  getChannelAssignments,
  setChannelAssignments,
  CHANNEL_DEFAULT_KEYS,
} from "../billTemplates";
import { buildBillSnapshot, buildSampleBillSnapshot } from "../billSnapshot";
import { renderBillHTML, renderBillText } from "../billRender";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[OK]   ${msg}`);
}

async function main() {
  const restaurantId = Number(process.argv[2] ?? "1");
  const explicitOrderId = process.argv[3] ? Number(process.argv[3]) : null;
  if (!Number.isFinite(restaurantId)) {
    console.error("Usage: tsx billTemplates.smoke.ts <restaurantId> [orderId]");
    process.exit(1);
  }
  console.log(`[smoke] restaurant=${restaurantId}`);

  // 1. Seed and idempotency check.
  const first = await ensureSeededTemplates(restaurantId);
  const second = await ensureSeededTemplates(restaurantId);
  assert(first.length >= SYSTEM_DEFAULT_TEMPLATES.length, "seed produced all system templates");
  assert(second.length === first.length, "seeding is idempotent");
  for (const def of SYSTEM_DEFAULT_TEMPLATES) {
    assert(second.some(t => t.key === def.key), `default template "${def.key}" present`);
  }

  // 2. Channel mapping round-trip.
  const before = await getChannelAssignments(restaurantId);
  const a4Template = second.find(t => t.key === "a4_invoice")!;
  await setChannelAssignments(restaurantId, { whatsapp_share: a4Template.id }, null);
  const afterSet = await getChannelAssignments(restaurantId);
  assert(afterSet.channels.whatsapp_share === a4Template.id, "channel assignment round-trips");

  // Restore prior state to keep the smoke test idempotent.
  await setChannelAssignments(
    restaurantId,
    { whatsapp_share: before.channels.whatsapp_share ?? null },
    null,
  );

  // 3. Channel resolution fallback.
  const kotTemplate = await resolveTemplateForChannel(restaurantId, "kot");
  assert(kotTemplate != null, "kot channel resolves to a template");
  assert(kotTemplate!.key === CHANNEL_DEFAULT_KEYS.kot, "kot channel falls back to compact_kot default");

  // 4. Snapshot calc parity (uses a real order if provided, else a sample).
  if (explicitOrderId) {
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, explicitOrderId));
    if (!order) { console.error(`Order ${explicitOrderId} not found`); process.exit(1); }
    const snap = await buildBillSnapshot(explicitOrderId);
    assert(snap != null, "buildBillSnapshot returned a snapshot");
    const t = snap!.totals;
    const rebuilt = Math.round((t.subtotal + t.taxAmount + t.serviceCharge + t.deliveryFee + t.tipAmount - t.discountAmount + t.roundOff) * 100) / 100;
    assert(rebuilt === t.grandTotal, `totals reconcile: ${rebuilt} == ${t.grandTotal}`);
    const html = renderBillHTML(snap!, kotTemplate!);
    assert(html.includes("<!DOCTYPE html>"), "renderBillHTML returns an HTML document");
    assert(html.includes(snap!.restaurant.name), "rendered HTML contains restaurant name");
    const text = renderBillText(snap!, kotTemplate!);
    assert(text.length > 0, "renderBillText returns non-empty output");
  } else {
    const sample = await buildSampleBillSnapshot(restaurantId);
    assert(sample != null, "buildSampleBillSnapshot returned a sample");
    const t = sample!.totals;
    const rebuilt = Math.round((t.subtotal + t.taxAmount + t.serviceCharge + t.deliveryFee + t.tipAmount - t.discountAmount + t.roundOff) * 100) / 100;
    assert(rebuilt === t.grandTotal, `sample totals reconcile: ${rebuilt} == ${t.grandTotal}`);
    const html = renderBillHTML(sample!, a4Template);
    assert(html.includes("SAMPLE-001"), "rendered sample HTML contains sample order number");
    assert(html.includes("Paneer Tikka Masala"), "rendered sample HTML contains sample item");
  }

  console.log("[smoke] all checks passed");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
