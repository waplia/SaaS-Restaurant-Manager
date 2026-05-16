import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
  tenantId: number | null;
  restaurantId: number | null;
  isSuperAdmin?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  register: (data: RegisterInput) => Promise<void>;
}

export interface RegisterInput {
  restaurantName: string;
  ownerName: string;
  email: string;
  password: string;
  phone?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "tt_access_token";
const REFRESH_KEY = "tt_refresh_token";
const USER_KEY = "tt_user";

const API_BASE = `/api`;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ user: null, accessToken: null, isLoading: false, isAuthenticated: false });
  }, []);

  useEffect(() => {
    // Impersonation hand-off: super-admin opens /app/#impersonate=<jwt>
    // Token is short-lived and minted server-side; we swap it in then fetch
    // the authoritative user from /auth/me so display info matches the JWT.
    if (window.location.hash.startsWith("#impersonate=")) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const t = params.get("impersonate");
      if (t) {
        localStorage.setItem(TOKEN_KEY, t);
        localStorage.removeItem(REFRESH_KEY);
        localStorage.removeItem(USER_KEY);
        window.history.replaceState(null, "", window.location.pathname);
        fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${t}` } })
          .then(r => r.ok ? r.json() : Promise.reject(new Error("impersonation token rejected")))
          .then((user: AuthUser) => {
            localStorage.setItem(USER_KEY, JSON.stringify(user));
            setState({ user, accessToken: t, isLoading: false, isAuthenticated: true });
          })
          .catch(() => {
            localStorage.removeItem(TOKEN_KEY);
            setState({ user: null, accessToken: null, isLoading: false, isAuthenticated: false });
          });
        return;
      }
    }
    const token = localStorage.getItem(TOKEN_KEY);
    const userRaw = localStorage.getItem(USER_KEY);
    if (token && userRaw) {
      try {
        const user = JSON.parse(userRaw) as AuthUser;
        setState({ user, accessToken: token, isLoading: false, isAuthenticated: true });
      } catch {
        setState({ user: null, accessToken: null, isLoading: false, isAuthenticated: false });
      }
    } else {
      setState(s => ({ ...s, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    window.addEventListener("tt:logout", clearAuth);
    return () => window.removeEventListener("tt:logout", clearAuth);
  }, [clearAuth]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Login failed" }));
      throw new Error(err.error ?? "Login failed");
    }
    const data = await res.json();
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setState({ user: data.user, accessToken: data.accessToken, isLoading: false, isAuthenticated: true });
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Registration failed" }));
      throw new Error(err.error ?? "Registration failed");
    }
    const data = await res.json();
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setState({ user: data.user, accessToken: data.accessToken, isLoading: false, isAuthenticated: true });
  }, []);

  const logout = useCallback(() => {
    // Fire-and-forget: ask the server to bump our tokenVersion so every
    // other session for this user (other tabs, phone, stolen laptop) is
    // revoked immediately. We don't await — clearing local storage and
    // navigating away matters more than waiting on the network round-trip.
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      // `keepalive: true` lets the request survive tab close / navigation so
      // the server-side revocation actually happens even if the user closes
      // the browser immediately after clicking sign out.
      void fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => { /* best-effort */ });
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ user: null, accessToken: null, isLoading: false, isAuthenticated: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, register }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

