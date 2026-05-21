import { useEffect, useMemo, useRef } from "react";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

const SOURCES = {
  chime: require("../assets/sounds/chime.wav"),
  bell: require("../assets/sounds/bell.wav"),
  ding: require("../assets/sounds/ding.wav"),
} as const;

export type AlertSoundKey = keyof typeof SOURCES;

/**
 * Lazily load and replay one of the bundled KDS chime samples. Each
 * variant has its own AudioPlayer so we can switch instantly without
 * re-buffering, and we configure the audio session to play in silent
 * mode so kitchen tablets that are flipped to silent still chime —
 * a kitchen-floor requirement.
 */
export function useKdsSounds(enabled: boolean) {
  const players = useRef<Partial<Record<AlertSoundKey, AudioPlayer>>>({});

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: "mixWithOthers",
    }).catch(() => {});
    (Object.keys(SOURCES) as AlertSoundKey[]).forEach((key) => {
      try {
        const p = createAudioPlayer(SOURCES[key]);
        p.volume = 1;
        players.current[key] = p;
      } catch {
        /* asset unavailable */
      }
    });
    return () => {
      Object.values(players.current).forEach((p) => {
        try { p?.release(); } catch { /* ignore */ }
      });
      players.current = {};
    };
  }, []);

  return useMemo(() => ({
    play(key: AlertSoundKey) {
      if (!enabled) return;
      const p = players.current[key];
      if (!p) return;
      try {
        p.seekTo(0);
        p.play();
      } catch { /* ignore */ }
    },
  }), [enabled]);
}
