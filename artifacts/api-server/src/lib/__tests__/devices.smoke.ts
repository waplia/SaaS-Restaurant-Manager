// Smoke test for device management — invoked manually via:
//   pnpm --filter @workspace/api-server tsx src/lib/__tests__/devices.smoke.ts <restaurantId>
// Verifies CRUD, station mappings, routing rules, heartbeat, test print and
// resolution helpers work end-to-end against the live DB.
import { eq } from "drizzle-orm";
import { db, devicesTable, deviceLogsTable } from "../db";
import {
  generateRegistrationToken,
  recordHeartbeat,
  recordPrintAttempt,
  resolvePrintersForKitchen,
  setDeviceStatus,
  logDeviceEvent,
} from "../devices";
import { getDefaultKitchenId } from "../kitchenRouting";

async function main() {
  const restaurantId = Number(process.argv[2] ?? "1");
  if (!Number.isFinite(restaurantId)) {
    console.error("Usage: tsx devices.smoke.ts <restaurantId>");
    process.exit(1);
  }

  const kitchenId = await getDefaultKitchenId(restaurantId);
  console.log(`[smoke] Using restaurant=${restaurantId} kitchen=${kitchenId}`);

  const token = generateRegistrationToken();
  const [d] = await db.insert(devicesTable).values({
    restaurantId, kitchenId,
    name: "Smoke Test Printer",
    type: "kot_printer",
    status: "pairing",
    registrationToken: token,
    paperSize: "thermal-80mm",
  }).returning();
  console.log(`[smoke] Created device #${d.id} token=${token.slice(0, 12)}…`);

  await logDeviceEvent({ deviceId: d.id, restaurantId, eventType: "registered", message: "smoke" });

  await recordHeartbeat({ deviceId: d.id, restaurantId, firmwareVersion: "1.0.0", status: "online" });
  const [afterHb] = await db.select().from(devicesTable).where(eq(devicesTable.id, d.id));
  console.log(`[smoke] After heartbeat: status=${afterHb.status} lastSeen=${afterHb.lastSeenAt?.toISOString()}`);

  const printers = await resolvePrintersForKitchen({ restaurantId, kitchenId });
  console.log(`[smoke] resolvePrintersForKitchen -> ${printers.length} printer(s):`, printers.map(p => p.name).join(", "));

  await recordPrintAttempt({ deviceId: d.id, restaurantId, success: true, message: "Smoke test print" });
  await recordPrintAttempt({ deviceId: d.id, restaurantId, success: false, message: "Simulated failure 1" });
  await recordPrintAttempt({ deviceId: d.id, restaurantId, success: false, message: "Simulated failure 2" });
  await recordPrintAttempt({ deviceId: d.id, restaurantId, success: false, message: "Simulated failure 3" });
  const [afterErrs] = await db.select().from(devicesTable).where(eq(devicesTable.id, d.id));
  console.log(`[smoke] After 3 failures: status=${afterErrs.status} errors=${afterErrs.consecutiveErrors} (expected status=error errors=3)`);

  const logs = await db.select().from(deviceLogsTable).where(eq(deviceLogsTable.deviceId, d.id));
  console.log(`[smoke] Total logs: ${logs.length}`);

  await setDeviceStatus({ deviceId: d.id, restaurantId, status: "offline", reason: "smoke cleanup" });

  await db.delete(devicesTable).where(eq(devicesTable.id, d.id));
  console.log(`[smoke] Cleaned up device #${d.id}`);

  process.exit(0);
}

main().catch(err => {
  console.error("[smoke] FAILED", err);
  process.exit(1);
});
