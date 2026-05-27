import { useEffect, useState, useCallback, useRef } from "react";
import { Platform, Linking, AppState, type AppStateStatus } from "react-native";
import * as Application from "expo-application";
import * as Updates from "expo-updates";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type StoreUpdateInfo = {
  updateAvailable: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  storeUrl: string | null;
  source: "ios" | "android" | null;
};

export type AppUpdateState = {
  store: StoreUpdateInfo;
  ota: { available: boolean; manifestId?: string };
  checking: boolean;
  error: string | null;
};

const SKIP_KEY_PREFIX = "appUpdate:skippedVersion:";
const LAST_CHECK_KEY = "appUpdate:lastCheckTs";
const LAST_STORE_RESULT_KEY = "appUpdate:lastStoreResult";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // re-check at most every 6h

// Loose semver-ish comparator: "1.2.10" > "1.2.9". Returns 1, -1, 0.
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((p) => parseInt(p, 10));
  const pb = b.split(/[.\-+]/).map((p) => parseInt(p, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function fetchIosLatest(bundleId: string): Promise<{ version: string; url: string } | null> {
  try {
    // Add country=us as a stable lookup; the App Store is global so a hit
    // in any storefront tells us the current published version. We add a
    // cache-buster because Apple's CDN caches lookup responses aggressively
    // and we want the freshest version right after a release.
    const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { resultCount?: number; results?: Array<{ version?: string; trackViewUrl?: string }> };
    const hit = json?.results?.[0];
    if (!hit?.version || !hit?.trackViewUrl) return null;
    return { version: hit.version, url: hit.trackViewUrl };
  } catch {
    return null;
  }
}

async function fetchAndroidLatest(pkg: string): Promise<{ version: string; url: string } | null> {
  try {
    // Google Play has no official public API; this is the long-standing
    // workaround used by community libraries — fetch the public store page
    // and extract the version string from the embedded JSON blob. The
    // marker `[[["X.Y.Z"]]]` has been stable for years; we tolerate the
    // page changing by simply returning null and skipping the prompt.
    const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en&gl=us`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const match =
      html.match(/\[\[\["((?:\d+\.){1,3}\d+)"\]\]/) ??
      html.match(/Current Version.*?>([\d.]+)</) ??
      html.match(/"softwareVersion"\s*:\s*"([^"]+)"/);
    const version = match?.[1];
    if (!version) return null;
    return { version, url: `https://play.google.com/store/apps/details?id=${pkg}` };
  } catch {
    return null;
  }
}

async function checkStoreVersion(): Promise<StoreUpdateInfo> {
  const empty: StoreUpdateInfo = {
    updateAvailable: false,
    currentVersion: Application.nativeApplicationVersion,
    latestVersion: null,
    storeUrl: null,
    source: null,
  };
  if (Platform.OS === "web") return empty;
  const current = Application.nativeApplicationVersion;
  if (!current) return empty;

  if (Platform.OS === "ios") {
    const bundleId = Application.applicationId;
    if (!bundleId) return empty;
    const latest = await fetchIosLatest(bundleId);
    if (!latest) return empty;
    return {
      updateAvailable: compareVersions(latest.version, current) > 0,
      currentVersion: current,
      latestVersion: latest.version,
      storeUrl: latest.url,
      source: "ios",
    };
  }
  if (Platform.OS === "android") {
    const pkg = Application.applicationId;
    if (!pkg) return empty;
    const latest = await fetchAndroidLatest(pkg);
    if (!latest) return empty;
    return {
      updateAvailable: compareVersions(latest.version, current) > 0,
      currentVersion: current,
      latestVersion: latest.version,
      storeUrl: latest.url,
      source: "android",
    };
  }
  return empty;
}

async function checkOtaUpdate(): Promise<{ available: boolean; manifestId?: string }> {
  // expo-updates is a no-op in Expo Go and in dev — bail early to avoid
  // noisy console warnings during development.
  if (Platform.OS === "web") return { available: false };
  if (!Updates.isEnabled || __DEV__) return { available: false };
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return { available: false };
    const manifest = result.manifest as { id?: string } | undefined;
    return { available: true, manifestId: manifest?.id };
  } catch {
    return { available: false };
  }
}

/**
 * Hook that checks both the public app store (Play Store / App Store) and the
 * expo-updates OTA channel for new releases, and exposes a single state plus
 * helpers to open the store, apply an OTA, or skip a particular version.
 *
 * Throttled to one network check per 6h per cold start, and re-checks when
 * the app returns to the foreground if the interval has elapsed.
 */
export function useAppUpdateCheck(): AppUpdateState & {
  openStore: () => Promise<void>;
  applyOta: () => Promise<void>;
  skipThisVersion: () => Promise<void>;
  recheck: () => Promise<void>;
} {
  const [state, setState] = useState<AppUpdateState>({
    store: {
      updateAvailable: false,
      currentVersion: Application.nativeApplicationVersion,
      latestVersion: null,
      storeUrl: null,
      source: null,
    },
    ota: { available: false },
    checking: false,
    error: null,
  });
  const inFlight = useRef(false);

  // Rehydrate the last known store result on mount so a cold start that
  // falls inside the 6h throttle window still shows the prompt. Throttle
  // controls network calls, not prompt visibility.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LAST_STORE_RESULT_KEY);
        if (!raw || cancelled) return;
        const cached = JSON.parse(raw) as StoreUpdateInfo;
        // Discard if the cached "current" no longer matches the actually
        // installed binary version (user updated since last check).
        if (cached.currentVersion !== Application.nativeApplicationVersion) return;
        // Honor a fresh skip after the cache was written.
        if (cached.updateAvailable && cached.latestVersion) {
          const skipped = await AsyncStorage.getItem(SKIP_KEY_PREFIX + cached.latestVersion);
          if (skipped === "1") cached.updateAvailable = false;
        }
        setState((s) => ({ ...s, store: cached }));
      } catch {
        /* ignore corrupted cache */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runCheck = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (Platform.OS === "web") return;
    inFlight.current = true;
    setState((s) => ({ ...s, checking: true, error: null }));
    try {
      if (!force) {
        const last = await AsyncStorage.getItem(LAST_CHECK_KEY);
        const lastTs = last ? parseInt(last, 10) : 0;
        if (Date.now() - lastTs < CHECK_INTERVAL_MS) {
          // Within throttle window — skip the store scrape (already
          // rehydrated from cache on mount) but always run the cheap
          // OTA check so JS-only fixes ship immediately.
          const ota = await checkOtaUpdate();
          setState((s) => ({ ...s, ota, checking: false }));
          return;
        }
      }
      const [store, ota] = await Promise.all([checkStoreVersion(), checkOtaUpdate()]);

      // Respect user's "skip this version" choice for the store prompt.
      if (store.updateAvailable && store.latestVersion) {
        const skipped = await AsyncStorage.getItem(SKIP_KEY_PREFIX + store.latestVersion);
        if (skipped === "1") {
          store.updateAvailable = false;
        }
      }

      await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      // Only cache when we actually got a real answer from the store —
      // a null latestVersion means the fetch failed / regex didn't match,
      // and we don't want to overwrite a previously-known update with
      // a "no update" result.
      if (store.latestVersion) {
        await AsyncStorage.setItem(LAST_STORE_RESULT_KEY, JSON.stringify(store));
      }
      setState({ store, ota, checking: false, error: null });
    } catch (e) {
      setState((s) => ({ ...s, checking: false, error: (e as Error).message }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void runCheck(false);
    const sub = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (status === "active") void runCheck(false);
    });
    return () => sub.remove();
  }, [runCheck]);

  const openStore = useCallback(async () => {
    const url = state.store.storeUrl;
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      /* noop */
    }
  }, [state.store.storeUrl]);

  const applyOta = useCallback(async () => {
    if (Platform.OS === "web" || !Updates.isEnabled || __DEV__) return;
    try {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch {
      /* noop — leave the banner up so the user can retry */
    }
  }, []);

  const skipThisVersion = useCallback(async () => {
    const v = state.store.latestVersion;
    if (!v) return;
    await AsyncStorage.setItem(SKIP_KEY_PREFIX + v, "1");
    setState((s) => ({ ...s, store: { ...s.store, updateAvailable: false } }));
  }, [state.store.latestVersion]);

  return { ...state, openStore, applyOta, skipThisVersion, recheck: () => runCheck(true) };
}
