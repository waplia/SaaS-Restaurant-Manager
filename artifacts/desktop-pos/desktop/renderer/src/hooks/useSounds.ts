/**
 * Sound feedback hook. Uses the Web Audio API so the desktop POS gets
 * crisp, low-latency cues without bundling binary assets. Sound preferences
 * persist in localStorage and can be toggled from App Settings.
 *
 * Tones (frequency, duration, type):
 *   add        — 880Hz, 60ms,  triangle
 *   remove     — 440Hz, 60ms,  triangle
 *   pay        — 660→1040Hz chirp, 220ms, sine
 *   error      — 200Hz square, 180ms
 *   alert      — 1200Hz double-beep
 *   scan       — 1400Hz, 40ms, sine
 *   hold       — 520Hz, 80ms, triangle
 *   kot        — 720Hz then 920Hz, 180ms, sine
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type SoundKey = "add" | "remove" | "pay" | "error" | "alert" | "scan" | "hold" | "kot";

interface SoundPrefs {
  enabled: boolean;
  volume: number;
}

const STORAGE_KEY = "kp:soundPrefs";
const DEFAULTS: SoundPrefs = { enabled: true, volume: 0.5 };

function readPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<SoundPrefs>;
    return {
      enabled: parsed.enabled ?? DEFAULTS.enabled,
      volume: Math.max(0, Math.min(1, parsed.volume ?? DEFAULTS.volume)),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function writePrefs(p: SoundPrefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

let _ctx: AudioContext | null = null;
function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (_ctx) return _ctx;
  try {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    _ctx = new C();
    return _ctx;
  } catch {
    return null;
  }
}

function beep(freq: number, durMs: number, type: OscillatorType, volume: number, when = 0): void {
  const a = ctx();
  if (!a) return;
  try {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0;
    osc.connect(gain).connect(a.destination);
    const t = a.currentTime + when;
    const peak = Math.max(0, Math.min(1, volume));
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
    osc.start(t);
    osc.stop(t + durMs / 1000 + 0.02);
  } catch { /* ignore */ }
}

function chirp(from: number, to: number, durMs: number, volume: number): void {
  const a = ctx();
  if (!a) return;
  try {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = "sine";
    const t = a.currentTime;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + durMs / 1000);
    const peak = Math.max(0, Math.min(1, volume));
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + durMs / 1000 + 0.02);
  } catch { /* ignore */ }
}

export function playSound(key: SoundKey, override?: Partial<SoundPrefs>): void {
  const prefs = override
    ? { ...readPrefs(), ...override }
    : readPrefs();
  if (!prefs.enabled) return;
  const v = prefs.volume;
  switch (key) {
    case "add":    return beep(880, 60, "triangle", v);
    case "remove": return beep(440, 60, "triangle", v);
    case "pay":    return chirp(660, 1040, 220, v);
    case "error":  return beep(200, 180, "square", v);
    case "alert":  beep(1200, 90, "sine", v, 0); beep(1200, 90, "sine", v, 0.13); return;
    case "scan":   return beep(1400, 40, "sine", v);
    case "hold":   return beep(520, 80, "triangle", v);
    case "kot":    beep(720, 90, "sine", v, 0); beep(920, 110, "sine", v, 0.10); return;
  }
}

/**
 * React hook — returns a `play(key)` fn and the current prefs. Subscribes
 * to storage changes so multiple tabs/windows stay in sync.
 */
export function useSounds() {
  const [prefs, setPrefs] = useState<SoundPrefs>(() => readPrefs());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPrefs(readPrefs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const play = useCallback((key: SoundKey) => {
    playSound(key, prefsRef.current);
  }, []);

  const update = useCallback((patch: Partial<SoundPrefs>) => {
    setPrefs(prev => {
      const next = {
        enabled: patch.enabled ?? prev.enabled,
        volume: Math.max(0, Math.min(1, patch.volume ?? prev.volume)),
      };
      writePrefs(next);
      return next;
    });
  }, []);

  return { prefs, play, update };
}
