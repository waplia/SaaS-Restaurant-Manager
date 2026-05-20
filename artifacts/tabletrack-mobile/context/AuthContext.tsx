import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import * as SecureStorage from "@/lib/secureStorage";
import * as Notifications from "expo-notifications";
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
}

interface AuthContextType {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  restaurantId: number;
  tenantId: number | null;
  login: (token: string, refreshToken: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
  updateTokens: (accessToken: string, refreshToken: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PUSH_TOKEN_STORAGE_KEY = "expoPushToken";

async function registerPushToken(userId: number, accessToken: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return null;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const pushToken = tokenData.data;

    const baseUrl = getApiBaseUrl();
    await fetch(`${baseUrl}/api/users/${userId}/push-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token: pushToken, platform: Platform.OS }),
    }).catch(() => {});

    await SecureStorage.setItem(PUSH_TOKEN_STORAGE_KEY, pushToken);
    return pushToken;
  } catch {
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
  }, [accessToken]);

  const restaurantId = user?.restaurantId ?? 1;
  const tenantId = user?.tenantId ?? null;

  return (
    <AuthContext.Provider value={{ user, accessToken, isLoading, restaurantId, tenantId, login, logout, updateTokens }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
