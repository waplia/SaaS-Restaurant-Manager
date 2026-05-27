import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const isWeb = Platform.OS === "web";

// expo-secure-store only allows alphanumerics, ".", "-", and "_" in keys.
// Several call sites build composite keys like `foo:<userId>` which would
// otherwise crash the app with an "Invalid key" red box. Sanitize once,
// inside the wrapper, so every caller is safe.
function safeKey(key: string): string {
  const cleaned = (key || "").replace(/[^A-Za-z0-9._-]/g, "_");
  // SecureStore also rejects empty keys.
  return cleaned.length > 0 ? cleaned : "_";
}

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(safeKey(key));
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    } catch {
      // ignore
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(safeKey(key), value);
  } catch {
    // ignore — storage failures must never crash the UI
  }
}

export async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(safeKey(key));
  } catch {
    // ignore
  }
}
