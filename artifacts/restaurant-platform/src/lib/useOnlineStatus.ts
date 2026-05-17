import { useEffect, useState, useCallback } from "react";
import {
  subscribeQueue, subscribeConflict, getQueueSnapshot, getLastSyncAt,
  processQueue, markOfflineEntered, consumeOfflineExited,
  setOfflineQueueingEnabled, type QueueEntry,
} from "./offlineQueue";
import { apiPost } from "./api";
import { useRestaurantId } from "./hooks";
import { usePlanCapability } from "./planFeatures";

/**
 * Tracks browser online/offline state. Soft-offline detection (treating
 * repeated failures as offline) is left as a follow-up — the architecture
 * is in place via the per-entry retry/backoff in offlineQueue.
 */
export function useOnlineStatus(): { online: boolean; effectiveOnline: boolean } {
  const [online, setOnline] = useState<boolean>(() => typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return { online, effectiveOnline: online };
}

/** Live queue snapshot for components that show the badge / sync screen. */
export function useOfflineQueue(): QueueEntry[] {
  const [entries, setEntries] = useState<QueueEntry[]>(() => getQueueSnapshot());
  useEffect(() => subscribeQueue(setEntries), []);
  return entries;
}

export function useLastSyncAt(): number | null {
  const [ts, setTs] = useState<number | null>(getLastSyncAt());
  useEffect(() => {
    const id = window.setInterval(() => setTs(getLastSyncAt()), 5000);
    return () => window.clearInterval(id);
  }, []);
  return ts;
}

/**
 * Drains the offline queue on reconnect and on a 30s interval, writes
 * audit events for offline.enter/exit and sync.conflict, and flips the
 * global `offlineQueueingEnabled` flag based on the tenant's plan so
 * plans without `offline_pos` keep the legacy hard-fail behavior.
 * Mount once at the app root.
 */
export function useOfflineSyncEngine(): void {
  const restaurantId = useRestaurantId();
  const { online } = useOnlineStatus();
  const cap = usePlanCapability("offline_pos");
  const planEnabled = cap.enabled;

  // Flip the api-layer feature switch only when the plan capability has
  // a confirmed answer from the server. While loading OR when the
  // request errored out (typical cold-reload-offline path), preserve
  // the last-known bootstrap value so paid tenants can still queue
  // writes immediately without waiting for /subscription to respond.
  useEffect(() => {
    if (!cap.isResolved) return;
    setOfflineQueueingEnabled(!!planEnabled);
  }, [cap.isResolved, planEnabled]);

  const logEvent = useCallback(async (action: string, metadata: Record<string, unknown>) => {
    if (!restaurantId) return;
    try {
      await apiPost(`/restaurants/${restaurantId}/offline-events`, { action, metadata });
    } catch {
      // Audit log is best-effort — never block operational flow.
    }
  }, [restaurantId]);

  // Subscribe to conflict transitions and log them to the audit trail
  // so owners can see exactly which queued change the server rejected.
  useEffect(() => {
    if (!planEnabled) return;
    const unsub = subscribeConflict((entry) => {
      void logEvent("offline.sync_conflict", {
        entryId: entry.id,
        scope: entry.scope,
        label: entry.label,
        method: entry.method,
        path: entry.path,
        attempts: entry.attempts,
        error: entry.lastError ?? null,
        at: new Date().toISOString(),
      });
    });
    return unsub;
  }, [planEnabled, logEvent]);

  useEffect(() => {
    if (!planEnabled) return;
    if (!online) {
      if (markOfflineEntered()) {
        void logEvent("offline.enter", { at: new Date().toISOString() });
      }
      return;
    }
    const exited = consumeOfflineExited();
    if (exited) {
      void logEvent("offline.exit", {
        enteredAt: new Date(exited.enteredAt).toISOString(),
        exitedAt: new Date().toISOString(),
        durationMs: Date.now() - exited.enteredAt,
      });
    }
    void processQueue();
  }, [planEnabled, online, logEvent]);

  useEffect(() => {
    if (!planEnabled) return;
    const id = window.setInterval(() => { void processQueue(); }, 30_000);
    return () => window.clearInterval(id);
  }, [planEnabled]);
}
