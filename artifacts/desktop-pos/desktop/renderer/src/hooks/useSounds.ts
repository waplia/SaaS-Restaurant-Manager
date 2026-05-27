/**
 * Sound feedback hook. Uses the Web Audio API so the desktop POS gets
 * crisp, low-latency cues without bundling binary assets. Preferences
 * persist in localStorage and can be edited from App Settings.
 *
 * Each event has a default tone profile, overridable per-event via the
 * Tones picker. A "mute for this shift" toggle silences all cues until
 * cleared or until the local cache is reset.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type SoundKey = "add" | "remove" | "pay" | "error" | "alert" | "scan" | "hold" | "kot";
export type TonePreset = "default" | "soft" | "bold" | "classic" | "off";

interface SoundPrefs {
  enabled: boolean;
  volume: number;
  /** Per-event tone preset overrides. */
  tones: Record<SoundKey, TonePreset>;
  /** When true, every cue is silenced regardless of `enabled`. */
  muteForShift: boolean;
}

const STORAGE_KEY = "kp:soundPrefs";

const DEFAULT_TONES: Record<SoundKey, TonePreset> = {
  add: "default", remove: "default", pay: "default", error: "default",
  alert: "default", scan: "default", hold: "default", kot: "default",
};

const DEFAULTS: SoundPrefs = {
  enabled: true,
  volume: 0.5,
  tones: { ...DEFAULT_TONES },
  muteForShift: false,
};

function readPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, tones: { ...DEFAULT_TONES } };
    const parsed = JSON.parse(raw) as Partial<SoundPrefs>;
    return {
      enabled: parsed.enabled ?? DEFAULTS.enabled,
      volume: Math.max(0, Math.min(1, parsed.volume ?? DEFAULTS.volume)),
      tones: { ...DEFAULT_TONES, ...(parsed.tones ?? {}) },
      muteForShift: parsed.muteForShift ?? false,
    };
  } catch {
    return { ...DEFAULTS, tones: { ...DEFAULT_TONES } };
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
  } catch { return null; }
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

function playForPreset(key: SoundKey, preset: TonePreset, v: number): void {
  if (preset === "off") return;
  // Scaling for soft/bold/classic
  const v2 = preset === "soft" ? v * 0.55 : preset === "bold" ? Math.min(1, v * 1.3) : v;
  const wave: OscillatorType =
    preset === "classic" ? "square" : preset === "bold" ? "sawtooth" : "triangle";
  switch (key) {
    case "add":    return beep(880, 60, wave, v2);
    case "remove": return beep(440, 60, wave, v2);
    case "pay":    return chirp(660, 1040, 240, v2);
    case "error":  return beep(200, 200, "square", v2);
    case "alert":  beep(1200, 90, "sine", v2, 0); beep(1200, 90, "sine", v2, 0.13); return;
    case "scan":   return beep(1400, 40, "sine", v2);
    case "hold":   return beep(520, 80, wave, v2);
    case "kot":    beep(720, 90, "sine", v2, 0); beep(920, 110, "sine", v2, 0.10); return;
  }
}

export function playSound(key: SoundKey, override?: Partial<SoundPrefs>): void {
  const base = readPrefs();
  const prefs = override ? { ...base, ...override, tones: { ...base.tones, ...(override.tones ?? {}) } } : base;
  if (!prefs.enabled || prefs.muteForShift) return;
  const preset = prefs.tones[key] ?? "default";
  playForPreset(key, preset, prefs.volume);
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
      const next: SoundPrefs = {
        enabled: patch.enabled ?? prev.enabled,
        volume: Math.max(0, Math.min(1, patch.volume ?? prev.volume)),
        muteForShift: patch.muteForShift ?? prev.muteForShift,
        tones: { ...prev.tones, ...(patch.tones ?? {}) },
      };
      writePrefs(next);
      return next;
    });
  }, []);

  return { prefs, play, update };
}
