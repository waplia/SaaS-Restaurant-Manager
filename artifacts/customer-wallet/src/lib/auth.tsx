import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";

export interface CustomerUser {
  id: number;
  phone: string;
  name: string | null;
  email: string | null;
  avatarUrl?: string | null;
}

interface AuthContextValue {
  user: CustomerUser | null;
  loading: boolean;
  signOut: () => void;
  setUser: (u: CustomerUser | null) => void;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [loading, setLoading] = useState<boolean>(!!getToken());

  const refresh = async () => {
    if (!getToken()) { setUser(null); setLoading(false); return; }
    try {
      const r = await api<{ customerUser: CustomerUser }>("/wallet/me");
      setUser(r.customerUser);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const signOut = () => { setToken(null); setUser(null); };

  return (
    <AuthCtx.Provider value={{ user, loading, signOut, setUser, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
