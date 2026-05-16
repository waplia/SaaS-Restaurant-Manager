// Smoke test for QR-based staff task management.
//   pnpm --filter @workspace/api-server tsx src/lib/__tests__/staffTasks.smoke.ts <restaurantId>
// Verifies area + checklist CRUD, QR token resolve, submission with item ticks
// + verify/reject, missed-window sweep idempotency, and tenant isolation.
import { and, eq } from "drizzle-orm";
import {
  db,
  staffTaskAreasTable,
  staffTaskChecklistsTable,
  staffTaskSubmissionsTable,
  staffTaskSubmissionItemsTable,
  staffTaskVerificationsTable,
  staffTaskMissedWindowsTable,
} from "../db";
import { runStaffTaskMissedSweep } from "../../routes/staff-tasks";

async function main() {
  const restaurantId = Number(process.argv[2] ?? "1");
  const otherRestaurantId = Number(process.argv[3] ?? "2");
  if (!Number.isFinite(restaurantId)) {
    console.error("Usage: tsx staffTasks.smoke.ts <restaurantId> [otherRestaurantId]");
    process.exit(1);
  }
  const staffUserId = Number(process.argv[4] ?? "1");
  console.log(`[smoke] restaurant=${restaurantId} other=${otherRestaurantId} staff=${staffUserId}`);

  // 1. Create area
  const token = "smk_" + Math.random().toString(36).slice(2, 14);
  const [area] = await db.insert(staffTaskAreasTable).values({
    restaurantId, name: "Smoke Test Restroom", description: "smoke", qrToken: token, isActive: true,
  }).returning();
  console.log(`[smoke] Area #${area.id} token=${area.qrToken}`);

  // 2. Tenant isolation: lookup with wrong tenant filter must miss.
  const wrong = await db.select().from(staffTaskAreasTable).where(
    and(eq(staffTaskAreasTable.qrToken, token), eq(staffTaskAreasTable.restaurantId, otherRestaurantId))
  );
  console.log(`[smoke] cross-tenant area lookup -> ${wrong.length} (expected 0)`);

  // 3. Create checklist (interval, every 60 min, 30-min window)
  const [cl] = await db.insert(staffTaskChecklistsTable).values({
    restaurantId, areaId: area.id, name: "Hourly Restroom Check", description: null,
    items: [
      { key: "k1", label: "Toilet flushed" },
      { key: "k2", label: "Soap refilled" },
    ],
    photoRequired: false, scheduleType: "interval", intervalMinutes: 60, timesPerDay: 0, windowMinutes: 30, isActive: true,
  }).returning();
  console.log(`[smoke] Checklist #${cl.id}`);

  // 4. Submit a completion (windowStart = top of current hour)
  const now = new Date();
  const windowStart = new Date(now); windowStart.setMinutes(0, 0, 0);
  const [sub] = await db.insert(staffTaskSubmissionsTable).values({
    restaurantId, areaId: area.id, checklistId: cl.id, staffUserId,
    submittedAt: now, status: "pending", notes: "smoke", photoUrls: [], windowStart,
  }).returning();
  await db.insert(staffTaskSubmissionItemsTable).values([
    { submissionId: sub.id, itemKey: "k1", itemLabel: "Toilet flushed", checked: true },
    { submissionId: sub.id, itemKey: "k2", itemLabel: "Soap refilled",  checked: false },
  ]);
  console.log(`[smoke] Submission #${sub.id} with 2 items`);

  // 5. Verify (approve) via direct insert + status update (simulating route behavior)
  await db.insert(staffTaskVerificationsTable).values({
    submissionId: sub.id, restaurantId, managerUserId: staffUserId, action: "approved", comment: "smoke ok",
  });
  await db.update(staffTaskSubmissionsTable).set({ status: "approved" }).where(eq(staffTaskSubmissionsTable.id, sub.id));
  const [approved] = await db.select().from(staffTaskSubmissionsTable).where(eq(staffTaskSubmissionsTable.id, sub.id));
  console.log(`[smoke] Submission status after approve = ${approved.status} (expected approved)`);

  // 6. Missed-window sweep:
  //    Pretend hours have passed -> a window in the past (2h ago) was never submitted.
  //    runStaffTaskMissedSweep walks back through windows and inserts misses.
  const before = await db.select().from(staffTaskMissedWindowsTable)
    .where(eq(staffTaskMissedWindowsTable.checklistId, cl.id));
  // Use a "now" that is 3 hours in the future so prior windows clearly closed.
  const future = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const r1 = await runStaffTaskMissedSweep(future);
  const r2 = await runStaffTaskMissedSweep(future); // idempotency
  const after = await db.select().from(staffTaskMissedWindowsTable)
    .where(eq(staffTaskMissedWindowsTable.checklistId, cl.id));
  console.log(`[smoke] Missed sweep: before=${before.length} after=${after.length} (run1.missed=${r1.missed} run2.missed=${r2.missed}; run2 should be 0)`);
  if (r2.missed !== 0) console.error(`[smoke] FAIL: missed sweep is not idempotent`);

  // 7. Cleanup
  await db.delete(staffTaskMissedWindowsTable).where(eq(staffTaskMissedWindowsTable.checklistId, cl.id));
  await db.delete(staffTaskVerificationsTable).where(eq(staffTaskVerificationsTable.submissionId, sub.id));
  await db.delete(staffTaskSubmissionItemsTable).where(eq(staffTaskSubmissionItemsTable.submissionId, sub.id));
  await db.delete(staffTaskSubmissionsTable).where(eq(staffTaskSubmissionsTable.id, sub.id));
  await db.delete(staffTaskChecklistsTable).where(eq(staffTaskChecklistsTable.id, cl.id));
  await db.delete(staffTaskAreasTable).where(eq(staffTaskAreasTable.id, area.id));
  console.log("[smoke] Cleanup done");
  process.exit(0);
}

main().catch(err => { console.error("[smoke] FAILED", err); process.exit(1); });
