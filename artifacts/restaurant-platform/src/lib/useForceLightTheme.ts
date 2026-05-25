import { useEffect } from "react";

/**
 * Forces the page into light theme regardless of the user's saved preference.
 * Removes the `dark` class from <html> on mount and restores it on unmount.
 * Used on public auth pages (login, register, forgot/reset password) so they
 * always render in a consistent light theme.
 */
export function useForceLightTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    if (wasDark) root.classList.remove("dark");
    return () => {
      if (wasDark) root.classList.add("dark");
    };
  }, []);
}
