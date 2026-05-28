/**
 * Hook that resolves the active tenant's plan-feature flags via the
 * main-process IPC channel `plan:features`. Using IPC (rather than a
 * raw renderer fetch) means the request is sent through the
 * authenticated `ApiClient` in main, which attaches the bearer token
 * and performs refresh-on-401 — a renderer-side fetch would not see
 * those credentials because they live in the main-process session
 * store.
 *
 * The Desktop Shell uses this Set to hide nav items whose
 * `requiredFeature` isn't enabled on the tenant's plan — i.e. plan-
 * locked modules never appear in the Manager Office rail or the Back
 * Office index. Super-admin bypasses the gate (see `DesktopShell`).
 *
 * State semantics:
 *   - `loaded === false` → the request is in-flight; the shell hides
 *     every `requiredFeature` item until we know (fail-closed).
 *   - `loaded === true` with `enabled` Set → only those keys are gated
 *     in.
 *   - IPC errors are swallowed (resolves loaded=true with empty set)
 *     so a transient blip just hides plan-gated rows rather than
 *     tearing the rail apart.
 */
import { useEffect, useState } from "react";

export interface PlanFeaturesState {
  loaded: boolean;
  enabled: Set<string>;
  planName: string | null;
}

const EMPTY: Set<string> = new Set();

export function usePlanFeatures(restaurantId: number | null): PlanFeaturesState {
  const [state, setState] = useState<PlanFeaturesState>({ loaded: false, enabled: EMPTY, planName: null });

  useEffect(() => {
    if (!restaurantId) {
      setState({ loaded: true, enabled: EMPTY, planName: null });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await window.khanalagao?.plan?.features?.({ restaurantId });
        if (!res) throw new Error("plan:features IPC unavailable");
        if (!cancelled) {
          setState({
            loaded: true,
            enabled: new Set(res.features ?? []),
            planName: res.planName ?? null,
          });
        }
      } catch {
        if (!cancelled) setState({ loaded: true, enabled: EMPTY, planName: null });
      }
    })();
    return () => { cancelled = true; };
  }, [restaurantId]);

  return state;
}
