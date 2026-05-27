import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import * as SecureStorage from "@/lib/secureStorage";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { router } from "expo-router";
import { setAuthTokenGetter, setUnauthorizedHandler } from "@workspace/api-client-react";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import { permissionsForRole } from "@/lib/permissions";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface AuthOutlet {
  id: number;
  name: string;
  slug?: string | null;
  city?: string | null;
  logoUrl?: string | null;
  isActive?: boolean;
}

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  restaurantId: number | null;
  tenantId: number | null;
  isSuperAdmin: boolean;
  kitchenId?: number | null;
  avatarUrl?: string | null;
  phone?: string | null;
  /** All roles assigned to this user. Defaults to `[role]` if absent. */
  roles?: string[];
  /** Permission action allow-list (e.g. "order.discount.apply"). */
  permissions?: string[];
  /** Outlets (branches/restaurants) the user can act on. */
  outlets?: AuthOutlet[];
}

interface AuthContextType {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  restaurantId: number;
  tenantId: number | null;
  outletScopeId: number | null;
  setOutletScopeId: (id: number | null) => void;
  effectiveRestaurantId: number;
  effectiveBranchId: number | null;
  /** All roles assigned. Always populated (falls back to `[user.role]`). */
  roles: string[];
  /** Effective role for the current session (post role-switch picker). */
  activeRole: string | null;
  setActiveRole: (role: string) => Promise<void>;
  /** Permission allow-list for the active role. */
  permissions: string[];
  /** All outlets (branches) the user can switch between. */
  outlets: AuthOutlet[];
  /** Currently selected outlet object (resolved from `outletScopeId`). */
  activeOutlet: AuthOutlet | null;
  login: (token: string, refreshToken: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
  updateTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  /** Re-fetch /auth/me to refresh outlets / permissions. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PUSH_TOKEN_STORAGE_KEY = "expoPushToken";
const ACTIVE_ROLE_KEY = "activeRole";
const ACTIVE_OUTLET_KEY = "activeOutletId";

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
    if (finalStatus !== "granted") return null;
    const projectId = getEasProjectId();
    const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const pushToken = tokenData.data;
    const baseUrl = getApiBaseUrl();
    await fetch(`${baseUrl}/api/users/${userId}/push-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ token: pushToken, platform: Platform.OS }),
    }).catch(() => null);
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
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ token }),
    }).catch(() => {});
    await SecureStorage.deleteItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function routeForNotification(data: Record<string, unknown> | undefined, role: string | undefined): string | null {
  if (!data) return null;
  const screen = typeof data.screen === "string" ? data.screen : null;
  switch (screen) {
    case "waiter_requests":
      return "/(waiter)/(tabs)/notifications";
    case "kitchen":
      return role === "chef" || role === "kitchen" ? "/(chef)" : "/(owner)/kitchen";
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
  const [outletScopeId, setOutletScopeIdState] = useState<number | null>(null);
  const [activeRole, setActiveRoleState] = useState<string | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { tokenRef.current = accessToken; }, [accessToken]);

  const persistAndSetUser = useCallback(async (next: AuthUser) => {
    userRef.current = next;
    setUser(next);
    try { await SecureStorage.setItem("authUser", JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const refreshProfile = useCallback(async () => {
    const token = tokenRef.current;
    const current = userRef.current;
    if (!token || !current) return;
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json() as Partial<AuthUser>;
      const merged: AuthUser = {
        ...current,
        ...data,
        // Preserve fields that may be missing from /auth/me.
        kitchenId: data.kitchenId ?? current.kitchenId,
        roles: Array.isArray(data.roles) && data.roles.length > 0 ? data.roles : [current.role],
        permissions: Array.isArray(data.permissions) ? data.permissions : current.permissions,
        outlets: Array.isArray(data.outlets) ? data.outlets : current.outlets,
      };
      await persistAndSetUser(merged);
    } catch (err) {
      console.warn("[auth] refreshProfile failed:", err);
    }
  }, [persistAndSetUser]);

  useEffect(() => {
    setAuthTokenGetter(() => tokenRef.current);
    setUnauthorizedHandler(() => {
      if (tokenRef.current == null && userRef.current == null) return;
      tokenRef.current = null;
      userRef.current = null;
      setAccessToken(null);
      setUser(null);
      setOutletScopeIdState(null);
      setActiveRoleState(null);
      SecureStorage.deleteItem("accessToken").catch(() => {});
      SecureStorage.deleteItem("refreshToken").catch(() => {});
      SecureStorage.deleteItem("authUser").catch(() => {});
      SecureStorage.deleteItem(ACTIVE_ROLE_KEY).catch(() => {});
      SecureStorage.deleteItem(ACTIVE_OUTLET_KEY).catch(() => {});
      try { router.replace("/login"); } catch { /* nav may not be ready */ }
    });
    async function loadToken() {
      try {
        const token = await SecureStorage.getItem("accessToken");
        const userJson = await SecureStorage.getItem("authUser");
        const storedRole = await SecureStorage.getItem(ACTIVE_ROLE_KEY);
        const storedOutlet = await SecureStorage.getItem(ACTIVE_OUTLET_KEY);
        if (token && userJson) {
          tokenRef.current = token;
          setAccessToken(token);
          const parsed = JSON.parse(userJson) as AuthUser;
          setUser(parsed);
          if (storedRole) setActiveRoleState(storedRole);
          else setActiveRoleState(parsed.role);
          if (storedOutlet) {
            const n = Number(storedOutlet);
            if (Number.isFinite(n)) setOutletScopeIdState(n);
          }
        }
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    }
    loadToken();
  }, []);

  // Refresh outlets / permissions from /auth/me whenever the access token changes.
  useEffect(() => {
    if (!accessToken || !user) return;
    void refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const target = routeForNotification(data, userRef.current?.role);
      if (target) {
        setTimeout(() => { try { router.push(target as never); } catch { /* ignore */ } }, 600);
      }
    }).catch(() => {});
    return () => sub.remove();
  }, []);

  const login = useCallback(async (token: string, refreshTok: string, userData: AuthUser) => {
    await SecureStorage.setItem("accessToken", token);
    await SecureStorage.setItem("refreshToken", refreshTok);
    await SecureStorage.setItem("authUser", JSON.stringify(userData));
    await SecureStorage.deleteItem(ACTIVE_ROLE_KEY);
    await SecureStorage.deleteItem(ACTIVE_OUTLET_KEY);
    tokenRef.current = token;
    userRef.current = userData;
    setAccessToken(token);
    setUser(userData);
    setActiveRoleState(userData.role);
    setOutletScopeIdState(null);
    registerPushToken(userData.id, token);
  }, []);

  const updateTokens = useCallback(async (newAccessToken: string, newRefreshToken: string) => {
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
    await SecureStorage.deleteItem(ACTIVE_ROLE_KEY);
    await SecureStorage.deleteItem(ACTIVE_OUTLET_KEY);
    tokenRef.current = null;
    userRef.current = null;
    setAccessToken(null);
    setUser(null);
    setOutletScopeIdState(null);
    setActiveRoleState(null);
  }, [accessToken]);

  const setActiveRole = useCallback(async (role: string) => {
    setActiveRoleState(role);
    try { await SecureStorage.setItem(ACTIVE_ROLE_KEY, role); } catch { /* ignore */ }
  }, []);

  const setOutletScopeId = useCallback((id: number | null) => {
    setOutletScopeIdState(id);
    if (id == null) {
      SecureStorage.deleteItem(ACTIVE_OUTLET_KEY).catch(() => {});
    } else {
      SecureStorage.setItem(ACTIVE_OUTLET_KEY, String(id)).catch(() => {});
    }
  }, []);

  const restaurantId = user?.restaurantId ?? 1;
  const tenantId = user?.tenantId ?? null;
  const isScopeOwner = user?.role === "owner" || user?.role === "manager" || user?.isSuperAdmin === true;
  const effectiveBranchId = isScopeOwner ? outletScopeId : null;
  const effectiveRestaurantId = restaurantId;

  // Derived role/permission/outlet view.
  const roles = user?.roles && user.roles.length > 0 ? user.roles : (user ? [user.role] : []);
  const explicitPerms = user?.permissions ?? [];
  // For owner/super_admin, treat as wildcard — return the full union.
  const permissions = (user?.role === "owner" || user?.isSuperAdmin)
    ? permissionsForRole("owner").map(String)
    : (explicitPerms.length > 0 ? explicitPerms : permissionsForRole(activeRole ?? user?.role).map(String));
  const outlets = user?.outlets ?? [];
  const activeOutlet = outletScopeId != null
    ? (outlets.find((o) => o.id === outletScopeId) ?? null)
    : (outlets.find((o) => o.id === restaurantId) ?? outlets[0] ?? null);

  return (
    <AuthContext.Provider value={{
      user, accessToken, isLoading,
      restaurantId, tenantId, outletScopeId, setOutletScopeId,
      effectiveRestaurantId, effectiveBranchId,
      roles, activeRole, setActiveRole, permissions, outlets, activeOutlet,
      login, logout, updateTokens, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
