import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface KdsSettings {
  delayedThresholdMin: number;
  sound: boolean;
  vibration: boolean;
  autoAccept: boolean;
  defaultStationId: number | "all";
  autoPrint: boolean;
  alertSound: "chime" | "bell" | "ding";
}

const DEFAULT_SETTINGS: KdsSettings = {
  delayedThresholdMin: 15,
  sound: true,
  vibration: true,
  autoAccept: false,
  defaultStationId: "all",
  autoPrint: false,
  alertSound: "chime",
};

const STORAGE_KEY = "kds.settings.v1";

export function useKdsSettings() {
  const [settings, setSettings] = useState<KdsSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<KdsSettings>;
            setSettings({ ...DEFAULT_SETTINGS, ...parsed });
          } catch {
            /* ignore corrupt */
          }
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  const update = useCallback((patch: Partial<KdsSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return { settings, update, loaded };
}
