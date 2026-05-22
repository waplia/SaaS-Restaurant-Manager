/**
 * Smoke test for the own_gateway credential storage round-trip.
 * Run with: pnpm --filter @workspace/api-server exec tsx scripts/smoke-own-gateway-credentials.ts
 */
import { upsertMethod, getPaymentConfig, decryptGatewayField } from "../src/lib/paymentConfig";
import { db, paymentMethodsTable } from "../src/lib/db";
import { and, eq } from "drizzle-orm";

const RID = 1;
const GATEWAY = "razorpay";
const TEST_KEY_ID = "rzp_test_smoke_KEYID123";
const TEST_SECRET = "smoke-secret-VALUE-shhh-9999";

function ok(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); process.exitCode = 1; }
}

async function main() {
  console.log(`[1] Saving razorpay credentials for restaurant ${RID} ...`);
  await upsertMethod(RID, {
    category: "online",
    type: "own_gateway",
    gatewayCode: GATEWAY,
    isEnabled: true,
    label: "Pay with Razorpay",
    config: { key_id: TEST_KEY_ID, key_secret: TEST_SECRET },
  });

  console.log(`[2] Inspecting DB row ...`);
  const [row] = await db.select().from(paymentMethodsTable).where(
    and(
      eq(paymentMethodsTable.restaurantId, RID),
      eq(paymentMethodsTable.type, "own_gateway"),
      eq(paymentMethodsTable.gatewayCode, GATEWAY),
    ),
  );
  const cfg = row?.config as Record<string, unknown> | undefined;
  ok(cfg?.key_id === TEST_KEY_ID, `key_id stored as plain string (got ${JSON.stringify(cfg?.key_id)})`);
  const secret = cfg?.key_secret as { cipher?: string; iv?: string; tag?: string } | undefined;
  ok(!!secret?.cipher && !!secret?.iv && !!secret?.tag, `key_secret stored as {cipher,iv,tag}`);
  ok(typeof secret?.cipher === "string" && !secret!.cipher.includes(TEST_SECRET), `cipher does NOT contain plaintext`);

  console.log(`[3] getPaymentConfig returns masked secret ...`);
  const dto = await getPaymentConfig(RID);
  const method = dto.onlineMethods.find(m => m.type === "own_gateway" && m.gatewayCode === GATEWAY);
  ok(!!method, `own_gateway/razorpay row present in DTO`);
  const dtoCfg = method?.config as Record<string, unknown> | undefined;
  ok(dtoCfg?.key_id === TEST_KEY_ID, `DTO key_id is plain text`);
  const dtoSecret = dtoCfg?.key_secret as { __secret?: boolean; hasValue?: boolean; preview?: string } | undefined;
  ok(dtoSecret?.__secret === true, `DTO key_secret is marked __secret`);
  ok(dtoSecret?.hasValue === true, `DTO key_secret has hasValue=true`);
  ok(typeof dtoSecret?.preview === "string" && dtoSecret!.preview.length > 0 && !dtoSecret!.preview.includes(TEST_SECRET), `DTO preview is masked (got "${dtoSecret?.preview}")`);

  console.log(`[4] decryptGatewayField round-trip ...`);
  const decrypted = decryptGatewayField(cfg ?? null, "key_secret");
  ok(decrypted === TEST_SECRET, `decrypted secret matches original`);

  console.log(`[5] Partial update — change only key_secret, key_id should persist ...`);
  await upsertMethod(RID, {
    category: "online",
    type: "own_gateway",
    gatewayCode: GATEWAY,
    isEnabled: true,
    config: { key_secret: "rotated-secret-NEW" },
  });
  const [row2] = await db.select().from(paymentMethodsTable).where(
    and(
      eq(paymentMethodsTable.restaurantId, RID),
      eq(paymentMethodsTable.type, "own_gateway"),
      eq(paymentMethodsTable.gatewayCode, GATEWAY),
    ),
  );
  const cfg2 = row2?.config as Record<string, unknown>;
  ok(cfg2?.key_id === TEST_KEY_ID, `key_id preserved after partial update`);
  ok(decryptGatewayField(cfg2, "key_secret") === "rotated-secret-NEW", `key_secret was rotated`);

  console.log(`[6] Empty-string secret does NOT clobber stored value ...`);
  await upsertMethod(RID, {
    category: "online",
    type: "own_gateway",
    gatewayCode: GATEWAY,
    isEnabled: true,
    config: { key_secret: "" },
  });
  const [row3] = await db.select().from(paymentMethodsTable).where(
    and(
      eq(paymentMethodsTable.restaurantId, RID),
      eq(paymentMethodsTable.type, "own_gateway"),
      eq(paymentMethodsTable.gatewayCode, GATEWAY),
    ),
  );
  ok(decryptGatewayField(row3!.config as Record<string, unknown>, "key_secret") === "rotated-secret-NEW", `empty-string save left stored secret intact`);

  console.log(`[7] Cleanup — disabling and clearing test row ...`);
  await db.update(paymentMethodsTable)
    .set({ isEnabled: false, config: {} })
    .where(and(
      eq(paymentMethodsTable.restaurantId, RID),
      eq(paymentMethodsTable.type, "own_gateway"),
      eq(paymentMethodsTable.gatewayCode, GATEWAY),
    ));

  console.log(process.exitCode ? "\n❌ FAIL" : "\n✅ ALL PASS");
  process.exit(process.exitCode ?? 0);
}

main().catch(err => { console.error(err); process.exit(1); });
