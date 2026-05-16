// Smoke test for fraud detection — invoked manually via:
//   pnpm --filter @workspace/api-server tsx src/lib/__tests__/fraudDetection.smoke.ts <restaurantId>
// Verifies the engine runs without errors against the live DB and prints summary.
import { runDetectorsForRestaurant, ensureDefaultDetectorSettings, getDetectorSettings } from "../fraudDetection";
import { FRAUD_DETECTORS } from "../db";

async function main() {
  const restaurantId = Number(process.argv[2] ?? "1");
  if (!Number.isFinite(restaurantId)) {
    console.error("Usage: tsx fraudDetection.smoke.ts <restaurantId>");
    process.exit(1);
  }

  console.log(`[smoke] Seeding default detector settings for restaurant ${restaurantId}…`);
  await ensureDefaultDetectorSettings(restaurantId);

  const settings = await getDetectorSettings(restaurantId);
  console.log("[smoke] Detector settings:");
  for (const det of FRAUD_DETECTORS) {
    const s = settings.get(det);
    console.log(`  - ${det}: enabled=${s?.isEnabled} threshold=${s?.threshold}`);
  }

  console.log("[smoke] Running detectors (group=all)…");
  const result = await runDetectorsForRestaurant(restaurantId, "all", null);
  console.log(`[smoke] Done: created=${result.created} skipped(deduped)=${result.skipped} detectors=${result.detectors.join(",")}`);

  // Re-run to verify dedupe
  console.log("[smoke] Re-running to verify dedupe…");
  const result2 = await runDetectorsForRestaurant(restaurantId, "all", null);
  console.log(`[smoke] Re-run: created=${result2.created} skipped=${result2.skipped} (created should be 0 if dedupe works)`);

  process.exit(0);
}

main().catch(err => {
  console.error("[smoke] FAILED", err);
  process.exit(1);
});
