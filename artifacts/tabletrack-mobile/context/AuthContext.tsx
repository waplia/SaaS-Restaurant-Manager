import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import { setAuthTokenGetter } from "@workspace/api-client-react";

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
  login: (token: string, refreshToken: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

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
  }, []);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync("accessToken");
    await SecureStore.deleteItemAsync("refreshToken");
    await SecureStore.deleteItemAsync("authUser");
    setAccessToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, accessToken, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
