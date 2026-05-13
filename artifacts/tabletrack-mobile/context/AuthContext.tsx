import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
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

async function registerPushToken(userId: number, accessToken: string) {
  if (Platform.OS === "web") return;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return;

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
  } catch {
    // non-critical — silently fail if notifications not available
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadToken() {
      try {
        const token = await SecureStore.getItemAsync("accessToken");
        const userJson = await SecureStore.getItemAsync("authUser");
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

  const login = useCallback(async (token: string, refreshTok: string, userData: AuthUser) => {
    await SecureStore.setItemAsync("accessToken", token);
    await SecureStore.setItemAsync("refreshToken", refreshTok);
    await SecureStore.setItemAsync("authUser", JSON.stringify(userData));
    setAccessToken(token);
    setUser(userData);

    registerPushToken(userData.id, token);
  }, []);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync("accessToken");
    await SecureStore.deleteItemAsync("refreshToken");
    await SecureStore.deleteItemAsync("authUser");
    setAccessToken(null);
    setUser(null);
  }, []);

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
