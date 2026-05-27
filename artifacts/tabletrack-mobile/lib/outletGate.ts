import * as SecureStorage from "@/lib/secureStorage";

/**
 * SecureStorage key prefix used by the first-launch outlet gate. We stamp
 * `${OUTLET_SELECTION_VERSION_KEY}:<userId>` once a multi-outlet user has
 * picked an outlet (either via the dedicated /outlet-select screen on
 * cold start or via the in-app outlet switcher sheet). `app/index.tsx`
 * reads this stamp to decide whether to force-route to /outlet-select.
 */
export const OUTLET_SELECTION_VERSION_KEY = "outletSelectionStampV1";

export async function stampOutletSelection(userId: number | undefined | null): Promise<void> {
  if (!userId) return;
  try {
    await SecureStorage.setItem(`${OUTLET_SELECTION_VERSION_KEY}:${userId}`, "1");
  } catch { /* ignore */ }
}

export async function clearOutletSelection(userId: number | undefined | null): Promise<void> {
  if (!userId) return;
  try {
    await SecureStorage.deleteItem(`${OUTLET_SELECTION_VERSION_KEY}:${userId}`);
  } catch { /* ignore */ }
}
