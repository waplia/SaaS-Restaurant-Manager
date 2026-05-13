import { useEffect, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

const CACHE_TTL_MS = 10 * 60 * 1000;

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected !== false);
    });
    NetInfo.fetch().then((state) => setIsOnline(state.isConnected !== false));
    return unsub;
  }, []);

  return isOnline;
}

export function useOfflineCache<T>(key: string) {
  const readCache = useCallback(async (): Promise<T | null> => {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { ts: number; data: T };
      if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
      return parsed.data;
    } catch {
      return null;
    }
  }, [key]);

  const writeCache = useCallback(async (data: T) => {
    try {
      await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch {
      // ignore write errors
    }
  }, [key]);

  const clearCache = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // ignore
    }
  }, [key]);

  return { readCache, writeCache, clearCache };
}

export function useMenuCache(restaurantId: number, categoryId: number | null) {
  const cacheKey = `menu_cache_${restaurantId}_${categoryId ?? "all"}`;
  return useOfflineCache(cacheKey);
}
