import { useEffect } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  focusManager,
  onlineManager,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigationContainerRef } from "expo-router";

/**
 * Global "always fresh on focus" bridge for React Query in this Expo app.
 *
 * Why this exists: users reported that screens (Business Hours, Operational
 * Shifts, Tax, Direct Ordering, etc.) showed stale data after coming back
 * from another tab/screen or after switching apps — they had to reload the
 * whole app to see fresh values.
 *
 * What this does, in one place at the root:
 *
 *  1. AppState → focusManager. RN doesn't have window focus events, so we
 *     forward foreground/background transitions to React Query. Any active
 *     query with `refetchOnWindowFocus: true` (the default) refetches when
 *     the app comes back to the foreground.
 *
 *  2. NetInfo → onlineManager. Same idea for connectivity: as soon as the
 *     device reconnects, queries refetch instead of being stuck on stale
 *     cached values from before the drop.
 *
 *  3. Navigation state → focus toggle. expo-router keeps screens mounted
 *     under tab navigators, so `refetchOnMount` is not enough. We listen
 *     to navigation state changes and gently re-focus the query cache so
 *     every navigation refreshes the data on the screen the user just
 *     landed on. This matches the behaviour users expect on the web,
 *     where switching tabs/pages naturally re-fetches.
 *
 *  Per-screen `useFocusEffect(refetch)` calls remain valid — this bridge
 *  is an additional safety net for screens that don't opt in explicitly.
 */
export function useReactQueryRefreshBridge(): void {
  const queryClient = useQueryClient();
  const navRef = useNavigationContainerRef();

  // 1) AppState → focusManager
  useEffect(() => {
    if (Platform.OS === "web") return;
    const onChange = (state: AppStateStatus) => {
      focusManager.setFocused(state === "active");
    };
    const sub = AppState.addEventListener("change", onChange);
    // Prime initial state.
    focusManager.setFocused(AppState.currentState === "active");
    return () => sub.remove();
  }, []);

  // 2) NetInfo → onlineManager
  useEffect(() => {
    if (Platform.OS === "web") return;
    const unsub = onlineManager.setEventListener((setOnline) => {
      const sub = NetInfo.addEventListener((state) => {
        setOnline(Boolean(state.isConnected));
      });
      return () => sub();
    });
    return unsub;
  }, []);

  // 3) Navigation focus → toggle focusManager so active queries refetch
  //    on the screen the user just landed on. We toggle (false→true) on
  //    the next tick so React Query sees a real focus transition.
  useEffect(() => {
    if (!navRef) return;
    let prevRoute: string | null = null;
    const unsub = navRef.addListener("state", () => {
      // expo-router exposes the active route via getCurrentRoute().
      const getCurrent = (navRef as unknown as {
        getCurrentRoute?: () => { name?: string } | undefined;
      }).getCurrentRoute;
      const route = getCurrent?.()?.name ?? null;
      if (route === prevRoute) return; // ignore in-place state changes
      prevRoute = route;
      // Toggle focus so RQ refetches every active query that opts in
      // to refetchOnWindowFocus (the library default).
      focusManager.setFocused(false);
      setTimeout(() => focusManager.setFocused(true), 0);
    });
    return unsub;
  }, [navRef, queryClient]);
}
