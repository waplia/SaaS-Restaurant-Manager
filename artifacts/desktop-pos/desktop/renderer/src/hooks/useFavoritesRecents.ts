/**
 * Per-user favorites + recents for the workspace nav and command palette.
 *
 * Stored as plain JSON in localStorage so it survives reloads without a
 * round trip. Keyed by `userId` + workspace so two staff sharing one
 * terminal don't trample each other's pins.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "kp:wsNav";
const MAX_RECENTS = 8;
const MAX_FAVORITES = 12;

interface PerWorkspaceState {
  favorites: string[];
  recents: string[];
}
interface AllState {
  // user:id → workspace → state
  [scope: string]: { [workspace: string]: PerWorkspaceState };
}

function readAll(): AllState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as AllState;
  } catch { return {}; }
}
function writeAll(s: AllState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function useFavoritesRecents(userId: number | string, workspaceKey: string) {
  const scope = `u:${userId}`;
  const [state, setState] = useState<PerWorkspaceState>(() => {
    const all = readAll();
    return all[scope]?.[workspaceKey] ?? { favorites: [], recents: [] };
  });

  // Re-read on userId / workspace change so switching outlet/role
  // refreshes the rail without a full reload.
  useEffect(() => {
    const all = readAll();
    setState(all[scope]?.[workspaceKey] ?? { favorites: [], recents: [] });
  }, [scope, workspaceKey]);

  const persist = useCallback((next: PerWorkspaceState) => {
    const all = readAll();
    all[scope] = { ...(all[scope] ?? {}), [workspaceKey]: next };
    writeAll(all);
    setState(next);
  }, [scope, workspaceKey]);

  const toggleFavorite = useCallback((key: string) => {
    setState(prev => {
      const exists = prev.favorites.includes(key);
      const favorites = exists
        ? prev.favorites.filter(k => k !== key)
        : [...prev.favorites, key].slice(0, MAX_FAVORITES);
      const next = { ...prev, favorites };
      persist(next);
      return next;
    });
  }, [persist]);

  const recordRecent = useCallback((key: string) => {
    setState(prev => {
      const recents = [key, ...prev.recents.filter(k => k !== key)].slice(0, MAX_RECENTS);
      const next = { ...prev, recents };
      persist(next);
      return next;
    });
  }, [persist]);

  const reorderFavorites = useCallback((from: number, to: number) => {
    setState(prev => {
      const next = { ...prev, favorites: [...prev.favorites] };
      const [moved] = next.favorites.splice(from, 1);
      if (moved !== undefined) next.favorites.splice(to, 0, moved);
      persist(next);
      return next;
    });
  }, [persist]);

  return {
    favorites: state.favorites,
    recents: state.recents,
    isFavorite: useCallback((k: string) => state.favorites.includes(k), [state.favorites]),
    toggleFavorite,
    recordRecent,
    reorderFavorites,
  };
}
