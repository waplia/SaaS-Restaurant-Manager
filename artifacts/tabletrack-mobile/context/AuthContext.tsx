import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import * as SecureStorage from "@/lib/secureStorage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { router } from "expo-router";
import { setAuthTokenGetter } from "@workspace/api-client-react";

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
  login: (token: string, refreshToken: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
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

    const baseUrl = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
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
    const baseUrl = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
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
      return role === "kitchen" ? "/(owner)/kitchen" : "/(owner)/kitchen";
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

  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    async function loadToken() {
      try {
        const token = await SecureStorage.getItem("accessToken");
        const userJson = await SecureStorage.getItem("authUser");
        if (token && userJson) {
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

  useEffect(() => {
    const token = accessToken;
    setAuthTokenGetter(() => token);
  }, [accessToken]);

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
    setAccessToken(token);
    setUser(userData);

    registerPushToken(userData.id, token);
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
    setAccessToken(null);
    setUser(null);
  }, [accessToken]);

  const restaurantId = user?.restaurantId ?? 1;

  return (
    <AuthContext.Provider value={{ user, accessToken, isLoading, restaurantId, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
