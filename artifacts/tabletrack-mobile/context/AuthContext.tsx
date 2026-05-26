import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import * as SecureStorage from "@/lib/secureStorage";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { router } from "expo-router";
import { setAuthTokenGetter, setUnauthorizedHandler } from "@workspace/api-client-react";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  restaurantId: number | null;
  tenantId: number | null;
  isSuperAdmin: boolean;
  kitchenId?: number | null;
}

interface AuthContextType {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  restaurantId: number;
  tenantId: number | null;
  /**
   * Outlet scope selected from the home dashboard's outlet switcher.
   * - `null` → all outlets (tenant-wide aggregate where supported, otherwise
   *   falls back to the user's own restaurantId for restaurant-scoped APIs).
   * - `number` → a specific branch restaurantId. All sales, dashboards and
   *   reports should be counted against this restaurant only.
   * Owners can change this; managers / non-owners are implicitly pinned to
   * their own restaurantId by the consumer.
   */
  outletScopeId: number | null;
  setOutletScopeId: (id: number | null) => void;
  /** Convenience: the effective restaurantId reports/sales should use. */
  effectiveRestaurantId: number;
  /** Branch id (rows in `branches`) the owner picked, or null = all branches. */
  effectiveBranchId: number | null;
  login: (token: string, refreshToken: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
  updateTokens: (accessToken: string, refreshToken: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PUSH_TOKEN_STORAGE_KEY = "expoPushToken";

/**
 * Resolve the EAS project id from app.json's `expo.extra.eas.projectId`.
 * Required by `getExpoPushTokenAsync` since Expo SDK 49 — without it the
 * call throws on real devices/dev builds. Reads from both `expoConfig`
 * (modern, SDK 49+) and `manifest`/`manifest2` (legacy fallback).
 */
function getEasProjectId(): string | undefined {
  const fromExpoConfig = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof fromExpoConfig === "string" && fromExpoConfig.length > 0) return fromExpoConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacy = (Constants as any).easConfig?.projectId ?? (Constants as any).manifest?.extra?.eas?.projectId;
  if (typeof legacy === "string" && legacy.length > 0) return legacy;
  return undefined;
}

async function registerPushToken(userId: number, accessToken: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      console.warn("[push] notification permission not granted:", finalStatus);
      return null;
    }

    const projectId = getEasProjectId();
    if (!projectId) {
      console.warn("[push] no EAS projectId found in app.json (expo.extra.eas.projectId). Push will not work in dev/prod builds.");
    }

    // SDK 49+ requires `projectId` to be passed explicitly. Without it the
    // call throws "No projectId found" on real devices.
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const pushToken = tokenData.data;
    console.log("[push] registered Expo push token:", pushToken);

    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/users/${userId}/push-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token: pushToken, platform: Platform.OS }),
    }).catch((err) => {
      console.warn("[push] failed to send token to server:", err);
      return null;
    });
    if (res && !res.ok) {
      console.warn("[push] server rejected token registration:", res.status, await res.text().catch(() => ""));
    }

    await SecureStorage.setItem(PUSH_TOKEN_STORAGE_KEY, pushToken);
    return pushToken;
  } catch (err) {
    console.warn("[push] registerPushToken failed:", err);
    return null;
  }
}

async function deregisterPushToken(userId: number, accessToken: string) {
  if (Platform.OS === "web") return;
  try {
    const token = await SecureStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
    if (!token) return;
    const baseUrl = getApiBaseUrl();
    await fetch(`${baseUrl}/api/users/${userId}/push-token`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token }),
    }).catch(() => {});
    await SecureStorage.deleteItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Map a notification's `data.screen` field to an in-app route. */
function routeForNotification(data: Record<string, unknown> | undefined, role: string | undefined): string | null {
  if (!data) return null;
  const screen = typeof data.screen === "string" ? data.screen : null;
  switch (screen) {
    case "waiter_requests":
      return "/(waiter)/(tabs)/notifications";
    case "kitchen":
      return "/(owner)/kitchen";
    case "reservations":
      return role === "waiter" ? "/(waiter)/(tabs)" : "/(owner)";
    default:
      return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Session-only outlet scope: cleared on logout so a new user can't inherit
  // the previous owner's outlet selection. Not persisted to SecureStorage on
  // purpose — switching apps / restarting should reset to "all outlets".
  const [outletScopeId, setOutletScopeIdState] = useState<number | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { tokenRef.current = accessToken; }, [accessToken]);

  useEffect(() => {
    // Register a ref-reading getter once on mount so customFetch always sees
    // the latest token, eliminating stale-closure 401s during hydration and
    // immediately after login/token rotation.
    setAuthTokenGetter(() => tokenRef.current);
    // If any API call returns 401, the token is dead — wipe local state
    // and bounce to /login so the user doesn't sit on a dashboard full of
    // zeros caused by silently-failing requests.
    setUnauthorizedHandler(() => {
      if (tokenRef.current == null && userRef.current == null) return;
      tokenRef.current = null;
      userRef.current = null;
      setAccessToken(null);
      setUser(null);
      // Drop the outlet scope too so the next login can't inherit the
      // previous owner's selection and accidentally show their numbers.
      setOutletScopeIdState(null);
      SecureStorage.deleteItem("accessToken").catch(() => {});
      SecureStorage.deleteItem("refreshToken").catch(() => {});
      SecureStorage.deleteItem("authUser").catch(() => {});
      try { router.replace("/login"); } catch { /* nav may not be ready */ }
    });
    async function loadToken() {
      try {
        const token = await SecureStorage.getItem("accessToken");
        const userJson = await SecureStorage.getItem("authUser");
        if (token && userJson) {
          tokenRef.current = token;
          setAccessToken(token);
          setUser(JSON.parse(userJson) as AuthUser);
        }
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    }
    loadToken();
  }, []);

  // Deep-link on notification tap (foreground or cold-start).
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const target = routeForNotification(data, userRef.current?.role);
      if (target) {
        try { router.push(target as never); } catch { /* navigation may not be ready yet */ }
      }
    });
    // Handle cold-start: if the app was launched by tapping a notification.
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const target = routeForNotification(data, userRef.current?.role);
      if (target) {
        setTimeout(() => {
          try { router.push(target as never); } catch { /* ignore */ }
        }, 600);
      }
    }).catch(() => {});
    return () => sub.remove();
  }, []);

  const login = useCallback(async (token: string, refreshTok: string, userData: AuthUser) => {
    await SecureStorage.setItem("accessToken", token);
    await SecureStorage.setItem("refreshToken", refreshTok);
    await SecureStorage.setItem("authUser", JSON.stringify(userData));
    tokenRef.current = token;
    userRef.current = userData;
    setAccessToken(token);
    setUser(userData);
    // Always start a fresh login with "all outlets" — never inherit a stale
    // scope from a previous session (especially relevant on shared devices).
    setOutletScopeIdState(null);

    registerPushToken(userData.id, token);
  }, []);

  const updateTokens = useCallback(async (newAccessToken: string, newRefreshToken: string) => {
    // Atomically swap stored + in-memory tokens so subsequent authenticated
    // requests (and `setAuthTokenGetter`) immediately use the new credentials.
    // Used after change-password, where the server bumps tokenVersion and
    // returns fresh tokens for the current device.
    await SecureStorage.setItem("accessToken", newAccessToken);
    await SecureStorage.setItem("refreshToken", newRefreshToken);
    tokenRef.current = newAccessToken;
    setAccessToken(newAccessToken);
  }, []);

  const logout = useCallback(async () => {
    const currentUser = userRef.current;
    const currentToken = accessToken;
    if (currentUser && currentToken) {
      await deregisterPushToken(currentUser.id, currentToken);
    }
    await SecureStorage.deleteItem("accessToken");
    await SecureStorage.deleteItem("refreshToken");
    await SecureStorage.deleteItem("authUser");
    tokenRef.current = null;
    userRef.current = null;
    setAccessToken(null);
    setUser(null);
    setOutletScopeIdState(null);
  }, [accessToken]);

  const restaurantId = user?.restaurantId ?? 1;
  const tenantId = user?.tenantId ?? null;
  // `outletScopeId` is the branch id (rows in the `branches` table) the
  // owner has selected as their active outlet. Dashboard / reports
  // endpoints stay restaurant-scoped — `branchId` is passed alongside as
  // a query filter. `effectiveRestaurantId` is preserved for callers that
  // still read it, but it's always just the user's own restaurant now.
  const isScopeOwner = user?.role === "owner";
  const effectiveBranchId = isScopeOwner ? outletScopeId : null;
  const effectiveRestaurantId = restaurantId;
  const setOutletScopeId = useCallback((id: number | null) => {
    setOutletScopeIdState(id);
  }, []);

  return (
    <AuthContext.Provider value={{ user, accessToken, isLoading, restaurantId, tenantId, outletScopeId, setOutletScopeId, effectiveRestaurantId, effectiveBranchId, login, logout, updateTokens }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
